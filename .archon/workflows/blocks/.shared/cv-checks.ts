/**
 * Contrôles déterministes d'un dossier de candidature (CV sur mesure, message d'accroche,
 * fiche candidat). Purs : pas d'accès disque, testables à l'unité.
 *
 * Ce que le code peut établir : les mots-clés de l'offre sont dans le CV ; aucun chiffre
 * « à unité » (50 %, 38k€, x3) que le profil maître ne porte pas ; aucune portée que le
 * profil ne porte pas (B2B/B2C, P&L, budget, management, taille d'équipe, clients ou
 * partenaires nommés) ; pas de phrase creuse ni de tirets longs à la chaîne ; une page ; le
 * contact du profil ; un message qui nomme l'entreprise et finit par une demande. Ce qu'il
 * ne peut pas trancher (la candidature convainc-t-elle un recruteur exigeant ? les temps
 * des verbes, l'attribution d'un résultat au bon employeur) va au juge.
 */

export interface Coverage {
  covered: string[];
  missing: string[];
  ratio: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KEYWORD_STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'and', 'of', 'the', 'for', 'in', 'to', 'or', 'ou']);

function wordPattern(word: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(word)}(?=$|[^\\p{L}\\p{N}])`, 'u');
}

/**
 * Un mot-clé est couvert s'il apparaît délimité (pas au milieu d'un mot), sans tenir compte de la
 * casse ; une expression de plusieurs mots l'est aussi quand chacun de ses mots (hors mots vides)
 * apparaît délimité quelque part : « lifecycle marketing specialist » est couvert par un CV qui
 * parle de lifecycle, de marketing et d'un poste de specialist dans des phrases naturelles. Un ATS
 * cherche des termes ; exiger l'expression mot à mot poussait le Drafter à la coller telle quelle
 * (test du 22 octobre : juge B, « ATS stuffing »).
 */
export function keywordCoverage(text: string, keywords: string[]): Coverage {
  const covered: string[] = [];
  const missing: string[] = [];
  const hay = text.toLowerCase();
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (keyword === '') continue;
    const phrase = wordPattern(keyword.toLowerCase()).test(hay);
    const words = keyword.toLowerCase().split(/[^\p{L}\p{N}+#./-]+/u).filter((w) => w !== '' && !KEYWORD_STOPWORDS.has(w));
    const apart = words.length >= 2 && words.every((w) => wordPattern(w).test(hay));
    (phrase || apart ? covered : missing).push(keyword);
  }
  const total = covered.length + missing.length;
  return { covered, missing, ratio: total === 0 ? 1 : covered.length / total };
}

/** Normalise un chiffre à unité : « ~50 % » → « 50% », « 1,2M » → « 1.2m », « ×3 » → « x3 ». */
export function normalizeFigure(figure: string): string {
  return figure
    .toLowerCase()
    .replace(/[~≈+\s]/g, '')
    .replace(',', '.')
    .replace('×', 'x')
    .replace(/^[^\dx-]+/, '');
}

const FIGURE_PATTERN =
  /(?:[~≈]\s?)?[+-]?\d+(?:[.,]\d+)?\s?(?:%|k€|k\$|m€|€|\$|\/100|k(?![\p{L}])|m(?![\p{L}]))|(?:^|[^\p{L}\p{N}])[x×]\s?\d+(?:[.,]\d+)?(?=$|[^\p{L}\p{N}])/giu;

/** Les chiffres « à unité » d'un texte (pourcentages, montants, multiplicateurs, notes /100), normalisés et dédoublonnés. */
export function unitFigures(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(FIGURE_PATTERN)) found.add(normalizeFigure(match[0]));
  return [...found];
}

/** Chiffres à unité du CV que le profil maître ne porte pas : un chiffre sans source est une invention. */
export function unsupportedFigures(cv: string, profile: string): string[] {
  const known = new Set(unitFigures(profile));
  return unitFigures(cv).filter((figure) => !known.has(figure));
}

/**
 * Phrases creuses (FR/EN) qu'un recruteur lit comme du remplissage généré. Liste littérale
 * (sous-chaîne, insensible à la casse) : une entrée n'en contient jamais une autre, pour
 * qu'un cliché ne soit signalé qu'une fois. Partagée par `email-checks.ts`, `aeo-checks.ts`
 * et la lettre de motivation : nom et type stables.
 */
export const DEFAULT_SLOP: string[] = [
  'passionné par',
  'passionnée par',
  'dynamique et motivé',
  'force de proposition',
  'je suis convaincu',
  "n'hésitez pas",
  'dans un monde en constante évolution',
  'je me permets de',
  'fort de mon expérience',
  'forte de mon expérience',
  'au plaisir de vous lire',
  "dans l'attente de votre retour",
  'synergie',
  'révolutionner',
  'game changer',
  'game-changer',
  'passionate about',
  'i am excited',
  "i'm excited",
  'dynamic and motivated',
  'proven track record',
  'results-driven',
  'think outside the box',
  'fast-paced',
  'cutting-edge',
  'seamlessly',
  // Adapté de ai-job-search/.claude/skills/job-application-assistant/03-writing-style.md et 08-application-forms.md (MIT)
  'would be a great fit',
  'hit the ground running',
  'drive results',
  'team player',
  'fast learner',
  // Adapté de proficiently-claude-skills/skills/tailor-resume/SKILL.md (Step 3) et skills/cover-letter/scripts/write-cover-letter.md (MIT)
  'demonstrating ability to',
  'showcasing expertise in',
  'with a track record of',
  'leveraging',
  // « leverage » (verbe ou nom) : « leveraging » ne le contient pas, les deux restent.
  'leverage',
  'living and breathing',
  'aligns perfectly',
  // Marqueurs de texte généré, en anglais
  'delve',
  'a testament to',
  'rich tapestry',
  'ever-evolving',
  'holistic approach',
  'self-starter',
  // Les mêmes clichés en français (traduits des listes ci-dessus), et les formules creuses des CV et lettres françaises
  'passionné de',
  'passionnée de',
  'ma passion pour',
  "enthousiaste à l'idée",
  'orienté résultat',
  'orientée résultat',
  "esprit d'équipe",
  "capacité d'adaptation",
  'mettre à profit mes',
  "fort d'une expérience",
  "forte d'une expérience",
  'en parfaite adéquation',
  'correspond parfaitement',
  'candidat idéal',
  'candidate idéale',
  'véritable atout',
  'réelle valeur ajoutée',
  'relever de nouveaux défis',
  'à la pointe',
  'changer la donne',
  'sortir des sentiers battus',
  'environnement en constante évolution',
  'en perpétuelle évolution',
  'approche holistique',
  'plonger au cœur',
  'je me tiens à votre disposition',
  'je reste à votre disposition',
  // Le guide de voix des messages du candidat (pitch, réponses, lettre, 2026-10-23) : les
  // ouvertures et clôtures de gabarit qu'un modèle écrit par défaut, et les adjectifs creux
  // sous la forme où ils ne nomment rien (« dynamique » seul resterait juste dans
  // « tarification dynamique » ou « Microsoft Dynamics » : le Reviewer tranche le reste).
  'i am applying for',
  'i am writing to',
  "i'm applying for",
  'i am thrilled',
  "i'm thrilled",
  'i would welcome the opportunity',
  "i'd welcome the opportunity",
  'that is the space i work in',
  "that's the space i work in",
  'that is the work i do',
  "that's the work i do",
  'dear hiring manager',
  'synergy',
  'dynamic team',
  'dynamic environment',
  'dynamic company',
  'highly dynamic',
  "c'est avec un grand intérêt",
  'équipe dynamique',
  'entreprise dynamique',
  'environnement dynamique',
  'structure dynamique',
  'start-up dynamique',
  'startup dynamique',
  'jeune et dynamique',
];

/** Minuscules, apostrophes courbes redressées (« I’m thrilled » est « i'm thrilled »). */
function slopText(text: string): string {
  return text.toLowerCase().replace(/[’‘ʼ]/g, "'");
}

export function slopPhrases(text: string, phrases: string[] = DEFAULT_SLOP): string[] {
  const hay = slopText(text);
  return phrases.filter((phrase) => hay.includes(slopText(phrase)));
}

/** Les mentions littérales (entreprise, intitulé du poste), retirées avant de compter tirets et portées : l'en-tête du CV les recopie telles que l'offre les écrit. */
export function withoutLiterals(text: string, literals: string[]): string {
  let out = text;
  for (const literal of literals) {
    if (literal.trim() === '') continue;
    out = out.replace(new RegExp(escapeRegExp(literal.trim()), 'giu'), ' ');
  }
  return out;
}

/**
 * Tirets longs hors titres Markdown : cadratin (—), barre (―), demi-cadratin (–) sauf dans
 * un intervalle de nombres (2019–2024), et « -- » entre deux espaces. Un texte généré en
 * aligne un par puce ; le français en garde l'usage pour une incise, d'où un budget plutôt
 * qu'une interdiction.
 */
export function longDashes(text: string): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue;
    count += (line.match(/[—―]/g) ?? []).length;
    count += (line.replace(/\d\s?–\s?\d/g, '').match(/–/g) ?? []).length;
    count += (line.match(/(?<=\s)--(?=\s)/g) ?? []).length;
  }
  return count;
}

export interface DashBudget {
  cv: number;
  pitch: number;
}

/** Au plus 3 tirets longs dans le CV hors titres (la ligne « entreprise — poste » et une incise), 2 dans le message (une incise : deux tirets). */
export const DASH_BUDGET: DashBudget = { cv: 3, pitch: 2 };

export function dashProblems(label: string, text: string, max: number): string[] {
  const count = longDashes(text);
  if (count <= max) return [];
  return [`${label}: ${count} long dashes (—, –) outside headings, at most ${max}: use a comma, a colon, parentheses or a full stop`];
}

/** Une portée que le Drafter ne déduit jamais : le mot doit être dans le profil maître, quelle que soit sa forme. */
export interface ScopeTerm {
  kind: string;
  pattern: RegExp;
}

const PEOPLE =
  "(?:personnes?|collaborat\\p{L}*|salarié\\p{L}*|employé\\p{L}*|stagiaires?|alternant\\p{L}*|commerciaux|commerciales|développeu\\p{L}*|devs?|freelances?|consultant\\p{L}*|membres|ETP|people|persons?|employees|engineers|developers|reps|SDRs?|BDRs?|interns|FTEs?|direct reports|members)";

// Adapté de proficiently-claude-skills/skills/tailor-resume/SKILL.md, « Strict accuracy rules » (MIT) : ni B2B/B2C, ni P&L, ni partenaires que le profil ne dit pas.
export const SCOPE_TERMS: ScopeTerm[] = [
  { kind: 'B2B', pattern: /(?<![\p{L}\p{N}])(?:B2B|BtoB|B to B)(?![\p{L}\p{N}])/iu },
  { kind: 'B2C', pattern: /(?<![\p{L}\p{N}])(?:B2C|BtoC|B to C)(?![\p{L}\p{N}])/iu },
  { kind: 'B2B2C', pattern: /(?<![\p{L}\p{N}])B2B2C(?![\p{L}\p{N}])/iu },
  { kind: 'SaaS', pattern: /(?<![\p{L}\p{N}])SaaS(?![\p{L}\p{N}])/iu },
  { kind: 'marketplace', pattern: /(?<![\p{L}\p{N}])(?:marketplaces?|places? de marché)(?![\p{L}\p{N}])/iu },
  { kind: 'P&L', pattern: /(?<![\p{L}\p{N}])(?:P\s?&\s?L|profit (?:and|&) loss|comptes? de résultat)(?![\p{L}\p{N}])/iu },
  { kind: 'budget', pattern: /(?<![\p{L}\p{N}])budg[eé]t\p{L}*/iu },
  { kind: 'key accounts', pattern: /(?<![\p{L}\p{N}])(?:grands comptes|key accounts?)(?![\p{L}\p{N}])/iu },
  {
    kind: 'people management',
    pattern: new RegExp(
      [
        // « managé une équipe », « encadrement de 2 stagiaires », « dirigé l'équipe », « piloté des freelances »
        `(?<![\\p{L}\\p{N}])(?:manag|encadr|dirig|supervis|pilot|anim)\\p{L}*[ \\t]+(?:(?:d['’]|de|des|du|une|un|l['’]|la|le|les|mon|ma|mes|son|sa|ses|leur|leurs)[ \\t]*)?(?:\\d+[ \\t]+)?(?:équipes?|${PEOPLE})(?![\\p{L}])`,
        // au passif, dans la même proposition : « équipe de 5 personnes managée » (pas « encadré par le CTO »)
        `(?<![\\p{L}\\p{N}])(?:équipes?|${PEOPLE})[^.,;\\n]{0,30}?(?:managé|encadré|dirigé|supervisé)e?s?(?![\\p{L}])(?![ \\t]+(?:par|by)(?![\\p{L}]))`,
        // « chef d'équipe », « management hiérarchique », « team lead »
        `(?:chef|responsable|lead|leader|manager)[ \\t]+d['’][ \\t]*équipe|management[ \\t]+hiérarchique|team[ \\t-]?lead\\p{L}*`,
        // « managed a team of 5 », « led the SDR team », « direct reports », « people manager »
        `(?<![\\p{L}])(?:manag|led|lead|supervis|oversaw|oversee|direct)\\p{L}*[ \\t]+(?:(?:a|an|the|my|our|their)[ \\t]+)?(?:\\d+[ \\t-]*(?:person|people|strong)?[ \\t]+)?(?:SDR[ \\t]+|sales[ \\t]+)?(?:teams?|squads?|${PEOPLE}|staff)(?![\\p{L}])`,
        `(?:people|line)[ \\t-]manag\\p{L}*|direct[ \\t]+reports|rapports[ \\t]+(?:directs|hiérarchiques)`,
      ].join('|'),
      'iu'
    ),
  },
];

const NUMBER_WORDS: Record<string, string> = {
  deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9', dix: '10', onze: '11', douze: '12',
  quinze: '15', vingt: '20', trente: '30', cinquante: '50', cent: '100', two: '2', three: '3', four: '4', five: '5',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30',
  fifty: '50', hundred: '100',
};
const NUMBER = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;
const TEAM_SIZE = new RegExp(
  `(?<![\\p{L}\\p{N}-])(?:(?:équipe|team|squad)[ \\t]+(?:de|of)[ \\t]+${NUMBER}|${NUMBER}[ \\t-]*${PEOPLE})(?![\\p{L}])`,
  'giu'
);

export interface TeamSize {
  size: string;
  text: string;
}

/** Les effectifs d'un texte : « équipe de 8 », « team of five », « 3 stagiaires », « 12 people » ; nombre normalisé en chiffres. */
export function teamSizes(text: string): TeamSize[] {
  const found: TeamSize[] = [];
  for (const match of text.matchAll(TEAM_SIZE)) {
    const raw = (match[1] ?? match[2]).toLowerCase();
    found.push({ size: NUMBER_WORDS[raw] ?? raw, text: match[0].trim() });
  }
  return found;
}

const PARTY_TRIGGER =
  /(?<![\p{L}\p{N}])(?:(?:clients?|clientes?|customers?|partenaires?|partners?|partenariats?[ \t]+avec|partnerships?[ \t]+with|partnered[ \t]+with|en[ \t]+collaboration[ \t]+avec|in[ \t]+collaboration[ \t]+with|pour[ \t]+le[ \t]+compte[ \t]+de|on[ \t]+behalf[ \t]+of)(?:[ \t]*:[ \t]*|[ \t]+(?:comme|tels?[ \t]+que|telles?[ \t]+que|dont|notamment|such[ \t]+as|like|including)[ \t]+|[ \t]+)|pour[ \t]+le[ \t]+compte[ \t]+d['’])/giu;
const PARTY_NAME = /\p{Lu}(?:[\p{L}\p{N}'’-]|\.(?=[\p{L}\p{N}]))*(?:[ \t]+\p{Lu}(?:[\p{L}\p{N}'’-]|\.(?=[\p{L}\p{N}]))*)*/uy;
const PARTY_SEPARATOR = /[ \t]*(?:[,;/&]|(?<=[ \t])(?:et|and|ou|or)(?=[ \t]))[ \t]*/uy;

/** Les clients et partenaires nommés : les noms propres qui suivent « clients : », « partenariat avec », « for clients such as »… */
export function namedParties(text: string): string[] {
  const plain = text.replace(/[*`]/g, '');
  const names = new Set<string>();
  for (const trigger of plain.matchAll(PARTY_TRIGGER)) {
    let at = (trigger.index ?? 0) + trigger[0].length;
    for (let n = 0; n < 8; n += 1) {
      PARTY_NAME.lastIndex = at;
      const name = PARTY_NAME.exec(plain);
      if (name === null) break;
      const clean = name[0].replace(/['’-]+$/, '');
      if (!SCOPE_TERMS.some((term) => term.pattern.test(clean))) names.add(clean);
      at = PARTY_NAME.lastIndex;
      PARTY_SEPARATOR.lastIndex = at;
      if (PARTY_SEPARATOR.exec(plain) === null) break;
      at = PARTY_SEPARATOR.lastIndex;
    }
  }
  return [...names];
}

export interface Claim {
  kind: string;
  text: string;
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Portées du CV que le profil maître ne porte nulle part : modèle d'affaires (B2B, B2C,
 * SaaS…), P&L, budget, grands comptes, management, taille d'équipe (le nombre doit être
 * dans le profil), clients ou partenaires nommés. Une portée déduite est une invention,
 * même quand l'offre la demande.
 */
export function unsupportedClaims(cv: string, profile: string): Claim[] {
  const claims: Claim[] = [];
  for (const term of SCOPE_TERMS) {
    const hit = cv.match(term.pattern);
    if (hit !== null && !term.pattern.test(profile)) claims.push({ kind: term.kind, text: hit[0].trim() });
  }
  const knownSizes = new Set(teamSizes(profile).map((team) => team.size));
  const seenSizes = new Set<string>();
  for (const team of teamSizes(cv)) {
    if (knownSizes.has(team.size) || seenSizes.has(team.size)) continue;
    seenSizes.add(team.size);
    claims.push({ kind: 'team size', text: team.text });
  }
  for (const name of namedParties(cv)) {
    if (!mentions(profile, name)) claims.push({ kind: 'client or partner', text: name });
  }
  return claims;
}

export interface PageBudget {
  lines: number;
  chars: number;
}

/** Une page : budget en lignes non vides et en caractères, mesuré sur le Markdown. */
export const ONE_PAGE: PageBudget = { lines: 70, chars: 4500 };

export function pageBudgetProblems(cv: string, budget: PageBudget = ONE_PAGE): string[] {
  const lines = cv.split('\n').filter((line) => line.trim() !== '').length;
  const chars = cv.trim().length;
  const problems: string[] = [];
  if (lines > budget.lines) problems.push(`CV too long for one page: ${lines} non-empty lines, at most ${budget.lines}`);
  if (chars > budget.chars) problems.push(`CV too long for one page: ${chars} chars, at most ${budget.chars}`);
  return problems;
}

export interface Contact {
  email: string;
  linkedin: string;
  /** Le téléphone du profil tel qu'écrit, vide s'il n'y en a pas. */
  phone: string;
}

/** Les chiffres significatifs d'un téléphone : les 9 derniers, préfixe national ou international ôté. */
export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\(0\)/g, '').replace(/\D/g, '');
  return digits.length < 6 ? '' : digits.slice(-9);
}

/**
 * E-mail, URL LinkedIn et téléphone lus dans le profil maître. Le téléphone suit la règle du
 * contrôle PDF (`systems/.shared/pdf-checks.ts` `readProfileContact`) : un numéro libellé
 * (« Tél », « Téléphone », « Phone »…) d'abord, sinon un numéro français. Le PDF exige ce
 * téléphone ; le CV l'exige donc dès la boucle, où le rédacteur peut l'ajouter (passe réelle
 * Smartness du 23/10 : CV approuvé A-, puis PDF refusé faute de téléphone).
 */
export function readContact(profile: string): Contact {
  const email = profile.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  const linkedin = profile.match(/https?:\/\/(?:[\w-]+\.)?linkedin\.com\/in\/[\w%-]+\/?/);
  const labeled = profile.match(/\b(?:t[ée]l[ée]phone|t[ée]l\b\.?|phone|mobile|portable|gsm)[^\S\n]*[*_]*[^\S\n]*[:：]?[^\S\n]*[*_]*[^\S\n]*(\+?\(?\d[\d \t.()\-/\u00A0]{6,}\d)/iu)?.[1];
  const french = profile.match(/(?<![\d+])(?:\+\d{2,3}[^\S\n]?(?:\(0\)[^\S\n]?)?[1-9]|0[1-9])(?:[ .\-]?\d{2}){4}(?!\d)/)?.[0];
  const phone = [labeled, french].find((candidate) => candidate !== undefined && /^\d{8,15}$/.test(candidate.replace(/\(0\)/g, '').replace(/\D/g, ''))) ?? '';
  return { email: email?.[0] ?? '', linkedin: linkedin?.[0] ?? '', phone: phone.trim() };
}

/** Le téléphone figure dans le texte (chiffres comparés, séparateurs ignorés). */
export function carriesPhone(text: string, phone: string): boolean {
  const key = phoneDigits(phone);
  return key === '' || text.replace(/[\s.()\-/+\u00A0]/g, '').includes(key);
}

export function contactProblems(cv: string, contact: Contact): string[] {
  const problems: string[] = [];
  if (contact.email !== '' && !cv.includes(contact.email)) problems.push(`CV does not carry the profile e-mail (${contact.email})`);
  if ((contact.phone ?? '') !== '' && !carriesPhone(cv, contact.phone)) problems.push(`CV does not carry the profile phone (${contact.phone}): put it on the contact line, the PDF check requires it`);
  if (contact.email === '' && contact.linkedin === '') problems.push('master profile carries no e-mail nor LinkedIn URL: nothing to put on the CV');
  return problems;
}

export interface PitchRules {
  company: string;
  maxWords: number;
  slop: string[];
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** Le message d'accroche : court, nomme l'entreprise, finit par une demande concrète, sans phrase creuse. */
export function pitchProblems(pitch: string, rules: PitchRules): string[] {
  const problems: string[] = [];
  const words = countWords(pitch);
  if (words > rules.maxWords) problems.push(`pitch too long: ${words} words, at most ${rules.maxWords}`);
  if (rules.company.trim() !== '' && !pitch.toLowerCase().includes(rules.company.trim().toLowerCase())) {
    problems.push(`pitch does not name the company (${rules.company})`);
  }
  if (!pitch.includes('?')) problems.push('pitch ends without a concrete ask (no question)');
  for (const phrase of slopPhrases(pitch, rules.slop)) problems.push(`pitch: hollow phrase "${phrase}"`);
  return problems;
}

/** Fiche candidat : ce que le remplisseur de formulaire utilisera. Les clés obligatoires et le contact du profil. */
export const CANDIDATE_REQUIRED_KEYS = ['name', 'email', 'linkedin', 'portfolio', 'location', 'availability', 'answers'] as const;

export function candidateProblems(candidate: unknown, contact: Contact): string[] {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return ['candidate.json is missing or is not a JSON object'];
  }
  const record = candidate as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of CANDIDATE_REQUIRED_KEYS) {
    if (record[key] === undefined || record[key] === '' || record[key] === null) problems.push(`candidate.json: missing "${key}"`);
  }
  if (typeof record.email === 'string' && contact.email !== '' && record.email !== contact.email) {
    problems.push(`candidate.json: e-mail "${record.email}" differs from the master profile (${contact.email})`);
  }
  if (typeof record.email === 'string' && record.email !== '' && !/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(record.email)) {
    problems.push(`candidate.json: "${record.email}" is not an e-mail address`);
  }
  if (record.answers !== undefined && (typeof record.answers !== 'object' || record.answers === null || Array.isArray(record.answers))) {
    problems.push('candidate.json: "answers" must be an object of question → answer');
  }
  return problems;
}

/**
 * Les réponses de `candidate.json` partent telles quelles dans les formulaires : mêmes phrases
 * creuses refusées que dans le pitch (« Why this company? » → « I am thrilled… »).
 */
export function answerProblems(candidate: unknown, slop: string[]): string[] {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
  const answers = (candidate as Record<string, unknown>).answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const problems: string[] = [];
  for (const [question, answer] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof answer !== 'string') continue;
    for (const phrase of slopPhrases(answer, slop)) problems.push(`candidate.json: answer to "${question}": hollow phrase "${phrase}"`);
  }
  return problems;
}

export interface ApplicationRules {
  company: string;
  title: string;
  keywords: string[];
  minCoverage: number;
  /** Titres attendus ; « Profil|Profile » accepte l'une des variantes. */
  requiredSections: string[];
  profile: string;
  pageBudget: PageBudget;
  maxPitchWords: number;
  slop: string[];
  /** Tirets longs tolérés hors titres ; `DASH_BUDGET` quand il est omis. */
  dashBudget?: DashBudget;
}

export interface ApplicationBundle {
  cv: string | null;
  pitch: string | null;
  candidate: unknown;
}

export interface CheckOutcome {
  ok: boolean;
  problems: string[];
  coverage: Coverage;
}

/** Le texte de l'encart Profil (`## Profil` / `## Profile`), jusqu'au titre suivant ; '' s'il manque. */
export function profileSection(cv: string): string {
  const match = /^##\s+(?:profil|profile)\s*$/im.exec(cv);
  if (match === null) return '';
  const rest = cv.slice(match.index + match[0].length);
  const next = /^#{1,2}\s+/m.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
}

/** Plafond de l'encart Profil (JobCampaign PASS_B : résumé ≤ 600 caractères). */
export const PROFILE_SECTION = { chars: 600, sentences: 3, keywords: 4, openingWords: 6 };

/**
 * L'encart Profil présente le parcours du candidat en deux ou trois phrases (Antoine, 2026-10-24 :
 * « une présentation synthétique de mon parcours », pas « un amas d'éléments de l'offre »). Le code
 * refuse ce qui trahit le collage : une liste, un texte trop long, une ouverture sur l'intitulé visé
 * (JobCampaign R2b : on ouvre sur un métier exercé), plus de quatre mots-clés de l'offre. Que le
 * texte raconte vraiment un parcours, le juge le tranche.
 */
export function profileSectionProblems(cv: string, title: string, keywords: string[], limits = PROFILE_SECTION): string[] {
  const text = profileSection(cv);
  if (text === '') return [];
  const problems: string[] = [];
  if (text.split('\n').some((line) => /^\s*(?:[-*•]|\d+\.)\s+/.test(line))) {
    problems.push('Profil: a list, not a presentation; write two or three sentences on the career path');
  }
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length > limits.chars) problems.push(`Profil too long: ${flat.length} chars, at most ${limits.chars}`);
  const sentences = flat.split(/(?<=[.!?])\s+/).filter((part) => /\p{L}/u.test(part)).length;
  if (sentences > limits.sentences) problems.push(`Profil: ${sentences} sentences, at most ${limits.sentences}`);
  const opening = flat.split(' ').slice(0, limits.openingWords).join(' ').toLowerCase();
  if (title.trim() !== '' && opening.includes(title.trim().toLowerCase())) {
    problems.push(`Profil opens with the posting title (${title}): open with who the candidate is, a role held, and echo the title later`);
  }
  const echoed = keywordCoverage(text, keywords).covered;
  if (echoed.length > limits.keywords) {
    problems.push(`Profil carries ${echoed.length} posting keywords (${echoed.join(', ')}): it reads as a pile of the posting; keep at most ${limits.keywords}, the rest belongs in the experiences and skills`);
  }
  return problems;
}

function headings(markdown: string): Set<string> {
  return new Set(
    markdown
      .split('\n')
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, '').trim().toLowerCase())
  );
}

/** Le contrôle complet d'un dossier. Chaque problème dit quoi corriger ; l'agent les reçoit au tour suivant. */
export function checkApplication(bundle: ApplicationBundle, rules: ApplicationRules): CheckOutcome {
  const problems: string[] = [];
  const empty: Coverage = { covered: [], missing: [...rules.keywords], ratio: 0 };
  if (bundle.cv === null || bundle.cv.trim() === '') {
    problems.push('CV file is missing or empty');
  }
  if (bundle.pitch === null || bundle.pitch.trim() === '') {
    problems.push('pitch file is missing or empty');
  }
  const contact = readContact(rules.profile);
  problems.push(...candidateProblems(bundle.candidate, contact));
  problems.push(...answerProblems(bundle.candidate, rules.slop));
  if (bundle.cv === null || bundle.cv.trim() === '') {
    return { ok: false, problems, coverage: empty };
  }
  const cv = bundle.cv;
  const found = headings(cv);
  for (const section of rules.requiredSections) {
    // « Profil|Profile » : l'une des variantes suffit (le CV est écrit dans la langue de l'offre).
    const alternatives = section.split('|').map((alt) => alt.trim().toLowerCase());
    if (!alternatives.some((alt) => found.has(alt))) problems.push(`CV: missing section "${section}"`);
  }
  if (rules.company.trim() !== '' && !cv.toLowerCase().includes(rules.company.trim().toLowerCase())) {
    problems.push(`CV does not name the company (${rules.company}): it is not tailored`);
  }
  if (rules.title.trim() !== '' && !cv.toLowerCase().includes(rules.title.trim().toLowerCase())) {
    problems.push(`CV does not name the role (${rules.title})`);
  }
  const coverage = keywordCoverage(cv, rules.keywords);
  if (coverage.ratio < rules.minCoverage) {
    problems.push(
      `CV covers ${coverage.covered.length}/${coverage.covered.length + coverage.missing.length} offer keywords (${Math.round(coverage.ratio * 100)}%, at least ${Math.round(rules.minCoverage * 100)}% expected); missing: ${coverage.missing.join(', ')}`
    );
  }
  for (const figure of unsupportedFigures(cv, rules.profile)) {
    problems.push(`CV: figure "${figure}" does not appear in the master profile (unsupported claim)`);
  }
  // L'en-tête recopie l'entreprise et l'intitulé tels que l'offre les écrit (« Growth Manager B2B — CDI ») :
  // on les retire avant de chercher une portée déduite ou de compter les tirets.
  const named = [rules.company, rules.title];
  const body = withoutLiterals(cv, named);
  for (const claim of unsupportedClaims(body, rules.profile)) {
    problems.push(`CV: ${claim.kind} claim "${claim.text}" does not appear in the master profile (inferred scope: remove it or use the profile's own words)`);
  }
  for (const phrase of slopPhrases(cv, rules.slop)) problems.push(`CV: hollow phrase "${phrase}"`);
  const dashes = rules.dashBudget ?? DASH_BUDGET;
  problems.push(...dashProblems('CV', body, dashes.cv));
  for (const marker of ['TODO', 'TBD', 'lorem ipsum', '<placeholder>', '{{']) {
    if (cv.toLowerCase().includes(marker.toLowerCase())) problems.push(`CV: draft marker found: "${marker}"`);
  }
  problems.push(...profileSectionProblems(cv, rules.title, rules.keywords));
  problems.push(...pageBudgetProblems(cv, rules.pageBudget));
  problems.push(...contactProblems(cv, contact));
  if (bundle.pitch !== null && bundle.pitch.trim() !== '') {
    problems.push(...pitchProblems(bundle.pitch, { company: rules.company, maxWords: rules.maxPitchWords, slop: rules.slop }));
    problems.push(...dashProblems('pitch', withoutLiterals(bundle.pitch, named), dashes.pitch));
  }
  return { ok: problems.length === 0, problems, coverage };
}
