/**
 * Contrôle déterministe de la fiche : règles de `.shared/veille-checks.ts` (pures, testées).
 * Liaisons : INPUTS_SOURCE, INPUTS_CATEGORIES, INPUTS_OUT, INPUTS_SUMMARY, INPUTS_READ_CONTENT,
 * INPUTS_DELIVERABLE.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, flag, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { DEFAULT_CATEGORIES, checkFiche } from '../../.shared/veille-checks.ts';

const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'fiche.md');
const categories = text(process.env.INPUTS_CATEGORIES)
  .split(',')
  .map((category) => category.trim())
  .filter((category) => category !== '');
const result = checkFiche(existsSync(path) ? readFileSync(path, 'utf8') : null, {
  source: text(process.env.INPUTS_SOURCE),
  categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
  today: new Date(),
  minChars: flag(process.env.INPUTS_READ_CONTENT) ? 900 : 300,
});
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  category: result.category,
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
