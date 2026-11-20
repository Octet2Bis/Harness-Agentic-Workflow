/**
 * Contrôles déterministes d'une lettre de motivation (bloc `cover-letter`). Purs : pas
 * d'accès disque, testables à l'unité (`letter-checks.test.ts`, un cas qui passe et un cas
 * qui doit échouer par règle).
 *
 * Ce que le code peut établir : la lettre a sa forme (en-tête, objet, corps, signature),
 * 250 à 300 mots de corps, tient sur une page A4, nomme l'entreprise et le poste, est écrite
 * dans la langue de l'annonce, s'appuie sur au moins deux passages du profil maître cités mot
 * pour mot (le registre de preuves que l'agent déclare), ne porte aucun chiffre ni aucune durée
 * que le profil (ou l'annonce) ne porte pas, aucune phrase creuse, pas de tirets cadratins en
 * série, aucun marqueur à compléter, l'e-mail du profil, et finit par le nom du candidat. Ce
 * qu'il ne peut pas trancher (la preuve citée soutient-elle vraiment la phrase ? la lettre
 * donne-t-elle envie de rencontrer le candidat ?) va au juge.
 *
 * Réutilise les règles du dossier de candidature (`cv-checks.ts` : chiffres à unité, phrases
 * creuses, contact), sans les modifier ; les clichés propres à la lettre sont ici
 * (`LETTER_SLOP`). La mise en page (`LETTER_LAYOUT`, `letterBlocks`) sert aussi au rendu
 * HTML (`letter-html.ts`) : l'estimation d'une page et la page imprimée partent des mêmes
 * cotes.
 */

import { DEFAULT_SLOP, carriesPhone, readContact, slopPhrases, unsupportedFigures } from './cv-checks.ts';

// ── Lecture ────────────────────────────────────────────────────────────────────

/** Texte comparable : sans emphase Markdown ni lien, apostrophes et guillemets droits, espaces (insécables compris) réduits, minuscules. */
export function normalize(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Les offres scrapées portent des entités HTML (`&amp;`, `&#39;`) : on les décode avant de comparer. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export interface LetterOffer {
  company: string;
  title: string;
  /** Le texte de l'annonce : `description_full` si l'appelant l'a lue, sinon `description` et `skills_required`. */
  posting: string;
}

/** L'offre (JSON texte, même forme que pour cv-tailor). Illisible : tout vide. */
export function readOffer(raw: string): LetterOffer {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { company: '', title: '', posting: '' };
    const offer = value as Record<string, unknown>;
    const field = (key: string): string => (typeof offer[key] === 'string' ? decodeEntities(offer[key] as string).trim() : '');
    const full = field('description_full');
    const posting = full !== '' ? full : [field('description'), field('skills_required')].filter((part) => part !== '').join('\n');
    return { company: field('company'), title: field('title'), posting };
  } catch {
    return { company: '', title: '', posting: '' };
  }
}

/** L'intitulé du poste sans la mention de genre des annonces (« (H/F) », « F/H », « (m/f/d) ») : c'est ce que la lettre doit nommer. */
export function roleName(title: string): string {
  return title
    .replace(/\s*[-–—]?\s*\(?\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f(?:\s*\/\s*d)?|w\s*\/\s*m(?:\s*\/\s*d)?)\b\)?\s*$/i, '')
    .trim();
}

// ── La forme de la lettre ──────────────────────────────────────────────────────

/**
 * letter.md, de haut en bas :
 *
 *   # <Prénom Nom>                                      ← en-tête : le nom…
 *   <e-mail> · <téléphone> · <LinkedIn> · <portfolio>  ← … le contact (lignes libres)…
 *   <Ville>, le <date>                                   ← … le lieu et la date
 *   **Objet :** <poste> chez <entreprise>                ← l'objet (**Subject:** en anglais)
 *   <formule d'appel>                                    ← le corps commence ici…
 *   <paragraphes>
 *   <formule de politesse>                               ← … et finit ici
 *   <Prénom Nom>                                         ← la signature : dernière ligne
 */
export interface LetterParts {
  /** Le titre H1 de l'en-tête (le nom du candidat), sans emphase. */
  name: string;
  /** Les lignes d'en-tête entre le H1 et l'objet (contact, lieu et date), brutes. */
  header: string[];
  /** La ligne d'objet brute, ou null quand il n'y en a pas. */
  subjectLine: string | null;
  /** Le texte de l'objet, sans son libellé. */
  subject: string;
  /** Le corps brut : de la formule d'appel à la formule de politesse. */
  body: string;
  /** La dernière ligne non vide, sans emphase (la signature), vide quand elle manque. */
  signature: string;
}

const SUBJECT = /^\s*(?:\*\*|__)?\s*(objet|subject)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*?)\s*(?:\*\*|__)?\s*$/i;

function stripEmphasis(line: string): string {
  return line.replace(/[*_`]/g, '').replace(/^#+\s*/, '').trim();
}

export function parseLetter(markdown: string): LetterParts {
  const lines = markdown.replace(/\r/g, '').split('\n').map((line) => line.trimEnd());
  const h1 = lines.findIndex((line) => /^#\s+\S/.test(line));
  const subjectAt = lines.findIndex((line) => SUBJECT.test(line));
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() !== '') {
      last = i;
      break;
    }
  }
  const start = subjectAt >= 0 ? subjectAt + 1 : h1 + 1;
  const hasSignature = last >= 0 && last > h1 && last > subjectAt;
  const headerEnd = subjectAt >= 0 ? subjectAt : h1 >= 0 ? h1 + 1 : 0;
  return {
    name: h1 >= 0 ? stripEmphasis(lines[h1]!) : '',
    header: h1 >= 0 ? lines.slice(h1 + 1, headerEnd).filter((line) => line.trim() !== '') : [],
    subjectLine: subjectAt >= 0 ? lines[subjectAt]!.trim() : null,
    subject: subjectAt >= 0 ? (SUBJECT.exec(lines[subjectAt]!)?.[2] ?? '').trim() : '',
    body: hasSignature ? lines.slice(start, last).join('\n').trim() : lines.slice(start).join('\n').trim(),
    signature: hasSignature ? stripEmphasis(lines[last]!) : '',
  };
}

/** Les mots du corps : un mot porte au moins une lettre ou un chiffre (« : », « % » ou un tiret seul ne comptent pas). */
export function letterWords(text: string): number {
  return text
    .replace(/^\s*[-*•]\s+/gm, '')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Le budget de mots du corps de la lettre (formule d'appel et de politesse comprises, sans en-tête, objet ni signature). */
export const LETTER_WORDS = { min: 250, max: 300 } as const;

export function wordBudgetProblems(body: string, budget: { min: number; max: number } = LETTER_WORDS): string[] {
  const words = letterWords(body);
  if (words < budget.min) return [`lettre trop courte : ${words} mots de corps, au moins ${budget.min} (de la formule d'appel à la formule de politesse)`];
  if (words > budget.max) return [`lettre trop longue : ${words} mots de corps, au plus ${budget.max} (de la formule d'appel à la formule de politesse) : couper ce qui répète le CV`];
  return [];
}

// ── Une page ───────────────────────────────────────────────────────────────────

/**
 * Les cotes de la page imprimée, partagées par l'estimation (ici) et la feuille de style
 * (`letter-html.ts`). A4, marges 20 × 22 mm, 11 pt, interligne 1,4 : 257 mm de haut ÷ 15,4 pt
 * ≈ 47 lignes ; 166 mm de large à ~5,5 pt par signe ≈ 85 signes. L'estimation arrondit chaque
 * bloc à la ligne entière au-dessus et compte large les espaces entre blocs. Étalonnée le
 * 2026-10-22 (letter.html imprimé par Chromium headless, police de repli plus large que Segoe
 * UI) : jusqu'à 53 lignes estimées, la lettre tient sur une page ; à 54, elle déborde. On en
 * garde 50, et une lettre de 250 à 300 mots en compte 37 à 43. Le nombre réel de pages se
 * constate au rendu PDF, hors du bloc.
 */
export const LETTER_LAYOUT = {
  marginMm: { vertical: 20, horizontal: 22 },
  fontPt: 11,
  lineHeight: 1.4,
  charsPerLine: 85,
  linesPerPage: 50,
} as const;

export type LetterLayout = typeof LETTER_LAYOUT;

export type BlockKind = 'name' | 'contact' | 'date' | 'subject' | 'heading' | 'paragraph' | 'item' | 'signature';

/** Un bloc imprimé : son genre et son texte Markdown (une ligne, emphase comprise). */
export interface LetterBlock {
  kind: BlockKind;
  text: string;
}

/** Une ligne d'en-tête qui porte une année est la ligne de lieu et date ; les autres sont du contact. */
const DATE_LINE = /\b(?:19|20)\d{2}\b/;

/**
 * Les blocs de la lettre, dans l'ordre d'impression. Le corps suit le Markdown : des lignes
 * consécutives font un paragraphe, une ligne `- …` un élément de liste, `## …` un intertitre.
 */
export function letterBlocks(parts: LetterParts): LetterBlock[] {
  const blocks: LetterBlock[] = [];
  if (parts.name !== '') blocks.push({ kind: 'name', text: parts.name });
  for (const line of parts.header) blocks.push({ kind: DATE_LINE.test(line) ? 'date' : 'contact', text: line.trim() });
  if (parts.subjectLine !== null) blocks.push({ kind: 'subject', text: parts.subjectLine });
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of parts.body.split('\n')) {
    const line = raw.trim();
    const item = /^[-*•]\s+(.*)$/.exec(line);
    const heading = /^#{2,6}\s+(.*)$/.exec(line);
    if (line === '') flush();
    else if (item) {
      flush();
      blocks.push({ kind: 'item', text: item[1]! });
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1]! });
    } else paragraph.push(line);
  }
  flush();
  if (parts.signature !== '') blocks.push({ kind: 'signature', text: parts.signature });
  return blocks;
}

/** L'espace après chaque genre de bloc, en lignes (marges de la feuille de style, arrondies au-dessus). */
const GAP: Record<BlockKind, number> = { name: 1.2, contact: 0.2, date: 0.8, subject: 0.9, heading: 0.9, paragraph: 0.6, item: 0.3, signature: 1.2 };

/** Les lignes imprimées estimées : chaque bloc occupe ⌈signes ÷ signes par ligne⌉ lignes, plus son espace. */
export function estimateLines(blocks: LetterBlock[], layout: LetterLayout = LETTER_LAYOUT): number {
  let lines = 0;
  for (const block of blocks) {
    const length = stripEmphasis(block.text).length;
    lines += Math.max(1, Math.ceil(length / layout.charsPerLine)) + GAP[block.kind] + (block.kind === 'name' ? 1 : 0);
  }
  return Math.ceil(lines);
}

export function onePageProblems(blocks: LetterBlock[], layout: LetterLayout = LETTER_LAYOUT): string[] {
  const lines = estimateLines(blocks, layout);
  if (lines <= layout.linesPerPage) return [];
  return [`la lettre ne tient pas sur une page A4 : ~${lines} lignes estimées à l'impression, au plus ${layout.linesPerPage} : fusionner des paragraphes courts, raccourcir la liste`];
}

// ── Ce que la lettre nomme ─────────────────────────────────────────────────────

export function mentionProblems(letter: string, company: string, title: string): string[] {
  const hay = normalize(letter);
  const problems: string[] = [];
  if (company.trim() !== '' && !hay.includes(normalize(company))) problems.push(`la lettre ne nomme pas l'entreprise (${company}) : elle n'est pas écrite pour elle`);
  const role = roleName(title);
  if (role !== '' && !hay.includes(normalize(role))) problems.push(`la lettre ne nomme pas le poste tel que l'annonce l'écrit (${role}) : le citer dans l'objet`);
  return problems;
}

/** L'e-mail du profil (lu comme pour le CV) doit figurer sur la lettre : le recruteur doit pouvoir répondre. */
export function contactProblems(letter: string, profile: string): string[] {
  const { email, phone } = readContact(profile);
  const problems: string[] = [];
  if (email !== '' && !letter.includes(email)) problems.push(`la lettre ne porte pas l'e-mail du profil (${email}) : l'écrire sur la ligne de contact`);
  // Le contrôle PDF exige aussi le téléphone du profil : l'exiger ici, où le rédacteur peut l'ajouter.
  if (phone !== '' && !carriesPhone(letter, phone)) problems.push(`la lettre ne porte pas le téléphone du profil (${phone}) : l'écrire sur la ligne de contact`);
  return problems;
}

export function structureProblems(parts: LetterParts): string[] {
  const problems: string[] = [];
  if (parts.name === '') problems.push("en-tête absent : la première ligne est « # <nom du candidat> »");
  if (parts.subjectLine === null) problems.push("pas de ligne d'objet : « **Objet :** <poste> chez <entreprise> » (« **Subject:** … » en anglais), avant la formule d'appel");
  else if (parts.subject === '') problems.push("ligne d'objet vide : y nommer le poste et l'entreprise");
  if (parts.body === '') problems.push('corps de la lettre vide');
  return problems;
}

// ── La langue ──────────────────────────────────────────────────────────────────

export type Language = 'fr' | 'en';

const FR_WORDS = new Set(['le', 'la', 'les', 'des', 'une', 'un', 'et', 'est', 'pour', 'dans', 'avec', 'vous', 'nous', 'je', 'mon', 'mes', 'du', 'au', 'aux', 'sur', 'que', 'qui', 'pas', 'votre', 'vos', 'notre', 'ce', 'cette', 'sont', 'mais', 'par', 'plus', 'chez', 'en', 'de', 'l', 'd', 'j', 'qu', 'c']);
const EN_WORDS = new Set(['the', 'and', 'to', 'of', 'in', 'for', 'with', 'you', 'we', 'i', 'my', 'is', 'are', 'that', 'this', 'our', 'your', 'will', 'have', 'has', 'be', 'at', 'from', 'an', 'it', 'was', 'by', 'as', 'would', 'which']);

/** Français ou anglais, par les mots-outils ; `unknown` quand le texte est trop court ou mêlé. */
export function detectLanguage(text: string): Language | 'unknown' {
  let fr = 0;
  let en = 0;
  for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (FR_WORDS.has(word)) fr++;
    if (EN_WORDS.has(word)) en++;
  }
  if (fr + en < 8) return 'unknown';
  if (fr >= 2 * en) return 'fr';
  if (en >= 2 * fr) return 'en';
  return 'unknown';
}

/** La langue attendue : celle que l'appelant impose, sinon celle de l'annonce, sinon le français. */
export function expectedLanguage(requested: string, posting: string): Language {
  const asked = requested.trim().toLowerCase();
  if (asked === 'fr' || asked === 'en') return asked;
  const detected = detectLanguage(posting);
  return detected === 'unknown' ? 'fr' : detected;
}

const LANGUAGE_NAME: Record<Language, string> = { fr: 'français', en: 'anglais' };

export function languageProblems(body: string, expected: Language): string[] {
  const detected = detectLanguage(body);
  if (detected === expected) return [];
  return [`la lettre doit être écrite en ${LANGUAGE_NAME[expected]}, la langue de l'annonce : lu ${detected === 'unknown' ? 'une langue indéterminée ou mêlée' : LANGUAGE_NAME[detected]}`];
}

// ── Les preuves : chaque affirmation sur le candidat vient du profil ──────────

/** Une preuve tracée : un passage de la lettre et le passage du profil maître sur lequel il repose. */
export interface Evidence {
  letter: string;
  profile: string;
}

/** Le registre de preuves déclaré par l'agent (tableau ou JSON texte) ; ce qui n'en a pas la forme est ignoré. */
export function parseEvidence(raw: unknown): Evidence[] {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Evidence[] => {
    if (item === null || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.letter === 'string' && typeof record.profile === 'string' ? [{ letter: record.letter, profile: record.profile }] : [];
  });
}

export const MIN_EVIDENCE = 2;
/** Un passage de moins de quatre mots ne prouve rien (« n8n », « Paris »). */
export const MIN_EVIDENCE_WORDS = 4;

function excerpt(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function trimQuote(text: string): string {
  return normalize(text).replace(/^["'…\s]+|["'….,;:!?\s]+$/g, '');
}

/**
 * Au moins `min` preuves distinctes : chaque passage de la lettre est dans letter.md, chaque
 * passage du profil est dans le profil maître, mot pour mot (à l'emphase, la casse et les
 * espaces près). Que le second soutienne vraiment le premier, c'est le juge qui le dit.
 */
export function evidenceProblems(evidence: Evidence[], letter: string, profile: string, min: number = MIN_EVIDENCE): { problems: string[]; traced: number } {
  const problems: string[] = [];
  const hayLetter = normalize(letter);
  const hayProfile = normalize(profile);
  const seen = new Set<string>();
  let traced = 0;
  evidence.forEach((item, index) => {
    const n = index + 1;
    const inLetter = trimQuote(item.letter);
    const inProfile = trimQuote(item.profile);
    let valid = true;
    if (letterWords(inLetter) < MIN_EVIDENCE_WORDS) {
      problems.push(`preuve n°${n} : passage de la lettre trop court (« ${excerpt(item.letter)} ») : au moins ${MIN_EVIDENCE_WORDS} mots`);
      valid = false;
    } else if (!hayLetter.includes(inLetter)) {
      problems.push(`preuve n°${n} : « ${excerpt(item.letter)} » n'est pas dans letter.md : citer la phrase telle qu'elle est écrite`);
      valid = false;
    }
    if (letterWords(inProfile) < MIN_EVIDENCE_WORDS) {
      problems.push(`preuve n°${n} : passage du profil trop court (« ${excerpt(item.profile)} ») : au moins ${MIN_EVIDENCE_WORDS} mots`);
      valid = false;
    } else if (!hayProfile.includes(inProfile)) {
      problems.push(`preuve n°${n} : « ${excerpt(item.profile)} » n'est pas dans le profil maître : le citer mot pour mot, ou retirer l'affirmation`);
      valid = false;
    }
    if (valid && !seen.has(inProfile)) {
      seen.add(inProfile);
      traced++;
    }
  });
  if (traced < min) {
    problems.push(`${traced} preuve(s) tracée(s) vers le profil, au moins ${min} attendues : déclarer dans « evidence » chaque réalisation citée (passage de la lettre + passage du profil, mot pour mot)`);
  }
  return { problems, traced };
}

// ── Aucun chiffre, aucune durée sans source ───────────────────────────────────

const DURATION = /(\d+(?:[.,]\d+)?)\s*\+?\s*(années|année|ans|an|mois|semaines|semaine|years?|yrs?|months?|weeks?)(?![\p{L}])/giu;

function durationUnit(word: string): string {
  const unit = word.toLowerCase();
  if (unit.startsWith('mo') || unit === 'mois') return 'mo';
  if (unit.startsWith('sem') || unit.startsWith('week')) return 'w';
  return 'y';
}

/** Les durées chiffrées d'un texte (« 3 ans », « 6 months », « 2+ years »), normalisées (« 3y », « 6mo ») : une même durée se reconnaît d'une langue à l'autre. */
export function durations(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(DURATION)) found.add(`${match[1]!.replace(',', '.')}${durationUnit(match[2]!)}`);
  return [...found];
}

/**
 * Durées de la lettre absentes du profil maître. Le profil seul fait foi (pas l'annonce) :
 * « 3 ans d'expérience exigés » dans l'annonce ne prouve pas que le candidat les a.
 */
export function unsupportedDurations(letter: string, profile: string): string[] {
  const known = new Set(durations(profile));
  return durations(letter).filter((duration) => !known.has(duration));
}

const NUMBER = /(?<![\p{L}\p{N}.,])\d{1,3}(?:[\s  ]\d{3})+(?![\p{L}\p{N}])|(?<![\p{L}\p{N}.,])\d+(?:[.,]\d+)?(?![\p{L}\p{N}]|[.,]\d)/gu;

/** Les nombres d'un texte, hors années (1900–2099) et hors 0 et 1 (« un ») : « 1 000 » → « 1000 », « 1,5 » → « 1.5 ». */
export function plainNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    const value = match[0].replace(/[\s  ]/g, '').replace(',', '.');
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0 || n === 1 || (Number.isInteger(n) && n >= 1900 && n <= 2099)) continue;
    found.add(value);
  }
  return [...found];
}

/** Nombres du corps (« 12 campagnes ») que ni le profil ni l'annonce ne portent. */
export function unsupportedNumbers(body: string, sources: string): string[] {
  const known = new Set(plainNumbers(sources));
  return plainNumbers(body).filter((value) => !known.has(value));
}

// ── Le style ───────────────────────────────────────────────────────────────────

/**
 * Formules creuses propres à la lettre de motivation, en plus de `DEFAULT_SLOP`
 * (`cv-checks.ts`). Liste courte et littérale, comparée au texte normalisé (apostrophes
 * droites, minuscules).
 * Adapté de MadsLorentzen/ai-job-search/.claude/skills/job-application-assistant/03-writing-style.md
 * (« Critical Rules » 2) et 06-cover-letter-templates.md (« To whom it may concern »), et de
 * proficientlyjobs/proficiently-claude-skills/skills/cover-letter/scripts/write-cover-letter.md
 * (« Avoid these artificial phrases », « Strict Prohibitions ») (MIT).
 */
export const LETTER_SLOP: string[] = [
  "c'est avec enthousiasme",
  'vif intérêt',
  'suite à votre annonce',
  'mettre à profit mes compétences',
  'relever de nouveaux défis',
  'leader dans son domaine',
  'valeur ajoutée',
  'profil idéal',
  'candidat idéal',
  'candidate idéale',
  'véritable atout',
  'atout majeur',
  'motivation sans faille',
  'je suis persuadé',
  'ma passion pour',
  'to whom it may concern',
  'a great fit',
  'perfect fit',
  'hit the ground running',
  'drive results',
  'team player',
  'self-starter',
  'go-getter',
  'excited about the opportunity',
  'aligns perfectly',
  'living and breathing',
  'wear many hats',
  'my passion for',
];

/** Les deux listes se recouvrent (« team player »…) : une formule n'est tenue qu'une fois. */
export const ALL_LETTER_SLOP: string[] = [...new Set([...DEFAULT_SLOP, ...LETTER_SLOP])];

/** Une formule déjà couverte par une plus longue (« je me permets de » dans « je me permets de vous ») n'est citée qu'une fois. */
export function slopProblems(letter: string, slop: string[] = ALL_LETTER_SLOP): string[] {
  const found = slopPhrases(normalize(letter), slop.map((phrase) => normalize(phrase)));
  return found
    .filter((phrase) => !found.some((other) => other !== phrase && other.includes(phrase)))
    .map((phrase) => `formule creuse « ${phrase} » : la remplacer par un fait du profil`);
}

/** Tirets d'incise : cadratin (—), demi-cadratin entre espaces ( – ) et double trait (--). */
export function dashCount(text: string): number {
  return (text.match(/—/g) ?? []).length + (text.match(/\s–\s/g) ?? []).length + (text.match(/\s--\s/g) ?? []).length;
}

/** Au plus un tiret d'incise dans toute la lettre : leur série est une marque d'écriture générée. */
export const LETTER_MAX_DASHES = 1;

export function dashProblems(letter: string, max: number = LETTER_MAX_DASHES): string[] {
  const count = dashCount(letter);
  if (count <= max) return [];
  return [`${count} tirets d'incise (—, –), au plus ${max} : les remplacer par une virgule, deux-points ou un point`];
}

/** Marqueurs à compléter : `[Nom]` (pas un lien `[x](url)`), `<entreprise>` (pas une adresse `<a@b.c>`), `{{…}}`, TODO, TBD, XXX, lorem ipsum. */
export function placeholders(letter: string): string[] {
  const found = new Set<string>();
  for (const match of letter.matchAll(/\[[^\]\n]{1,60}\](?!\()/g)) found.add(match[0]);
  for (const match of letter.matchAll(/<[^<>\n]{1,40}>/g)) if (!/[@:]/.test(match[0])) found.add(match[0]);
  for (const match of letter.matchAll(/\{\{[^}\n]*\}?\}?/g)) found.add(match[0]);
  for (const match of letter.matchAll(/(?<![\p{L}])(?:TODO|TBD|XXX|FIXME)(?![\p{L}])/gu)) found.add(match[0]);
  if (/lorem ipsum/i.test(letter)) found.add('lorem ipsum');
  return [...found];
}

export function placeholderProblems(letter: string): string[] {
  return placeholders(letter).map((marker) => `marqueur à compléter « ${marker} » : écrire le texte ou retirer la phrase`);
}

// ── La signature ───────────────────────────────────────────────────────────────

/** Deux à quatre mots à majuscule, particules permises (« Marie de La Tour », « Jean-Pierre Martin »). */
const NAME_LIKE = /^\p{Lu}[\p{L}'’-]*(?:\s+(?:(?:de|du|des|d'|la|le|van|von|der|di|da)\s+)?\p{Lu}[\p{L}'’-]*){1,3}$/u;
const GENERIC_HEADING = /^(?:cv|curriculum vitae|profil(?: maître| maitre| candidat)?|master profile|profile|candidate profile|résumé|resume|lettre de motivation|cover letter)$/i;

/** Un nom de personne dans un titre (« CV — Jane Doe », « Jane Doe · Profil maître ») : la partie qui a la forme d'un nom. */
export function nameInHeading(heading: string): string {
  for (const part of stripEmphasis(heading).split(/\s*[—–|:·]\s*|\s+-\s+/)) {
    const candidate = part.trim();
    if (candidate !== '' && !GENERIC_HEADING.test(candidate) && NAME_LIKE.test(candidate)) return candidate;
  }
  return '';
}

function labelledName(doc: string): string {
  const match = /^\s*(?:[-*]\s+)?(?:\*\*|__)?\s*(?:nom(?: complet)?|name|full name)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*([^\n*_]+)/im.exec(doc);
  const value = match?.[1]?.trim() ?? '';
  return NAME_LIKE.test(value) ? value : '';
}

/**
 * Le nom du candidat, qui signe la lettre : celui que l'appelant donne, sinon le titre du CV
 * sur mesure (`# CV — <nom>`, la forme de cv-tailor), sinon une ligne « Nom : … » du CV ou
 * du profil, sinon le titre du profil. Vide quand rien ne le dit.
 */
export function candidateName(explicit: string, cv: string, profile: string): string {
  if (explicit.trim() !== '') return explicit.trim();
  const heading = (doc: string): string => nameInHeading(/^#\s+(.+)$/m.exec(doc)?.[1] ?? '');
  return heading(cv) || labelledName(cv) || labelledName(profile) || heading(profile);
}

/**
 * La dernière ligne est le nom du candidat, seul, et l'en-tête porte le même nom ; sans nom
 * connu, la signature reprend au moins celui de l'en-tête de la lettre.
 */
export function signatureProblems(parts: LetterParts, name: string): string[] {
  const known = name.trim();
  const expected = known !== '' ? known : parts.name;
  const problems: string[] = [];
  if (known !== '' && parts.name !== '' && normalize(parts.name) !== normalize(known)) {
    problems.push(`l'en-tête doit porter le nom du candidat (« # ${known} ») : lu « ${excerpt(parts.name)} »`);
  }
  if (parts.signature === '') problems.push('la lettre ne finit pas par une signature : dernière ligne, le nom du candidat seul');
  else if (expected === '') problems.push("nom du candidat introuvable (ni l'entrée « name », ni le titre du CV, ni le profil, ni l'en-tête de la lettre) : rien à quoi comparer la signature");
  else if (normalize(parts.signature) !== normalize(expected)) {
    problems.push(`la lettre doit être signée du nom du candidat, seul sur la dernière ligne (« ${expected} ») : lu « ${excerpt(parts.signature)} »`);
  }
  return problems;
}

// ── Le contrôle complet ────────────────────────────────────────────────────────

export interface LetterRules {
  company: string;
  title: string;
  profile: string;
  /** Le texte de l'annonce : une source admise pour un chiffre ou un nombre (sur l'entreprise). */
  posting: string;
  /** Le nom qui signe ; vide : celui de l'en-tête. */
  name: string;
  language: Language;
  words: { min: number; max: number };
  layout: LetterLayout;
  minEvidence: number;
  maxDashes: number;
  slop: string[];
}

export const DEFAULT_LETTER_RULES: Omit<LetterRules, 'company' | 'title' | 'profile' | 'posting' | 'name' | 'language'> = {
  words: LETTER_WORDS,
  layout: LETTER_LAYOUT,
  minEvidence: MIN_EVIDENCE,
  maxDashes: LETTER_MAX_DASHES,
  slop: ALL_LETTER_SLOP,
};

export interface LetterBundle {
  letter: string | null;
  evidence: Evidence[];
}

export interface LetterOutcome {
  ok: boolean;
  problems: string[];
  words: number;
  lines: number;
  traced: number;
}

/** Le contrôle complet d'une lettre. Chaque problème dit quoi corriger ; l'agent les reçoit au tour suivant. */
export function checkLetter(bundle: LetterBundle, rules: LetterRules): LetterOutcome {
  if (bundle.letter === null || bundle.letter.trim() === '') {
    return { ok: false, problems: ['letter.md absent ou vide'], words: 0, lines: 0, traced: 0 };
  }
  const letter = bundle.letter;
  const parts = parseLetter(letter);
  const blocks = letterBlocks(parts);
  const sources = `${rules.profile}\n${rules.posting}`;
  const problems: string[] = [...structureProblems(parts), ...signatureProblems(parts, rules.name)];
  problems.push(...wordBudgetProblems(parts.body, rules.words));
  problems.push(...onePageProblems(blocks, rules.layout));
  problems.push(...mentionProblems(letter, rules.company, rules.title));
  problems.push(...languageProblems(parts.body, rules.language));
  const evidence = evidenceProblems(bundle.evidence, letter, rules.profile, rules.minEvidence);
  problems.push(...evidence.problems);
  const figures = unsupportedFigures(letter, sources);
  for (const figure of figures) problems.push(`chiffre « ${figure} » absent du profil maître et de l'annonce : affirmation sans source`);
  const lengths = unsupportedDurations(letter, rules.profile);
  for (const duration of lengths) problems.push(`durée « ${duration.replace(/y$/, ' an(s)').replace(/mo$/, ' mois').replace(/w$/, ' semaine(s)')} » absente du profil maître : une durée d'expérience se cite telle que le profil la donne`);
  const reported = new Set([...figures, ...lengths].map((value) => value.replace(/[^\d.]/g, '')));
  for (const value of unsupportedNumbers(parts.body, sources)) {
    if (!reported.has(value)) problems.push(`nombre « ${value} » absent du profil maître et de l'annonce : affirmation sans source`);
  }
  problems.push(...slopProblems(letter, rules.slop));
  problems.push(...dashProblems(letter, rules.maxDashes));
  problems.push(...placeholderProblems(letter));
  problems.push(...contactProblems(letter, rules.profile));
  return { ok: problems.length === 0, problems, words: letterWords(parts.body), lines: estimateLines(blocks, rules.layout), traced: evidence.traced };
}
