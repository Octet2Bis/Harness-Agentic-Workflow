/**
 * Contrôle déterministe du cadrage : règles de `.shared/studio-checks.ts` (pures, testées).
 * Liaisons : INPUTS_REQUEST, INPUTS_CONTEXT (les citations y sont cherchées mot pour mot),
 * INPUTS_PROJECT_DIR (les fichiers `existing` y sont cherchés ; vide : non vérifiés), INPUTS_OUT,
 * INPUTS_SUMMARY, INPUTS_DELIVERABLE, INPUTS_TRIES.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { checkCalibration } from '../../.shared/studio-checks.ts';

const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'calibrage.json');
const projectDir = text(process.env.INPUTS_PROJECT_DIR).trim();

/** Un fichier cité existe dans le dossier du projet (chemin relatif, ou absolu sous ce dossier). */
function inProject(file: string): boolean {
  const full = isAbsolute(file) ? file : join(projectDir, file);
  return !relative(projectDir, full).startsWith('..') && existsSync(full);
}

const result = checkCalibration(existsSync(path) ? readFileSync(path, 'utf8') : null, {
  request: `${text(process.env.INPUTS_REQUEST)}\n${text(process.env.INPUTS_CONTEXT)}`,
  exists: projectDir === '' ? undefined : inProject,
});
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
