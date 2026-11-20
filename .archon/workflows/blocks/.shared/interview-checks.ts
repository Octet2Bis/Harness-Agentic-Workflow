/**
 * Contrôles déterministes d'une préparation d'entretien (`interview-prep.md`, bloc
 * `interview-prep`). Purs : pas d'accès disque, testables à l'unité.
 *
 * Ce que le code peut établir : les six sections fixes, dans l'ordre ; le titre nomme
 * l'étape et l'entreprise ; assez de questions probables, de questions à poser et de
 * questions de simulation (et la simulation ne contient que des questions) ; au moins N
 * histoires STAR, chacune avec ses quatre parties et une citation du profil qui existe
 * vraiment dans le profil ; la note de cohérence cite le CV ou le pitch mot pour mot ;
 * aucun chiffre sans source (les histoires : le profil seul ; ailleurs : une des pièces
 * fournies) ; pas de phrase creuse ni de marqueur de brouillon ; les mots-clés de l'offre.
 * Ce qu'il ne peut pas trancher (pertinence pour l'annonce et l'étape, honnêteté des
 * histoires, utilité) va au juge.
 *
 * Les règles de chiffres, de mots-clés et de phrases creuses viennent de `cv-checks.ts`
 * (importées, jamais recopiées) : un chiffre sans source est une invention, ici comme sur
 * le CV.
 *
 * La forme d'une histoire STAR (Situation, Tâche, Action, Résultat) et la liste des
 * étapes et de ce qu'elles sondent sont adaptées de MadsLorentzen/ai-job-search,
 * `.claude/skills/job-application-assistant/07-interview-prep.md` et
 * `.claude/commands/interview.md` (MIT © 2026 Mads Lorentzen) ; la citation obligatoire
 * du profil et sa vérification par le code sont propres à ce dépôt.
 */

import { DEFAULT_SLOP, keywordCoverage, slopPhrases, unsupportedFigures } from './cv-checks.ts';

/** Les étapes d'entretien que le bloc prépare. `rh` par défaut. */
export const STAGES = ['rh', 'manager', 'technique', 'final'] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/** Les six sections fixes de `interview-prep.md`, dans cet ordre (titres `## `). */
export const PREP_SECTIONS = [
  'Questions probables',
  'Histoires STAR',
  'Cohérence avec le CV et le pitch',
  'Questions à poser',
  "Simulation d'entretien",
  'Points à clarifier',
] as const;

export const STAR_SECTION = 'Histoires STAR';
export const CONSISTENCY_SECTION = 'Cohérence avec le CV et le pitch';

/** Phrases creuses propres à l'entretien, en plus de `DEFAULT_SLOP` (liste courte et littérale). */
export const INTERVIEW_SLOP: string[] = [
  "mon plus grand défaut est d'être perfectionniste",
  'je suis trop perfectionniste',
  'je travaille trop',
  "i'm a perfectionist",
  'my greatest weakness is perfectionism',
  'i work too hard',
  'team player',
];

export const PREP_SLOP: string[] = [...DEFAULT_SLOP, ...INTERVIEW_SLOP];

/** Marqueurs de brouillon, et les blancs d'un gabarit recopié tel quel (« [PROJECT_NAME] », « [CONTEXTE] »). */
const DRAFT_MARKERS = ['TODO', 'TBD', 'lorem ipsum', '<placeholder>', '{{'];
const TEMPLATE_BLANK = /\[[A-ZÀ-Ý][A-ZÀ-Ý0-9_ ]{5,}\]/u;

/**
 * Forme comparable d'un texte, pour qu'une citation recopiée du profil soit retrouvée malgré
 * la mise en forme : casse, espaces (insécables compris), apostrophes et guillemets
 * typographiques, tirets, emphase Markdown (`*`, `_`, `` ` ``). Les accents restent : une
 * citation est mot pour mot.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[*`]/g, '')
    .replace(/[\s  ]+/g, ' ')
    .trim();
}

export interface Section {
  title: string;
  body: string;
}

/** Les sections `## ` d'un document, dans l'ordre ; `preamble` est ce qui précède la première. */
export function splitSections(markdown: string): { preamble: string; sections: Section[] } {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: Section[] = [];
  const preamble: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });
      current = { title: heading[1]!.trim(), lines: [] };
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) sections.push({ title: current.title, body: current.lines.join('\n').trim() });
  return { preamble: preamble.join('\n').trim(), sections };
}

/** La section dont le titre commence par `title` (casse et mise en forme ignorées), ou null. */
export function findSection(sections: Section[], title: string): Section | null {
  const wanted = normalizeText(title);
  return sections.find((s) => normalizeText(s.title).startsWith(wanted)) ?? null;
}

/** Les sections attendues, présentes et dans l'ordre. */
export function sectionProblems(sections: Section[], required: readonly string[] = PREP_SECTIONS): string[] {
  const problems: string[] = [];
  const positions: number[] = [];
  for (const title of required) {
    const index = sections.findIndex((s) => normalizeText(s.title).startsWith(normalizeText(title)));
    if (index < 0) problems.push(`section manquante : « ## ${title} »`);
    else positions.push(index);
  }
  if (problems.length === 0 && positions.some((p, i) => i > 0 && p < positions[i - 1]!)) {
    problems.push(`sections dans le désordre : attendu ${required.map((t) => `« ${t} »`).join(', ')}`);
  }
  return problems;
}

/** Les éléments de liste (`-`, `*`, `+`, `1.`, `1)`) d'un texte, sans leur puce. */
export function listItems(body: string): string[] {
  return body
    .split('\n')
    .map((line) => /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line)?.[1] ?? null)
    .filter((item): item is string => item !== null);
}

/** Les questions d'une section : éléments de liste qui portent un point d'interrogation. */
export function questions(body: string): string[] {
  return listItems(body).filter((item) => item.includes('?'));
}

export interface StarStory {
  title: string;
  /** Situation, Tâche, Action, Résultat : le texte de chaque partie, vide si elle manque. */
  parts: Record<StarPart, string>;
  /** Le contenu de chaque ligne « Source (profil) : … ». */
  sources: string[];
}

export const STAR_PARTS = ['Situation', 'Tâche', 'Action', 'Résultat'] as const;
export type StarPart = (typeof STAR_PARTS)[number];

const PART_PATTERN = /^(situation|t[âa]che|action|r[ée]sultat)\s*:\s*(.*)$/i;
const SOURCE_PATTERN = /^source(?:\s*\(\s*profil\s*\))?\s*:\s*(.*)$/i;

function partOf(label: string): StarPart {
  const l = label.toLowerCase();
  if (l === 'situation') return 'Situation';
  if (l.startsWith('t')) return 'Tâche';
  if (l === 'action') return 'Action';
  return 'Résultat';
}

/** Une ligne sans sa puce ni son emphase : « - **Situation :** x » → « Situation : x ». */
function bareLine(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/[*_`]/g, '').trim();
}

/** Les histoires de la section STAR : une par titre `### `, chaque partie sur sa ligne « Partie : … ». */
export function parseStories(body: string): StarStory[] {
  const stories: StarStory[] = [];
  let current: StarStory | null = null;
  let lastPart: StarPart | null = null;
  for (const raw of body.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      current = { title: heading[1]!, parts: { Situation: '', Tâche: '', Action: '', Résultat: '' }, sources: [] };
      stories.push(current);
      lastPart = null;
      continue;
    }
    if (!current) continue;
    const line = bareLine(raw);
    const part = PART_PATTERN.exec(line);
    const source = SOURCE_PATTERN.exec(line);
    if (part) {
      lastPart = partOf(part[1]!);
      current.parts[lastPart] = part[2]!.trim();
    } else if (source) {
      current.sources.push(source[1]!.trim());
      lastPart = null;
    } else if (lastPart && line !== '' && !/^[\p{L} ()]+\s*:/u.test(line)) {
      // Une partie peut continuer sur la ligne suivante, tant qu'aucun autre libellé ne commence.
      current.parts[lastPart] = `${current.parts[lastPart]} ${line}`.trim();
    } else {
      lastPart = null;
    }
  }
  return stories;
}

export interface Citations {
  /** Extraits entre « », “ ” ou " ", à retrouver mot pour mot. */
  quotes: string[];
  /** Chemins de titres après « § », composants séparés par « > ». */
  sections: string[][];
}

/** Lit une ligne de source : `§ Expériences > Way2Tech — « extrait »`, plusieurs références séparées par « ; ». */
export function parseCitations(source: string): Citations {
  const quotes = [...source.matchAll(/«\s*([^»]+?)\s*»|“([^”]+)”|"([^"]+)"/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim()).filter((q) => q !== '');
  const withoutQuotes = source.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, ';');
  const sections = [...withoutQuotes.matchAll(/§\s*([^;§]+)/g)]
    .map((m) => m[1]!.split(/\s+[—–-]\s+|,/)[0]!.trim())
    .filter((path) => path !== '')
    .map((path) => path.split('>').map((part) => part.trim()).filter((part) => part !== ''))
    .filter((path) => path.length > 0);
  return { quotes, sections };
}

/** Les titres Markdown du profil (`#` à `######`), sous forme comparable. */
export function profileHeadings(profile: string): string[] {
  return profile
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => normalizeText(line.replace(/^#{1,6}\s+/, '').replace(/\s*#+\s*$/, '')));
}

/** Longueur minimale d'un extrait cité : en dessous, « a » ou « SQL » se retrouveraient partout. */
export const MIN_QUOTE_CHARS = 12;

/** Ce qui ne va pas dans les citations d'une histoire : aucune, ou une qui n'existe pas dans le profil. */
export function citationProblems(story: StarStory, profile: string): string[] {
  const where = `histoire « ${story.title} »`;
  const all: Citations = { quotes: [], sections: [] };
  for (const source of story.sources) {
    const c = parseCitations(source);
    all.quotes.push(...c.quotes);
    all.sections.push(...c.sections);
  }
  if (all.quotes.length + all.sections.length === 0) {
    return [`${where} : aucune citation du profil (« Source (profil) : § <titre du profil> » ou « « extrait mot pour mot » »)`];
  }
  const problems: string[] = [];
  const hay = normalizeText(profile);
  for (const quote of all.quotes) {
    const q = normalizeText(quote);
    if (q.length < MIN_QUOTE_CHARS) problems.push(`${where} : extrait trop court pour être une citation (« ${quote} », ${MIN_QUOTE_CHARS} caractères au moins)`);
    else if (!hay.includes(q)) problems.push(`${where} : l'extrait « ${quote} » n'est pas dans le profil (citer mot pour mot)`);
  }
  const headings = profileHeadings(profile);
  for (const path of all.sections) {
    for (const part of path) {
      const p = normalizeText(part);
      if (p.length < 3 || !headings.some((h) => h.includes(p))) {
        problems.push(`${where} : la section « § ${path.join(' > ')} » n'est pas un titre du profil (« ${part} » introuvable)`);
        break;
      }
    }
  }
  return problems;
}

/** Une histoire complète : ses quatre parties, non vides, et une citation du profil qui existe. */
export function storyProblems(story: StarStory, profile: string): string[] {
  const missing = STAR_PARTS.filter((part) => story.parts[part].replace(/[.…\s-]/g, '') === '');
  const problems = missing.length ? [`histoire « ${story.title} » : partie(s) manquante(s) ${missing.map((p) => `« ${p} : »`).join(', ')}`] : [];
  return [...problems, ...citationProblems(story, profile)];
}

/** Les extraits entre guillemets d'un texte (« », “ ”, " "). */
export function quotedExcerpts(text: string): string[] {
  return [...text.matchAll(/«\s*([^»]+?)\s*»|“([^”]+)”|"([^"]+)"/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim()).filter((q) => q !== '');
}

/**
 * La note de cohérence dit ce que le CV et le pitch affirment déjà : quand l'un des deux
 * existe, elle en cite au moins un extrait mot pour mot, et chaque extrait cité s'y trouve.
 */
export function consistencyProblems(body: string, documents: { cv: string; pitch: string }): string[] {
  const papers = [documents.cv, documents.pitch].filter((d) => d.trim() !== '');
  if (papers.length === 0) return [];
  const hay = papers.map(normalizeText);
  const excerpts = quotedExcerpts(body).filter((q) => normalizeText(q).length >= MIN_QUOTE_CHARS);
  const problems: string[] = [];
  if (excerpts.length === 0) {
    problems.push(`« ${CONSISTENCY_SECTION} » : aucun extrait du CV ni du pitch cité mot pour mot (« … », ${MIN_QUOTE_CHARS} caractères au moins)`);
  }
  for (const excerpt of excerpts) {
    if (!hay.some((h) => h.includes(normalizeText(excerpt)))) {
      problems.push(`« ${CONSISTENCY_SECTION} » : l'extrait « ${excerpt} » n'est ni dans le CV ni dans le pitch`);
    }
  }
  return problems;
}

/** La simulation ne contient que des questions : chaque élément de liste en est une, aucune réponse rédigée. */
export function mockProblems(body: string, min: number): string[] {
  const problems: string[] = [];
  const items = listItems(body);
  const asked = items.filter((item) => item.includes('?'));
  if (asked.length < min) problems.push(`« Simulation d'entretien » : ${asked.length} question(s), au moins ${min} attendues`);
  const notQuestions = items.filter((item) => !item.includes('?'));
  if (notQuestions.length) problems.push(`« Simulation d'entretien » : questions seulement, sans réponse ; ${notQuestions.length} élément(s) sans « ? » (« ${notQuestions[0]} »)`);
  const answer = body.split('\n').map(bareLine).find((line) => /^(r[ée]ponse|answer|exemple de r[ée]ponse)\s*:/i.test(line));
  if (answer !== undefined) problems.push(`« Simulation d'entretien » : réponse rédigée (« ${answer} ») : Antoine s'entraîne à répondre lui-même`);
  return problems;
}

export interface PrepRules {
  stage: string;
  company: string;
  /** Le profil maître : seule source des histoires et de leurs chiffres. */
  profile: string;
  /** Les autres pièces fournies (annonce, CV, pitch, notes de recherche, remarques) : sources admises hors des histoires. */
  sources: string[];
  cv: string;
  pitch: string;
  keywords: string[];
  minCoverage: number;
  minStories: number;
  minLikelyQuestions: number;
  minQuestionsToAsk: number;
  minMockQuestions: number;
  minChars: number;
  maxChars: number;
  slop: string[];
}

export const DEFAULT_PREP_RULES: Omit<PrepRules, 'stage' | 'company' | 'profile' | 'sources' | 'cv' | 'pitch' | 'keywords'> = {
  minCoverage: 0.5,
  minStories: 3,
  minLikelyQuestions: 6,
  minQuestionsToAsk: 3,
  minMockQuestions: 6,
  minChars: 1500,
  maxChars: 20000,
  slop: PREP_SLOP,
};

export interface PrepOutcome {
  ok: boolean;
  problems: string[];
  stories: number;
  coverage: number;
}

/** Le contrôle complet d'une préparation d'entretien. Chaque problème dit quoi corriger ; l'agent les reçoit au tour suivant. */
export function checkInterviewPrep(doc: string | null, rules: PrepRules): PrepOutcome {
  const problems: string[] = [];
  if (!isStage(rules.stage)) problems.push(`étape « ${rules.stage} » inconnue : ${STAGES.join(' | ')}`);
  if (rules.profile.trim() === '') problems.push('profil maître vide ou introuvable : aucune histoire ne peut être vérifiée');
  if (doc === null || doc.trim() === '') {
    problems.push('interview-prep.md absent ou vide');
    return { ok: false, problems, stories: 0, coverage: 0 };
  }
  const { preamble, sections } = splitSections(doc);
  const title = /^#\s+(.+)$/m.exec(preamble)?.[1] ?? '';
  const titled = /étape\s*:\s*([\p{L}]+)/u.exec(normalizeText(title))?.[1] ?? '';
  if (title === '') problems.push(`titre manquant : « # Préparation d'entretien — <entreprise>, <poste> (étape : ${rules.stage}) »`);
  else if (isStage(rules.stage) && titled !== rules.stage) problems.push(`le titre ne dit pas l'étape : « (étape : ${rules.stage}) » attendu${titled ? `, lu « ${titled} »` : ''}`);
  if (rules.company.trim() !== '' && !normalizeText(doc).includes(normalizeText(rules.company))) {
    problems.push(`le document ne nomme pas l'entreprise (${rules.company})`);
  }
  problems.push(...sectionProblems(sections));

  const body = (name: string): string => findSection(sections, name)?.body ?? '';
  const likely = questions(body('Questions probables')).length;
  if (findSection(sections, 'Questions probables') && likely < rules.minLikelyQuestions) {
    problems.push(`« Questions probables » : ${likely} question(s), au moins ${rules.minLikelyQuestions} attendues (une par puce, avec « ? »)`);
  }
  const toAsk = questions(body('Questions à poser')).length;
  if (findSection(sections, 'Questions à poser') && toAsk < rules.minQuestionsToAsk) {
    problems.push(`« Questions à poser » : ${toAsk} question(s), au moins ${rules.minQuestionsToAsk} attendues`);
  }
  if (findSection(sections, "Simulation d'entretien")) problems.push(...mockProblems(body("Simulation d'entretien"), rules.minMockQuestions));
  if (findSection(sections, 'Points à clarifier') && listItems(body('Points à clarifier')).length === 0) {
    problems.push('« Points à clarifier » : aucun point (une puce par point, ou « - Aucun point ouvert. »)');
  }

  const star = findSection(sections, STAR_SECTION);
  const starBody = star?.body ?? '';
  const stories = parseStories(starBody);
  if (star && stories.length < rules.minStories) {
    problems.push(`« ${STAR_SECTION} » : ${stories.length} histoire(s), au moins ${rules.minStories} attendues (une par titre « ### »)`);
  }
  for (const story of stories) problems.push(...storyProblems(story, rules.profile));
  if (findSection(sections, CONSISTENCY_SECTION)) problems.push(...consistencyProblems(body(CONSISTENCY_SECTION), { cv: rules.cv, pitch: rules.pitch }));

  // Chiffres : ceux des histoires viennent du profil seul (c'est Antoine qui parlera de
  // lui) ; ailleurs, d'une des pièces fournies (le profil, l'annonce, le CV, le pitch, les
  // notes). Un chiffre qu'aucune pièce ne porte est une invention.
  for (const figure of unsupportedFigures(starBody, rules.profile)) {
    problems.push(`« ${STAR_SECTION} » : le chiffre « ${figure} » n'est pas dans le profil (une histoire ne dit que ce que le profil porte)`);
  }
  const rest = [preamble, ...sections.filter((s) => s !== star).map((s) => `${s.title}\n${s.body}`)].join('\n');
  for (const figure of unsupportedFigures(rest, [rules.profile, ...rules.sources].join('\n'))) {
    problems.push(`le chiffre « ${figure} » n'est dans aucune pièce fournie (profil, annonce, CV, pitch, notes) : chiffre sans source`);
  }

  for (const phrase of slopPhrases(doc, rules.slop)) problems.push(`phrase creuse : « ${phrase} »`);
  for (const marker of DRAFT_MARKERS) {
    if (doc.toLowerCase().includes(marker.toLowerCase())) problems.push(`marqueur de brouillon : « ${marker} »`);
  }
  const blank = TEMPLATE_BLANK.exec(doc);
  if (blank) problems.push(`blanc de gabarit non rempli : « ${blank[0]} »`);

  const chars = doc.trim().length;
  if (chars < rules.minChars) problems.push(`document trop court : ${chars} caractères, au moins ${rules.minChars}`);
  if (chars > rules.maxChars) problems.push(`document trop long pour se relire avant l'entretien : ${chars} caractères, au plus ${rules.maxChars}`);

  const coverage = keywordCoverage(doc, rules.keywords);
  if (coverage.ratio < rules.minCoverage) {
    problems.push(
      `mots-clés de l'offre couverts : ${coverage.covered.length}/${coverage.covered.length + coverage.missing.length} (${Math.round(coverage.ratio * 100)} %, au moins ${Math.round(rules.minCoverage * 100)} %) ; manquent : ${coverage.missing.join(', ')}`
    );
  }
  return { ok: problems.length === 0, problems, stories: stories.length, coverage: coverage.ratio };
}
