/**
 * Contrôle déterministe du document de design : sections attendues, au moins deux
 * options, un plan d'au moins trois étapes numérotées, aucun marqueur de brouillon.
 *
 * Liaisons (`with:`) : INPUTS_SUMMARY, INPUTS_DELIVERABLE, relayées dans la sortie.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckRules, DEFAULT_RULES, evaluateDeliverable } from '../../.shared/deliverable-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const RULES: CheckRules = {
  ...DEFAULT_RULES,
  requiredSections: ['Objectif', 'Options', 'Décision', 'Plan', 'Risques'],
  minChars: 600,
};
const MIN_OPTIONS = 2;
const MIN_STEPS = 3;

/** Le corps d'une section `## <name>`, ou null si elle manque. */
export function section(content: string, name: string): string | null {
  const parts = content.split(new RegExp(`^## ${name}\\s*$`, 'm'));
  if (parts[1] === undefined) return null;
  return parts[1].split(/^## /m)[0];
}

export function countOptions(content: string): number {
  const body = section(content, 'Options') ?? '';
  return body.split('\n').filter((line) => /^### Option\s+\d+/i.test(line)).length;
}

export function countSteps(content: string): number {
  const body = section(content, 'Plan') ?? '';
  return body.split('\n').filter((line) => /^\s*\d+[.)]\s+\S/.test(line)).length;
}

export function checkDesign(content: string | null): { ok: boolean; problems: string[] } {
  const base = evaluateDeliverable(content, RULES);
  if (content === null) return base;
  const problems = [...base.problems];
  const options = countOptions(content);
  if (options < MIN_OPTIONS) {
    problems.push(`only ${options} "### Option <n>" subsection(s) under "## Options"; at least ${MIN_OPTIONS} expected`);
  }
  const steps = countSteps(content);
  if (steps < MIN_STEPS) {
    problems.push(`only ${steps} numbered step(s) under "## Plan"; at least ${MIN_STEPS} expected`);
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'deliverable.md');
  const result = checkDesign(existsSync(path) ? readFileSync(path, 'utf8') : null);
  emit({
    ok: result.ok,
    problems: result.problems,
    summary: text(process.env.INPUTS_SUMMARY),
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
