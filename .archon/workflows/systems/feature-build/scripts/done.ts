/**
 * Issue typée de feature-build. `ok` seulement si le plan existe, l'implémentation est
 * verte, le lint passe, la relecture est fiable, l'humain a approuvé et le brouillon de PR
 * est ouvert. `stage` nomme l'étape où ça s'est arrêté.
 *
 * Chaque issue rendue ici a un chemin réel (fixture entre crochets) :
 * - `plan` à `null` : le plan a échoué, son relais `plan_result` a été sauté [plan-failed].
 *   Un plan réussi a toujours un livrable : son output_format l'exige et Archon le fait
 *   respecter ; `done` ne regarde donc que `null` ;
 * - `implement` à `null` : un nœud du bloc a échoué, son verdict a été sauté (lu `null` par
 *   `if_skipped`) ; `ok: false` : `status: unconverged`, seul refus possible d'`implement`
 *   (son enum n'a pas `rejected`) — au 8e tour, tests encore rouges ou tâches restantes
 *   sous `## Reste` [tests-never-green] ;
 * - `lint` à `null` : dépassement des 10 min (`on_timeout: skip`) ; `ok: false` : le lint
 *   a échoué [lint-failed] ;
 * - `review` à `null` : un nœud du bloc a échoué ; `status: unconverged` : au 3e tour,
 *   `review.json` ne passe toujours pas ses contrôles, le juge n'a pas tourné et rien de
 *   fiable n'est dit du code [review-unconverged] ; `status: rejected` : contrôles verts, le
 *   juge récuse la relecture [review-refused] ;
 * - `ship` à `null` après le « go » : ship a échoué, son relais `ship_result` a été sauté
 *   [ship-failed] ; `pr_url: null` : rien à publier, ou gh absent ; sinon la PR [shipped].
 * Une boucle rend toujours la main à son plafond (compteur `tries`) : un verdict `null` ne
 * veut jamais dire « pas convergé ». Sur un `null` d'erreur, le run finit `failed`, mais
 * l'issue reste typée (`done` tourne en `all_done`).
 *
 * L'humain n'a pas d'issue ici : `approve` tourne toujours une fois la relecture `ok`, et un
 * refus passe par `drop`, qui annule le run avant `done`. Une réponse autre que `approve`
 * à ce point n'a donc aucun chemin : c'est le seul garde-fou du script, il fait échouer le
 * nœud (« done: unexpected state … ») au lieu d'inventer une issue, et ne sert qu'à signaler
 * un YAML changé sans ce script.
 * Liaisons : INPUTS_PLAN, INPUTS_IMPLEMENT, INPUTS_LINT, INPUTS_REVIEW, INPUTS_APPROVE, INPUTS_SHIP.
 */

import { emit, fail, nullableJson } from '../../.shared/io.ts';

export interface Plan { summary: string; tasks: number; deliverable: { path: string } }
export interface ImplementVerdict { ok: boolean; status: 'verified' | 'unconverged'; summary: string }
export interface ReviewVerdict {
  ok: boolean;
  status: 'verified' | 'rejected' | 'unconverged';
  summary: string;
  code_verdict: string;
}
export interface Lint { ok: boolean; exit_code: number; log: string }
export interface Approve { decision: 'approve' | 'reject'; text: string }
export interface Ship { summary: string; pr_url: string | null }
export type Stage = 'plan' | 'implement' | 'lint' | 'review' | 'ship' | 'done';
export interface Outcome { ok: boolean; stage: Stage; summary: string; pr_url: string | null }

/** Un bloc sans verdict : un de ses nœuds a échoué, jamais « pas convergé ». */
function errored(block: string): string {
  return `${block} returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.`;
}

const stop = (stage: Stage, summary: string): Outcome => ({ ok: false, stage, summary, pr_url: null });

export function decide(
  plan: Plan | null,
  implement: ImplementVerdict | null,
  lint: Lint | null,
  review: ReviewVerdict | null,
  approve: Approve | null,
  ship: Ship | null,
): Outcome {
  if (plan === null) return stop('plan', 'No plan: the plan step failed (a model or tool error), so nothing after it ran.');
  if (implement === null) return stop('implement', errored('Implementation'));
  if (!implement.ok) {
    return stop('implement', `Implementation did not converge (tests never went green or tasks were left): ${implement.summary}`);
  }
  if (lint === null) return stop('lint', 'Lint gave no result (timed out); the review did not run.');
  if (!lint.ok) {
    return stop('lint', `Lint failed (exit ${lint.exit_code}, output in ${lint.log} in the run's artifacts); the review did not run.`);
  }
  if (review === null) return stop('review', errored('Review'));
  if (!review.ok) {
    return stop(
      'review',
      review.status === 'unconverged'
        ? `Review did not converge (no valid review.json, so nothing reliable is said about the code): ${review.summary}`
        : `Review not trustworthy: ${review.summary}`,
    );
  }
  if (approve?.decision !== 'approve') {
    throw new Error(
      `done: unexpected state: the review passed but the human answer is ${JSON.stringify(approve)}; ` +
        '`approve` always runs after a passing review and a reject cancels the run through `drop`, so the YAML changed without done.ts.',
    );
  }
  if (ship === null) {
    return stop(
      'ship',
      'Ship failed after the go (a model or tool error): no PR URL was recorded; check the branch before running it again, a commit or push may already exist.',
    );
  }
  if (!ship.pr_url) return stop('ship', `Ship did not open a PR: ${ship.summary}`);
  return {
    ok: true,
    stage: 'done',
    summary: `Draft PR open: ${ship.pr_url}. Review said ${review.code_verdict}: ${review.summary}`,
    pr_url: ship.pr_url,
  };
}

if (import.meta.main) {
  try {
    emit(
      decide(
        nullableJson(process.env.INPUTS_PLAN) as Plan | null,
        nullableJson(process.env.INPUTS_IMPLEMENT) as ImplementVerdict | null,
        nullableJson(process.env.INPUTS_LINT) as Lint | null,
        nullableJson(process.env.INPUTS_REVIEW) as ReviewVerdict | null,
        nullableJson(process.env.INPUTS_APPROVE) as Approve | null,
        nullableJson(process.env.INPUTS_SHIP) as Ship | null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
