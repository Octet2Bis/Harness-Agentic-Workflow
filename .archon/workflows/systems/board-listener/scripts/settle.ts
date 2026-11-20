/**
 * Le filet : dernier nœud, `trigger_rule: all_done`, il tourne quoi qu'il soit arrivé avant.
 * Quand un sous-run échoue ou est annulé (erreur d'un juge, refus humain qui annule l'enfant,
 * Archon qui l'annule au départ), son nœud `run_<système>` échoue ; Archon ne laisse aucune
 * liaison lire un nœud en échec, donc `outcome` échoue et `close` est sauté. Sans ce nœud la
 * tâche resterait `picked_up` pour toujours (l'écouteur ne prend que les `new`).
 *
 * Ne lie que `claim` et l'issue relayée par `outcome_result` (null quand `outcome` a échoué :
 * le relais est alors sauté) — jamais un nœud qui peut être en échec. Relit l'item ; s'il est
 * encore `picked_up` par CE run (`settleOps`) : l'issue du sous-run si elle existe (`close` a
 * échoué après), sinon `failed`, avec la première cause d'échec lue dans le run
 * (`archon workflow get <run> --verbose`, `failureReason`), par écriture conditionnelle. Une
 * tâche déjà close, reprise à la main ou prise par un autre run n'est pas touchée.
 *
 * Liaisons (`with:`) : INPUTS_CLAIM (sortie typée de `claim`), INPUTS_OUTCOME (sortie de
 * `outcome`, ou null).
 */

import { BOARD_PREFIX, type BoardOutcome, type ClaimOutput, failureReason, heldBy, isBoardItem, settleOps } from '../../.shared/board.ts';
import { emit, nullableJson } from '../../.shared/io.ts';
import { stateGet, statePatch } from '../../.shared/state.ts';
import { runNodes } from './archon.ts';

const claim = nullableJson(process.env.INPUTS_CLAIM) as ClaimOutput | null;
const outcome = nullableJson(process.env.INPUTS_OUTCOME) as BoardOutcome | null;

if (claim === null || claim.path !== 'work') {
  emit({ settled: false, id: '', summary: 'Nothing was claimed.' });
} else {
  const name = `${BOARD_PREFIX}${claim.id}`;
  const doc = await stateGet(name);
  const item = isBoardItem(doc.value) ? doc.value : null;
  if (!heldBy(item, claim.run)) {
    emit({ settled: false, id: claim.id, summary: `${name} is ${item?.status ?? 'missing'}: nothing to settle.` });
  } else {
    const settle = settleOps(item, claim, outcome, failureReason(await runNodes(claim.run)), new Date())!;
    const code = await statePatch(name, settle.ops, doc.revision);
    if (code === 3) {
      emit({ settled: false, id: claim.id, summary: `${name} changed while settling: left as is.` });
    } else if (code !== 0) {
      throw new Error(`archon state patch ${name} failed with exit ${code}`);
    } else {
      emit({ settled: true, id: claim.id, summary: settle.summary });
    }
  }
}
