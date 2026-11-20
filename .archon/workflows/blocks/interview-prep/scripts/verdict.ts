/**
 * Dérive l'issue du bloc des faits certifiés en amont : les contrôles sont verts et le juge
 * a approuvé (note A- ou mieux, aucun constat bloquant). Trois issues :
 * - `unconverged` : la boucle a atteint son plafond de tours avec des contrôles encore
 *   rouges ; le juge n'a pas tourné (`when:`) ; ok: false avec les derniers problèmes ;
 * - `rejected` : contrôles verts, juge défavorable ;
 * - `verified` : contrôles verts, juge favorable.
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
  stories: number;
  coverage: number;
  deliverable: { type: 'archon_artifact'; run_id: string; path: string };
  tries: number;
}

const produced = nullableJson(process.env.INPUTS_PRODUCED) as Produced | null;
if (produced === null) {
  fail('verdict: the produce loop returned no output');
} else {
  const facts = ` ${produced.stories} histoire(s) STAR ; mots-clés de l'offre couverts : ${Math.round(produced.coverage * 100)} %.`;
  if (!produced.ok) {
    emit({
      ok: false,
      status: 'unconverged',
      summary: `Contrôles encore rouges après ${produced.tries} tour(s) ; le juge n'a pas tourné. ${produced.summary}${facts}`,
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
      summary: `${produced.summary}${facts} Juge : ${text(process.env.INPUTS_GRADE)} — ${text(process.env.INPUTS_REASON)}`,
      problems: produced.problems,
      findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
      deliverable: produced.deliverable,
    });
  }
}
