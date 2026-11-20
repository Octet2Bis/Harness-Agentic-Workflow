/**
 * apify_fetcher.js — Acteur Apify greentools~ats-jobs-api en deux temps (lancement, puis collecte)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * L'acteur balaie les pages carrières d'une liste d'entreprises (pas de recherche globale) : on lui
 * passe un bloc tournant de 120 careers_url issues de verified_remote_companies.json (curseur
 * `apify_companies_cursor` dans source_state.json). Un run de 120 sites dépasse un appel synchrone :
 * cycle N lance le run et mémorise `apify_run_id`, cycle N+1 relève le dataset quand le run a réussi.
 * Coût indicatif : ≈ 4 $ pour 1 000 offres conservées ; `onlyNewJobs` limite la facture.
 * Jamais de jeton ici : il vient des options (lu par index.js dans .secrets/.env sous APIFY_TOKEN).
 */

const fs = require('node:fs');
const path = require('node:path');
const { hashStr, stripHtml, toIsoDay, ENTREPRISE_INCONNUE } = require('./common');
const { request, parseJsonBody } = require('./request');
const { readSourceState, writeSourceState } = require('./source_state');
const { fullDescriptionField } = require('./full_description');

const RUNS_URL = 'https://api.apify.com/v2/acts/greentools~ats-jobs-api/runs?timeout=1500&memory=1024';
const RUN_INFO_URL = 'https://api.apify.com/v2/actor-runs/';
const BLOCK_SIZE = 120;
const COMPANIES_FILE = 'verified_remote_companies.json';
const KEYWORD_ALLOW = ['growth', 'marketing', 'acquisition', 'crm', 'lifecycle', 'demand', 'gtm', 'revops', 'revenue',
  'performance', 'paid', 'sea', 'ppc', 'automation', 'hubspot', 'email', 'retention', 'b2b', 'operations'];

// Mots simples distincts des requêtes de la taxonomie, restreints à la liste blanche ci-dessus.
function keywordsFrom(queries = []) {
  const words = new Set();
  for (const q of queries) for (const w of q.toLowerCase().split(/[^a-z0-9]+/)) if (KEYWORD_ALLOW.includes(w)) words.add(w);
  return [...words];
}

function baseInput(queries) {
  return { keywords: keywordsFrom(queries), workplace: 'remote', postedWithinDays: 2, onlyNewJobs: true, stateKey: 'master-plan-radar',
    includeDescription: true, maxJobsPerCompany: 20, maxConcurrency: 10, dedupe: true, discoverCompanies: true };
}

function loadCompanies(careerDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(careerDir, COMPANIES_FILE), 'utf8'));
    return (Array.isArray(list) ? list : []).map(c => c && c.careers_url).filter(Boolean);
  } catch { return []; }
}

const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');

function mapItem(i) {
  const url = first(i.applyUrl, i.url, i.jobUrl);
  // La page de l'annonce, quand l'ATS la distingue du formulaire (Workday : …/job/… contre …/apply) :
  // career-triage la lit d'abord (JSON-LD JobPosting), `link` reste le lien de candidature.
  const page = first(i.url, i.jobUrl);
  const title = first(i.title, i.name);
  if (!url || !title) return null;
  const workplace = first(i.remoteType, i.workplaceType, i.remote, i.isRemote);
  const location = Array.isArray(i.locations) ? i.locations.join(', ') : first(i.location, '');
  return {
    id: `APF-${hashStr(url)}`,
    company: first(i.company, i.companyName, i.company_name) || ENTREPRISE_INCONNUE,
    title,
    location,
    remote_declared: workplace === true || String(workplace || '').toLowerCase() === 'remote',
    remote_basis: 'champ workplace/remoteType de l’ATS (via Apify)',
    company_hq: '',
    skills_required: first(i.department, ''),
    description: stripHtml(first(i.description, '')).slice(0, 400),
    ...fullDescriptionField(first(i.description, i.descriptionHtml, i.descriptionText, '')),
    salary_range: null,
    link: url,
    ...(page && page !== url ? { posting_url: page } : {}),
    date_published: toIsoDay(first(i.postedAt, i.publishedAt, i.datePosted, i.createdAt)),
    source: 'Apify ATS'
  };
}

async function fetchApifyAtsLive(endpoint, opts = {}) {
  const { token, input = {}, queries = [], careerDir = path.resolve(__dirname, '../../../Workspace/career') } = opts;
  const send = opts.request || request;
  const readState = opts.readState || (() => readSourceState(careerDir));
  const writeState = opts.writeState || (st => writeSourceState(careerDir, st));
  if (!token) return { status: 'clé absente (APIFY_TOKEN)', jobs: [] };
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  const state = readState();
  const jobs = [];
  let note = '';

  if (state.apify_run_id) {
    const run = parseJsonBody(await send(`${RUN_INFO_URL}${state.apify_run_id}`, { headers, timeoutMs: 10000 }));
    if (!run.data) return { status: run.status, jobs: [] }; // réseau indisponible : on réessaiera au prochain cycle
    const runStatus = run.data.data?.status;
    if (runStatus === 'RUNNING' || runStatus === 'READY') return { status: 'run Apify en cours', jobs: [] };
    if (runStatus === 'SUCCEEDED') {
      const items = parseJsonBody(await send(`${RUN_INFO_URL}${state.apify_run_id}/dataset/items?clean=true&format=json`, { headers, timeoutMs: 20000 }));
      for (const i of Array.isArray(items.data) ? items.data : []) { const j = mapItem(i); if (j) jobs.push(j); }
      note = `OK · run terminé (${jobs.length} offres)`;
    } else {
      note = `run précédent ${runStatus || 'inconnu'}`;
    }
    delete state.apify_run_id;
    writeState(state);
  }

  const companies = opts.companies || loadCompanies(careerDir);
  if (companies.length === 0) return { status: note || `liste d'entreprises absente (${COMPANIES_FILE})`, jobs };
  const cursor = (Number(state.apify_companies_cursor) || 0) % companies.length;
  const block = Array.from({ length: Math.min(BLOCK_SIZE, companies.length) }, (_, k) => companies[(cursor + k) % companies.length]);
  const body = { ...baseInput(queries), ...input, companies: block };
  // offre_age_max_jours du candidat : ne fait que resserrer postedWithinDays (2 par défaut), jamais l'élargir.
  if (Number(opts.maxAgeDays) > 0) body.postedWithinDays = Math.min(Number(body.postedWithinDays) || Number(opts.maxAgeDays), Number(opts.maxAgeDays));
  const launched = parseJsonBody(await send(endpoint || RUNS_URL, { method: 'POST', headers, body, timeoutMs: 15000 }));
  const runId = launched.data?.data?.id;
  if (!runId) return { status: note ? `${note} · relance refusée (${launched.status})` : launched.status, jobs };
  state.apify_run_id = runId;
  state.apify_companies_cursor = (cursor + block.length) % companies.length;
  writeState(state);
  const totalBlocks = Math.ceil(companies.length / BLOCK_SIZE);
  const blockNo = Math.floor(cursor / BLOCK_SIZE) + 1;
  return { status: `${note ? `${note} · ` : ''}run lancé (${block.length} entreprises, bloc ${blockNo}/${totalBlocks})`, jobs };
}

module.exports = { fetchApifyAtsLive, keywordsFrom, baseInput, mapItem, BLOCK_SIZE };
