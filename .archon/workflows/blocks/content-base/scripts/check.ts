/**
 * Contrôle déterministe de la base de contenu : règles de `.shared/studio-checks.ts` (pures,
 * testées). Tout chiffre du contenu doit figurer dans le matériau source : la demande, le
 * contexte, et le brief du run (`BRIEF.md`) s'il existe.
 * Liaisons : INPUTS_REQUEST, INPUTS_CONTEXT, INPUTS_LOCALES, INPUTS_OUT, INPUTS_SUMMARY,
 * INPUTS_DELIVERABLE, INPUTS_TRIES.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { checkContent, localeMismatch } from '../../.shared/studio-checks.ts';

const read = (name: string): string | null => {
  const file = join(artifactsDir(), name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

const raw = read(text(process.env.INPUTS_OUT) || 'content.json');
const source = [text(process.env.INPUTS_REQUEST), text(process.env.INPUTS_CONTEXT), read('BRIEF.md') ?? ''].join('\n');
const requested = text(process.env.INPUTS_LOCALES)
  .split(',')
  .map((locale) => locale.trim())
  .filter((locale) => locale !== '');
const problems = [...checkContent(raw, { source }).problems, ...localeMismatch(raw, requested)];
emit({
  ok: problems.length === 0,
  problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
