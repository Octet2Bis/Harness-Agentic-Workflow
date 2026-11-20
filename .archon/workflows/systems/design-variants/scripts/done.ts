/**
 * Issue typée de design-variants : `ok` si l'humain a choisi une variante qui a elle-même
 * passé contrôles et juge.
 *
 * Le choix est un `select` Archon : `decision` vaut l'id d'une option proposée — Archon
 * refuse toute autre réponse — donc une survivante (`a`, `b`, `c`) ou `none`. Le texte qui
 * l'accompagne est un commentaire, jamais relu pour y chercher une lettre (« C'est la B »
 * choisit ce que dit `decision`).
 *
 * Deux issues seulement arrivent ici (fixture entre crochets) :
 * - aucune survivante : `choose` est sauté (lu `null`), `done` rend `ok: false` et la raison
 *   de chaque variante [no-survivor, all-unconverged] ;
 * - une survivante choisie : `ok: true` [chosen, one-variant-rejected,
 *   variant-without-verdict].
 * `none` passe par `drop`, qui annule le run avant `done` ; `choose` tourne dès qu'une
 * variante survit. Rien d'autre n'a de chemin, et c'est le seul garde-fou du script : il fait
 * échouer le nœud (« done: unexpected state … ») au lieu d'inventer une issue.
 *
 * Juge en échec avant la pause, puis reprise qui suit la réponse : ce juge rejoue ; s'il
 * réussit, son verdict, `collect` et `done` rejouent, mais `choose` rend la réponse
 * enregistrée (Archon la lit dans l'attente en cours, `metadata.wait`, qu'il efface ensuite) :
 * la variante choisie reste `verified` (son verdict n'a pas rejoué), et `statuses` peut dire
 * `verified` une variante qui n'avait pas été proposée. Cela ne vaut que pour cette reprise :
 * - un juge échoue et aucune variante ne survit : `choose` est sauté, sans réponse, et le run
 *   finit `failed` ; une reprise où ce juge approuve sa variante relance `collect` et ouvre
 *   un choix ;
 * - le juge échoue encore à la reprise qui suit la réponse : le run refinit `failed`, `choose`
 *   terminé avec sa réponse ; une seconde reprise où ce juge réussit relance `collect`, dont
 *   la sortie change, donc `choose` (cache invalidé, dag-executor `getStaleCachedDependencies`,
 *   cas 2), qui pose la question de nouveau.
 *
 * `variants` (booléens) ne distingue pas un refus du juge d'une variante restée rouge à son
 * plafond de tours : `statuses` reprend l'issue lue par `collect` (`verified`, `rejected`,
 * `unconverged`, ou null sans verdict), et le résumé la dit avec les mots de `collect`.
 *
 * Liaisons : INPUTS_COLLECT (sortie de `collect`), INPUTS_CHOOSE ({ decision, text }, null
 * quand le choix a été sauté : aucune survivante).
 */

import { emit, fail, nullableJson } from '../../.shared/io.ts';
import { type Collected, LETTERS, type Letter, NOT_OFFERED, type Status } from './collect.ts';

export interface Choice {
  decision: string;
  text: string;
}

export interface Outcome {
  ok: boolean;
  chosen: Letter | null;
  variants: Record<Letter, boolean | null>;
  statuses: Record<Letter, Status | null>;
  summary: string;
}

const isLetter = (value: string): value is Letter => (LETTERS as readonly string[]).includes(value);
const note = (text: string): string => (text.trim() === '' ? '' : ` (note: ${text.trim()})`);

export function decide(collected: Collected, choice: Choice | null): Outcome {
  const { variants, statuses } = collected;
  if (choice === null && collected.survivors === 0) {
    // Sans survivante, aucune variante n'est `verified` : chacune a sa raison dans NOT_OFFERED.
    const reasons = LETTERS.map(
      (l) => `${l.toUpperCase()}: ${NOT_OFFERED[(statuses[l] ?? 'none') as keyof typeof NOT_OFFERED]}`,
    );
    return {
      ok: false,
      chosen: null,
      variants,
      statuses,
      summary: `No variant passed its checks and judge; nothing was offered to choose (${reasons.join('; ')}).`,
    };
  }
  if (choice !== null && isLetter(choice.decision) && statuses[choice.decision] === 'verified') {
    const chosen = choice.decision;
    return {
      ok: true,
      chosen,
      variants,
      statuses,
      summary: `Variant ${chosen.toUpperCase()} kept: ${collected.summaries[chosen]}${note(choice.text)}`,
    };
  }
  throw new Error(
    `done: unexpected state: choice ${JSON.stringify(choice)} with ${collected.survivors} variant(s) offered; ` +
      'a select only accepts an offered option, `none` cancels the run through `drop` and `choose` runs whenever a variant survives, ' +
      'so the YAML changed without done.ts.',
  );
}

if (import.meta.main) {
  try {
    emit(
      decide(
        nullableJson(process.env.INPUTS_COLLECT) as Collected,
        nullableJson(process.env.INPUTS_CHOOSE) as Choice | null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
