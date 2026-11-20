/**
 * Dérive l'issue du bloc des deux faits certifiés en amont : les contrôles sont verts et le
 * juge a approuvé. Trois issues :
 * - `unconverged` : la boucle a atteint son plafond de tours avec des contrôles encore
 *   rouges ; le juge n'a pas tourné (`when:`) ; ok: false avec les derniers problèmes ;
 * - `rejected` : contrôles verts, juge défavorable ;
 * - `verified` : contrôles verts, juge favorable.
 *
 * Liaisons (`with:`) :
 * - INPUTS_PRODUCED : la sortie finale de la boucle `produce`, c'est-à-dire la sortie
 *   typée du nœud `check` du dernier tour (JSON texte) ;
 * - INPUTS_APPROVED / INPUTS_REASON / INPUTS_FINDINGS : la sortie certifiée du juge, "null"
 *   quand le juge a été sauté (`if_skipped: null`).
 */

import { emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
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
    problems: produced.problems,
    findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
    deliverable: produced.deliverable,
  });
}
