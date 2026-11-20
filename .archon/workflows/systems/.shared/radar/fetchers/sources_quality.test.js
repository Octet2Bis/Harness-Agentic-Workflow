/**
 * sources_quality.test.js — Ce qui a changé le 2026-10-23 pour que les nouvelles sources
 * rapportent des offres valables : requêtes des sources par mot-clé (intitulés cœur en anglais,
 * curseur tournant, quota Adzuna), filtre de pertinence (titres cœur jamais perdus à cause de
 * requêtes en français), description complète gardée pour le tri, état Apify qui n'efface plus
 * la cadence des autres sources. Aucun réseau : fausses réponses seulement.
 * Lancement : node --test (node:test), exécuté tel quel par `bun test`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_SOURCE_QUERIES, sourceQueries, rotate, takeQueries } = require('./query_picker');
const { htmlToText, fullDescriptionField, FULL_DESCRIPTION_MAX } = require('./full_description');
const { fetchAllActiveSources, matchesAnyTargetQuery, writeApifyState, readSourceState, writeSourceState } = require('./index');
const { fetchHimalayasLive, fetchRemotiveLive } = require('./api_fetchers');
const { fetchJobicyLive, jobgetherQueries } = require('./board_fetchers');
const { parseRssItems } = require('./rss_fetchers');
const { fetchJobdatalakeLive, adzunaOptions } = require('./key_fetchers');
const apify = require('./apify_fetcher');

const TODAY = new Date().toISOString().slice(0, 10);
const NOW_S = Math.floor(Date.now() / 1000);
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'radar-quality-'));
const DEFAULT_SOURCES = path.join(__dirname, '..', '..', '..', 'career-radar', 'job_sources.default.json');
const LONG = '<p>We are hiring a <b>Growth Marketing Manager</b> to own acquisition.</p>' + '<p>You will run lifecycle campaigns, HubSpot workflows and reporting across Europe.</p>'.repeat(8);

// Antoine : 102 requêtes, beaucoup en français ; les premières ne sont pas des intitulés anglais.
const FRENCH_QUERIES = ['chargé de revops', 'chargé de croissance', 'responsable acquisition', 'chargé de marketing automation', 'traffic manager'];

test('requêtes des sources : source_queries d\'abord ; Antoine sans liste → intitulés cœur anglais ; autre candidat → ses search_queries', () => {
  assert.deepStrictEqual(sourceQueries({ search_queries: FRENCH_QUERIES, source_queries: ['Product Ops', 'crm manager', 'product ops'] }), ['Product Ops', 'crm manager']);
  assert.deepStrictEqual(sourceQueries({ search_queries: FRENCH_QUERIES }), DEFAULT_SOURCE_QUERIES);
  assert.ok(DEFAULT_SOURCE_QUERIES.includes('growth marketing manager') && DEFAULT_SOURCE_QUERIES.includes('product operations') && DEFAULT_SOURCE_QUERIES.includes('revops'));
  assert.ok(DEFAULT_SOURCE_QUERIES.every(q => /^[a-z ]+$/.test(q)), 'des intitulés anglais, sans accent');
  const other = { core_domains: ['événementiel'], search_queries: ['chargé de projet événementiel', 'coordinateur sportif'] };
  assert.deepStrictEqual(sourceQueries(other), other.search_queries);
});

test('curseur tournant : chaque appel avance du nombre de requêtes consommées, modulo la liste', () => {
  assert.deepStrictEqual(rotate(['a', 'b', 'c'], 4), ['b', 'c', 'a']);
  assert.deepStrictEqual(rotate([], 3), []);
  const state = {};
  assert.deepStrictEqual(takeQueries(state, 'Adzuna', ['a', 'b', 'c'], 1).slice(0, 1), ['a']);
  assert.deepStrictEqual(takeQueries(state, 'Adzuna', ['a', 'b', 'c'], 1).slice(0, 1), ['b']);
  assert.deepStrictEqual(takeQueries(state, 'JSearch', ['a', 'b', 'c'], 2).slice(0, 2), ['a', 'b']);
  assert.deepStrictEqual(takeQueries(state, 'JSearch', ['a', 'b', 'c'], 2).slice(0, 2), ['c', 'a']);
  assert.deepStrictEqual(state.query_cursor, { Adzuna: 2, JSearch: 1 });
  // Jobgether : tous les intitulés cœur passent son filtre de thèmes.
  assert.deepStrictEqual(jobgetherQueries(DEFAULT_SOURCE_QUERIES, Infinity), DEFAULT_SOURCE_QUERIES);
});

test('dispatcher : Adzuna interroge les intitulés anglais, une requête différente à chaque cycle, 6 appels par cycle', async () => {
  const careerDir = tmpDir();
  fs.writeFileSync(path.join(careerDir, 'career_taxonomy.json'), JSON.stringify({ search_queries: FRENCH_QUERIES }));
  const urls = [];
  const request = async (url) => { urls.push(url); return { status: 200, data: '{"results":[]}' }; };
  const sourcesConfig = { sources: [{ name: 'Adzuna', enabled: true, url_template: 'https://api.adzuna.com/v1/api/jobs/{country}/search/1?app_id={APP_ID}&app_key={APP_KEY}&what={keyword}%20remote' }] };
  const run = () => fetchAllActiveSources({ careerDir, envPath: path.join(careerDir, 'nope.env'), env: { ADZUNA_APP_ID: 'id', ADZUNA_APP_KEY: 'key' },
    request, fetchUrl: async () => ({ status: 503, data: '' }), sourcesConfig, onlyListed: true });
  await run();
  assert.strictEqual(urls.length, 6);
  assert.ok(urls.every(u => u.includes('what=growth%20marketing%20manager%20remote')), urls[0]);
  assert.ok(!urls.some(u => /charg/.test(u)));
  urls.length = 0;
  await run();
  assert.ok(urls.every(u => u.includes('what=product%20operations%20remote')), urls[0]);
  assert.deepStrictEqual(readSourceState(careerDir).query_cursor, { Adzuna: 2 });
  fs.rmSync(careerDir, { recursive: true, force: true });
});

test('quota Adzuna de la configuration par défaut : au plus 100 appels par jour pour Antoine', () => {
  const adzuna = JSON.parse(fs.readFileSync(DEFAULT_SOURCES, 'utf8')).sources.find(s => s.name === 'Adzuna');
  const o = adzunaOptions(adzuna);
  const perDay = o.countries.length * o.queries_max * o.where.length * Math.ceil(1440 / adzuna.min_interval_min);
  assert.ok(perDay <= 100, `${perDay} appels par jour`);
});

test('filtre de pertinence : les intitulés cœur passent même quand la taxonomie est en français', () => {
  const keep = ['Growth Marketing Manager', 'Product Ops Manager', 'Product Operations Specialist', 'CRM Manager', 'Lifecycle Marketing Specialist',
    'Marketing Automation Specialist', 'Email Marketing Manager', 'Email Specialist', 'RevOps Analyst', 'Revenue Operations Manager', 'Chargé(e) de RevOps'];
  for (const title of keep) assert.ok(matchesAnyTargetQuery({ title, description: '' }, FRENCH_QUERIES), title);
  const drop = ['Senior Backend Engineer', 'QA Engineer', 'Account Executive', 'Data Scientist'];
  for (const title of drop) assert.ok(!matchesAnyTargetQuery({ title, description: 'We build software.' }, FRENCH_QUERIES), title);
});

test('filtre de pertinence : une requête aux mots courts correspond enfin (avant : jamais) ; les mots de liaison ne comptent pas', () => {
  // Un candidat avec ses propres mots de domaine : seule la requête peut faire passer le titre.
  const domains = ['événementiel'];
  assert.ok(matchesAnyTargetQuery({ title: 'CRM Specialist (Remote)' }, ['crm specialist'], domains));
  assert.ok(matchesAnyTargetQuery({ title: 'Chargé de projet événementiel' }, ['chargé de projet'], domains));
  assert.ok(matchesAnyTargetQuery({ title: 'Specialist, CRM' }, ['crm specialist'], domains));
  assert.ok(!matchesAnyTargetQuery({ title: 'Seoul Office Manager' }, ['seo'], domains));
  assert.ok(matchesAnyTargetQuery({ title: 'Coordinator', description: 'Une mission de chargé de projet.' }, ['chargé de projet'], domains));
});

test('description complète : HTML en texte, paragraphes gardés, plafonnée, absente quand la source ne donne que le résumé', () => {
  assert.strictEqual(htmlToText('<p>Hello <b>you</b></p><ul><li>One</li><li>Two &amp; three</li></ul>'), 'Hello you\nOne\nTwo & three');
  assert.strictEqual(htmlToText('&lt;p&gt;Escaped &amp;amp; fine&lt;/p&gt;'), 'Escaped & fine');
  assert.deepStrictEqual(fullDescriptionField('<p>Short excerpt.</p>'), {});
  assert.ok(fullDescriptionField(LONG).description_full.startsWith('We are hiring a Growth Marketing Manager'));
  assert.ok(fullDescriptionField('<p>x</p>'.repeat(1) + 'y'.repeat(FULL_DESCRIPTION_MAX + 50)).description_full.length <= FULL_DESCRIPTION_MAX + 1);
});

test('description complète : gardée par Himalayas, Remotive, Jobicy, les flux RSS et Apify ; le résumé du jury reste à 400 caractères', async () => {
  const pub = Math.floor(Date.now() / 1000);
  const him = await fetchHimalayasLive('https://him.test', async () => ({ status: 200, data: JSON.stringify({ jobs: [{ title: 'Growth Marketing Manager', companyName: 'Acme', applicationLink: 'https://him.test/j/1', pubDate: pub, excerpt: 'Short.', description: LONG }] }) }));
  assert.strictEqual(him.jobs[0].description, 'Short.');
  assert.ok(him.jobs[0].description_full.includes('HubSpot workflows'));
  const rem = await fetchRemotiveLive('https://rem.test', async () => ({ status: 200, data: JSON.stringify({ jobs: [{ id: 1, title: 'CRM Manager', url: 'https://rem.test/1', publication_date: `${TODAY}T08:00:00`, description: LONG }] }) }));
  assert.ok(rem.jobs[0].description.length <= 400);
  assert.ok(rem.jobs[0].description_full.length > 400);
  const jcy = await fetchJobicyLive('https://jcy.test', async () => ({ status: 200, data: JSON.stringify({ jobs: [{ id: 2, url: 'https://jobicy.com/jobs/2-crm', jobTitle: 'CRM Manager', companyName: 'Acme', pubDate: `${TODAY}T08:00:00+00:00`, jobExcerpt: 'Short.', jobDescription: LONG }] }) }));
  assert.ok(jcy.jobs[0].description_full.includes('lifecycle campaigns'));
  const rss = parseRssItems(`<rss><channel><item><title>Acme: Growth Manager</title><link>https://wwr.test/1</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[Short]]></description><content:encoded><![CDATA[${LONG}]]></content:encoded></item></channel></rss>`);
  assert.ok(htmlToText(rss[0].descHtml).includes('HubSpot workflows'));
  const item = apify.mapItem({ title: 'Product Operations Manager', company: 'Acme', applyUrl: 'https://acme.wd3.myworkdayjobs.com/x/job/Remote/Product-Ops_R1/apply', url: 'https://acme.wd3.myworkdayjobs.com/x/job/Remote/Product-Ops_R1', remoteType: 'remote', description: LONG });
  assert.strictEqual(item.link, 'https://acme.wd3.myworkdayjobs.com/x/job/Remote/Product-Ops_R1/apply');
  assert.strictEqual(item.posting_url, 'https://acme.wd3.myworkdayjobs.com/x/job/Remote/Product-Ops_R1');
  assert.ok(item.description_full.includes('HubSpot workflows'));
  assert.strictEqual(apify.mapItem({ title: 'CRM', url: 'https://x.test/1' }).posting_url, undefined);
});

test('Jobdatalake : une adresse avec {keyword} fait un appel par requête (queriesMax), sans {keyword} un seul appel comme avant', async () => {
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: JSON.stringify({ jobs: [{ title: 'CRM Manager', url: 'https://x.test/crm', posted_at: NOW_S, remote_type: 'fully_remote' }] }) }; };
  const r = await fetchJobdatalakeLive('https://jdl.test/v1/jobs?q={keyword}&posted_after={since_ms}', { apiKey: 'k', get, queries: ['crm manager', 'product operations', 'revops'], queriesMax: 2 });
  assert.deepStrictEqual(urls.map(u => u.split('&')[0]), ['https://jdl.test/v1/jobs?q=crm%20manager', 'https://jdl.test/v1/jobs?q=product%20operations']);
  assert.strictEqual(r.jobs.length, 1); // dédoublonné par url
  urls.length = 0;
  await fetchJobdatalakeLive('https://jdl.test/v1/jobs?job_function=marketing', { apiKey: 'k', get, queries: ['crm manager'] });
  assert.deepStrictEqual(urls, ['https://jdl.test/v1/jobs?job_function=marketing']);
});

test('état Apify : seules ses clés sont réécrites, les horodatages et curseurs posés entre-temps restent', () => {
  const careerDir = tmpDir();
  const snapshot = { Adzuna: '2026-10-22T08:00:00.000Z', apify_companies_cursor: 0 }; // lu par Apify au départ
  writeSourceState(careerDir, { Adzuna: '2026-10-23T10:00:00.000Z', query_cursor: { Adzuna: 3 }, apify_run_id: 'old', apify_companies_cursor: 0 });
  writeApifyState(careerDir, { ...snapshot, apify_companies_cursor: 120, apify_run_id: 'run-2' });
  assert.deepStrictEqual(readSourceState(careerDir), { Adzuna: '2026-10-23T10:00:00.000Z', query_cursor: { Adzuna: 3 }, apify_run_id: 'run-2', apify_companies_cursor: 120 });
  writeApifyState(careerDir, { apify_companies_cursor: 240 }); // run relevé : apify_run_id supprimé
  assert.strictEqual(readSourceState(careerDir).apify_run_id, undefined);
  assert.strictEqual(readSourceState(careerDir).Adzuna, '2026-10-23T10:00:00.000Z');
  fs.rmSync(careerDir, { recursive: true, force: true });
});
