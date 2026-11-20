/**
 * key_fetchers.test.js — Connecteurs à clé (fixtures fabriquées), Apify en deux temps,
 * lecture des clés par nom, cadence du dispatcher.
 * Lancement : node --test career_ops/fetchers/
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const keyed = require('./key_fetchers');
const apify = require('./apify_fetcher');
const { fetchAllActiveSources, readEnvKeys, resolveKeys, readSourceState, writeSourceState } = require('./index');

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_S = Math.floor(Date.now() / 1000);
const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'test', name), 'utf8')
  .replace(/2026-10-2[23]/g, TODAY).replace(/1761200000000/g, String(NOW_S * 1000)).replace(/1761200000/g, String(NOW_S));
const okGet = name => async (url, opts) => ({ status: 200, data: fixture(name), url, opts });
const koGet = async () => ({ status: 401, data: '' });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-'));

test('Jobdatalake : clé absente, mapping documenté, en-tête X-API-Key, {since_ms} remplacé', async () => {
  assert.deepStrictEqual(await keyed.fetchJobdatalakeLive('https://x/{since_ms}', { apiKey: '' }), { status: 'clé absente (JOBDATALAKE_API_KEY)', jobs: [] });
  const seen = [];
  const get = async (url, opts) => { seen.push({ url, opts }); return { status: 200, data: fixture('jobdatalake.json') }; };
  const now = 1_800_000_000_000;
  const { status, jobs } = await keyed.fetchJobdatalakeLive('https://api.example/v1/jobs?posted_after={since_ms}', { apiKey: 'test-key-placeholder', get, now });
  assert.strictEqual(status, 200);
  assert.strictEqual(seen[0].url, `https://api.example/v1/jobs?posted_after=${now - 48 * 3600 * 1000}`);
  assert.strictEqual(seen[0].opts.headers['X-API-Key'], 'test-key-placeholder');
  assert.strictEqual(jobs.length, 2);
  assert.strictEqual(jobs[0].id, 'JDL-gms-001');
  assert.strictEqual(jobs[0].location, 'Paris, France, Lyon, France');
  assert.strictEqual(jobs[0].salary_range, '45000 - 60000 USD');
  assert.strictEqual(jobs[0].remote_declared, true);
  assert.strictEqual(jobs[0].remote_basis, 'remote_type de Jobdatalake');
  assert.strictEqual(jobs[0].description, '');
  assert.strictEqual(jobs[0].date_published, TODAY); // posted_at en secondes
  assert.strictEqual(jobs[1].date_published, TODAY); // posted_at en millisecondes
  assert.ok(jobs[1].id.startsWith('JDL-') && jobs[1].remote_declared === false && jobs[1].salary_range === null);
  assert.deepStrictEqual(await keyed.fetchJobdatalakeLive('https://x/{since_ms}', { apiKey: 'k', get: koGet }), { status: 401, jobs: [] });
});

test('Adzuna : les deux clés requises, 6 pays × 1 requête par défaut (queries_max), remote_declared false, devise par pays', async () => {
  assert.strictEqual((await keyed.fetchAdzunaLive('https://x', { appId: 'a' })).status, 'clé absente (ADZUNA_APP_KEY)');
  assert.strictEqual((await keyed.fetchAdzunaLive('https://x', {})).status, 'clé absente (ADZUNA_APP_ID, ADZUNA_APP_KEY)');
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: fixture('adzuna.json') }; };
  const tpl = 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}%20remote&max_days_old=1';
  const { status, jobs } = await keyed.fetchAdzunaLive(tpl, { appId: 'id-x', appKey: 'key-x', queries: ['growth marketing specialist', 'crm specialist', 'ignored'], get });
  assert.strictEqual(status, 200);
  assert.strictEqual(urls.length, 6); // queries_max 1 par défaut : 6 pays × 1 requête
  assert.ok(urls[0].startsWith('https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=id-x&app_key=key-x&what=growth%20marketing%20specialist%20remote&max_days_old=1&sort_by=date&results_per_page=50'), urls[0]);
  assert.ok(urls[5].includes('/jobs/it/') && !urls.some(u => u.includes('crm%20specialist')));
  assert.strictEqual(jobs.length, 1); // même redirect_url sur les 6 appels → 1
  assert.strictEqual(jobs[0].remote_declared, false);
  assert.strictEqual(jobs[0].company, 'Exemple SAS');
  assert.strictEqual(jobs[0].salary_range, '40000 - 48000 EUR');
  assert.strictEqual(jobs[0].source, 'Adzuna');
  assert.deepStrictEqual(await keyed.fetchAdzunaLive(tpl, { appId: 'a', appKey: 'b', queries: ['x'], get: koGet }), { status: 401, jobs: [] });
  // queries_max 2 depuis l'entrée de job_sources.json : 6 pays × 2 requêtes = 12 appels, comme avant.
  urls.length = 0;
  await keyed.fetchAdzunaLive(tpl, { appId: 'id-x', appKey: 'key-x', queries: ['growth marketing specialist', 'crm specialist', 'ignored'], get, source: { queries_max: 2 } });
  assert.strictEqual(urls.length, 12);
  assert.ok(urls[11].includes('/jobs/it/') && urls[11].includes('crm%20specialist'));
});

test('Adzuna : options par source — what_phrase, where, sans suffixe remote, pays et tri (second candidat sur site)', async () => {
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: fixture('adzuna.json') }; };
  const tpl = 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}%20remote&max_days_old=1&results_per_page=50&content-type=application/json';
  const source = { countries: ['fr'], queries_max: 2, match: 'what_phrase', where: ['Lyon', 'Paris'], remote_suffix: false, max_days_old: 3, sort_by: 'relevance', results_per_page: 20 };
  await keyed.fetchAdzunaLive(tpl, { appId: 'id-x', appKey: 'key-x', queries: ['chargé de marketing', 'traffic manager', 'ignored'], get, source });
  assert.strictEqual(urls.length, 4); // 1 pays × 2 requêtes × 2 lieux
  assert.strictEqual(urls[0], 'https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=id-x&app_key=key-x&what_phrase=charg%C3%A9%20de%20marketing&max_days_old=3&results_per_page=20&content-type=application/json&where=Lyon&sort_by=relevance');
  assert.ok(!urls.some(u => u.includes('what=') || u.includes('%20remote')));
  assert.ok(urls[1].includes('where=Paris') && urls[2].includes('what_phrase=traffic%20manager'));
  assert.deepStrictEqual(keyed.adzunaOptions({}).exclude_titles, ['alternance', 'apprenti', 'stage', 'stagiaire', 'service civique', 'internship']);
  assert.strictEqual(keyed.adzunaOptions({ countries: [] }).countries.length, 6);
});

test('Adzuna : country_params ajoute des paramètres à un seul pays (missions à l\'étranger en CDD)', async () => {
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: fixture('adzuna.json') }; };
  const tpl = 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what_phrase={keyword}&max_days_old=3&results_per_page=50&content-type=application/json';
  const source = { countries: ['fr', 'gb'], queries_max: 1, match: 'what_phrase', remote_suffix: false, country_params: { gb: { contract: '1' }, fr: null } };
  await keyed.fetchAdzunaLive(tpl, { appId: 'id-x', appKey: 'key-x', queries: ['volunteer manager'], get, source });
  assert.strictEqual(urls.length, 2);
  assert.ok(!urls[0].includes('contract='), urls[0]);
  assert.ok(urls[1].includes('/gb/') && urls[1].endsWith('&contract=1'), urls[1]);
  assert.deepStrictEqual(keyed.adzunaOptions({ country_params: ['x'] }).country_params, {});
});

test('Adzuna : <strong> retiré du titre, alternance / stage exclus, redirect_url non https ignorée, salaire estimé étiqueté', async () => {
  const data = { results: [
    { id: '1', title: '<strong>Growth</strong> Marketing Specialist', company: { display_name: 'A' }, redirect_url: 'https://www.adzuna.fr/land/ad/1', created: `${TODAY}T06:00:00Z`, salary_min: 38000, salary_max: 42000, salary_is_predicted: '1' },
    { id: '2', title: 'Chargé de marketing en alternance', company: { display_name: 'B' }, redirect_url: 'https://www.adzuna.fr/land/ad/2', created: `${TODAY}T06:00:00Z` },
    { id: '3', title: 'Stage marketing digital', company: { display_name: 'C' }, redirect_url: 'https://www.adzuna.fr/land/ad/3', created: `${TODAY}T06:00:00Z` },
    { id: '4', title: 'CRM Specialist', company: { display_name: 'D' }, redirect_url: 'http://www.adzuna.fr/land/ad/4', created: `${TODAY}T06:00:00Z` },
    { id: '5', title: 'Marketing Coordinator', company: { display_name: 'E' }, redirect_url: 'https://www.adzuna.fr/land/ad/5', created: `${TODAY}T06:00:00Z`, salary_min: 30000, salary_max: 34000, salary_is_predicted: '0' }
  ] };
  const get = async () => ({ status: 200, data: JSON.stringify(data) });
  const { jobs } = await keyed.fetchAdzunaLive('https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}', { appId: 'a', appKey: 'b', queries: ['x'], get, source: { countries: ['fr'] } });
  assert.deepStrictEqual(jobs.map(j => j.title), ['Growth Marketing Specialist', 'Marketing Coordinator']);
  assert.strictEqual(jobs[0].salary_range, '38000 - 42000 EUR (estimé par Adzuna)');
  assert.strictEqual(jobs[1].salary_range, '30000 - 34000 EUR');
  assert.strictEqual(jobs[0].remote_declared, false);
  const custom = await keyed.fetchAdzunaLive('https://x/{country}?what={keyword}', { appId: 'a', appKey: 'b', queries: ['x'], get, source: { countries: ['fr'], exclude_titles: ['coordinator'] } });
  assert.deepStrictEqual(custom.jobs.map(j => j.title), ['Growth Marketing Specialist', 'Chargé de marketing en alternance', 'Stage marketing digital']);
});

test('JSearch : x-api-key, 10 appels max, job_is_remote → remote_declared', async () => {
  assert.strictEqual((await keyed.fetchJsearchLive('https://x', {})).status, 'clé absente (JSEARCH_API_KEY)');
  const calls = [];
  const get = async (url, opts) => { calls.push({ url, opts }); return { status: 200, data: fixture('jsearch.json') }; };
  const tpl = 'https://api.openwebninja.com/jsearch/search?query={keyword}&country={country}&work_from_home=true';
  const { jobs } = await keyed.fetchJsearchLive(tpl, { apiKey: 'js-key', queries: ['growth marketing specialist', 'crm specialist', 'extra'], get });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(calls[0].opts.headers['x-api-key'], 'js-key');
  assert.strictEqual(jobs.length, 2);
  assert.strictEqual(jobs[0].remote_declared, true);
  assert.strictEqual(jobs[0].remote_basis, 'work_from_home de Google for Jobs via JSearch');
  assert.strictEqual(jobs[0].location, 'Lyon, FR');
  assert.strictEqual(jobs[0].salary_range, '42000 - 50000 EUR');
  assert.strictEqual(jobs[1].remote_declared, false);
  assert.deepStrictEqual(await keyed.fetchJsearchLive(tpl, { apiKey: 'k', queries: ['x'], get: koGet }), { status: 401, jobs: [] });
});

test('Apify : mots-clés de la taxonomie, mapping défensif des items', () => {
  assert.deepStrictEqual(apify.keywordsFrom(['growth marketing specialist', 'crm specialist', 'traffic manager', 'paid acquisition specialist']), ['growth', 'marketing', 'crm', 'paid', 'acquisition']);
  const items = JSON.parse(fixture('apify_items.json')).map(apify.mapItem);
  assert.strictEqual(items[0].id, `APF-${require('./common').hashStr('https://jobs.example/apply/123')}`);
  assert.strictEqual(items[0].company, 'Exemple SAS');
  assert.strictEqual(items[0].remote_declared, true);
  assert.strictEqual(items[0].description, 'We are hiring a lifecycle marketer.');
  assert.strictEqual(items[1].title, 'CRM Manager');
  assert.strictEqual(items[1].location, 'Berlin, Germany');
  assert.strictEqual(items[1].remote_declared, false);
  assert.strictEqual(items[1].source, 'Apify ATS');
});

function apifyHarness(scenario) {
  const log = [];
  const state = { apify_companies_cursor: 0, ...scenario.state };
  const companies = JSON.parse(fixture('companies_sample.json')).map(c => c.careers_url);
  const request = async (url, opts = {}) => {
    log.push({ url, method: opts.method || 'GET', body: opts.body, auth: opts.headers?.Authorization });
    if (/actor-runs\/run-1$/.test(url)) return { status: 200, data: JSON.stringify({ data: { id: 'run-1', status: scenario.runStatus } }) };
    if (/dataset\/items/.test(url)) return { status: 200, data: fixture('apify_items.json') };
    if (opts.method === 'POST') return { status: 201, data: JSON.stringify({ data: { id: 'run-2', status: 'READY' } }) };
    return { status: 404, data: '' };
  };
  const run = () => apify.fetchApifyAtsLive(null, { token: 'tok', queries: ['growth marketing specialist'], input: { maxJobs: 50 }, companies, request, readState: () => state, writeState: st => Object.assign(state, st) });
  return { log, state, run };
}

test('Apify : clé absente ; run en cours → aucune relance', async () => {
  assert.deepStrictEqual(await apify.fetchApifyAtsLive(null, { token: '' }), { status: 'clé absente (APIFY_TOKEN)', jobs: [] });
  const h = apifyHarness({ state: { apify_run_id: 'run-1' }, runStatus: 'RUNNING' });
  assert.deepStrictEqual(await h.run(), { status: 'run Apify en cours', jobs: [] });
  assert.strictEqual(h.log.length, 1);
  assert.strictEqual(h.state.apify_run_id, 'run-1');
});

test('Apify : run réussi → items collectés, puis nouveau run lancé avec le bloc suivant', async () => {
  const h = apifyHarness({ state: { apify_run_id: 'run-1', apify_companies_cursor: 1 }, runStatus: 'SUCCEEDED' });
  const { status, jobs } = await h.run();
  assert.strictEqual(jobs.length, 2);
  assert.ok(status.startsWith('OK · run terminé (2 offres) · run lancé (3 entreprises, bloc 1/1)'), status);
  const post = h.log.find(l => l.method === 'POST');
  assert.ok(post.url.startsWith('https://api.apify.com/v2/acts/greentools~ats-jobs-api/runs'));
  assert.strictEqual(post.auth, 'Bearer tok');
  assert.deepStrictEqual(post.body.companies, ['https://beispiel.example/jobs', 'https://ejemplo.example/trabaja-con-nosotros', 'https://exemple.example/careers']); // rotation depuis le curseur 1
  assert.deepStrictEqual(post.body.keywords, ['growth', 'marketing']);
  assert.strictEqual(post.body.workplace, 'remote');
  assert.strictEqual(post.body.onlyNewJobs, true);
  assert.strictEqual(post.body.maxJobs, 50); // surcharge depuis job_sources.json
  assert.strictEqual(h.state.apify_run_id, 'run-2');
  assert.strictEqual(h.state.apify_companies_cursor, 1); // (1 + 3) % 3
});

test('Apify : premier cycle sans run → lancement seul ; run échoué → signalé puis relancé', async () => {
  const h1 = apifyHarness({ state: {}, runStatus: 'READY' });
  const r1 = await h1.run();
  assert.strictEqual(r1.jobs.length, 0);
  assert.strictEqual(r1.status, 'run lancé (3 entreprises, bloc 1/1)');
  assert.strictEqual(h1.state.apify_run_id, 'run-2');
  const h2 = apifyHarness({ state: { apify_run_id: 'run-1' }, runStatus: 'FAILED' });
  const r2 = await h2.run();
  assert.ok(r2.status.startsWith('run précédent FAILED · run lancé'), r2.status);
});

test('readEnvKeys : seules les variables demandées sont lues, guillemets retirés', () => {
  const dir = tmpDir();
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, '# commentaire\nTELEGRAM_BOT_TOKEN_PRO=ne-doit-pas-sortir\nJOBDATALAKE_API_KEY="valeur-test"\nexport ADZUNA_APP_ID=\'id-test\'\nADZUNA_APP_KEY=\nAPIFY_TOKEN = tok-test  \n');
  const keys = readEnvKeys(envPath, ['JOBDATALAKE_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'APIFY_TOKEN']);
  assert.deepStrictEqual(keys, { JOBDATALAKE_API_KEY: 'valeur-test', ADZUNA_APP_ID: 'id-test', APIFY_TOKEN: 'tok-test' });
  assert.deepStrictEqual(readEnvKeys(path.join(dir, 'absent.env'), ['X']), {});
  // Plusieurs chemins : le premier fichier qui donne la variable gagne, les absents sont ignorés.
  const second = path.join(dir, 'second.env');
  fs.writeFileSync(second, 'JOBDATALAKE_API_KEY=perdant\nJSEARCH_API_KEY=js-second\n');
  assert.deepStrictEqual(readEnvKeys([path.join(dir, 'absent.env'), envPath, second], ['JOBDATALAKE_API_KEY', 'JSEARCH_API_KEY']), { JOBDATALAKE_API_KEY: 'valeur-test', JSEARCH_API_KEY: 'js-second' });
  // resolveKeys : l'environnement du processus passe avant les fichiers ; une variable vide n'y compte pas.
  assert.deepStrictEqual(resolveKeys(['JOBDATALAKE_API_KEY', 'JSEARCH_API_KEY', 'APIFY_TOKEN'], [envPath, second], { JOBDATALAKE_API_KEY: 'env-gagne', APIFY_TOKEN: '  ' }), { JOBDATALAKE_API_KEY: 'env-gagne', JSEARCH_API_KEY: 'js-second', APIFY_TOKEN: 'tok-test' });
  fs.rmSync(dir, { recursive: true, force: true });
});

function careerDirWith(sources) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'job_sources.json'), JSON.stringify({ version: 'test', sources }));
  fs.writeFileSync(path.join(dir, 'career_taxonomy.json'), JSON.stringify({ search_queries: ['growth marketing specialist'] }));
  return dir;
}

test('cadence : min_interval_min saute la source puis la rappelle, l\'état est écrit même en échec', async () => {
  const sources = [
    { name: 'Jobicy', type: 'api_json', endpoint: 'https://jobicy.test/api', enabled: true, min_interval_min: 60 },
    { name: 'Jobdatalake', type: 'api_key', endpoint: 'https://jdl.test/{since_ms}', enabled: true, min_interval_min: 60, key: 'JOBDATALAKE_API_KEY' },
    { name: 'Himalayas Remote', type: 'api_json', endpoint: 'https://him.test', enabled: true }
  ];
  const careerDir = careerDirWith(sources);
  const envPath = path.join(careerDir, 'nope.env');
  const hits = [];
  const fetchUrl = async (url) => { hits.push(url); return url.includes('jobicy') ? { status: 200, data: fixture('jobicy.json') } : { status: 200, data: '{"jobs":[]}' }; };
  const base = { careerDir, envPath, fetchUrl, request: async () => ({ status: 500, data: '' }), jobgetherPauseMs: 0 };
  const t0 = Date.parse('2026-10-23T10:00:00Z');

  const r1 = await fetchAllActiveSources({ ...base, now: t0 });
  const byName = r => Object.fromEntries(r.sources.map(s => [s.name, s]));
  assert.strictEqual(byName(r1).Jobicy.status, 200);
  assert.strictEqual(byName(r1).Jobicy.count, 2);
  assert.strictEqual(byName(r1).Jobdatalake.status, 'clé absente (JOBDATALAKE_API_KEY)');
  assert.strictEqual(byName(r1).Himalayas.status, 200);
  const st = readSourceState(careerDir);
  assert.strictEqual(st.Jobicy, new Date(t0).toISOString());
  assert.strictEqual(st.Jobdatalake, new Date(t0).toISOString()); // échec de clé : horodaté quand même
  assert.strictEqual(st['Himalayas Remote'], undefined);

  const r2 = await fetchAllActiveSources({ ...base, now: t0 + 20 * 60000 });
  assert.strictEqual(byName(r2).Jobicy.status, 'attente (prochain appel dans 40 min)');
  assert.strictEqual(byName(r2).Jobicy.count, 0);
  assert.strictEqual(byName(r2).Jobdatalake.status, 'attente (prochain appel dans 40 min)');
  assert.strictEqual(byName(r2).Himalayas.status, 200);
  assert.strictEqual(hits.filter(u => u.includes('jobicy')).length, 1);

  const r3 = await fetchAllActiveSources({ ...base, now: t0 + 61 * 60000 });
  assert.strictEqual(byName(r3).Jobicy.status, 200);
  assert.strictEqual(hits.filter(u => u.includes('jobicy')).length, 2);
  assert.ok(writeSourceState(careerDir, { ...readSourceState(careerDir), note: 'x' }));
  fs.rmSync(careerDir, { recursive: true, force: true });
});

test('dispatcher : les offres passent le filtre sémantique et le dédoublonnage par lien', async () => {
  const careerDir = careerDirWith([{ name: 'Growth.Talent', type: 'api_json', endpoint: 'https://gt.test', enabled: true }]);
  const fetchUrl = async () => ({ status: 200, data: fixture('growthtalent.json') });
  const { jobs, sources } = await fetchAllActiveSources({ careerDir, envPath: path.join(careerDir, 'nope.env'), fetchUrl, request: async () => ({ status: 500, data: '' }), jobgetherPauseMs: 0 });
  const gt = sources.find(s => s.name === 'Growth.Talent');
  assert.strictEqual(gt.status, 200);
  assert.strictEqual(gt.count, 2);
  assert.ok(sources.some(s => s.name === 'Apify ATS' && s.status === 'clé absente (APIFY_TOKEN)'));
  assert.ok(jobs.every(j => j.source === 'Growth.Talent'));
  assert.ok(jobs.some(j => j.title === 'Senior Marketing Manager'));
  assert.strictEqual(new Set(jobs.map(j => j.link)).size, jobs.length);
  // sourcesConfig / taxonomy passés en option : le dossier carrière n'est pas relu (une source
  // désactivée dans l'objet passé ne tourne pas, même si job_sources.json sur disque l'active).
  const passed = await fetchAllActiveSources({ careerDir, envPath: path.join(careerDir, 'nope.env'), fetchUrl, request: async () => ({ status: 500, data: '' }), jobgetherPauseMs: 0,
    sourcesConfig: { version: 'x', sources: [{ name: 'Growth.Talent', enabled: false }, { name: 'Himalayas Remote', enabled: true, endpoint: 'https://him.test' }] }, taxonomy: { search_queries: ['growth'] } });
  assert.ok(!passed.sources.some(s => s.name === 'Growth.Talent'));
  assert.ok(passed.sources.some(s => s.name === 'Himalayas'));
  assert.ok(passed.sources.some(s => s.name === 'WeWorkRemotely')); // absente de la configuration : active (VM)
  // onlyListed : seules les sources listées et actives tournent (career-radar).
  const listed = await fetchAllActiveSources({ careerDir, envPath: path.join(careerDir, 'nope.env'), fetchUrl, request: async () => ({ status: 500, data: '' }), jobgetherPauseMs: 0, onlyListed: true,
    sourcesConfig: { sources: [{ name: 'Growth.Talent', enabled: false }, { name: 'Himalayas Remote', enabled: true, endpoint: 'https://him.test' }] }, taxonomy: { search_queries: ['growth'] } });
  assert.deepStrictEqual(listed.sources.map(s => s.name), ['Himalayas']);
  fs.rmSync(careerDir, { recursive: true, force: true });
});

// offre_age_max_jours du candidat (career-radar) : les filtres de fraîcheur côté source ne font
// que se resserrer, le nombre d'appels ne change pas.
test('âge maximal : Adzuna max_days_old plafonné, jamais élargi ; appels inchangés', async () => {
  assert.strictEqual(keyed.adzunaOptions({}, 7).max_days_old, 1); // défaut 1 jour, plus strict que 7
  assert.strictEqual(keyed.adzunaOptions({ max_days_old: 10 }, 7).max_days_old, 7);
  assert.strictEqual(keyed.adzunaOptions({ max_days_old: 3 }, 2).max_days_old, 2);
  assert.strictEqual(keyed.adzunaOptions({ max_days_old: 10 }, 0).max_days_old, 10); // 0 : sans effet
  assert.strictEqual(keyed.adzunaOptions({ max_days_old: 10 }).queries_max, 1);
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: fixture('adzuna.json') }; };
  const tpl = 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}&max_days_old=30';
  await keyed.fetchAdzunaLive(tpl, { appId: 'a', appKey: 'b', queries: ['growth'], get, source: { max_days_old: 30 }, maxAgeDays: 7 });
  assert.strictEqual(urls.length, 6);
  assert.ok(urls.every(u => u.includes('max_days_old=7') && !u.includes('max_days_old=30')), urls[0]);
});

test('âge maximal : Jobdatalake {since_ms} et Apify postedWithinDays resserrés, jamais élargis', async () => {
  const seen = [];
  const get = async (url) => { seen.push(url); return { status: 200, data: '{"jobs":[]}' }; };
  const now = 1_800_000_000_000;
  await keyed.fetchJobdatalakeLive('https://jdl.test?after={since_ms}', { apiKey: 'k', get, now, maxAgeDays: 1 });
  await keyed.fetchJobdatalakeLive('https://jdl.test?after={since_ms}', { apiKey: 'k', get, now, maxAgeDays: 7 });
  assert.deepStrictEqual(seen, [`https://jdl.test?after=${now - 24 * 3600 * 1000}`, `https://jdl.test?after=${now - 48 * 3600 * 1000}`]);
  const posts = [];
  const request = async (url, opts = {}) => { if (opts.method === 'POST') posts.push(opts.body); return { status: 201, data: JSON.stringify({ data: { id: 'run-x' } }) }; };
  const base = { token: 'tok', queries: ['growth'], companies: ['https://a.example/careers'], request, readState: () => ({}), writeState: () => true };
  await apify.fetchApifyAtsLive(null, { ...base, maxAgeDays: 1 });
  await apify.fetchApifyAtsLive(null, { ...base, maxAgeDays: 7 });
  await apify.fetchApifyAtsLive(null, { ...base, input: { postedWithinDays: 14 }, maxAgeDays: 7 });
  assert.deepStrictEqual(posts.map(b => b.postedWithinDays), [1, 2, 7]);
});

test('âge maximal : le dispatcher passe maxAgeDays à Adzuna ; JSearch lit job_posted_at_timestamp sans date ISO', async () => {
  const careerDir = careerDirWith([]);
  const urls = [];
  const request = async (url) => { urls.push(url); return { status: 200, data: '{"results":[]}' }; };
  await fetchAllActiveSources({ careerDir, envPath: path.join(careerDir, 'nope.env'), env: { ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }, fetchUrl: koGet, request, onlyListed: true, maxAgeDays: 5,
    sourcesConfig: { sources: [{ name: 'Adzuna', enabled: true, countries: ['fr'], max_days_old: 30, url_template: 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}' }] }, taxonomy: { search_queries: ['growth'] } });
  assert.strictEqual(urls.length, 1);
  assert.ok(urls[0].includes('max_days_old=5'), urls[0]);
  fs.rmSync(careerDir, { recursive: true, force: true });
  const data = { data: [{ job_id: 'j1', employer_name: 'A', job_title: 'Growth', job_apply_link: 'https://a.example/1', job_posted_at_timestamp: NOW_S, job_is_remote: true }] };
  const { jobs } = await keyed.fetchJsearchLive('https://x/{country}?q={keyword}', { apiKey: 'k', countries: ['fr'], queries: ['growth'], get: async () => ({ status: 200, data: JSON.stringify(data) }) });
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].date_published, TODAY);
});
