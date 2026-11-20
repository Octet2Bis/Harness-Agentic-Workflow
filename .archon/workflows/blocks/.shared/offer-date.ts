/**
 * La date de publication d'une offre, quelle que soit la forme que lui donne la source, et la
 * règle d'âge du candidat (`offre_age_max_jours` de `criteres.json`, 7 jours par défaut :
 * « on doit aussi récupérer que des offres qui datent d'il y a maximum 1 semaine », Antoine,
 * 2026-10-23). Pur, testé par `offer-date.test.ts` ; lu par le crible du radar
 * (`systems/.shared/radar.ts` `screenJobs`) et par le tri (`triage-checks.ts` `decideTriage`).
 *
 * Formes lues (`parseOfferDate`) : ISO (`2026-10-23`, `2026-10-23T07:09:57+00:00`), epoch en
 * secondes ou en millisecondes (nombre ou chaîne de 9 à 13 chiffres), RFC 2822 des flux RSS
 * (`Fri, 23 Oct 2026 10:00:00 +0000`, `Fri, 23 Oct 2026`), et les dates relatives des pages
 * (« 3 days ago », « an hour ago », « 2 weeks ago », « 30+ days ago », « today », « yesterday »,
 * « < 24h », « il y a 3 jours », « il y a une semaine », « il y a plus de 30 jours »,
 * « aujourd'hui », « hier », « avant-hier », « à l'instant »), comptées depuis `anchor` (le moment
 * où la page a été lue, sinon maintenant). Mois = 30 jours, an = 365. Tout le reste : null — une
 * offre sans date lisible n'est jamais écartée pour son âge (rien d'inventé).
 *
 * L'âge se compte en jours de calendrier UTC : publiée le 16 pour un crible le 23, 7 jours,
 * gardée avec 7 ; le 15, 8 jours, écartée.
 */

/** Le défaut d'`offre_age_max_jours` quand la clé manque. */
export const DEFAULT_OFFER_AGE_MAX_DAYS = 7;

/**
 * Les offres lues sur le site ou le tableau de l'employeur (Greenhouse, Lever, Ashby en direct, postes des
 * entreprises full remote, Apify ATS, Workable, Freehire, Jobdatalake : des pages carrières) n'ont pas de
 * limite d'âge (Antoine, 2026-11-14 : « si elle est affichée sur le site, c'est qu'il y a ou a eu un intérêt,
 * c'est une opportunité ») ; l'âge reste affiché dans le cockpit. Les sites d'emploi gardent `offre_age_max_jours`.
 */
export function employerBoardSource(source: unknown): boolean {
  return typeof source === 'string' && /^(Tableaux employeurs|Entreprise full remote|Apify ATS|Workable|Freehire|Jobdatalake)/i.test(source.trim());
}
/** La limite d'âge d'une offre selon sa source : `days` pour un site d'emploi, aucune (0) pour le site de l'employeur. */
export function ageLimitFor(source: unknown, days: number): number {
  return employerBoardSource(source) ? 0 : days;
}

const DAY_MS = 86_400_000;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function plausible(d: Date): Date | null {
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR ? d : null;
}

function fromEpoch(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return plausible(new Date(n >= 1e12 ? n : n * 1000));
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Le nombre d'une date relative : chiffres, ou « a / an / un / une » (1). */
function count(word: string): number {
  return /^\d+$/.test(word) ? Number(word) : 1;
}

const UNIT_MS: [RegExp, number][] = [
  [/^(s|sec|secs|second|seconds|seconde|secondes)$/, 1000],
  [/^(m|min|mins|minute|minutes)$/, 60_000],
  [/^(h|hr|hrs|hour|hours|heure|heures)$/, 3_600_000],
  [/^(d|j|day|days|jour|jours)$/, DAY_MS],
  [/^(w|wk|wks|week|weeks|semaine|semaines|sem)$/, 7 * DAY_MS],
  [/^(mo|month|months|mois)$/, 30 * DAY_MS],
  [/^(y|yr|yrs|year|years|an|ans|annee|annees)$/, 365 * DAY_MS],
];

function unitMs(unit: string): number | null {
  for (const [re, ms] of UNIT_MS) if (re.test(unit)) return ms;
  return null;
}

/** Une date relative (anglais ou français), comptée depuis `anchor`, ou null. */
export function parseRelativeDate(text: string, anchor: Date): Date | null {
  const s = fold(text).replace(/^(posted|publiee?|published|reposted|mise? en ligne)\s*:?\s*/, '');
  if (s === '') return null;
  const back = (ms: number): Date => new Date(anchor.getTime() - ms);
  if (/^(just now|a l'instant|maintenant|now|today|aujourd'hui|aujourd hui)\b/.test(s)) return back(0);
  if (/^(yesterday|hier)\b/.test(s)) return back(DAY_MS);
  if (/^avant-hier\b/.test(s)) return back(2 * DAY_MS);
  // « < 24h (filtre LinkedIn) », « last 24 hours » : une borne, pas un âge (compté 0) ; « 3h » : il y a 3 heures.
  const hours = /^(<\s*|less than |moins de |last |past |within )?(\d+)\s*h(?:ours?|eures?|rs?)?\b(?! ago)/.exec(s);
  if (hours) return back(hours[1] ? 0 : Number(hours[2]) * 3_600_000);
  const n = String.raw`(\d+|an?|une?)\s*\+?`;
  const unit = String.raw`([a-z]+)`;
  const en = new RegExp(String.raw`^(?:over |more than )?${n}\s*${unit}\s+ago\b`).exec(s);
  const fr = new RegExp(String.raw`^il y a (?:plus d'|plus de |environ )?${n}\s*${unit}\b`).exec(s);
  const m = en ?? fr;
  if (!m) return null;
  const ms = unitMs(m[2]!);
  return ms === null ? null : back(count(m[1]!) * ms);
}

const RFC_2822 = /^(?:[a-z]{3},?\s+)?\d{1,2}\s+[a-z]{3,9}\.?\s+\d{4}\b/i;
const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * La date d'une offre, ou null quand rien de lisible n'y est. `anchor` : le moment de lecture
 * de la page, pour les dates relatives (défaut : maintenant).
 */
export function parseOfferDate(value: unknown, anchor: Date = new Date()): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return fromEpoch(value);
  if (value instanceof Date) return plausible(value);
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;
  if (/^\d{9,13}$/.test(s)) return fromEpoch(Number(s));
  if (ISO.test(s)) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T');
    return plausible(new Date(day));
  }
  if (RFC_2822.test(s)) {
    // « Fri, 23 Oct 2026 » sans heure : minuit UTC, pas minuit local.
    const withZone = /\d{1,2}:\d{2}/.test(s) ? s : `${s} 00:00:00 GMT`;
    return plausible(new Date(withZone));
  }
  return parseRelativeDate(s, anchor);
}

/** `AAAA-MM-JJ` (UTC). */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

export interface OfferAge {
  /** La date de publication, `AAAA-MM-JJ`. */
  day: string;
  /** Jours de calendrier entre la publication et `now` (négatif : date future). */
  days: number;
}

/** L'âge d'une offre, ou null sans date lisible. */
export function offerAge(value: unknown, now: Date = new Date(), anchor: Date = now): OfferAge | null {
  const d = parseOfferDate(value, anchor);
  if (d === null) return null;
  return { day: isoDay(d), days: utcDay(now) - utcDay(d) };
}

/** La raison d'un refus pour âge, la même au radar et au tri. */
export function tooOldReason(day: string, maxDays: number): string {
  return `offre trop ancienne (publiée le ${day}, > ${maxDays} jours)`;
}

/**
 * La raison du refus quand l'offre a plus de `maxDays` jours, sinon null (date illisible, date
 * future, ou `maxDays` ≤ 0 : règle coupée).
 */
export function tooOld(value: unknown, maxDays: number, now: Date = new Date(), anchor: Date = now): string | null {
  if (!(maxDays > 0)) return null;
  const age = offerAge(value, now, anchor);
  return age !== null && age.days > maxDays ? tooOldReason(age.day, maxDays) : null;
}

/**
 * `offre_age_max_jours` de `criteres.json` (déjà parsé) : entier ≥ 0 ; absent ou null :
 * `DEFAULT_OFFER_AGE_MAX_DAYS` ; 0 coupe la règle. Une autre valeur est un problème, et le
 * défaut s'applique.
 */
export function readOfferAgeMaxDays(criteria: unknown): { days: number; problem: string | null } {
  const raw = criteria !== null && typeof criteria === 'object' && !Array.isArray(criteria) ? (criteria as Record<string, unknown>).offre_age_max_jours : undefined;
  if (raw === undefined || raw === null) return { days: DEFAULT_OFFER_AGE_MAX_DAYS, problem: null };
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return { days: raw, problem: null };
  return { days: DEFAULT_OFFER_AGE_MAX_DAYS, problem: `criteres.json: "offre_age_max_jours" must be an integer (days; ${DEFAULT_OFFER_AGE_MAX_DAYS} when absent, 0 disables the rule)` };
}
