/**
 * Contrôle déterministe du rapport final : titre `# `, sections attendues, 6 000 caractères
 * au plus (il se lit en cinq minutes), au moins une recommandation, une prochaine étape et
 * une source retrouvable (URL ou chemin de fichier), aucun marqueur de brouillon.
 *
 * Liaisons (`with:`) : INPUTS_SUMMARY, INPUTS_DELIVERABLE, relayées dans la sortie.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckRules, DEFAULT_RULES, evaluateDeliverable } from '../../.shared/deliverable-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const RULES: CheckRules = {
  ...DEFAULT_RULES,
  requiredSections: ['Synthèse', 'Résultats', 'Recommandations', 'Prochaines étapes', 'Sources'],
  minChars: 400,
  maxChars: 6000,
};

/** Une puce qui pointe vers quelque chose qu'on peut rouvrir : une URL ou un chemin de fichier. */
const LOCATOR = /https?:\/\/\S+|[\w.-]+\/[\w./-]*\w|\b[\w-]+\.(?:md|json|ya?ml|ts|js|csv|pdf|html|txt)\b/;

/** Le corps d'une section `## <name>`, ou null si elle manque. */
export function section(content: string, name: string): string | null {
  const parts = content.split(new RegExp(`^## ${name}\\s*$`, 'm'));
  if (parts[1] === undefined) return null;
  return parts[1].split(/^## /m)[0];
}

export function countBullets(body: string): number {
  return body.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

export function countNumbered(body: string): number {
  return body.split('\n').filter((line) => /^\s*\d+[.)]\s+\S/.test(line)).length;
}

/** Puces de `## Sources` qui portent une URL ou un chemin de fichier. */
export function countSourceRefs(body: string): number {
  return body.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line) && LOCATOR.test(line)).length;
}

export function checkReport(content: string | null): { ok: boolean; problems: string[] } {
  const base = evaluateDeliverable(content, RULES);
  if (content === null) return base;
  const problems = [...base.problems];
  if (!/^# \S/m.test(content)) problems.push('no "# <title>" line');
  if (countBullets(section(content, 'Recommandations') ?? '') < 1) {
    problems.push('no bulleted recommendation under "## Recommandations"');
  }
  if (countNumbered(section(content, 'Prochaines étapes') ?? '') < 1) {
    problems.push('no numbered step under "## Prochaines étapes"');
  }
  if (section(content, 'Sources') !== null && countSourceRefs(section(content, 'Sources') ?? '') < 1) {
    problems.push('no source under "## Sources" pointing at a URL or a file path');
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'deliverable.md');
  const result = checkReport(existsSync(path) ? readFileSync(path, 'utf8') : null);
  emit({
    ok: result.ok,
    problems: result.problems,
    summary: text(process.env.INPUTS_SUMMARY),
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
