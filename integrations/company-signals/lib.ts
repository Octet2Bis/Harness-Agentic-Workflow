/**
 * Les signaux d'entreprises (Antoine, 2026-11-14) : ce qui annonce un besoin avant que le poste soit
 * publié (levée, nouveau CMO, vague de recrutement, nouvel outil marketing, ouverture d'un pays…).
 * Ici, les règles pures, sans réseau ni Claude : types de signaux et leur poids, lecture d'un titre
 * d'article (quel signal, quelle entreprise, quel montant), normalisation des noms, score d'une
 * entreprise, et les « directions » apprises de ses bonnes pistes.
 *
 * Contrôle en code à chaque étape : un signal n'est gardé que si l'entreprise nommée est lisible
 * (`validCompanyName`), si la date est lisible et récente, et si la preuve (titre, lien) est là.
 */

export type SignalType =
  | 'levee'
  | 'capital'
  | 'nouveau_dirigeant'
  | 'recrute_leader'
  | 'vague_recrutement'
  | 'premier_marketing'
  | 'stack'
  | 'nouvelle_langue'
  | 'blog'
  | 'expansion'
  | 'lancement'
  | 'accelerateur'
  | 'subvention'
  | 'rachat'
  | 'rebranding'
  | 'dirigeant_registre'
  | 'licenciements'
  | 'procedure';

/** Poids de base (un signal négatif retire des points). Antoine : d'abord ce qui annonce un besoin proche de son profil. */
export const WEIGHT: Record<SignalType, number> = {
  levee: 1,
  nouveau_dirigeant: 0.9,
  capital: 0.8,
  recrute_leader: 0.8,
  premier_marketing: 0.8,
  stack: 0.7,
  vague_recrutement: 0.7,
  expansion: 0.6,
  nouvelle_langue: 0.5,
  subvention: 0.5,
  accelerateur: 0.5,
  lancement: 0.4,
  blog: 0.3,
  rebranding: 0.3,
  rachat: 0.3,
  dirigeant_registre: 0.3,
  licenciements: -1,
  procedure: -1.5,
};

export const LABEL: Record<SignalType, string> = {
  levee: 'Levée de fonds',
  capital: 'Augmentation de capital (registre)',
  nouveau_dirigeant: 'Nouveau responsable marketing, growth ou ventes',
  recrute_leader: 'Recrute un responsable marketing, growth ou ventes',
  vague_recrutement: 'Vague de recrutement',
  premier_marketing: 'Premier poste marketing ou growth',
  stack: 'Nouvel outil marketing ou vente sur son site',
  nouvelle_langue: 'Site dans une nouvelle langue',
  blog: 'Lance un blog ou une newsletter',
  expansion: 'Ouvre un pays ou un marché',
  lancement: 'Lance un produit',
  accelerateur: 'Accélérateur (YC…), recrute',
  subvention: 'Subvention ou programme public',
  rachat: 'Rachat ou fusion',
  rebranding: 'Change de nom ou de marque',
  dirigeant_registre: 'Changement de dirigeant (registre)',
  licenciements: 'Licenciements',
  procedure: 'Procédure collective (redressement, liquidation)',
};

export interface Signal {
  /** Stable : source + lien (ou contenu) ; deux lectures du même article donnent le même id. */
  id: string;
  type: SignalType;
  company: string;
  /** Le jour de l'événement (publication de l'article, de l'annonce légale, du poste), AAAA-MM-JJ. */
  date: string;
  source: string;
  url: string;
  /** La preuve : le titre ou la ligne qui porte le signal, tel quel. */
  evidence: string;
  amount_eur?: number;
  country?: string;
  detail?: string;
  found_at: string;
}

export interface CompanyFacts {
  siren?: string;
  naf?: string;
  naf_label?: string;
  effectif?: string;
  ville?: string;
  date_creation?: string;
  categorie?: string;
  dirigeants?: number;
  lei?: string;
  registry_country?: string;
  org_no?: string;
  uk_number?: string;
  website?: string;
  stack?: string[];
  languages?: string[];
  sectors?: string[];
  checked_at?: string;
  note?: string;
}

export interface CompanyEntry {
  name: string;
  norm: string;
  country: string;
  /** La clé du registre « Entreprises full remote » (`greenhouse:posthog`…) quand l'entreprise y est. */
  remote_key: string;
  remote_kind: '' | 'full' | 'partiel';
  careers: string;
  facts: CompanyFacts;
  signals: Signal[];
  score: number;
  why: string[];
}

// ── Noms ─────────────────────────────────────────────────────────────────────

const LEGAL = /\b(sas|sasu|sa|sarl|eurl|sci|gmbh|ag|ug|kg|se|ltd|limited|llc|inc|corp|corporation|plc|bv|nv|ab|as|asa|aps|oy|oyj|srl|spa|sl|slu|sp z o o|kft|ou|oü|holding|group|groupe)\b\.?/g;

/** La clé de rapprochement d'un nom d'entreprise : minuscules, sans accents, sans forme juridique ni ponctuation. */
export function normName(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL, ' ')
    .replace(/\s+/g, '')
    .trim();
}

const GENERIC = new Set(
  'the a an la le les l un une des startup start up scaleup company firm fintech healthtech edtech proptech insurtech legaltech saas platform plateforme jeune pousse french francaise europe european uk british german spanish italian dutch belgian swiss nordic exclusive exclusif breaking update report this that it how why what who when where these those funding round series seed investors investor vc fund fonds levee raises raised startups founders founder ceo cto cmo ai ia team teams week semaine weekly today deux trois quatre cinq six dix two three four five ten ces cette ce cet new nouveau nouvelle nouveaux comment pourquoi quand anciens ancien former ex selon according après after avant before voici here'
    .split(' '),
);

/** Un nom d'entreprise lisible : 2 à 40 caractères, une lettre, pas un mot générique, pas une phrase. */
export function validCompanyName(name: string): boolean {
  const s = String(name ?? '').trim();
  if (s.length < 2 || s.length > 40) return false;
  if (!/\p{L}/u.test(s)) return false;
  if (s.split(/\s+/).length > 4) return false;
  const n = normName(s);
  if (n.length < 2) return false;
  if (GENERIC.has(s.toLowerCase()) || GENERIC.has(n)) return false;
  return true;
}

// ── Lecture d'un titre d'article ─────────────────────────────────────────────

const VERB_FUNDING =
  /\s(?:raises?|raised|has raised|secures?|secured|closes?|closed|lands?|bags?|nabs?|grabs?|snags?|scores?|gets?|receives?|attracts?|pulls in|banks|lève|lèvent|a levé|ont levé|boucle|bouclent|réalise|annonce une levée|obtient|sammelt|erhält|holt sich|recauda|levanta|cierra|raccoglie|haalt)\b/i;
const FUNDING_HINT =
  /\b(?:seed|pre-seed|series [a-f]|série [a-f]|serie [a-f]|tour de table|levée de fonds|funding|financement|finanzierungsrunde|round|investment|investissement)\b/i;
const AMOUNT =
  /(?:(\d+(?:[.,]\d+)?)\s?(millions?|milliards?|m)\s?d['’]euros|(€|\$|£|eur|usd|gbp|chf)\s?(\d+(?:[.,]\d+)?)\s?(bn|billion|milliards?|mrd|m|mn|mio|million|millions|millionen|k)?|(\d+(?:[.,]\d+)?)\s?(bn|billion|milliards?|mrd|m|mn|mio|million|millions|millionen|k)?\s?(€|\$|£|euros?|eur|usd|dollars?|gbp|pounds?|chf))/i;
const LEADER_ROLE =
  /\b(?:cmo|chief marketing officer|chief revenue officer|cro|chief growth officer|vp (?:of )?(?:marketing|growth|sales|revenue)|vice[- ]president (?:of )?(?:marketing|growth|sales)|head of (?:marketing|growth|sales|revenue|demand generation|brand)|directeur (?:marketing|commercial|de la croissance|growth)|directrice (?:marketing|commerciale|de la croissance|growth)|marketing director|sales director|growth lead)\b/i;
const LEADER_VERB =
  /\b(?:appoints?|appointed|names?|named|hires?|hired|welcomes?|joins?|promotes?|promoted|taps|nomme|nommé|nommée|recrute|rejoint|accueille|arrive|promu|promue|ernennt|holt)\b/i;
const EXPANSION =
  /\b(?:expands? (?:to|into)|expansion (?:to|into|in)|launch(?:es)? in|enters? (?:the )?[\p{L} ]{0,30}market|opens? (?:an? |its )?(?:new )?(?:office|hub|headquarters) in|arrive (?:en|au|aux)|s'implante|s'installe (?:en|au|à)|ouvre (?:un |son )?bureau|se lance (?:en|au|aux)|internationali[sz])/iu;
const LAUNCH = /\b(?:launches|launched|unveils?|introduces|debuts|rolls out|lance|lancent|dévoile|présente|sort)\b/i;
const GRANT = /\b(?:bpifrance|eic accelerator|horizon europe|france 2030|i-nov|innovate uk|subvention|grant|prêt d'innovation|eic fund)\b/i;
const ACCEL =
  /\b(?:y combinator|yc[- ]backed|techstars|station f|entrepreneur first|seedcamp|antler|500 global|accélérateur|incubateur|accelerator|joins? the [\p{L} ]{0,20}programme)\b/iu;
const MNA =
  /\b(?:acquires?|acquired|acquisition|rachète|rachetée?|rachat|fusion|merges? with|merger|übernimmt|übernahme|adquiere|compra)\b/i;
const REBRAND = /\b(?:rebrands?|rebranding|renames?|devient|change de nom|new name|nouvelle identité|nouveau nom)\b/i;
const LAYOFF =
  /\b(?:lays? off|laid off|layoffs?|job cuts|cuts? [\d,]+ (?:jobs|staff|employees|roles)|slashes [\d,]+|licenciements?|licencie|plan social|pse|plan de départs|entlässt|stellenabbau|despidos)\b/i;
const PROCEDURE =
  /\b(?:redressement judiciaire|liquidation judiciaire|sauvegarde|insolvency|insolvent|administration|bankrupt(?:cy)?|faillite|insolvenz|shuts? down|ferme ses portes|cessation)\b/i;
const ROUNDUP =
  /\b(?:cette semaine|this week|of the week|de la semaine|weekly|roundup|round-up|récap|recap|les levées|funding news|top \d+|\d+ startups|startups? (?:françaises|européennes|french|european) (?:ont|have)|newsletter|podcast|webinar|watch:|listen:|opinion|op-ed|interview|tribune)\b/i;

/** Les mots qui précèdent souvent le nom sans en faire partie (« Paris-based », « La fintech », « YC-backed »). */
const LEAD_WORDS =
  /^(?:(?:exclusive|exclusif|breaking|update|news|scoop)\s*[:|-]\s*)?(?:(?:the|la|le|l'|les|startup|start-up|scale-up|scaleup|jeune pousse|pépite|licorne|unicorn|fintech|healthtech|edtech|proptech|insurtech|legaltech|martech|adtech|deeptech|foodtech|climate ?tech|saas|ai|ia|b2b|b2c|platform|plateforme|app|application|marketplace|company|firm|société|entreprise|spécialiste|specialist|leader|provider|maker|developer|software|logiciel|outil|solution|cybersecurity|cybersécurité|française|français|french|european|européenne|européen|british|uk|german|allemande|spanish|espagnole|italian|italienne|dutch|néerlandaise|belgian|belge|swiss|suisse|nordic|swedish|suédoise|danish|danoise|norwegian|finnish|estonian|irish|portuguese|polish|austrian|[\p{L}-]+-based|basée? à [\p{L}-]+|[\p{L}-]+-backed|yc|y combinator|backed|du|de|des|d'|of|for|pour|dans|in|the|of)\s+)+/iu;

export interface Headline {
  type: SignalType;
  company: string;
  amount_eur?: number;
  detail?: string;
}

/** Le montant en euros (taux fixes et arrondis : l'ordre de grandeur suffit). */
export function amountEur(text: string): number | undefined {
  const m = AMOUNT.exec(text);
  if (!m) return undefined;
  const fr = m[1] !== undefined;
  const cur = fr ? 'eur' : (m[3] ?? m[8] ?? '').toLowerCase();
  const num = Number((fr ? m[1] : (m[4] ?? m[6] ?? '')).replace(',', '.'));
  const unit = (fr ? m[2] : (m[5] ?? m[7] ?? '')).toLowerCase();
  if (!Number.isFinite(num) || num <= 0) return undefined;
  if (unit === '' && num < 1000) return undefined; // « 3 $ » ou une année : pas un montant de levée
  const mult = /^(?:bn|billion|milliards?|mrd)$/.test(unit) ? 1e9 : /^(?:m|mn|mio|million|millions|millionen)$/.test(unit) ? 1e6 : unit === 'k' ? 1e3 : 1;
  const rate = cur.startsWith('$') || cur.startsWith('usd') || cur.startsWith('dollar') ? 0.92 : cur.startsWith('£') || cur.startsWith('gbp') || cur.startsWith('pound') ? 1.17 : cur === 'chf' ? 1.05 : 1;
  const v = Math.round(num * mult * rate);
  return v >= 10_000 && v < 50e9 ? v : undefined;
}

/** Le nom de l'entreprise : le groupe en majuscule qui précède le verbe, débarrassé des qualificatifs. */
export function subjectBefore(title: string, verbIndex: number): string {
  let head = title.slice(0, verbIndex).trim();
  head = head.replace(/^.*?[:|–—]\s+(?=\S)/, (m) => (m.length < head.length ? '' : m)); // « Exclusive: X raises » / « Fintech | X lève »
  head = head.replace(/[,;]\s.*$/, ''); // « X, the AI startup, raises » → X
  head = head.replace(/\s*\([^)]*\)\s*$/, '');
  head = head.replace(/['’]s$/i, '');
  for (let i = 0; i < 3; i++) head = head.replace(LEAD_WORDS, '');
  // Garder les derniers mots en majuscule (« la startup lyonnaise Pennylane » → Pennylane).
  const words = head.split(/\s+/).filter(Boolean);
  const caps: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (/^[\p{Lu}\d]/u.test(w) || /^[a-z]+[A-Z]/.test(w) || (caps.length > 0 && /^(?:de|du|des|of|and|&|et|la|le|von|van|der)$/.test(w))) caps.unshift(w);
    else break;
  }
  while (caps.length && /^(?:de|du|des|of|and|&|et|la|le|von|van|der)$/i.test(caps[0])) caps.shift();
  // « Ynsect placée en redressement » : le nom est en tête, suivi d'un participe.
  if (caps.length === 0) for (const w of words) if (/^[\p{Lu}\d]/u.test(w) && caps.length < 3) caps.push(w); else break;
  return caps.join(' ').replace(/[“”"«»]/g, '').trim();
}

/** Ce que dit un titre d'article : le signal le plus fort et l'entreprise qui le porte, ou null (récap, rien de lisible). */
export function readHeadline(title: string, summary = ''): Headline | null {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (t === '' || ROUNDUP.test(t)) return null;
  const both = `${t} ${summary}`;
  const pick = (type: SignalType, rx: RegExp, extra: Partial<Headline> = {}): Headline | null => {
    const m = rx.exec(t);
    if (!m) return null;
    const company = subjectBefore(t, m.index);
    if (!validCompanyName(company)) return null;
    return { type, company, ...extra };
  };
  if (PROCEDURE.test(t)) return pick('procedure', PROCEDURE);
  if (LAYOFF.test(t)) return pick('licenciements', LAYOFF);
  const fv = VERB_FUNDING.exec(` ${t}`);
  if (fv && (AMOUNT.test(t) || FUNDING_HINT.test(both))) {
    const company = subjectBefore(t, Math.max(0, fv.index - 1) + 0);
    if (validCompanyName(company)) {
      const amt = amountEur(t);
      const round = /\b(pre-seed|seed|series [a-f]|série [a-f]|serie [a-f])\b/i.exec(both);
      return { type: 'levee', company, ...(amt ? { amount_eur: amt } : {}), ...(round ? { detail: round[1] } : {}) };
    }
  }
  if (LEADER_ROLE.test(t) && LEADER_VERB.test(t)) {
    const v = LEADER_VERB.exec(t)!;
    const role = LEADER_ROLE.exec(t)![0];
    // « X appoints Y as CMO » : le sujet est l'entreprise ; « Y joins X as CMO » : l'entreprise suit le verbe.
    const after = /^(?:joins?|rejoint)$/i.test(v[0]) ? /^\s*([\p{Lu}][\p{L}\d.&'-]*(?:\s[\p{Lu}][\p{L}\d.&'-]*){0,2})/u.exec(t.slice(v.index + v[0].length)) : null;
    const company = after ? after[1] : subjectBefore(t, v.index);
    if (validCompanyName(company)) return { type: 'nouveau_dirigeant', company, detail: role };
  }
  for (const [type, rx] of [
    ['expansion', EXPANSION],
    ['accelerateur', ACCEL],
    ['subvention', GRANT],
    ['rachat', MNA],
    ['rebranding', REBRAND],
    ['lancement', LAUNCH],
  ] as const) {
    if (!rx.test(t)) continue;
    const h = pick(type, rx);
    if (h) return h;
  }
  return null;
}

// ── Secteurs (pour les directions) ───────────────────────────────────────────

const SECTORS: [string, RegExp][] = [
  ['SaaS B2B', /\b(saas|b2b software|logiciel b2b|software as a service)\b/i],
  ['Fintech', /\b(fintech|payments?|paiement|banking|néobanque|neobank|lending|crypto|insurtech|assurance|insurance|accounting|comptab)/i],
  ['Outils dev', /\b(developer|devtools?|open[- ]source|api|infrastructure|observability|database|cloud)\b/i],
  ['IA', /\b(ai|ia|artificial intelligence|intelligence artificielle|machine learning|llm|genai|generative)\b/i],
  ['Martech / ventes', /\b(martech|marketing|crm|sales|vente|revops|adtech|advertising|publicité|growth|e-?mail)\b/i],
  ['E-commerce', /\b(e-?commerce|retail|d2c|dtc|marketplace|shop|commerce)\b/i],
  ['RH / travail', /\b(hr ?tech|rh|recruit|recrut|payroll|paie|talent|future of work|remote work)\b/i],
  ['Santé', /\b(health|santé|medtech|biotech|care|clinic|pharma|wellness|bien-être|mental)\b/i],
  ['Éducation', /\b(edtech|education|éducation|learning|formation|school|école)\b/i],
  ['Climat / énergie', /\b(climate|climat|energy|énergie|carbon|carbone|solar|solaire|green|vert|sustainab|durable)\b/i],
  ['Mobilité / voyage', /\b(mobility|mobilité|travel|voyage|logistics|logistique|transport|delivery)\b/i],
  ['Cybersécurité', /\b(cyber|security|sécurité|privacy|identity)\b/i],
  ['Média / jeux', /\b(media|média|gaming|games?|jeux|creator|créateur|music|musique|streaming|content)\b/i],
  ['Immobilier', /\b(proptech|real estate|immobilier)\b/i],
  ['Alimentation', /\b(food|foodtech|alimentaire|restaurant|agri)\b/i],
];

/** Les secteurs qu'un texte évoque (description, catégorie de l'article, libellé NAF). */
export function sectorsOf(text: string): string[] {
  const s = String(text ?? '');
  return SECTORS.filter(([, rx]) => rx.test(s)).map(([n]) => n).slice(0, 3);
}

// ── Score ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
/** Un signal perd la moitié de sa valeur tous les 45 jours (une levée reste utile 3 à 6 mois). */
export const HALF_LIFE_DAYS = 45;
export const MAX_AGE_DAYS = 180;

export function freshness(date: string, now: Date): number {
  const t = Date.parse(date);
  if (!Number.isFinite(t)) return 0;
  const age = Math.max(0, (now.getTime() - t) / DAY);
  if (age > MAX_AGE_DAYS) return 0;
  return 0.5 ** (age / HALF_LIFE_DAYS);
}

/** Multiplicateurs appris (directions) : par type de signal, par secteur, par pays. 1 = neutre. */
export interface Directions {
  at: string;
  byType: Record<string, number>;
  bySector: Record<string, number>;
  byCountry: Record<string, number>;
  good: number;
  bad: number;
  lines: string[];
}

export const NO_DIRECTIONS: Directions = { at: '', byType: {}, bySector: {}, byCountry: {}, good: 0, bad: 0, lines: [] };

const EUROPE = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB CH NO IS LI'.split(' '));

/** Le score d'une entreprise et ses raisons, du plus fort au plus faible. Hors d'Europe (pays connu) : 0. */
export function scoreCompany(c: CompanyEntry, now: Date, d: Directions = NO_DIRECTIONS): { score: number; why: string[] } {
  if (c.country && !EUROPE.has(c.country)) return { score: 0, why: [`hors d'Europe (${c.country})`] };
  const parts: { v: number; label: string }[] = [];
  const seenType = new Map<SignalType, number>();
  const sorted = [...c.signals].sort((a, b) => b.date.localeCompare(a.date));
  for (const s of sorted) {
    const f = freshness(s.date, now);
    if (f === 0) continue;
    // Le même type compte pleinement une fois, puis à moitié (cinq articles sur la même levée ≠ cinq levées).
    const n = seenType.get(s.type) ?? 0;
    seenType.set(s.type, n + 1);
    const dup = n === 0 ? 1 : n === 1 ? 0.3 : 0.1;
    const big = s.type === 'levee' && (s.amount_eur ?? 0) >= 5e6 ? 1.2 : 1;
    const v = WEIGHT[s.type] * f * dup * big * (d.byType[s.type] ?? 1);
    parts.push({ v, label: `${LABEL[s.type]}${s.amount_eur ? ` (${fmtEur(s.amount_eur)})` : ''}, ${s.date}` });
  }
  let score = parts.reduce((a, p) => a + p.v, 0);
  const why = parts.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 4).map((p) => p.label);
  if (c.remote_kind === 'full') {
    score *= 1.4;
    why.push('100 % remote (registre du radar)');
  } else if (c.remote_kind === 'partiel') {
    score *= 1.15;
    why.push('a des postes en full remote');
  }
  if (c.country === 'GB') {
    score *= 0.7;
    why.push('Royaume-Uni (moins simple pour toi depuis le Brexit)');
  }
  const sectorMult = Math.max(1, ...(c.facts.sectors ?? []).map((s) => d.bySector[s] ?? 1)) * Math.min(1, ...(c.facts.sectors ?? []).map((s) => d.bySector[s] ?? 1));
  if (sectorMult !== 1) {
    score *= sectorMult;
    why.push(sectorMult > 1 ? 'secteur de tes bonnes pistes' : 'secteur que tu as souvent écarté');
  }
  if (c.country && d.byCountry[c.country] && d.byCountry[c.country] !== 1) score *= d.byCountry[c.country];
  return { score: Math.round(score * 100) / 100, why };
}

export function fmtEur(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(/\.0$/, '')} Md€`;
  if (v >= 1e6) return `${Math.round(v / 1e6)} M€`;
  return `${Math.round(v / 1e3)} k€`;
}

// ── Directions : ce que ses bonnes pistes ont en commun ─────────────────────

export type Verdict = 'bon' | 'non';

/**
 * Les directions : pour chaque type de signal, secteur et pays, la part de bonnes pistes parmi ses
 * avis (lissée : 1 bon sur 1 ne suffit pas), en multiplicateur de 0,6 à 1,6. Les « bons éléments »
 * (entreprises listées à la main, offres auxquelles il a dit oui) comptent comme des avis « bon ».
 */
export function learnDirections(companies: CompanyEntry[], verdicts: Record<string, Verdict>, at: string): Directions {
  const tally = { type: new Map<string, [number, number]>(), sector: new Map<string, [number, number]>(), country: new Map<string, [number, number]>() };
  const add = (m: Map<string, [number, number]>, k: string, good: boolean) => {
    const v = m.get(k) ?? [0, 0];
    v[good ? 0 : 1]++;
    m.set(k, v);
  };
  let good = 0;
  let bad = 0;
  for (const c of companies) {
    const v = verdicts[c.norm];
    if (v === undefined) continue;
    const ok = v === 'bon';
    if (ok) good++;
    else bad++;
    for (const t of new Set(c.signals.map((s) => s.type))) add(tally.type, t, ok);
    for (const s of c.facts.sectors ?? []) add(tally.sector, s, ok);
    if (c.country) add(tally.country, c.country, ok);
  }
  const base = good + bad > 0 ? (good + 1) / (good + bad + 2) : 0.5;
  const mult = (m: Map<string, [number, number]>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, [g, b]] of m) {
      if (g + b < 2) continue;
      const rate = (g + 1) / (g + b + 2);
      out[k] = Math.round(Math.min(1.6, Math.max(0.6, rate / base)) * 100) / 100;
    }
    return out;
  };
  const byType = mult(tally.type);
  const bySector = mult(tally.sector);
  const byCountry = mult(tally.country);
  const lines: string[] = [];
  const top = (m: Map<string, [number, number]>, r: Record<string, number>, name: (k: string) => string) =>
    Object.entries(r)
      .filter(([, v]) => v >= 1.15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => {
        const [g, b] = m.get(k)!;
        return `${name(k)} : ${g} bonne${g > 1 ? 's' : ''} piste${g > 1 ? 's' : ''} sur ${g + b}`;
      });
  lines.push(...top(tally.type, byType, (k) => LABEL[k as SignalType] ?? k));
  lines.push(...top(tally.sector, bySector, (k) => `Secteur ${k}`));
  lines.push(...top(tally.country, byCountry, (k) => `Pays ${k}`));
  return { at, byType, bySector, byCountry, good, bad, lines };
}

/** L'identifiant stable d'un signal. */
export function signalId(source: string, key: string): string {
  let h = 2166136261;
  const s = `${source}|${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${source.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase()}-${(h >>> 0).toString(36)}`;
}

/** AAAA-MM-JJ d'une date lisible, sinon ''. */
export function isoDay(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString().slice(0, 10);
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}
