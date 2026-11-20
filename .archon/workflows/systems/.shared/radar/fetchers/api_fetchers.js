/**
 * api_fetchers.js — Connecteurs REST JSON Directs pour Plateformes Ouvertes
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Chaque connecteur renvoie { status, jobs } : un échec HTTP reste visible.
 */

const common = require('./common');
const { hashStr, isFreshUnder48h, stripHtml, ENTREPRISE_INCONNUE } = common;
const { fullDescriptionField } = require('./full_description');

// Plateformes 100 % remote (ou filtre remote par offre pour Arbeitnow) : remote_declared vient de la source.
// location porte la localisation annoncée par la source, vide sinon.

async function fetchJson(url, get) {
  const res = await get(url);
  if (res.status !== 200 || !res.data) return { status: res.status, data: null };
  try { return { status: 200, data: JSON.parse(res.data) }; } catch { return { status: 'réponse illisible', data: null }; }
}

// Seulement les bornes fournies, avec la devise et la période de la source (EUR, CAD, mensuel existent).
function himalayasSalary(i) {
  const min = i.minSalary, max = i.maxSalary;
  if (!min && !max) return null;
  const bounds = min && max ? `${min} - ${max}` : (min ? `dès ${min}` : `jusqu'à ${max}`);
  return [bounds, i.currency, i.salaryPeriod && `(${i.salaryPeriod})`].filter(Boolean).join(' ');
}

async function fetchHimalayasLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await fetchJson(endpoint || 'https://himalayas.app/jobs/api?limit=40', get);
  if (!data) return { status, jobs: [] };
  const pubOf = i => (i.pubDate ? new Date(i.pubDate * 1000).toISOString().slice(0, 10) : '');
  const jobs = (data.jobs || []).filter(i => isFreshUnder48h(pubOf(i))).map(i => ({
    id: `HIM-${hashStr(i.applicationLink || i.guid || i.title)}`,
    company: i.companyName || ENTREPRISE_INCONNUE,
    title: i.title || '',
    location: (i.locationRestrictions || []).join(', '),
    remote_declared: true,
    company_hq: '', // l'API ne donne pas le siège de l'entreprise (himalayas.app/api, relu le 30/09/2026)
    skills_required: (i.categories || []).join(', '),
    description: stripHtml(i.excerpt || '').slice(0, 400),
    ...fullDescriptionField(i.description),
    salary_range: himalayasSalary(i),
    link: i.applicationLink || i.guid,
    date_published: pubOf(i),
    source: 'Himalayas'
  }));
  return { status, jobs };
}

async function fetchWorkingNomadsLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await fetchJson(endpoint || 'https://www.workingnomads.com/api/exposed_jobs/', get);
  if (!data) return { status, jobs: [] };
  const jobs = (Array.isArray(data) ? data.slice(0, 35) : []).filter(i => isFreshUnder48h(i.pub_date || '')).map(i => ({
    id: `WN-${hashStr(i.url || i.title)}`,
    company: i.company_name || ENTREPRISE_INCONNUE,
    title: i.title || '',
    location: i.location || '',
    remote_declared: true,
    company_hq: i.location || '',
    skills_required: i.tags || '',
    description: stripHtml(i.description || '').slice(0, 400),
    ...fullDescriptionField(i.description),
    salary_range: null,
    link: i.url,
    date_published: (i.pub_date || '').slice(0, 10),
    source: 'Working Nomads'
  }));
  return { status, jobs };
}

async function fetchRemoteOKLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await fetchJson(endpoint || 'https://remoteok.com/api?tag=marketing', get);
  if (!data) return { status, jobs: [] };
  const jobs = (Array.isArray(data) ? data.slice(1, 25) : []).filter(i => isFreshUnder48h((i.date || '').slice(0, 10))).map(i => ({
    id: `ROK-${i.id || hashStr(i.url || i.position)}`,
    company: i.company || ENTREPRISE_INCONNUE,
    title: i.position || '',
    location: i.location || '',
    remote_declared: true,
    company_hq: i.location || '',
    skills_required: (i.tags || []).join(', '),
    description: stripHtml(i.description || '').slice(0, 400),
    ...fullDescriptionField(i.description),
    salary_range: i.salary || null,
    link: i.url || 'https://remoteok.com',
    date_published: (i.date || '').slice(0, 10) || common.toIsoDay(i.epoch),
    source: 'RemoteOK'
  }));
  return { status, jobs };
}

async function fetchRemotiveLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await fetchJson(endpoint || 'https://remotive.com/api/remote-jobs?category=marketing&limit=30', get);
  if (!data) return { status, jobs: [] };
  const jobs = (data.jobs || []).filter(i => isFreshUnder48h(i.publication_date?.slice(0, 10) || '')).map(i => ({
    id: `REM-${i.id || hashStr(i.url || i.title)}`,
    company: i.company_name || ENTREPRISE_INCONNUE,
    title: i.title || '',
    location: i.candidate_required_location || '',
    remote_declared: true,
    company_hq: i.candidate_required_location || '',
    skills_required: (i.tags || []).join(', '),
    description: stripHtml(i.description || '').slice(0, 400),
    ...fullDescriptionField(i.description),
    salary_range: i.salary || null,
    link: i.url,
    date_published: (i.publication_date || '').slice(0, 10),
    source: 'Remotive'
  }));
  return { status, jobs };
}

function arbeitnowDate(i) {
  if (!i.created_at) return '';
  return typeof i.created_at === 'number' ? new Date(i.created_at * 1000).toISOString().slice(0, 10) : String(i.created_at).slice(0, 10);
}

async function fetchArbeitnowLive(endpoint, get = common.fetchUrl) {
  const { status, data } = await fetchJson(endpoint || 'https://www.arbeitnow.com/api/job-board-api', get);
  if (!data) return { status, jobs: [] };
  const list = Array.isArray(data.data) ? data.data : [];
  const jobs = list.filter(i => i.remote && isFreshUnder48h(arbeitnowDate(i))).map(i => ({
    id: `ARB-${hashStr(i.slug || i.url || i.title)}`,
    company: i.company_name || ENTREPRISE_INCONNUE,
    title: i.title || '',
    location: i.location || '',
    remote_declared: true,
    company_hq: i.location || '',
    skills_required: Array.isArray(i.tags) ? i.tags.join(', ') : '',
    description: stripHtml(i.description || '').slice(0, 400),
    ...fullDescriptionField(i.description),
    salary_range: null,
    link: i.url || `https://www.arbeitnow.com/view/${i.slug}`,
    date_published: arbeitnowDate(i),
    source: 'Arbeitnow'
  }));
  return { status, jobs };
}

module.exports = {
  fetchHimalayasLive,
  fetchWorkingNomadsLive,
  fetchRemoteOKLive,
  fetchRemotiveLive,
  fetchArbeitnowLive
};
