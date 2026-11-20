/**
 * Dérive l'issue du bloc des faits certifiés en amont : les contrôles sont verts (la décision
 * a été calculée par la règle) et le juge a approuvé l'extraction. Trois issues :
 * - `unconverged` : contrôles encore rouges au plafond, juge sauté, aucune décision ;
 * - `rejected` : contrôles verts, juge défavorable ; la décision n'est pas rendue ;
 * - `verified` : contrôles verts, juge favorable ; la décision et ses raisons sont rendues.
 * Une décision n'est donc jamais rendue sans juge favorable : l'appelant classe sinon l'offre
 * « à vérifier ».
 *
 * Liaisons (`with:`) : INPUTS_PRODUCED (sortie de `check` au dernier tour), INPUTS_APPROVED,
 * INPUTS_REASON, INPUTS_FINDINGS ("null" quand le juge a été sauté).
 */

import { emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
  decision: string;
  reasons: string[];
  notes: string[];
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
    summary: `Checks still failing after ${produced.tries} round(s); the judge did not run. ${produced.summary}`,
    decision: '',
    reasons: [],
    notes: [],
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
    summary: `${produced.summary} Judge: ${text(process.env.INPUTS_REASON)}`,
    decision: ok ? produced.decision : '',
    reasons: ok ? produced.reasons : [],
    notes: ok ? produced.notes : [],
    problems: produced.problems,
    findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
    deliverable: produced.deliverable,
  });
}
