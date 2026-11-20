/**
 * Écrit l'issue calculée par `outcome` (DONE si ok, FAILED sinon) dans l'item pris. En `idle`,
 * `waiting` ou `released` il n'y a rien à écrire : le script le dit et ne touche pas l'état,
 * ce qui permet aux fixtures de l'exécuter pour de vrai.
 *
 * Relit la carte et n'écrit que si elle est encore prise par CE run (`closeProblem`), par
 * écriture conditionnelle sur la révision lue : une reprise à la main (`board.ts done | fail |
 * requeue --force`) ou une prise par un autre run faite entre-temps reste, et ce nœud échoue
 * en le disant. Pas de révision gardée depuis `claim` : un run repris après échec a vu sa
 * garde (`hold`) reprendre la carte, à une autre révision.
 *
 * Ne tourne que si `outcome` a rendu une issue : quand le sous-run a échoué ou a été annulé,
 * `outcome` échoue (liaison vers un nœud en échec), ce nœud est sauté et `settle` clôt.
 *
 * Liaisons (`with:`) : INPUTS_CLAIM (sortie typée de `claim`), INPUTS_OUTCOME (sortie typée
 * d'`outcome`).
 */

import { BOARD_PREFIX, type BoardOutcome, type ClaimOutput, closeOps, closeProblem, isBoardItem } from '../../.shared/board.ts';
import { emit, nullableJson } from '../../.shared/io.ts';
import { stateGet, statePatch } from '../../.shared/state.ts';

const claim = nullableJson(process.env.INPUTS_CLAIM) as ClaimOutput | null;
const outcome = nullableJson(process.env.INPUTS_OUTCOME) as BoardOutcome | null;

if (claim === null || outcome === null || (outcome.path !== 'done' && outcome.path !== 'failed')) {
  const path = outcome?.path ?? 'idle';
  emit({ ok: outcome?.ok ?? true, path, id: outcome?.id ?? '', workflow: outcome?.workflow ?? '', summary: outcome?.summary ?? 'Nothing on the board.' });
} else {
  const name = `${BOARD_PREFIX}${claim.id}`;
  const doc = await stateGet(name);
  const problem = closeProblem(isBoardItem(doc.value) ? doc.value : null, claim);
  if (problem !== null) throw new Error(`${problem} This run's outcome was: ${outcome.summary}`);
  const code = await statePatch(name, closeOps(outcome.ok, outcome.result, outcome.summary, new Date()), doc.revision);
  if (code === 3) throw new Error(`${name} changed while closing it: left as is. This run's outcome was: ${outcome.summary}`);
  if (code !== 0) throw new Error(`archon state patch ${name} failed with exit ${code}`);
  emit({ ok: outcome.ok, path: outcome.path, id: claim.id, workflow: outcome.workflow, summary: outcome.summary });
}
