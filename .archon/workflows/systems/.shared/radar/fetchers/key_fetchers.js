/**
 * key_fetchers.js — Connecteurs à clé : Jobdatalake, Adzuna, JSearch (+ Apify, voir apify_fetcher.js)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Les clés arrivent par les options (lues dans .secrets/.env par index.js, par NOM de variable) ;
 * clé absente → { status: 'clé absente (NOM)', jobs: [] }. `get(url, { headers, timeoutMs })`
 * suit le contrat de request.js. Ces API étant injoignables depuis le poste de développement,
 * les formes de réponse viennent de leur documentation (fixtures fabriquées sous ./test).
 */

const { hashStr, isFreshUnder48h, stripHtml, toIsoDay, ENTREPRISE_INCONNUE } = require('./common');
const { request, parseJsonBody } = require('./request');
const { fetchApifyAtsLive } = require('./apify_fetcher');
const { fullDescriptionField } = require('./full_description');

const H48_MS = 48 * 60 * 60 * 1000;
const ADZUNA_COUNTRIES = ['fr', 'gb', 'de', 'nl', 'es', 'it'];
const ADZUNA_CURRENCY = { fr: 'EUR', de: 'EUR', nl: 'EUR', es: 'EUR', it: 'EUR', gb: 'GBP', at: 'EUR', be: 'EUR', ch: 'CHF' };
const ADZUNA_MAX_CALLS = 12;
const JSEARCH_COUNTRIES = ['fr', 'de', 'nl', 'es', 'gb'];
const JSEARCH_MAX_CALLS = 10;

const defaultGet = (url, opts = {}) => request(url, { ...opts, method: 'GET' });
const missing = (...names) => ({ status: `clé absente (${names.join(', ')})`, jobs: [] });

function range(min, max, unit) {
  if (!min && !max) return null;
  const bounds = min && max ? `${min} - ${max}` : (min ? `dès ${min}` : `jusqu'à ${max}`);
  return unit ? `${bounds} ${unit}` : bounds;
}

function jobdatalakeJob(j) {
  return {
    id: `JDL-${j.job_handle || hashStr(j.url)}`,
    company: j.company_name || ENTREPRISE_INCONNUE,
    title: j.title,
    location: (j.locations || []).join(', ') || (j.countries || []).join(', '),
    remote_declared: j.remote_type === 'fully_remote',
    remote_basis: 'remote_type de Jobdatalake',
    company_hq: '',
    skills_required: (j.required_skills || []).join(', '),
    description: '',
    ...fullDescriptionField(j.description || j.job_description || ''),
    salary_range: range(j.salary_min_usd, j.salary_max_usd, 'USD'),
    link: j.url,
    date_published: toIsoDay(j.posted_at),
    source: 'Jobdatalake'
  };
}

// Jobdatalake : liste sans description ; posted_at en secondes ou millisecondes (> 1e12).
// Une adresse qui porte {keyword} est appelée une fois par requête (`queries`, `queriesMax` au plus,
// dédoublonnage par url) ; sans {keyword}, un seul appel filtré par l'adresse, comme avant.
// `maxAgeDays` (offre_age_max_jours du candidat) ne fait que resserrer la fenêtre de 48 h, jamais l'élargir.
const windowMs = (maxAgeDays) => (Number(maxAgeDays) > 0 ? Math.min(H48_MS, Number(maxAgeDays) * 24 * 3600 * 1000) : H48_MS);

async function fetchJobdatalakeLive(endpoint, { apiKey, get = defaultGet, now = Date.now(), queries = [], queriesMax = 2, maxAgeDays = 0 } = {}) {
  if (!apiKey) return missing('JOBDATALAKE_API_KEY');
  const base = (endpoint || '').replace('{since_ms}', String(now - windowMs(maxAgeDays)));
  if (!base) return { status: 'endpoint absent', jobs: [] };
  const urls = base.includes('{keyword}')
    ? queries.slice(0, Math.max(1, queriesMax)).map(q => base.replace('{keyword}', encodeURIComponent(q)))
    : [base];
  if (urls.length === 0) return { status: 'aucune requête pour {keyword}', jobs: [] };
  const jobs = [];
  const seen = new Set();
  let status = 200;
  for (const url of urls) {
    const { status: s, data } = parseJsonBody(await get(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' }, timeoutMs: 10000 }));
    if (!data) {
      if (status === 200) status = s;
      if ([401, 403, 429].includes(s)) break;
      continue;
    }
    for (const j of Array.isArray(data.jobs) ? data.jobs : []) {
      if (!j.url || !j.title || seen.has(j.url)) continue;
      seen.add(j.url);
      jobs.push(jobdatalakeJob(j));
    }
  }
  return { status, jobs };
}

// Boucle commune pays × requêtes : s'arrête au plafond d'appels et au premier blocage (401/403/429).
async function sweep(pairs, maxCalls, buildUrl, get, headers, pick) {
  const jobs = [];
  const seen = new Set();
  let status = 200;
  for (const [country, keyword] of pairs.slice(0, maxCalls)) {
    const { status: s, data } = parseJsonBody(await get(buildUrl(country, keyword), { headers, timeoutMs: 10000 }));
    if (!data) {
      if (status === 200) status = s;
      if ([401, 403, 429].includes(s)) break;
      continue;
    }
    for (const j of pick(data, country) || []) {
      if (!j || !j.link || !j.title || seen.has(j.link) || !isFreshUnder48h(j.date_published)) continue;
      seen.add(j.link);
      jobs.push(j);
    }
  }
  return { status, jobs };
}

const pairsOf = (countries, queries) => countries.flatMap(c => queries.map(q => [c, q]));

// Adzuna n'a pas de filtre remote : remote_declared reste false, l'auditeur cherche le mot dans le texte.
// Les options viennent de l'entrée de job_sources.json (`source`), avec ces défauts ; elles servent
// aussi un second candidat (postes sur site en France : remote_suffix false, where, match what_phrase).
const ADZUNA_DEFAULTS = {
  countries: ADZUNA_COUNTRIES,
  queries_max: 1, // ≈ 72 appels / jour pour Antoine ; le quota (250 / jour) est partagé entre candidats
  match: 'what', // ou 'what_phrase' : expression exacte
  where: '', // '' = tout le pays ; une chaîne ou une liste de lieux en clair
  remote_suffix: true, // ajoute « remote » à la requête ; false pour un candidat sur site
  max_days_old: 1,
  sort_by: 'date',
  exclude_titles: ['alternance', 'apprenti', 'stage', 'stagiaire', 'service civique', 'internship'],
  results_per_page: 50,
  // Paramètres Adzuna en plus, par pays : {"gb": {"contract": "1"}} ne garde que les contrats à durée
  // déterminée au Royaume-Uni (2e candidate : missions à l'étranger seulement en CDD), la France inchangée.
  country_params: {}
};

// `maxAgeDays` (offre_age_max_jours du candidat, 0 : sans effet) plafonne max_days_old : le filtre
// côté Adzuna ne laisse jamais passer une offre plus vieille que la règle du crible ; le nombre
// d'appels (queries_max, ADZUNA_MAX_CALLS) n'en dépend pas.
function adzunaOptions(source = {}, maxAgeDays = 0) {
  const o = { ...ADZUNA_DEFAULTS };
  for (const k of Object.keys(ADZUNA_DEFAULTS)) if (source[k] !== undefined && source[k] !== null) o[k] = source[k];
  if (Number(maxAgeDays) > 0) o.max_days_old = Math.min(Number(o.max_days_old) || Number(maxAgeDays), Number(maxAgeDays));
  o.countries = Array.isArray(o.countries) && o.countries.length ? o.countries : ADZUNA_COUNTRIES;
  o.where = (Array.isArray(o.where) ? o.where : [o.where]).map(w => String(w || '').trim());
  if (o.where.length === 0) o.where = [''];
  o.exclude_titles = (Array.isArray(o.exclude_titles) ? o.exclude_titles : []).map(t => String(t).toLowerCase()).filter(Boolean);
  o.match = o.match === 'what_phrase' ? 'what_phrase' : 'what';
  o.queries_max = Math.max(1, Number(o.queries_max) || 1);
  o.country_params = o.country_params && typeof o.country_params === 'object' && !Array.isArray(o.country_params) ? o.country_params : {};
  return o;
}

// L'URL d'un appel : le gabarit (pays, clés) puis les paramètres de recherche posés depuis les
// options, dans l'ordre du gabarit (%20 conservé, jamais réencodé en +).
function adzunaUrl(urlTemplate, { appId, appKey }, o, country, keyword, where) {
  const filled = urlTemplate.replace('{country}', country).replace('{APP_ID}', encodeURIComponent(appId))
    .replace('{APP_KEY}', encodeURIComponent(appKey)).replace('{keyword}', encodeURIComponent(keyword));
  const q = filled.indexOf('?');
  const base = q < 0 ? filled : filled.slice(0, q);
  const params = [];
  const set = (k, v) => { const i = params.findIndex(p => p[0] === k); if (i >= 0) params[i][1] = v; else params.push([k, v]); };
  const drop = (k) => { const i = params.findIndex(p => p[0] === k); if (i >= 0) params.splice(i, 1); };
  if (q >= 0) for (const pair of filled.slice(q + 1).split('&').filter(Boolean)) {
    const eq = pair.indexOf('=');
    params.push(eq < 0 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]);
  }
  const query = encodeURIComponent(o.remote_suffix ? `${keyword} remote` : keyword);
  // Le paramètre de recherche garde sa place dans le gabarit, renommé si `match` change.
  const other = o.match === 'what' ? 'what_phrase' : 'what';
  const at = params.findIndex(p => p[0] === other);
  if (at >= 0) params[at][0] = o.match;
  drop(other);
  set(o.match, query);
  if (where) set('where', encodeURIComponent(where)); else drop('where');
  set('max_days_old', String(o.max_days_old));
  set('sort_by', String(o.sort_by));
  set('results_per_page', String(o.results_per_page));
  const extra = o.country_params[country];
  if (extra && typeof extra === 'object') for (const [k, v] of Object.entries(extra)) if (/^[a-z_]+$/.test(k) && v !== null && v !== undefined) set(k, encodeURIComponent(String(v)));
  return `${base}?${params.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&')}`;
}

async function fetchAdzunaLive(urlTemplate, { appId, appKey, countries, queries = [], get = defaultGet, source, maxAgeDays = 0 } = {}) {
  const lacking = [!appId && 'ADZUNA_APP_ID', !appKey && 'ADZUNA_APP_KEY'].filter(Boolean);
  if (lacking.length > 0) return missing(...lacking);
  if (!urlTemplate) return { status: 'url_template absent', jobs: [] };
  const o = adzunaOptions({ ...(source || {}), ...(countries ? { countries } : {}) }, maxAgeDays);
  const kws = queries.slice(0, o.queries_max);
  // Triplets pays × requête × lieu, encodés en [country, keyword] pour `sweep` (lieu porté par le pays).
  const triples = o.countries.flatMap(c => kws.flatMap(kw => o.where.map(w => [`${c}\u0000${w}`, kw])));
  const buildUrl = (ck, kw) => { const [c, w] = ck.split('\u0000'); return adzunaUrl(urlTemplate, { appId, appKey }, o, c, kw, w); };
  const excluded = (title) => o.exclude_titles.some(t => title.toLowerCase().includes(t));
  return sweep(triples, ADZUNA_MAX_CALLS, buildUrl, get, {}, (data, ck) => {
    const country = ck.split('\u0000')[0];
    return (data.results || []).map(r => {
      const link = String(r.redirect_url || '');
      const title = stripHtml(r.title || ''); // Adzuna renvoie les mots cherchés entre <strong>
      if (!/^https:\/\//i.test(link) || excluded(title)) return null;
      const salary = range(r.salary_min && Math.round(r.salary_min), r.salary_max && Math.round(r.salary_max), ADZUNA_CURRENCY[country] || '');
      return {
        id: `ADZ-${r.id || hashStr(link)}`,
        company: r.company?.display_name || ENTREPRISE_INCONNUE,
        title,
        location: r.location?.display_name || '',
        remote_declared: false,
        company_hq: '',
        skills_required: r.category?.label || '',
        description: stripHtml(r.description || '').slice(0, 400),
        salary_range: salary && String(r.salary_is_predicted) === '1' ? `${salary} (estimé par Adzuna)` : salary,
        link,
        date_published: toIsoDay(r.created),
        source: 'Adzuna'
      };
    });
  });
}

async function fetchJsearchLive(urlTemplate, { apiKey, countries = JSEARCH_COUNTRIES, queries = [], get = defaultGet } = {}) {
  if (!apiKey) return missing('JSEARCH_API_KEY');
  if (!urlTemplate) return { status: 'url_template absent', jobs: [] };
  const kws = queries.slice(0, 2);
  const buildUrl = (c, kw) => urlTemplate.replace('{country}', c).replace('{keyword}', encodeURIComponent(kw));
  return sweep(pairsOf(countries, kws), JSEARCH_MAX_CALLS, buildUrl, get, { 'x-api-key': apiKey, Accept: 'application/json' }, (data) => (data.data || []).map(j => ({
    id: `JS-${j.job_id || hashStr(j.job_apply_link)}`,
    company: j.employer_name || ENTREPRISE_INCONNUE,
    title: j.job_title || '',
    location: [j.job_city, j.job_country].filter(Boolean).join(', '),
    remote_declared: j.job_is_remote === true,
    remote_basis: 'work_from_home de Google for Jobs via JSearch',
    company_hq: '',
    skills_required: '',
    description: stripHtml(j.job_description || '').slice(0, 400),
    ...fullDescriptionField(j.job_description),
    salary_range: range(j.job_min_salary, j.job_max_salary, j.job_salary_currency || ''),
    link: j.job_apply_link,
    date_published: toIsoDay(j.job_posted_at_datetime_utc) || toIsoDay(j.job_posted_at_timestamp),
    source: 'JSearch (Google for Jobs)'
  })));
}

module.exports = { fetchJobdatalakeLive, fetchApifyAtsLive, fetchAdzunaLive, fetchJsearchLive, adzunaOptions, adzunaUrl, ADZUNA_DEFAULTS };
