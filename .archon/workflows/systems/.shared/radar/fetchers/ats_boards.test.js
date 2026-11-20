/**
 * ats_boards.test.js — Tableaux employeurs : univers, curseur, tableaux appris, filtres, forme des offres
 * Lancement : node --test .archon/workflows/systems/.shared/radar/fetchers/
 * Réponses d'API simulées sur les formes publiques documentées (Greenhouse boards-api, Lever v0
 * postings, Ashby posting-api) ; aucune requête réseau.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ats = require('./ats_boards');
const { fetchAllActiveSources } = require('./index');

const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86400000;
const iso = days => new Date(NOW - days * DAY).toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ats-boards-'));
const growth = job => /growth|marketing|crm/i.test(job.title);

const BOARDS = {
  'boards-api.greenhouse.io/v1/boards/acme/jobs': { jobs: [
    { id: 11, title: 'Growth Marketing Manager', absolute_url: 'https://acme.example/jobs/11', location: { name: 'Remote - Europe' }, first_published: iso(2), company_name: 'Acme' },
    { id: 12, title: 'Backend Engineer', absolute_url: 'https://acme.example/jobs/12', location: { name: 'Remote' }, first_published: iso(1) },
    { id: 13, title: 'CRM Manager', absolute_url: 'https://acme.example/jobs/13', location: { name: 'Paris' }, first_published: iso(1) },
    { id: 14, title: 'Marketing Ops', absolute_url: 'https://acme.example/jobs/14', location: { name: 'Remote' }, first_published: iso(30) }
  ] },
  'boards-api.greenhouse.io/v1/boards/acme/jobs/11': { content: '&lt;p&gt;Own our growth loops across Europe.&lt;/p&gt;' },
  'api.lever.co/v0/postings/AIFund?mode=json': [
    { id: 'lv1', text: 'Lifecycle Marketing Lead', hostedUrl: 'https://jobs.lever.co/AIFund/lv1', workplaceType: 'remote', categories: { location: 'Spain' }, createdAt: NOW - DAY, description: '<p>Email and CRM.</p>' },
    { id: 'lv2', text: 'Growth Analyst', hostedUrl: 'https://jobs.lever.co/AIFund/lv2', workplaceType: 'hybrid', categories: { location: 'Madrid' }, createdAt: NOW - DAY }
  ],
  'api.ashbyhq.com/posting-api/job-board/hamming%20ai': { jobs: [
    { id: 'as1', title: 'Growth Lead', jobUrl: 'https://jobs.ashbyhq.com/hamming/as1', isRemote: true, workplaceType: 'Remote', location: 'Remote (EU)', publishedAt: iso(3), descriptionHtml: '<p>Hello</p>' },
    { id: 'as2', title: 'Growth Lead (hybrid)', jobUrl: 'https://jobs.ashbyhq.com/hamming/as2', isRemote: true, workplaceType: 'Hybrid', location: 'Berlin', publishedAt: iso(1) }
  ] }
};

function fakeGet(calls = []) {
  return async (url) => {
    calls.push(url);
    if (url.includes('raw.githubusercontent.com')) {
      const lists = { greenhouse: ['acme', 'Bad Slug', '../etc'], lever: ['AIFund'], ashby: ['hamming ai'] };
      const name = Object.keys(lists).find(k => url.includes(`/${k}_companies.json`));
      return { status: 200, data: JSON.stringify(lists[name]) };
    }
    const key = url.replace(/^https:\/\//, '');
    return BOARDS[key] ? { status: 200, data: JSON.stringify(BOARDS[key]) } : { status: 404, data: '' };
  };
}

test('slugs : Lever garde la casse, Ashby garde l\'espace, rien qui sorte du chemin', () => {
  assert.strictEqual(ats.cleanSlug('lever', ' AIFund '), 'AIFund');
  assert.strictEqual(ats.cleanSlug('greenhouse', 'Acme'), 'acme');
  assert.strictEqual(ats.cleanSlug('ashby', 'hamming ai'), 'hamming ai');
  assert.strictEqual(ats.cleanSlug('greenhouse', 'bad slug'), '');
  assert.strictEqual(ats.cleanSlug('greenhouse', '../etc'), '');
  assert.strictEqual(ats.cleanSlug('lever', 'a/b'), '');
  assert.strictEqual(ats.boardUrl('ashby', 'hamming ai'), 'https://api.ashbyhq.com/posting-api/job-board/hamming%20ai');
});

test('premier cycle : univers téléchargé, postes remote du métier et récents seulement, forme radar', async () => {
  const dir = tmp();
  const calls = [];
  const { status, jobs, scanned } = await ats.fetchAtsBoardsLive({ careerDir: dir, get: fakeGet(calls), now: NOW, titleMatch: growth, maxAgeDays: 7, pinned: {}, manualRemote: {} });
  assert.strictEqual(status, 200);
  assert.strictEqual(scanned, 3, 'acme, AIFund, hamming ai (slugs invalides écartés)');
  assert.deepStrictEqual(jobs.map(j => j.title).sort(), ['Growth Lead', 'Growth Marketing Manager', 'Lifecycle Marketing Lead']);
  const gh = jobs.find(j => j.title === 'Growth Marketing Manager');
  assert.strictEqual(gh.company, 'Acme');
  assert.strictEqual(gh.source, 'Tableaux employeurs (Greenhouse)');
  assert.strictEqual(gh.date_published, iso(2).slice(0, 10));
  assert.match(gh.description, /growth loops/, 'texte relu sur la fiche Greenhouse');
  assert.ok(calls.some(u => u.endsWith('/acme/jobs/11')));
  assert.ok(!calls.some(u => u.endsWith('/acme/jobs/14')), 'poste trop vieux : fiche non relue');
  assert.strictEqual(jobs.find(j => j.title === 'Growth Lead').company, 'Hamming Ai');
  for (const k of ['id', 'company', 'title', 'location', 'remote_declared', 'company_hq', 'skills_required', 'description', 'salary_range', 'link', 'date_published', 'source']) {
    for (const j of jobs) assert.ok(k in j, `champ manquant : ${k}`);
  }
  const universe = JSON.parse(fs.readFileSync(path.join(dir, ats.UNIVERSE_FILE), 'utf8'));
  assert.deepStrictEqual(universe.greenhouse, ['acme']);
  assert.match(universe._meta.licence, /CC BY-NC/);
  const learned = JSON.parse(fs.readFileSync(path.join(dir, ats.LEARNED_FILE), 'utf8'));
  assert.deepStrictEqual(Object.keys(learned).sort(), ['ashby:hamming ai', 'greenhouse:acme', 'lever:AIFund']);
});

test('curseur : bloc tournant, retour au début en fin d\'univers ; univers récent non retéléchargé', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ats.UNIVERSE_FILE), JSON.stringify({ _meta: { date: iso(1) }, greenhouse: ['a1', 'a2', 'a3'], lever: ['L1'], ashby: [] }));
  const state = {};
  assert.deepStrictEqual(ats.planUniverseCycle(dir, state, { boards_per_cycle: 3 }).block.map(b => b.slug), ['a1', 'a2', 'a3']);
  assert.strictEqual(state[ats.CURSOR_KEY], 3);
  assert.deepStrictEqual(ats.planUniverseCycle(dir, state, { boards_per_cycle: 3 }).block.map(b => b.slug), ['L1']);
  assert.strictEqual(state[ats.CURSOR_KEY], 0);
  const calls = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: fakeGet(calls), now: NOW, plan: { block: [] } });
  assert.ok(!calls.some(u => u.includes('githubusercontent')), 'univers de moins de 7 jours : pas de téléchargement');
});

test('tableaux appris et épinglés relus à chaque cycle, sans doublon', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ats.UNIVERSE_FILE), JSON.stringify({ _meta: { date: iso(1) }, greenhouse: ['acme'] }));
  fs.writeFileSync(path.join(dir, ats.LEARNED_FILE), JSON.stringify({ 'lever:AIFund': iso(2) }));
  const calls = [];
  const res = await ats.fetchAtsBoardsLive({ careerDir: dir, get: fakeGet(calls), now: NOW, titleMatch: growth,
    plan: { block: [{ ats: 'greenhouse', slug: 'acme' }] }, pinned: { ashby: ['hamming ai'], greenhouse: ['acme'] }, manualRemote: {} });
  assert.strictEqual(res.scanned, 3);
  assert.strictEqual(calls.filter(u => u.endsWith('/boards/acme/jobs')).length, 1);
});

test('univers injoignable et aucun tableau : statut lisible, pas d\'exception', async () => {
  const dir = tmp();
  const res = await ats.fetchAtsBoardsLive({ careerDir: dir, get: async () => ({ status: 403, data: '' }), now: NOW });
  assert.match(String(res.status), /univers indisponible/);
  assert.deepStrictEqual(res.jobs, []);
  assert.ok(!fs.existsSync(path.join(dir, ats.UNIVERSE_FILE)), 'jamais d\'univers vide écrit');
});

test('répartiteur : la source tourne depuis job_sources, curseur écrit dans source_state.json', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, ats.UNIVERSE_FILE), JSON.stringify({ _meta: { date: new Date().toISOString() }, greenhouse: ['acme', 'other'] }));
  const sourcesConfig = { sources: [{ name: 'Tableaux employeurs (Greenhouse, Lever, Ashby)', enabled: true, boards_per_cycle: 1 }] };
  const taxonomy = { search_queries: ['growth marketing manager'], source_queries: [] };
  const fresh = { ...BOARDS['boards-api.greenhouse.io/v1/boards/acme/jobs'] };
  fresh.jobs = fresh.jobs.map(j => ({ ...j, first_published: new Date().toISOString() }));
  const get = async (url) => url.endsWith('/acme/jobs') ? { status: 200, data: JSON.stringify(fresh) } : { status: 404, data: '' };
  const { jobs, sources } = await fetchAllActiveSources({ careerDir: dir, sourcesConfig, taxonomy, onlyListed: true, fetchUrl: get, envPath: [] });
  assert.strictEqual(sources[0].name, 'Tableaux employeurs');
  assert.ok(jobs.some(j => j.title === 'Growth Marketing Manager'));
  assert.ok(!jobs.some(j => j.title === 'Backend Engineer'), 'hors métier');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'source_state.json'), 'utf8'));
  assert.strictEqual(state[ats.CURSOR_KEY], 1);
});

// ── Entreprises full remote (Antoine, 2026-11-08 : l'annonce PostHog « developer marketer, sales ») ──
const REMOTE_BOARDS = {
  'api.ashbyhq.com/posting-api/job-board/posthog': { jobs: [
    { id: 'ph1', title: 'Developer Marketer, Sales', jobUrl: 'https://jobs.ashbyhq.com/posthog/ph1', isRemote: true, workplaceType: 'Remote', location: 'Remote (EMEA)', publishedAt: iso(40) },
    { id: 'ph2', title: 'Product Engineer', jobUrl: 'https://jobs.ashbyhq.com/posthog/ph2', isRemote: true, workplaceType: 'Remote', location: 'Remote', publishedAt: iso(2) },
    { id: 'ph3', title: 'Growth Marketing Manager', jobUrl: 'https://jobs.ashbyhq.com/posthog/ph3', isRemote: true, workplaceType: 'Remote', location: 'Remote (EU)', publishedAt: iso(1) }
  ] },
  'boards-api.greenhouse.io/v1/boards/distco/jobs': { jobs: [
    { id: 1, title: 'Backend Engineer', absolute_url: 'https://d.example/1', location: { name: 'Remote' }, first_published: iso(3) },
    { id: 2, title: 'Partnerships Lead', absolute_url: 'https://d.example/2', location: { name: 'Remote - Europe' }, first_published: iso(20) },
    { id: 3, title: 'Data Scientist', absolute_url: 'https://d.example/3', location: { name: 'Anywhere' }, first_published: iso(3) }
  ] },
  'boards-api.greenhouse.io/v1/boards/officeco/jobs': { jobs: [
    { id: 1, title: 'Marketing Manager', absolute_url: 'https://o.example/1', location: { name: 'Remote' }, first_published: iso(3) },
    { id: 2, title: 'Sales Lead', absolute_url: 'https://o.example/2', location: { name: 'Paris' }, first_published: iso(3) },
    { id: 3, title: 'Designer', absolute_url: 'https://o.example/3', location: { name: 'Hybrid - Lyon' }, first_published: iso(3) }
  ] }
};
const remoteGet = (calls = [], boards = REMOTE_BOARDS) => async (url) => {
  calls.push(url);
  const key = url.replace(/^https:\/\//, '');
  return boards[key] ? { status: 200, data: JSON.stringify(boards[key]) } : { status: 404, data: '' };
};
const withUniverse = () => { const dir = tmp(); fs.writeFileSync(path.join(dir, ats.UNIVERSE_FILE), JSON.stringify({ _meta: { date: iso(1) }, greenhouse: ['distco', 'officeco'] })); return dir; };
const readOut = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('entreprise listée à la main (PostHog) : ses postes de la famille large à part, même hors métier et anciens', async () => {
  const dir = withUniverse();
  const res = await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(), now: NOW, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: { ashby: ['posthog'] } });
  assert.deepStrictEqual(res.jobs.map(j => j.title), ['Growth Marketing Manager'], 'le tableau ne reçoit que le métier récent, comme avant');
  const reg = readOut(dir, ats.REMOTE_COMPANIES_FILE).companies['ashby:posthog'];
  assert.deepStrictEqual({ name: reg.name, source: reg.source, total: reg.total, remote: reg.remote, in_field: reg.in_field, careers: reg.careers },
    { name: 'Posthog', source: 'manuel', total: 3, remote: 3, in_field: 2, careers: 'https://jobs.ashbyhq.com/posthog' });
  const jobs = readOut(dir, ats.REMOTE_JOBS_FILE).companies['ashby:posthog'];
  assert.deepStrictEqual(jobs.jobs.map(j => j.title), ['Growth Marketing Manager', 'Developer Marketer, Sales'], 'métier d\'abord ; le poste de 40 jours reste');
  assert.strictEqual(jobs.others, 1, 'Product Engineer compté, pas gardé');
  assert.strictEqual(jobs.jobs[1].id, 'ATS-AS-ph1', 'même id que le radar : pas de doublon au tableau');
  assert.strictEqual(res.remote_companies, 1);
});

test('entreprise repérée sur son tableau : tous remote → full ; quelques postes remote → partiel, seulement ses postes remote ; aucun → absente', async () => {
  const dir = withUniverse();
  const boards = { ...REMOTE_BOARDS, 'boards-api.greenhouse.io/v1/boards/onsiteco/jobs': { jobs: [{ id: 1, title: 'Sales Lead', absolute_url: 'https://s.example/1', location: { name: 'Madrid' }, first_published: iso(1) }] } };
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet([], boards), now: NOW, titleMatch: growth, plan: { block: ['distco', 'officeco', 'onsiteco'].map(slug => ({ ats: 'greenhouse', slug })) }, pinned: {}, manualRemote: {} });
  const reg = readOut(dir, ats.REMOTE_COMPANIES_FILE);
  assert.deepStrictEqual(Object.keys(reg.companies).sort(), ['greenhouse:distco', 'greenhouse:officeco']);
  assert.deepStrictEqual([reg.companies['greenhouse:distco'].kind, reg.companies['greenhouse:officeco'].kind], ['full', 'partiel']);
  assert.strictEqual(reg.companies['greenhouse:distco'].source, 'tableau');
  assert.match(reg._meta.rule, /3 postes dont 90 %/);
  const jobs = readOut(dir, ats.REMOTE_JOBS_FILE).companies;
  assert.deepStrictEqual(jobs['greenhouse:distco'].jobs.map(j => j.title), ['Partnerships Lead']);
  assert.deepStrictEqual(jobs['greenhouse:officeco'].jobs.map(j => j.title), ['Marketing Manager'], 'Paris et l\'hybride de Lyon restent dehors');
  assert.strictEqual(ats.parseBoard('greenhouse', 'officeco', REMOTE_BOARDS['boards-api.greenhouse.io/v1/boards/officeco/jobs'])[2].hybrid, true);
  fs.writeFileSync(path.join(dir, ats.LEARNED_FILE), '{}');
  const calls = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(calls, boards), now: NOW + 7 * 3600000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {} });
  assert.ok(calls.some(u => u.endsWith('/distco/jobs')) && !calls.some(u => u.endsWith('/officeco/jobs')), 'seules les full sont relues hors du bloc');
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet([], {}), now: NOW + 22 * 86400000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {} });
  assert.deepStrictEqual(readOut(dir, ats.REMOTE_COMPANIES_FILE).companies, {}, 'plus relue depuis 21 jours : oubliée');
});

test('registre : relu toutes les 6 h seulement ; gardé s\'il recrute peu ; partiel puis retiré quand le remote disparaît', async () => {
  const dir = withUniverse();
  const opts = { careerDir: dir, titleMatch: growth, plan: { block: [{ ats: 'greenhouse', slug: 'distco' }] }, pinned: {}, manualRemote: {} };
  await ats.fetchAtsBoardsLive({ ...opts, get: remoteGet(), now: NOW });
  const calls = [];
  await ats.fetchAtsBoardsLive({ ...opts, plan: { block: [] }, get: remoteGet(calls), now: NOW + 3600000 });
  assert.ok(!calls.some(u => u.includes('/distco/')), 'lu il y a une heure : pas relu');
  const few = { 'boards-api.greenhouse.io/v1/boards/distco/jobs': { jobs: [{ id: 9, title: 'Sales Lead', absolute_url: 'https://d.example/9', location: { name: 'Remote' }, first_published: iso(1) }] } };
  const calls2 = [];
  await ats.fetchAtsBoardsLive({ ...opts, plan: { block: [] }, get: remoteGet(calls2, few), now: NOW + 7 * 3600000 });
  assert.ok(calls2.some(u => u.endsWith('/distco/jobs')), 'plus de 6 h : relu sans être dans le bloc');
  assert.ok(readOut(dir, ats.REMOTE_COMPANIES_FILE).companies['greenhouse:distco'], 'un seul poste : l\'état connu reste');
  assert.deepStrictEqual(readOut(dir, ats.REMOTE_JOBS_FILE).companies['greenhouse:distco'].jobs.map(j => j.title), ['Sales Lead']);
  const office = { 'boards-api.greenhouse.io/v1/boards/distco/jobs': REMOTE_BOARDS['boards-api.greenhouse.io/v1/boards/officeco/jobs'] };
  await ats.fetchAtsBoardsLive({ ...opts, plan: { block: [] }, get: remoteGet([], office), now: NOW + 14 * 3600000 });
  assert.strictEqual(readOut(dir, ats.REMOTE_COMPANIES_FILE).companies['greenhouse:distco'].kind, 'partiel', 'un poste remote sur trois : plus full, encore listée');
  const onsite = { 'boards-api.greenhouse.io/v1/boards/distco/jobs': { jobs: [1, 2, 3].map(id => ({ id, title: 'Sales Lead', absolute_url: `https://d.example/o${id}`, location: { name: 'Berlin' }, first_published: iso(1) })) } };
  await ats.fetchAtsBoardsLive({ ...opts, get: remoteGet([], onsite), now: NOW + 15 * 3600000 });
  assert.deepStrictEqual(readOut(dir, ats.REMOTE_COMPANIES_FILE).companies, {}, 'plus aucun poste remote : retirée');
  assert.deepStrictEqual(readOut(dir, ats.REMOTE_JOBS_FILE).companies, {});
});

test('famille large : les métiers d\'Antoine passent, l\'ingénierie pure non', () => {
  for (const t of ['Developer Marketer, Sales', 'Product Designer', 'QA Analyst', 'Customer Success Manager', 'RevOps Lead', 'Chef de projet digital', 'Community Manager']) assert.ok(ats.FAMILY_RE.test(t), t);
  for (const t of ['Backend Engineer', 'Data Scientist', 'Site Reliability Engineer', 'DevOps Engineer']) assert.ok(!ats.FAMILY_RE.test(t), t);
});

test('index d\'Antoine (verified_remote_companies.json) : tableau trouvé par le lien ou deviné, introuvable gardé sans postes, réessai plus tard', async () => {
  const dir = withUniverse();
  const index = [
    { id: 'posthog', name: 'PostHog', careers_url: 'https://posthog.com/careers', remote_status: '100% Full Remote (Vérifié)' },
    { id: 'linked', name: 'Linked Co', careers_url: 'https://jobs.lever.co/LinkedCo' },
    { id: 'nowhere', name: 'Nowhere', careers_url: 'https://nowhere.example/careers' },
    { id: '../bad', name: 'Bad' }
  ];
  const boards = { ...REMOTE_BOARDS, 'api.lever.co/v0/postings/LinkedCo?mode=json': [] };
  const calls = [];
  const res = await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(calls, boards), now: NOW, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index });
  assert.deepStrictEqual(res.index, { companies: 3, resolved: 2, probed: res.index.probed });
  const map = readOut(dir, ats.INDEX_ATS_FILE);
  assert.deepStrictEqual([map.posthog.ats, map.posthog.slug, map.posthog.how], ['ashby', 'posthog', 'identifiant deviné']);
  assert.deepStrictEqual([map.linked.ats, map.linked.slug, map.linked.how], ['lever', 'LinkedCo', 'lien de la page carrières'], 'lien : un tableau vide suffit');
  assert.strictEqual(map.nowhere.ats, null);
  const reg = readOut(dir, ats.REMOTE_COMPANIES_FILE).companies;
  assert.deepStrictEqual([reg['ashby:posthog'].name, reg['ashby:posthog'].source, reg['ashby:posthog'].kind, reg['ashby:posthog'].note], ['PostHog', 'index', 'full', '100% Full Remote (Vérifié)']);
  assert.strictEqual(reg['lever:LinkedCo'].kind, 'full', 'listée dans l\'index : full même sans poste');
  assert.deepStrictEqual([reg['index:nowhere'].board, reg['index:nowhere'].careers, reg['index:nowhere'].source], [false, 'https://nowhere.example/careers', 'index']);
  assert.ok(!reg['index:posthog'], 'trouvée : plus d\'entrée sans tableau');
  assert.deepStrictEqual(readOut(dir, ats.REMOTE_JOBS_FILE).companies['ashby:posthog'].jobs.map(j => j.title), ['Growth Marketing Manager', 'Developer Marketer, Sales']);
  assert.deepStrictEqual(res.jobs.map(j => j.title), ['Growth Marketing Manager'], 'le métier récent part aussi au crible');
  fs.writeFileSync(path.join(dir, ats.LEARNED_FILE), '{}');
  const again = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(again, boards), now: NOW + 3600000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index });
  assert.ok(!again.some(u => u.includes('nowhere')), 'introuvable : pas réessayée avant 30 jours');
  assert.ok(!again.some(u => u.includes('posthog')), 'trouvée et lue il y a une heure : pas relue');
  fs.writeFileSync(path.join(dir, ats.LEARNED_FILE), '{}');
  const later = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(later, boards), now: NOW + 31 * 86400000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index });
  assert.ok(later.some(u => u.endsWith('/job-board/nowhere')), 'réessayée après 30 jours');
  assert.ok(later.some(u => u.endsWith('/job-board/posthog')), 'les entreprises de l\'index trouvées sont relues comme les full remote');
  const reg2 = readOut(dir, ats.REMOTE_COMPANIES_FILE);
  delete reg2.companies['ashby:posthog'];
  fs.writeFileSync(path.join(dir, ats.REMOTE_COMPANIES_FILE), JSON.stringify(reg2));
  fs.writeFileSync(path.join(dir, ats.LEARNED_FILE), '{}');
  const lost = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet(lost, boards), now: NOW + 31 * 86400000 + 60000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index });
  assert.ok(lost.some(u => u.endsWith('/job-board/posthog')), 'sortie du registre mais connue de l\'index : relue tout de suite');
  assert.ok(readOut(dir, ats.REMOTE_COMPANIES_FILE).companies['ashby:posthog']);
});

test('lien de page carrières : Ashby, Greenhouse (ancien et nouveau domaine), Lever ; le reste non', () => {
  assert.deepStrictEqual(ats.atsFromUrl('https://jobs.ashbyhq.com/hamming%20ai/123'), { ats: 'ashby', slug: 'hamming ai' });
  assert.deepStrictEqual(ats.atsFromUrl('https://job-boards.greenhouse.io/Acme?x=1'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepStrictEqual(ats.atsFromUrl('https://boards.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepStrictEqual(ats.atsFromUrl('https://jobs.lever.co/AIFund'), { ats: 'lever', slug: 'AIFund' });
  assert.strictEqual(ats.atsFromUrl('https://posthog.com/careers'), null);
  assert.strictEqual(ats.atsFromUrl('http://jobs.lever.co/x'), null);
  assert.deepStrictEqual(ats.indexTries({ id: 'gitbook', name: 'Git Book', careers: '' }).map(t => `${t.ats}:${t.slug}`), ['ashby:gitbook', 'lever:gitbook', 'greenhouse:gitbook']);
});

test('index : un tableau déjà lu sous l\'identifiant est pris sans requête ; une panne fait réessayer le lendemain ; pas encore cherchée, dite', async () => {
  const dir = withUniverse();
  const index = [{ id: 'posthog', name: 'PostHog', careers_url: 'https://posthog.com/careers' }, { id: 'flaky', name: 'Flaky' }, { id: 'later', name: 'Later' }];
  // Premier cycle : PostHog lue comme entreprise manuelle, l'index n'en cherche qu'une (flaky, en panne).
  const flakyGet = (calls) => async (url) => { calls.push(url); if (url.includes('flaky')) return { status: 0, data: '' }; return remoteGet([], REMOTE_BOARDS)(url); };
  const calls = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: flakyGet(calls), now: NOW, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: { ashby: ['posthog'] }, remoteIndex: [index[1], index[0], index[2]], index_probe_per_cycle: 1 });
  let map = readOut(dir, ats.INDEX_ATS_FILE);
  assert.deepStrictEqual(map.flaky, { ats: null, at: new Date(NOW).toISOString(), unsure: true });
  let reg = readOut(dir, ats.REMOTE_COMPANIES_FILE).companies;
  assert.deepStrictEqual([reg['index:later'].board, reg['index:later'].probed], [false, false], 'pas encore cherchée');
  assert.strictEqual(reg['index:flaky'].probed, true);
  // Deuxième cycle : PostHog est déjà au registre sous ashby:posthog → prise sans requête, plus de doublon index:posthog.
  const calls2 = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: flakyGet(calls2), now: NOW + 3600000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index, index_probe_per_cycle: 1 });
  map = readOut(dir, ats.INDEX_ATS_FILE);
  assert.deepStrictEqual([map.posthog.ats, map.posthog.slug, map.posthog.how], ['ashby', 'posthog', 'tableau déjà lu par le radar']);
  reg = readOut(dir, ats.REMOTE_COMPANIES_FILE).companies;
  assert.ok(!reg['index:posthog'] && reg['ashby:posthog'].source === 'index');
  assert.ok(!calls2.some(u => u.includes('flaky')), 'panne il y a une heure : pas encore réessayée');
  const calls3 = [];
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: flakyGet(calls3), now: NOW + 25 * 3600000, titleMatch: growth, plan: { block: [] }, pinned: {}, manualRemote: {}, remoteIndex: index, index_probe_per_cycle: 1 });
  assert.ok(calls3.some(u => u.includes('flaky')), 'le lendemain : réessayée');
});

test('postes à part : jamais réservés hors d\'Europe, un titre répété par lieu compté une fois', async () => {
  const dir = withUniverse();
  const boards = { 'api.lever.co/v0/postings/blue?mode=json': [
    ...['Cartagena, Colombia', 'Quito, Ecuador', 'Lima, Peru'].map((loc, i) => ({ id: `b${i}`, text: 'Account Executive - Remote, Latin America', hostedUrl: `https://jobs.lever.co/blue/b${i}`, workplaceType: 'remote', categories: { location: loc }, createdAt: NOW - DAY })),
    { id: 'u1', text: 'Sales Manager', hostedUrl: 'https://jobs.lever.co/blue/u1', workplaceType: 'remote', categories: { location: 'Remote (US)' }, createdAt: NOW - DAY },
    ...['Madrid', 'Lisbon'].map((loc, i) => ({ id: `e${i}`, text: 'Account Executive EMEA', hostedUrl: `https://jobs.lever.co/blue/e${i}`, workplaceType: 'remote', categories: { location: loc }, createdAt: NOW - DAY })),
    { id: 'w1', text: 'Content Marketer', hostedUrl: 'https://jobs.lever.co/blue/w1', workplaceType: 'remote', categories: { location: 'Remote' }, createdAt: NOW - DAY }
  ] };
  await ats.fetchAtsBoardsLive({ careerDir: dir, get: remoteGet([], boards), now: NOW, titleMatch: growth, plan: { block: [{ ats: 'lever', slug: 'blue' }] }, pinned: {}, manualRemote: {} });
  const jobs = readOut(dir, ats.REMOTE_JOBS_FILE).companies['lever:blue'];
  assert.deepStrictEqual(jobs.jobs.map(j => [j.title, j.more || 0]), [['Account Executive EMEA', 1], ['Content Marketer', 0]]);
  assert.strictEqual(jobs.outside_europe, 4);
  assert.strictEqual(ats.parseBoard('ashby', 'x', { jobs: [{ id: '1', title: 't', jobUrl: 'https://x', location: 'Remote', secondaryLocations: [{ location: 'Remote' }, { location: 'Berlin' }] }] })[0].location, 'Remote ; Berlin');
});
