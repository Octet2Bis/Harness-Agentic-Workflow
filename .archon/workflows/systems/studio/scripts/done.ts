/**
 * Issue typée du Studio, dérivée des verdicts certifiés des quatre blocs, de la réponse
 * humaine et du cadrage écrit dans les artefacts du run. `ok` n'est vrai que si les quatre
 * blocs ont rendu `ok: true` et que la vérification finale a approuvé. `stage` nomme le bloc
 * où ça s'est arrêté ; `type` et `next` disent quelle ligne suit (lus dans `calibrage.json`,
 * null et vide si le cadrage n'a pas abouti).
 *
 * Liaisons (`with:`) : INPUTS_CALIBRATE, INPUTS_BRIEF, INPUTS_DESIGN, INPUTS_CONTENT (verdicts,
 * null si le bloc a été sauté), INPUTS_REVIEW (réponse { decision, text }, null si sautée).
 *
 * Comme pour `pipeline` : verdict `unconverged` (contrôles rouges au plafond), `rejected`
 * (juge défavorable) ou null (un nœud du bloc a échoué) ; un refus humain passe par `drop`,
 * qui annule le run avant `done`, donc une autre réponse que « go » après quatre blocs `ok`
 * fait échouer le nœud au lieu d'inventer une issue.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, fail, nullableJson } from '../../.shared/io.ts';
import { COMMON_STEPS, type ProjectType, calibratedType, routeFor } from '../../.shared/studio.ts';

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
export type Stage = 'calibrate' | 'brief' | 'design-system' | 'content-base' | 'done';
export interface Outcome {
  ok: boolean;
  stage: Stage;
  summary: string;
  type: ProjectType | null;
  next: string[];
  deliverables: { calibrage: string | null; brief: string | null; design_system: string | null; content: string | null };
}

const BLOCKS = [
  ['calibrate', 'calibrate', 'Calibration'],
  ['brief', 'brief', 'Brief'],
  ['design', 'design-system', 'Design system'],
  ['content', 'content-base', 'Content base'],
] as const;

/** Les étapes qui restent après le tronc commun : la ligne du type, puis la fin commune. */
export function nextSteps(type: ProjectType | null): string[] {
  return type === null ? [] : routeFor(type).filter((step) => !(COMMON_STEPS as readonly string[]).includes(step));
}

export function decide(
  verdicts: { calibrate: Verdict | null; brief: Verdict | null; design: Verdict | null; content: Verdict | null },
  review: Review | null,
  calibration: string | null,
): Outcome {
  const type = verdicts.calibrate?.ok ? calibratedType('', calibration) : null;
  const deliverables = {
    calibrage: verdicts.calibrate?.deliverable.path ?? null,
    brief: verdicts.brief?.deliverable.path ?? null,
    design_system: verdicts.design?.deliverable.path ?? null,
    content: verdicts.content?.deliverable.path ?? null,
  };
  for (const [key, stage, name] of BLOCKS) {
    const verdict = verdicts[key];
    if (verdict?.ok) continue;
    const summary =
      verdict === null
        ? `${name} returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.`
        : verdict.status === 'unconverged'
          ? `${name} did not converge: ${verdict.summary}`
          : `${name} rejected: ${verdict.summary}`;
    return { ok: false, stage, summary, type, next: [], deliverables };
  }
  if (review?.decision !== 'approve') {
    throw new Error(
      `done: unexpected state: the four blocks passed but the final review answer is ${JSON.stringify(review)}; ` +
        '`review` always runs after a passing content base and a reject cancels the run through `drop`, so the YAML changed without done.ts.',
    );
  }
  const next = nextSteps(type);
  const lane = type === null ? '' : ` Next, the ${type} lane: ${next.join(' → ')}.`;
  return { ok: true, stage: 'done', summary: `Approved at final review. ${verdicts.content!.summary}${lane}`, type, next, deliverables };
}

if (import.meta.main) {
  try {
    const file = join(artifactsDir(), 'calibrage.json');
    emit(
      decide(
        {
          calibrate: nullableJson(process.env.INPUTS_CALIBRATE) as Verdict | null,
          brief: nullableJson(process.env.INPUTS_BRIEF) as Verdict | null,
          design: nullableJson(process.env.INPUTS_DESIGN) as Verdict | null,
          content: nullableJson(process.env.INPUTS_CONTENT) as Verdict | null,
        },
        nullableJson(process.env.INPUTS_REVIEW) as Review | null,
        existsSync(file) ? readFileSync(file, 'utf8') : null,
      ),
    );
  } catch (error) {
    fail((error as Error).message);
  }
}
