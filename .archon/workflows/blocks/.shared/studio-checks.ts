/**
 * Contrôles déterministes du Studio (pilier dev & design, UC-14) : cadrage, brief, design
 * system, base de contenu. Fonctions pures, sans disque : les scripts `check.ts` des blocs
 * lisent les fichiers et appellent ces fonctions ; les tests (`studio-checks.test.ts`)
 * prouvent chaque règle contre un cas qui doit échouer.
 *
 * Ce que le code tranche ici : la forme, la cohérence entre les étapes (le type du cadrage
 * dicte la plateforme du brief et la route), l'accessibilité mesurable (contrastes WCAG),
 * la régularité des échelles, la parité des langues, et qu'aucun chiffre n'est inventé.
 * Ce qu'il ne tranche pas (le type est-il le bon, la direction est-elle juste, le ton
 * colle-t-il) va au juge.
 */

import { hasMarker } from './deliverable-checks.ts';

export type ProjectType = 'graphique' | 'site' | 'app';
export const PROJECT_TYPES: readonly ProjectType[] = ['graphique', 'site', 'app'];

/** Le tronc commun, puis une ligne par type, puis la fin commune (tableau « Studio »). */
export const COMMON_STEPS = ['brief', 'design-system', 'content-base'] as const;
export const LANE_STEPS: Record<ProjectType, readonly string[]> = {
  graphique: ['direction-artistique', 'declinaisons', 'kit-de-marque'],
  site: ['arborescence', 'pages', 'seo-tracking'],
  app: ['prd', 'ecrans', 'fonctionnalites'],
};
export const FINISH_STEPS = ['qa-finale', 'go', 'diffusion'] as const;

/** La route qu'un type impose : le cadrage ne l'invente pas, il la recopie. */
export function routeFor(type: ProjectType): string[] {
  return [...COMMON_STEPS, ...LANE_STEPS[type], ...FINISH_STEPS];
}

/** Les plateformes admises par type. Un site vit sur le web ; une app nomme ses cibles. */
export const PLATFORMS: Record<ProjectType, readonly string[]> = {
  graphique: ['print', 'social', 'web', 'video', 'packaging', 'signaletique'],
  site: ['web'],
  app: ['ios', 'android', 'web', 'desktop'],
};

export interface StudioResult {
  ok: boolean;
  problems: string[];
}

export const DRAFT_MARKERS = ['TODO', 'TBD', 'lorem ipsum', 'lorem', '<placeholder>', 'XXX', '{{'];

/** Texte comparé sans casse, sans accents typographiques ni espaces multiples. */
export function normalize(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseJson(raw: string | null, file: string): { value: unknown; problem: string | null } {
  if (raw === null) return { value: null, problem: `${file} is missing in $ARTIFACTS_DIR` };
  try {
    return { value: JSON.parse(raw) as unknown, problem: null };
  } catch (error) {
    return { value: null, problem: `${file} is not valid JSON: ${(error as Error).message}` };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── 1. Cadrage ──────────────────────────────────────────────────────────────

export interface Calibration {
  type: ProjectType;
  evidence: string[];
  deliverables: string[];
  platforms: string[];
  existing: string[];
  route: string[];
}

export interface CalibrationOptions {
  /** La demande telle qu'écrite par le demandeur (et le contexte joint) : les citations y sont cherchées. */
  request: string;
  /** Le chemin cité existe-t-il dans le projet ? Absent : la liste `existing` n'est pas vérifiée. */
  exists?: (path: string) => boolean;
}

export function checkCalibration(raw: string | null, options: CalibrationOptions): StudioResult & { type: ProjectType | null } {
  const { value, problem } = parseJson(raw, 'calibrage.json');
  if (problem !== null) return { ok: false, problems: [problem], type: null };
  if (!isObject(value)) return { ok: false, problems: ['calibrage.json must be a JSON object'], type: null };
  const problems: string[] = [];
  const type = value.type;
  const known = typeof type === 'string' && (PROJECT_TYPES as readonly string[]).includes(type);
  if (!known) problems.push(`type must be one of ${PROJECT_TYPES.join(', ')} (got ${JSON.stringify(type)})`);

  const request = normalize(options.request);
  if (!isStringList(value.evidence) || value.evidence.length === 0) {
    problems.push('evidence: quote at least one passage of the request, word for word, that decides the type');
  } else {
    for (const quote of value.evidence) {
      if (normalize(quote).length < 8) problems.push(`evidence "${quote}" is too short to prove anything (8 characters at least)`);
      else if (!request.includes(normalize(quote))) problems.push(`evidence "${quote}" is not in the request, word for word`);
    }
  }

  if (!isStringList(value.deliverables) || value.deliverables.filter((d) => d.trim() !== '').length === 0) {
    problems.push('deliverables: name at least one thing that must exist at the end');
  }

  if (!isStringList(value.platforms) || value.platforms.length === 0) {
    problems.push('platforms: name at least one target platform');
  } else if (known) {
    const allowed = PLATFORMS[type as ProjectType];
    for (const platform of value.platforms) {
      if (!allowed.includes(platform)) problems.push(`platform "${platform}" does not fit a ${type} project (allowed: ${allowed.join(', ')})`);
    }
  }

  if (!isStringList(value.existing)) {
    problems.push('existing: a list (possibly empty) of project files already done');
  } else if (options.exists !== undefined) {
    for (const path of value.existing) {
      if (!options.exists(path)) problems.push(`existing "${path}" does not exist in the project folder`);
    }
  }

  if (!isStringList(value.route)) {
    problems.push('route: the list of steps for this type');
  } else if (known) {
    const expected = routeFor(type as ProjectType);
    if (value.route.join('>') !== expected.join('>')) {
      problems.push(`route must be exactly ${expected.join(' → ')} for a ${type} project`);
    }
  }
  return { ok: problems.length === 0, problems, type: known ? (type as ProjectType) : null };
}

// ── Sections Markdown ───────────────────────────────────────────────────────

/** Le corps de chaque section `## Titre`, indexé par titre normalisé. */
export function sections(markdown: string): Map<string, string> {
  const result = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      if (current !== null) result.set(current, buffer.join('\n').trim());
      current = normalize(heading[1] ?? '');
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  if (current !== null) result.set(current, buffer.join('\n').trim());
  return result;
}

function bullets(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line))
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim());
}

function draftProblems(text: string, file: string): string[] {
  return DRAFT_MARKERS.filter((marker) => hasMarker(text, marker)).map((marker) => `${file}: draft marker found: "${marker}"`);
}

// ── 2. Brief ────────────────────────────────────────────────────────────────

export const BRIEF_SECTIONS = ['Problème', 'Cible', "Contexte d'usage", 'Hors-champ', 'Appétit', 'Plateforme', 'Critères de réussite'];

/** Les mots qui, dans la section Plateforme, désignent chaque plateforme admise. */
const PLATFORM_WORDS: Record<string, RegExp> = {
  print: /\b(print|imprim|papier)/i,
  social: /\b(réseaux sociaux|social|instagram|linkedin|tiktok|pinterest)/i,
  web: /\b(web|navigateur|site|vercel|wix)/i,
  video: /\b(vid[ée]o|motion)/i,
  packaging: /\b(packaging|emballage)/i,
  signaletique: /\b(signal[ée]tique)/i,
  ios: /\b(ios|iphone|ipad|swift)/i,
  android: /\b(android|kotlin)/i,
  desktop: /\b(desktop|macos|windows|bureau)/i,
};

export function checkBrief(content: string | null, type: ProjectType | null): StudioResult {
  if (content === null) return { ok: false, problems: ['BRIEF.md is missing in $ARTIFACTS_DIR'] };
  const body = content.trim();
  const problems: string[] = [];
  if (body.length < 600) problems.push(`BRIEF.md is too short: ${body.length} chars, at least 600`);
  if (body.length > 6000) problems.push(`BRIEF.md is too long: ${body.length} chars, at most 6000 (a brief is read in two minutes)`);
  if (!/^#\s+\S/m.test(body)) problems.push('BRIEF.md needs a title line "# …"');
  const found = sections(body);
  for (const section of BRIEF_SECTIONS) {
    if (!found.has(normalize(section))) problems.push(`BRIEF.md: missing section "## ${section}"`);
  }
  const outOfScope = bullets(found.get(normalize('Hors-champ')) ?? '');
  if (found.has(normalize('Hors-champ')) && outOfScope.length < 3) {
    problems.push(`Hors-champ: at least 3 items, each a thing the project will NOT do (found ${outOfScope.length})`);
  }
  const success = bullets(found.get(normalize('Critères de réussite')) ?? '');
  if (found.has(normalize('Critères de réussite')) && success.length < 2) {
    problems.push(`Critères de réussite: at least 2 items someone can check at the end (found ${success.length})`);
  }
  const platform = found.get(normalize('Plateforme')) ?? '';
  if (type === null) {
    problems.push('the calibration type is unknown: run the calibration first (calibrage.json) or pass `type`');
  } else if (found.has(normalize('Plateforme'))) {
    const named = PLATFORMS[type].filter((p) => PLATFORM_WORDS[p]?.test(platform) === true);
    if (named.length === 0) {
      problems.push(`Plateforme: name at least one platform a ${type} project targets (${PLATFORMS[type].join(', ')})`);
    }
  }
  problems.push(...draftProblems(body, 'BRIEF.md'));
  return { ok: problems.length === 0, problems };
}

// ── 3. Design system ────────────────────────────────────────────────────────

export const COLOR_ROLES = ['bg', 'surface', 'fg', 'muted', 'accent', 'border'] as const;
export const DESIGN_SECTIONS = ['Intention', 'Couleurs', 'Typographie', 'Espacements', 'Composants', "Règles d'usage"];

/** Luminance relative WCAG 2.x d'une couleur `#rrggbb`. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Les paires vérifiées et leur seuil : texte 4.5:1 (WCAG AA), élément d'interface 3:1. */
export const CONTRAST_PAIRS: ReadonlyArray<{ fg: string; bg: string; min: number }> = [
  { fg: 'fg', bg: 'bg', min: 4.5 },
  { fg: 'fg', bg: 'surface', min: 4.5 },
  { fg: 'muted', bg: 'bg', min: 4.5 },
  { fg: 'accent', bg: 'bg', min: 3 },
];

const INTERACTIVE_STATES = ['hover', 'pressed', 'active'];

export function checkTokens(raw: string | null, type: ProjectType | null): StudioResult {
  const { value, problem } = parseJson(raw, 'tokens.json');
  if (problem !== null) return { ok: false, problems: [problem] };
  if (!isObject(value)) return { ok: false, problems: ['tokens.json must be a JSON object'] };
  const problems: string[] = [];

  const color = value.color;
  if (!isObject(color) || !isObject(color.light) || !isObject(color.dark)) {
    problems.push('color.light and color.dark are both required (every page is read in both themes)');
  } else {
    for (const theme of ['light', 'dark'] as const) {
      const palette = color[theme] as Record<string, unknown>;
      for (const role of COLOR_ROLES) {
        const hex = palette[role];
        if (typeof hex !== 'string' || !HEX.test(hex)) problems.push(`color.${theme}.${role} must be a #rrggbb colour`);
      }
    }
    const light = Object.keys(color.light).sort().join(',');
    const dark = Object.keys(color.dark).sort().join(',');
    if (light !== dark) problems.push('color.light and color.dark must define the same roles');
    for (const theme of ['light', 'dark'] as const) {
      const palette = color[theme] as Record<string, string>;
      for (const pair of CONTRAST_PAIRS) {
        const a = palette[pair.fg];
        const b = palette[pair.bg];
        if (a === undefined || b === undefined || !HEX.test(a) || !HEX.test(b)) continue;
        const ratio = contrast(a, b);
        if (ratio < pair.min) {
          problems.push(`contrast ${theme} ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, at least ${pair.min}:1 required (WCAG AA)`);
        }
      }
    }
  }

  const font = value.font;
  if (!isObject(font) || typeof font.display !== 'string' || typeof font.body !== 'string' || font.display.trim() === '' || font.body.trim() === '') {
    problems.push('font.display and font.body are required (family names with a fallback stack)');
  }

  const scale = value.type_scale;
  if (!Array.isArray(scale) || scale.length < 5 || !scale.every((n) => typeof n === 'number' && n > 0)) {
    problems.push('type_scale: at least 5 sizes in px, ascending');
  } else {
    const sizes = scale as number[];
    for (let i = 1; i < sizes.length; i++) {
      const ratio = (sizes[i] as number) / (sizes[i - 1] as number);
      if (ratio <= 1) problems.push(`type_scale must ascend: ${sizes[i - 1]} then ${sizes[i]}`);
      else if (ratio < 1.05 || ratio > 1.7) problems.push(`type_scale step ${sizes[i - 1]} → ${sizes[i]} has ratio ${ratio.toFixed(2)}, keep each step between 1.05 and 1.7`);
    }
    if (!sizes.some((n) => n >= 14 && n <= 18)) problems.push('type_scale needs a body size between 14 and 18 px');
  }

  const space = value.space;
  if (!Array.isArray(space) || space.length < 5 || !space.every((n) => typeof n === 'number' && n > 0)) {
    problems.push('space: at least 5 steps in px, ascending');
  } else {
    const steps = space as number[];
    const base = steps[0] as number;
    if (![2, 4, 8].includes(base)) problems.push(`space must start at a base of 2, 4 or 8 px (got ${base})`);
    for (let i = 1; i < steps.length; i++) {
      if ((steps[i] as number) <= (steps[i - 1] as number)) problems.push(`space must ascend: ${steps[i - 1]} then ${steps[i]}`);
    }
    const offGrid = steps.filter((n) => n % base !== 0);
    if (offGrid.length > 0) problems.push(`space steps off the ${base} px grid: ${offGrid.join(', ')}`);
  }

  const radius = value.radius;
  if (!isObject(radius) || Object.keys(radius).length === 0 || !Object.values(radius).every((n) => typeof n === 'number' && n >= 0)) {
    problems.push('radius: at least one named radius in px');
  }

  const components = value.components;
  const minComponents = type === 'graphique' ? 1 : 3;
  if (!Array.isArray(components) || components.length < minComponents) {
    problems.push(`components: at least ${minComponents} for a ${type ?? 'project'} (name, tokens used, states)`);
  } else {
    for (const component of components) {
      if (!isObject(component) || typeof component.name !== 'string' || component.name.trim() === '') {
        problems.push('each component needs a name');
        continue;
      }
      const name = component.name;
      if (!isStringList(component.tokens) || component.tokens.length === 0) {
        problems.push(`component ${name}: list the tokens it uses`);
      } else {
        for (const ref of component.tokens) {
          if (!tokenExists(value, ref)) problems.push(`component ${name}: token "${ref}" is not defined in tokens.json`);
        }
      }
      if (!isStringList(component.states) || !component.states.includes('default')) {
        problems.push(`component ${name}: states must include "default"`);
      } else if (component.states.some((s) => INTERACTIVE_STATES.includes(s)) && !component.states.includes('focus')) {
        problems.push(`component ${name}: an interactive component needs a "focus" state (keyboard users)`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Une référence `color.accent`, `font.body`, `radius.md`, `space` ou `type_scale` existe-t-elle ? */
export function tokenExists(tokens: Record<string, unknown>, ref: string): boolean {
  const [group, key] = ref.split('.');
  if (group === 'space' || group === 'type_scale') return Array.isArray(tokens[group]) && key === undefined;
  if (group === 'color') {
    const color = tokens.color;
    return isObject(color) && isObject(color.light) && key !== undefined && key in color.light;
  }
  const bucket = group === undefined ? undefined : tokens[group];
  return isObject(bucket) && key !== undefined && key in bucket;
}

export function checkDesignDoc(content: string | null): StudioResult {
  if (content === null) return { ok: false, problems: ['design-system.md is missing in $ARTIFACTS_DIR'] };
  const body = content.trim();
  const problems: string[] = [];
  if (body.length < 800) problems.push(`design-system.md is too short: ${body.length} chars, at least 800`);
  const found = sections(body);
  for (const section of DESIGN_SECTIONS) {
    if (!found.has(normalize(section))) problems.push(`design-system.md: missing section "## ${section}"`);
  }
  if (/#[0-9a-fA-F]{6}\b/.test(found.get(normalize('Composants')) ?? '')) {
    problems.push('design-system.md: a component is described with a raw colour; use the token name instead');
  }
  problems.push(...draftProblems(body, 'design-system.md'));
  return { ok: problems.length === 0, problems };
}

// ── 4. Base de contenu ──────────────────────────────────────────────────────

const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

/** Les nombres d'un texte (12, 3,5, 1 200, 45 %), tels qu'on les cherchera dans la source. */
export function numbersIn(value: string): string[] {
  const matches = value.match(/\d+(?:[\s  ]\d{3})*(?:[.,]\d+)?/g) ?? [];
  return matches.map((m) => m.replace(/[\s  ]/g, '').replace(',', '.'));
}

export interface ContentOptions {
  /** Le matériau source (demande, brief, contexte) : tout nombre du contenu doit y figurer. */
  source: string;
  /** Nombre minimal d'entrées (défaut 5). */
  minEntries?: number;
}

export function checkContent(raw: string | null, options: ContentOptions): StudioResult {
  const { value, problem } = parseJson(raw, 'content.json');
  if (problem !== null) return { ok: false, problems: [problem] };
  if (!isObject(value)) return { ok: false, problems: ['content.json must be a JSON object'] };
  const problems: string[] = [];

  const locales = value.locales;
  const validLocales = isStringList(locales) && locales.length > 0 && locales.every((l) => LOCALE.test(l)) && new Set(locales).size === locales.length;
  if (!validLocales) problems.push('locales: a list of distinct language codes, e.g. ["fr", "en"]');

  if (typeof value.voice !== 'string' || value.voice.trim().length < 40) {
    problems.push('voice: describe the tone in a sentence or two (40 characters at least)');
  }

  const entries = value.entries;
  const min = options.minEntries ?? 5;
  if (!Array.isArray(entries) || entries.length < min) {
    problems.push(`entries: at least ${min} (key, one text per locale, optional max)`);
    return { ok: false, problems };
  }
  const sourceNumbers = new Set(numbersIn(options.source));
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.key !== 'string') {
      problems.push('each entry needs a string key');
      continue;
    }
    const key = entry.key;
    if (!KEY.test(key)) problems.push(`key "${key}" must be dotted lowercase, e.g. home.hero.title`);
    if (seen.has(key)) problems.push(`key "${key}" is used twice`);
    seen.add(key);
    if (!validLocales) continue;
    const texts: string[] = [];
    for (const locale of locales as string[]) {
      const text = entry[locale];
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push(`${key}: missing ${locale} text (every locale has every entry)`);
        continue;
      }
      texts.push(text);
      if (typeof entry.max === 'number' && text.length > entry.max) {
        problems.push(`${key} (${locale}) is ${text.length} characters, at most ${entry.max}`);
      }
      for (const marker of DRAFT_MARKERS) {
        if (hasMarker(text, marker)) problems.push(`${key} (${locale}): draft marker "${marker}"`);
      }
      for (const n of numbersIn(text)) {
        if (!sourceNumbers.has(n)) problems.push(`${key} (${locale}): the figure ${n} is not in the source material; never invent a number`);
      }
    }
    if ((locales as string[]).length > 1 && texts.length > 1 && texts[0] !== undefined && texts[0].length > 24 && texts.every((t) => t === texts[0])) {
      problems.push(`${key}: the same text in every locale looks untranslated`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// ── Liens entre les étapes ──────────────────────────────────────────────────

/** Le type du projet : celui passé en entrée s'il est valide, sinon celui de `calibrage.json`. */
export function calibratedType(explicit: string, calibrationRaw: string | null): ProjectType | null {
  const given = explicit.trim();
  if ((PROJECT_TYPES as readonly string[]).includes(given)) return given as ProjectType;
  if (calibrationRaw === null) return null;
  try {
    const value = JSON.parse(calibrationRaw) as { type?: unknown };
    return typeof value.type === 'string' && (PROJECT_TYPES as readonly string[]).includes(value.type) ? (value.type as ProjectType) : null;
  } catch {
    return null;
  }
}

/** Les composants de `tokens.json` que la section « Composants » de la doc ne nomme pas. */
export function undocumentedComponents(tokensRaw: string | null, doc: string | null): string[] {
  if (tokensRaw === null || doc === null) return [];
  let names: string[] = [];
  try {
    const value = JSON.parse(tokensRaw) as { components?: Array<{ name?: unknown }> };
    names = (value.components ?? []).map((c) => (typeof c.name === 'string' ? c.name : '')).filter((n) => n !== '');
  } catch {
    return [];
  }
  const body = normalize(sections(doc).get(normalize('Composants')) ?? '');
  return names.filter((name) => !body.includes(normalize(name)));
}

/** Les langues demandées (« fr,en ») que `content.json` ne déclare pas, ou en trop. */
export function localeMismatch(contentRaw: string | null, requested: string[]): string[] {
  if (contentRaw === null || requested.length === 0) return [];
  try {
    const declared = (JSON.parse(contentRaw) as { locales?: unknown }).locales;
    if (!isStringList(declared)) return [];
    const problems: string[] = [];
    for (const locale of requested) if (!declared.includes(locale)) problems.push(`locales: "${locale}" was requested and is missing`);
    for (const locale of declared) if (!requested.includes(locale)) problems.push(`locales: "${locale}" was not requested`);
    return problems;
  } catch {
    return [];
  }
}
