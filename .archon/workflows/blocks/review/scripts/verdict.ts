/**
 * Verdict du bloc `review` : `ok` dit si la relecture est fiable (contrôles verts, juge
 * favorable) ; `code_verdict` répète ce que la relecture a conclu du code (pass | fail).
 * Trois issues :
 * - `unconverged` : la boucle a atteint son plafond de tours avec des contrôles encore
 *   rouges ; le juge n'a pas tourné (`when:`) ; ok: false avec les derniers problèmes, et
 *   `code_verdict: unknown` : un `review.json` qui ne passe pas ses contrôles ne dit rien de
 *   fiable sur le code, même s'il porte un « pass » ou un « fail » ;
 * - `rejected` : contrôles verts, juge défavorable ;
 * - `verified` : contrôles verts, juge favorable.
 * Liaisons : INPUTS_PRODUCED (sortie du `check` du dernier tour) ; INPUTS_APPROVED,
 * INPUTS_REASON, INPUTS_FINDINGS (sortie du juge, "null" quand il a été sauté, `if_skipped: null`).
 */

import { emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
  code_verdict: 'pass' | 'fail' | 'unknown';
  blocking: number;
  deliverable: { type: 'archon_artifact'; run_id: string; path: string };
  tries: number;
}

const produced = nullableJson(process.env.INPUTS_PRODUCED) as Produced | null;
if (produced === null) {
  fail('verdict: the produce loop returned no output');
} else if (!produced.ok) {
  emit({
    ok: false,
    status: 'unconverged',
    code_verdict: 'unknown',
    summary: `Checks still failing after ${produced.tries} round(s); the judge did not run. ${produced.summary}`,
    problems: produced.problems,
    findings: [],
    deliverable: produced.deliverable,
  });
} else {
  const approved = flag(process.env.INPUTS_APPROVED);
  const ok = produced.ok && approved;
  emit({
    ok,
    status: ok ? 'verified' : 'rejected',
    code_verdict: produced.code_verdict,
    summary: `Review says ${produced.code_verdict} (${produced.blocking} blocking). ${produced.summary} Judge: ${text(process.env.INPUTS_REASON)}`,
    problems: produced.problems,
    findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
    deliverable: produced.deliverable,
  });
}
