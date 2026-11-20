/**
 * La garde d'avant le sous-run. `always_run: true` : Archon la rejoue à chaque reprise du run
 * (`archon workflow resume <écouteur>`), alors que `claim`, déjà terminé, ne l'est pas, et
 * qu'un `run_*` en échec, lui, est relancé. Sans elle, un écouteur repris relancerait le
 * sous-run d'une carte déjà close par son `settle`, remise en file ou prise par un autre run.
 *
 * Relit la carte (`holdDecision`) : prise par ce run, elle passe ; close en échec par le
 * `settle` de CE run (le run a échoué, puis on l'a repris), elle est reprise (`picked_up`,
 * une entrée `resume` dans l'historique, écriture conditionnelle) et passe ; sinon les `run_*`
 * sont sautés, `outcome` rend `released` et rien n'est écrit. Sa sortie ne change pas d'une
 * reprise à l'autre tant que la décision est la même, pour qu'Archon garde en cache un
 * sous-run déjà terminé. En `idle` / `waiting`, ne lit pas l'état (la fixture l'exécute).
 *
 * Liaison (`with:`) : INPUTS_CLAIM (sortie typée de `claim`).
 */

import { BOARD_PREFIX, type ClaimOutput, NOT_HELD, holdDecision, isBoardItem } from '../../.shared/board.ts';
import { emit, nullableJson } from '../../.shared/io.ts';
import { stateGet, statePatch } from '../../.shared/state.ts';

const claim = nullableJson(process.env.INPUTS_CLAIM) as ClaimOutput | null;

if (claim === null || claim.path !== 'work') {
  emit(NOT_HELD);
} else {
  const name = `${BOARD_PREFIX}${claim.id}`;
  const doc = await stateGet(name);
  const decision = holdDecision(isBoardItem(doc.value) ? doc.value : null, claim, new Date());
  if (decision.ops !== null) {
    const code = await statePatch(name, decision.ops, doc.revision);
    if (code === 3) throw new Error(`${name} changed while this run was taking it back; resume the run again.`);
    if (code !== 0) throw new Error(`archon state patch ${name} failed with exit ${code}`);
  }
  process.stderr.write(`hold: ${name} ${decision.note}.\n`);
  emit(decision.output);
}
