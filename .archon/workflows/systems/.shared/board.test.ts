import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type ActiveRun,
  BOARD_WORKFLOWS,
  type BoardDoc,
  type BoardItem,
  type BoardOp,
  type BoardOutcome,
  type BoardWorkflow,
  type ClaimOutput,
  type HoldOutput,
  NOT_HELD,
  cardInputs,
  closeOps,
  closeOutcome,
  closeProblem,
  failureReason,
  folderRuns,
  folderWait,
  holdDecision,
  isBoardItem,
  itemWorkflow,
  liveRunProblem,
  manualOps,
  newItem,
  newItemId,
  parseAddArgs,
  parseManualArgs,
  pickOps,
  pickOrder,
  routeOf,
  routeProblem,
  runNodeId,
  settleOps,
  takesFolderLock,
  waitingNote,
  workflowTakesLock,
  worktreeProblem,
} from './board.ts';

const now = new Date('2026-10-16T15:00:00Z');
const doc = (name: string, status: BoardDoc['value']['status'], created: string): BoardDoc => ({
  name,
  revision: 1,
  value: { ...newItem(name, 't', '', new Date(created)), status },
});
const item = (over: Partial<BoardItem> = {}): BoardItem => ({ ...newItem('20261016150000-abcd', 'Faire le point sur X', '', now), ...over });
const yaml = (relative: string) => Bun.YAML.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as Record<string, unknown>;
const systemInputs = (name: string) => yaml(`../${name}/${name}.yaml`).inputs as Record<string, unknown>;
const claim = (over: Partial<ClaimOutput> = {}): ClaimOutput => ({
  path: 'work',
  id: '20261016150000-abcd',
  run: 'run-1',
  workflow: 'pipeline',
  task: 't',
  context: '',
  revision: 2,
  note: '',
  ...over,
});
const workflows = Object.keys(BOARD_WORKFLOWS) as BoardWorkflow[];
const held: HoldOutput = { held: true, status: 'picked_up', by: 'run-1' };
/** Applique des opérations `set` / `append` comme `archon state patch` (chemins à un niveau). */
const apply = (it: BoardItem, ops: BoardOp[]): BoardItem => {
  const next = structuredClone(it) as unknown as Record<string, unknown>;
  for (const { op, path, value } of ops) {
    const key = path.slice(1);
    next[key] = op === 'append' ? [...((next[key] as unknown[] | undefined) ?? []), value] : value;
  }
  return next as unknown as BoardItem;
};

describe('board', () => {
  test('un id est triable et unique par suffixe', () => {
    expect(newItemId(now, 0)).toBe('20261016150000-0000');
    expect(newItemId(now, 0.5)).not.toBe(newItemId(now, 0.25));
  });

  test('reconnaît un item et ignore le reste', () => {
    expect(isBoardItem(newItem('a', 't', '', now))).toBe(true);
    expect(isBoardItem({ foo: 1 })).toBe(false);
    expect(isBoardItem(null)).toBe(false);
    expect(isBoardItem({ ...newItem('a', 't', '', now), workflow: 3 })).toBe(false);
  });

  test('prend les NEW du plus ancien au plus récent', () => {
    const order = pickOrder([
      doc('board/c', 'new', '2026-10-16T12:00:00Z'),
      doc('board/a', 'done', '2026-10-16T10:00:00Z'),
      doc('board/b', 'new', '2026-10-16T11:00:00Z'),
      doc('board/d', 'picked_up', '2026-10-16T09:00:00Z'),
    ]).map((d) => d.name);
    expect(order).toEqual(['board/b', 'board/c']);
  });

  test('les opérations de prise et de clôture', () => {
    expect(pickOps('run-1', now)).toEqual([
      { op: 'set', path: '/status', value: 'picked_up' },
      { op: 'set', path: '/picked', value: { run: 'run-1', at: '2026-10-16T15:00:00.000Z' } },
    ]);
    expect(closeOps(false, { ok: false }, 's', now)[0]).toEqual({ op: 'set', path: '/status', value: 'failed' });
    expect(closeOps(true, { ok: true }, 's', now)).toEqual([
      { op: 'set', path: '/status', value: 'done' },
      { op: 'set', path: '/result', value: { ok: true } },
      { op: 'set', path: '/summary', value: 's' },
      { op: 'set', path: '/finished', value: '2026-10-16T15:00:00.000Z' },
    ]);
  });
});

describe('routage', () => {
  test('une carte neuve porte son système et sa provenance ; un ancien item va au pipeline', () => {
    const fresh = newItem('a', 't', '', now);
    expect([fresh.workflow, fresh.source]).toEqual(['pipeline', 'manuel']);
    expect(newItem('a', 't', '', now, 'research-report', 'telegram')).toMatchObject({ workflow: 'research-report', source: 'telegram' });
    const { workflow: _w, source: _s, ...old } = fresh;
    expect(itemWorkflow(old as BoardItem)).toBe('pipeline');
    expect(cardInputs(old as BoardItem).workflow).toBe('pipeline');
  });

  test('add : la tâche, puis --context / --workflow / --source sous les deux formes', () => {
    expect(parseAddArgs(['Faire X'])).toEqual({ task: 'Faire X', context: '', workflow: 'pipeline', source: 'manuel' });
    expect(parseAddArgs(['Faire X', '--workflow=research-report', '--source=telegram', '--context', 'c'])).toEqual({
      task: 'Faire X',
      context: 'c',
      workflow: 'research-report',
      source: 'telegram',
    });
    expect(parseAddArgs(['--workflow', 'feature-build', 'Faire X', '--context=a=b'])).toMatchObject({ workflow: 'feature-build', context: 'a=b' });
  });

  test('add : refuse un appel mal formé, dont la forme v0 `add <workflow> "<titre>"`', () => {
    const error = (args: string[]) => (parseAddArgs(args) as { error?: string }).error;
    expect(error([])).toBe('add needs the task text');
    expect(error(['pipeline', 'Faire X'])).toContain('--workflow=<name>');
    expect(error(['  '])).toBe('the task text is empty');
    expect(error(['X', '--foo=1'])).toBe('unknown option --foo');
    expect(error(['X', '--context'])).toBe('--context needs a value');
    expect(error(['X', '--source='])).toBe('--source is empty');
    expect(error(['X', '--workflow=a', '--workflow=b'])).toBe('--workflow given twice');
  });

  test('chaque système autorisé accepte une carte, d’après les `inputs:` de son YAML', () => {
    for (const name of workflows) expect(routeProblem(name, systemInputs(name))).toBeNull();
  });

  test('feature-build vise CE dépôt : ses tests, son lint, sa branche, et une entrée fixée doit exister', () => {
    expect(routeOf('feature-build').fixed).toEqual({ test_cmd: 'bash scripts/gates.sh', lint_cmd: 'bun scripts/gates/validate.ts', base: 'master' });
    const { base: _b, ...noBase } = systemInputs('feature-build');
    expect(routeProblem('feature-build', noBase)).toContain('declares no input base');
  });

  test('un système en worktree exige un remote `origin`', () => {
    expect(worktreeProblem('feature-build', false)).toContain('has no "origin" remote: run feature-build by hand');
    expect(worktreeProblem('feature-build', true)).toBeNull();
    expect(worktreeProblem('pipeline', false)).toBeNull();
  });

  test('refuse un système hors liste, en nommant la liste', () => {
    expect(routeProblem('veille-fiche', undefined)).toBe(
      'Unknown workflow "veille-fiche": the board routes only pipeline, research-report, feature-build, design-variants.',
    );
    expect(routeProblem('__proto__', {})).toContain('Unknown workflow');
  });

  test('refuse un système dont une entrée obligatoire ne vient pas d’une carte', () => {
    const inputs = { ...systemInputs('feature-build'), repo: { required: true, description: 'x' } };
    expect(routeProblem('feature-build', inputs)).toBe(
      'Workflow "feature-build" requires input(s) repo, which a board card (a task and a context) cannot fill: run it by hand.',
    );
    expect(routeProblem('pipeline', { task: { required: true } })).toContain('declares no input context');
  });

  test('le contexte va à l’entrée `context`, ou à la fin de la tâche quand le système n’en a pas', () => {
    expect(cardInputs(item({ workflow: 'research-report', context: 'c' }))).toEqual({ workflow: 'research-report', task: 'Faire le point sur X', context: 'c' });
    expect(cardInputs(item({ workflow: 'feature-build', context: 'c' }))).toEqual({
      workflow: 'feature-build',
      task: 'Faire le point sur X\n\nContext:\nc',
      context: '',
    });
    expect(cardInputs(item({ workflow: 'design-variants' })).task).toBe('Faire le point sur X');
  });

  test('board-listener.yaml : un nœud run_<système> par entrée autorisée, gardé par `hold`, aux bonnes entrées, lu par outcome', () => {
    const nodes = yaml('../board-listener/board-listener.yaml').nodes as Record<string, unknown>[];
    const byId = (id: string) => nodes.find((n) => n.id === id) as Record<string, unknown> & { depends_on: string[]; with: Record<string, unknown> };
    const subruns = nodes.filter((n) => 'workflow' in n);
    expect(subruns.map((n) => n.workflow).sort()).toEqual([...workflows].sort());
    const outcome = byId('outcome');
    for (const name of workflows) {
      const route = routeOf(name);
      const node = subruns.find((n) => n.workflow === name)!;
      expect(node.id).toBe(runNodeId(name));
      expect(node.when).toBe(`$hold.output.held == true && $claim.output.workflow == '${name}'`);
      expect(node.depends_on).toEqual(['claim', 'hold']);
      expect(node.isolation).toBe(route.isolation);
      const expected: Record<string, string> = { [route.task]: '$claim.output.task', ...route.fixed };
      if (route.context !== null) expected[route.context] = '$claim.output.context';
      expect(node.with).toEqual(expected);
      expect(outcome.depends_on).toContain(runNodeId(name));
      expect(outcome.with[name.replaceAll('-', '_')]).toEqual({ from: `$${runNodeId(name)}.output`, if_skipped: null });
    }
    // La garde est rejouée à chaque reprise ; claim, non.
    expect(byId('hold')).toMatchObject({ always_run: true, depends_on: ['claim'], with: { claim: { from: '$claim.output' } } });
    expect(byId('claim').always_run).toBeUndefined();
    expect(outcome.with.hold).toEqual({ from: '$hold.output' });
    // Le relais d'outcome : règle par défaut, donc sauté (pas en échec) quand outcome échoue.
    expect(byId('outcome_result')).toMatchObject({ depends_on: ['outcome'], with: { outcome: '$outcome.output' } });
    expect(byId('outcome_result').trigger_rule).toBeUndefined();
    const settle = byId('settle');
    expect(settle.trigger_rule).toBe('all_done');
    expect(settle.with).toEqual({ claim: { from: '$claim.output' }, outcome: { from: '$outcome_result.output', if_skipped: null } });
    expect(settle.depends_on).toEqual(expect.arrayContaining(['claim', 'hold', 'outcome', 'outcome_result', 'close', ...workflows.map(runNodeId)]));
  });
});

describe('le dossier partagé (claim)', () => {
  const runs = (over: Partial<ActiveRun>[]): ActiveRun[] =>
    over.map((o, i) => ({ id: `r-${i}`, workflow_name: 'x', status: 'running', working_path: '/p', parent_run_id: null, started_at: `2026-10-16T1${i}:00:00Z`, ...o }));

  test('seul un sous-run qui modifie le dossier, hors worktree, en prend le verrou', () => {
    expect(takesFolderLock('pipeline', { name: 'pipeline' })).toBe(true);
    expect(takesFolderLock('pipeline', null)).toBe(true);
    expect(takesFolderLock('pipeline', { mutates_checkout: false })).toBe(false);
    expect(takesFolderLock('feature-build', {})).toBe(false);
    // Aucun système du tableau ne prend le verrou (`mutates_checkout: false` en tête, ou son
    // propre worktree) : un sous-run à verrou serait annulé au départ si un autre run tient le
    // dossier, et à sa reprise après le go si un run y a démarré entre-temps (le go perdu).
    for (const name of workflows) expect([name, takesFolderLock(name, yaml(`../${name}/${name}.yaml`))]).toEqual([name, false]);
    // Le workflow d'un run : verrou sauf `mutates_checkout: false` en tête ; introuvable = verrou.
    expect(workflowTakesLock({ mutates_checkout: false })).toBe(false);
    expect(workflowTakesLock({ mutates_checkout: 'false' })).toBe(true);
    expect(workflowTakesLock(null)).toBe(true);
    expect(workflowTakesLock(yaml('../board-listener/board-listener.yaml'))).toBe(false);
  });

  test('les autres runs actifs du même dossier, du plus ancien au plus récent, sans ce run ni ses ancêtres', () => {
    const list = runs([
      { id: 'self', parent_run_id: 'parent' },
      { id: 'parent', status: 'paused' },
      { id: 'elsewhere', working_path: '/q' },
      { id: 'done', status: 'completed' },
      { id: 'career', workflow_name: 'career-listener', status: 'paused' },
      { id: 'manual', status: 'running' },
    ]);
    expect(folderRuns(list, 'self', '/cwd').map((r) => r.id)).toEqual(['career', 'manual']);
    expect(folderRuns(runs([{ id: 'self' }, { id: 'p', working_path: '/q' }]), 'self', '/cwd')).toEqual([]);
    // Ce run absent de la liste : son dossier est celui du script.
    expect(folderRuns(runs([{ id: 'other', working_path: '/cwd' }]), 'self', '/cwd').map((r) => r.id)).toEqual(['other']);
  });

  test('la garde : un sous-run à verrou attend tout run du dossier ; un run à verrou retient toutes les cartes', () => {
    const [free, locker] = runs([
      { id: 'free', workflow_name: 'career-listener', status: 'paused' },
      { id: 'locker', workflow_name: 'holder', status: 'paused' },
    ]) as [ActiveRun, ActiveRun];
    const lockOf = (name: string) => name === 'holder';
    // Personne d'autre dans le dossier : rien n'attend.
    expect(folderWait([], true, lockOf)).toBeNull();
    // Un run sans verrou : seule la carte dont le sous-run prendrait le verrou attend (départ).
    expect(folderWait([free], true, lockOf)).toEqual({ holder: free, why: 'start' });
    expect(folderWait([free], false, lockOf)).toBeNull();
    // Un run à verrou, même plus récent : toutes les cartes attendent (sa reprise serait annulée).
    expect(folderWait([free, locker], false, lockOf)).toEqual({ holder: locker, why: 'resume' });
    expect(folderWait([free, locker], true, lockOf)).toEqual({ holder: locker, why: 'resume' });
    const start = waitingNote(['a', 'b'], { holder: free, why: 'start' });
    expect(start).toContain('2 card(s) left NEW (a, b): run free (career-listener, paused) works in this folder');
    expect(start).toContain('cancel their sub-run at start ("This worktree is in use")');
    const resume = waitingNote(['a'], { holder: locker, why: 'resume' });
    expect(resume).toContain("run locker (holder, paused) takes this folder's lock");
    expect(resume).toContain('Archon would cancel that run when it resumes');
    expect(resume).toContain('a go already given to it would be lost');
  });
});

describe('la garde (hold) et la reprise d’un run', () => {
  const picked = item({ status: 'picked_up', picked: { run: 'run-1', at: '2026-10-16T14:00:00.000Z' } });

  test('passe tant que ce run tient la carte, sans écrire', () => {
    expect(holdDecision(picked, claim(), now)).toMatchObject({ output: held, ops: null });
  });

  test('ne lance rien pour une carte remise en file, close à la main, prise par un autre run ou absente', () => {
    const out = (it: BoardItem | null) => holdDecision(it, claim(), now);
    expect(out(item())).toMatchObject({ output: { held: false, status: 'new', by: '' }, ops: null });
    expect(out({ ...picked, picked: { run: 'run-2', at: 'x' } }).output).toEqual({ held: false, status: 'picked_up', by: 'run-2' });
    expect(out({ ...picked, status: 'done' }).output.held).toBe(false);
    expect(out(null).output).toEqual({ held: false, status: 'missing', by: '' });
  });

  test('défaut 2 : un run qui a échoué puis repris reprend la carte que SON settle a close, et close écrit', () => {
    const settled = apply(picked, settleOps(picked, claim(), null, 'run_pipeline: Sub-run \'pipeline\' failed', now)!.ops);
    expect(settled.status).toBe('failed');
    expect(closeProblem(settled, claim())).toContain('is failed');
    const back = holdDecision(settled, claim(), now);
    // Même sortie qu'au premier passage : Archon garde en cache un sous-run déjà terminé.
    expect(back.output).toEqual(holdDecision(picked, claim(), now).output);
    const retaken = apply(settled, back.ops!);
    expect(retaken).toMatchObject({ status: 'picked_up', picked: { run: 'run-1' }, result: null, summary: null, finished: null });
    expect(retaken.history!.map((h) => h.action)).toEqual(['settle', 'resume']);
    expect(closeProblem(retaken, claim())).toBeNull();
    // Un autre run repris ne reprend pas une carte que ce run a close.
    expect(holdDecision(settled, claim({ run: 'run-2' }), now).output.held).toBe(false);
  });

  test('défaut 2 : après le settle, une carte remise en file ou close à la main n’est pas reprise', () => {
    const settled = apply(picked, settleOps(picked, claim(), null, null, now)!.ops);
    const requeued = apply(settled, (manualOps(settled, 'requeue', now) as { ops: BoardOp[] }).ops);
    expect(holdDecision(requeued, claim(), now)).toMatchObject({ output: { held: false, status: 'new' }, ops: null });
    const doneByHand = apply(settled, (manualOps(settled, 'done', now) as { ops: BoardOp[] }).ops);
    expect(holdDecision(doneByHand, claim(), now).output.held).toBe(false);
  });
});

describe('issue et clôture', () => {
  test('idle : rien à écrire', () => {
    expect(closeOutcome(null, null, {})).toMatchObject({ ok: true, path: 'idle' });
    expect(closeOutcome(claim({ path: 'idle', id: '', workflow: '' }), NOT_HELD, {})).toMatchObject({ ok: true, path: 'idle' });
  });

  test('waiting : des cartes attendent le dossier, la note le dit', () => {
    expect(closeOutcome(claim({ path: 'waiting', id: '', workflow: '', note: 'n' }), NOT_HELD, {})).toEqual({
      ok: true,
      path: 'waiting',
      id: '',
      workflow: '',
      summary: 'n',
      result: null,
    });
  });

  test('released : la garde a trouvé la carte ailleurs, rien n’a tourné, rien ne s’écrit', () => {
    const results = { pipeline: { ok: true, summary: 'cached' } };
    expect(closeOutcome(claim(), { held: false, status: 'picked_up', by: 'run-2' }, results)).toEqual({
      ok: true,
      path: 'released',
      id: '20261016150000-abcd',
      workflow: 'pipeline',
      summary: 'Task 20261016150000-abcd (pipeline): no longer held by run run-1 (now picked_up by run run-2); nothing ran, nothing written.',
      result: null,
    });
    expect(closeOutcome(claim(), { held: false, status: 'new', by: '' }, {}).summary).toContain('(now new)');
    expect(closeOutcome(claim(), null, {}).summary).toContain('(now unknown)');
  });

  test('lit la sortie du système demandé, pas une autre', () => {
    const results = {
      pipeline: null,
      'research-report': { ok: true, stage: 'done', summary: 'approved' },
      'feature-build': { ok: false, stage: 'implement', summary: 'red' },
    };
    expect(closeOutcome(claim({ workflow: 'research-report' }), held, results)).toEqual({
      ok: true,
      path: 'done',
      id: '20261016150000-abcd',
      workflow: 'research-report',
      summary: 'Task 20261016150000-abcd (research-report / done): approved',
      result: results['research-report'],
    });
    expect(closeOutcome(claim({ workflow: 'feature-build' }), held, results)).toMatchObject({ ok: false, path: 'failed' });
  });

  test('un système sans `stage` (design-variants), un résultat absent, un système hors liste : FAILED dit', () => {
    expect(closeOutcome(claim({ workflow: 'design-variants' }), held, { 'design-variants': { ok: false, chosen: null, summary: 'none kept' } }).summary).toBe(
      'Task 20261016150000-abcd (design-variants): none kept',
    );
    expect(closeOutcome(claim(), held, { pipeline: null })).toMatchObject({ ok: false, path: 'failed', summary: 'Task 20261016150000-abcd: the pipeline sub-run produced no result.' });
    expect(closeOutcome(claim({ workflow: 'veille-fiche' }), held, {})).toMatchObject({ ok: false, path: 'failed', result: null });
  });

  test('close n’écrit que sur une carte encore prise par ce run', () => {
    const picked = item({ status: 'picked_up', picked: { run: 'run-1', at: 'x' } });
    expect(closeProblem(picked, claim())).toBeNull();
    expect(closeProblem({ ...picked, picked: { run: 'run-2', at: 'x' } }, claim())).toBe(
      'board/20261016150000-abcd is picked_up by run run-2: it was closed, requeued or taken by another run since run run-1 claimed it. Left as is.',
    );
    expect(closeProblem(item(), claim())).toContain('is new');
    expect(closeProblem(null, claim())).toContain('is missing');
  });
});

describe('le filet (settle)', () => {
  const picked = item({ status: 'picked_up', picked: { run: 'run-1', at: '2026-10-16T14:00:00.000Z' } });
  const outcome = (over: Partial<BoardOutcome> = {}): BoardOutcome => ({
    ok: true,
    path: 'done',
    id: '20261016150000-abcd',
    workflow: 'pipeline',
    summary: 'Task 20261016150000-abcd (pipeline / done): approved',
    result: { ok: true, stage: 'done' },
    ...over,
  });

  test('sans issue : FAILED, avec la cause lue dans le run, sans accuser un refus humain', () => {
    const settled = settleOps(picked, claim(), null, "run_pipeline: Sub-run 'pipeline' was cancelled", now)!;
    expect(settled.status).toBe('failed');
    expect(settled.ops.slice(0, 4).map((o) => [o.path, o.value])).toEqual([
      ['/status', 'failed'],
      ['/result', null],
      ['/summary', settled.summary],
      ['/finished', '2026-10-16T15:00:00.000Z'],
    ]);
    expect(settled.summary).toStartWith("Task 20261016150000-abcd (pipeline): no result from the pipeline sub-run (run_pipeline: Sub-run 'pipeline' was cancelled).");
    expect(settled.summary).toContain('Archon before it started: folder in use by another run, worktree not created');
    expect(settled.summary).toContain('`archon workflow get run-1 --verbose`');
    // Reprendre l'écouteur d'abord (le MÊME sous-run, là où il a échoué), recommencer ensuite.
    expect(settled.summary).toContain('`archon workflow resume run-1` takes the SAME sub-run up where it failed');
    expect(settled.summary).toContain('a cancelled sub-run is only read again, and the card fails again');
    expect(settled.summary.indexOf('archon workflow resume')).toBeLessThan(settled.summary.indexOf('board.ts requeue 20261016150000-abcd'));
    expect(settled.ops[4]).toMatchObject({
      op: 'append',
      path: '/history',
      value: { action: 'settle', from: 'picked_up', picked: picked.picked, reason: "run_pipeline: Sub-run 'pipeline' was cancelled" },
    });
    expect(settleOps(picked, claim(), null, null, now)!.summary).toContain('no result from the pipeline sub-run. It failed');
  });

  test('défaut 6 : le sous-run a rendu une issue mais close a échoué : settle écrit CETTE issue, pas « requeue »', () => {
    const done = settleOps(picked, claim(), outcome(), 'close: archon state patch failed with exit 1', now)!;
    expect(done.status).toBe('done');
    expect(done.ops.slice(0, 3).map((o) => o.value)).toEqual(['done', { ok: true, stage: 'done' }, done.summary]);
    expect(done.summary).toBe(
      'Task 20261016150000-abcd (pipeline / done): approved [recorded by settle: close did not write it (close: archon state patch failed with exit 1)]',
    );
    expect(done.summary).not.toContain('requeue');
    expect(settleOps(picked, claim(), outcome({ ok: false, path: 'failed' }), null, now)!.status).toBe('failed');
    // Une issue `released` ou d'une autre carte n'en est pas une.
    expect(settleOps(picked, claim(), outcome({ path: 'released', ok: true }), null, now)!.summary).toContain('no result');
    expect(settleOps(picked, claim(), outcome({ id: 'autre' }), null, now)!.status).toBe('failed');
  });

  test('ne touche pas une carte close, remise en file, prise par un autre run, ou absente', () => {
    expect(settleOps(picked, claim({ run: 'run-2' }), null, null, now)).toBeNull();
    expect(settleOps({ ...picked, status: 'done' }, claim(), null, null, now)).toBeNull();
    expect(settleOps({ ...picked, status: 'new', picked: null }, claim(), null, null, now)).toBeNull();
    expect(settleOps(null, claim(), null, null, now)).toBeNull();
  });

  test('la cause : le premier nœud en échec dans l’ordre du graphe, une ligne bornée', () => {
    const nodes = [
      { nodeId: 'claim', state: 'completed' },
      { nodeId: 'outcome', state: 'failed', error: 'binding to failed node run_pipeline' },
      { nodeId: 'run_pipeline', state: 'failed', error: "Sub-run 'pipeline'\n was cancelled" },
      { nodeId: 'settle', state: 'running' },
    ];
    expect(failureReason(nodes)).toBe("run_pipeline: Sub-run 'pipeline' was cancelled");
    expect(failureReason([{ nodeId: 'close', state: 'failed', error: 'x'.repeat(500) }])!.length).toBeLessThan(260);
    expect(failureReason([{ nodeId: 'hold', state: 'failed' }])).toBe('hold: failed');
    expect(failureReason([{ nodeId: 'claim', state: 'completed' }])).toBeNull();
    expect(failureReason(null)).toBeNull();
  });
});

describe('reprise à la main', () => {
  const picked = item({ status: 'picked_up', picked: { run: 'run-1', at: '2026-10-16T14:00:00.000Z' } });

  test('done / fail clôturent un item coincé et gardent la trace', () => {
    const done = manualOps(picked, 'done', now) as { ops: { path: string; value: unknown }[] };
    expect(done.ops.map((o) => [o.path, o.value]).slice(0, 3)).toEqual([
      ['/status', 'done'],
      ['/result', null],
      ['/summary', 'Closed by hand (board.ts done).'],
    ]);
    expect(done.ops.at(-1)).toMatchObject({ path: '/history', value: { action: 'done', from: 'picked_up', reason: null, picked: picked.picked } });
    const fail = manualOps(picked, 'fail', now, ' rejected at review ') as { ops: { path: string; value: unknown }[] };
    expect(fail.ops[0]!.value).toBe('failed');
    expect(fail.ops[2]!.value).toBe('Closed by hand (board.ts fail): rejected at review');
    expect(fail.ops.at(-1)!.value).toMatchObject({ action: 'fail', reason: 'rejected at review' });
  });

  test('requeue remet en NEW, à sa place, et garde l’échec dans l’historique', () => {
    const failed = item({ status: 'failed', picked: { run: 'run-1', at: 'x' }, result: { ok: false }, summary: 'red', finished: 'y' });
    const requeue = manualOps(failed, 'requeue', now) as { ops: { op: string; path: string; value: unknown }[] };
    expect(requeue.ops.slice(0, 5).map((o) => [o.path, o.value])).toEqual([
      ['/status', 'new'],
      ['/picked', null],
      ['/result', null],
      ['/summary', null],
      ['/finished', null],
    ]);
    expect(requeue.ops.some((o) => o.path === '/created')).toBe(false);
    expect(requeue.ops[5]).toMatchObject({ op: 'append', path: '/history', value: { action: 'requeue', from: 'failed', result: { ok: false }, summary: 'red' } });
    expect(manualOps(picked, 'requeue', now)).toHaveProperty('ops');
  });

  test('défaut 3 : une carte dont le run n’est pas fini ne se reprend pas sans --force', () => {
    for (const status of ['running', 'paused', 'pending']) {
      expect(liveRunProblem(picked, 'requeue', status)).toContain(`held by run run-1, which is ${status}`);
    }
    expect(liveRunProblem(picked, 'requeue', 'paused')).toContain('the card would run twice');
    expect(liveRunProblem(picked, 'fail', 'paused')).not.toContain('twice');
    expect(liveRunProblem(picked, 'done', null)).toContain('unknown state');
    for (const status of ['completed', 'failed', 'cancelled']) expect(liveRunProblem(picked, 'requeue', status)).toBeNull();
    expect(liveRunProblem(item(), 'done', 'running')).toBeNull();
    const failedByRun = item({ status: 'failed', picked: { run: 'run-1', at: 'x' } });
    expect(liveRunProblem(failedByRun, 'requeue', 'running')).toContain('held by run run-1');
  });

  test('les arguments d’une reprise : <id>, raison pour fail, --force n’importe où', () => {
    expect(parseManualArgs('requeue', ['a', '--force'])).toEqual({ id: 'a', reason: '', force: true });
    expect(parseManualArgs('fail', ['--force', 'a', 'rejected', 'at', 'review'])).toEqual({ id: 'a', reason: 'rejected at review', force: true });
    expect(parseManualArgs('done', ['a'])).toEqual({ id: 'a', reason: '', force: false });
    expect(parseManualArgs('requeue', ['a', 'b'])).toEqual({ error: 'requeue takes one <id>' });
    expect(parseManualArgs('requeue', ['--forse', 'a'])).toEqual({ error: 'unknown option --forse' });
    expect(parseManualArgs('done', ['--force'])).toEqual({ error: 'missing <id>' });
  });

  test('refuse les transitions qui n’ont pas de sens', () => {
    const error = (status: BoardItem['status'], action: 'done' | 'fail' | 'requeue') => (manualOps(item({ status }), action, now) as { error?: string }).error;
    expect(error('done', 'done')).toBe('board/20261016150000-abcd is done; `done` applies only to new | picked_up | failed items.');
    expect(error('done', 'fail')).toContain('applies only to new | picked_up');
    expect(error('failed', 'fail')).toBeDefined();
    expect(error('new', 'requeue')).toContain('applies only to picked_up | failed');
    expect(error('done', 'requeue')).toBeDefined();
    expect(error('new', 'done')).toBeUndefined();
    expect(error('failed', 'done')).toBeUndefined();
  });
});
