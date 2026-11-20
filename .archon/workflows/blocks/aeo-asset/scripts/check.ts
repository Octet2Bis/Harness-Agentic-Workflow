/**
 * Contrôle déterministe de l'actif : règles de `.shared/aeo-checks.ts` (pures, testées).
 * Liaisons : INPUTS_INTENT, INPUTS_OUT, INPUTS_SUMMARY, INPUTS_DELIVERABLE.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ASSET_RULES, checkAsset } from '../../.shared/aeo-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'asset.md');
const result = checkAsset(existsSync(path) ? readFileSync(path, 'utf8') : null, { ...DEFAULT_ASSET_RULES, intent: text(process.env.INPUTS_INTENT) });
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
