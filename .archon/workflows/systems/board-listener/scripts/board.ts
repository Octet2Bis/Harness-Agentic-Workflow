/**
 * Le tableau de tâches, côté humain (hors run). À lancer depuis la racine du projet :
 *
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts add "Faire le point sur X" [--context "..."] [--workflow=<système>] [--source=<origine>]
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts list
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts show <id>
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts done <id> [--force]
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts fail <id> [raison] [--force]
 *   bun .archon/workflows/systems/board-listener/scripts/board.ts requeue <id> [--force]
 *
 * `--workflow` : un système de BOARD_WORKFLOWS (.shared/board.ts), `pipeline` par défaut ; la
 * carte est refusée si ce système exige une entrée qu'une tâche et un contexte ne remplissent
 * pas (lu dans son YAML), ou s'il travaille dans un worktree et que le dépôt n'a pas de remote
 * `origin`. `done` / `fail` / `requeue` reprennent un item resté coincé ; ils refusent une
 * carte dont le run n'est pas fini (`archon workflow get`), sauf `--force`.
 *
 * Écrit par `archon state` dans la portée du projet courant (le dossier doit être enregistré
 * ou être un dépôt git). ARCHON_CMD remplace `archon` si le binaire n'est pas sur le PATH.
 * Sorties : 0 ; 1 refus (système inconnu ou impossible ici, transition interdite, run encore
 * vivant, item absent ou modifié entre-temps) ; 2 usage. Jamais `process.exit()` (convention
 * du dépôt : `process.exitCode`).
 */

import {
  BOARD_PREFIX,
  BOARD_WORKFLOWS,
  type BoardItem,
  type ManualAction,
  isBoardItem,
  isBoardWorkflow,
  itemWorkflow,
  liveRunProblem,
  manualOps,
  newItem,
  newItemId,
  parseAddArgs,
  parseManualArgs,
  routeProblem,
  worktreeProblem,
} from '../../.shared/board.ts';
import { stateGet, stateList, statePatch, statePut } from '../../.shared/state.ts';
import { hasOriginRemote, runStatus, systemDoc } from './archon.ts';

const USAGE = [
  'usage: board.ts add "<task>" [--context "<text>"] [--workflow=<name>] [--source=<text>]',
  '       board.ts list | show <id> | done <id> [--force] | fail <id> [reason] [--force] | requeue <id> [--force]',
  `workflows: ${Object.keys(BOARD_WORKFLOWS).join(', ')} (default pipeline)`,
].join('\n');

/** Mauvais appel : message + usage, sortie 2. */
class UsageError extends Error {}
/** Refus motivé : message seul, sortie 1. */
class Refusal extends Error {}

async function add(args: string[]): Promise<void> {
  const request = parseAddArgs(args);
  if ('error' in request) throw new UsageError(request.error);
  const { workflow } = request;
  const inputs = isBoardWorkflow(workflow) ? (systemDoc(workflow)?.inputs as Record<string, unknown> | undefined) : undefined;
  const problem = routeProblem(workflow, inputs) ?? (isBoardWorkflow(workflow) ? worktreeProblem(workflow, hasOriginRemote()) : null);
  if (problem !== null) throw new Refusal(problem);
  const now = new Date();
  const id = newItemId(now, Math.random());
  const item = newItem(id, request.task, request.context, now, request.workflow, request.source);
  const code = await statePut(`${BOARD_PREFIX}${id}`, item, 0);
  if (code !== 0) throw new Error(`archon state put failed with exit ${code}`);
  process.stdout.write(`NEW  ${id}  ${request.workflow}  ${request.task}\n`);
}

async function list(args: string[]): Promise<void> {
  if (args.length > 0) throw new UsageError('list takes no argument');
  const rows: BoardItem[] = [];
  for (const entry of await stateList(BOARD_PREFIX)) {
    if (entry.deleted) continue;
    const doc = await stateGet(entry.name);
    if (isBoardItem(doc.value)) rows.push(doc.value);
  }
  rows.sort((a, b) => a.created.localeCompare(b.created));
  for (const item of rows) {
    const picked = item.status === 'picked_up' && item.picked !== null ? `  (run ${item.picked.run})` : '';
    process.stdout.write(`${item.status.toUpperCase().padEnd(9)} ${item.id}  ${itemWorkflow(item).padEnd(15)}  ${item.task}${picked}\n`);
  }
  if (rows.length === 0) process.stdout.write('(empty board)\n');
}

/** Lit un item ; refuse un id inconnu. */
async function read(id: string | undefined): Promise<{ name: string; revision: number; item: BoardItem }> {
  if (id === undefined || id.trim() === '') throw new UsageError('missing <id>');
  const name = `${BOARD_PREFIX}${id}`;
  const doc = await stateGet(name);
  if (!isBoardItem(doc.value)) throw new Refusal(`No board item ${id} (see board.ts list).`);
  return { name, revision: doc.revision, item: doc.value };
}

async function show(args: string[]): Promise<void> {
  if (args.length > 1) throw new UsageError('show takes one <id>');
  const { item } = await read(args[0]);
  process.stdout.write(`${JSON.stringify(item, null, 2)}\n`);
}

async function manual(action: ManualAction, args: string[]): Promise<void> {
  const parsed = parseManualArgs(action, args);
  if ('error' in parsed) throw new UsageError(parsed.error);
  const { name, revision, item } = await read(parsed.id);
  const change = manualOps(item, action, new Date(), parsed.reason);
  if ('error' in change) throw new Refusal(change.error);
  if (item.picked && item.status !== 'new') {
    // Le run qui a pris la carte la tient tant qu'il n'est pas fini : le lui retirer perd son issue.
    const live = liveRunProblem(item, action, await runStatus(item.picked.run));
    if (live !== null && !parsed.force) throw new Refusal(live);
    if (live !== null) process.stderr.write(`note (--force): ${live}\n`);
  }
  const code = await statePatch(name, change.ops, revision);
  if (code === 3) throw new Refusal(`${name} changed while you were looking (revision ${revision}); run the command again.`);
  if (code !== 0) throw new Error(`archon state patch ${name} failed with exit ${code}`);
  const status = action === 'requeue' ? 'new' : action === 'done' ? 'done' : 'failed';
  process.stdout.write(`${status.toUpperCase().padEnd(9)} ${item.id}  ${itemWorkflow(item)}  ${item.task}\n`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'add':
      return add(rest);
    case 'list':
      return list(rest);
    case 'show':
      return show(rest);
    case 'done':
    case 'fail':
    case 'requeue':
      return manual(command, rest);
    default:
      throw new UsageError(command === undefined ? 'missing command' : `unknown command "${command}"`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`board.ts: ${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  } else if (error instanceof Refusal) {
    process.stderr.write(`board.ts: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
