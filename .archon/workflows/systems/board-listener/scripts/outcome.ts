/**
 * L'issue de la tâche prise, d'après celui des nœuds `run_<système>` qui a tourné (les autres
 * sont sautés et se lisent null). Pur : ne lit ni n'écrit l'état, donc il tourne pour de vrai
 * dans les fixtures (exec-code) et chaque routage s'y asserte. `close` écrit ce qu'il rend.
 * `waiting` (des cartes attendent le dossier) et `released` (la garde a trouvé la carte à
 * quelqu'un d'autre) n'écrivent rien.
 *
 * Un sous-run en échec ou annulé fait échouer son nœud `run_<système>`, et Archon ne laisse
 * aucune liaison lire un nœud en échec : ce script échoue alors aussi, `close` est sauté, et
 * c'est `settle` qui marque la tâche `failed`.
 *
 * Liaisons (`with:`) : INPUTS_CLAIM (sortie typée de `claim`), INPUTS_HOLD (sortie typée de
 * `hold`), et l'issue typée de chaque système (null si son nœud a été sauté).
 */

import { type ClaimOutput, type HoldOutput, closeOutcome } from '../../.shared/board.ts';
import { emit, nullableJson } from '../../.shared/io.ts';

const claim = nullableJson(process.env.INPUTS_CLAIM) as ClaimOutput | null;
const hold = nullableJson(process.env.INPUTS_HOLD) as HoldOutput | null;
const results: Record<string, unknown> = {
  pipeline: nullableJson(process.env.INPUTS_PIPELINE),
  'research-report': nullableJson(process.env.INPUTS_RESEARCH_REPORT),
  'feature-build': nullableJson(process.env.INPUTS_FEATURE_BUILD),
  'design-variants': nullableJson(process.env.INPUTS_DESIGN_VARIANTS),
};

emit(closeOutcome(claim, hold, results));
