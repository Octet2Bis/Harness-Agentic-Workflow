/**
 * Issue typée du pipeline, dérivée des verdicts certifiés des blocs et de la réponse
 * humaine. `ok` n'est vrai que si les trois blocs ont rendu `ok: true` et que la
 * vérification finale a approuvé. `stage` nomme le bloc où ça s'est arrêté.
 *
 * Liaisons (`with:`) : INPUTS_RESEARCH, INPUTS_DESIGN, INPUTS_REPORT (verdicts des blocs,
 * null si le bloc a été sauté), INPUTS_REVIEW (réponse { decision, text }, null si sautée).
 *
 * Le premier bloc qui n'a pas rendu `ok: true` donne `stage`, et son verdict dit pourquoi
 * (fixture entre crochets ; un verdict a toujours `status`, son output_format l'exige) :
 * - `status: unconverged` : ses contrôles étaient encore rouges à son dernier tour permis ;
 *   la boucle a rendu la main à son plafond (compteur `tries`) et le juge n'a pas tourné.
 *   Le résumé du bloc le dit déjà (« Checks still failing after N round(s)… ») : il suit tel
 *   quel « <bloc> did not converge: » [research-unconverged] ;
 * - `status: rejected` : contrôles verts, mais son juge a refusé [research-rejected,
 *   design-rejected, report-rejected] ;
 * - verdict null (une fois les blocs amont passés) : un de ses nœuds a échoué (erreur du
 *   modèle ou d'un script, juge compris), alors son verdict a été sauté. Une boucle rend
 *   toujours la main à son plafond : null ne veut jamais dire « pas convergé ». Le run finit
 *   alors `failed`, mais l'issue reste typée [research-no-verdict].
 * Les trois blocs `ok` : `review` tourne toujours, et seul un « go » mène ici [approved] ; un
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
export interface Review {
  decision: 'approve' | 'reject';
  text: string;
}
export type Stage = 'research' | 'design' | 'report' | 'done';
export interface Outcome {
  ok: boolean;
  stage: Stage;
  summary: string;
  deliverables: { research: string | null; design: string | null; report: string | null };
}

const BLOCKS = [
  ['research', 'Research'],
  ['design', 'Design'],
  ['report', 'Report'],
] as const;

export function decide(
  research: Verdict | null,
  design: Verdict | null,
  report: Verdict | null,
  review: Review | null,
): Outcome {
  const verdicts = { research, design, report };
  const deliverables = {
    research: research?.deliverable.path ?? null,
    design: design?.deliverable.path ?? null,
    report: report?.deliverable.path ?? null,
  };
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
      `done: unexpected state: the three blocks passed but the final review answer is ${JSON.stringify(review)}; ` +
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
        nullableJson(process.env.INPUTS_DESIGN) as Verdict | null,
        nullableJson(process.env.INPUTS_REPORT) as Verdict | null,
        nullableJson(process.env.INPUTS_REVIEW) as Review | null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
