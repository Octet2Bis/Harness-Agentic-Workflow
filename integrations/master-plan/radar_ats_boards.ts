/**
 * Spécification exécutable, sans réseau, de deux pistes de `radar_sources.proposal.md` :
 *
 *   (a) une ligne par offre, pas une par pays : `groupByCountry` replie les annonces d'une même
 *       entreprise au même intitulé (Smartness ×4, Darkroom ×4 sur le tableau du 22 octobre) ;
 *   (c) les pages carrières des entreprises vérifiées (`verified_remote_companies.json`,
 *       `careers_url`) lues par l'API JSON publique de leur ATS quand c'est Greenhouse, Lever,
 *       Ashby, Workable, Recruitee ou SmartRecruiters : `atsEndpoint` dit quelle URL appeler,
 *       `parseGreenhouse`, `parseLever`, `parseAshby`, `parseWorkable`, `parseRecruitee`,
 *       `parseSmartRecruiters` rendent des offres aux champs du tableau, lien de l'employeur
 *       compris. Les trois derniers sont écrits d'après la documentation seule (aucun appel
 *       réseau possible ici) : leur forme est à confirmer sur une vraie réponse.
 *
 * `matchesTarget` est le filtre `matchesAnyTargetQuery` de `career_ops/fetchers/index.js`
 * (copie PC du 22 octobre), réécrit à l'identique pour montrer dans les tests qu'il est déjà
 * large : ce n'est pas lui qui retient les offres des sources non-LinkedIn.
 *
 * Rien ici n'est appelé par le radar : c'est ce qu'il faudrait y brancher, testé sur des
 * réponses écrites à la main dans la forme publique de chaque API (`test/*.sample.json`).
 */

import { hostOf, platformFor } from '../../.archon/workflows/blocks/.shared/platforms.ts';
import { DESCRIPTION_MAX, decodeEntities, linkKey, slugPart, titleKey } from './radar_freehire.ts';

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'recruitee' | 'smartrecruiters';

/** L'API publique à appeler pour une page carrières, ou null (ATS non couvert, URL sans jeton). */
export interface AtsEndpoint {
  ats: Ats;
  /** Le jeton de la page : `circleci` dans boards.greenhouse.io/circleci, `mistral` dans jobs.lever.co/mistral, `balena` dans balena.workable.com. */
  token: string;
  endpoint: string;
}

/** La taille d'une page SmartRecruiters (`?limit=`) ; l'API pagine par `offset` et annonce `totalFound`. */
export const SMARTRECRUITERS_PAGE = 100;

/** Une offre aux champs du tableau (avant le jury), venue d'une page carrières. */
export interface AtsCandidate {
  id: string;
  slug: string;
  company: string;
  title: string;
  link: string;
  source: string;
  location: string;
  remote_declared: boolean;
  description: string;
  skills_required: string;
  salary_range: string;
  date_published: string;
  found_at: string;
  ats: { ats: Ats; token: string; external_id: string; department: string; employment_type: string };
}

/** Une ligne du tableau après repli par pays : la première annonce, et toutes ses variantes. */
export interface GroupedCandidate extends AtsCandidate {
  locations: string[];
  variants: { id: string; link: string; location: string; date_published: string }[];
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Le premier segment du chemin, le jeton de la page carrières ; vide s'il n'y en a pas. */
function firstSegment(url: string): string {
  try {
    const segment = new URL(url).pathname.split('/').filter((part) => part !== '')[0] ?? '';
    return /^[A-Za-z0-9._-]+$/.test(segment) ? segment : '';
  } catch {
    return '';
  }
}

/**
 * Le sous-domaine d'une page carrières hébergée sous l'apex de l'ATS : `balena` dans
 * balena.workable.com, `astronomer` dans astronomer.recruitee.com. Vide pour l'apex nu, pour un
 * hôte à plusieurs niveaux et pour les sous-domaines de la plateforme elle-même (`apply`, `jobs`).
 */
function subdomainOf(host: string, apex: string, reserved: string[]): string {
  if (!host.endsWith(`.${apex}`)) return '';
  const label = host.slice(0, -apex.length - 1);
  return /^[a-z0-9-]+$/.test(label) && !reserved.includes(label) ? label : '';
}

/**
 * Greenhouse : `boards.greenhouse.io/<token>` (ou `job-boards.`, `.eu.`) →
 * `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` (texte des annonces compris).
 * Lever : `jobs.lever.co/<company>` → `api.lever.co/v0/postings/<company>?mode=json`.
 * Ashby : `jobs.ashbyhq.com/<org>` → `api.ashbyhq.com/posting-api/job-board/<org>`.
 * Workable : `apply.workable.com/<slug>` ou `<slug>.workable.com` →
 * `apply.workable.com/api/v1/widget/accounts/<slug>?details=true` (`jobs.workable.com`, l'agrégateur
 * de Workable, n'est pas une page d'entreprise : null).
 * Recruitee : `<company>.recruitee.com` → `<company>.recruitee.com/api/offers/`.
 * SmartRecruiters : `jobs.smartrecruiters.com/<company>` (ou `careers.`) →
 * `api.smartrecruiters.com/v1/companies/<company>/postings?limit=100&offset=0` (première page).
 * Les autres ATS (Teamtailor, Personio, Workday…) et les pages maison : null.
 */
export function atsEndpoint(careersUrl: string): AtsEndpoint | null {
  const host = hostOf(careersUrl);
  const workableSlug = subdomainOf(host, 'workable.com', ['apply', 'jobs']);
  if (workableSlug !== '') return { ats: 'workable', token: workableSlug, endpoint: `https://apply.workable.com/api/v1/widget/accounts/${workableSlug}?details=true` };
  const platform = platformFor(careersUrl);
  if (platform === null) return null;
  if (platform.id === 'recruitee') {
    const company = subdomainOf(host, 'recruitee.com', ['jobs', 'careers', 'app', 'api']);
    return company === '' ? null : { ats: 'recruitee', token: company, endpoint: `https://${company}.recruitee.com/api/offers/` };
  }
  const token = firstSegment(careersUrl);
  if (token === '') return null;
  switch (platform.id) {
    case 'greenhouse': {
      const api = host.includes('.eu.') ? 'boards-api.eu.greenhouse.io' : 'boards-api.greenhouse.io';
      return { ats: 'greenhouse', token, endpoint: `https://${api}/v1/boards/${token}/jobs?content=true` };
    }
    case 'lever': {
      const api = host.startsWith('jobs.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
      return { ats: 'lever', token, endpoint: `https://${api}/v0/postings/${token}?mode=json` };
    }
    case 'ashby':
      return { ats: 'ashby', token, endpoint: `https://api.ashbyhq.com/posting-api/job-board/${token}` };
    case 'workable':
      return host === 'apply.workable.com' ? { ats: 'workable', token, endpoint: `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true` } : null;
    case 'smartrecruiters':
      return { ats: 'smartrecruiters', token, endpoint: smartRecruitersPageUrl(token, 0) };
    default:
      return null;
  }
}

/** La page `offset` de la liste SmartRecruiters d'une entreprise. */
export function smartRecruitersPageUrl(company: string, offset: number): string {
  return `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=${SMARTRECRUITERS_PAGE}&offset=${offset}`;
}

/** L'offset de la page suivante d'une liste SmartRecruiters lue à `offset`, ou null quand `totalFound` est atteint. */
export function smartRecruitersNextOffset(raw: unknown, offset: number): number | null {
  const page = obj(raw);
  const read = offset + arr(page.content).length;
  const total = typeof page.totalFound === 'number' ? page.totalFound : 0;
  return arr(page.content).length > 0 && read < total ? read : null;
}

/**
 * Le texte d'une annonce HTML, à plat, borné comme Free-Hire (`DESCRIPTION_MAX`). Greenhouse
 * livre `content` avec ses balises encodées en entités (`&lt;p&gt;`) : on décode d'abord.
 */
export function stripHtml(html: string): string {
  return decodeEntities(decodeEntities(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DESCRIPTION_MAX);
}

/** `2026-10-21` depuis une date ISO ou un epoch en millisecondes (Lever) ; vide sinon. */
export function isoDay(value: unknown): string {
  const date = typeof value === 'number' ? new Date(value) : typeof value === 'string' ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

const REMOTE = /\bremote\b|télétravail|teletravail|anywhere|distributed/i;

/** Le slug du tableau, comme le radar le forme (entreprise en minuscules, 20 caractères, `live_job_scraper.js`). */
export function boardSlug(company: string): string {
  return slugPart(company).slice(0, 20) || 'ats';
}

/** `45000–55000 EUR/per-year-salary` depuis les bornes d'une fourchette (Lever, Recruitee) ; vide sans borne numérique. */
export function salaryText(minimum: unknown, maximum: unknown, currency: string, unit: string): string {
  const min = typeof minimum === 'number' ? minimum : null;
  const max = typeof maximum === 'number' ? maximum : null;
  if (min === null && max === null) return '';
  return `${min !== null && max !== null && min !== max ? `${min}–${max}` : String(min ?? max)}${currency ? ` ${currency}` : ''}${unit ? `/${unit}` : ''}`;
}

/** `Barcelona, Spain` depuis les morceaux d'un lieu (ville, région, pays), décodés, sans les vides. */
function placeOf(...parts: unknown[]): string {
  return parts.map((part) => decodeEntities(str(part)).trim()).filter((part) => part !== '').join(', ');
}

/** Les lieux distincts d'une annonce, dans l'ordre, en une liste (comme Ashby : principal puis secondaires). */
function placesOf(places: string[]): string {
  return [...new Set(places.filter((place) => place !== ''))].join(', ');
}

function candidate(ats: Ats, token: string, company: string, fields: Omit<AtsCandidate, 'slug' | 'company' | 'source' | 'found_at' | 'ats'> & { department: string; employment_type: string }, now: Date): AtsCandidate {
  const { department, employment_type, ...rest } = fields;
  return {
    ...rest,
    slug: boardSlug(company),
    company: decodeEntities(company),
    source: `Page carrières (${ats})`,
    found_at: now.toISOString(),
    ats: { ats, token, external_id: rest.id.replace(/^[A-Z]+-/, ''), department, employment_type },
  };
}

/**
 * Greenhouse Job Board API : `{ jobs: [{ id, title, absolute_url, location: { name }, content,
 * first_published, updated_at, departments: [{ name }], metadata }] }`. Un job sans id, titre ou
 * URL http(s) est écarté avec sa raison.
 */
export function parseGreenhouse(raw: unknown, company: string, now: Date): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(obj(raw).jobs)) {
    const job = obj(item);
    const id = job.id === undefined || job.id === null ? '' : String(job.id);
    const title = decodeEntities(str(job.title)).trim();
    const link = str(job.absolute_url);
    if (id === '' || title === '' || !/^https?:\/\//.test(link)) {
      skipped.push(`greenhouse ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no http(s) URL'}`);
      continue;
    }
    const location = decodeEntities(str(obj(job.location).name)).trim();
    jobs.push(
      candidate('greenhouse', '', company, {
        id: `GH-${id}`,
        title,
        link,
        location,
        remote_declared: REMOTE.test(location) || REMOTE.test(title),
        description: stripHtml(str(job.content)),
        skills_required: '',
        salary_range: '',
        date_published: isoDay(job.first_published) || isoDay(job.updated_at),
        department: arr(job.departments).map((d) => str(obj(d).name)).filter((n) => n !== '').join(', '),
        employment_type: '',
      }, now)
    );
  }
  return { jobs, skipped };
}

/**
 * Lever Postings API (`?mode=json`) : un tableau de `{ id, text, hostedUrl, applyUrl,
 * categories: { location, allLocations, team, commitment }, workplaceType, descriptionPlain,
 * createdAt (ms), salaryRange: { min, max, currency, interval } }`.
 */
export function parseLever(raw: unknown, company: string, now: Date): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(raw)) {
    const job = obj(item);
    const id = str(job.id);
    const title = decodeEntities(str(job.text)).trim();
    const link = str(job.hostedUrl) || str(job.applyUrl);
    if (id === '' || title === '' || !/^https?:\/\//.test(link)) {
      skipped.push(`lever ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no http(s) URL'}`);
      continue;
    }
    const categories = obj(job.categories);
    const all = arr(categories.allLocations).map((l) => decodeEntities(str(l)).trim()).filter((l) => l !== '');
    const location = all.length > 0 ? all.join(', ') : decodeEntities(str(categories.location)).trim();
    const salary = obj(job.salaryRange);
    jobs.push(
      candidate('lever', '', company, {
        id: `LEV-${id}`,
        title,
        link,
        location,
        remote_declared: str(job.workplaceType).toLowerCase() === 'remote' || REMOTE.test(location),
        description: (str(job.descriptionPlain) || stripHtml(str(job.description))).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX),
        skills_required: '',
        salary_range: salaryText(salary.min, salary.max, str(salary.currency), str(salary.interval)),
        date_published: isoDay(job.createdAt),
        department: decodeEntities(str(categories.team)),
        employment_type: str(categories.commitment),
      }, now)
    );
  }
  return { jobs, skipped };
}

/**
 * Ashby Job Posting API : `{ jobs: [{ id, title, department, team, employmentType, location,
 * secondaryLocations: [{ location }], isRemote, isListed, publishedAt, jobUrl, applyUrl,
 * descriptionPlain, descriptionHtml }] }`. Un job `isListed: false` est écarté.
 */
export function parseAshby(raw: unknown, company: string, now: Date): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(obj(raw).jobs)) {
    const job = obj(item);
    const id = str(job.id);
    const title = decodeEntities(str(job.title)).trim();
    const link = str(job.jobUrl) || str(job.applyUrl);
    if (id === '' || title === '' || !/^https?:\/\//.test(link)) {
      skipped.push(`ashby ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no http(s) URL'}`);
      continue;
    }
    if (job.isListed === false) {
      skipped.push(`ashby ${id}: not listed`);
      continue;
    }
    const locations = [str(job.location), ...arr(job.secondaryLocations).map((l) => str(obj(l).location))].map((l) => decodeEntities(l).trim()).filter((l) => l !== '');
    const location = [...new Set(locations)].join(', ');
    jobs.push(
      candidate('ashby', '', company, {
        id: `ASH-${id}`,
        title,
        link,
        location,
        remote_declared: job.isRemote === true || REMOTE.test(location),
        description: (str(job.descriptionPlain) || stripHtml(str(job.descriptionHtml))).replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX),
        skills_required: '',
        salary_range: '',
        date_published: isoDay(job.publishedAt),
        department: decodeEntities(str(job.department) || str(job.team)),
        employment_type: str(job.employmentType),
      }, now)
    );
  }
  return { jobs, skipped };
}

/** Un lieu Workable : `location_str`, sinon ville et pays. */
const workablePlace = (location: Record<string, unknown>): string => placeOf(location.location_str) || placeOf(location.city, location.country);

/**
 * Workable widget API (`/api/v1/widget/accounts/<slug>?details=true`), forme d'après la
 * documentation, à confirmer sur une vraie réponse : `{ name, jobs: [{ title, shortcode, url,
 * application_url, published_on, department, employment_type, location: { city, country,
 * location_str, telecommuting, workplace_type }, locations?, description, full_description }] }`.
 * Télétravail quand `location.telecommuting` est vrai ou `workplace_type` vaut `remote`.
 */
export function parseWorkable(raw: unknown, company: string, now: Date): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(obj(raw).jobs)) {
    const job = obj(item);
    const id = str(job.shortcode);
    const title = decodeEntities(str(job.title)).trim();
    const link = str(job.url) || str(job.application_url);
    if (id === '' || title === '' || !/^https?:\/\//.test(link)) {
      skipped.push(`workable ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no http(s) URL'}`);
      continue;
    }
    const main = obj(job.location);
    const location = placesOf([workablePlace(main), ...arr(job.locations).map((l) => workablePlace(obj(l)))]);
    const workplace = (str(main.workplace_type) || str(job.workplace_type)).toLowerCase();
    jobs.push(
      candidate('workable', '', company, {
        id: `WRK-${id}`,
        title,
        link,
        location,
        remote_declared: main.telecommuting === true || job.telecommuting === true || workplace === 'remote' || REMOTE.test(location),
        description: stripHtml(str(job.full_description) || str(job.description)),
        skills_required: '',
        salary_range: '',
        date_published: isoDay(job.published_on) || isoDay(job.created_at),
        department: decodeEntities(str(job.department)),
        employment_type: str(job.employment_type),
      }, now)
    );
  }
  return { jobs, skipped };
}

/**
 * Recruitee Careers Site API (`<company>.recruitee.com/api/offers/`), forme d'après la
 * documentation, à confirmer sur une vraie réponse : `{ offers: [{ id, slug, title, status,
 * published_at, careers_url, careers_apply_url, description, requirements, department,
 * employment_type_code, remote, hybrid, on_site, locations: [{ city, country, country_code }],
 * salary: { min, max, currency, period } | null, tags }] }`. Télétravail quand `remote` est vrai ;
 * les prérequis (`requirements`) vont dans `skills_required` ; une offre dont le `status` n'est
 * pas `published` est écartée avec sa raison.
 */
export function parseRecruitee(raw: unknown, company: string, now: Date): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(obj(raw).offers)) {
    const job = obj(item);
    const id = job.id === undefined || job.id === null ? '' : String(job.id);
    const title = decodeEntities(str(job.title)).trim();
    const link = str(job.careers_url) || str(job.careers_apply_url);
    if (id === '' || title === '' || !/^https?:\/\//.test(link)) {
      skipped.push(`recruitee ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no http(s) URL'}`);
      continue;
    }
    const status = str(job.status).toLowerCase();
    if (status !== '' && status !== 'published') {
      skipped.push(`recruitee ${id}: status ${status}`);
      continue;
    }
    const location = placesOf(arr(job.locations).map((l) => placeOf(obj(l).city, obj(l).country)));
    const salary = obj(job.salary);
    jobs.push(
      candidate('recruitee', '', company, {
        id: `REC-${id}`,
        title,
        link,
        location,
        remote_declared: job.remote === true || REMOTE.test(location),
        description: stripHtml(str(job.description)),
        skills_required: stripHtml(str(job.requirements)),
        salary_range: salaryText(salary.min, salary.max, str(salary.currency), str(salary.period)),
        date_published: isoDay(job.published_at) || isoDay(job.created_at),
        department: decodeEntities(str(job.department)),
        employment_type: str(job.employment_type_code),
      }, now)
    );
  }
  return { jobs, skipped };
}

/** L'entreprise dans un `ref` SmartRecruiters (`…/v1/companies/<company>/postings/<id>`) ; vide sinon. */
function smartRecruitersCompanyOf(ref: string): string {
  const match = /\/companies\/([A-Za-z0-9._-]+)\/postings\//.exec(ref);
  return match?.[1] ?? '';
}

/**
 * SmartRecruiters Posting API (`/v1/companies/<company>/postings`), forme d'après la
 * documentation, à confirmer sur une vraie réponse : `{ offset, limit, totalFound, content:
 * [{ id, uuid, name, releasedDate, location: { city, region, country, remote }, department:
 * { label }, typeOfEmployment: { label }, ref }] }`. La liste n'a ni texte ni lien de
 * candidature : l'offre sort avec le lien `jobs.smartrecruiters.com/<company>/<id>` et une
 * description vide, que `mergeSmartRecruitersDetail` remplit après un second appel à
 * `smartRecruitersDetailUrl`. Le jeton vient de l'appelant (`parseBoard`), sinon du `ref`.
 * Télétravail quand `location.remote` est vrai ; le code pays (`us`) est mis en majuscules.
 */
export function parseSmartRecruiters(raw: unknown, company: string, now: Date, token = ''): { jobs: AtsCandidate[]; skipped: string[] } {
  const jobs: AtsCandidate[] = [];
  const skipped: string[] = [];
  for (const item of arr(obj(raw).content)) {
    const job = obj(item);
    const id = job.id === undefined || job.id === null ? '' : String(job.id);
    const title = decodeEntities(str(job.name)).trim();
    const slug = token || smartRecruitersCompanyOf(str(job.ref));
    if (id === '' || title === '' || slug === '') {
      skipped.push(`smartrecruiters ${id || '?'}: ${title === '' ? 'no title' : id === '' ? 'no id' : 'no company token'}`);
      continue;
    }
    const place = obj(job.location);
    const country = str(place.country);
    const location = placeOf(place.city, place.region, /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : country);
    jobs.push(
      candidate('smartrecruiters', slug, company, {
        id: `SMR-${id}`,
        title,
        link: `https://jobs.smartrecruiters.com/${slug}/${id}`,
        location,
        remote_declared: place.remote === true || REMOTE.test(location),
        description: '',
        skills_required: '',
        salary_range: '',
        date_published: isoDay(job.releasedDate),
        department: decodeEntities(str(obj(job.department).label)),
        employment_type: str(obj(job.typeOfEmployment).label),
      }, now)
    );
  }
  return { jobs, skipped };
}

/** Le second appel d'une offre SmartRecruiters : `/v1/companies/<company>/postings/<id>` (son `ref`). */
export function smartRecruitersDetailUrl(offer: Pick<AtsCandidate, 'ats'>): string {
  return `https://api.smartrecruiters.com/v1/companies/${offer.ats.token}/postings/${offer.ats.external_id}`;
}

/**
 * Le détail d'une offre SmartRecruiters, forme d'après la documentation, à confirmer sur une
 * vraie réponse : `{ applyUrl, jobAd: { sections: { jobDescription: { text }, qualifications:
 * { text }, … } } }`. Le texte de l'annonce va dans `description`, les prérequis dans
 * `skills_required`, `applyUrl` (http(s)) remplace le lien construit ; le reste de l'offre ne bouge pas.
 */
export function mergeSmartRecruitersDetail<T extends AtsCandidate>(offer: T, detail: unknown): T {
  const posting = obj(detail);
  const sections = obj(obj(posting.jobAd).sections);
  const applyUrl = str(posting.applyUrl);
  return {
    ...offer,
    link: /^https?:\/\//.test(applyUrl) ? applyUrl : offer.link,
    description: stripHtml(str(obj(sections.jobDescription).text)) || offer.description,
    skills_required: stripHtml(str(obj(sections.qualifications).text)) || offer.skills_required,
  };
}

const ATS_LABELS = 'Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters seulement';

/** Une page carrières lue : l'ATS reconnu dans l'URL décide du parseur ; les jetons sont posés. */
export function parseBoard(careersUrl: string, raw: unknown, company: string, now: Date): { endpoint: AtsEndpoint | null; jobs: AtsCandidate[]; skipped: string[] } {
  const endpoint = atsEndpoint(careersUrl);
  if (endpoint === null) return { endpoint: null, jobs: [], skipped: [`${careersUrl}: ATS non couvert (${ATS_LABELS})`] };
  const parsers: Record<Ats, () => { jobs: AtsCandidate[]; skipped: string[] }> = {
    greenhouse: () => parseGreenhouse(raw, company, now),
    lever: () => parseLever(raw, company, now),
    ashby: () => parseAshby(raw, company, now),
    workable: () => parseWorkable(raw, company, now),
    recruitee: () => parseRecruitee(raw, company, now),
    smartrecruiters: () => parseSmartRecruiters(raw, company, now, endpoint.token),
  };
  const parsed = parsers[endpoint.ats]();
  return { endpoint, jobs: parsed.jobs.map((job) => ({ ...job, ats: { ...job.ats, token: endpoint.token } })), skipped: parsed.skipped };
}

/**
 * Une ligne par offre : même entreprise et même intitulé repliés (`titleKey`), les pays en liste,
 * la plus récente devant. C'est ce que le tableau devrait faire à la source ; le cockpit le fait
 * à l'affichage depuis le 22 octobre (une ligne par slug).
 */
export function groupByCountry<T extends AtsCandidate>(candidates: T[]): GroupedCandidate[] {
  const groups = new Map<string, GroupedCandidate>();
  const sorted = [...candidates].sort((a, b) => (b.date_published || '').localeCompare(a.date_published || ''));
  for (const c of sorted) {
    const key = titleKey(c.company, c.title);
    const variant = { id: c.id, link: c.link, location: c.location, date_published: c.date_published };
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { ...c, locations: c.location === '' ? [] : [c.location], variants: [variant] });
      continue;
    }
    if (group.variants.some((v) => linkKey(v.link) === linkKey(c.link))) continue;
    group.variants.push(variant);
    if (c.location !== '' && !group.locations.includes(c.location)) group.locations.push(c.location);
    group.remote_declared = group.remote_declared || c.remote_declared;
  }
  return [...groups.values()].map((g) => ({ ...g, location: g.locations.join(', ') }));
}

/** Les mots du domaine que `index.js` accepte dans un titre sans autre question. */
export const CORE_DOMAINS = [
  'growth', 'marketing', 'acquisition', 'gtm', 'revops', 'demand generation',
  'lead generation', 'inbound', 'outbound', 'traffic manager', 'conversion', 'crm',
  'lifecycle', 'product marketing', 'sales ops', 'market analyst', 'operations',
];

/**
 * `matchesAnyTargetQuery` de `career_ops/fetchers/index.js` (copie PC du 22 octobre), tel quel :
 * sans requêtes, tout passe ; un mot du domaine dans le titre suffit ; sinon le titre contient un
 * intitulé visé, ou tous ses mots de plus de trois lettres ; sinon le corps contient l'intitulé
 * exact. LinkedIn n'y passe pas (« déjà requêté par intitulé »).
 */
export function matchesTarget(job: { title: string; skills_required?: string; description?: string }, queries: string[] = []): boolean {
  if (queries.length === 0) return true;
  const full = `${job.title} ${job.skills_required ?? ''} ${job.description ?? ''}`.toLowerCase();
  const title = job.title.toLowerCase();
  if (CORE_DOMAINS.some((d) => title.includes(d))) return true;
  const inTitle = queries.some((q) => {
    const ql = q.toLowerCase();
    return title.includes(ql) || ql.split(' ').every((w) => w.length > 3 && title.includes(w));
  });
  if (inTitle) return true;
  return queries.some((q) => full.includes(q.toLowerCase()));
}

/**
 * Ce que le tableau a déjà : même lien d'annonce (`linkKey`), ou même entreprise + intitulé
 * (`titleKey`, l'offre vue par LinkedIn pointe ailleurs que l'ATS). Les doublons d'une même
 * lecture sont aussi écartés. Le slug, lui, n'est pas un critère : une entreprise peut avoir
 * plusieurs offres sous le même slug (c'est le cas sur le tableau aujourd'hui).
 */
export function dedupeAgainstBoard<T extends AtsCandidate>(candidates: T[], board: unknown): { fresh: T[]; duplicates: { id: string; reason: string }[] } {
  const rows = arr(board).map(obj);
  const links = new Map<string, string>();
  const titles = new Map<string, string>();
  const remember = (row: Record<string, unknown>): void => {
    const slug = str(row.slug) || str(row.id);
    if (str(row.link) !== '') links.set(linkKey(str(row.link)), slug);
    if (str(row.company) !== '' && str(row.title) !== '') titles.set(titleKey(str(row.company), str(row.title)), slug);
  };
  rows.forEach(remember);
  const fresh: T[] = [];
  const duplicates: { id: string; reason: string }[] = [];
  for (const c of candidates) {
    const byLink = links.get(linkKey(c.link));
    const byTitle = titles.get(titleKey(c.company, c.title));
    const reason = byLink !== undefined ? `same posting link as ${byLink}` : byTitle !== undefined ? `same company and title as ${byTitle}` : null;
    if (reason !== null) {
      duplicates.push({ id: c.id, reason });
      continue;
    }
    fresh.push(c);
    remember(c as unknown as Record<string, unknown>);
  }
  return { fresh, duplicates };
}
