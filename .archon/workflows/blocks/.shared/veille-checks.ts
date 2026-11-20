/**
 * Contrôles déterministes d'une fiche de veille (pôle 03 Recherche & veille de Master Plan,
 * et le bot Telegram « research » qui indexe les reels Instagram et les liens) : sections,
 * date valide, source conservée, catégorie connue, sources avec URL et date, recommandation
 * qui nomme un pilier, aucune phrase du gabarit automatique. Purs, testés.
 */

import { evaluateDeliverable } from './deliverable-checks.ts';

export const DEFAULT_CATEGORIES: string[] = ['IA & Systèmes Multi-Agents', 'UI & Animations', 'GTM & Growth', 'Dev & Outils', 'Carrière', 'Autre'];

/** Phrases du gabarit de `research_bot_engine.js` : une fiche qui les contient n'a rien lu. */
export const TEMPLATE_PHRASES: string[] = [
  'ressource indexée dans la catégorie',
  'consulter la ressource pour extraction',
  "analyse de l'impact visuel et intégration de composants interactifs",
  'automatisation de flux et enrichissement du second cerveau',
];

export const PILLARS: string[] = ['01_GTM_Growth', '02_Assistant_Personnel', '03_Developpement_App_and_Design'];

export const FICHE_SECTIONS: string[] = ["De quoi s'agit-il", 'Problème', 'Impact', 'Recommandation immédiate', 'Sources', 'Limites'];

export interface FicheMeta {
  date: string;
  source: string;
  category: string;
}

export function readMeta(markdown: string): FicheMeta {
  const grab = (label: string): string => markdown.match(new RegExp(`^-\\s*\\*\\*${label}\\s*:?\\*\\*\\s*:?\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? '';
  return { date: grab('Date'), source: grab('Source'), category: grab('Catégorie') };
}

export function section(markdown: string, title: string): string {
  const parts = markdown.split(/^##\s+/m).slice(1);
  const found = parts.find((part) => part.split('\n')[0].trim().toLowerCase() === title.toLowerCase());
  return found ? found.split('\n').slice(1).join('\n').trim() : '';
}

/** Puces de sources : `- [S1] <quoi> — <URL> (YYYY-MM-DD)`. */
export function parseSources(markdown: string): { url: string; date: string; line: string }[] {
  return section(markdown, 'Sources')
    .split('\n')
    .filter((line) => /^\s*-\s*\[S\d+\]/.test(line))
    .map((line) => ({ line: line.trim(), url: line.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.]+$/, '') ?? '', date: line.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ?? '' }));
}

export function isValidDate(value: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && time <= today.getTime() + 24 * 60 * 60 * 1000;
}

export interface FicheRules {
  source: string;
  categories: string[];
  today: Date;
  minChars: number;
}

export function checkFiche(content: string | null, rules: FicheRules): { ok: boolean; problems: string[]; category: string } {
  const base = evaluateDeliverable(content, { requiredSections: FICHE_SECTIONS, minChars: rules.minChars, forbiddenMarkers: ['TODO', 'TBD', 'lorem ipsum', '<placeholder>'] });
  if (content === null) return { ok: false, problems: base.problems, category: '' };
  const problems = [...base.problems];
  const meta = readMeta(content);
  if (!isValidDate(meta.date, rules.today)) problems.push(`missing or invalid "- **Date :** YYYY-MM-DD" (got "${meta.date}")`);
  if (meta.source === '') problems.push('missing "- **Source :** <url or reference>"');
  else if (/^https?:\/\//.test(rules.source) && !meta.source.includes(rules.source.trim())) problems.push(`the Source line does not carry the input source (${rules.source})`);
  if (!rules.categories.some((category) => category.toLowerCase() === meta.category.toLowerCase())) {
    problems.push(`category "${meta.category}" is not one of: ${rules.categories.join(', ')}`);
  }
  const lower = content.toLowerCase();
  for (const phrase of TEMPLATE_PHRASES) if (lower.includes(phrase)) problems.push(`template phrase found (nothing was actually read): "${phrase}"`);
  const sources = parseSources(content);
  if (sources.length === 0) problems.push('no source listed as "- [S<n>] <what> — <URL> (YYYY-MM-DD)" under "## Sources"');
  for (const src of sources) {
    if (src.url === '') problems.push(`source without URL: ${src.line}`);
    if (!isValidDate(src.date, rules.today)) problems.push(`source without a valid date (YYYY-MM-DD): ${src.line}`);
  }
  const reco = section(content, 'Recommandation immédiate');
  if (reco !== '' && !PILLARS.some((pillar) => reco.includes(pillar)) && !/aucune action/i.test(reco)) {
    problems.push(`"Recommandation immédiate" must name where it lands (${PILLARS.join(' | ')}) or say "Aucune action"`);
  }
  return { ok: problems.length === 0, problems, category: meta.category };
}
