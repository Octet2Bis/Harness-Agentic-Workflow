/**
 * extra_fetchers.js — Sources de plus, portées de JobCampaign : Freehire (freehire.me) et la recherche
 * publique de Workable (jobs.workable.com)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Même contrat que board_fetchers.js : { status, jobs }, ne lève jamais, `get(url, timeoutMs)` injectable.
 * Pas de filtre de fraîcheur ni d'intitulé ici (le radar les applique) : la fenêtre est demandée au
 * serveur (posted_within_days / day_range). Verdicts robots / CGU : EXTRA_SOURCES.md. Station F : non
 * porté (index Algolia de Welcome to the Jungle, clé lue dans la page).
 */

const common = require('./common');
const { request } = require('./request');
const { hashStr, stripHtml, toIsoDay, sleep, ENTREPRISE_INCONNUE } = common;
const { fullDescriptionField } = require('./full_description');

// Freehire demande un User-Agent qui nomme le projet (robots.txt, llms.txt) ; sans clé = usage personnel.
const FREEHIRE_HEADERS = { 'User-Agent': 'master-plan-radar/1.0 (recherche d\'emploi personnelle)', Accept: 'application/json' };
// Agrégateurs que le radar lit déjà ailleurs, ou republieurs à extrait seul (liste de freehire_search.py, réduite).
const FREEHIRE_EXCLUDE = ['jobicy', 'remoteok', 'weworkremotely', 'workingnomads', 'jobspresso', 'arbeitnow', 'himalayas', 'adzuna',
  'wttj', 'whatjobs-fr', 'whatjobs-uk', 'whatjobs-es', 'whatjobs-de', 'whatjobs-nl', 'whatjobs-it', 'telegram', 'startupjobs'];
const FREEHIRE_URL = 'https://freehire.me/api/v1/agent/jobs/search?q={keyword}&q_fields=title&work_mode=remote&regions=eu&regions=uk'
  + '&posted_within_days=3&description_format=text&sort=posted_at&order=desc&limit=100&'
  + FREEHIRE_EXCLUDE.map(s => `source_exclude=${s}`).join('&');
const FREEHIRE_PAUSE_MS = 1000; // freehire_search.py : 1 s entre appels (Cloudflare coupe vers 90 requêtes / min)
// /api/v1/jobs n'est pas visé par le robots.txt (seuls /search, /search?…, */search/, /profile*, /company-login-unauthorized).
const WORKABLE_URL = 'https://jobs.workable.com/api/v1/jobs?query={keyword}&location=Europe&workplace=remote&limit=20&day_range=3';
const WORKABLE_PAUSE_MS = 1500;

const asList = v => (Array.isArray(v) ? v : (v ? [v] : []));
const decode = s => String(s || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
// Lecture par request() (setEncoding utf8) : common.fetchUrl concatène des Buffers et peut couper un
// caractère multi-octets (é, ï, –) à la frontière de deux paquets.
const utf8Get = headers => url => request(url, { headers, timeoutMs: 15000 });
const freehireGet = utf8Get(FREEHIRE_HEADERS);
const workableGet = utf8Get({ Accept: 'application/json' });

async function getJson(url, get) {
  const res = await get(url, 15000);
  if (res.status !== 200 || !res.data) return { status: res.status, data: null };
  try { return { status: 200, data: JSON.parse(res.data) }; } catch { return { status: 'réponse illisible', data: null }; }
}

// Boucle commune : une requête par mot-clé (au plus `max`), pause entre appels, arrêt au premier 429
// (jamais de nouvel essai), 200 dès qu'un appel répond, sinon le premier statut d'échec.
async function sweepQueries(template, queries, max, pauseMs, get, readPage) {
  const selected = [...new Set(asList(queries).map(q => String(q).trim()).filter(Boolean))].slice(0, max);
  const seen = new Set(), jobs = [], statuses = [];
  for (let n = 0; n < selected.length; n++) {
    if (n > 0 && pauseMs > 0) await sleep(pauseMs);
    const { status, data } = await getJson(template.replace('{keyword}', encodeURIComponent(selected[n])), get);
    const page = data ? readPage(data) : { status, jobs: [] };
    statuses.push(page.status);
    for (const j of page.jobs) if (!seen.has(j.id)) { seen.add(j.id); jobs.push(j); }
    if (status === 429) break;
  }
  return { status: statuses.includes(200) ? 200 : (statuses[0] ?? 'aucune requête'), jobs };
}

function freehireSalary(e = {}) {
  const min = e.salary_min, max = e.salary_max;
  if (!min && !max) return null;
  const bounds = min && max && min !== max ? `${min} - ${max}` : String(min || max);
  return [bounds, e.salary_currency, e.salary_period && `(${e.salary_period})`].filter(Boolean).join(' ');
}

// Les liens Freehire portent ?utm_source=freehire.me : retiré, le lien reste celui de l'ATS de l'employeur.
function cleanLink(u) {
  try { const url = new URL(u); [...url.searchParams.keys()].filter(k => /^utm_/i.test(k)).forEach(k => url.searchParams.delete(k)); return url.toString(); } catch { return ''; }
}

// Enveloppe { data, meta } (openapi.yaml relu le 2026-10-24) ; un paramètre ignoré (meta.ignored_params)
// est un échec : un filtre perdu ressemble à un résultat large.
function readFreehirePage(body) {
  if (!Array.isArray(body?.data)) return { status: 'réponse illisible', jobs: [] };
  const ignored = asList(body.meta?.ignored_params).map(p => p?.param || p).filter(Boolean);
  if (ignored.length) return { status: `paramètre ignoré : ${ignored.join(', ')}`, jobs: [] };
  const jobs = body.data.filter(i => i && i.public_slug && /^https?:\/\//.test(i.url || '') && !i.closed_at).map(i => {
    const e = i.enrichment || {};
    return {
      id: `FH-${i.public_slug}`,
      company: decode(i.company) || ENTREPRISE_INCONNUE, // parfois l'identifiant du compte ATS (freehire_search.py)
      title: decode(i.title),
      location: decode(i.location) || [...asList(i.cities), ...asList(i.countries).map(c => String(c).toUpperCase())].join(', '),
      remote_declared: String(i.work_mode || '').toLowerCase() === 'remote',
      remote_basis: 'champ work_mode=remote de Freehire (filtre work_mode=remote)',
      company_hq: '',
      skills_required: asList(i.skills).join(', '),
      description: stripHtml(i.description || '').slice(0, 400),
      ...fullDescriptionField(i.description),
      salary_range: freehireSalary(e),
      link: cleanLink(i.url),
      date_published: toIsoDay(i.posted_at),
      source: `Freehire (freehire.me, ATS ${i.source || '?'})`
    };
  });
  return { status: 200, jobs };
}

async function fetchFreehireLive(endpoint, queries = [], get = freehireGet, pauseMs = FREEHIRE_PAUSE_MS) {
  // Chaque terme part entre guillemets (tous les mots dans l'intitulé, q_fields=title), comme freehire_search.py.
  const quoted = asList(queries).map(q => `"${String(q).replace(/"/g, '').trim()}"`).filter(q => q.length > 2);
  return sweepQueries(endpoint || FREEHIRE_URL, quoted, 6, pauseMs, get, readFreehirePage);
}

// Une offre remote Workable = une annonce PAR pays d'embauche : locations ["TELECOMMUTE", "<pays>"].
function workablePlaces(i) {
  const ls = asList(i.locations).map(l => String(l).trim()).filter(l => l && l.toUpperCase() !== 'TELECOMMUTE');
  if (ls.length) return ls.join('; ');
  const l = i.location || {};
  return [l.city, l.subregion, l.countryName].filter(Boolean).join(', ');
}

// Enveloppe { totalSize, nextPageToken, jobs } (réponse réelle du 2026-10-24) ; page 1 seulement.
function readWorkablePage(body) {
  if (!Array.isArray(body?.jobs)) return { status: 'réponse illisible', jobs: [] };
  const jobs = body.jobs.filter(i => i && i.url && String(i.state || 'published').toLowerCase() === 'published').map(i => {
    const full = [i.description, i.requirementsSection, i.benefitsSection].filter(Boolean).join('\n');
    return {
      id: `WKS-${i.id || hashStr(i.url)}`,
      company: i.company?.title || ENTREPRISE_INCONNUE,
      title: decode(i.title),
      location: workablePlaces(i),
      remote_declared: String(i.workplace || '').toLowerCase() === 'remote' || asList(i.locations).includes('TELECOMMUTE'),
      remote_basis: 'filtre workplace=remote de jobs.workable.com',
      company_hq: '',
      skills_required: [i.department, i.employmentType].filter(Boolean).join(', '),
      description: stripHtml(i.description || '').slice(0, 400),
      ...fullDescriptionField(full),
      salary_range: null,
      link: i.url,
      date_published: toIsoDay(i.created),
      source: 'Workable (jobs.workable.com)'
    };
  });
  return { status: 200, jobs };
}

async function fetchWorkableSearchLive(endpoint, queries = [], get = workableGet, pauseMs = WORKABLE_PAUSE_MS) {
  return sweepQueries(endpoint || WORKABLE_URL, queries, 4, pauseMs, get, readWorkablePage);
}

module.exports = { fetchFreehireLive, fetchWorkableSearchLive, FREEHIRE_URL, WORKABLE_URL, FREEHIRE_HEADERS };
