/**
 * Les quatre scripts d'état de l'écouteur (claim, hold, close, settle) lancés pour de vrai
 * (sous-processus bun), contre un faux `archon` (fake-archon.ts, par `ARCHON_CLI_COMMAND`,
 * état dans un dossier temporaire). Les fixtures les stubbent : sans ce test, un `hold` qui
 * dirait toujours « held » ou un `close` qui écrirait sur la carte d'un autre run passeraient
 * `verify-block.sh`.
 *
 * Les scripts et .shared/ sont copiés dans un arbre temporaire avec des workflows jouets :
 * `pipeline` et `holder` prennent le verrou du dossier (pas de `mutates_checkout: false`),
 * `research-report` et `career-listener` le déclarent. Le test ne dépend donc pas de ce que les
 * vrais YAML déclarent.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ActiveRun, type BoardItem, newItem } from '../../.shared/board.ts';

const SCRIPTS = ['archon.ts', 'claim.ts', 'hold.ts', 'close.ts', 'settle.ts'];
const SHARED = ['board.ts', 'io.ts', 'state.ts'];
const FAKE = join(import.meta.dir, 'fake-archon.ts');
const RUN = 'L1';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Sandbox {
  root: string;
  fake: string;
  scripts: string;
}

/** Un arbre `systems/` jetable et l'état du faux archon : cartes (`board/<id>`, révision 1) et runs. */
function sandbox(cards: BoardItem[], runs: { active?: Partial<ActiveRun>[] | null; get?: Record<string, unknown> } = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'board-listener-test-'));
  roots.push(root);
  const scripts = join(root, 'systems', 'board-listener', 'scripts');
  const shared = join(root, 'systems', '.shared');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(shared);
  for (const file of SCRIPTS) copyFileSync(join(import.meta.dir, file), join(scripts, file));
  for (const file of SHARED) copyFileSync(join(import.meta.dir, '..', '..', '.shared', file), join(shared, file));
  const free = 'mutates_checkout: false\n';
  for (const [name, extra] of [['pipeline', ''], ['holder', ''], ['research-report', free], ['career-listener', free]] as const) {
    mkdirSync(join(root, 'systems', name));
    writeFileSync(join(root, 'systems', name, `${name}.yaml`), `name: ${name}\n${extra}nodes: []\n`);
  }
  const fake = join(root, 'archon');
  mkdirSync(fake);
  writeFileSync(join(fake, 'state.json'), JSON.stringify(Object.fromEntries(cards.map((c) => [`board/${c.id}`, { revision: 1, value: c }]))));
  const active =
    runs.active === null
      ? null
      : [{ id: RUN, workflow_name: 'board-listener', status: 'running', started_at: '2026-10-20T10:05:00Z' }, ...(runs.active ?? [])].map((r) => ({
          workflow_name: 'x',
          status: 'running',
          working_path: root,
          parent_run_id: null,
          started_at: '2026-10-20T10:00:00Z',
          ...r,
        }));
  writeFileSync(join(fake, 'runs.json'), JSON.stringify({ runs: active, get: runs.get ?? {} }));
  writeFileSync(join(fake, 'calls.log'), '');
  return { root, fake, scripts };
}

/** Lance un script de l'écouteur comme le moteur : cwd = le dossier du projet, WORKFLOW_ID = ce run. */
function run(box: Sandbox, script: string, inputs: Record<string, unknown> = {}) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.ARCHON_CMD;
  for (const [key, value] of Object.entries(inputs)) env[`INPUTS_${key.toUpperCase()}`] = JSON.stringify(value);
  const proc = Bun.spawnSync(['bun', join(box.scripts, script)], {
    cwd: box.root,
    env: { ...env, ARCHON_CLI_COMMAND: JSON.stringify([process.execPath, FAKE]), FAKE_ARCHON_DIR: box.fake, WORKFLOW_ID: RUN },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = proc.stdout.toString();
  return { code: proc.exitCode, stderr: proc.stderr.toString(), output: proc.exitCode === 0 ? (JSON.parse(stdout) as Record<string, unknown>) : null };
}

const docs = (box: Sandbox) => JSON.parse(readFileSync(join(box.fake, 'state.json'), 'utf8')) as Record<string, { revision: number; value: BoardItem }>;
const card = (box: Sandbox, id: string) => docs(box)[`board/${id}`]!;
const patches = (box: Sandbox) =>
  readFileSync(join(box.fake, 'calls.log'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"patch"'));

/** Même date de création pour toutes : à égalité, la file les prend par nom (`board/a` avant `board/bb`). */
const item = (id: string, over: Partial<BoardItem> = {}): BoardItem => ({ ...newItem(id, `task ${id}`, '', new Date('2026-10-20T09:00:00Z')), ...over });
const pickedBy = (run: string) => ({ status: 'picked_up' as const, picked: { run, at: '2026-10-20T10:00:00.000Z' } });
const claimOf = (id: string, workflow = 'pipeline') => ({ path: 'work', id, run: RUN, workflow, task: `task ${id}`, context: '', revision: 2, note: '' });
const doneOutcome = (id: string) => ({ ok: true, path: 'done', id, workflow: 'pipeline', summary: `Task ${id} (pipeline / done): approved`, result: { ok: true, stage: 'done' } });

describe('claim (le dossier partagé et la prise conditionnelle)', () => {
  const holder = { id: 'H', workflow_name: 'career-listener', status: 'paused', started_at: '2026-10-20T08:00:00Z' };
  const locker = { id: 'K', workflow_name: 'holder', status: 'paused', started_at: '2026-10-20T10:06:00Z' };

  test('dossier tenu par un run en pause : la carte d’un système qui prend le verrou reste NEW, le run finit `waiting`', () => {
    const box = sandbox([item('a')], { active: [holder] });
    const { code, output } = run(box, 'claim.ts');
    expect(code).toBe(0);
    expect(output).toMatchObject({ path: 'waiting', id: '', run: RUN });
    expect(String(output!.note)).toContain('1 card(s) left NEW (a): run H (career-listener, paused) works in this folder');
    expect(card(box, 'a')).toEqual({ revision: 1, value: item('a') });
    expect(patches(box)).toEqual([]);
  });

  test('même dossier tenu, par un run sans verrou : la carte d’un système qui déclare `mutates_checkout: false` part, la plus ancienne attend', () => {
    const box = sandbox([item('a'), item('bb', { workflow: 'research-report' })], { active: [holder] });
    const { output } = run(box, 'claim.ts');
    expect(output).toMatchObject({ path: 'work', id: 'bb', workflow: 'research-report', revision: 2 });
    expect(String(output!.note)).toContain('(a)');
    expect(card(box, 'a').value.status).toBe('new');
    expect(card(box, 'bb')).toMatchObject({ revision: 2, value: { status: 'picked_up', picked: { run: RUN } } });
  });

  test('un run du dossier qui prend le verrou, même plus récent : AUCUNE carte ne part (sa reprise serait annulée)', () => {
    const box = sandbox([item('bb', { workflow: 'research-report' })], { active: [holder, locker] });
    const { output } = run(box, 'claim.ts');
    expect(output).toMatchObject({ path: 'waiting', id: '' });
    expect(String(output!.note)).toContain("run K (holder, paused) takes this folder's lock");
    expect(card(box, 'bb').value.status).toBe('new');
    expect(patches(box)).toEqual([]);
  });

  test('un run dont le workflow est introuvable compte comme un verrou', () => {
    const box = sandbox([item('bb', { workflow: 'research-report' })], { active: [{ ...locker, workflow_name: 'archon-assist' }] });
    expect(run(box, 'claim.ts').output).toMatchObject({ path: 'waiting' });
  });

  test('un run d’un autre dossier ne tient pas celui-ci ; une prise refusée (exit 3) passe à la suivante', () => {
    const box = sandbox([item('a'), item('bb')], { active: [{ ...holder, working_path: '/ailleurs' }] });
    writeFileSync(join(box.fake, 'conflicts.json'), JSON.stringify(['board/a']));
    const { output } = run(box, 'claim.ts');
    expect(output).toMatchObject({ path: 'work', id: 'bb', note: '' });
    expect(card(box, 'a')).toEqual({ revision: 1, value: item('a') });
  });

  test('liste des runs illisible : la carte est prise quand même, en le disant', () => {
    const box = sandbox([item('a')], { active: null });
    const { output, stderr } = run(box, 'claim.ts');
    expect(output).toMatchObject({ path: 'work', id: 'a' });
    expect(stderr).toContain('without the folder check');
  });

  test('tableau vide : `idle`', () => {
    expect(run(sandbox([]), 'claim.ts').output).toMatchObject({ path: 'idle', id: '' });
  });
});

describe('hold (la garde rejouée à chaque reprise)', () => {
  test('carte remise en file : `held: false`, rien n’est écrit', () => {
    const requeued = item('a', { history: [{ action: 'requeue', from: 'failed', at: 'x', reason: null, picked: { run: RUN, at: 'x' }, result: null, summary: 'r', finished: 'y' }] });
    const box = sandbox([requeued]);
    expect(run(box, 'hold.ts', { claim: claimOf('a') }).output).toEqual({ held: false, status: 'new', by: '' });
    expect(patches(box)).toEqual([]);
  });

  test('carte prise par un autre run : `held: false`, rien n’est écrit', () => {
    const box = sandbox([item('a', pickedBy('L2'))]);
    expect(run(box, 'hold.ts', { claim: claimOf('a') }).output).toEqual({ held: false, status: 'picked_up', by: 'L2' });
    expect(patches(box)).toEqual([]);
  });

  test('carte prise par ce run : `held: true`, rien n’est écrit', () => {
    const box = sandbox([item('a', pickedBy(RUN))]);
    expect(run(box, 'hold.ts', { claim: claimOf('a') }).output).toEqual({ held: true, status: 'picked_up', by: RUN });
    expect(patches(box)).toEqual([]);
  });

  test('carte close par SON settle, remise en file pendant la reprise : refus d’écriture, le nœud échoue, la carte reste NEW', () => {
    const settled = item('a', {
      status: 'failed',
      picked: { run: RUN, at: '2026-10-20T10:00:00.000Z' },
      history: [{ action: 'settle', from: 'picked_up', at: 'x', reason: null, picked: { run: RUN, at: '2026-10-20T10:00:00.000Z' }, result: null, summary: null, finished: null }],
    });
    const box = sandbox([settled]);
    writeFileSync(join(box.fake, 'race.json'), JSON.stringify({ 'board/a': [{ op: 'set', path: '/status', value: 'new' }, { op: 'set', path: '/picked', value: null }] }));
    const { code, stderr } = run(box, 'hold.ts', { claim: claimOf('a') });
    expect(code).not.toBe(0);
    expect(stderr).toContain('board/a changed while this run was taking it back');
    expect(card(box, 'a').value).toMatchObject({ status: 'new', picked: null });
  });

  test('rien de pris (`waiting`) : ne lit pas l’état', () => {
    const box = sandbox([item('a')]);
    expect(run(box, 'hold.ts', { claim: { ...claimOf(''), path: 'waiting' } }).output).toEqual({ held: false, status: '', by: '' });
    expect(readFileSync(join(box.fake, 'calls.log'), 'utf8')).toBe('');
  });
});

describe('close (n’écrit que sur la carte de ce run)', () => {
  test('carte prise par un autre run : le nœud échoue, la carte n’est pas écrite', () => {
    const box = sandbox([item('a', pickedBy('L2'))]);
    const { code, stderr } = run(box, 'close.ts', { claim: claimOf('a'), outcome: doneOutcome('a') });
    expect(code).not.toBe(0);
    expect(stderr).toContain('board/a is picked_up by run L2');
    expect(card(box, 'a')).toEqual({ revision: 1, value: item('a', pickedBy('L2')) });
    expect(patches(box)).toEqual([]);
  });

  test('reprise à la main entre sa lecture et son écriture : écriture conditionnelle refusée, la carte reste remise en file', () => {
    const box = sandbox([item('a', pickedBy(RUN))]);
    const requeue = [{ op: 'set', path: '/status', value: 'new' }, { op: 'set', path: '/picked', value: null }];
    writeFileSync(join(box.fake, 'race.json'), JSON.stringify({ 'board/a': requeue }));
    const { code, stderr } = run(box, 'close.ts', { claim: claimOf('a'), outcome: doneOutcome('a') });
    expect(code).not.toBe(0);
    expect(stderr).toContain('board/a changed while closing it: left as is');
    expect(card(box, 'a')).toMatchObject({ revision: 2, value: { status: 'new', picked: null } });
  });

  test('carte remise en file : le nœud échoue, la carte reste NEW', () => {
    const box = sandbox([item('a')]);
    expect(run(box, 'close.ts', { claim: claimOf('a'), outcome: doneOutcome('a') }).code).not.toBe(0);
    expect(card(box, 'a').value.status).toBe('new');
  });

  test('carte prise par ce run : DONE, l’issue et la phrase écrites', () => {
    const box = sandbox([item('a', pickedBy(RUN))]);
    const { output } = run(box, 'close.ts', { claim: claimOf('a'), outcome: doneOutcome('a') });
    expect(output).toMatchObject({ ok: true, path: 'done', id: 'a' });
    expect(card(box, 'a')).toMatchObject({ revision: 2, value: { status: 'done', result: { ok: true, stage: 'done' }, summary: 'Task a (pipeline / done): approved' } });
  });

  test('`waiting` : rien à écrire, l’état n’est pas lu', () => {
    const box = sandbox([]);
    const outcome = { ok: true, path: 'waiting', id: '', workflow: '', summary: 'n', result: null };
    expect(run(box, 'close.ts', { claim: { ...claimOf(''), path: 'waiting' }, outcome }).output).toMatchObject({ ok: true, path: 'waiting' });
    expect(readFileSync(join(box.fake, 'calls.log'), 'utf8')).toBe('');
  });
});

describe('settle, puis la reprise du run', () => {
  const failedRun = { get: { [RUN]: { id: RUN, status: 'running', nodes: [{ nodeId: 'outcome', state: 'failed', error: 'x' }, { nodeId: 'run_pipeline', state: 'failed', error: "Sub-run 'pipeline' failed" }] } } };

  test('carte prise par un autre run : rien n’est écrit', () => {
    const box = sandbox([item('a', pickedBy('L2'))], failedRun);
    expect(run(box, 'settle.ts', { claim: claimOf('a'), outcome: null }).output).toMatchObject({ settled: false, id: 'a' });
    expect(patches(box)).toEqual([]);
  });

  test('reprise à la main entre sa lecture et son écriture : rien n’est écrit, la carte reste remise en file', () => {
    const box = sandbox([item('a', pickedBy(RUN))], failedRun);
    writeFileSync(join(box.fake, 'race.json'), JSON.stringify({ 'board/a': [{ op: 'set', path: '/status', value: 'new' }, { op: 'set', path: '/picked', value: null }] }));
    expect(run(box, 'settle.ts', { claim: claimOf('a'), outcome: null }).output).toMatchObject({ settled: false, summary: 'board/a changed while settling: left as is.' });
    expect(card(box, 'a').value).toMatchObject({ status: 'new', picked: null });
  });

  test('sous-run en échec : FAILED avec la cause ; le run repris reprend SA carte (`hold`) et `close` écrit l’issue', () => {
    const box = sandbox([item('a', pickedBy(RUN))], failedRun);
    const settled = run(box, 'settle.ts', { claim: claimOf('a'), outcome: null }).output!;
    expect(settled).toMatchObject({ settled: true, id: 'a' });
    expect(String(settled.summary)).toContain("(run_pipeline: Sub-run 'pipeline' failed)");
    expect(String(settled.summary)).toContain(`archon workflow resume ${RUN}`);
    expect(card(box, 'a').value).toMatchObject({ status: 'failed', picked: { run: RUN } });
    expect(card(box, 'a').value.history!.map((h) => h.action)).toEqual(['settle']);
    // `archon workflow resume L1` : `hold` est rejoué, reprend la carte, et le sous-run relancé rend une issue.
    expect(run(box, 'hold.ts', { claim: claimOf('a') }).output).toEqual({ held: true, status: 'picked_up', by: RUN });
    expect(card(box, 'a').value).toMatchObject({ status: 'picked_up', summary: null, finished: null });
    expect(run(box, 'close.ts', { claim: claimOf('a'), outcome: doneOutcome('a') }).output).toMatchObject({ path: 'done' });
    expect(card(box, 'a').value.status).toBe('done');
    expect(card(box, 'a').value.history!.map((h) => h.action)).toEqual(['settle', 'resume']);
    // Le settle du run repris : la carte est close, il n’y touche plus.
    expect(run(box, 'settle.ts', { claim: claimOf('a'), outcome: doneOutcome('a') }).output).toMatchObject({ settled: false });
    // Un autre run repris ne reprend pas une carte que L1 a close.
    expect(run(box, 'hold.ts', { claim: { ...claimOf('a'), run: 'L2' } }).output).toMatchObject({ held: false, status: 'done' });
  });
});
