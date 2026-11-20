/**
 * ats_boards.js — Tableaux publics des employeurs (Greenhouse, Lever, Ashby), lus métier d'abord
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Au lieu d'attendre qu'un agrégateur reprenne une offre (souvent en retard, souvent un repost), on lit
 * directement les tableaux d'offres publics des entreprises. L'« univers » est la liste des identifiants
 * de tableaux publiée par Feashliaa/job-board-aggregator (CC BY-NC 4.0 : usage personnel, attribution
 * dans THIRD_PARTY.md), téléchargée dans <career>/radar_universe.json et rafraîchie chaque semaine.
 * Chaque cycle lit un bloc tournant de l'univers (curseur `ats_universe_cursor` dans source_state.json),
 * plus les tableaux « appris » (un poste du métier y est déjà apparu : <career>/radar_boards_learned.json)
 * et les tableaux épinglés (`boards` de l'entrée, <career>/next40_boards.json, ou ../next40_boards.json :
 * Next40/120, relevé le 2026-10-24). On ne garde que les
 * postes remote, du métier (titre) et récents ; le crible (remote_auditor, geo.js) tranche ensuite.
 * Idée et mesures reprises de JobCampaign (universe_scan.py, discover.py) : slugs Lever sensibles à la
 * casse, slugs Ashby avec espaces. API publiques sans clé, une requête par tableau, jamais de connexion.
 *
 * Entreprises full remote (Antoine, 2026-11-08, après l'annonce PostHog « developer marketer, sales »
 * jamais captée ; puis « toutes les entreprises avec des jobs en full télétravail ») : tout tableau lu
 * qui a au moins un poste remote (jamais hybride) entre dans <career>/remote_companies.json, avec
 * `kind` : `full` (au moins `remote_min_jobs` postes dont `remote_share` remote, ou listé à la main
 * dans <career>/entreprises_full_remote.json et ../entreprises_full_remote.json, mêmes clés que
 * next40_boards.json) ou `partiel` (quelques postes remote). Ses postes ouverts d'une famille large
 * (marketing, growth, vente, produit, design, QA, ops… : FAMILY_RE ; remote pour `partiel`, tous sauf
 * hybrides pour `full` ; jamais réservés à une zone hors Europe ; un titre répété pour plusieurs
 * lieux une seule fois) vont dans <career>/remote_company_jobs.json, à part du tableau, quel que soit
 * le crible ou le tri. Les `full` sont relus toutes les `remote_refresh_hours` heures
 * (`remote_max_per_cycle` par cycle, les plus anciens d'abord) ; les `partiel`, quand le bloc tournant
 * de l'univers repasse ; une entreprise non relue depuis `remote_forget_days` jours sort du registre.
 * L'index des entreprises 100 % remote d'Antoine (<career>/verified_remote_companies.json, écrit par
 * remote_company_indexer.js de Master Plan : id, name, careers_url, remote_status) entre aussi : son
 * tableau Greenhouse, Lever ou Ashby est cherché (lien de la page carrières, sinon l'id et le nom
 * essayés comme identifiants de tableau ; `index_probe_per_cycle` entreprises par cycle, résultat dans
 * <career>/remote_index_ats.json, réessai après `index_retry_days` jours) ; trouvé, il est lu comme une
 * entreprise listée à la main ; déjà lu par le radar sous un de ces identifiants, il est pris sans
 * requête ; introuvable (ou pas encore cherché : `probed: false`), l'entreprise reste dans le
 * registre sans postes (`board: false`, sa page carrières à lire soi-même). Une recherche gênée par
 * une panne (délai, 429, 5xx) est refaite le lendemain.
 */

const fs = require('node:fs');
const path = require('node:path');
const common = require('./common');
const { hashStr, toIsoDay } = common;
const { fullDescriptionField, htmlToText } = require('./full_description');
const { evaluateTerritory } = require('../inspectors/remote_auditor');

const UNIVERSE_URL = 'https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/main/data/{ats}_companies.json';
const ATSES = ['greenhouse', 'lever', 'ashby'];
const UNIVERSE_FILE = 'radar_universe.json';
const LEARNED_FILE = 'radar_boards_learned.json';
const PINNED_FILE = 'next40_boards.json';
const SYSTEM_PINNED = path.join(__dirname, '..', PINNED_FILE);
const REMOTE_COMPANIES_FILE = 'remote_companies.json';
const REMOTE_JOBS_FILE = 'remote_company_jobs.json';
const MANUAL_REMOTE_FILE = 'entreprises_full_remote.json';
const INDEX_FILE = 'verified_remote_companies.json';
const INDEX_ATS_FILE = 'remote_index_ats.json';
const SYSTEM_MANUAL_REMOTE = path.join(__dirname, '..', MANUAL_REMOTE_FILE);
const CURSOR_KEY = 'ats_universe_cursor';
const DEFAULTS = {
  boards_per_cycle: 240, concurrency: 6, learned_max: 80, refresh_days: 7, timeout_ms: 8000, details_max: 25,
  remote_min_jobs: 3, remote_share: 0.9, remote_refresh_hours: 6, remote_max_per_cycle: 60, remote_jobs_max: 80, remote_forget_days: 21,
  index_probe_per_cycle: 25, index_retry_days: 30
};
// Les métiers qu'Antoine peut viser dans une entreprise full remote, au sens large : le titre seul
// suffit (une annonce comme « Developer marketer, sales » chez PostHog ne passe pas les requêtes du métier).
const FAMILY_RE = /market|growth|sales|revenue|\bgtm\b|go[- ]to[- ]market|business development|\b[bs]dr\b|partner|alliance|community|content|brand|demand|lifecycle|\bcrm\b|\bseo\b|\bsem\b|customer|account (executive|manager|director)|devrel|developer (relations|advocate|experience|educat)|advoca|evangel|operations|\b(rev|biz|sales|marketing|gtm)\s?ops\b|product (manager|market|owner|operations|ops|analyst|lead|specialist|led)|design|\bux\b|\bui\b|user research|\bqa\b|quality|\btest|project|program|onboarding|enablement|solutions|implementation|social|communication|\bpr\b|event|e-?commerce|copywrit|writer|editor|commercial|chef de projet|charg[ée]e? d|responsable|croissance/i;
const LEARNED_KEEP = 400; // le fichier des tableaux appris garde les plus récents
const LABEL = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

// Les slugs viennent d'un fichier tiers et finissent dans une URL : Lever garde la casse (AIFund ≠ aifund),
// Ashby admet l'espace (« hamming ai »), Greenhouse est en minuscules ; rien d'autre ne passe.
const SLUG_RE = {
  greenhouse: /^[a-z0-9][a-z0-9_.-]{0,79}$/,
  lever: /^[A-Za-z0-9][A-Za-z0-9_.&-]{0,79}$/,
  ashby: /^[a-z0-9][a-z0-9 _.-]{0,79}$/
};
const cleanSlug = (ats, s) => {
  if (typeof s !== 'string') return '';
  const v = ats === 'lever' ? s.trim() : s.trim().toLowerCase();
  return SLUG_RE[ats] && SLUG_RE[ats].test(v) && !v.includes('..') ? v : '';
};

const HYBRID_WORDS = /\bhybride?\b|\bpartial(ly)? remote\b|\bsemi[- ]remote\b|\bremote[- ]friendly\b|\bflex(ible)? (office|location)\b/i;
// Le lieu d'un poste dit-il le télétravail ? (2026-11-14 : toutes les façons de l'écrire que voient les tableaux.)
const REMOTE_WORDS = /\b(remote|anywhere|worldwide|global|virtual|work from home|wfh|distributed|home[- ]based|home|location[- ]independent|location[- ]agnostic|telework\w*|telecommut\w*|remoto|remota|teletrabajo|teletrabalho|zdalnie|nomad)\b|t[ée]l[ée]travail|[àa] distance|distanciel|100 ?% ?(remote|t[ée]l[ée]travail)/i;

function readJson(file, fallback) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch { return fallback; }
}
function writeJson(file, value) {
  try { fs.writeFileSync(file, JSON.stringify(value, null, 1), 'utf8'); return true; } catch { return false; }
}

// La liste des tableaux d'une entrée de données ({ greenhouse: [...], lever: [...] }) → [{ ats, slug }].
function boardsFrom(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  for (const ats of ATSES) for (const s of Array.isArray(data[ats]) ? data[ats] : []) {
    const slug = cleanSlug(ats, s);
    if (slug) out.push({ ats, slug });
  }
  return out;
}

function universeAgeDays(universe, now) {
  const t = new Date(universe?._meta?.date || 0).getTime();
  return Number.isNaN(t) || t === 0 ? Infinity : (now - t) / 86400000;
}

// Partie synchrone du cycle (appelée avant l'écriture de source_state.json par le répartiteur) :
// le bloc d'univers à lire, curseur avancé dans `state`. Sans univers lisible, bloc vide (téléchargé ensuite).
function planUniverseCycle(careerDir, state, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const universe = readJson(path.join(careerDir, UNIVERSE_FILE), null);
  const all = boardsFrom(universe);
  if (all.length === 0) return { block: [], total: 0, cursor: 0 };
  let cursor = Number(state[CURSOR_KEY]) || 0;
  if (cursor >= all.length || cursor < 0) cursor = 0;
  const block = all.slice(cursor, cursor + o.boards_per_cycle);
  state[CURSOR_KEY] = cursor + block.length >= all.length ? 0 : cursor + block.length;
  return { block, total: all.length, cursor };
}

// Télécharge les listes d'identifiants (une par ATS). Une liste vide ou illisible n'écrase jamais l'ancienne.
async function refreshUniverse(careerDir, get, now = Date.now()) {
  const file = path.join(careerDir, UNIVERSE_FILE);
  const old = readJson(file, {}) || {};
  const next = { _meta: { source: UNIVERSE_URL, licence: 'CC BY-NC 4.0 (Feashliaa/job-board-aggregator), usage personnel', date: new Date(now).toISOString() } };
  let fetched = 0;
  for (const ats of ATSES) {
    const res = await get(UNIVERSE_URL.replace('{ats}', ats), 60000);
    let list = null;
    try { list = res.status === 200 ? JSON.parse(res.data) : null; } catch { list = null; }
    const slugs = Array.isArray(list) ? [...new Set(list.map(s => cleanSlug(ats, s)).filter(Boolean))].sort() : [];
    if (slugs.length > 0) { next[ats] = slugs; fetched++; } else if (Array.isArray(old[ats])) next[ats] = old[ats];
  }
  if (fetched === 0) return { ok: false, universe: old };
  writeJson(file, next);
  return { ok: true, universe: next };
}

const enc = s => encodeURIComponent(s);
// La page carrières publique du tableau (pour un humain), pas l'API.
function careersUrl(ats, slug) {
  if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${enc(slug)}`;
  if (ats === 'lever') return `https://jobs.lever.co/${enc(slug)}`;
  return `https://jobs.ashbyhq.com/${enc(slug)}`;
}
function boardUrl(ats, slug) {
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${enc(slug)}/jobs`;
  if (ats === 'lever') return `https://api.lever.co/v0/postings/${enc(slug)}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${enc(slug)}`;
}

// Un tableau → postes normalisés { id, title, url, location, remote, posted, company, html }.
// Greenhouse sans `content` (liste légère) : le texte des postes retenus est relu ensuite, un par un.
function parseBoard(ats, slug, data) {
  if (ats === 'greenhouse') {
    return (data?.jobs || []).map(j => ({
      id: String(j.id || ''), title: j.title || '', url: j.absolute_url || '', location: j.location?.name || '',
      remote: REMOTE_WORDS.test(j.location?.name || ''), hybrid: HYBRID_WORDS.test(j.location?.name || ''), posted: j.first_published || j.updated_at || '',
      company: j.company_name || '', html: j.content || ''
    }));
  }
  if (ats === 'lever') {
    return (Array.isArray(data) ? data : []).map(j => {
      const c = j.categories || {};
      const loc = c.location || (c.allLocations || []).join(' / ');
      const lists = (j.lists || []).map(l => `<h3>${l.text || ''}</h3>${l.content || ''}`).join('');
      return {
        id: String(j.id || ''), title: j.text || '', url: j.hostedUrl || '', location: loc,
        remote: j.workplaceType === 'remote' || REMOTE_WORDS.test(loc), hybrid: j.workplaceType === 'hybrid' || HYBRID_WORDS.test(loc), posted: j.createdAt || '',
        company: '', html: `${j.description || ''}${lists}${j.additional || ''}`
      };
    });
  }
  return (data?.jobs || []).map(j => {
    const locs = [...new Set([j.location, ...(j.secondaryLocations || []).map(s => s.location)].filter(Boolean))];
    return {
      id: String(j.id || ''), title: j.title || '', url: j.jobUrl || j.applyUrl || '', location: locs.join(' ; '),
      remote: Boolean(j.isRemote) || j.workplaceType === 'Remote', hybrid: j.workplaceType === 'Hybrid',
      posted: j.publishedAt || '', company: '', html: j.descriptionHtml || j.descriptionPlain || ''
    };
  });
}

const prettySlug = s => s.replace(/[-_.]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const radarId = (ats, p) => `ATS-${ats.slice(0, 2).toUpperCase()}-${p.id || hashStr(p.url)}`;

function toRadarJob(ats, slug, p, day, html) {
  const text = htmlToText(html).replace(/\s+/g, ' ');
  return {
    id: radarId(ats, p),
    company: p.company || prettySlug(slug),
    title: p.title,
    location: p.location || '',
    remote_declared: true,
    remote_basis: p.remote && ats !== 'greenhouse' ? `poste marqué remote sur le tableau ${LABEL[ats]} de l'employeur` : `localisation « ${p.location} » du tableau ${LABEL[ats]} de l'employeur`,
    company_hq: '',
    skills_required: '',
    description: text.slice(0, 400),
    ...fullDescriptionField(html),
    salary_range: null,
    link: p.url,
    date_published: day,
    source: `Tableaux employeurs (${LABEL[ats]})`
  };
}

// ── Entreprises full remote ──────────────────────────────────────────────────────────
const boardKey = (ats, slug) => `${ats}:${slug}`;
const splitKey = k => { const [ats, ...rest] = String(k).split(':'); return { ats, slug: cleanSlug(ats, rest.join(':')) }; };

// Les tableaux listés à la main : <career>/entreprises_full_remote.json ∪ celui du système.
function manualRemoteBoards(careerDir, injected) {
  if (injected !== undefined) return boardsFrom(injected);
  const seen = new Set();
  return [...boardsFrom(careerDir ? readJson(path.join(careerDir, MANUAL_REMOTE_FILE), null) : null), ...boardsFrom(readJson(SYSTEM_MANUAL_REMOTE, null))]
    .filter(b => { const k = boardKey(b.ats, b.slug); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Les entreprises connues dont le tableau est à relire (dernière lecture plus vieille que remote_refresh_hours),
// les manuelles d'abord, puis les plus anciennes ; au plus remote_max_per_cycle.
// Les tableaux de l'index déjà trouvés mais absents du registre (jamais lus, ou oubliés) passent juste après les manuels.
function remoteBoardsDue(companies, manual, now, o, indexKeys = []) {
  const fresh = k => { const t = Date.parse(companies[k]?.last_read || ''); return !Number.isNaN(t) && now - t < o.remote_refresh_hours * 3600000; };
  const manualKeys = manual.map(b => boardKey(b.ats, b.slug));
  const unread = indexKeys.filter(k => !companies[k] && !manualKeys.includes(k));
  const known = Object.keys(companies).filter(k => !manualKeys.includes(k) && companies[k].kind !== 'partiel' && companies[k].board !== false)
    .sort((a, b) => String(companies[a].last_read || '').localeCompare(String(companies[b].last_read || '')));
  return [...manualKeys, ...unread, ...known].filter(k => !fresh(k)).slice(0, o.remote_max_per_cycle).map(splitKey).filter(b => b.slug);
}

/**
 * Un tableau lu : l'entreprise est-elle full remote (`full`), a-t-elle quelques postes remote
 * (`partiel`), ou rien (`listed: false` ; `drop` dit alors s'il faut la retirer du registre).
 * Assez de postes (remote_min_jobs) : la part remote décide de `full` ; trop peu : une entreprise
 * déjà `full` le reste (elle recrute peu, elle ne sort pas du registre).
 */
function remoteVerdict(posts, isManual, known, o) {
  const valid = posts.filter(p => p.title && p.url);
  const remote = valid.filter(p => p.remote && !p.hybrid).length;
  const hybrid = valid.filter(p => p.hybrid).length;
  const enough = valid.length >= o.remote_min_jobs;
  const full = isManual || (enough ? remote / valid.length >= o.remote_share : known?.kind === 'full' || (known && !known.kind));
  const listed = full || remote > 0;
  return { full, listed, drop: !listed && Boolean(known), total: valid.length, remote, hybrid };
}

// Les postes à garder : famille large (ou requêtes du métier) ; tous sauf hybrides chez une entreprise
// full remote (le tableau ne dit pas toujours « remote »), seulement les remote ailleurs ; jamais un
// poste réservé à une zone hors Europe (lieu ou titre : « Remote (US) », « Latin America », Colombie…,
// règle d'Antoine depuis le 2026-10-25, evaluateTerritory du crible) ; un même titre publié pour
// plusieurs lieux ne compte qu'une fois (`more` : les autres lieux).
function remoteCompanyJobs(ats, posts, previous, titleMatch, now, max, full = true) {
  const firstSeen = new Map((previous?.jobs || []).map(j => [j.id, j.first_seen]));
  const nowIso = new Date(now).toISOString();
  const keep = [];
  let others = 0;
  let outside = 0;
  for (const p of posts) {
    if (!p.title || !p.url || p.hybrid || (!full && !p.remote)) continue;
    const target = titleMatch({ title: p.title, description: '' });
    if (!target && !FAMILY_RE.test(p.title)) { others++; continue; }
    if (!evaluateTerritory({ location: `${p.location || ''} ${p.title}`, description: '' }).pass) { outside++; continue; }
    const id = radarId(ats, p);
    keep.push({ id, title: p.title, location: p.location || '', link: p.url, posted: toIsoDay(p.posted) || '', remote: Boolean(p.remote), target, first_seen: firstSeen.get(id) || nowIso });
  }
  keep.sort((a, b) => Number(b.target) - Number(a.target) || String(b.posted).localeCompare(String(a.posted)));
  const byTitle = new Map();
  for (const j of keep) {
    const k = j.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const first = byTitle.get(k);
    if (first) first.more = (first.more || 0) + 1; else byTitle.set(k, j);
  }
  const unique = [...byTitle.values()];
  return { jobs: unique.slice(0, max), others: others + Math.max(0, unique.length - max), outside_europe: outside };
}

// L'index d'Antoine : [{ id, name, careers_url, remote_status }] ; `injected` remplace le fichier (tests).
function readIndex(careerDir, injected) {
  const raw = injected !== undefined ? injected : (careerDir ? readJson(path.join(careerDir, INDEX_FILE), null) : null);
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).map(c => ({
    id: typeof c?.id === 'string' ? c.id.trim() : '',
    name: typeof c?.name === 'string' ? c.name.trim() : '',
    careers: typeof c?.careers_url === 'string' && /^https:\/\//i.test(c.careers_url) ? c.careers_url : '',
    status: typeof c?.remote_status === 'string' ? c.remote_status.slice(0, 160) : ''
  })).filter(c => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(c.id) && c.name && !seen.has(c.id) && seen.add(c.id));
}
// Le tableau que nomme une page carrières hébergée par l'ATS (jobs.ashbyhq.com/<org>, …).
function atsFromUrl(url) {
  const m = /^https:\/\/(?:jobs\.ashbyhq\.com\/([^/?#]+)|(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)|jobs\.lever\.co\/([^/?#]+))/i.exec(url || '');
  if (!m) return null;
  let raw = m[1] || m[2] || m[3];
  try { raw = decodeURIComponent(raw); } catch { return null; }
  const ats = m[1] ? 'ashby' : m[2] ? 'greenhouse' : 'lever';
  const slug = cleanSlug(ats, raw);
  return slug ? { ats, slug } : null;
}
// Les tableaux à essayer pour une entreprise de l'index : le lien d'abord, puis l'id et le nom collé, sur Ashby, Greenhouse, Lever.
function indexTries(c) {
  const tries = [];
  const add = t => { if (t && t.slug && !tries.some(x => x.ats === t.ats && x.slug === t.slug)) tries.push(t); };
  add(atsFromUrl(c.careers));
  const guesses = [...new Set([c.id.toLowerCase(), c.name.toLowerCase().replace(/[^a-z0-9]/g, '')])].filter(Boolean);
  for (const ats of ATSES.slice().reverse()) for (const g of guesses) add({ ats, slug: cleanSlug(ats, g) });
  return tries;
}

// Exécute `fn` sur chaque élément, `n` à la fois.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/**
 * Le cycle : bloc d'univers + tableaux appris + épinglés, dédoublonnés.
 * opts : { careerDir, plan (planUniverseCycle), titleMatch(job) → bool, maxAgeDays, now, get, pinned, ...DEFAULTS }
 * Rend { status, jobs, scanned, learned } ; ne lève jamais.
 */
async function fetchAtsBoardsLive(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const get = o.get || common.fetchUrl;
  const now = o.now || Date.now();
  const careerDir = o.careerDir;
  const maxAge = Number(o.maxAgeDays) > 0 ? Number(o.maxAgeDays) : 7;
  const titleMatch = typeof o.titleMatch === 'function' ? o.titleMatch : () => true;
  let plan = o.plan || { block: [], total: 0 };
  let status = 200;

  const universe = readJson(path.join(careerDir, UNIVERSE_FILE), null);
  if (!universe || universeAgeDays(universe, now) > o.refresh_days) {
    const r = await refreshUniverse(careerDir, get, now);
    // Premier téléchargement : le cycle lit déjà le début de la nouvelle liste.
    if (r.ok && plan.block.length === 0) plan = { block: boardsFrom(r.universe).slice(0, o.boards_per_cycle), total: boardsFrom(r.universe).length };
    if (!r.ok && plan.block.length === 0) status = 'univers indisponible (liste des tableaux non téléchargée)';
  }

  const learnedFile = path.join(careerDir, LEARNED_FILE);
  const learned = readJson(learnedFile, {}) || {};
  const learnedList = Object.entries(learned).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, o.learned_max)
    .map(([k]) => { const [ats, ...rest] = k.split(':'); return { ats, slug: cleanSlug(ats, rest.join(':')) }; }).filter(b => b.slug);
  // Épinglés : `boards` de l'entrée, sinon <career>/next40_boards.json, sinon la liste Next40/120 du système.
  const pinned = boardsFrom(o.pinned || readJson(path.join(careerDir, PINNED_FILE), null) || readJson(SYSTEM_PINNED, null));
  // Entreprises full remote : registre et annonces à part, tableaux à relire.
  const companiesFile = careerDir ? path.join(careerDir, REMOTE_COMPANIES_FILE) : null;
  const remoteJobsFile = careerDir ? path.join(careerDir, REMOTE_JOBS_FILE) : null;
  const companies = (companiesFile && readJson(companiesFile, null)?.companies) || {};
  const remoteJobs = (remoteJobsFile && readJson(remoteJobsFile, null)?.companies) || {};
  const manual = manualRemoteBoards(careerDir, o.manualRemote);
  const manualKeys = new Set(manual.map(b => boardKey(b.ats, b.slug)));
  // L'index d'Antoine : les entreprises dont le tableau est connu comptent comme listées à la main.
  const index = readIndex(careerDir, o.remoteIndex);
  const atsFile = careerDir ? path.join(careerDir, INDEX_ATS_FILE) : null;
  const atsMap = (atsFile && readJson(atsFile, null)) || {};
  const indexByKey = new Map();
  for (const c of index) {
    // Pas encore trouvée : un des tableaux qu'on essaierait est peut-être déjà lu (registre) ; on le prend sans requête.
    if (!atsMap[c.id]?.ats) {
      const known = indexTries(c).find(t => companies[boardKey(t.ats, t.slug)] && companies[boardKey(t.ats, t.slug)].board !== false);
      if (known) atsMap[c.id] = { ats: known.ats, slug: known.slug, at: new Date(now).toISOString(), how: 'tableau déjà lu par le radar' };
    }
    const m = atsMap[c.id];
    if (m && m.ats && cleanSlug(m.ats, m.slug)) indexByKey.set(boardKey(m.ats, cleanSlug(m.ats, m.slug)), c);
  }
  const remoteDue = remoteBoardsDue(companies, manual, now, o, [...indexByKey.keys()]);
  const seen = new Set();
  const boards = [...pinned, ...remoteDue, ...learnedList, ...plan.block].filter(b => { const k = `${b.ats}:${b.slug}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const hits = [];
  let answered = 0;
  const nowIso = new Date(now).toISOString();
  const handled = new Set();
  // Un tableau lu : registre des entreprises full remote, postes à part, et postes du métier pour le crible.
  const handleBoard = (ats, slug, posts) => {
    const key = boardKey(ats, slug);
    if (handled.has(key)) return;
    handled.add(key);
    const fromIndex = indexByKey.get(key);
    const listedByHand = manualKeys.has(key) || Boolean(fromIndex);
    const verdict = remoteVerdict(posts, listedByHand, companies[key], o);
    if (verdict.listed) {
      const name = fromIndex?.name || posts.find(p => p.company)?.company || companies[key]?.name || prettySlug(slug);
      const kept = remoteCompanyJobs(ats, posts, remoteJobs[key], titleMatch, now, o.remote_jobs_max, verdict.full);
      companies[key] = {
        name, ats, slug, careers: careersUrl(ats, slug), kind: verdict.full ? 'full' : 'partiel', total: verdict.total, remote: verdict.remote, hybrid: verdict.hybrid,
        in_field: kept.jobs.length, first_seen: companies[key]?.first_seen || nowIso, last_read: nowIso,
        source: manualKeys.has(key) ? 'manuel' : fromIndex ? 'index' : 'tableau', ...(fromIndex?.status ? { note: fromIndex.status } : {})
      };
      remoteJobs[key] = { read_at: nowIso, ...kept };
    } else if (verdict.drop) {
      delete companies[key];
      delete remoteJobs[key];
    }
    for (const p of posts) {
      if (!p.title || !p.url || !p.remote || p.hybrid || !titleMatch({ title: p.title, description: '' })) continue;
      learned[`${ats}:${slug}`] = new Date(now).toISOString();
      const day = toIsoDay(p.posted);
      if (!day || (now - new Date(day).getTime()) / 86400000 > maxAge) continue;
      hits.push({ ats, slug, p, day });
    }
  };
  // Le tableau lu, ou null ; `sure` : la réponse dit vraiment « pas de tableau » (404, 410), pas une panne passagère.
  const readBoardJson = async (ats, slug) => {
    const res = await get(boardUrl(ats, slug), o.timeout_ms);
    const sure = [400, 404, 410].includes(Number(res.status));
    if (res.status !== 200 || !res.data) return { data: null, sure };
    try { return { data: JSON.parse(res.data), sure: true }; } catch { return { data: null, sure: false }; }
  };
  await pool(boards, o.concurrency, async ({ ats, slug }) => {
    const { data } = await readBoardJson(ats, slug);
    if (data === null) return;
    answered++;
    handleBoard(ats, slug, parseBoard(ats, slug, data));
  });

  // L'index : chercher le tableau des entreprises pas encore trouvées (ou introuvables il y a plus de index_retry_days jours).
  // Une recherche gênée par une panne (délai, 429, 5xx) se refait le lendemain, pas dans un mois.
  const toProbe = index.filter(c => {
    const m = atsMap[c.id];
    if (!m) return true;
    if (m.ats) return false;
    const t = Date.parse(m.at || '');
    return Number.isNaN(t) || now - t > (m.unsure ? 1 : o.index_retry_days) * 86400000;
  }).slice(0, o.index_probe_per_cycle);
  let probed = 0;
  await pool(toProbe, o.concurrency, async c => {
    const tries = indexTries(c);
    const byLink = atsFromUrl(c.careers);
    let unsure = false;
    for (const t of tries) {
      probed++;
      const { data, sure } = await readBoardJson(t.ats, t.slug);
      if (data === null) { if (!sure) unsure = true; continue; }
      const posts = parseBoard(t.ats, t.slug, data);
      // Un identifiant deviné ne compte que si le tableau a des postes (un tableau vide ne prouve rien).
      const linked = byLink && byLink.ats === t.ats && byLink.slug === t.slug;
      if (posts.length === 0 && !linked) continue;
      atsMap[c.id] = { ats: t.ats, slug: t.slug, at: nowIso, how: linked ? 'lien de la page carrières' : 'identifiant deviné' };
      indexByKey.set(boardKey(t.ats, t.slug), c);
      handleBoard(t.ats, t.slug, posts);
      return;
    }
    atsMap[c.id] = unsure ? { ats: null, at: nowIso, unsure: true } : { ats: null, at: nowIso };
  });
  // Les entreprises de l'index sans tableau lisible restent visibles, sans postes.
  for (const c of index) {
    const key = `index:${c.id}`;
    if (atsMap[c.id]?.ats) { delete companies[key]; continue; }
    companies[key] = {
      name: c.name, ats: '', slug: '', careers: c.careers, kind: 'full', board: false, probed: Boolean(atsMap[c.id]), total: 0, remote: 0, hybrid: 0, in_field: 0,
      first_seen: companies[key]?.first_seen || nowIso, last_read: nowIso, source: 'index', ...(c.status ? { note: c.status } : {})
    };
  }

  // Greenhouse : le texte des postes retenus (la liste n'en porte pas), dans la limite de details_max.
  const jobs = await pool(hits, o.concurrency, async ({ ats, slug, p, day }, i) => {
    let html = p.html;
    if (ats === 'greenhouse' && !html && i < o.details_max) {
      const res = await get(`${boardUrl(ats, slug)}/${enc(p.id)}`, o.timeout_ms);
      try { html = res.status === 200 ? (JSON.parse(res.data).content || '') : ''; } catch { html = ''; }
    }
    return toRadarJob(ats, slug, p, day, html);
  });

  if (careerDir) {
    writeJson(learnedFile, Object.fromEntries(Object.entries(learned).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, LEARNED_KEEP)));
    // Une entreprise que le radar ne relit plus (tableau disparu de l'univers, ou muet) sort du registre.
    for (const [k, c] of Object.entries(companies)) {
      const t = Date.parse(c.last_read || '');
      if (!manualKeys.has(k) && (Number.isNaN(t) || now - t > o.remote_forget_days * 86400000)) { delete companies[k]; delete remoteJobs[k]; }
    }
    const meta = { at: nowIso, rule: `full : au moins ${o.remote_min_jobs} postes dont ${Math.round(o.remote_share * 100)} % remote (jamais hybrides), ou listée dans ${MANUAL_REMOTE_FILE} ; partiel : au moins un poste remote` };
    writeJson(companiesFile, { _meta: meta, companies });
    writeJson(remoteJobsFile, { _meta: meta, companies: remoteJobs });
    if (index.length > 0) writeJson(atsFile, atsMap);
  }
  if (boards.length > 0 && answered === 0 && status === 200) status = 'aucun tableau n\'a répondu';
  const resolved = index.filter(c => atsMap[c.id]?.ats).length;
  return { status, jobs, scanned: boards.length, answered, remote_companies: Object.keys(companies).length, index: { companies: index.length, resolved, probed } };
}

module.exports = {
  fetchAtsBoardsLive, planUniverseCycle, refreshUniverse, parseBoard, boardsFrom, cleanSlug, boardUrl, careersUrl, remoteVerdict, FAMILY_RE,
  atsFromUrl, indexTries, UNIVERSE_URL, UNIVERSE_FILE, LEARNED_FILE, PINNED_FILE, CURSOR_KEY, ATSES, REMOTE_COMPANIES_FILE, REMOTE_JOBS_FILE, MANUAL_REMOTE_FILE,
  INDEX_FILE, INDEX_ATS_FILE
};
