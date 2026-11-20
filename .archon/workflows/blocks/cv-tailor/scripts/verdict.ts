/**
 * Dérive l'issue du bloc des faits certifiés en amont : les contrôles sont verts et le
 * Reviewer a approuvé (note A- ou mieux, aucun constat bloquant). Trois issues :
 * - `unconverged` : la boucle a atteint son plafond de tours avec des contrôles encore
 *   rouges ; le Reviewer n'a pas tourné (`when:`) ; ok: false avec les derniers problèmes
 *   et la couverture des mots-clés du dernier tour ;
 * - `rejected` : contrôles verts, Reviewer défavorable ;
 * - `verified` : contrôles verts, Reviewer favorable.
 *
 * Liaisons (`with:`) : INPUTS_PRODUCED (sortie typée de `check` au dernier tour),
 * INPUTS_APPROVED, INPUTS_GRADE, INPUTS_REASON, INPUTS_FINDINGS (sortie certifiée du juge,
 * "null" quand il a été sauté : `if_skipped: null`).
 */

import { emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
  coverage: { covered: string[]; missing: string[]; ratio: number };
  deliverable: { type: 'archon_artifact'; run_id: string; path: string };
  tries: number;
}

const produced = nullableJson(process.env.INPUTS_PRODUCED) as Produced | null;
if (produced === null) {
  fail('verdict: the produce loop returned no output');
} else {
  const coverage = produced.coverage ? ` Keywords covered: ${Math.round(produced.coverage.ratio * 100)}%.` : '';
  if (!produced.ok) {
    emit({
      ok: false,
      status: 'unconverged',
      summary: `Checks still failing after ${produced.tries} round(s); the judge did not run. ${produced.summary}${coverage}`,
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
      summary: `${produced.summary}${coverage} Reviewer: ${text(process.env.INPUTS_GRADE)} — ${text(process.env.INPUTS_REASON)}`,
      problems: produced.problems,
      findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
      deliverable: produced.deliverable,
    });
  }
}
