/**
 * Contrôle déterministe du brief : règles de `.shared/studio-checks.ts` (pures, testées).
 * Le type du projet vient de INPUTS_TYPE, sinon de `calibrage.json` dans les artefacts du run.
 * Liaisons : INPUTS_TYPE, INPUTS_OUT, INPUTS_SUMMARY, INPUTS_DELIVERABLE, INPUTS_TRIES.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { calibratedType, checkBrief } from '../../.shared/studio-checks.ts';

const read = (name: string): string | null => {
  const file = join(artifactsDir(), name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

const type = calibratedType(text(process.env.INPUTS_TYPE), read('calibrage.json'));
const result = checkBrief(read(text(process.env.INPUTS_OUT) || 'BRIEF.md'), type);
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
