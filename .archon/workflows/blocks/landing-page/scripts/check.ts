/**
 * Contrôle déterministe de la page : règles de `.shared/landing-checks.ts` (pures, testées).
 * Liaisons : INPUTS_OUT, INPUTS_SUMMARY, INPUTS_DELIVERABLE.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { checkLanding } from '../../.shared/landing-checks.ts';

const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'index.html');
const result = checkLanding(existsSync(path) ? readFileSync(path, 'utf8') : null);
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
