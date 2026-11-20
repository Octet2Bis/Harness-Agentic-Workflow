/**
 * Contrôle déterministe de la séquence : règles de `.shared/email-checks.ts` (pures, testées).
 * Liaisons : INPUTS_TOUCHES, INPUTS_MAX_WORDS, INPUTS_NOTICE, INPUTS_OUT, INPUTS_SUMMARY, INPUTS_DELIVERABLE.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SEQUENCE_RULES, checkSequence } from '../../.shared/email-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'sequence.md');
const touches = Number(text(process.env.INPUTS_TOUCHES) || '4');
const maxWords = Number(text(process.env.INPUTS_MAX_WORDS) || '120');
const result = checkSequence(existsSync(path) ? readFileSync(path, 'utf8') : null, {
  ...DEFAULT_SEQUENCE_RULES,
  touches: Number.isInteger(touches) && touches >= 2 && touches <= 6 ? touches : 4,
  maxWords: Number.isFinite(maxWords) && maxWords > 0 ? maxWords : 120,
  requireNotice: text(process.env.INPUTS_NOTICE).trim() === 'true',
});
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
