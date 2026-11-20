/**
 * Dérive l'issue du bloc des faits certifiés en amont : les contrôles sont verts et le juge
 * a approuvé (note A- ou mieux, aucun constat bloquant). Trois issues :
 * - `unconverged` : la boucle a atteint son plafond de tours avec des contrôles encore
 *   rouges ; le juge n'a pas tourné (`when:`) ; ok: false avec les derniers problèmes ;
 * - `rejected` : contrôles verts, juge défavorable ;
 * - `verified` : contrôles verts, juge favorable.
 *
 * Le verdict est aussi écrit dans `$ARTIFACTS_DIR/<out sans .json>.verdict.json` (défaut
 * `decideurs.verdict.json`), dans toutes les issues : le cockpit ne lit que les fichiers du
 * run, pas les sorties des nœuds, et recopie `decideurs.json` et ce fichier dans
 * `applications/<slug>/` une fois le run fini.
 *
 * Liaisons (`with:`) : INPUTS_PRODUCED (sortie typée de `check` au dernier tour),
 * INPUTS_APPROVED, INPUTS_GRADE, INPUTS_REASON, INPUTS_FINDINGS (sortie certifiée du juge,
 * "null" quand il a été sauté : `if_skipped: null`), INPUTS_OUT (le nom du livrable).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

export interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
  people: number;
  deliverable: { type: 'archon_artifact'; run_id: string; path: string };
  tries: number;
}

export interface Judge {
  approved: boolean;
  grade: string;
  reason: string;
  findings: unknown[];
}

export interface Verdict {
  ok: boolean;
  status: 'verified' | 'rejected' | 'unconverged';
  summary: string;
  problems: string[];
  findings: unknown[];
  deliverable: Produced['deliverable'];
}

/** L'issue, des deux faits certifiés : contrôles verts au dernier tour, juge favorable. */
export function decide(produced: Produced, judge: Judge): Verdict {
  const facts = ` ${produced.people} décideur(s) nommé(s), chacun avec sa source publique.`;
  if (!produced.ok) {
    return {
      ok: false,
      status: 'unconverged',
      summary: `Contrôles encore rouges après ${produced.tries} tour(s) ; le juge n'a pas tourné. ${produced.summary}${facts}`,
      problems: produced.problems,
      findings: [],
      deliverable: produced.deliverable,
    };
  }
  const ok = judge.approved;
  return {
    ok,
    status: ok ? 'verified' : 'rejected',
    summary: `${produced.summary}${facts} Juge : ${judge.grade} — ${judge.reason}`,
    problems: produced.problems,
    findings: judge.findings,
    deliverable: produced.deliverable,
  };
}

/** Le fichier du verdict, à côté du livrable : `decideurs.json` → `decideurs.verdict.json`. */
export function verdictFile(out: string): string {
  const name = out.trim() === '' ? 'decideurs.json' : out.trim();
  return `${name.replace(/\.json$/i, '')}.verdict.json`;
}

if (import.meta.main) {
  const produced = nullableJson(process.env.INPUTS_PRODUCED) as Produced | null;
  if (produced === null) {
    fail('verdict: the produce loop returned no output');
  } else {
    const verdict = decide(produced, {
      approved: flag(process.env.INPUTS_APPROVED),
      grade: text(process.env.INPUTS_GRADE),
      reason: text(process.env.INPUTS_REASON),
      findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
    });
    writeFileSync(join(artifactsDir(), verdictFile(text(process.env.INPUTS_OUT))), `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
    emit(verdict);
  }
}
