/**
 * Verdict du bloc `implement` : pas de juge, le fait certifié est la sortie du contrôle du
 * dernier tour (tests verts et journal vidé). Deux issues :
 * - `verified` : tests verts, `## Reste` vide ;
 * - `unconverged` : au plafond de tours (8), tests encore rouges ou tâches restantes ;
 *   ok: false avec les derniers problèmes.
 * Liaison : INPUTS_PRODUCED (sortie finale de la boucle, celle du nœud `check` du dernier tour).
 */

import { emit, fail, nullableJson } from '../../.shared/io.ts';

interface Produced {
  ok: boolean;
  problems: string[];
  summary: string;
  tests_passed: boolean;
  remaining: number;
  deliverable: { type: 'archon_artifact'; run_id: string; path: string };
  tries: number;
}

const produced = nullableJson(process.env.INPUTS_PRODUCED) as Produced | null;
if (produced === null) {
  fail('verdict: the produce loop returned no output');
} else {
  const state = `Tests: ${produced.tests_passed ? 'green' : 'red'}; remaining tasks: ${produced.remaining}.`;
  emit({
    ok: produced.ok,
    status: produced.ok ? 'verified' : 'unconverged',
    summary: produced.ok
      ? `${produced.summary} ${state}`
      : `Checks still failing after ${produced.tries} round(s). ${state} ${produced.summary}`,
    problems: produced.problems,
    findings: [],
    deliverable: produced.deliverable,
  });
}
