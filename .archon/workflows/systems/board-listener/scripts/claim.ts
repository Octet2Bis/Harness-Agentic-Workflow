/**
 * Prend la plus ancienne tâche NEW du tableau par écriture conditionnelle. Si la
 * révision a bougé entre la lecture et l'écriture (un autre run l'a prise), on passe à la
 * suivante. Aucune tâche : `idle`.
 *
 * La garde du dossier (`folderWait`, d'après `archon workflow status` et les YAML) : une carte
 * reste NEW quand
 * - son sous-run prendrait le verrou du dossier (`takesFolderLock` : son système ne déclare pas
 *   `mutates_checkout: false`) et un autre run actif travaille dans ce dossier : Archon
 *   annulerait ce sous-run au départ (« This worktree is in use ») ;
 * - ou un run actif de ce dossier prend lui-même le verrou (`workflowTakesLock` sur le YAML de
 *   son workflow, introuvable = verrou) : quelle que soit la carte, son sous-run pourrait
 *   attendre son humain des heures, et Archon annulerait ce run à sa reprise (une reprise remet
 *   son heure de départ à maintenant) — un go déjà donné y serait perdu.
 * Si aucune autre carte ne part, le run finit `waiting` en disant lesquelles et pourquoi.
 * Liste des runs illisible : on prend quand même (comportement d'avant la garde), en le disant
 * sur stderr.
 *
 * Rend le système demandé par la carte (`workflow`, `pipeline` pour un ancien item) et ce
 * qu'il faut lui passer (`cardInputs` : un système sans entrée de contexte le reçoit à la fin
 * de la tâche), l'id de ce run (`hold`, `close` et `settle` ne touchent qu'une tâche prise par
 * lui) et la révision écrite par la prise.
 */

import {
  type ActiveRun,
  BOARD_PREFIX,
  type BoardDoc,
  type FolderWait,
  cardInputs,
  folderRuns,
  folderWait,
  isBoardItem,
  isBoardWorkflow,
  itemWorkflow,
  pickOps,
  pickOrder,
  takesFolderLock,
  waitingNote,
  workflowTakesLock,
} from '../../.shared/board.ts';
import { emit } from '../../.shared/io.ts';
import { stateGet, stateList, statePatch } from '../../.shared/state.ts';
import { activeRuns, workflowDoc } from './archon.ts';

const run = process.env.WORKFLOW_ID ?? 'unknown-run';
const now = new Date();

const docs: BoardDoc[] = [];
for (const entry of await stateList(BOARD_PREFIX)) {
  if (entry.deleted) continue;
  const doc = await stateGet(entry.name);
  if (isBoardItem(doc.value)) docs.push({ name: entry.name, revision: doc.revision, value: doc.value });
}

/** Les autres runs actifs de ce dossier, lus une fois ; null si Archon n'a pas répondu. */
let others: ActiveRun[] | null | undefined;
async function folderOthers(): Promise<ActiveRun[]> {
  if (others === undefined) {
    const runs = await activeRuns();
    if (runs === null) process.stderr.write('claim: archon workflow status did not answer; taking the card without the folder check.\n');
    others = runs === null ? null : folderRuns(runs, run, process.cwd());
  }
  return others ?? [];
}
const locks = new Map<string, boolean>();
const takesLock = (name: string): boolean => {
  if (!locks.has(name)) locks.set(name, workflowTakesLock(workflowDoc(name)));
  return locks.get(name)!;
};

let taken: BoardDoc | null = null;
const waiting: string[] = [];
let wait: FolderWait | null = null;
for (const candidate of pickOrder(docs)) {
  const workflow = itemWorkflow(candidate.value);
  const cardTakesLock = isBoardWorkflow(workflow) && takesFolderLock(workflow, workflowDoc(workflow));
  const held = folderWait(await folderOthers(), cardTakesLock, takesLock);
  if (held !== null) {
    waiting.push(candidate.value.id);
    wait ??= held;
    continue;
  }
  const code = await statePatch(candidate.name, pickOps(run, now), candidate.revision);
  if (code === 0) {
    taken = candidate;
    break;
  }
  if (code !== 3) throw new Error(`archon state patch ${candidate.name} failed with exit ${code}`);
}

const note = waiting.length > 0 && wait !== null ? waitingNote(waiting, wait) : '';
if (taken === null) {
  emit({ path: waiting.length > 0 ? 'waiting' : 'idle', id: '', run, workflow: '', task: '', context: '', revision: 0, note });
} else {
  emit({
    path: 'work',
    id: taken.value.id,
    run,
    ...cardInputs(taken.value),
    revision: taken.revision + 1,
    note,
  });
}
