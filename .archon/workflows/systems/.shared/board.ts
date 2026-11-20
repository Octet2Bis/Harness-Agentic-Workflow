/**
 * Le tableau de tâches du reel (NEW → PICKED UP → DONE | FAILED), sous forme de documents
 * d'état `board/<id>`. Pure : ce fichier ne lit ni n'écrit l'état, il définit la forme des
 * documents, la liste des systèmes qu'une carte peut demander, et les décisions qu'un script
 * prend dessus (prise, garde, issue, clôture, filet, reprise à la main), pour qu'elles se
 * testent à l'unité.
 */

export type BoardStatus = 'new' | 'picked_up' | 'done' | 'failed';

export interface BoardHistoryEntry {
  /** `resume` : un run repris après échec (`archon workflow resume`) reprend la carte que son `settle` avait close. */
  action: ManualAction | 'settle' | 'resume';
  from: BoardStatus;
  at: string;
  reason: string | null;
  picked: { run: string; at: string } | null;
  result: unknown;
  summary: string | null;
  finished: string | null;
}

export interface BoardItem {
  id: string;
  task: string;
  context: string;
  /** Le système à lancer. Absent sur les items d'avant le routage : `pipeline`. */
  workflow?: string;
  /** D'où vient la carte (`manuel`, `telegram`, `slack`…). Absent sur les anciens items. */
  source?: string;
  status: BoardStatus;
  created: string;
  picked: { run: string; at: string } | null;
  result: unknown;
  /** Une phrase sur l'issue, écrite à la clôture. Absent sur les anciens items. */
  summary?: string | null;
  finished: string | null;
  /** Les reprises (à la main, par `settle`, par un run repris) : ce que l'item était avant. */
  history?: BoardHistoryEntry[];
}

export interface BoardDoc {
  name: string;
  revision: number;
  value: BoardItem;
}

export interface BoardOp {
  op: 'set' | 'append';
  path: string;
  value: unknown;
}

export const BOARD_PREFIX = 'board/';

// ── Routage ─────────────────────────────────────────────────────────────────────────

interface Route {
  /** L'entrée (`inputs:` du YAML du système) qui reçoit la tâche. */
  task: string;
  /** Celle qui reçoit le contexte, ou `null` : le contexte est alors ajouté à la fin de la tâche. */
  context: string | null;
  /** `worktree` : le sous-run a son propre worktree (board-listener.yaml), coupé de `origin`. */
  isolation?: 'worktree';
  /** Des entrées fixées par le tableau : une carte vise toujours CE dépôt. */
  fixed?: Record<string, string>;
}

/**
 * Les systèmes qu'une carte peut demander : LA liste d'autorisation du tableau, avec ce que la
 * carte remplit. `board.ts add` refuse tout autre nom ; board-listener.yaml a un nœud
 * `run_<nom>` par entrée, avec ces entrées et cette isolation, et `outcome` les lit tous
 * (board.test.ts vérifie les deux contre les YAML).
 *
 * `feature-build` modifie un dépôt : son sous-run travaille dans un worktree de CE dépôt, coupé
 * de `origin/<branche par défaut>` (Archon), jamais dans le dossier de l'écouteur. Ses défauts
 * (`npm test`, `main`) ne valent pas ici : les tests sont les portes du dépôt.
 */
export const BOARD_WORKFLOWS = {
  pipeline: { task: 'task', context: 'context' },
  'research-report': { task: 'task', context: 'context' },
  'feature-build': {
    task: 'request',
    context: null,
    isolation: 'worktree',
    fixed: { test_cmd: 'bash scripts/gates.sh', lint_cmd: 'bun scripts/gates/validate.ts', base: 'master' },
  },
  'design-variants': { task: 'brief', context: null },
} as const satisfies Record<string, Route>;

export type BoardWorkflow = keyof typeof BOARD_WORKFLOWS;
export const DEFAULT_WORKFLOW: BoardWorkflow = 'pipeline';
export const DEFAULT_SOURCE = 'manuel';

export function isBoardWorkflow(name: string): name is BoardWorkflow {
  return Object.hasOwn(BOARD_WORKFLOWS, name);
}

/** La route d'un système autorisé, sous sa forme générale. */
export function routeOf(workflow: BoardWorkflow): Route {
  return BOARD_WORKFLOWS[workflow];
}

/** L'id du nœud `workflow:` de board-listener.yaml qui lance ce système. */
export function runNodeId(workflow: BoardWorkflow): string {
  return `run_${workflow.replaceAll('-', '_')}`;
}

/** Le système d'un item ; un item d'avant le routage (sans `workflow`) va au pipeline. */
export function itemWorkflow(item: Pick<BoardItem, 'workflow'>): string {
  return item.workflow ?? DEFAULT_WORKFLOW;
}

/**
 * Pourquoi une carte ne peut pas aller à ce système, ou null. `inputs` est la section
 * `inputs:` du YAML du système : chaque entrée obligatoire doit être celle de la tâche, du
 * contexte, ou une entrée fixée par le tableau.
 */
export function routeProblem(workflow: string, inputs: Record<string, unknown> | undefined): string | null {
  const allowed = Object.keys(BOARD_WORKFLOWS).join(', ');
  if (!isBoardWorkflow(workflow)) return `Unknown workflow "${workflow}": the board routes only ${allowed}.`;
  const route = routeOf(workflow);
  const declared = inputs ?? {};
  const mapped: string[] = [route.task, ...(route.context === null ? [] : [route.context]), ...Object.keys(route.fixed ?? {})];
  const undeclared = mapped.filter((name) => !Object.hasOwn(declared, name));
  if (undeclared.length > 0) {
    return `Workflow "${workflow}" declares no input ${undeclared.join(', ')}: the board's mapping (BOARD_WORKFLOWS in systems/.shared/board.ts) is out of date.`;
  }
  const unfillable = Object.entries(declared)
    .filter(([name, spec]) => !mapped.includes(name) && (spec as { required?: unknown } | null)?.required === true)
    .map(([name]) => name);
  if (unfillable.length > 0) {
    return `Workflow "${workflow}" requires input(s) ${unfillable.join(', ')}, which a board card (a task and a context) cannot fill: run it by hand.`;
  }
  return null;
}

/**
 * Pourquoi ce dépôt ne peut pas accueillir une carte de ce système, ou null : un sous-run en
 * `isolation: worktree` est coupé de `origin/<branche>` ; sans remote `origin`, Archon ne crée
 * pas son worktree et le nœud échoue avant d'avoir rien fait.
 */
export function worktreeProblem(workflow: BoardWorkflow, hasOrigin: boolean): string | null {
  if (routeOf(workflow).isolation !== 'worktree' || hasOrigin) return null;
  return `Workflow "${workflow}" runs in its own worktree, cut from origin/<default branch> of this repository, and this repository has no "origin" remote: run ${workflow} by hand.`;
}

/**
 * Ce que `claim` transmet au sous-run : la tâche et le contexte, sauf pour un système sans
 * entrée de contexte, où un contexte non vide est ajouté à la fin de la tâche.
 */
export function cardInputs(item: BoardItem): { workflow: string; task: string; context: string } {
  const workflow = itemWorkflow(item);
  const context = item.context ?? '';
  if (isBoardWorkflow(workflow) && routeOf(workflow).context === null) {
    return { workflow, task: context.trim() === '' ? item.task : `${item.task}\n\nContext:\n${context}`, context: '' };
  }
  return { workflow, task: item.task, context };
}

// ── Ajout ───────────────────────────────────────────────────────────────────────────

/** Un identifiant lisible et triable : horodatage compact + suffixe aléatoire. */
export function newItemId(now: Date, random: number): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const suffix = Math.floor(random * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${stamp}-${suffix}`;
}

export function newItem(
  id: string,
  task: string,
  context: string,
  now: Date,
  workflow: string = DEFAULT_WORKFLOW,
  source: string = DEFAULT_SOURCE,
): BoardItem {
  return {
    id,
    task,
    context,
    workflow,
    source,
    status: 'new',
    created: now.toISOString(),
    picked: null,
    result: null,
    summary: null,
    finished: null,
  };
}

export interface AddRequest {
  task: string;
  context: string;
  workflow: string;
  source: string;
}

/**
 * Les arguments de `board.ts add` : une tâche, puis `--context`, `--workflow`, `--source`
 * (forme `--x=valeur` ou `--x valeur`). Ne valide pas le nom du système : `routeProblem`.
 */
export function parseAddArgs(args: string[]): AddRequest | { error: string } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!['context', 'workflow', 'source'].includes(name)) return { error: `unknown option --${name}` };
    if (Object.hasOwn(flags, name)) return { error: `--${name} given twice` };
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined) return { error: `--${name} needs a value` };
    flags[name] = value;
  }
  if (positional.length !== 1) {
    return {
      error:
        positional.length === 0
          ? 'add needs the task text'
          : `add takes one task text, got ${positional.length} (quote the task; name the system with --workflow=<name>)`,
    };
  }
  const task = positional[0]!;
  if (task.trim() === '') return { error: 'the task text is empty' };
  const workflow = flags.workflow ?? DEFAULT_WORKFLOW;
  const source = flags.source ?? DEFAULT_SOURCE;
  if (workflow.trim() === '') return { error: '--workflow is empty' };
  if (source.trim() === '') return { error: '--source is empty' };
  return { task, context: flags.context ?? '', workflow, source };
}

/** Un document est un item du tableau s'il a la forme attendue ; le reste est ignoré. */
export function isBoardItem(value: unknown): value is BoardItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.task === 'string' &&
    typeof item.status === 'string' &&
    typeof item.created === 'string' &&
    (item.workflow === undefined || typeof item.workflow === 'string')
  );
}

// ── Le dossier partagé (prise) ──────────────────────────────────────────────────────

/** Un run actif, tel que `archon workflow status --json` le liste (seuls ces champs sont lus). */
export interface ActiveRun {
  id: string;
  workflow_name: string;
  status: string;
  working_path: string | null;
  parent_run_id?: string | null;
  started_at?: string;
}

/**
 * Le YAML d'un workflow prend-il le verrou du dossier où il tourne ? Oui, sauf s'il déclare
 * `mutates_checkout: false` en tête (null, YAML illisible ou introuvable : verrou supposé).
 * Archon annule un tel run au départ, ET à chaque reprise (après un go humain, ou quand ses
 * sous-runs finissent : la reprise remet son heure de départ à maintenant), si un autre run
 * actif plus ancien travaille dans le même dossier (« This worktree is in use »).
 */
export function workflowTakesLock(doc: unknown): boolean {
  return !(typeof doc === 'object' && doc !== null && (doc as Record<string, unknown>).mutates_checkout === false);
}

/**
 * Le sous-run de ce système prend-il le verrou du dossier de l'écouteur ? Un sous-run dans
 * son propre worktree (`isolation: worktree`) n'y est pas soumis ; sinon, `workflowTakesLock`
 * sur le YAML du système (`systemDoc`).
 */
export function takesFolderLock(workflow: BoardWorkflow, systemDoc: unknown): boolean {
  if (routeOf(workflow).isolation === 'worktree') return false;
  return workflowTakesLock(systemDoc);
}

/**
 * Les autres runs `running` ou `paused` du dossier de ce run, du plus ancien au plus récent :
 * ni ce run ni ses ancêtres (Archon les exclut aussi). `fallbackPath` sert si ce run n'est pas
 * dans la liste.
 */
export function folderRuns(runs: ActiveRun[], self: string, fallbackPath: string): ActiveRun[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const own = byId.get(self);
  const path = own?.working_path ?? fallbackPath;
  const mine = new Set<string>([self]);
  for (let parent = own?.parent_run_id ?? null; parent && !mine.has(parent); parent = byId.get(parent)?.parent_run_id ?? null) {
    mine.add(parent);
  }
  return runs
    .filter((r) => !mine.has(r.id) && r.working_path === path && (r.status === 'running' || r.status === 'paused'))
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? '') || a.id.localeCompare(b.id));
}

/** Pourquoi une carte reste NEW : le run qui la retient, et ce qu'Archon ferait sinon. */
export interface FolderWait {
  holder: ActiveRun;
  /**
   * `start` : son sous-run prendrait le verrou, et Archon l'annulerait au départ ;
   * `resume` : `holder` prend lui-même le verrou, et Archon l'annulerait à sa reprise tant
   * qu'un run de l'écouteur attend un humain dans ce dossier (le go déjà donné serait perdu).
   */
  why: 'start' | 'resume';
}

/**
 * La garde de `claim`, pour une carte : `others` (folderRuns) sont les autres runs actifs du
 * dossier, `cardTakesLock` dit si le sous-run de la carte prendrait le verrou (takesFolderLock),
 * `runTakesLock` si le workflow d'un run le prend (workflowTakesLock sur son YAML). Un run du
 * dossier qui prend le verrou retient TOUTES les cartes : le sous-run d'une carte, même sans
 * verrou, peut attendre son humain des heures, et Archon annulerait ce run à sa reprise.
 */
export function folderWait(others: ActiveRun[], cardTakesLock: boolean, runTakesLock: (workflowName: string) => boolean): FolderWait | null {
  const locker = others.find((r) => runTakesLock(r.workflow_name));
  if (locker !== undefined) return { holder: locker, why: 'resume' };
  const first = others[0];
  return cardTakesLock && first !== undefined ? { holder: first, why: 'start' } : null;
}

/** La phrase d'un run qui laisse des cartes en file parce que le dossier est tenu. */
export function waitingNote(ids: string[], wait: FolderWait): string {
  const { holder } = wait;
  const cause =
    wait.why === 'start'
      ? 'works in this folder, and Archon would cancel their sub-run at start ("This worktree is in use").'
      : "takes this folder's lock: while a card waits here for its human, Archon would cancel that run when it resumes " +
        '("This worktree is in use"; a resumed run restarts its clock), and a go already given to it would be lost.';
  return `${ids.length} card(s) left NEW (${ids.join(', ')}): run ${holder.id} (${holder.workflow_name}, ${holder.status}) ${cause} They are taken once that run ends.`;
}

// ── Prise, garde et clôture par l'écouteur ──────────────────────────────────────────

/** Les items NEW, du plus ancien au plus récent : l'ordre dans lequel un run tente de les prendre. */
export function pickOrder(docs: BoardDoc[]): BoardDoc[] {
  return docs
    .filter((doc) => doc.value.status === 'new')
    .sort((a, b) => a.value.created.localeCompare(b.value.created) || a.name.localeCompare(b.name));
}

/** Les opérations qui marquent un item pris par un run. */
export function pickOps(run: string, now: Date): BoardOp[] {
  return [
    { op: 'set', path: '/status', value: 'picked_up' },
    { op: 'set', path: '/picked', value: { run, at: now.toISOString() } },
  ];
}

/** Les opérations qui clôturent un item : statut, issue typée du sous-run, phrase, date. */
export function closeOps(ok: boolean, result: unknown, summary: string, now: Date): BoardOp[] {
  return [
    { op: 'set', path: '/status', value: ok ? 'done' : 'failed' },
    { op: 'set', path: '/result', value: result },
    { op: 'set', path: '/summary', value: summary },
    { op: 'set', path: '/finished', value: now.toISOString() },
  ];
}

/** La sortie typée de `claim` (board-listener.yaml). */
export interface ClaimOutput {
  /** `waiting` : des cartes NEW attendent que le dossier se libère (`note` dit lesquelles et pourquoi). */
  path: 'idle' | 'waiting' | 'work';
  id: string;
  run: string;
  workflow: string;
  task: string;
  context: string;
  revision: number;
  note: string;
}

/** L'item est-il pris par ce run ? */
export function heldBy(item: BoardItem | null, run: string): boolean {
  return item !== null && item.status === 'picked_up' && item.picked?.run === run;
}

/** La sortie typée de `hold`. Stable d'une reprise à l'autre tant que la décision ne change pas. */
export interface HoldOutput {
  held: boolean;
  /** Le statut de la carte après la garde (`''` : rien n'a été pris). */
  status: string;
  /** Le run qui la tient (`''` : aucun). */
  by: string;
}

/** Ce que rend `hold` quand ce run n'a rien pris. */
export const NOT_HELD: HoldOutput = { held: false, status: '', by: '' };

/**
 * La garde d'avant le sous-run (`hold`, `always_run: true` : rejouée à chaque reprise du run,
 * alors que `claim`, déjà terminé, ne l'est pas). Ce run tient la carte, ou il la reprend si
 * c'est son propre `settle` qui l'a close en échec (le run a échoué, puis on l'a repris) ;
 * sinon (remise en file, close à la main, prise par un autre run, absente) il ne lance rien.
 * `ops` : l'écriture de la reprise, ou null.
 */
export function holdDecision(item: BoardItem | null, claim: Pick<ClaimOutput, 'run'>, now: Date): { output: HoldOutput; ops: BoardOp[] | null; note: string } {
  const held: HoldOutput = { held: true, status: 'picked_up', by: claim.run };
  if (heldBy(item, claim.run)) return { output: held, ops: null, note: 'held by this run' };
  const last = item?.history?.at(-1);
  if (item !== null && item.status === 'failed' && last?.action === 'settle' && last.picked?.run === claim.run) {
    return {
      output: held,
      ops: [
        { op: 'set', path: '/status', value: 'picked_up' },
        { op: 'set', path: '/picked', value: { run: claim.run, at: now.toISOString() } },
        { op: 'set', path: '/result', value: null },
        { op: 'set', path: '/summary', value: null },
        { op: 'set', path: '/finished', value: null },
        historyEntry(item, 'resume', now, 'listener run resumed after its settle'),
      ],
      note: 'taken back: this run settled it as failed, and has been resumed',
    };
  }
  const by = item?.status === 'picked_up' ? (item.picked?.run ?? '') : '';
  return { output: { held: false, status: item?.status ?? 'missing', by }, ops: null, note: 'not held by this run' };
}

/** La sortie typée de `outcome` : ce que `close` écrira. */
export interface BoardOutcome {
  ok: boolean;
  path: 'idle' | 'waiting' | 'released' | 'done' | 'failed';
  id: string;
  workflow: string;
  summary: string;
  result: Record<string, unknown> | null;
}

/**
 * L'issue d'une tâche prise, d'après la sortie du nœud `run_<système>` qui a tourné
 * (`results`, indexé par nom de système ; null pour un nœud sauté). Un sous-run en échec
 * n'arrive jamais ici : Archon ne laisse pas une liaison lire un nœud en échec, c'est
 * `settle` qui clôt alors la tâche. `released` : la garde a trouvé la carte à quelqu'un
 * d'autre, rien n'a tourné et rien ne sera écrit.
 */
export function closeOutcome(claim: ClaimOutput | null, hold: HoldOutput | null, results: Record<string, unknown>): BoardOutcome {
  if (claim === null || claim.path === 'idle') {
    return { ok: true, path: 'idle', id: '', workflow: '', summary: 'Nothing on the board.', result: null };
  }
  if (claim.path === 'waiting') {
    return { ok: true, path: 'waiting', id: '', workflow: '', summary: claim.note, result: null };
  }
  if (hold === null || !hold.held) {
    const now = hold === null || hold.status === '' ? 'unknown' : hold.by === '' ? hold.status : `${hold.status} by run ${hold.by}`;
    return {
      ok: true,
      path: 'released',
      id: claim.id,
      workflow: claim.workflow,
      summary: `Task ${claim.id} (${claim.workflow}): no longer held by run ${claim.run} (now ${now}); nothing ran, nothing written.`,
      result: null,
    };
  }
  const failed = (summary: string, result: Record<string, unknown> | null = null): BoardOutcome => ({
    ok: false,
    path: 'failed',
    id: claim.id,
    workflow: claim.workflow,
    summary,
    result,
  });
  if (!isBoardWorkflow(claim.workflow)) {
    return failed(
      `Task ${claim.id}: workflow "${claim.workflow}" is not on the board's allow-list (${Object.keys(BOARD_WORKFLOWS).join(', ')}); nothing ran.`,
    );
  }
  const raw = results[claim.workflow];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return failed(`Task ${claim.id}: the ${claim.workflow} sub-run produced no result.`);
  }
  const result = raw as Record<string, unknown>;
  const ok = result.ok === true;
  const stage = typeof result.stage === 'string' ? ` / ${result.stage}` : '';
  const said = typeof result.summary === 'string' && result.summary.trim() !== '' ? result.summary : 'no summary.';
  const summary = `Task ${claim.id} (${claim.workflow}${stage}): ${said}`;
  return ok ? { ok, path: 'done', id: claim.id, workflow: claim.workflow, summary, result } : failed(summary, result);
}

/**
 * Pourquoi `close` ne peut pas écrire l'issue, ou null. Il écrit tant que la carte est prise
 * par CE run (la garde l'a vérifié, ou reprise), par écriture conditionnelle sur la révision
 * qu'il vient de lire ; une carte remise en file, close à la main ou prise par un autre run
 * entre-temps reste comme elle est.
 */
export function closeProblem(item: BoardItem | null, claim: Pick<ClaimOutput, 'id' | 'run'>): string | null {
  if (heldBy(item, claim.run)) return null;
  const now = item === null ? 'missing' : item.status === 'picked_up' ? `picked_up by run ${item.picked?.run ?? '?'}` : item.status;
  return `${BOARD_PREFIX}${claim.id} is ${now}: it was closed, requeued or taken by another run since run ${claim.run} claimed it. Left as is.`;
}

function historyEntry(item: BoardItem, action: BoardHistoryEntry['action'], now: Date, reason: string | null): BoardOp {
  return {
    op: 'append',
    path: '/history',
    value: {
      action,
      from: item.status,
      at: now.toISOString(),
      reason,
      picked: item.picked ?? null,
      result: item.result ?? null,
      summary: item.summary ?? null,
      finished: item.finished ?? null,
    } satisfies BoardHistoryEntry,
  };
}

/** Un nœud du run, tel que `archon workflow get <run> --json --verbose` le résume (`nodes`). */
export interface RunNodeSummary {
  nodeId: string;
  state: string;
  error?: string;
}

/**
 * La première cause d'échec du run de l'écouteur, dans l'ordre du graphe (la garde, le
 * sous-run, l'issue, la clôture) : `run_pipeline: Sub-run 'pipeline' was cancelled`. Null si
 * aucun de ces nœuds n'a échoué ou si les nœuds sont illisibles.
 */
export function failureReason(nodes: unknown): string | null {
  if (!Array.isArray(nodes)) return null;
  const order = ['hold', ...(Object.keys(BOARD_WORKFLOWS) as BoardWorkflow[]).map(runNodeId), 'outcome', 'close'];
  const failed = (nodes as Partial<RunNodeSummary>[]).filter((n) => n?.state === 'failed' && typeof n.nodeId === 'string' && order.includes(n.nodeId));
  failed.sort((a, b) => order.indexOf(a.nodeId!) - order.indexOf(b.nodeId!));
  const first = failed[0];
  if (first === undefined) return null;
  const error = String(first.error ?? 'failed').replace(/\s+/g, ' ').trim();
  return `${first.nodeId}: ${error.length > 240 ? `${error.slice(0, 239)}…` : error}`;
}

/**
 * Le filet du dernier nœud (`settle`) : si la tâche est encore `picked_up` par CE run une fois
 * tout le reste terminé, `close` n'a rien écrit. Deux cas :
 * - le sous-run a rendu une issue (`outcome`, relayé ; `close` a échoué ensuite) : l'écrire,
 *   `done` ou `failed`, telle quelle ;
 * - pas d'issue : le sous-run a échoué, a été annulé (refus humain, ou Archon avant son départ :
 *   dossier tenu par un autre run, worktree impossible) ou n'est jamais parti : `failed`, avec
 *   la cause lue dans le run (`reason`, de `failureReason`) quand elle est lisible.
 * Une tâche close, remise en file, reprise par un autre run, ou absente : rien (null).
 */
export function settleOps(
  item: BoardItem | null,
  claim: Pick<ClaimOutput, 'id' | 'run' | 'workflow'>,
  outcome: BoardOutcome | null,
  reason: string | null,
  now: Date,
): { ops: BoardOp[]; summary: string; status: 'done' | 'failed' } | null {
  if (item === null || !heldBy(item, claim.run)) return null;
  const why = reason === null ? '' : ` (${reason})`;
  if (outcome !== null && (outcome.path === 'done' || outcome.path === 'failed') && outcome.id === claim.id) {
    const summary = `${outcome.summary} [recorded by settle: close did not write it${why}]`;
    return {
      ops: [...closeOps(outcome.ok, outcome.result, summary, now), historyEntry(item, 'settle', now, reason)],
      summary,
      status: outcome.ok ? 'done' : 'failed',
    };
  }
  const summary =
    `Task ${claim.id} (${claim.workflow}): no result from the ${claim.workflow} sub-run${why}. ` +
    'It failed, was cancelled (a human refusal, or Archon before it started: folder in use by another run, worktree not created), ' +
    `or never started. Details: \`archon workflow get ${claim.run} --verbose\`. Nothing was recorded. ` +
    `\`archon workflow resume ${claim.run}\` takes the SAME sub-run up where it failed (what follows the human go runs again without a new go; ` +
    'a cancelled sub-run is only read again, and the card fails again); ' +
    `\`board.ts requeue ${claim.id}\` starts the card over.`;
  return { ops: [...closeOps(false, item.result ?? null, summary, now), historyEntry(item, 'settle', now, reason)], summary, status: 'failed' };
}

// ── Reprise à la main (board.ts done | fail | requeue) ──────────────────────────────

export type ManualAction = 'done' | 'fail' | 'requeue';

/** D'où chaque commande de reprise accepte de partir. */
export const MANUAL_FROM: Record<ManualAction, readonly BoardStatus[]> = {
  done: ['new', 'picked_up', 'failed'],
  fail: ['new', 'picked_up'],
  requeue: ['picked_up', 'failed'],
};

/** Les arguments d'une reprise : `<id>`, une raison (`fail` seulement), `--force`. */
export function parseManualArgs(action: ManualAction, args: string[]): { id: string; reason: string; force: boolean } | { error: string } {
  const force = args.includes('--force');
  const rest = args.filter((a) => a !== '--force');
  const unknown = rest.find((a) => a.startsWith('--'));
  if (unknown !== undefined) return { error: `unknown option ${unknown}` };
  const [id, ...reason] = rest;
  if (id === undefined || id.trim() === '') return { error: 'missing <id>' };
  if (action !== 'fail' && reason.length > 0) return { error: `${action} takes one <id>` };
  return { id, reason: reason.join(' '), force };
}

/** Les statuts d'un run fini (Archon : rien ne s'y écrira plus, sauf reprise). */
export const FINISHED_RUN = ['completed', 'failed', 'cancelled'] as const;

/**
 * Pourquoi refuser une reprise à la main d'une carte que son run travaille peut-être encore,
 * ou null. `runStatus` : le statut de `item.picked.run` (`archon workflow get`), null s'il est
 * inconnu. Tant que ce run n'est pas fini, il tient la carte : la remettre en file la ferait
 * travailler deux fois, et sa clôture (avec l'approbation déjà donnée) serait refusée.
 */
export function liveRunProblem(item: BoardItem, action: ManualAction, runStatus: string | null): string | null {
  if (!item.picked || item.status === 'new') return null;
  if (runStatus !== null && (FINISHED_RUN as readonly string[]).includes(runStatus)) return null;
  const run = item.picked.run;
  const state = runStatus === null ? 'in an unknown state (archon workflow get did not answer)' : runStatus;
  return (
    `${BOARD_PREFIX}${item.id} is held by run ${run}, which is ${state}: it may still finish this card, and ` +
    `\`${action}\` now would make its close refuse to write (an approval already given would be lost${action === 'requeue' ? ', and the card would run twice' : ''}). ` +
    `Answer or end that run first (archon workflow get ${run}; approve or reject its sub-run), or pass --force.`
  );
}

/**
 * Les opérations d'une reprise à la main, ou pourquoi elle est refusée. `done` / `fail`
 * clôturent (même forme que `close`), `requeue` remet l'item en `new` à sa place dans la file
 * (même `created`) ; chaque reprise garde dans `/history` ce que l'item était avant.
 */
export function manualOps(item: BoardItem, action: ManualAction, now: Date, reason = ''): { ops: BoardOp[] } | { error: string } {
  if (!MANUAL_FROM[action].includes(item.status)) {
    return { error: `board/${item.id} is ${item.status}; \`${action}\` applies only to ${MANUAL_FROM[action].join(' | ')} items.` };
  }
  const why = reason.trim() === '' ? null : reason.trim();
  const history = historyEntry(item, action, now, why);
  if (action === 'requeue') {
    return {
      ops: [
        { op: 'set', path: '/status', value: 'new' },
        { op: 'set', path: '/picked', value: null },
        { op: 'set', path: '/result', value: null },
        { op: 'set', path: '/summary', value: null },
        { op: 'set', path: '/finished', value: null },
        history,
      ],
    };
  }
  const summary = `Closed by hand (board.ts ${action})${why === null ? '.' : `: ${why}`}`;
  return { ops: [...closeOps(action === 'done', item.result ?? null, summary, now), history] };
}
