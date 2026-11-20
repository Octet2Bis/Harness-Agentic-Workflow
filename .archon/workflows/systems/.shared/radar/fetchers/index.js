/**
 * index.js — Dispatcher Multi-Sources (Pilier 02)
 * Rôle : Lit job_sources.json, interroge les connecteurs actifs, journalise
 *        { status, count, durée } par source et filtre sur les requêtes cibles.
 */

const fs = require('node:fs');
const path = require('node:path');

const common = require('./common');
const { request } = require('./request');
const { readSourceState, writeSourceState, minutesUntilAllowed } = require('./source_state');
const { fetchLinkedInLive } = require('./linkedin_fetcher');
const {
  fetchHimalayasLive,
  fetchWorkingNomadsLive,
  fetchRemoteOKLive,
  fetchRemotiveLive,
  fetchArbeitnowLive
} = require('./api_fetchers');
const {
  fetchJobspressoLive,
  fetchWeWorkRemotelyLive
} = require('./rss_fetchers');
const { fetchFirecrawlJobs } = require('./firecrawl_fetcher');
const { fetchAtsBoardsLive, planUniverseCycle } = require('./ats_boards');
const { fetchFreehireLive, fetchWorkableSearchLive } = require('./extra_fetchers');
const { sourceQueries, takeQueries } = require('./query_picker');
const {
  fetchJobgetherLive,
  fetchGrowthTalentLive,
  fetchJobicyLive,
  fetchEuRemoteJobsLive,
  fetchWttjTeletravailLive,
  jobgetherQueries
} = require('./board_fetchers');
const {
  fetchJobdatalakeLive,
  fetchApifyAtsLive,
  fetchAdzunaLive,
  fetchJsearchLive,
  adzunaOptions
} = require('./key_fetchers');

const ENV_PATH = path.resolve(__dirname, '../../../.secrets/.env');
const ENV_KEY_NAMES = ['JOBDATALAKE_API_KEY', 'APIFY_TOKEN', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JSEARCH_API_KEY', 'FIRECRAWL_API_KEY'];

function loadJsonSafe(filePath) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

// Ne lit que les variables demandées (KEY=valeur, guillemets tolérés) ; les valeurs ne sont jamais journalisées.
// `envPath` : un chemin, ou une liste de chemins lus dans l'ordre (le premier qui donne la variable gagne).
function readEnvKeys(envPath, names = []) {
  const keys = {};
  for (const file of Array.isArray(envPath) ? envPath : [envPath]) {
    let text = '';
    try { text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; } catch { continue; }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !names.includes(m[1]) || keys[m[1]]) continue;
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
      if (value) keys[m[1]] = value;
    }
  }
  return keys;
}

// Les clés par nom : l'environnement du processus d'abord, puis les fichiers d'env dans l'ordre.
function resolveKeys(names, envPath, env = process.env) {
  const fromFiles = readEnvKeys(envPath, names);
  const keys = {};
  for (const name of names) {
    const fromEnv = typeof env[name] === 'string' ? env[name].trim() : '';
    if (fromEnv) keys[name] = fromEnv;
    else if (fromFiles[name]) keys[name] = fromFiles[name];
  }
  return keys;
}

const DEFAULT_CORE_DOMAINS = [
  'growth', 'marketing', 'acquisition', 'gtm', 'revops', 'demand generation',
  'lead generation', 'inbound', 'outbound', 'traffic manager', 'conversion', 'crm',
  'lifecycle', 'product marketing', 'sales ops', 'market analyst', 'operations',
  // 2026-10-23 : Product Ops et l'emailing sont des cibles cœur d'Antoine.
  'product ops', 'email', 'retention', 'hubspot', 'martech',
  // 2026-11-14 (Antoine : Canonical et PostHog sont « exactement le cœur de cible ») : métiers voisins.
  'marketer', 'sales', 'enablement', 'customer success', 'community', 'communication', 'brand', 'partnership', 'business development', 'business developer', 'developer relations', 'devrel', 'social media', 'go-to-market', 'commercial', 'croissance', 'acquisition'
];

// Minuscules sans accents : « Chargé » et « charge », « Opérations » et « operations » se valent.
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Mots d'une requête qui ne disent rien du métier (« chargé de revops » : « de »).
const FILLER = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'en', 'et', 'and', 'of', 'the', 'for', 'with', 'h/f', 'f/h']);
// Un mot (ou une expression) entier du titre, au pluriel ou au féminin près (« chargée », « specialists »).
const hasWord = (text, w) => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e|s|es)?(?![a-z0-9])`).test(text);

// `coreDomains` : les mots de domaine du candidat (`core_domains` de sa taxonomie), sinon ceux d'Antoine.
// Avant le 2026-10-23, la priorité 1 exigeait que TOUS les mots de la requête aient plus de 3 lettres
// (« crm manager », « chargé de revops » ne pouvaient jamais correspondre) ; les mots de liaison sont
// désormais ignorés, les autres doivent tous être des mots entiers du titre (« seo » ne prend plus « Seoul »).
function matchesAnyTargetQuery(job, queries = [], coreDomains = DEFAULT_CORE_DOMAINS) {
  if (!queries || queries.length === 0) return true;
  const full = fold(`${job.title} ${job.skills_required || ''} ${job.description || ''}`);
  const titleLower = fold(job.title);

  // Priorité 0 : Le titre contient un mot-clé cœur de domaine (Growth, Marketing, GTM, RevOps...)
  if (coreDomains.some(d => titleLower.includes(fold(d)))) return true;

  // Priorité 1 : Le titre correspond directement à un intitulé ou à tous ses mots significatifs
  const matchedInTitle = queries.some(q => {
    const ql = fold(q).trim();
    if (ql === '') return false;
    if (hasWord(titleLower, ql)) return true;
    const words = ql.split(/[^a-z0-9/]+/).filter(w => w.length > 1 && !FILLER.has(w));
    return words.length > 0 && words.every(w => hasWord(titleLower, w));
  });
  if (matchedInTitle) return true;

  // Priorité 2 : Le corps mentionne l'intitulé exact
  return queries.some(q => fold(q).trim() !== '' && hasWord(full, fold(q).trim()));
}

// Apify lit l'état au lancement de son appel (avant que le répartiteur n'y écrive les horodatages
// du cycle) et l'écrit après ses appels réseau : écrire son instantané entier effaçait les
// horodatages et les curseurs posés entre-temps (Adzuna rappelé à chaque cycle). Seules ses
// propres clés sont donc réécrites, sur l'état relu au moment d'écrire.
const APIFY_STATE_KEYS = ['apify_run_id', 'apify_companies_cursor'];
function writeApifyState(careerDir, st) {
  const current = readSourceState(careerDir);
  for (const k of APIFY_STATE_KEYS) {
    if (st[k] === undefined) delete current[k];
    else current[k] = st[k];
  }
  return writeSourceState(careerDir, current);
}

async function runSource(name, run) {
  const start = Date.now();
  try {
    const { status, jobs } = await run();
    return { report: { name, status, count: (jobs || []).length, duration_ms: Date.now() - start }, jobs: jobs || [] };
  } catch (e) {
    return { report: { name, status: `erreur : ${e.message}`, count: 0, duration_ms: Date.now() - start }, jobs: [] };
  }
}

// Cadence : une source dotée de min_interval_min n'est rappelée qu'une fois l'intervalle écoulé ;
// l'horodatage est posé que l'appel réussisse ou non (une clé en échec ne martèle pas l'API).
function skippedReport(name, waitMin) {
  return { report: { name, status: `attente (prochain appel dans ${waitMin} min)`, count: 0, duration_ms: 0 }, jobs: [] };
}

async function fetchAllActiveSources(options = {}) {
  const careerDir = options.careerDir || path.resolve(__dirname, '../../../Workspace/career');
  const get = options.fetchUrl || common.fetchUrl;
  const send = options.request || request;
  const getWith = (url, opts = {}) => send(url, { ...opts, method: 'GET' });
  // `sourcesConfig` / `taxonomy` passés en option remplacent la lecture du dossier carrière
  // (career-radar : fichier de sources par défaut du système, filtre `sources`).
  const sourcesConfig = options.sourcesConfig || loadJsonSafe(path.join(careerDir, 'job_sources.json')) || { sources: [] };
  const taxonomy = options.taxonomy || loadJsonSafe(path.join(careerDir, 'career_taxonomy.json')) || { search_queries: [] };
  const queries = taxonomy.search_queries || [];
  // Les sources par mot-clé lisent `source_queries` (intitulés cœur, en anglais), avec un curseur tournant.
  const keywordQueries = sourceQueries(taxonomy);
  // Le filtre de pertinence accepte les deux listes.
  const targetQueries = [...new Set([...queries, ...keywordQueries])];
  const coreDomains = Array.isArray(taxonomy.core_domains) && taxonomy.core_domains.length > 0 ? taxonomy.core_domains.map(d => String(d).toLowerCase()) : DEFAULT_CORE_DOMAINS;
  const keys = resolveKeys(ENV_KEY_NAMES, options.envPath || ENV_PATH, options.env || process.env);
  const state = readSourceState(careerDir);
  const now = options.now || Date.now();
  // offre_age_max_jours du candidat (career-radar) : passé aux filtres de fraîcheur côté source qui
  // en ont un (Adzuna max_days_old, Apify postedWithinDays, Jobdatalake {since_ms}), qu'il ne fait
  // que resserrer ; 0 ou absent : les fenêtres de chaque source telles quelles. LinkedIn (f_TPR 24 h)
  // et les flux filtrés à 48 h côté client restent plus stricts ; le crible tranche ensuite.
  const maxAgeDays = Number(options.maxAgeDays) > 0 ? Number(options.maxAgeDays) : 0;
  let stateDirty = false;

  const findSource = (namePattern) => sourcesConfig.sources.find(src => src.name.toLowerCase().includes(namePattern.toLowerCase()));
  // Une source absente de la configuration compte pour active (VM) ; `onlyListed: true`
  // (career-radar) ne fait tourner que celles qui y figurent avec `enabled: true`.
  const isEnabled = (namePattern) => {
    const s = findSource(namePattern);
    return s ? Boolean(s.enabled) : !options.onlyListed;
  };
  const getEndpoint = (namePattern) => findSource(namePattern)?.endpoint;
  const getTemplate = (namePattern) => findSource(namePattern)?.url_template;

  const tasks = [];
  const add = (name, run, entry) => {
    const stateKey = entry?.name || name;
    const waitMin = minutesUntilAllowed(state[stateKey], entry?.min_interval_min, now);
    if (waitMin > 0) return tasks.push(Promise.resolve(skippedReport(name, waitMin)));
    if (entry?.min_interval_min) { state[stateKey] = new Date(now).toISOString(); stateDirty = true; }
    tasks.push(runSource(name, run));
  };
  const addIf = (pattern, label, run) => { if (isEnabled(pattern)) add(label, run, findSource(pattern)); };
  // Sources ajoutées le 2026-10-24 (Freehire, Workable search, Tableaux employeurs) : jamais par défaut,
  // seulement quand job_sources.json les liste avec `enabled: true` (la VM, qui ne les liste pas, n'en voit rien).
  const addIfListed = (pattern, label, run) => { const s = findSource(pattern); if (s && s.enabled) add(label, run, s); };
  // Les requêtes du cycle pour une source par mot-clé (appelé dans `run`, donc seulement quand la
  // source tourne, avant l'écriture de l'état ci-dessous) : la liste tournée, curseur avancé de `n`.
  const queriesFor = (pattern, list, n) => {
    const key = findSource(pattern)?.name || pattern;
    stateDirty = true;
    return takeQueries(state, key, list, n);
  };

  // LinkedIn désactivé par décision d'Antoine (29/09) : l'endpoint jobs-guest
  // sous User-Agent de navigateur est contraire aux CGU et expose l'IP de la VM.
  // Réactivation explicite seulement : CAREER_LINKEDIN=on, en plus de job_sources.json.
  const linkedinOptIn = process.env.CAREER_LINKEDIN === 'on';
  if (linkedinOptIn) addIf('linkedin', 'LinkedIn', () => fetchLinkedInLive(queries, { careerDir, fetchUrl: get, jitterMs: options.jitterMs, knownLinks: options.knownLinks, source: findSource('linkedin') }));
  addIf('himalayas', 'Himalayas', () => fetchHimalayasLive(getEndpoint('himalayas'), get));
  addIf('working nomads', 'Working Nomads', () => fetchWorkingNomadsLive(getEndpoint('working nomads'), get));
  addIf('remoteok', 'RemoteOK', () => fetchRemoteOKLive(getEndpoint('remoteok'), get));
  addIf('remotive', 'Remotive', () => fetchRemotiveLive(getEndpoint('remotive'), get));
  addIf('arbeitnow', 'Arbeitnow', () => fetchArbeitnowLive(getEndpoint('arbeitnow'), get));
  addIf('jobspresso', 'Jobspresso', () => fetchJobspressoLive(getEndpoint('jobspresso'), get));
  const wwr = findSource('weworkremotely') || findSource('we work remotely');
  if (wwr ? wwr.enabled : !options.onlyListed) add('WeWorkRemotely', () => fetchWeWorkRemotelyLive(wwr?.endpoint, get), wwr);
  addIf('firecrawl', 'Firecrawl', () => fetchFirecrawlJobs(queries[0] || 'growth marketing', options.firecrawlApiKey || keys.FIRECRAWL_API_KEY));
  // Sources sans clé (v2.1.0)
  addIf('jobgether', 'Jobgether', () => fetchJobgetherLive(getTemplate('jobgether'), queriesFor('jobgether', jobgetherQueries(keywordQueries, Infinity), 6), get, options.jobgetherPauseMs));
  addIf('growth.talent', 'Growth.Talent', () => fetchGrowthTalentLive(findSource('growth.talent')?.endpoints || getEndpoint('growth.talent'), get));
  addIf('jobicy', 'Jobicy', () => fetchJobicyLive(getEndpoint('jobicy'), get));
  addIf('eu remote jobs', 'EU Remote Jobs', () => fetchEuRemoteJobsLive(getEndpoint('eu remote jobs'), get));
  addIf('welcome to the jungle', 'WTTJ télétravail', () => fetchWttjTeletravailLive(getEndpoint('welcome to the jungle'), get));
  // Sources à clé : la clé vient de .secrets/.env par nom de variable, jamais du code ni de la config.
  addIf('jobdatalake', 'Jobdatalake', () => {
    const src = findSource('jobdatalake');
    const perCycle = Math.max(1, Number(src?.queries_max) || 2);
    const byKeyword = String(src?.endpoint || '').includes('{keyword}');
    return fetchJobdatalakeLive(getEndpoint('jobdatalake'), { apiKey: keys.JOBDATALAKE_API_KEY, get: getWith, now, maxAgeDays,
      queries: byKeyword ? queriesFor('jobdatalake', keywordQueries, perCycle) : [], queriesMax: perCycle });
  });
  addIf('apify', 'Apify ATS', () => fetchApifyAtsLive(getEndpoint('apify'), {
    token: keys.APIFY_TOKEN, input: findSource('apify')?.input || {}, queries: targetQueries, careerDir, request: send, maxAgeDays: 0,
    readState: () => readSourceState(careerDir), writeState: st => writeApifyState(careerDir, st)
  }));
  // Adzuna lit ses options (pays, lieux, nombre de requêtes, suffixe remote…) dans son entrée de job_sources.json.
  addIf('adzuna', 'Adzuna', () => fetchAdzunaLive(getTemplate('adzuna'), {
    appId: keys.ADZUNA_APP_ID, appKey: keys.ADZUNA_APP_KEY, get: getWith, source: findSource('adzuna'), maxAgeDays,
    queries: queriesFor('adzuna', keywordQueries, adzunaOptions(findSource('adzuna') || {}).queries_max)
  }));
  addIf('jsearch', 'JSearch', () => fetchJsearchLive(getTemplate('jsearch'), {
    apiKey: keys.JSEARCH_API_KEY, countries: findSource('jsearch')?.countries, get: getWith,
    queries: queriesFor('jsearch', keywordQueries, 2)
  }));

  // Freehire et Workable lisent par défaut avec leur propre client (UTF-8, User-Agent du projet) ;
  // un `fetchUrl` injecté (tests, fetch_module) le remplace pour qu'aucun appel réel ne parte.
  const injectedGet = options.fetchUrl || undefined;
  addIfListed('freehire', 'Freehire', () => fetchFreehireLive(getTemplate('freehire'), queriesFor('freehire', keywordQueries, 6), injectedGet, options.jobgetherPauseMs));
  addIfListed('workable search', 'Workable search', () => fetchWorkableSearchLive(getTemplate('workable search'), queriesFor('workable search', keywordQueries, 4), injectedGet, options.jobgetherPauseMs));

  // Tableaux publics des employeurs, lus métier d'abord (ats_boards.js) : le bloc d'univers du cycle est
  // choisi ici, de façon synchrone, pour que son curseur parte avec l'état écrit juste en dessous.
  addIfListed('tableaux employeurs', 'Tableaux employeurs', () => {
    const src = findSource('tableaux employeurs') || {};
    stateDirty = true;
    // Tableaux des employeurs : sans limite d'âge (ageLimitFor, offer-date.ts ; Antoine, 2026-11-14).
    return fetchAtsBoardsLive({ ...src, careerDir, get, now, maxAgeDays: 36500, pinned: src.boards, plan: planUniverseCycle(careerDir, state, src),
      titleMatch: j => matchesAnyTargetQuery(j, targetQueries, coreDomains) });
  });

  // L'état de cadence est écrit avant les appels (un plantage en cours de cycle ne relance pas tout) ;
  // Apify relit et complète le même fichier pendant son appel, d'où la relecture ci-dessous.
  if (stateDirty) writeSourceState(careerDir, { ...readSourceState(careerDir), ...state });

  const results = await Promise.all(tasks);
  const sources = results.map(r => r.report);
  const rawJobs = results.flatMap(r => r.jobs);

  // Filtrage sémantique in-memory pour toutes les offres non issues de requêtes précises
  const jobs = [];
  const seenUrls = new Set();

  for (const j of rawJobs) {
    if (!j || !j.link || !j.title) continue;
    const key = j.link.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    // LinkedIn a déjà été requêté par intitulé ciblé ; pour les autres, on valide la pertinence sémantique
    if (j.source.startsWith('LinkedIn') || matchesAnyTargetQuery(j, targetQueries, coreDomains)) {
      jobs.push(j);
    }
  }

  return { jobs, sources };
}

module.exports = {
  fetchAllActiveSources,
  matchesAnyTargetQuery,
  writeApifyState,
  DEFAULT_CORE_DOMAINS,
  readEnvKeys,
  resolveKeys,
  ENV_KEY_NAMES,
  readSourceState,
  writeSourceState,
  fetchJobgetherLive,
  fetchGrowthTalentLive,
  fetchJobicyLive,
  fetchEuRemoteJobsLive,
  fetchWttjTeletravailLive,
  fetchJobdatalakeLive,
  fetchApifyAtsLive,
  fetchAdzunaLive,
  fetchJsearchLive,
  fetchLinkedInLive,
  fetchHimalayasLive,
  fetchWorkingNomadsLive,
  fetchRemoteOKLive,
  fetchRemotiveLive,
  fetchArbeitnowLive,
  fetchJobspressoLive,
  fetchWeWorkRemotelyLive,
  fetchFirecrawlJobs,
  fetchAtsBoardsLive,
  fetchFreehireLive,
  fetchWorkableSearchLive
};
