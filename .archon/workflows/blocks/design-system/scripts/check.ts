/**
 * Contrôle déterministe du design system : `tokens.json` (contrastes WCAG AA dans les deux
 * thèmes, échelles, grille, composants) et `design-system.md` (sections, composants décrits
 * par leurs jetons). Règles de `.shared/studio-checks.ts` (pures, testées).
 * Liaisons : INPUTS_TYPE (vide : `calibrage.json`), INPUTS_TOKENS_OUT, INPUTS_OUT,
 * INPUTS_SUMMARY, INPUTS_DELIVERABLE, INPUTS_TRIES.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { calibratedType, checkDesignDoc, checkTokens, undocumentedComponents } from '../../.shared/studio-checks.ts';

const read = (name: string): string | null => {
  const file = join(artifactsDir(), name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

const type = calibratedType(text(process.env.INPUTS_TYPE), read('calibrage.json'));
const tokens = read(text(process.env.INPUTS_TOKENS_OUT) || 'tokens.json');
const doc = read(text(process.env.INPUTS_OUT) || 'design-system.md');
const problems = [
  ...checkTokens(tokens, type).problems,
  ...checkDesignDoc(doc).problems,
  ...undocumentedComponents(tokens, doc).map((name) => `design-system.md: component "${name}" is in tokens.json but not described under "## Composants"`),
];
emit({
  ok: problems.length === 0,
  problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
