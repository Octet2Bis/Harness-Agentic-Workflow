/**
 * Issue typée de research-report : `ok` seulement si les deux blocs ont rendu ok et que
 * l'humain a approuvé ; `stage` nomme le bloc où ça s'est arrêté.
 * Liaisons : INPUTS_RESEARCH, INPUTS_REPORT (verdicts, null si sautés), INPUTS_REVIEW.
 *
 * Le premier bloc qui n'a pas rendu `ok: true` donne `stage`, et son verdict dit pourquoi
 * (fixture entre crochets ; un verdict a toujours `status`, son output_format l'exige) :
 * - `status: unconverged` : ses contrôles étaient encore rouges à son dernier tour permis ;
 *   la boucle a rendu la main à son plafond (compteur `tries`) et le juge n'a pas tourné.
 *   Le résumé du bloc le dit déjà (« Checks still failing after N round(s)… ») : il suit tel
 *   quel « <bloc> did not converge: » [research-unconverged] ;
 * - `status: rejected` : contrôles verts, mais son juge a refusé [research-rejected,
 *   report-rejected] ;
 * - verdict null (une fois les étapes amont passées) : un de ses nœuds a échoué (erreur du
 *   modèle ou d'un script, juge compris), alors son verdict a été sauté. Une boucle rend
 *   toujours la main à son plafond : null ne veut jamais dire « pas convergé ». Le run finit
 *   alors `failed`, mais l'issue reste typée [research-no-verdict].
 * Les deux blocs `ok` : `review` tourne toujours, et seul un « go » mène ici [approved] ; un
 * refus passe par `drop`, qui annule le run avant `done`. L'humain n'est donc jamais l'étape
 * de `done` : une autre réponse n'a aucun chemin, et c'est le seul garde-fou du script — il
 * fait échouer le nœud (« done: unexpected state … ») au lieu d'inventer une issue.
 */

import { emit, fail, nullableJson } from '../../.shared/io.ts';

export interface Verdict {
  ok: boolean;
  status: 'verified' | 'rejected' | 'unconverged';
  summary: string;
  deliverable: { path: string };
}
export interface Review { decision: 'approve' | 'reject'; text: string }
export type Stage = 'research' | 'report' | 'done';
export interface Outcome {
  ok: boolean;
  stage: Stage;
  summary: string;
  deliverables: { research: string | null; report: string | null };
}

const BLOCKS = [
  ['research', 'Research'],
  ['report', 'Report'],
] as const;

export function decide(research: Verdict | null, report: Verdict | null, review: Review | null): Outcome {
  const verdicts = { research, report };
  const deliverables = { research: research?.deliverable.path ?? null, report: report?.deliverable.path ?? null };
  for (const [stage, name] of BLOCKS) {
    const verdict = verdicts[stage];
    if (verdict?.ok) continue;
    const summary =
      verdict === null
        ? `${name} returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.`
        : verdict.status === 'unconverged'
          ? `${name} did not converge: ${verdict.summary}`
          : `${name} rejected: ${verdict.summary}`;
    return { ok: false, stage, summary, deliverables };
  }
  if (review?.decision !== 'approve') {
    throw new Error(
      `done: unexpected state: both blocks passed but the final review answer is ${JSON.stringify(review)}; ` +
        '`review` always runs after a passing report and a reject cancels the run through `drop`, so the YAML changed without done.ts.',
    );
  }
  return { ok: true, stage: 'done', summary: `Approved at final review. ${report!.summary}`, deliverables };
}

if (import.meta.main) {
  try {
    emit(
      decide(
        nullableJson(process.env.INPUTS_RESEARCH) as Verdict | null,
        nullableJson(process.env.INPUTS_REPORT) as Verdict | null,
        nullableJson(process.env.INPUTS_REVIEW) as Review | null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
