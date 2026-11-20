/**
 * board_fetchers.js — Connecteurs sans clé : Jobgether, Growth.Talent, Jobicy, EU Remote Jobs, WTTJ
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Chaque connecteur renvoie { status, jobs } et ne lève jamais. `get(url, timeoutMs)` suit le
 * contrat de common.fetchUrl (injectable en test). Formes de réponse relues sur des réponses réelles
 * du 2026-10-23 (fixtures sous ./test).
 */

const common = require('./common');
const { hashStr, isFreshUnder48h, stripHtml, toIsoDay, sleep, ENTREPRISE_INCONNUE } = common;
const { parseRssItems } = require('./rss_fetchers');
const { parseWttjCards } = require('./wttj_parser');
const { fullDescriptionField } = require('./full_description');

const JOBGETHER_URL = 'https://jobgether.com/astroapi/ai/jobs.json?keyword={keyword}&locations=europe&remoteType=full-remote&sort=date&limit=25&page=1';
const JOBGETHER_PAUSE_MS = 2000; // robots.txt de Jobgether : Crawl-delay 2
const JOBGETHER_THEMES = ['growth', 'marketing', 'revenue', 'gtm', 'crm', 'lifecycle', 'demand', 'revops', 'operations', 'ops', 'automation', 'email'];
const WTTJ_BASE = 'https://www.welcometothejungle.com', WTTJ_BASIS = 'page « emploi télétravail » de Welcome to the Jungle (100 % télétravail)';

async function getJson(url, get) {
  const res = await get(url);
  if (res.status !== 200 || !res.data) return { status: res.status, data: null };
  try { return { status: 200, data: JSON.parse(res.data) }; } catch { return { status: 'réponse illisible', data: null }; }
}

const asList = v => (Array.isArray(v) ? v : (v ? [v] : []));
const fresh = isFreshUnder48h;

// Règle stable : les `max` (6) premières requêtes contenant un thème cœur, dans l'ordre donné (le
// répartiteur passe la liste `source_queries` tournée d'un cycle à l'autre).
function jobgetherQueries(queries = [], max = 6) {
  return queries.filter(q => JOBGETHER_THEMES.some(t => q.toLowerCase().includes(t))).slice(0, max);
}

async function fetchJobgetherLive(urlTemplate, queries = [], get = common.fetchUrl, pauseMs = JOBGETHER_PAUSE_MS) {
  const template = urlTemplate || JOBGETHER_URL;
  const selected = jobgetherQueries(queries);
  const seen = new Set();
  const jobs = [];
  let status = 200;
  for (let n = 0; n < selected.length; n++) {
    if (n > 0 && pauseMs > 0) await sleep(pauseMs);
    const { status: s, data } = await getJson(template.replace('{keyword}', encodeURIComponent(selected[n])), get);
    if (!data) { if (status === 200) status = s; continue; }
    for (const i of data.jobs || []) {
      const day = toIsoDay(i.postedAt);
      if (!i.url || seen.has(i.url) || !fresh(day)) continue;
      seen.add(i.url);
      jobs.push({
        id: `JG-${i.id || hashStr(i.url)}`,
        company: i.company || ENTREPRISE_INCONNUE,
        title: i.title || '',
        location: i.location || '',
        remote_declared: true,
        remote_basis: 'filtre full-remote de Jobgether',
        company_hq: '',
        skills_required: asList(i.jobFunctions).join(', '),
        description: [i.contractType, i.experience].filter(Boolean).join(' · '), // la liste ne porte pas le texte de l'annonce
        salary_range: i.salaryRange || null,
        link: i.url,
        date_published: day,
        source: 'Jobgether'
      });
    }
  }
  return { status, jobs };
}

// Enveloppe { data, pagination, meta } (openapi.json relu le 2026-10-23) ; `remote` vaut REMOTE / HYBRID / ONSITE.
// `endpoint` peut être une liste : `market` n'accepte que france, usa et latam, et « usa » est en fait
// mondial (relu le 2026-10-24) ; le radar filtre ensuite les pays. Statut : 200 si un appel répond.
async function fetchGrowthTalentLive(endpoint, get = common.fetchUrl) {
  const urls = asList(endpoint).filter(Boolean);
  if (!urls.length) urls.push('https://www.growthtalent.org/api/v1/jobs?market=france&remote=true&limit=100');
  const seen = new Set(), jobs = [], statuses = [];
  for (const url of urls) {
    const one = await fetchGrowthTalentPage(url, get);
    statuses.push(one.status);
    for (const j of one.jobs) if (!seen.has(j.link)) { seen.add(j.link); jobs.push(j); }
  }
  return { status: statuses.includes(200) ? 200 : statuses[0], jobs };
}

async function fetchGrowthTalentPage(endpoint, get) {
  const { status, data } = await getJson(endpoint, get);
  if (!data) return { status, jobs: [] };
  const jobs = asList(data.data).filter(i => i.url && fresh(toIsoDay(i.postedAt))).map(i => ({
    id: `GT-${i.id || hashStr(i.url)}`,
    company: i.company?.name || ENTREPRISE_INCONNUE,
    title: i.title || '',
    location: i.location || [i.city, i.country].filter(Boolean).join(', '),
    remote_declared: String(i.remote || 'REMOTE').toUpperCase() === 'REMOTE',
    remote_basis: 'filtre remote=true de Growth.Talent',
    company_hq: '',
    skills_required: i.category || '',
    description: [i.seniority, i.contractType].filter(Boolean).join(' · ').toLowerCase(),
    salary_range: i.salary || null,
    link: i.url,
    date_published: toIsoDay(i.postedAt),
    source: 'Growth.Talent'
  }));
  return { status, jobs };
}

// Jobicy demande d'être crédité avec un lien direct : `source` et `link` pointent vers jobicy.com.
function jobicySalary(i) {
  const min = i.salaryMin ?? i.annualSalaryMin, max = i.salaryMax ?? i.annualSalaryMax;
  if (!min && !max) return null;
  const bounds = min && max ? `${min} - ${max}` : (min ? `dès ${min}` : `jusqu'à ${max}`);
  return [bounds, i.salaryCurrency, i.salaryPeriod && `(${i.salaryPeriod})`].filter(Boolean).join(' ');
}

async function fetchJobicyLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await getJson(endpoint || 'https://jobicy.com/api/v2/remote-jobs?count=50&geo=europe&industry=marketing', get);
  if (!data) return { status, jobs: [] };
  const jobs = asList(data.jobs).filter(i => i.url && fresh(toIsoDay(i.pubDate))).map(i => ({
    id: `JCY-${i.id || hashStr(i.url)}`,
    company: i.companyName || ENTREPRISE_INCONNUE,
    title: i.jobTitle || '',
    location: i.jobGeo || '',
    remote_declared: true,
    remote_basis: 'plateforme 100 % remote (Jobicy)',
    company_hq: '',
    skills_required: [...asList(i.jobIndustry), ...asList(i.jobType), i.jobLevel].filter(Boolean).join(', '),
    description: stripHtml(i.jobExcerpt || '').slice(0, 400),
    ...fullDescriptionField(i.jobDescription),
    salary_range: jobicySalary(i),
    link: i.url,
    date_published: toIsoDay(i.pubDate),
    source: 'Jobicy (jobicy.com)'
  }));
  return { status, jobs };
}

// Flux relu le 2026-10-23 : <title> nu dans la plupart des cas ; un séparateur « – », « - », « at », « @ »
// n'est exploité que s'il est présent (« Titre – Entreprise »).
async function fetchEuRemoteJobsLive(endpoint, get = common.fetchUrl) {
  const res = await get(endpoint || 'https://euremotejobs.com/sitemap.rss');
  if (res.status !== 200 || !res.data) return { status: res.status, jobs: [] };
  const jobs = parseRssItems(res.data).filter(i => fresh(toIsoDay(i.pubDate))).map(i => {
    const parts = i.title.replace(/&amp;/g, '&').split(/\s[–—-]\s|\s(?:at|chez)\s|\s@\s/i).map(p => p.trim()).filter(Boolean);
    return {
      id: `EURJ-${hashStr(i.link)}`,
      company: parts.length > 1 ? parts[parts.length - 1] : ENTREPRISE_INCONNUE,
      title: parts.length > 1 ? parts.slice(0, -1).join(' - ') : parts[0] || i.title,
      location: '',
      remote_declared: true,
      remote_basis: 'plateforme dédiée au télétravail en Europe (EU Remote Jobs)',
      company_hq: '',
      skills_required: '',
      description: i.desc || '',
      salary_range: null,
      link: i.link,
      date_published: toIsoDay(i.pubDate),
      source: 'EU Remote Jobs'
    };
  });
  return { status: res.status, jobs };
}

// Page 1 seulement, jamais de paramètre de requête (robots.txt : Disallow /*?).
async function fetchWttjTeletravailLive(endpoint, get = common.fetchUrl) {
  const url = (endpoint || `${WTTJ_BASE}/fr/pages/emploi-teletravail`).split('?')[0];
  const res = await get(url, 10000);
  if (res.status !== 200 || !res.data) return { status: res.status, jobs: [] };
  return { status: 200, jobs: parseWttjCards(res.data, { base: WTTJ_BASE, basis: WTTJ_BASIS }) };
}

module.exports = { fetchJobgetherLive, fetchGrowthTalentLive, fetchJobicyLive, fetchEuRemoteJobsLive, fetchWttjTeletravailLive, jobgetherQueries };
