/**
 * Les trois variantes avant le choix humain : une ligne par variante, et les options du
 * `select` (les survivantes, plus `none`).
 *
 * Quatre états par variante, chacun avec ses mots dans le message (fixture entre crochets) :
 * - `verified` : contrôles verts, juge favorable — seule proposée [chosen] ;
 * - `rejected` : contrôles verts, juge défavorable (verdict `ok: false`) [no-survivor,
 *   one-variant-rejected] ;
 * - `unconverged` : contrôles encore rouges au dernier tour permis ; la boucle s'arrête à
 *   son plafond par le compteur `tries`, le juge est sauté et le verdict rend quand même
 *   `ok: false, status: unconverged`. Son résumé le dit déjà (« Checks still failing after
 *   N round(s)… ») : la ligne est « X (fichier) did not converge: <résumé du bloc> », sans
 *   le redire [all-unconverged] ;
 * - `null` : pas de verdict (lié avec `if_skipped: null`) — un nœud du bloc a échoué (le juge,
 *   sur une erreur du modèle, ou une étape de la boucle) et le verdict a été sauté
 *   [variant-without-verdict].
 * Un verdict a toujours `status` et un livrable : l'output_format du verdict de
 * `landing-page` les exige, et Archon le fait respecter. Seule une `verified` est proposée ;
 * les autres sont nommées, avec leur raison.
 * Ce nœud lit les verdicts une fois pour toutes : le message d'attention ne référence plus
 * `$a.output…`, qui ferait échouer l'attente dès qu'une variante n'a pas de verdict.
 *
 * Limite Archon : un verdict en échec (le script `verdict` lui-même planté) fait échouer la
 * liaison, `if_skipped` ne couvre que le producteur sauté.
 *
 * Liaisons : INPUTS_A, INPUTS_B, INPUTS_C (verdicts `landing-page`, null si sautés).
 */

import { join } from 'node:path';
import { artifactsDir, emit, nullableJson } from '../../.shared/io.ts';

export const LETTERS = ['a', 'b', 'c'] as const;
export type Letter = (typeof LETTERS)[number];

export type Status = 'verified' | 'rejected' | 'unconverged';

export interface Verdict {
  ok: boolean;
  status: Status;
  summary: string;
  deliverable: { path: string };
}

export interface Collected {
  /** Une ligne par variante, pour le message d'attention. */
  text: string;
  /** Nombre de variantes qui ont passé contrôles et juge. */
  survivors: number;
  /** Options du `select` : les survivantes (`a`, `b`, `c`), puis `none`. */
  options: { id: string; label: string }[];
  /** `ok` de chaque verdict, `null` quand la variante n'a pas de verdict. */
  variants: Record<Letter, boolean | null>;
  /** Issue de chaque verdict, `null` quand la variante n'a pas de verdict. */
  statuses: Record<Letter, Status | null>;
  /** Résumé de chaque verdict, `null` quand la variante n'a pas de verdict. */
  summaries: Record<Letter, string | null>;
}

export const NONE_OPTION = { id: 'none', label: 'None: drop every variant (say why in the text)' };

/** Pourquoi une variante n'est pas proposée, dans les mots du message et de `done`. */
export const NOT_OFFERED: Record<Exclude<Status, 'verified'> | 'none', string> = {
  rejected: 'rejected by its judge',
  unconverged: 'did not converge',
  none: 'no verdict (a node of the block failed: its judge, or a step of its check loop)',
};

export function collectVariants(verdicts: Record<Letter, Verdict | null>, dir: string): Collected {
  const lines: string[] = [];
  const options: { id: string; label: string }[] = [];
  for (const letter of LETTERS) {
    const verdict = verdicts[letter];
    const name = letter.toUpperCase();
    if (verdict === null) {
      lines.push(`${name} (${join(dir, `variant-${letter}.html`)}): ${NOT_OFFERED.none}; not offered.`);
      continue;
    }
    const file = join(dir, verdict.deliverable.path);
    switch (verdict.status) {
      case 'unconverged':
        // Le résumé du bloc commence par « Checks still failing after N round(s) » : il suit tel quel.
        lines.push(`${name} (${file}) ${NOT_OFFERED.unconverged}: ${verdict.summary}; not offered.`);
        break;
      case 'rejected':
        lines.push(`${name} (${file}) ok=false, ${NOT_OFFERED.rejected} — ${verdict.summary}; not offered.`);
        break;
      case 'verified':
        lines.push(`${name} (${file}) ok=true — ${verdict.summary}`);
        options.push({ id: letter, label: `${name}: ${verdict.summary}`.trim() });
        break;
    }
  }
  const pick = <T>(f: (v: Verdict) => T): Record<Letter, T | null> => ({
    a: verdicts.a === null ? null : f(verdicts.a),
    b: verdicts.b === null ? null : f(verdicts.b),
    c: verdicts.c === null ? null : f(verdicts.c),
  });
  return {
    text: lines.join('\n'),
    survivors: options.length,
    options: [...options, NONE_OPTION],
    variants: pick((v) => v.ok),
    statuses: pick((v) => v.status),
    summaries: pick((v) => v.summary),
  };
}

if (import.meta.main) {
  emit(
    collectVariants(
      {
        a: nullableJson(process.env.INPUTS_A) as Verdict | null,
        b: nullableJson(process.env.INPUTS_B) as Verdict | null,
        c: nullableJson(process.env.INPUTS_C) as Verdict | null,
      },
      artifactsDir(),
    ),
  );
}
