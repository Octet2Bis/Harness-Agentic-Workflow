/**
 * Règles pures du bloc `job-triage` : lire les critères du candidat (`criteres.json`), vérifier
 * ce que l'agent a extrait d'une annonce (`triage.json`) contre le texte de l'annonce, et en
 * déduire la décision. L'agent lit et cite ; le code vérifie que chaque citation est bien dans
 * l'annonce, qu'aucune langue exigée ni aucun salaire n'a été oublié (balayage du texte), puis
 * décide seul : une langue obligatoire que le candidat ne parle pas, un salaire annuel
 * maximal sous le seuil, un poste hybride ou sur site quand le candidat veut du télétravail
 * complet, ou (quand `experience_max_annees` est donné) une expérience exigée au-delà de ce
 * que le candidat a ou un intitulé senior, écarte l'offre ; un salaire absent, un mode de
 * travail non précisé, un « profil senior » dans le corps de l'annonce, une annonce lue en
 * partie ou un critère libre non rempli la laisse « à vérifier » ; sinon elle est retenue. Une
 * offre d'une plateforme 100 % télétravail (`REMOTE_ONLY_SOURCES`) dont l'annonce ne dit rien du
 * lieu de travail compte pour du télétravail complet, base notée dans les raisons. Une offre
 * publiée il y a plus de `offre_age_max_jours` jours (date de la ligne du tableau, 7 par défaut,
 * `offer-date.ts`) est écartée ; sans date lisible, la règle n'a aucun effet. Une présence au
 * bureau exigée pour une période (« for the first few months, new hires spend most days at the
 * Milan office », `officePeriodMarkers`) interdit le télétravail complet. Quand le profil du
 * candidat est donné, le cœur du poste (`checkCoreFit` : trois exigences centrales citées dans
 * l'annonce, chacune `backed` / `partial` / `missing` avec la citation du profil) : deux
 * exigences ou plus absentes du profil écartent l'offre, une seule fait une note « À renforcer ».
 */

import { ageLimitFor, readOfferAgeMaxDays, offerAge, tooOld } from './offer-date.ts';

// ── Critères ───────────────────────────────────────────────────────────────

export type UnknownSalaryPolicy = 'a_verifier' | 'garder' | 'ecarter';

/** `remote` de criteres.json : `full` (télétravail complet, défaut), `hybride_ok` (hybride accepté, sur site écarté), `indifferent`. */
export type RemotePolicy = 'full' | 'hybride_ok' | 'indifferent';

/** `zone_embauche` de criteres.json : `europe` (l'offre doit pouvoir embaucher un candidat en Europe, Royaume-Uni et Irlande compris), `monde` (défaut : règle coupée). */
export type HiringZonePolicy = 'europe' | 'monde';

export interface Criteria {
  langues: string[];
  salaire_min_annuel: number;
  salaire_inconnu: UnknownSalaryPolicy;
  taux_eur: Record<string, number>;
  remote: RemotePolicy;
  /** Années d'expérience au plus qu'une annonce peut exiger ; 0 : règle coupée (clé absente). */
  experience_max_annees: number;
  /** Mots d'intitulé qui disent un poste senior (normalisés) ; vide : règle coupée. */
  experience_labels_exclus: string[];
  /** Âge maximal d'une offre, en jours (date de publication de la ligne du tableau) ; 7 quand la clé manque, 0 : règle coupée. */
  offre_age_max_jours: number;
  /** `europe` : une offre qui n'embauche que hors Europe est écartée ; `monde` (clé absente) : règle coupée. */
  zone_embauche: HiringZonePolicy;
  autres: string[];
}

/** Taux de conversion vers l'euro, ordre de grandeur (octobre 2026) ; `taux_eur` de criteres.json les remplace. */
export const DEFAULT_RATES: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
  PLN: 0.23,
  SEK: 0.087,
  DKK: 0.134,
  NOK: 0.086,
  CZK: 0.04,
  RON: 0.2,
  HUF: 0.0025,
  BGN: 0.51,
  CAD: 0.67,
  AUD: 0.6,
};

/**
 * Lit `criteres.json` (déjà parsé). Clés : `langues` (codes ISO 639-1 parlés), `salaire_min_annuel`
 * (EUR brut annuel), `salaire_inconnu` (a_verifier par défaut), `taux_eur` (facultatif),
 * `remote` (`full` par défaut : le radar part d'un candidat 100 % télétravail ; `hybride_ok`,
 * `indifferent`), `experience_max_annees` (facultatif, entier : années d'expérience que le
 * candidat a au plus ; absent ou 0 coupe la règle), `experience_labels_exclus` (facultatif :
 * mots d'intitulé senior ; `DEFAULT_SENIORITY_LABELS` quand la clé manque et que
 * `experience_max_annees` est donné), `offre_age_max_jours` (facultatif, entier : jours depuis
 * la publication au-delà desquels l'offre est écartée ; 7 quand la clé manque, 0 coupe la règle),
 * `zone_embauche` (facultatif : `europe` écarte une offre qui n'embauche que hors Europe ; `monde`
 * par défaut), `exclure` (facultatif, passé à l'agent comme critères libres).
 */
export function readCriteria(raw: unknown): { criteria: Criteria | null; problems: string[] } {
  const problems: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { criteria: null, problems: ['criteres.json must be a JSON object'] };
  const value = raw as Record<string, unknown>;
  const langues = Array.isArray(value.langues) ? value.langues.filter((l): l is string => typeof l === 'string').map((l) => l.trim().toLowerCase()) : [];
  if (langues.length === 0 || langues.some((l) => !/^[a-z]{2}$/.test(l))) problems.push('criteres.json: "langues" must list ISO 639-1 codes, e.g. ["fr", "en"]');
  const min = typeof value.salaire_min_annuel === 'number' ? value.salaire_min_annuel : Number.NaN;
  if (!Number.isFinite(min) || min < 0) problems.push('criteres.json: "salaire_min_annuel" must be a number (EUR, gross per year; 0 disables the rule)');
  const policy = value.salaire_inconnu ?? 'a_verifier';
  if (policy !== 'a_verifier' && policy !== 'garder' && policy !== 'ecarter') problems.push('criteres.json: "salaire_inconnu" must be "a_verifier", "garder" or "ecarter"');
  const rates: Record<string, number> = { ...DEFAULT_RATES };
  if (value.taux_eur !== undefined) {
    if (value.taux_eur === null || typeof value.taux_eur !== 'object' || Array.isArray(value.taux_eur)) problems.push('criteres.json: "taux_eur" must be an object such as {"USD": 0.92}');
    else
      for (const [currency, rate] of Object.entries(value.taux_eur as Record<string, unknown>)) {
        if (typeof rate === 'number' && rate > 0) rates[currency.toUpperCase()] = rate;
        else problems.push(`criteres.json: taux_eur.${currency} must be a positive number`);
      }
  }
  const remote = value.remote ?? 'full';
  if (remote !== 'full' && remote !== 'hybride_ok' && remote !== 'indifferent') problems.push('criteres.json: "remote" must be "full" (default), "hybride_ok" or "indifferent"');
  const maxYearsRaw = value.experience_max_annees ?? 0;
  const maxYearsOk = typeof maxYearsRaw === 'number' && Number.isInteger(maxYearsRaw) && maxYearsRaw >= 0;
  if (!maxYearsOk) problems.push('criteres.json: "experience_max_annees" must be an integer (years of experience the candidate has, at most; 0 or absent disables the rule)');
  const experience_max_annees = maxYearsOk ? (maxYearsRaw as number) : 0;
  let experience_labels_exclus: string[] = experience_max_annees > 0 ? [...DEFAULT_SENIORITY_LABELS] : [];
  if (value.experience_labels_exclus !== undefined) {
    if (!Array.isArray(value.experience_labels_exclus) || value.experience_labels_exclus.some((l) => typeof l !== 'string')) problems.push('criteres.json: "experience_labels_exclus" must be an array of title words such as ["senior", "lead", "head of"]');
    else experience_labels_exclus = (value.experience_labels_exclus as string[]).map((l) => normalize(l)).filter((l) => l !== '');
  }
  const age = readOfferAgeMaxDays(value);
  if (age.problem !== null) problems.push(age.problem);
  const zone = value.zone_embauche ?? 'monde';
  if (zone !== 'europe' && zone !== 'monde') problems.push('criteres.json: "zone_embauche" must be "europe" or "monde" (default)');
  const autres: string[] = [];
  if (Array.isArray(value.exclure)) for (const e of value.exclure) if (typeof e === 'string' && e.trim() !== '') autres.push(`exclure: ${e.trim()}`);
  if (problems.length > 0) return { criteria: null, problems };
  return { criteria: { langues, salaire_min_annuel: min, salaire_inconnu: policy as UnknownSalaryPolicy, taux_eur: rates, remote: remote as RemotePolicy, experience_max_annees, experience_labels_exclus, offre_age_max_jours: age.days, zone_embauche: zone as HiringZonePolicy, autres }, problems };
}

// ── Langues ────────────────────────────────────────────────────────────────

/** Noms des langues (en, fr, it, es, de, pt, nl, langue elle-même), sans accents, en minuscules. */
export const LANGUAGE_NAMES: Record<string, string[]> = {
  en: ['english', 'anglais', 'ingles', 'inglese', 'englisch', 'engels', 'angielski', 'inglesa'],
  fr: ['french', 'francais', 'frances', 'francese', 'franzosisch', 'frans', 'francuski', 'francesa'],
  it: ['italian', 'italien', 'italiano', 'italienisch', 'italiaans', 'wloski', 'italiana'],
  es: ['spanish', 'espagnol', 'espanol', 'castellano', 'spagnolo', 'spanisch', 'spaans', 'espanhol', 'hiszpanski', 'espanola', 'spagnola'],
  de: ['german', 'allemand', 'deutsch', 'aleman', 'tedesco', 'duits', 'alemao', 'niemiecki', 'tedesca', 'alemana'],
  pt: ['portuguese', 'portugais', 'portugues', 'portoghese', 'portugiesisch', 'portugees', 'portugalski', 'portuguesa'],
  nl: ['dutch', 'neerlandais', 'nederlands', 'flemish', 'flamand', 'olandese', 'niederlandisch', 'holenderski'],
  pl: ['polish', 'polonais', 'polski', 'polaco', 'polacco', 'polnisch', 'pools'],
  sv: ['swedish', 'suedois', 'svenska', 'schwedisch'],
  da: ['danish', 'danois', 'dansk', 'danisch'],
  no: ['norwegian', 'norvegien', 'norsk', 'norwegisch'],
  fi: ['finnish', 'finnois', 'suomi', 'finnisch'],
  cs: ['czech', 'tcheque', 'cestina', 'tschechisch'],
  sk: ['slovak', 'slovaque', 'slovencina'],
  ro: ['romanian', 'roumain', 'romana', 'rumanisch'],
  hu: ['hungarian', 'hongrois', 'magyar', 'ungarisch'],
  bg: ['bulgarian', 'bulgare', 'bulgarisch'],
  hr: ['croatian', 'croate', 'hrvatski', 'kroatisch'],
  el: ['greek', 'grec', 'griechisch'],
  tr: ['turkish', 'turc', 'turkce', 'turkisch'],
  ru: ['russian', 'russe', 'russisch'],
  uk: ['ukrainian', 'ukrainien', 'ukrainisch'],
  ar: ['arabic', 'arabe', 'arabisch'],
  he: ['hebrew', 'hebreu', 'hebraisch'],
  zh: ['chinese', 'mandarin', 'cantonese', 'chinois', 'chinesisch'],
  ja: ['japanese', 'japonais', 'japanisch'],
  ko: ['korean', 'coreen', 'koreanisch'],
  hi: ['hindi'],
};

/** Noms qui sont aussi des mots courants : comptés seulement avec leur majuscule dans l'annonce. */
export const CAPITALIZED_ONLY = new Set(['polish', 'mandarin']);

export const LANGUAGE_LABELS_FR: Record<string, string> = {
  en: "l'anglais", fr: 'le français', it: "l'italien", es: "l'espagnol", de: "l'allemand", pt: 'le portugais', nl: 'le néerlandais',
  pl: 'le polonais', sv: 'le suédois', da: 'le danois', no: 'le norvégien', fi: 'le finnois', cs: 'le tchèque', sk: 'le slovaque',
  ro: 'le roumain', hu: 'le hongrois', bg: 'le bulgare', hr: 'le croate', el: 'le grec', tr: 'le turc', ru: 'le russe',
  uk: "l'ukrainien", ar: "l'arabe", he: "l'hébreu", zh: 'le chinois', ja: 'le japonais', ko: 'le coréen', hi: "l'hindi",
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS_FR[code] ?? `la langue « ${code} »`;
}

/** Mots qui disent qu'une langue est demandée (anglais, français, italien, espagnol, allemand, portugais, néerlandais). */
const REQUIREMENT_WORDS =
  /\b(fluen\w*|native|mother tongue|proficien\w*|bilingual|speak\w*|spoken|written|verbal|[abc][12]\b|level|required|requirement|must|mandatory|essential|plus|nice to have|preferred|advantage|asset|knowledge|command of|courant|couramment|bilingue|natif|native|maitrise\w*|langue\w*|language\w*|niveau|parl\w*|exige\w*|madrelingua|fluente|conoscenza|lingua|ottim\w*|fliess\w*|flie\w*|sprachkenntnisse|muttersprache|kenntnisse|idioma\w*|nativo|fluido|dominio|lingua)\b/;

/** Minuscules, sans accents, apostrophes et tirets unifiés, espaces réduits. */
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‛′`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Même chose sans passer en minuscules (pour les noms comptés avec leur majuscule). */
function normalizeKeepCase(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

export interface LanguageMention {
  code: string;
  name: string;
  excerpt: string;
}

/**
 * Les langues que l'annonce nomme à moins de 100 caractères d'un mot d'exigence (« fluent »,
 * « courant », « madrelingua », un niveau C1…). C'est le filet : chacune doit apparaître dans
 * l'extraction, exigée, souhaitée ou écartée avec sa raison.
 */
export function scanLanguageMentions(posting: string): LanguageMention[] {
  const text = normalizeKeepCase(posting);
  const lower = text.toLowerCase();
  const seen = new Map<string, LanguageMention>();
  for (const [code, names] of Object.entries(LANGUAGE_NAMES)) {
    for (const name of names) {
      const target = CAPITALIZED_ONLY.has(name) ? new RegExp(`\\b${name[0].toUpperCase()}${name.slice(1)}\\b`, 'g') : new RegExp(`\\b${name}\\b`, 'gi');
      for (const match of text.matchAll(target)) {
        const start = Math.max(0, match.index - 100);
        const end = Math.min(text.length, match.index + match[0].length + 100);
        const window = lower.slice(start, end);
        if (REQUIREMENT_WORDS.test(window) && !seen.has(code)) {
          seen.set(code, { code, name: match[0], excerpt: text.slice(start, end).trim() });
        }
      }
    }
  }
  return [...seen.values()];
}

// ── Salaire ────────────────────────────────────────────────────────────────

const CURRENCY = String.raw`(?:€|eur(?:os?)?\b|\$|usd\b|£|gbp\b|chf\b|pln\b|zl\b|zł|sek\b|dkk\b|nok\b|czk\b|kc\b|ron\b|lei\b|huf\b|bgn\b|cad\b|aud\b)`;
const AMOUNT = String.raw`\d[\d\s.,  ]*\s?(?:k|m)?`;
const SALARY_AMOUNT = new RegExp(String.raw`${CURRENCY}\s?${AMOUNT}|${AMOUNT}\s?${CURRENCY}`, 'gi');

/** Les montants avec devise que l'annonce contient (filet : un salaire que l'agent dirait absent). */
export function scanSalaryAmounts(posting: string): string[] {
  const out: string[] = [];
  let lastEnd = -1;
  for (const match of posting.matchAll(SALARY_AMOUNT)) {
    if (!/\d/.test(match[0])) continue;
    // Deux montants proches (« entre 38 000 € et 45 000 € ») ne font qu'un extrait.
    if (lastEnd >= 0 && match.index - lastEnd < 40) continue;
    lastEnd = match.index + match[0].length;
    const start = Math.max(0, match.index - 60);
    out.push(posting.slice(start, match.index + match[0].length + 40).replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * Les nombres d'une citation de salaire : « 38k », « 38 000 », « 38,000 », « 38.000 », « 3 200,50 ».
 * Un nombre suivi de k vaut ×1000 ; quand la citation porte un k quelque part, un nombre nu
 * sous 1000 vaut aussi ×1000 (« 38 - 50k€ »).
 */
export function quoteNumbers(quote: string): number[] {
  const values: number[] = [];
  const hasK = /\d\s?k\b/i.test(quote);
  for (const match of quote.matchAll(/(\d{1,3}(?:[ .,  ]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s?(k\b|K\b)?/g)) {
    const whole = Number(match[1].replace(/[ .,  ]/g, ''));
    const value = match[2] !== undefined ? Number(`${whole}.${match[2]}`) : whole;
    if (!Number.isFinite(value)) continue;
    if (match[3] !== undefined) values.push(value * 1000);
    else {
      values.push(value);
      if (hasK && value < 1000) values.push(value * 1000);
    }
  }
  return values;
}

export type Period = 'year' | 'month' | 'week' | 'day' | 'hour';

/** Passage à l'annuel : 12 mois, 52 semaines, 218 jours travaillés, 1 607 heures (base légale française). */
export const PERIOD_FACTOR: Record<Period, number> = { year: 1, month: 12, week: 52, day: 218, hour: 1607 };

// ── Langue de l'annonce ────────────────────────────────────────────────────

/** Mots-outils fréquents par langue (sans accents) : assez pour reconnaître la langue d'un texte de plusieurs centaines de mots. */
export const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'you', 'with', 'for', 'our', 'are', 'will', 'your', 'this', 'that', 'have', 'from', 'what', 'who', 'about'],
  fr: ['le', 'les', 'des', 'et', 'vous', 'nous', 'est', 'une', 'pour', 'dans', 'avec', 'sur', 'qui', 'que', 'votre', 'notre', 'du'],
  it: ['il', 'gli', 'della', 'delle', 'del', 'che', 'con', 'per', 'una', 'sono', 'nostro', 'nostra', 'anche', 'nel', 'alla', 'degli'],
  es: ['el', 'los', 'las', 'del', 'que', 'con', 'para', 'una', 'por', 'nuestro', 'nuestra', 'como', 'tu', 'esta', 'somos', 'y'],
  de: ['der', 'die', 'das', 'und', 'mit', 'fur', 'wir', 'sie', 'ist', 'ein', 'eine', 'auf', 'bei', 'unser', 'unsere', 'du', 'dich'],
  pt: ['os', 'das', 'dos', 'com', 'para', 'uma', 'voce', 'nossa', 'nosso', 'nao', 'em', 'na', 'no', 'ao', 'sao', 'mais'],
  nl: ['het', 'een', 'van', 'en', 'voor', 'met', 'wij', 'je', 'jij', 'ons', 'onze', 'zijn', 'bij', 'naar', 'ook', 'niet'],
  pl: ['jest', 'oraz', 'dla', 'nie', 'jak', 'sie', 'na', 'w', 'z', 'do', 'od', 'po', 'przez', 'naszego', 'naszej', 'czy'],
};

/** Le texte de l'annonce sans les champs du radar ajoutés par l'appelant. */
export function postingBody(posting: string): string {
  const cut = posting.indexOf('--- Champs du radar');
  return cut >= 0 ? posting.slice(0, cut) : posting;
}

/**
 * La langue d'un texte par ses mots-outils, ou null quand le texte est trop court ou que deux
 * langues se tiennent (annonce bilingue, page à moitié dans la langue du site) : il faut au
 * moins 25 mots-outils pour la première, et deux fois plus que pour la deuxième.
 */
export function detectLanguage(textValue: string): { code: string; hits: number; runnerUp: number } | null {
  const words = normalize(textValue).split(/[^a-z]+/).filter((w) => w !== '');
  const scores = Object.entries(STOPWORDS).map(([code, list]) => {
    const set = new Set(list);
    return { code, hits: words.filter((w) => set.has(w)).length };
  });
  scores.sort((a, b) => b.hits - a.hits);
  const [first, second] = scores;
  if (!first || first.hits < 25 || first.hits < 2 * (second?.hits ?? 0)) return null;
  return { code: first.code, hits: first.hits, runnerUp: second?.hits ?? 0 };
}

/**
 * La langue d'une annonce écrite surtout dans une écriture non latine (cyrillique, grec, CJK,
 * arabe, hébreu) : les mots-outils de `detectLanguage` n'y voient rien, et le tri par règles a
 * retenu une annonce rédigée en ukrainien (Respontika, test des petits modèles, 2026-11-08).
 * Au moins 200 lettres, plus de 30 % dans l'écriture ; cyrillique : ukrainien (ї, є, і) ou russe
 * (ы, э, ъ, ё). Null sinon.
 */
const SCRIPTS: [string, RegExp][] = [['uk', /[Ѐ-ӿ]/g], ['el', /[Ͱ-Ͽ]/g], ['zh', /[一-鿿]/g], ['ja', /[぀-ヿ]/g], ['ko', /[가-힯]/g], ['ar', /[؀-ۿ]/g], ['he', /[֐-׿]/g]];
export function scriptLanguage(textValue: string): string | null {
  const letters = (textValue.match(/\p{L}/gu) ?? []).length;
  if (letters < 200) return null;
  for (const [code, re] of SCRIPTS) {
    const n = (textValue.match(re) ?? []).length;
    if (n / letters > 0.3) return code === 'uk' && /[ыэъё]/i.test(textValue) && !/[їєі]/i.test(textValue) ? 'ru' : code;
  }
  return null;
}

/**
 * La phrase qui dit que l'offre ne prend plus de candidatures (« Les candidatures ne sont plus
 * acceptées », « No longer accepting applications ») : une annonce close est écartée par le code
 * (Amzai, 2026-11-08). Rend la formule (texte normalisé), vide sinon.
 */
const CLOSED_POSTING = /(?:les )?candidatures ne sont plus acceptees|n'accepte plus de candidatures|no longer accepting applications|applications (?:are|have) closed|this job is no longer available|this position (?:has been|is) (?:filled|closed)|cette offre n'est plus disponible|offre (?:expiree|pourvue)/;
export function closedPostingSentence(posting: string): string {
  const hit = CLOSED_POSTING.exec(normalize(postingBody(posting)));
  // La formule seule : sur une page LinkedIn, la « phrase » autour est l'habillage de la page.
  return hit === null ? '' : hit[0];
}

// ── Mode de travail ────────────────────────────────────────────────────────

/** Mots qui disent qu'un poste est hybride ou sur site (sans « office » seul : « remote-first, office optional » reste du télétravail). */
export const ON_SITE_MARKERS = [
  'hybrid', 'hybride', 'on-site', 'onsite', 'on site', 'sur site', 'présentiel', 'in-office', 'in office', 'office-based',
  'days in office', 'days per week in', 'jours sur site', 'jours par semaine', 'au bureau', 'relocation', 'relocate',
  'must be located in', 'based in our', 'from our office', 'twice a week', 'three times a week', 'office days',
  // 2026-11-14 : télétravail partiel dit en toutes lettres.
  'partially remote', 'partly remote', 'semi-remote', 'télétravail partiel', 'travail hybride',
];

/** Mots qui disent explicitement qu'un poste est en télétravail complet ; quand l'un d'eux est là, il l'emporte sur les marqueurs sur site. */
export const REMOTE_MARKERS = [
  '100% remote', '100 % remote', 'fully remote', 'full remote', 'full-remote', 'remote-first', 'remote-only', 'remote only',
  'télétravail total', '100% télétravail', '100 % télétravail', 'télétravail complet', 'work from anywhere', 'anywhere in europe', 'remote (europe)',
  // 2026-11-14 (Antoine : n'en manquer aucun à cause des mots) : les autres façons d'écrire le télétravail complet.
  'all-remote', 'all remote', 'remote-native', 'remote-based', 'remote based', 'remote by default', 'entirely remote', 'completely remote', 'totally remote',
  'fully distributed', 'distributed team', 'distributed company', 'async-first', 'location independent', 'location-independent', 'location agnostic',
  'home-based', 'home based', 'work from home', 'work-from-home', 'work-from-anywhere', 'from anywhere in', 'anywhere in the eu', 'anywhere in emea',
  'remote (emea)', 'remote (eu)', 'remote - europe', 'remote - emea', 'remote, europe',
  '100% à distance', '100 % à distance', 'entièrement à distance', 'totalement à distance', '100% distanciel', 'full télétravail', 'télétravail intégral',
  'en télétravail complet', 'depuis chez vous', 'où que vous soyez', "depuis n'importe où", '100% remoto', 'totalmente remoto',
];

/**
 * Les usages du métier et les phrases niées qui ressemblent à un mode de travail (2026-11-14) :
 * « hybrid cloud » (Canonical), « on-site SEO », « in-person events », « occasional on-site
 * retreats », « no relocation required », « office optional », « must be located in the EU »
 * (une zone, pas un bureau). Effacés du texte avant la recherche des marqueurs sur site.
 */
const NOT_WORK_MODE: RegExp[] = [
  /(?<![\p{L}\d])hybrid(?:e)? (?:cloud|multi-?cloud|app|apps|application\w*|mobile|infra\w*|it|saas|deployment\w*|workload\w*|architecture\w*|solution\w*|car\w*|vehicle\w*|engine\w*|data|event\w*|kubernetes|edge|integration\w*)(?![\p{L}\d])/gu,
  /(?<![\p{L}\d])(?:on-site|onsite|on site|sur site) (?:seo|search|conversion\w*|optimi[sz]ation\w*|experience\w*|content|personali[sz]ation|tracking|analytics|behaviou?r|ux|cro|engagement|marketing|events?|activation|merchandising|banners?|messaging|campaigns?|retreats?|meetups?|gatherings?|offsites?|visits?|support|training|testing|web|internet)(?![\p{L}\d])/gu,
  /(?<![\p{L}\d])(?:occasional|optional|annual|quarterly|yearly|regular|periodic|company|team) (?:on-site|onsite|on site|in-person|in person)(?![\p{L}\d])/gu,
  /(?<![\p{L}\d])in[- ]person (?:events?|meetups?|retreats?|offsites?|gatherings?|team ?building|conferences?|summits?|trade ?shows?|workshops?)(?![\p{L}\d])/gu,
  /(?<![\p{L}\d])(?:no|not|without|never|zero|no need to|don't need to|pas de|pas besoin de|sans|aucune?|nul besoin de)(?![\p{L}\d])(?:(?!remote|teletravail|distance)[^.;!?\n,]){0,25}?(?:office|bureau|on-site|onsite|on site|sur site|presentiel|reloca\w*|commut\w*|demenag\w*)/gu,
  /(?<![\p{L}\d])(?:office|bureau|on-site|onsite|presence)(?![\p{L}\d])[^.;!?\n]{0,30}?(?:optional|optionnel\w*|facultati\w*|if you (?:wish|like|want)|si (?:vous le souhaitez|tu le souhaites))/gu,
  /(?<![\p{L}\d])must be (?:located|based) (?:in|within) (?:europe|the eu|the european union|emea|the uk|the united kingdom|one of|an eu|a european|any of)/gu,
];
export function maskNotWorkMode(text: string): string {
  return NOT_WORK_MODE.reduce((t, re) => t.replace(re, (m) => ' '.repeat(m.length)), text);
}

/**
 * Présence au bureau exigée pour une période (intégration, premiers mois) : « for the first few
 * months, new hires spend most days at the Milan office » (Bending Spoons, 2026-10-24, passée en
 * « Mode de travail non précisé »). Formes fixes, sur le texte normalisé (minuscules, sans
 * accents) ; une phrase qui dit la présence facultative (« optional », « facultatif ») ne compte
 * pas. Plus fort qu'un marqueur de télétravail : « fully remote after onboarding » reste hybride
 * pendant des mois, donc interdit `full_remote` même quand `REMOTE_MARKERS` trouve quelque chose.
 */
const OFFICE_WORD = String.raw`(?:office|offices|hq|headquarters|bureau|bureaux|locaux|campus)`;
const PRESENCE_WORD = String.raw`(?:${OFFICE_WORD}|on-site|onsite|on site|in person|in-person|sur site|presentiel)`;
export const OFFICE_PERIOD_PATTERNS: RegExp[] = [
  // « spend most days at the Milan office », « 3 days a week at our Paris HQ »
  new RegExp(String.raw`(?<![\p{L}\d])(?:most|all|several|many|\d+|two|three|four|five) (?:days|weeks)[^.;!?]{0,30}? (?:at|in|from) (?:the|our) (?:[\p{L}-]+ ){0,3}?${OFFICE_WORD}`, 'u'),
  // « for the first few months … at the office », « during the first 3 months, on-site »
  new RegExp(String.raw`(?<![\p{L}\d])(?:first|initial|opening) (?:few |couple of |\d+ |two |three |four |six )?(?:weeks|months)[^.;!?]{0,100}?${PRESENCE_WORD}`, 'u'),
  // « onboarding at our Lisbon office », « in-person onboarding », « office-based onboarding »
  new RegExp(String.raw`(?<![\p{L}\d])onboarding[^.;!?]{0,80}?${PRESENCE_WORD}`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\d])(?:in-person|in person|on-site|onsite|office-based) onboarding`, 'u'),
  // « les premiers mois au bureau de Lyon », « période d'intégration en présentiel »
  new RegExp(String.raw`(?<![\p{L}\d])(?:premiers|premieres) (?:semaines|mois)[^.;!?]{0,100}?(?:bureau|bureaux|locaux|sur site|presentiel|siege)`, 'u'),
  new RegExp(String.raw`(?<![\p{L}\d])(?:periode d'integration|integration|onboarding)[^.;!?]{0,80}?(?:au bureau|aux bureaux|dans nos locaux|sur site|en presentiel|au siege)`, 'u'),
];
const OPTIONAL_PRESENCE = /\b(?:optional|optionnel|optionnelle|facultati\w*|if you wish|if you like|if you want|si vous le souhaitez|remote onboarding|onboarding a distance|no (?:office|bureau)|without (?:an |the )?office|sans bureau)\b/u;

/** Les passages de l'annonce (texte normalisé, citables tels quels) qui exigent une présence au bureau pour une période ; vide sinon. */
export function officePeriodMarkers(posting: string): string[] {
  const text = normalize(postingBody(posting));
  const out: string[] = [];
  for (const pattern of OFFICE_PERIOD_PATTERNS) {
    const hit = pattern.exec(text);
    if (hit === null) continue;
    const sentence = markerSentence(posting, hit[0]);
    if (OPTIONAL_PRESENCE.test(sentence !== '' ? sentence : hit[0])) continue;
    if (!out.includes(hit[0])) out.push(hit[0]);
  }
  return out;
}

function markersIn(text: string, markers: string[]): string[] {
  const found: { marker: string; index: number }[] = [];
  for (const marker of markers) {
    const m = normalize(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const index = text.search(new RegExp(`(?<![\\p{L}\\d])${m}(?![\\p{L}\\d])`, 'u'));
    if (index >= 0) found.push({ marker, index });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.marker);
}

/**
 * Les marqueurs de mode de travail que l'annonce contient, dans l'ordre du texte : `on_site`
 * (hybride ou sur site) et `remote` (télétravail complet, explicite). C'est le filet : un
 * marqueur sur site sans marqueur de télétravail interdit « full_remote », et tout marqueur
 * interdit « not_stated ». `office_period` (`officePeriodMarkers`, compris dans `on_site`) : une
 * présence au bureau exigée pour une période, qui interdit « full_remote » même à côté d'un
 * marqueur de télétravail.
 */
export function detectWorkMode(posting: string): { on_site: string[]; remote: string[]; office_period: string[] } {
  const text = normalize(postingBody(posting));
  const office_period = officePeriodMarkers(posting);
  const on_site = markersIn(maskNotWorkMode(text), ON_SITE_MARKERS);
  return { on_site: [...on_site, ...office_period.filter((m) => !on_site.includes(m))], remote: markersIn(text, REMOTE_MARKERS), office_period };
}

/**
 * La phrase de l'annonce (texte normalisé : minuscules, sans accents, 200 caractères au plus) qui
 * porte le marqueur : rendue à l'agent avec le problème, pour qu'il la retrouve et la cite (une
 * citation normalisée passe le contrôle mot pour mot). Vide si le marqueur n'y est pas.
 */
export function markerSentence(posting: string, marker: string): string {
  const text = normalize(postingBody(posting));
  const m = normalize(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = new RegExp(`(?<![\\p{L}\\d])${m}(?![\\p{L}\\d])`, 'u').exec(text);
  if (hit === null) return '';
  const before = text.slice(Math.max(0, hit.index - 120), hit.index);
  const after = text.slice(hit.index, hit.index + 160);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('; '), before.lastIndexOf(' | '));
  const end = after.search(/[.!?;](?:\s|$)| \| /);
  return `${before.slice(start >= 0 ? start + 2 : 0)}${end >= 0 ? after.slice(0, end + 1) : after}`.trim();
}

/**
 * Les plateformes qui ne publient que du télétravail complet (le radar les interroge sans filtre
 * de lieu) : une offre qui en vient et dont l'annonce ne dit rien du lieu de travail compte pour
 * du télétravail, sauf mention hybride, sur site ou de jours au bureau (`ON_SITE_MARKERS`).
 * Chaque entrée : les mots qui reconnaissent la source (tous requis, sans accents), le nom affiché.
 */
export const REMOTE_ONLY_SOURCES: { match: string[]; name: string }[] = [
  { match: ['himalayas'], name: 'Himalayas' },
  { match: ['jobicy'], name: 'Jobicy' },
  { match: ['weworkremotely'], name: 'WeWorkRemotely' },
  { match: ['we work remotely'], name: 'WeWorkRemotely' },
  { match: ['remoteok'], name: 'RemoteOK' },
  { match: ['remote ok'], name: 'RemoteOK' },
  { match: ['remotive'], name: 'Remotive' },
  { match: ['working nomads'], name: 'Working Nomads' },
  { match: ['jobspresso'], name: 'Jobspresso' },
  { match: ['eu remote jobs'], name: 'EU Remote Jobs' },
  { match: ['welcome to the jungle', 'teletravail'], name: 'Welcome to the Jungle (page télétravail)' },
  { match: ['wttj', 'teletravail'], name: 'Welcome to the Jungle (page télétravail)' },
];

/** Le nom de la plateforme 100 % télétravail d'où vient l'offre (`source` du radar), ou null. */
export function remoteOnlySource(source: string): string | null {
  const s = normalize(source);
  if (s === '') return null;
  return REMOTE_ONLY_SOURCES.find((r) => r.match.every((w) => s.includes(w)))?.name ?? null;
}

// ── Expérience ─────────────────────────────────────────────────────────────

/** Mots d'intitulé qui disent un poste senior ; `experience_labels_exclus` de criteres.json les remplace. */
export const DEFAULT_SENIORITY_LABELS = ['senior', 'lead', 'head of', 'director', 'directeur', 'directrice', 'principal', 'staff', 'vp', 'chief'];

/** Suites qui font d'un mot de la liste autre chose qu'une séniorité (« lead generation » est un métier, « staff accountant » un poste d'exécution). */
const LABEL_EXCEPTIONS: Record<string, string[]> = {
  lead: ['gen', 'generation', 'qualification', 'scoring', 'nurturing', 'management', 'magnet', 'routing'],
  staff: ['accountant', 'nurse', 'writer', 'attorney'],
};

/**
 * Les mots de `labels` que `text` contient, entiers (« senior » dans « seniority » ne compte
 * pas), dans l'ordre du texte. Sur l'intitulé du poste, c'est la règle dure ; sur le corps de
 * l'annonce, le code ne s'en sert que pour reconnaître le label que l'agent a relevé.
 */
export function seniorityLabelsIn(text: string, labels: string[]): string[] {
  const t = normalize(text);
  const found: { label: string; index: number }[] = [];
  for (const raw of labels) {
    const label = normalize(raw);
    if (label === '') continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exceptions = LABEL_EXCEPTIONS[label];
    const after = exceptions && exceptions.length > 0 ? `(?!\\s+(?:${exceptions.join('|')})(?![\\p{L}\\d]))` : '';
    const index = t.search(new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])${after}`, 'u'));
    if (index >= 0) found.push({ label, index });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.label);
}

const WORD_NUMBERS: Record<string, number> = {
  un: 1, une: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5,
  six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10,
};
const NUMBER_WORD = String.raw`(?:\d{1,2}|${Object.keys(WORD_NUMBERS).join('|')})`;
/** « 7 ans », « 3 à 5 ans », « 5+ years », « five years », « 3-5 yrs » : le nombre (ou la fourchette), le « + », le mot année. */
const YEARS_PHRASE = new RegExp(String.raw`(?<![\p{L}\d])(${NUMBER_WORD})(?:\s*(?:-|a|to|et|and|ou|or|\/)\s*(${NUMBER_WORD}))?\s*(\+)?\s*(?:ans?|annees?|years?|yrs?)(?![\p{L}\d])`, 'gu');
/** Après les années : « d'expérience », « of relevant experience », « ' experience », « minimum d'expérience » (deux mots au plus entre les deux). */
const EXPERIENCE_AFTER = /^[\s'",]*(?:(?:d'|de|of|in|dans|en|as)\s*)?(?:\S+\s+){0,2}?(?:d'|de\s|of\s)?(?:experien|experimente|exp(?![\p{L}])|xp(?![\p{L}])|background|track record)/u;
/** Avant les années : « expérience de », « expérience professionnelle de », « experience: », « experience of at least ». */
const EXPERIENCE_BEFORE = /(?:experien\w*|experimente\w*|(?<![\p{L}])exp|(?<![\p{L}])xp|background|track record)[^\p{L}\d]*(?:\S+\s+){0,4}?$/u;
/** Un seuil juste avant le nombre suffit : « minimum 5 years », « au moins 4 ans ». */
const THRESHOLD_BEFORE = /(?:minimum|min\.?|au moins|au minimum|at least|a minimum of|plus de|more than|over|upwards of)\s*(?:de\s|of\s)?$/u;
/** Un plafond juste avant le nombre : « jusqu'à 3 ans », « up to 3 years », « moins de 2 ans ». */
const CEILING_BEFORE = /(?:jusqu'a|up to|moins de|less than|maximum|max\.?)\s*(?:de\s|of\s)?$/u;
/** « 5+ years in B2B SaaS » : le « + » suivi du domaine vaut une exigence d'expérience. */
const DOMAIN_AFTER = /^\s*(?:in|of|as|dans|en|chez|sur|working|leading|managing|building)(?![\p{L}])/u;
/** L'entreprise parle d'elle-même (« nous avons 10 ans d'expérience », « depuis 7 ans ») : pas une exigence. */
const COMPANY_VOICE = /(?:we have|we've|nous avons|nous cumulons|forts? de|fortes? de|notre (?:entreprise|societe|equipe|cabinet)|our (?:company|team|firm) has|depuis|since|founded|cree[es]?|fondee?)\s*(?:plus de|more than|over|pres de|nearly|almost)?\s*$/u;

export interface ExperienceMention {
  years_min: number | null;
  years_max: number | null;
  excerpt: string;
}

function yearsValue(token: string | undefined): number | null {
  if (token === undefined) return null;
  const n = /^\d+$/.test(token) ? Number(token) : WORD_NUMBERS[token];
  return n !== undefined && n <= 40 ? n : null;
}

/**
 * Les exigences d'années d'expérience que l'annonce contient, en français et en anglais
 * (« Minimum 7 ans d'expérience », « 5+ years in product marketing », « 3 à 5 ans », « at least
 * 4 years' experience »), hors champs du radar. Une fourchette donne sa borne basse en
 * `years_min` ; « jusqu'à 3 ans » ne donne qu'un `years_max`. « 7 ans d'existence », « 2024 »,
 * « +33 6 12 34 56 78 » ou « depuis 10 ans » ne comptent pas. C'est le filet : chaque mention
 * doit se retrouver dans l'extraction (`experience.quote`, ou `experience.ignored` avec sa raison).
 */
export function scanExperienceYears(posting: string): ExperienceMention[] {
  const text = normalize(postingBody(posting));
  const out: ExperienceMention[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(YEARS_PHRASE)) {
    const first = yearsValue(match[1]);
    const second = yearsValue(match[2]);
    if (first === null) continue;
    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 60), start);
    const after = text.slice(end, end + 60);
    if (COMPANY_VOICE.test(before)) continue;
    const plus = match[3] !== undefined;
    const isRequirement = EXPERIENCE_AFTER.test(after) || EXPERIENCE_BEFORE.test(before) || THRESHOLD_BEFORE.test(before) || (plus && DOMAIN_AFTER.test(after));
    if (!isRequirement) continue;
    let years_min: number | null = first;
    let years_max: number | null = second;
    if (second !== null && second < first) [years_min, years_max] = [second, first];
    if (second === null && CEILING_BEFORE.test(before)) [years_min, years_max] = [null, first];
    const key = `${years_min}-${years_max}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ years_min, years_max, excerpt: text.slice(Math.max(0, start - 50), Math.min(text.length, end + 40)).trim() });
  }
  return out;
}

/** Les nombres d'années d'une citation d'expérience : chiffres à deux positions au plus et nombres en lettres (un à dix, one à ten). */
export function quoteYears(quote: string): number[] {
  const q = normalize(quote);
  const out: number[] = [];
  for (const match of q.matchAll(/(?<![\p{L}\d])(\d{1,2}|[a-z]+)(?![\p{L}\d])/gu)) {
    const n = yearsValue(match[1]);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * L'intitulé du poste pour la règle des intitulés : `title` de l'offre (JSON du radar), sinon
 * la ligne « Poste : » des champs du radar en fin d'annonce, sinon vide (règle muette).
 */
export function offerTitle(offerJson: string, posting: string): string {
  try {
    const offer = JSON.parse(offerJson.replace(/^﻿/, '')) as Record<string, unknown>;
    if (offer && typeof offer.title === 'string' && offer.title.trim() !== '') return offer.title.trim();
  } catch {
    // pas d'offre lisible : on lit les champs du radar
  }
  const cut = posting.indexOf('--- Champs du radar');
  const fields = cut >= 0 ? posting.slice(cut) : '';
  return /^Poste\s*:\s*(.+)$/mu.exec(fields)?.[1]?.trim() ?? '';
}

/** La source de l'offre (`source` du JSON du radar), sinon la ligne « Source : » des champs du radar, sinon vide. */
export function offerSource(offerJson: string, posting: string): string {
  try {
    const offer = JSON.parse(offerJson.replace(/^﻿/, '')) as Record<string, unknown>;
    if (offer && typeof offer.source === 'string' && offer.source.trim() !== '') return offer.source.trim();
  } catch {
    // pas d'offre lisible : on lit les champs du radar
  }
  const cut = posting.indexOf('--- Champs du radar');
  const fields = cut >= 0 ? posting.slice(cut) : '';
  return /^Source\s*:\s*(.+)$/mu.exec(fields)?.[1]?.trim() ?? '';
}

/**
 * La date de publication de l'offre telle que le tableau la porte (`date_published` du JSON de
 * l'offre, forme de la source) et le moment où le radar l'a lue (`radar_at`, pour une date
 * relative : « il y a 3 jours » lu le 10 date du 7) ; vides quand l'offre n'en dit rien.
 */
export function offerPublished(offerJson: string): { published: unknown; readAt: string } {
  try {
    const offer = JSON.parse(offerJson.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    if (offer && typeof offer === 'object') return { published: offer.date_published ?? '', readAt: typeof offer.radar_at === 'string' ? offer.radar_at : '' };
  } catch {
    // pas d'offre lisible : pas de date
  }
  return { published: '', readAt: '' };
}

// ── Extraction de l'agent ──────────────────────────────────────────────────

export interface LanguageItem {
  code: string;
  requirement: 'required' | 'preferred';
  quote: string;
}

export interface DismissedLanguage {
  code: string;
  quote: string;
  why: string;
}

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string;
  period: Period;
  quote: string;
}

export interface OtherCriterion {
  criterion: string;
  met: boolean | null;
  quote: string;
  note: string;
}

export type WorkMode = 'full_remote' | 'hybrid' | 'on_site' | 'not_stated';

/** L'expérience exigée telle que l'agent la lit ; tout à null et citation vide : l'annonce ne dit rien. */
export interface Experience {
  years_min: number | null;
  years_max: number | null;
  seniority_label: string | null;
  quote: string;
  /** Les mentions d'années qui ne sont pas une exigence faite au candidat (l'entreprise parle d'elle), avec pourquoi. */
  ignored: { quote: string; why: string }[];
}

/**
 * La zone d'embauche telle que l'agent la lit : `open` (l'annonce embauche en Europe, dans un pays
 * européen, en EMEA ou partout), `closed` (elle réserve le poste à une zone hors Europe : « US only »,
 * « must reside in Canada », « LATAM », paie américaine seulement), `not_stated` (rien), avec la citation.
 */
export type HiringZoneValue = 'open' | 'closed' | 'not_stated';
export interface HiringZone {
  value: HiringZoneValue;
  quote: string;
}
const HIRING_ZONES = new Set<HiringZoneValue>(['open', 'closed', 'not_stated']);

export const EXPERIENCE_NOT_STATED: Experience = { years_min: null, years_max: null, seniority_label: null, quote: '', ignored: [] };

/** Ce que le profil du candidat dit d'une exigence centrale : étayée, en partie, ou pas du tout. */
export type Backing = 'backed' | 'partial' | 'missing';
export const BACKINGS: readonly Backing[] = ['backed', 'partial', 'missing'];
/** Le nombre d'exigences centrales que l'agent relève dans l'annonce. */
export const CORE_REQUIREMENTS_COUNT = 3;

/**
 * Une exigence centrale du poste (ce sans quoi le poste ne se fait pas : « 2–7 years of
 * high-volume paid buying on Meta/TikTok/Snapchat ») : son libellé court, la citation de
 * l'annonce, et ce que le profil du candidat (`master_profile.md`) en dit, avec la citation du
 * profil quand il l'étaye (`backed`) ou en partie (`partial`) ; vide quand `missing`.
 */
export interface CoreRequirement {
  requirement: string;
  quote: string;
  backing: Backing;
  profile_quote: string;
}

/**
 * Un outil nommé par l'annonce (« Klaviyo », « Shopify », « HubSpot ») : à l'appréciation du
 * candidat (Antoine, 2026-11-12 : « les prérequis qui concernent des outils sont à laisser à mon
 * appréciation »). Jamais compté dans le cœur du poste ; une note le signale.
 */
export interface ToolRequested {
  tool: string;
  quote: string;
}

export interface Extraction {
  languages: LanguageItem[];
  not_required: DismissedLanguage[];
  salary: Salary | null;
  salary_ignored: { quote: string; why: string }[];
  other_criteria: OtherCriterion[];
  posting_language: { code: string; quote: string };
  work_mode: { value: WorkMode; quote: string };
  /** null : la clé manque dans triage.json (un problème quand `experience_max_annees` est donné). */
  experience: Experience | null;
  /** Les exigences centrales du poste et leur appui dans le profil ; null ou absent : la clé manque (un problème quand un profil est donné). */
  core_requirements?: CoreRequirement[] | null;
  /** Les outils nommés par l'annonce, hors cœur du poste ; absent : aucun. */
  tools_requested?: ToolRequested[];
  /** null ou absent : la clé manque (un problème quand `zone_embauche` vaut `europe`). */
  hiring_zone?: HiringZone | null;
  summary: string;
}

const PERIODS = new Set<Period>(['year', 'month', 'week', 'day', 'hour']);
const WORK_MODES = new Set<WorkMode>(['full_remote', 'hybrid', 'on_site', 'not_stated']);

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Lit triage.json (déjà parsé) ; chaque écart de forme est un problème que l'agent corrige. */
export function readExtraction(raw: unknown): { extraction: Extraction | null; problems: string[] } {
  const problems: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { extraction: null, problems: ['triage.json must be a JSON object'] };
  const v = raw as Record<string, unknown>;
  const list = (key: string): Record<string, unknown>[] => {
    if (!Array.isArray(v[key])) {
      problems.push(`triage.json: "${key}" must be an array (empty when there is nothing)`);
      return [];
    }
    return (v[key] as unknown[]).filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item));
  };
  const languages: LanguageItem[] = [];
  for (const [i, item] of list('languages').entries()) {
    const code = isString(item.code) ? item.code.trim().toLowerCase() : '';
    if (!/^[a-z]{2}$/.test(code)) problems.push(`triage.json: languages[${i}].code must be an ISO 639-1 code`);
    if (item.requirement !== 'required' && item.requirement !== 'preferred') problems.push(`triage.json: languages[${i}].requirement must be "required" or "preferred"`);
    languages.push({ code, requirement: item.requirement === 'preferred' ? 'preferred' : 'required', quote: isString(item.quote) ? item.quote : '' });
  }
  const not_required: DismissedLanguage[] = [];
  for (const [i, item] of list('not_required').entries()) {
    const code = isString(item.code) ? item.code.trim().toLowerCase() : '';
    if (!/^[a-z]{2}$/.test(code)) problems.push(`triage.json: not_required[${i}].code must be an ISO 639-1 code`);
    if (!isString(item.why) || item.why.trim() === '') problems.push(`triage.json: not_required[${i}].why must say why this mention is not a requirement`);
    not_required.push({ code, quote: isString(item.quote) ? item.quote : '', why: isString(item.why) ? item.why : '' });
  }
  let salary: Salary | null = null;
  if (v.salary !== null && v.salary !== undefined) {
    const s = v.salary as Record<string, unknown>;
    const min = nullableNumber(s.min);
    const max = nullableNumber(s.max);
    if (min === undefined || max === undefined) problems.push('triage.json: salary.min and salary.max must be numbers or null (amounts as written, before any conversion)');
    else if (min === null && max === null) problems.push('triage.json: salary has neither min nor max; write "salary": null when the posting gives none');
    else if (min !== null && max !== null && min > max) problems.push('triage.json: salary.min is greater than salary.max');
    const currency = isString(s.currency) ? s.currency.trim().toUpperCase() : '';
    if (!/^[A-Z]{3}$/.test(currency)) problems.push('triage.json: salary.currency must be an ISO 4217 code (EUR, USD, GBP…)');
    if (!PERIODS.has(s.period as Period)) problems.push('triage.json: salary.period must be one of year, month, week, day, hour');
    salary = { min: min ?? null, max: max ?? null, currency, period: (PERIODS.has(s.period as Period) ? s.period : 'year') as Period, quote: isString(s.quote) ? s.quote : '' };
  } else if (v.salary === undefined) {
    problems.push('triage.json: "salary" is missing (an object, or null when the posting gives no salary)');
  }
  const salary_ignored = list('salary_ignored').map((item, i) => {
    if (!isString(item.why) || item.why.trim() === '') problems.push(`triage.json: salary_ignored[${i}].why must say why this amount is not the salary`);
    return { quote: isString(item.quote) ? item.quote : '', why: isString(item.why) ? item.why : '' };
  });
  const other_criteria: OtherCriterion[] = [];
  for (const [i, item] of list('other_criteria').entries()) {
    if (!isString(item.criterion) || item.criterion.trim() === '') problems.push(`triage.json: other_criteria[${i}].criterion is empty`);
    if (item.met !== true && item.met !== false && item.met !== null) problems.push(`triage.json: other_criteria[${i}].met must be true, false or null (unknown)`);
    other_criteria.push({ criterion: isString(item.criterion) ? item.criterion : '', met: item.met === true ? true : item.met === false ? false : null, quote: isString(item.quote) ? item.quote : '', note: isString(item.note) ? item.note : '' });
  }
  const pl = (v.posting_language ?? null) as Record<string, unknown> | null;
  const posting_language = { code: pl && isString(pl.code) ? pl.code.trim().toLowerCase() : '', quote: pl && isString(pl.quote) ? pl.quote : '' };
  if (!/^[a-z]{2}$/.test(posting_language.code)) problems.push('triage.json: "posting_language" must be {"code": ISO 639-1 of the language the posting is written in, "quote": a sentence of the job description}');
  const wm = (v.work_mode ?? null) as Record<string, unknown> | null;
  const work_mode = { value: (wm && isString(wm.value) ? wm.value.trim() : '') as WorkMode, quote: wm && isString(wm.quote) ? wm.quote : '' };
  if (!WORK_MODES.has(work_mode.value)) problems.push('triage.json: "work_mode" must be {"value": one of full_remote, hybrid, on_site, not_stated, "quote": the sentence of the posting that states the work mode}');
  else if (work_mode.value !== 'not_stated' && work_mode.quote.trim() === '') problems.push(`triage.json: work_mode is "${work_mode.value}" without a quote; copy the sentence of the posting that states the work mode, or write "not_stated" when the posting says nothing`);
  let experience: Experience | null = null;
  if (v.experience === null || v.experience === 'not_stated') experience = { ...EXPERIENCE_NOT_STATED };
  else if (v.experience !== undefined) {
    if (typeof v.experience !== 'object' || Array.isArray(v.experience)) problems.push('triage.json: "experience" must be {"years_min", "years_max", "seniority_label", "quote"} (all null and an empty quote, or "not_stated", when the posting says nothing)');
    else {
      const e = v.experience as Record<string, unknown>;
      const years = (value: unknown): number | null | undefined => (value === null || value === undefined ? null : typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60 ? value : undefined);
      const years_min = years(e.years_min);
      const years_max = years(e.years_max);
      if (years_min === undefined || years_max === undefined) problems.push('triage.json: experience.years_min and experience.years_max must be integers (years) or null');
      else if (years_min !== null && years_max !== null && years_min > years_max) problems.push('triage.json: experience.years_min is greater than experience.years_max');
      if (e.seniority_label !== null && e.seniority_label !== undefined && !isString(e.seniority_label)) problems.push('triage.json: experience.seniority_label must be a string (the word of the posting, e.g. "senior") or null');
      const seniority_label = isString(e.seniority_label) && e.seniority_label.trim() !== '' ? e.seniority_label.trim() : null;
      const stated = (years_min ?? null) !== null || (years_max ?? null) !== null || seniority_label !== null;
      // Rien d'exigé : un « not_stated » ou « n/a » mis à la place de la citation vide n'est pas une citation à chercher.
      const rawQuote = isString(e.quote) ? e.quote : '';
      const quote = !stated && /^\s*(not[_ ]stated|n\/?a|none|null|aucune?|non précisée?)\s*$/i.test(rawQuote) ? '' : rawQuote;
      if (stated && quote.trim() === '') problems.push('triage.json: experience states years or a seniority label without a quote; copy the sentence of the posting that asks for it, or set all three to null when the posting says nothing');
      const ignored: Experience['ignored'] = [];
      if (e.ignored !== undefined) {
        if (!Array.isArray(e.ignored)) problems.push('triage.json: experience.ignored must be an array of {"quote", "why"}');
        else
          for (const [i, item] of (e.ignored as unknown[]).entries()) {
            const it = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            if (!isString(it.why) || it.why.trim() === '') problems.push(`triage.json: experience.ignored[${i}].why must say why this mention is not a requirement`);
            ignored.push({ quote: isString(it.quote) ? it.quote : '', why: isString(it.why) ? it.why : '' });
          }
      }
      experience = { years_min: years_min ?? null, years_max: years_max ?? null, seniority_label, quote, ignored };
    }
  }
  let core_requirements: CoreRequirement[] | null = null;
  if (v.core_requirements !== undefined && v.core_requirements !== null) {
    if (!Array.isArray(v.core_requirements)) problems.push('triage.json: "core_requirements" must be an array of {"requirement", "quote", "backing", "profile_quote"}');
    else {
      core_requirements = [];
      for (const [i, item] of (v.core_requirements as unknown[]).entries()) {
        const it = item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        const requirement = isString(it.requirement) ? it.requirement.trim() : '';
        if (requirement === '' || requirement.length > 120) problems.push(`triage.json: core_requirements[${i}].requirement must name the requirement in a few words (120 characters at most)`);
        const backing = isString(it.backing) ? it.backing.trim() : '';
        if (!(BACKINGS as readonly string[]).includes(backing)) problems.push(`triage.json: core_requirements[${i}].backing must be "backed", "partial" or "missing"`);
        if (it.profile_quote !== undefined && it.profile_quote !== null && !isString(it.profile_quote)) problems.push(`triage.json: core_requirements[${i}].profile_quote must be a string (empty when the profile does not back it)`);
        core_requirements.push({ requirement, quote: isString(it.quote) ? it.quote : '', backing: ((BACKINGS as readonly string[]).includes(backing) ? backing : 'missing') as Backing, profile_quote: isString(it.profile_quote) ? it.profile_quote : '' });
      }
    }
  }
  const tools_requested: ToolRequested[] = [];
  if (v.tools_requested !== undefined && v.tools_requested !== null) {
    if (!Array.isArray(v.tools_requested)) problems.push('triage.json: "tools_requested" must be an array of {"tool", "quote"}');
    else
      for (const [i, item] of (v.tools_requested as unknown[]).entries()) {
        const it = item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        const tool = isString(it.tool) ? it.tool.trim() : '';
        if (tool === '' || tool.length > 60) problems.push(`triage.json: tools_requested[${i}].tool must name the tool (60 characters at most)`);
        tools_requested.push({ tool, quote: isString(it.quote) ? it.quote : '' });
      }
  }
  let hiring_zone: HiringZone | null = null;
  if (v.hiring_zone !== undefined && v.hiring_zone !== null) {
    const h = typeof v.hiring_zone === 'object' && !Array.isArray(v.hiring_zone) ? (v.hiring_zone as Record<string, unknown>) : {};
    const value = isString(h.value) ? h.value.trim() : '';
    if (!HIRING_ZONES.has(value as HiringZoneValue)) problems.push('triage.json: hiring_zone.value must be "open", "closed" or "not_stated"');
    const quote = isString(h.quote) ? h.quote : '';
    if ((value === 'open' || value === 'closed') && quote.trim() === '') problems.push(`triage.json: hiring_zone is "${value}" without a quote; copy the sentence of the posting that says where it hires, or write "not_stated" with an empty quote`);
    hiring_zone = { value: (HIRING_ZONES.has(value as HiringZoneValue) ? value : 'not_stated') as HiringZoneValue, quote };
  }
  const summary = isString(v.summary) ? v.summary.trim() : '';
  if (summary === '') problems.push('triage.json: "summary" is empty');
  return { extraction: problems.length > 0 ? null : { languages, not_required, salary, salary_ignored, other_criteria, posting_language, work_mode, experience, core_requirements, tools_requested, hiring_zone, summary }, problems };
}

/** Une citation est valable si elle figure mot pour mot dans l'annonce (casse, accents, espaces et guillemets mis à part). */
export function quoteProblem(where: string, quote: string, normalizedPosting: string): string | null {
  const q = normalize(quote);
  if (q.length < 3) return `${where}: the quote is empty; copy the exact words of the posting`;
  if (q.length > 400) return `${where}: the quote is longer than 400 characters; keep the sentence that proves the point`;
  if (!normalizedPosting.includes(q)) return `${where}: the quote "${quote.slice(0, 120)}" is not in the posting verbatim; copy it exactly from posting text`;
  return null;
}

function namesLanguage(quote: string, code: string): boolean {
  const q = normalize(quote);
  return (LANGUAGE_NAMES[code] ?? []).some((name) => new RegExp(`\\b${name}\\b`).test(q));
}

/** Tout ce que le code peut vérifier de l'extraction contre l'annonce. */
export function checkExtraction(extraction: Extraction, posting: string, criteria: Criteria): string[] {
  const problems: string[] = [];
  const text = normalize(posting);
  for (const [i, l] of extraction.languages.entries()) {
    const p = quoteProblem(`languages[${i}] (${l.code})`, l.quote, text);
    if (p !== null) problems.push(p);
    else if (LANGUAGE_NAMES[l.code] && !namesLanguage(l.quote, l.code)) problems.push(`languages[${i}]: the quote does not name ${l.code}; quote the words that ask for this language`);
  }
  for (const [i, l] of extraction.not_required.entries()) {
    const p = quoteProblem(`not_required[${i}] (${l.code})`, l.quote, text);
    if (p !== null) problems.push(p);
  }
  const pq = quoteProblem('posting_language', extraction.posting_language.quote, text);
  if (pq !== null) problems.push(pq);
  else if (normalize(extraction.posting_language.quote).length < 60) problems.push('posting_language: quote a full sentence of the job description (60 characters or more), not a title or a menu item');
  const detected = detectLanguage(postingBody(posting));
  if (detected !== null && detected.code !== extraction.posting_language.code) {
    problems.push(`posting_language is "${extraction.posting_language.code}" but the posting text reads as ${detected.code} (${detected.hits} common ${detected.code} words against ${detected.runnerUp}); give the language the job description itself is written in`);
  }
  const wm = extraction.work_mode;
  if (wm.value !== 'not_stated' || wm.quote.trim() !== '') {
    const p = quoteProblem('work_mode', wm.quote, text);
    if (p !== null) problems.push(p);
  }
  const markers = detectWorkMode(posting);
  // Le marqueur ET la phrase qui le porte (2026-10-23 : « work_mode is "not_stated" but the posting
  // says "full remote" » trois tours de suite, l'agent ne retrouvant pas la phrase dans l'annonce).
  const where = (marker: string): string => {
    const sentence = markerSentence(posting, marker);
    return sentence !== '' ? ` in "${sentence}"` : '';
  };
  if (wm.value === 'full_remote' && markers.on_site.length > 0 && markers.remote.length === 0) {
    problems.push(`work_mode is "full_remote" but the posting says "${markers.on_site[0]}"${where(markers.on_site[0])}; give the sentence that states the work mode (hybrid or on_site), or quote the words that make the role fully remote`);
  } else if (wm.value === 'full_remote' && markers.office_period.length > 0) {
    // « fully remote » ailleurs dans l'annonce ne lève pas des mois au bureau (Bending Spoons, 2026-10-24).
    problems.push(`work_mode is "full_remote" but the posting requires office presence for a period ("${markers.office_period[0]}"${where(markers.office_period[0])}); days at the office, even only while onboarding, make the role hybrid or on_site: set work_mode to hybrid (or on_site) and quote that sentence`);
  } else if (wm.value === 'not_stated' && (markers.on_site.length > 0 || markers.remote.length > 0)) {
    const marker = markers.on_site[0] ?? markers.remote[0];
    problems.push(`work_mode is "not_stated" but the posting says "${marker}"${where(marker)}; set work_mode.value (full_remote, hybrid or on_site) and copy that sentence as work_mode.quote`);
  }
  const accounted = new Set([...extraction.languages.map((l) => l.code), ...extraction.not_required.map((l) => l.code)]);
  for (const mention of scanLanguageMentions(posting)) {
    if (!accounted.has(mention.code)) {
      problems.push(`the posting mentions ${mention.name} near a requirement word ("…${mention.excerpt}…"): list ${mention.code} in "languages" (required or preferred) or in "not_required" with the quote and why`);
    }
  }
  const s = extraction.salary;
  if (s !== null) {
    const p = quoteProblem('salary', s.quote, text);
    if (p !== null) problems.push(p);
    else {
      const numbers = quoteNumbers(s.quote);
      for (const [label, value] of [['min', s.min], ['max', s.max]] as const) {
        if (value !== null && !numbers.some((n) => Math.abs(n - value) < 0.5)) problems.push(`salary.${label} = ${value} does not appear in the quoted text "${s.quote}"; write the amount exactly as the posting states it`);
      }
    }
    if (criteria.taux_eur[s.currency] === undefined) problems.push(`salary.currency ${s.currency} has no conversion rate; add it to taux_eur in criteres.json or check the currency`);
  } else {
    const ignored = extraction.salary_ignored.map((i) => normalize(i.quote));
    for (const [i, item] of extraction.salary_ignored.entries()) {
      const p = quoteProblem(`salary_ignored[${i}]`, item.quote, text);
      if (p !== null) problems.push(p);
    }
    for (const amount of scanSalaryAmounts(posting)) {
      const a = normalize(amount);
      const covered = ignored.some((q) => q.length >= 3 && (a.includes(q) || q.includes(a) || overlaps(a, q)));
      if (!covered) problems.push(`"salary" is null but the posting has an amount with a currency ("…${amount}…"): give it as the salary, or list it in "salary_ignored" with why it is not the pay`);
    }
  }
  for (const [i, c] of extraction.other_criteria.entries()) {
    if (c.quote.trim() !== '') {
      const p = quoteProblem(`other_criteria[${i}]`, c.quote, text);
      if (p !== null) problems.push(p);
    } else if (c.met !== null) problems.push(`other_criteria[${i}] (${c.criterion}): met is ${c.met} without a quote; quote the posting, or set met to null when it says nothing`);
  }
  problems.push(...experienceProblems(extraction.experience ?? null, posting, text, criteria));
  const zone = extraction.hiring_zone ?? null;
  if (zone === null) {
    if (criteria.zone_embauche === 'europe') problems.push('triage.json: "hiring_zone" is missing: {"value": "open" | "closed" | "not_stated", "quote"} with the sentence that says where the role hires, or "not_stated" and an empty quote when the posting says nothing');
  } else if (zone.value !== 'not_stated') {
    const p = quoteProblem('hiring_zone', zone.quote, text);
    if (p !== null) problems.push(p);
  }
  return problems;
}

/**
 * L'expérience : la citation est dans l'annonce et porte les années et le label déclarés ;
 * quand `experience_max_annees` est donné, la clé est obligatoire et chaque exigence d'années
 * que le balayage trouve (`scanExperienceYears`) est dans la citation ou dans `ignored` avec sa
 * raison. Règle coupée : seule la fidélité de ce que l'agent a écrit est vérifiée.
 */
function experienceProblems(ex: Experience | null, posting: string, text: string, criteria: Criteria): string[] {
  const problems: string[] = [];
  const ruleOn = criteria.experience_max_annees > 0;
  if (ex === null) {
    if (ruleOn) problems.push('triage.json: "experience" is missing: {"years_min", "years_max", "seniority_label", "quote"} with the sentence that asks for experience, or all null with an empty quote when the posting asks for none');
    return problems;
  }
  const stated = ex.years_min !== null || ex.years_max !== null || ex.seniority_label !== null;
  const covered: number[] = [];
  if (stated || ex.quote.trim() !== '') {
    const p = quoteProblem('experience', ex.quote, text);
    if (p !== null) problems.push(p);
    else {
      const numbers = quoteYears(ex.quote);
      covered.push(...numbers);
      for (const [label, value] of [['years_min', ex.years_min], ['years_max', ex.years_max]] as const) {
        if (value !== null && !numbers.includes(value)) problems.push(`experience.${label} = ${value} does not appear in the quoted text "${ex.quote}"; quote the words that give this number of years`);
      }
      if (ex.seniority_label !== null && seniorityLabelsIn(ex.quote, [ex.seniority_label]).length === 0) problems.push(`experience.seniority_label "${ex.seniority_label}" is not in the quoted text; quote the words of the posting that carry this label`);
    }
  }
  for (const [i, item] of ex.ignored.entries()) {
    const p = quoteProblem(`experience.ignored[${i}]`, item.quote, text);
    if (p !== null) problems.push(p);
    else covered.push(...quoteYears(item.quote));
  }
  if (ruleOn) {
    for (const mention of scanExperienceYears(posting)) {
      const n = mention.years_min ?? mention.years_max;
      if (n !== null && !covered.includes(n)) {
        problems.push(`the posting asks for years of experience ("…${mention.excerpt}…") that "experience" does not account for: give them as years_min / years_max with the quote, or list the quote in experience.ignored with why it is not a requirement for this role`);
      }
    }
  }
  return problems;
}

/** Le profil (Markdown) et ses citations comparés sans la mise en forme : gras, italique, code, titres, puces. */
export function normalizeProfile(value: string): string {
  return normalize(value.replace(/[*`]+/g, '').replace(/^\s{0,3}(?:#{1,6}|[-+>]|\d+[.)])\s+/gm, ''));
}

/**
 * Le cœur du poste, quand un profil est donné (`profile` non vide) : exactement
 * `CORE_REQUIREMENTS_COUNT` exigences, distinctes, chacune citée mot pour mot dans l'annonce
 * (hors champs du radar) ; `backed` et `partial` citent le profil mot pour mot (casse, espaces et
 * mise en forme Markdown mises à part), `missing` ne cite rien. Sans profil : rien n'est
 * vérifié (l'adéquation n'est pas évaluée, `decideTriage` le note).
 */
export function checkCoreFit(core: CoreRequirement[] | null | undefined, posting: string, profile: string | null | undefined, tools: readonly ToolRequested[] = []): string[] {
  const problems: string[] = [];
  const body = normalize(postingBody(posting));
  for (const [i, t] of tools.entries()) {
    const p = quoteProblem(`tools_requested[${i}] (${t.tool.slice(0, 40)})`, t.quote, body);
    if (p !== null) problems.push(p);
  }
  if (profile === null || profile === undefined || profile.trim() === '') return problems;
  if (core === null || core === undefined) {
    return [`triage.json: "core_requirements" is missing: list the ${CORE_REQUIREMENTS_COUNT} core requirements of the role, each with its quote from the posting, "backing" (backed, partial, missing) and "profile_quote" from the candidate profile`];
  }
  if (core.length !== CORE_REQUIREMENTS_COUNT) problems.push(`core_requirements has ${core.length} entries; give exactly ${CORE_REQUIREMENTS_COUNT}: the requirements without which the role cannot be done, most central first`);
  const toolNames = tools.map((t) => normalize(t.tool)).filter((t) => t !== '');
  const profileText = normalizeProfile(profile);
  const seen = new Set<string>();
  for (const [i, c] of core.entries()) {
    const where = `core_requirements[${i}] (${c.requirement.slice(0, 60)})`;
    const req = normalize(c.requirement);
    if (toolNames.some((t) => req === t)) problems.push(`${where}: this names a tool, and tools are the candidate's call, never a core requirement; keep it in tools_requested and name the skill or channel the role is built around instead`);
    const p = quoteProblem(where, c.quote, body);
    if (p !== null) problems.push(p);
    const key = normalize(c.quote);
    if (key !== '' && seen.has(key)) problems.push(`${where}: the same posting quote as another core requirement; give ${CORE_REQUIREMENTS_COUNT} distinct requirements`);
    seen.add(key);
    const pq = normalizeProfile(c.profile_quote);
    if (c.backing === 'missing') {
      if (pq !== '') problems.push(`${where}: backing is "missing" but profile_quote is given; if the profile backs this requirement, set backing to "backed" or "partial", otherwise leave profile_quote empty`);
    } else if (pq.length < 3) problems.push(`${where}: backing is "${c.backing}" without a profile_quote; copy the words of the candidate profile that back it, or set backing to "missing"`);
    else if (pq.length > 400) problems.push(`${where}: the profile_quote is longer than 400 characters; keep the line that proves the point`);
    else if (!profileText.includes(pq)) problems.push(`${where}: the profile_quote "${c.profile_quote.slice(0, 120)}" is not in the candidate profile verbatim; copy it exactly from the profile file, or set backing to "missing"`);
  }
  return problems;
}

/** Deux extraits normalisés partagent-ils un même montant chiffré ? */
function overlaps(a: string, b: string): boolean {
  const digits = (s: string): string[] => s.match(/\d[\d.,\s]*\d|\d/g)?.map((d) => d.replace(/[\s.,]/g, '')) ?? [];
  const da = new Set(digits(a));
  return digits(b).some((d) => d.length >= 2 && da.has(d));
}

// ── Décision ───────────────────────────────────────────────────────────────

export type Decision = 'ecartee' | 'a_verifier' | 'retenue';

export interface TriageDecision {
  decision: Decision;
  reasons: string[];
  notes: string[];
  salary_annual_eur: { min: number | null; max: number | null } | null;
  languages_required: string[];
}

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR').replace(/ | /g, ' ')} €`;
}

function cite(quote: string): string {
  const q = quote.replace(/\s+/g, ' ').trim();
  return `« ${q.length > 160 ? `${q.slice(0, 157)}…` : q} »`;
}

/**
 * La règle, et elle seule, décide. Écartée : une langue exigée hors `langues`, ou un salaire
 * annuel maximal (converti en euros) sous `salaire_min_annuel`, ou un salaire absent quand
 * `salaire_inconnu` = ecarter, ou un poste hybride ou sur site quand `remote` = full (sur site
 * seulement quand `remote` = hybride_ok ; rien quand indifferent), ou, `experience_max_annees`
 * donné, une expérience exigée (borne basse) au-delà de ce maximum ou un mot de
 * `experience_labels_exclus` dans l'intitulé (`context.title`). À vérifier : salaire absent
 * (par défaut), « à partir de » sous le seuil, mode de travail non précisé (sauf indifferent),
 * un label senior dans le corps de l'annonce (pas l'intitulé), annonce lue en partie, critère
 * libre non rempli. Retenue sinon. Sans `experience_max_annees` ni `experience_labels_exclus`,
 * l'expérience n'a aucun effet. Mode de travail non précisé sur une offre d'une plateforme 100 %
 * télétravail (`context.source`, `remoteOnlySource`) sans marqueur hybride ou sur site dans
 * `context.posting` : télétravail complet d'après la source, base écrite dans les raisons.
 * Âge : `context.published` (la date de la ligne du tableau) à plus de `offre_age_max_jours`
 * jours de `context.now` écarte (« offre trop ancienne (publiée le AAAA-MM-JJ, > 7 jours) ») ;
 * une date relative se compte depuis `context.readAt` (lecture du radar) ; date illisible ou
 * absente, ou règle coupée (0) : aucun effet ; date lisible et dans la limite : une note.
 * Cœur du poste (`context.profileGiven`, `extraction.core_requirements` vérifiées par
 * `checkCoreFit`) : 2 exigences `missing` ou plus écartent (« Cœur du poste hors profil : <req1> ;
 * <req2> »), une seule donne la note « À renforcer : <req> » sans changer la décision ; sans
 * profil, la note « Adéquation au cœur du poste non évaluée : profil du candidat non fourni ».
 * Outils nommés (`extraction.tools_requested`) : jamais une raison d'écarter, une note « Outils
 * demandés (à ton appréciation) : Klaviyo, Shopify ».
 */
export function decideTriage(
  extraction: Extraction,
  criteria: Criteria,
  postingFull: boolean,
  context: { title?: string; source?: string; posting?: string; published?: unknown; readAt?: string; now?: Date; profileGiven?: boolean } = {},
): TriageDecision {
  const rejects: string[] = [];
  const doubts: string[] = [];
  const notes: string[] = [];
  const maxAge = ageLimitFor(context.source, criteria.offre_age_max_jours ?? 0);
  if (maxAge > 0 && context.published !== undefined) {
    const now = context.now ?? new Date();
    const read = context.readAt !== undefined && context.readAt !== '' ? new Date(context.readAt) : now;
    const anchor = Number.isNaN(read.getTime()) ? now : read;
    const old = tooOld(context.published, maxAge, now, anchor);
    const age = offerAge(context.published, now, anchor);
    if (old !== null) rejects.push(old);
    else if (age !== null) notes.push(`Publiée le ${age.day} (${Math.max(age.days, 0)} jour${Math.max(age.days, 0) > 1 ? 's' : ''}, max ${maxAge})`);
  }
  const spoken = new Set(criteria.langues);
  if (!spoken.has(extraction.posting_language.code)) {
    rejects.push(`Annonce rédigée en ${languageLabel(extraction.posting_language.code).replace(/^(le |l')/, '')} : ${cite(extraction.posting_language.quote)}`);
  }
  const required = extraction.languages.filter((l) => l.requirement === 'required').map((l) => l.code);
  for (const l of extraction.languages) {
    if (spoken.has(l.code)) continue;
    if (l.requirement === 'required') rejects.push(`Exige ${languageLabel(l.code)} : ${cite(l.quote)}`);
    else notes.push(`${languageLabel(l.code)[0].toUpperCase()}${languageLabel(l.code).slice(1)} est un plus, pas une exigence : ${cite(l.quote)}`);
  }
  let annual: TriageDecision['salary_annual_eur'] = null;
  const s = extraction.salary;
  if (s !== null) {
    const rate = criteria.taux_eur[s.currency] ?? Number.NaN;
    const factor = PERIOD_FACTOR[s.period];
    const conv = (n: number | null): number | null => (n === null ? null : Math.round(n * factor * rate));
    annual = { min: conv(s.min), max: conv(s.max) };
    const range = annual.min !== null && annual.max !== null ? `${euros(annual.min)} à ${euros(annual.max)}` : euros((annual.max ?? annual.min) as number);
    const shown = `${range} brut par an${s.currency !== 'EUR' || s.period !== 'year' ? ` (converti depuis ${cite(s.quote)})` : ''}`;
    const threshold = criteria.salaire_min_annuel;
    if (threshold > 0 && annual.max !== null && annual.max < threshold) rejects.push(`Salaire sous ${euros(threshold)} par an : ${shown}`);
    else if (threshold > 0 && annual.max === null && annual.min !== null && annual.min < threshold) doubts.push(`Salaire « à partir de » sous ${euros(threshold)} : ${shown}`);
    else notes.push(`Salaire : ${shown}`);
  } else if (criteria.salaire_inconnu === 'ecarter') rejects.push("Salaire non indiqué dans l'annonce (critère : écarter)");
  else if (criteria.salaire_inconnu === 'a_verifier') doubts.push("Salaire non indiqué dans l'annonce");
  else notes.push("Salaire non indiqué dans l'annonce");
  const wm = extraction.work_mode;
  let remoteBasis = '';
  if (criteria.remote !== 'indifferent') {
    if (wm.value === 'on_site' || (wm.value === 'hybrid' && criteria.remote === 'full')) rejects.push(`Poste non 100 % télétravail (${wm.value === 'hybrid' ? 'hybride' : 'sur site'}) : ${cite(wm.quote)}`);
    else if (wm.value === 'hybrid') notes.push(`Poste hybride : ${cite(wm.quote)}`);
    else if (wm.value === 'not_stated') {
      const board = remoteOnlySource(context.source ?? '');
      const onSite = context.posting !== undefined ? detectWorkMode(context.posting).on_site : [];
      if (board !== null && onSite.length === 0) {
        remoteBasis = `Télétravail d'après la source ${board} (plateforme 100 % télétravail ; l'annonce ne parle ni d'hybride, ni de sur site, ni de jours au bureau)`;
        notes.push(remoteBasis);
      } else doubts.push("Mode de travail non précisé dans l'annonce");
    } else notes.push(`Télétravail complet : ${cite(wm.quote)}`);
  }
  const maxYears = criteria.experience_max_annees;
  const labels = criteria.experience_labels_exclus;
  const experienceRule = maxYears > 0 || labels.length > 0;
  const title = (context.title ?? '').trim();
  if (labels.length > 0 && title !== '') {
    const hit = seniorityLabelsIn(title, labels);
    if (hit.length > 0) rejects.push(`Intitulé de poste senior (« ${hit[0]} »${maxYears > 0 ? `, max ${maxYears} ans d'expérience` : ''}) : ${cite(title)}`);
  }
  const ex = extraction.experience ?? null;
  if (experienceRule && ex !== null) {
    if (maxYears > 0 && ex.years_min !== null && ex.years_min > maxYears) rejects.push(`Exige ${ex.years_min} ans d'expérience (max ${maxYears}) : ${cite(ex.quote)}`);
    else if (maxYears > 0 && ex.years_min !== null) notes.push(`Expérience demandée : ${ex.years_min}${ex.years_max !== null && ex.years_max !== ex.years_min ? ` à ${ex.years_max}` : ''} ans (max ${maxYears}) : ${cite(ex.quote)}`);
    if (ex.seniority_label !== null) {
      if (seniorityLabelsIn(ex.seniority_label, labels).length > 0) doubts.push(`Profil « ${ex.seniority_label} » annoncé${maxYears > 0 ? ` (max ${maxYears} ans d'expérience)` : ''} : ${cite(ex.quote)}`);
      else notes.push(`Profil annoncé « ${ex.seniority_label} » : ${cite(ex.quote)}`);
    }
  }
  const zone = extraction.hiring_zone ?? null;
  if (criteria.zone_embauche === 'europe' && zone !== null) {
    if (zone.value === 'closed') rejects.push(`N'embauche pas en Europe : ${cite(zone.quote)}`);
    else if (zone.value === 'not_stated') notes.push("Zone d'embauche non précisée dans l'annonce");
  }
  for (const c of extraction.other_criteria) {
    if (c.met === false) doubts.push(`${c.criterion} : ${c.note || 'non rempli'}${c.quote ? ` ${cite(c.quote)}` : ''}`);
  }
  const core = extraction.core_requirements ?? null;
  if (context.profileGiven === true && core !== null && core.length > 0) {
    const missing = core.filter((c) => c.backing === 'missing');
    const partial = core.filter((c) => c.backing === 'partial');
    if (missing.length >= 2) rejects.push(`Cœur du poste hors profil : ${missing.map((c) => c.requirement).join(' ; ')}`);
    else if (missing.length === 1) notes.push(`À renforcer : ${missing[0].requirement}`);
    notes.push(`Cœur du poste : ${core.length - missing.length - partial.length} exigence${core.length - missing.length - partial.length > 1 ? 's' : ''} étayée${core.length - missing.length - partial.length > 1 ? 's' : ''}, ${partial.length} en partie, ${missing.length} absente${missing.length > 1 ? 's' : ''} du profil, sur ${core.length}`);
  } else notes.push('Adéquation au cœur du poste non évaluée : profil du candidat non fourni');
  const tools = [...new Set((extraction.tools_requested ?? []).map((t) => t.tool).filter((t) => t !== ''))];
  if (tools.length > 0) notes.push(`Outils demandés (à ton appréciation) : ${tools.join(', ')}`);
  if (!postingFull) doubts.push("Annonce complète non lue : seul le résumé du radar a été trié");
  const decision: Decision = rejects.length > 0 ? 'ecartee' : doubts.length > 0 ? 'a_verifier' : 'retenue';
  return {
    decision,
    reasons:
      decision === 'ecartee'
        ? rejects
        : decision === 'a_verifier'
          ? doubts
          : [experienceRule ? 'Langues, salaire, mode de travail et expérience conformes à criteres.json' : 'Langues, salaire et mode de travail conformes à criteres.json', ...(remoteBasis !== '' ? [remoteBasis] : [])],
    notes: decision === 'ecartee' ? [...doubts, ...notes] : decision === 'retenue' && remoteBasis !== '' ? notes.filter((n) => n !== remoteBasis) : notes,
    salary_annual_eur: annual,
    languages_required: required,
  };
}
