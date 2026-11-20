/**
 * Issue typée de company-outreach : `ok` seulement si les trois blocs ont rendu ok et que
 * l'humain a approuvé ; `stage` nomme le bloc où la chaîne s'est arrêtée, et pourquoi
 * (`unconverged` : contrôles encore rouges au plafond ; `rejected` : juge défavorable ;
 * verdict null : un nœud du bloc a échoué, erreur de modèle ou de script). Un refus humain
 * passe par `drop`, qui annule le run avant `done` : toute autre réponse fait échouer le nœud
 * (« done: unexpected state … ») plutôt que d'inventer une issue, comme research-report.
 * Liaisons : INPUTS_DOSSIER, INPUTS_ANGLE, INPUTS_SEQUENCE (verdicts, null si sautés), INPUTS_REVIEW.
 */

import { emit, fail, nullableJson } from '../../.shared/io.ts';

export interface Verdict {
  ok: boolean;
  status: 'verified' | 'rejected' | 'unconverged';
  summary: string;
  deliverable: { path: string };
}
export interface Review { decision: 'approve' | 'reject'; text: string }
export type Stage = 'dossier' | 'angle' | 'sequence' | 'done';
export interface Outcome {
  ok: boolean;
  stage: Stage;
  summary: string;
  deliverables: { dossier: string | null; angle: string | null; sequence: string | null };
}

const BLOCKS = [
  ['dossier', 'Company dossier'],
  ['angle', 'Offer angle'],
  ['sequence', 'Outbound sequence'],
] as const;

export function decide(dossier: Verdict | null, angle: Verdict | null, sequence: Verdict | null, review: Review | null): Outcome {
  const verdicts = { dossier, angle, sequence };
  const deliverables = {
    dossier: dossier?.deliverable.path ?? null,
    angle: angle?.deliverable.path ?? null,
    sequence: sequence?.deliverable.path ?? null,
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
        '`review` always runs after a passing sequence and a reject cancels the run through `drop`, so the YAML changed without done.ts.',
    );
  }
  return { ok: true, stage: 'done', summary: `Approved at final review; nothing was sent. ${sequence!.summary}`, deliverables };
}

if (import.meta.main) {
  try {
    emit(
      decide(
        nullableJson(process.env.INPUTS_DOSSIER) as Verdict | null,
        nullableJson(process.env.INPUTS_ANGLE) as Verdict | null,
        nullableJson(process.env.INPUTS_SEQUENCE) as Verdict | null,
        nullableJson(process.env.INPUTS_REVIEW) as Review | null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
