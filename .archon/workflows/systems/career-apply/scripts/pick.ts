/**
 * Le verdict qui compte pour la suite du run, après une ronde de révision : celui de la seconde
 * ronde (`tailor2`, `letter2`, lancée sur les constats du Reviewer) quand elle a rendu un
 * verdict, sinon celui de la première (`tailor`, `letter`). Sert aux nœuds `cv` (cv-tailor :
 * `letter`, `render`, `record` le lisent) et `letter_pick` (cover-letter : `render`, `record`).
 * Même forme que le verdict du bloc (`ok`, `status`, `summary`, `problems`, `findings`,
 * `deliverable`), plus `revised`. Sans aucun verdict (le bloc a échoué avant son verdict) :
 * `status: none`, `ok: false`, pas de `deliverable` (un pointeur vide serait refusé par
 * Archon). La règle est pure (`pickVerdict`, systems/.shared/career.ts, testée).
 *
 * Liaisons : INPUTS_FIRST, INPUTS_SECOND (verdicts JSON, `null` si sautés ou sans verdict),
 * INPUTS_REVISE (la sortie du brief de révision, `null` si sauté : dit si la seconde ronde a
 * été lancée), INPUTS_BLOCK (le bloc, nommé dans le résumé ; `cv-tailor` par défaut).
 */

import { type CvBlockVerdict, pickVerdict } from '../../.shared/career.ts';
import { emit, nullableJson, text } from '../../.shared/io.ts';

const first = nullableJson(process.env.INPUTS_FIRST) as CvBlockVerdict | null;
const second = nullableJson(process.env.INPUTS_SECOND) as CvBlockVerdict | null;
const revise = nullableJson(process.env.INPUTS_REVISE) as { ok?: boolean } | null;
const block = text(process.env.INPUTS_BLOCK).trim() || 'cv-tailor';
const choice = pickVerdict(first, second, second !== null || revise?.ok === true, block);
const { deliverable, ...rest } = choice;
emit(deliverable === null ? rest : { ...rest, deliverable });
