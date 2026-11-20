/**
 * La garde d'annonce : avant tout travail sur une offre, la page de l'annonce dit-elle que
 * l'offre est close (`expirée`), ou porte-t-elle les signes d'une arnaque ou d'un texte écrit
 * pour l'agent plutôt que pour le lecteur (`suspecte`) ? Pure : elle reçoit ce que la lecture
 * de la page a donné (statut HTTP, URL après redirections, titre, texte visible) et rend un
 * verdict avec ses raisons, en français, pour l'humain. Les E/S sont chez l'appelant :
 * `load` de career-apply (une annonce expirée arrête le run, une annonce suspecte est signalée
 * sans rien bloquer) et, plus tard, l'aperçu de l'annonce du cockpit local.
 *
 * - `expirée` : la page répond 404 ou 410 ; elle redirige vers une page de liste, de
 *   recherche, la page parente ou l'accueil du site ; elle dit que l'offre n'est plus
 *   disponible, est pourvue ou close ; son titre dit « page introuvable » ; sa date limite de
 *   candidature est passée. Une expiration à tort se répare par `/valider` (APPLY_FAILED est
 *   revalidable) ; une 404 peut aussi être un lien cassé, la raison le dit.
 * - `suspecte` : on demande de l'argent au candidat ; le contact passe par WhatsApp ou
 *   Telegram ; l'adresse du recruteur est une messagerie personnelle ; crypto-actifs ou
 *   « investissement » avec promesse de gains, vente en réseau ; salaire irréaliste pour un
 *   poste sans expérience ; et, adapté de posting_guard.py, une ligne qui donne des consignes
 *   à un agent, des caractères invisibles qui coupent des mots ou cachent du texte, des mots qui
 *   mêlent alphabets latin et cyrillique ou grec. Un signal, jamais un blocage : l'humain juge.
 * Une annonce expirée ne rend que ses raisons d'expiration (le reste ne compte plus).
 *
 * Adapté de MadsLorentzen/ai-job-search/tools/posting_guard.py (MIT, © 2026 Mads Lorentzen)
 * pour les caractères invisibles (`cleanPostingText`, `invisibleFindings`), les lignes-consignes
 * (`INSTRUCTION_PATTERNS`, sans curl/wget/ssh/scp ni `.env`, trop fréquents dans une annonce
 * technique, avec leurs équivalents français) et les mots à alphabets mêlés. Les règles
 * d'expiration (« redirige vers une page de liste », date limite passée : idée de
 * ai-job-search/.claude/commands/rank.md) et d'arnaque sont propres à ce dépôt. Le retrait des
 * éléments HTML cachés de posting_guard.py n'est pas porté : la garde reçoit le texte visible
 * (`visibleText`, `career.ts`), qui garde le contenu des éléments cachés, donc leurs consignes
 * sont vues ici, mais pas retirées du texte que lit l'agent.
 */

export type PostingVerdict = 'ok' | 'expirée' | 'suspecte';

/** Ce que la lecture de la page a donné. */
export interface PostingPage {
  /** Le lien de l'offre (celui du tableau). */
  url: string;
  /** Le statut HTTP de la réponse finale ; 0 si aucune réponse. */
  status: number;
  /** L'URL après redirections (`response.url`) ; vide ou égale à `url` sans redirection. */
  finalUrl: string;
  /** Le titre de la page, en texte. */
  title: string;
  /** Le texte visible de la page (`visibleText`). */
  text: string;
  /** Le jour où l'on lit, pour la date limite ; absent, la règle de la date limite ne joue pas. */
  now?: Date;
}

export interface PostingGuard {
  verdict: PostingVerdict;
  reasons: string[];
}

/** La page préparée une fois pour toutes les règles. */
export interface PreparedPage {
  url: string;
  finalUrl: string;
  status: number;
  /** Titre et texte nettoyés des caractères invisibles (`cleanPostingText`). */
  title: string;
  text: string;
  /** Les mêmes, repliés : minuscules, sans accents, apostrophes et espaces insécables normalisés. */
  foldedTitle: string;
  folded: string;
  /** Le texte brut, pour compter les caractères invisibles avant nettoyage. */
  raw: string;
  now: Date | null;
}

export interface PostingRule {
  id: string;
  verdict: Exclude<PostingVerdict, 'ok'>;
  /** La raison, en français, ou null quand la règle ne joue pas. */
  check: (page: PreparedPage) => string | null;
}

// ── Texte : nettoyage et repli ────────────────────────────────────────────────────────

// Adapté de ai-job-search/tools/posting_guard.py (MIT) : les mêmes familles de caractères.
const ZERO_WIDTH = '​‌‍⁠⁡⁢⁣⁤';
const BIDI = '‎‏‪‫‬‭‮⁦⁧⁨⁩';
/** Les forçages et isolements de sens : ce qui retourne un texte à l'affichage. */
const BIDI_TAMPER = '‭‮⁦⁧⁨⁩';
/** Trait d'union conditionnel, séparateurs de ligne et de paragraphe. */
const FORMAT = '­  ';
const BOM = '﻿';
const INVISIBLE = new Set([...ZERO_WIDTH, ...BIDI, ...FORMAT, BOM]);
const isTag = (codePoint: number): boolean => codePoint >= 0xe0000 && codePoint <= 0xe007f;
/**
 * Le seul usage légitime des caractères « tag » Unicode : les drapeaux d'Angleterre, d'Écosse
 * et du pays de Galles, gardés entiers. Adapté de posting_guard.py (`RGI_TAG_FLAG`, MIT).
 */
const RGI_TAG_FLAG = /\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}/gu;

function stripInvisible(piece: string): string {
  let out = '';
  for (const char of piece) {
    if (!INVISIBLE.has(char) && !isTag(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/**
 * Le texte sans ses caractères invisibles (zéro-largeur, contrôles de sens, trait d'union
 * conditionnel, BOM, caractères « tag »), drapeaux gallois, écossais et anglais gardés : ce que
 * l'agent doit lire. Un caractère « tag » rend une phrase invisible au lecteur et lisible par un
 * modèle ; un zéro-largeur au milieu d'un mot le fait passer sous les motifs.
 */
export function cleanPostingText(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(RGI_TAG_FLAG)) {
    out += stripInvisible(text.slice(last, match.index)) + match[0];
    last = (match.index ?? 0) + match[0].length;
  }
  return out + stripInvisible(text.slice(last));
}

/** Minuscules, sans accents, apostrophes typographiques et espaces insécables normalisés (longueur gardée pour un texte NFC). */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[   ]/g, ' ');
}

export function preparePage(page: PostingPage): PreparedPage {
  const title = cleanPostingText(page.title ?? '').normalize('NFC');
  const text = cleanPostingText(page.text ?? '').normalize('NFC');
  return {
    url: page.url ?? '',
    finalUrl: page.finalUrl ?? '',
    status: Number.isFinite(page.status) ? page.status : 0,
    title,
    text,
    foldedTitle: fold(title),
    folded: fold(text),
    raw: page.text ?? '',
    now: page.now ?? null,
  };
}

/** Un extrait court autour de `at`, entre guillemets français. */
function quote(source: string, at = 0, length = 0, max = 90): string {
  const flat = source.replace(/\s+/g, ' ');
  if (flat.length <= max) return `« ${flat.trim()} »`;
  const start = Math.max(0, Math.min(at - 20, flat.length - max));
  const end = Math.min(flat.length, Math.max(start + max, at + length));
  return `« ${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''} »`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** L'extrait pris dans le texte d'origine (accents, casse) quand le repli en a gardé la longueur, sinon dans le texte replié. */
function show(p: PreparedPage, at: number, length: number): string {
  return quote(p.text.length === p.folded.length ? p.text : p.folded, at, length);
}

/** Le premier motif qui joue, et son extrait (texte replié : minuscules, sans accents). */
function firstMatch(folded: string, patterns: readonly RegExp[]): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(folded);
    if (match) return match;
  }
  return null;
}

/**
 * Une négation autour de la correspondance : avant (« no application fee », « aucuns frais de
 * dossier »), ou juste après (« les frais de dossier sont pris en charge », « application fees
 * are never charged »).
 */
function negated(folded: string, at: number, length: number): boolean {
  if (/\b(no|not|never|without|free of|aucuns?|sans|pas de|jamais de|zero|0)\s*$/.test(folded.slice(Math.max(0, at - 18), at))) return true;
  return /^\s*(?:(?:ne |n')?(?:sont|est|seront|sera|are|is|will be)\s+)?(?:jamais|pas|pris(?:es)? en charge|offerts?|gratuits?|rembourses?|never|not|waived|covered|free|reimbursed|paid by)\b/.test(
    folded.slice(at + length, at + length + 40)
  );
}

// ── Expirée ───────────────────────────────────────────────────────────────────────────

/** Les derniers segments qui font une page de liste ou de recherche, pas une annonce. */
const LISTING_SEGMENTS = new Set([
  'jobs', 'job', 'emplois', 'emploi', 'offres', 'offre', 'offres-emploi', 'offres-d-emploi', 'offre-emploi', 'annonces',
  'careers', 'career', 'carrieres', 'carriere', 'recrutement', 'nous-rejoindre', 'join-us', 'search', 'recherche',
  'job-search', 'jobsearch', 'search-jobs', 'positions', 'openings', 'opportunities', 'vacancies', 'postes', 'results',
  'resultats', 'listing', 'listings',
]);
/** Un segment qui dit l'expiration ou l'absence, où qu'il soit dans le chemin. */
const EXPIRED_SEGMENT = /^(expired?|expiree|job-expired|offre-expiree|closed|job-closed|not-?found|page-not-found|404|410|unavailable|indisponible)$/;
/** Les clés de recherche dans une URL de liste. */
const SEARCH_KEYS = ['q', 'query', 'keywords', 'k', 'search', 'motscles', 'what', 'kw'];
/** Les marqueurs d'erreur dans la requête (Greenhouse renvoie vers le tableau de l'entreprise avec `?error=true`). */
const ERROR_KEYS = /^(error|expired|closed|job_closed|notfound|not_found|unavailable)$/;
/** Un mur de connexion n'est pas une expiration : la page existe peut-être derrière. */
const WALL = /(^|\/)(login|signin|sign-in|sign_in|authwall|connexion|checkpoint|uas|auth|sso)(\/|$)/;

function parseUrl(value: string): URL | null {
  try {
    return /^https?:\/\//i.test(value) ? new URL(value) : null;
  } catch {
    return null;
  }
}

const segmentsOf = (url: URL): string[] =>
  url.pathname
    .toLowerCase()
    .split('/')
    .filter((segment) => segment !== '');
const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '');
const isLanguage = (segment: string): boolean => /^[a-z]{2}(-[a-z]{2})?$/.test(segment);

/** Pourquoi la redirection `url → finalUrl` mène ailleurs que l'annonce, ou null. */
export function redirectReason(url: string, finalUrl: string): string | null {
  const from = parseUrl(url);
  const to = parseUrl(finalUrl);
  if (from === null || to === null) return null;
  const fromSegments = segmentsOf(from);
  const toSegments = segmentsOf(to);
  const where = `${hostOf(to)}${to.pathname}${to.search}`;
  if (WALL.test(to.pathname.toLowerCase())) return null;
  const sameHost = hostOf(from) === hostOf(to);
  const samePath = fromSegments.join('/') === toSegments.join('/');
  const errorKey = [...to.searchParams.keys()].find((key) => ERROR_KEYS.test(key.toLowerCase()) && !from.searchParams.has(key));
  if (errorKey !== undefined) return `la page redirige vers ${where}, qui porte le marqueur « ${errorKey} » : l'annonce n'y est plus`;
  if (samePath) return null;
  if (toSegments.some((segment) => EXPIRED_SEGMENT.test(segment))) return `la page redirige vers ${where}, une page d'annonce expirée ou introuvable`;
  if (toSegments.length === 0 || (toSegments.length === 1 && isLanguage(toSegments[0]!))) return `la page redirige vers l'accueil du site (${where}) au lieu de l'annonce`;
  if (sameHost && toSegments.length < fromSegments.length && toSegments.every((segment, i) => segment === fromSegments[i])) {
    return `la page redirige vers la page parente (${where}) au lieu de l'annonce`;
  }
  const searchKey = SEARCH_KEYS.find((key) => to.searchParams.has(key) && !from.searchParams.has(key));
  if (LISTING_SEGMENTS.has(toSegments[toSegments.length - 1]!) || searchKey !== undefined) {
    return `la page redirige vers une page de liste ou de recherche (${where}) au lieu de l'annonce`;
  }
  return null;
}

/** Une date future qui suit (« … closes le 30 novembre ») : un délai, pas une clôture. */
const NOT_A_DATE_AFTER = "(?!\\s+(le|au|a partir|des|d'ici|avant|on|by|at|in|from)\\b)";

/** Ce que dit une page d'annonce close. Sur le texte replié (minuscules, sans accents). */
export const CLOSED_PHRASES: readonly RegExp[] = [
  /\b(cette|l')\s?(offre|annonce)( d'emploi)? n'est plus (disponible|en ligne|active|accessible|valable)\b/,
  /\b(cette|l')\s?(offre|annonce)( d'emploi)? n'existe plus\b/,
  /\b(offre|annonce)( d'emploi)? expiree\b/,
  /\b(offre|annonce)( d'emploi)? (a|est) (expire|expiree)\b/,
  /\b(cette |l')?(offre|annonce)( d'emploi)? a ete (pourvue|retiree|supprimee|desactivee|cloturee)\b/,
  /\b(le )?poste (est )?(deja )?pourvu\b/,
  /\b(cette )?offre (est )?(cloturee|fermee)\b/,
  /\b(offre|annonce) introuvable\b/,
  new RegExp(`\\bles candidatures (sont|ont ete) (closes|cloturees|fermees)${NOT_A_DATE_AFTER}`),
  /\bn'accepte plus (de |les )?candidatures\b/,
  /\bno longer accepting applications\b/,
  /\b(this|the) (job|position|role|posting|vacancy|opening|job posting|job listing|job ad)( you are looking for)? (has|is) (now )?expired\b/,
  /\b(this|the) (job|position|role|posting|vacancy|opening|job posting|job listing)( you are looking for)? is no longer (available|open|active|accepting applications|accepting candidates)\b/,
  /\b(this|the) (job|position|role|vacancy) has (already )?been filled\b/,
  /\b(this|the) (job|position|role|posting|job posting) (is|has been) (now )?closed\b/,
  new RegExp(`\\bapplications (are|have) (now )?closed${NOT_A_DATE_AFTER}`),
  /\bthe (job|page|posting) you (are|were|re) looking for (is no longer available|no longer exists|could not be found|can't be found|cannot be found|has expired)\b/,
  /\b(this|the) (job|posting|position) (does not|doesn't|no longer) exists?\b/,
  /\b(job|posting|position) not found\b/,
];

/** Un titre de page introuvable (une « 404 molle » : la page répond 200 mais dit l'absence). */
const NOT_FOUND_TITLE = /\b(page (introuvable|non trouvee|inexistante)|page not found|not found|introuvable|erreur 404|error 404|404)\b/;

// La date limite : « date limite de candidature : 15/09/2026 », « apply by September 15, 2026 ».
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DEADLINE_LEAD =
  "(?:date limite(?: de (?:candidature|depot|reponse))?|cloture des candidatures|fin des candidatures|candidatures? jusqu'au|postuler (?:avant|jusqu'au)(?: le)?|a pourvoir avant le|application deadline|closing date|apply (?:by|before)|applications? close[sd]?(?: on)?|deadline(?: to apply)?)";
const DEADLINE = new RegExp(
  `${DEADLINE_LEAD}\\s*:?\\s*(?:le |on |the |au )?(?:(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})|(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})(?:er|st|nd|rd|th)? (${MONTH_NAMES})\\.? (\\d{4})|(${MONTH_NAMES})\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4}))`,
  'g'
);

const utcDay = (y: number, m: number, d: number): number | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const time = Date.UTC(y, m - 1, d);
  return new Date(time).getUTCDate() === d ? time : null;
};

/** Les lectures possibles de la date (jj/mm et mm/jj quand les deux sont des mois). */
function deadlineDays(match: RegExpExecArray): number[] {
  const n = (i: number): number => Number(match[i]);
  if (match[1] !== undefined) {
    const readings = [utcDay(n(3), n(2), n(1)), utcDay(n(3), n(1), n(2))];
    // jj/mm d'abord (annonces françaises) ; mm/jj seulement s'il est possible lui aussi.
    return readings.filter((day): day is number => day !== null);
  }
  if (match[4] !== undefined) return [utcDay(n(4), n(5), n(6))].filter((day): day is number => day !== null);
  if (match[7] !== undefined) return [utcDay(n(9), MONTHS[match[8]!]!, n(7))].filter((day): day is number => day !== null);
  return [utcDay(n(12), MONTHS[match[10]!]!, n(11))].filter((day): day is number => day !== null);
}

/** La date limite passée, ou null (sans date du jour, sans date lisible, ou date ambiguë dont une lecture n'est pas passée). */
export function deadlineReason(folded: string, now: Date | null): string | null {
  if (now === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const match of folded.matchAll(DEADLINE)) {
    const days = deadlineDays(match);
    if (days.length > 0 && days.every((day) => day < today)) {
      return `la date limite de candidature est passée (${quote(folded, match.index ?? 0, match[0].length)})`;
    }
  }
  return null;
}

// ── Suspecte ──────────────────────────────────────────────────────────────────────────

/** De l'argent demandé au candidat. Sur le texte replié ; une négation juste avant annule. */
// Jamais un verbe seul (« vous devrez acheter des espaces publicitaires », « régler les
// litiges ») ni un avantage (« cartes cadeaux », « training fees covered ») : un montant, des
// frais ou un kit à la charge du candidat.
const PAYMENT: readonly RegExp[] = [
  /\bfrais (d'inscription|de dossier|d'adhesion|de candidature|d'ouverture de dossier)\b/g,
  /\bformation (payante|a (vos|tes) frais|a (votre|ta) charge)\b/g,
  /\b(vous|tu) (devez|devrez|devriez|dois|devras|aurez a|auras a) (payer|verser|avancer|acheter|financer) (vous-meme |toi-meme )?(des |les |une |un |la |le |votre |ton |vos |tes )?(frais|somme|montant|caution|cotisation|participation|acompte|droits? d'entree|kit|pack|materiel|formation|stock)\b/g,
  /\b(paiement|versement|cheque) (initial|prealable|d'avance|obligatoire)\b/g,
  /\b(mandat cash|transcash|coupons? pcs)\b/g,
  /\b(registration|application|processing|onboarding|placement|enrollment|enrolment|starter kit) fees?\b/g,
  /\byou(?: will|'ll)? (?:need|have|must|are required) to (?:pay|purchase|buy|deposit) (?:for )?(?:a |an |the |your )?(?:fee|deposit|kit|starter kit|training|course|equipment|license|licence|background check|registration)\b/g,
  /\b(upfront|up-front|advance) (payment|fee|deposit)\b/g,
];

/** Le contact passe par une messagerie (WhatsApp, Telegram…) plutôt que par l'employeur. */
const MESSAGING_LINK = /\b(t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|api\.whatsapp\.com)\/\S*/;
const MESSAGING_APPS = '(whatsapp|telegram|signal|wechat|viber)';
// Un verbe de contact adressé au candidat, puis « sur / via / par » l'application : jamais le
// nom seul (« campagnes WhatsApp », « bots Telegram » sont des métiers du growth).
const CONTACT_VERBS =
  '(contactez(-nous|-moi)?|contacter (le recruteur|nous|moi)|ecrivez(-nous|-moi)?|envoyez(-nous|-moi)? (votre|ton) (cv|candidature)|joignez(-nous|-moi)?|postulez|candidatez|contact (us|me|the recruiter|hr)|reach (us|me|out)|text (us|me)|message (us|me)|dm (us|me)|send (us |me )?your (cv|resume|application))';
const MESSAGING_CONTACT: readonly RegExp[] = [
  new RegExp(`\\b${CONTACT_VERBS}[^.\\n]{0,20}?\\b(via|sur|par|on|through|by|au|over|using)\\s+(?:l'app(?:lication)? |the app )?${MESSAGING_APPS}\\b`),
  new RegExp(`\\bapply (via|on|through|by|over|using) ${MESSAGING_APPS}\\b`),
  new RegExp(`\\b${MESSAGING_APPS}\\s*(:|au|at|\\(|-)?\\s*(\\+\\d|00\\d|0\\d)(?:[ .-]?\\d){7,}`),
  new RegExp(`\\b(telegram|signal)\\s*:?\\s*@\\w{3,}`),
];

/** Les messageries personnelles : une adresse de recrutement n'y est pas chez l'employeur. */
const WEBMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'ymail.com', 'aol.com', 'aol.fr', 'icloud.com', 'me.com', 'mac.com', 'msn.com', 'proton.me',
  'protonmail.com', 'pm.me', 'laposte.net', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr', 'bbox.fr', 'numericable.fr',
  'mail.ru', 'yandex.ru', 'yandex.com', 'gmx.com', 'gmx.fr', 'gmx.de', 'gmx.net', 'web.de', 'tutanota.com', 'zoho.com',
]);
const WEBMAIL_FAMILIES = /^(yahoo|hotmail|outlook|live|gmx)\.[a-z.]{2,6}$/;
const EMAIL = /[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,})\b/g;

/** Crypto-actifs ou « investissement » avec promesse de gains ; vente en réseau. */
const NETWORK_SELLING = /\b(marketing de reseau|vente (en reseau|multi-?niveaux?)|network marketing|multi-level marketing|mlm|revenus? passifs?|passive income|soyez votre propre patron|be your own boss|liberte financiere|financial freedom|options binaires|binary options|investissement (initial|de depart)|initial investment)\b/;
const CRYPTO = /\b(crypto(-?monnaies?|-?actifs?|currenc(y|ies)|s)?|bitcoins?|ethereum|forex|trading (de|en) (devises|crypto\w*)|nft)\b/;
const GAINS = /\b(investi(r|ssez|ssement|ssements|sseurs?)|invest(ing|ment|ments|ors?)?|rendements?|gains?|profits?|returns?|revenus?|income|earn(ings)?|gagne[rz]?|commissions?)\b/;

/** Un poste ouvert sans expérience, et la paie qui va avec. */
const NO_EXPERIENCE = /\b(sans experience|aucune experience|pas besoin d'experience|pas d'experience (requise|necessaire|exigee)|debutants? acceptes?|no (prior |previous )?experience|experience not required)\b/;
const EASY_MONEY = /\b(argent facile|gains? rapides?|devenez riche|easy money|quick money|get rich|fast cash|revenus? illimites?|unlimited (income|earnings))\b/;
// Un montant avec sa devise (avant ou après) et sa période : « 1 500 € par semaine »,
// « $5,000 per week », « 80k€/an ». Sans devise, ce sont des heures (« 35 h par semaine »).
const PAY = new RegExp(
  "(?:(?<pre>€|\\$|£)|\\b(?<preWord>eur|usd|gbp)\\b)?\\s*(?<num>\\d{1,3}(?:[ .,']\\d{3})+|\\d+)(?:[.,]\\d{1,2})?\\s*(?<k>k)?\\s*(?<post>€|\\$|£|\\b(?:euros?|eur|usd|dollars?|gbp|livres?)\\b)?\\s*(?:bruts?\\s*|nets?\\s*)?(?:/|\\bpar\\b|\\bper\\b|a l'|\\ba la\\b|\\bla\\b|\\ble\\b|\\ban\\b|\\beach\\b|\\bchaque\\b|\\bevery\\b|\\bby the\\b|\\ba\\b)?\\s*(?<unit>heures?|h|hours?|hr|jours?|days?|semaines?|weeks?|wk|mois|months?|an|annee|years?|yr|annum)\\b",
  'g'
);
/** Mois de travail par unité : un équivalent mensuel, comparé à UNREALISTIC_MONTHLY. */
const PER_MONTH: [RegExp, number][] = [
  [/^(heures?|h|hours?|hr)$/, 151.67],
  [/^(jours?|days?)$/, 21.67],
  [/^(semaines?|weeks?|wk)$/, 4.33],
  [/^(mois|months?)$/, 1],
  [/^(an|annee|years?|yr|annum)$/, 1 / 12],
];
/** Au-dessus de 5 000 par mois, sans expérience demandée : pas un salaire de débutant. */
export const UNREALISTIC_MONTHLY = 5000;

/** Le premier montant payé trop haut (lu dans le texte replié), tel que l'annonce l'écrit. */
function highPay(p: PreparedPage): string | null {
  const source = p.text.length === p.folded.length ? p.text : p.folded;
  for (const match of p.folded.matchAll(PAY)) {
    const g = match.groups ?? {};
    if (g.pre === undefined && g.preWord === undefined && g.post === undefined) continue; // pas de devise : des heures, pas de l'argent
    const amount = Number((g.num ?? '').replace(/[ .,']/g, '')) * (g.k ? 1000 : 1);
    const unit = PER_MONTH.find(([pattern]) => pattern.test(g.unit ?? ''));
    if (unit && amount * unit[1] >= UNREALISTIC_MONTHLY) return source.slice(match.index ?? 0, (match.index ?? 0) + match[0].length).trim();
  }
  return null;
}

/**
 * Les lignes qui s'adressent à un agent plutôt qu'au lecteur. Adapté de
 * ai-job-search/tools/posting_guard.py (`INSTRUCTION_PATTERNS`, MIT) : mêmes formes anglaises,
 * sauf curl/wget/ssh/scp et `.env` (des compétences dans une annonce technique), plus leurs
 * équivalents français (« ignorez les instructions précédentes »…), jamais « vous êtes un
 * assistant » ni « agent » (des métiers). Appliquées ligne à ligne au texte replié.
 */
export const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all|any|the|previous|prior|above|earlier)\b/,
  /\b(disregard|forget)( all| any| the| your| my)? (previous|prior|above|earlier|preceding|initial|original|system) (instructions?|prompts?)\b/,
  /\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b/,
  /\bsystem prompt\b/,
  /\b(do not|don'?t|never) (tell|inform) the user\b(?!'s)/,
  /\b(do not|don'?t|never) (mention|reveal|disclose) (this|these|that|it|any of this|the (above|following|previous))\b[^.\n]{0,30}\bto the user\b/,
  /\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b/,
  /\bas an ai(?![\w-])(?![\s/&]+(?:[\w&/-]+\s+){0,3}?(?:engineer|developer|researcher|scientist|architect|specialist|lead|consultant|manager|analyst|intern|trainer|expert|strategist|designer|tester|owner|programmer)s?\b)/,
  /^\s*(assistant|system|user)\s*:/,
  /<\|/,
  /\[inst\]/,
  /###\s*(system|instruction)/,
  /settings\.json/,
  /allowed-tools/,
  /\btool_use\b|\bfunction_call\b/,
  /\bignore[rz]? (toutes |tes |vos |les |toutes les )?(instructions|consignes) (precedentes|anterieures|ci-dessus)\b/,
  /\b(oublie[rz]?|ne tenez (pas )?compte des?|ne tiens (pas )?compte des?) (toutes )?(les |tes |vos )?(instructions|consignes) (precedentes|anterieures|ci-dessus)\b/,
  /\b(tu es|vous etes) (une? |l')(ia|intelligence artificielle|modele de langage|llm)\b/,
  /\bne (dis|dites|mentionne[sz]?|revele[sz]?) (rien|pas|jamais)\b[^.\n]{0,30}\ba l'utilisateur\b/,
  /\bprompt systeme\b/,
  /\b(execute[rz]?|lance[rz]?) (la|les) commandes? suivantes?\b/,
];

/** Les comptes des caractères invisibles du texte brut. Adapté de posting_guard.py (`clean_text`, MIT). */
export function invisibleFindings(raw: string): { tags: number; flagged: number } {
  const tags = [...raw.replace(RGI_TAG_FLAG, '')].filter((char) => isTag(char.codePointAt(0) ?? 0)).length;
  const chars = [...raw];
  let flagged = 0;
  const letter = (char: string | undefined): boolean => char !== undefined && /\p{L}/u.test(char);
  chars.forEach((char, i) => {
    if (BIDI_TAMPER.includes(char)) flagged += 1;
    else if ((ZERO_WIDTH.includes(char) || char === BOM) && letter(chars[i - 1]) && letter(chars[i + 1])) flagged += 1;
  });
  return { tags, flagged };
}

/** Les mots qui mêlent lettres latines et cyrilliques ou grecques. Adapté de posting_guard.py (`scan`, MIT). */
export function mixedScriptWords(text: string): string[] {
  const words: string[] = [];
  for (const [word] of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (/[A-Za-z]/.test(word) && /[Ͱ-ϿЀ-ӿ]/.test(word) && !words.includes(word)) words.push(word);
  }
  return words;
}

// ── Les règles ────────────────────────────────────────────────────────────────────────

export const POSTING_RULES: readonly PostingRule[] = [
  {
    id: 'page-disparue',
    verdict: 'expirée',
    check: (p) =>
      p.status === 410
        ? "la page répond 410 (Gone) : l'annonce a été retirée"
        : p.status === 404
          ? "la page répond 404 : l'annonce n'existe plus, ou le lien est cassé (/valider la remet en file si elle vit encore ailleurs)"
          : null,
  },
  { id: 'redirection-liste', verdict: 'expirée', check: (p) => (p.finalUrl === '' || p.finalUrl === p.url ? null : redirectReason(p.url, p.finalUrl)) },
  {
    id: 'annonce-close',
    verdict: 'expirée',
    check: (p) => {
      const match = firstMatch(`${p.foldedTitle}\n${p.folded}`, CLOSED_PHRASES);
      return match ? `la page dit « ${match[0]} »` : null;
    },
  },
  {
    id: 'titre-introuvable',
    verdict: 'expirée',
    check: (p) => (NOT_FOUND_TITLE.test(p.foldedTitle) ? `le titre de la page est « ${p.title.trim()} » : page introuvable` : null),
  },
  { id: 'date-limite-passee', verdict: 'expirée', check: (p) => deadlineReason(p.folded, p.now) },
  {
    id: 'paiement-demande',
    verdict: 'suspecte',
    check: (p) => {
      for (const pattern of PAYMENT) {
        for (const match of p.folded.matchAll(pattern)) {
          if (!negated(p.folded, match.index ?? 0, match[0].length)) return `de l'argent est demandé au candidat (${show(p, match.index ?? 0, match[0].length)})`;
        }
      }
      return null;
    },
  },
  {
    id: 'contact-messagerie',
    verdict: 'suspecte',
    check: (p) => {
      const match = MESSAGING_LINK.exec(p.folded) ?? firstMatch(p.folded, MESSAGING_CONTACT);
      return match ? `le contact passe par une messagerie (WhatsApp, Telegram…) plutôt que par l'employeur (${show(p, match.index, match[0].length)})` : null;
    },
  },
  {
    id: 'messagerie-personnelle',
    verdict: 'suspecte',
    check: (p) => {
      const domains = [...p.folded.matchAll(EMAIL)].map((match) => match[1]!).filter((domain) => WEBMAIL_DOMAINS.has(domain) || WEBMAIL_FAMILIES.test(domain));
      return domains.length > 0 ? `l'adresse de contact est une messagerie personnelle (@${[...new Set(domains)].join(', @')}), pas celle de l'employeur` : null;
    },
  },
  {
    id: 'crypto-investissement',
    verdict: 'suspecte',
    check: (p) => {
      const selling = NETWORK_SELLING.exec(p.folded);
      if (selling) return `vente en réseau ou investissement demandé (${show(p, selling.index, selling[0].length)})`;
      const crypto = CRYPTO.exec(p.folded);
      const gains = GAINS.exec(p.folded);
      return crypto && gains ? `crypto-actifs et promesse de gains ou d'investissement (« ${crypto[0]} », « ${gains[0]} ») : vérifier l'employeur` : null;
    },
  },
  {
    id: 'salaire-irrealiste',
    verdict: 'suspecte',
    check: (p) => {
      const none = NO_EXPERIENCE.exec(p.folded);
      if (!none) return null;
      const pay = highPay(p) ?? EASY_MONEY.exec(p.folded)?.[0] ?? null;
      const source = p.text.length === p.folded.length ? p.text : p.folded;
      return pay ? `paie irréaliste pour un poste sans expérience (« ${pay} », « ${source.slice(none.index, none.index + none[0].length)} »)` : null;
    },
  },
  {
    id: 'consignes-agent',
    verdict: 'suspecte',
    check: (p) => {
      const lines: string[] = [];
      const original = p.text.split('\n');
      fold(p.text)
        .split('\n')
        .forEach((line, i) => {
          const match = firstMatch(line.trim(), INSTRUCTION_PATTERNS);
          if (match && lines.length < 3) lines.push(quote((original[i] ?? line).trim(), match.index, match[0].length, 120));
        });
      return lines.length > 0 ? `ligne écrite pour un agent, pas pour le lecteur : ${lines.join(' ; ')}` : null;
    },
  },
  {
    id: 'caracteres-invisibles',
    verdict: 'suspecte',
    check: (p) => {
      const { tags, flagged } = invisibleFindings(p.raw);
      const parts: string[] = [];
      if (tags > 0) parts.push(`${plural(tags, 'caractère « tag » Unicode', 'caractères « tag » Unicode')} (du texte invisible au lecteur, lisible par un agent)`);
      if (flagged > 0) parts.push(plural(flagged, 'caractère invisible qui coupe un mot ou retourne le texte', 'caractères invisibles qui coupent des mots ou retournent le texte'));
      return parts.length > 0 ? `${parts.join(', ')} ; l'agent lit le texte sans eux` : null;
    },
  },
  {
    id: 'alphabets-meles',
    verdict: 'suspecte',
    check: (p) => {
      const words = mixedScriptWords(`${p.title}\n${p.text}`);
      return words.length > 0 ? `${plural(words.length, 'mot mêle', 'mots mêlent')} lettres latines et cyrilliques ou grecques (sosies) : ${words.slice(0, 3).map((word) => `« ${word} »`).join(', ')}` : null;
    },
  },
];

/**
 * Le verdict de la garde sur une page d'annonce lue. `expirée` l'emporte (seules ses raisons
 * sont rendues) ; sinon `suspecte` avec chaque signal ; sinon `ok`, sans raison. Une page qui
 * n'a pas répondu (status 0) ou n'a rien dit ne rend jamais `expirée` : faute de preuve, `ok`.
 */
export function guardPosting(page: PostingPage): PostingGuard {
  const prepared = preparePage(page);
  const reasons = (verdict: PostingRule['verdict']): string[] =>
    POSTING_RULES.filter((rule) => rule.verdict === verdict)
      .map((rule) => rule.check(prepared))
      .filter((reason): reason is string => reason !== null);
  const expired = reasons('expirée');
  if (expired.length > 0) return { verdict: 'expirée', reasons: expired };
  const suspicious = reasons('suspecte');
  if (suspicious.length > 0) return { verdict: 'suspecte', reasons: suspicious };
  return { verdict: 'ok', reasons: [] };
}
