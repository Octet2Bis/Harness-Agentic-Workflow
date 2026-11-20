/**
 * `close`, `settle` et `claim` lancés pour de vrai (sous-processus bun) sur un dossier
 * carrière temporaire : quand `record` a rendu une issue sans pouvoir l'écrire, `close` l'écrit
 * tant que l'offre est APPLYING par cette prise ; quand l'écriture de `close` échoue elle
 * aussi, `settle` relit close.json et écrit le statut calculé (APPLIED reste APPLIED) ; un
 * sous-run annulé pendant `submit` laisse une offre APPLY_UNPROVEN, jamais APPLY_FAILED ; le
 * listener ne prend rien tant qu'une candidature est en vol.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(script: string, career: string, env: Record<string, string>): Record<string, unknown> {
  const proc = Bun.spawnSync(['bun', join(import.meta.dir, script)], {
    env: { ...process.env, INPUTS_CAREER_DIR: career, ARTIFACTS_DIR: join(career, '..', 'listener-artifacts'), WORKFLOW_ID: 'L9', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(proc.stderr.toString()).toBe('');
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
}

const claim = JSON.stringify({ path: 'work', slug: 'acme', company: 'Acme', title: 't', run: 'L1', stale: [], summary: 'Picked acme.' });
const unwritten = { ok: true, stage: 'done', status: 'APPLIED', status_written: false, app_dir: '', copied: [], summary: 'Application sent and confirmed. Status APPLIED (not written: pending_gold_jobs.json could not be written (EPERM)).' };

function career(job: Record<string, unknown>, others: Record<string, unknown>[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'close-test-'));
  dirs.push(root);
  const dir = join(root, 'career');
  mkdirSync(dir);
  mkdirSync(join(root, 'listener-artifacts'));
  writeFileSync(join(dir, 'pending_gold_jobs.json'), JSON.stringify([{ slug: 'acme', company: 'Acme', title: 't', link: '', validated_at: 'v', ...job }, ...others]));
  return dir;
}
const board = (dir: string): Record<string, unknown>[] => JSON.parse(readFileSync(join(dir, 'pending_gold_jobs.json'), 'utf8')) as Record<string, unknown>[];
const status = (dir: string): unknown => board(dir)[0]!.status;

describe('close : écrit l’issue que record n’a pas pu écrire, puis settle n’a plus rien à faire', () => {
  test('APPLYING par cette prise : APPLIED écrit par close, settle ne touche plus l’offre', () => {
    const dir = career({ status: 'APPLYING', applying: { run: 'L1', at: '2026-10-20T10:00:00Z' } });
    const closed = run('close.ts', dir, { INPUTS_CLAIM: claim, INPUTS_RESULT: JSON.stringify(unwritten) });
    expect(closed).toMatchObject({ ok: true, path: 'done', status: 'APPLIED' });
    expect(String(closed.summary)).toContain('the listener wrote APPLIED');
    expect(status(dir)).toBe('APPLIED');
    expect(run('settle.ts', dir, { INPUTS_CLAIM: claim })).toMatchObject({ settled: false, status: 'APPLIED' });
    expect(status(dir)).toBe('APPLIED');
    expect(existsSync(join(dir, 'pending_gold_jobs.json.lock'))).toBe(false);
  });

  test('offre qui n’est plus APPLYING par cette prise : close ne la touche pas', () => {
    const dir = career({ status: 'VALIDATED', validated_at: 'newer' });
    const closed = run('close.ts', dir, { INPUTS_CLAIM: claim, INPUTS_RESULT: JSON.stringify({ ...unwritten, status: 'TAILORED', ok: false }) });
    expect(String(closed.summary)).toContain('Not rewritten: the offer is VALIDATED');
    expect(status(dir)).toBe('VALIDATED');
  });

  test('record a écrit (status_written: true) : close relaie sans écrire', () => {
    const dir = career({ status: 'APPLIED', harness: { run: 'A1' } });
    run('close.ts', dir, { INPUTS_CLAIM: claim, INPUTS_RESULT: JSON.stringify({ ...unwritten, status_written: true }) });
    expect(status(dir)).toBe('APPLIED');
  });
});

describe('settle : jamais APPLY_FAILED sur une candidature envoyée ou peut-être envoyée', () => {
  test('le défaut reproduit : l’écriture de close échoue aussi ; close.json est sauvé d’abord, settle écrit APPLIED', () => {
    const dir = career({ status: 'APPLYING', applying: { run: 'L1', at: '2026-10-20T10:00:00Z' } });
    // Un dossier à la place du fichier temporaire : toute écriture du tableau échoue (EISDIR), comme un fichier verrouillé.
    mkdirSync(join(dir, 'pending_gold_jobs.json.tmp'));
    const closed = run('close.ts', dir, { INPUTS_CLAIM: claim, INPUTS_RESULT: JSON.stringify(unwritten) });
    expect(String(closed.summary)).toContain('could not be written here either');
    expect(status(dir)).toBe('APPLYING');
    const saved = JSON.parse(readFileSync(join(dir, '..', 'listener-artifacts', 'close.json'), 'utf8')) as { result: { status: string } };
    expect(saved.result.status).toBe('APPLIED');
    // Le blocage passe ; settle, dernier nœud, relit close.json.
    rmSync(join(dir, 'pending_gold_jobs.json.tmp'), { recursive: true });
    const settled = run('settle.ts', dir, { INPUTS_CLAIM: claim });
    expect(settled).toMatchObject({ settled: true, status: 'APPLIED' });
    expect(String(settled.summary)).toContain('saved in close.json');
    expect(board(dir)[0]).toMatchObject({ status: 'APPLIED', harness: { run: 'L1', stage: 'done' } });
  });

  test('sous-run annulé pendant submit (close n’a pas tourné, armed.json dans son submission/) : APPLY_UNPROVEN', () => {
    const root = mkdtempSync(join(tmpdir(), 'child-artifacts-'));
    dirs.push(root);
    mkdirSync(join(root, 'submission'));
    writeFileSync(join(root, 'submission', 'decision.json'), JSON.stringify({ proceed: true, path: 'approved' }));
    writeFileSync(join(root, 'submission', 'armed.json'), JSON.stringify({ at: '2026-10-20T10:05:00Z' }));
    const dir = career({ status: 'APPLYING', applying: { run: 'L1', at: '2026-10-20T10:00:00Z', artifacts: root } });
    const settled = run('settle.ts', dir, { INPUTS_CLAIM: claim });
    expect(settled).toMatchObject({ settled: true, status: 'APPLY_UNPROVEN' });
    expect(String((board(dir)[0]!.harness as { summary: string }).summary)).toContain('armed.json');
  });

  test('sous-run en échec avant le go (aucune trace) : APPLY_FAILED, comme avant', () => {
    const root = mkdtempSync(join(tmpdir(), 'child-artifacts-'));
    dirs.push(root);
    const dir = career({ status: 'APPLYING', applying: { run: 'L1', at: '2026-10-20T10:00:00Z', artifacts: root } });
    expect(run('settle.ts', dir, { INPUTS_CLAIM: claim })).toMatchObject({ settled: true, status: 'APPLY_FAILED' });
  });
});

describe('claim : une candidature à la fois', () => {
  test('une offre APPLYING récente (un run lancé à la main) : le listener ne prend rien', () => {
    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dir = career({ status: 'VALIDATED' }, [{ slug: 'manual', company: 'M', title: 't', link: '', status: 'APPLYING', applying: { run: 'A1', at: recent } }]);
    const out = run('claim.ts', dir, {});
    expect(out).toMatchObject({ path: 'idle', slug: '' });
    expect(String(out.summary)).toContain('one at a time');
    expect(status(dir)).toBe('VALIDATED');
  });

  test('sinon, prend l’offre VALIDATED et note son run', () => {
    const dir = career({ status: 'VALIDATED' });
    expect(run('claim.ts', dir, {})).toMatchObject({ path: 'work', slug: 'acme', run: 'L9' });
    expect(board(dir)[0]).toMatchObject({ status: 'APPLYING', applying: { run: 'L9' } });
  });
});
