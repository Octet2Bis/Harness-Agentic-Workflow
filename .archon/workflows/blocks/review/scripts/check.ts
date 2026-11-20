/**
 * Contrôle déterministe du bloc `review` : forme et cohérence de `review.json` face à
 * `diff.patch` (règles de `.shared/review-checks.ts`). Liaisons : INPUTS_OUT, INPUTS_SUMMARY,
 * INPUTS_DELIVERABLE ; INPUTS_TRIES, le numéro du tour précédent (vide au premier), d'où
 * `tries` : la boucle s'arrête au plafond même si `ok` reste faux.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { checkReview } from '../../.shared/review-checks.ts';

const dir = artifactsDir();
const read = (name: string): string | null => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
const result = checkReview(read(text(process.env.INPUTS_OUT) || 'review.json'), read('diff.patch'));
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  code_verdict: result.code_verdict,
  blocking: result.blocking,
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
