/**
 * Contrôle déterministe du rapport de recherche : titre `# `, sections attendues, au moins
 * trois sources distinctes, chaque constat cité par une source listée, aucun marqueur de
 * brouillon. Aucun jugement ici : la qualité des preuves va au juge.
 *
 * Liaisons (`with:`) : INPUTS_SUMMARY, INPUTS_DELIVERABLE, relayées dans la sortie.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckRules, DEFAULT_RULES, evaluateDeliverable } from '../../.shared/deliverable-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const RULES: CheckRules = {
  ...DEFAULT_RULES,
  requiredSections: ['Résumé', 'Constats', 'Sources', 'Limites'],
  minChars: 800,
};
const MIN_SOURCES = 3;
const SOURCE_LINE = /^\s*-\s*\[(S\d+)\]\s*(.*)$/;

/** Corps de la section `## <title>`, ou null si elle manque. */
function section(content: string, title: string): string | null {
  const after = content.split(new RegExp(`^## ${title}\\s*$`, 'm'))[1];
  return after === undefined ? null : after.split(/^## /m)[0];
}

export interface Source {
  id: string;
  /** Ce qui suit le dernier « — » (chemin, URL ou commande), sinon toute la ligne. */
  locator: string;
}

/** Sources listées en `- [S<n>] <quoi> — <où>` sous `## Sources`. */
export function listSources(content: string): Source[] {
  const body = section(content, 'Sources');
  if (body === null) return [];
  return body.split('\n').flatMap((line) => {
    const match = SOURCE_LINE.exec(line);
    if (!match) return [];
    const rest = match[2].trim();
    const cut = rest.lastIndexOf('—');
    const locator = (cut >= 0 ? rest.slice(cut + 1) : rest).trim().toLowerCase();
    return [{ id: match[1], locator }];
  });
}

/** Nombre de sources distinctes : un identifiant ou un emplacement répété ne compte qu'une fois. */
export function countSources(content: string): number {
  const ids = new Set<string>();
  const locators = new Set<string>();
  let count = 0;
  for (const source of listSources(content)) {
    if (ids.has(source.id) || (source.locator !== '' && locators.has(source.locator))) continue;
    ids.add(source.id);
    if (source.locator !== '') locators.add(source.locator);
    count += 1;
  }
  return count;
}

/** Problèmes de citation : constats sans `[S<n>]`, ou citant une source absente de `## Sources`. */
export function citationProblems(content: string): string[] {
  const body = section(content, 'Constats');
  if (body === null) return [];
  const listed = new Set(listSources(content).map((source) => source.id));
  const problems: string[] = [];
  const items = body.split('\n').filter((line) => /^\s*(?:\d+[.)]|[-*+])\s+\S/.test(line));
  if (items.length === 0) problems.push('"## Constats" lists no finding (numbered or bulleted)');
  items.forEach((line, index) => {
    const cited = [...line.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
    if (cited.length === 0) problems.push(`finding ${index + 1} cites no source [S<n>]`);
    for (const id of cited) {
      if (!listed.has(id)) problems.push(`finding ${index + 1} cites [${id}], which is not listed under "## Sources"`);
    }
  });
  return problems;
}

export function checkResearch(content: string | null): { ok: boolean; problems: string[] } {
  const base = evaluateDeliverable(content, RULES);
  if (content === null) return base;
  const problems = [...base.problems];
  if (!/^# \S/m.test(content)) problems.push('no "# <title>" line restating the question');
  const sources = countSources(content);
  if (sources < MIN_SOURCES) {
    problems.push(`only ${sources} distinct source(s) listed as "- [S<n>] <what> — <where>" under "## Sources"; at least ${MIN_SOURCES} expected`);
  }
  problems.push(...citationProblems(content));
  return { ok: problems.length === 0, problems };
}

if (import.meta.main) {
  const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'deliverable.md');
  const result = checkResearch(existsSync(path) ? readFileSync(path, 'utf8') : null);
  emit({
    ok: result.ok,
    problems: result.problems,
    summary: text(process.env.INPUTS_SUMMARY),
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
