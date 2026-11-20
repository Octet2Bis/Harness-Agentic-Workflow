/**
 * extra_fetchers.test.js — Freehire, recherche Workable, liste Next40/120
 * Lancement : node --test .archon/workflows/systems/.shared/radar/fetchers/*.test.js
 * Fixtures sous ../test (réponses réelles du 2026-10-24, complétées d'offres construites : voir `_fixture`).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const extra = require('./extra_fetchers');

const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'test', name), 'utf8');
const SHAPE = ['id', 'company', 'title', 'location', 'remote_declared', 'remote_basis', 'company_hq', 'skills_required', 'description', 'salary_range', 'link', 'date_published', 'source'];
const assertShape = job => SHAPE.forEach(k => assert.ok(k in job, `champ manquant : ${k}`));
const recorder = (name, statusFor = () => 200) => {
  const calls = [];
  const get = async url => { calls.push(url); const s = statusFor(url, calls.length); return { status: s, data: s === 200 ? fixture(name) : '' }; };
  return { calls, get };
};
const koGet = async () => ({ status: 503, data: '' });

test('Freehire : forme réelle, offre close écartée, utm retiré, salaire, entités décodées', async () => {
  const { calls, get } = recorder('freehire.json');
  const { status, jobs } = await extra.fetchFreehireLive(null, ['growth marketing', 'crm manager'], get, 0);
  assert.strictEqual(status, 200);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].includes('q=%22growth%20marketing%22') && calls[0].includes('q_fields=title') && calls[0].includes('work_mode=remote'));
  assert.ok(calls[0].includes('source_exclude=jobicy'));
  assert.strictEqual(jobs.length, 2); // 3 offres × 2 appels → close retirée, doublons retirés
  jobs.forEach(assertShape);
  const [a, b] = jobs;
  assert.strictEqual(a.id, 'FH-growth-product-marketing-lead-keyvoto-ike-eob7ogvo');
  assert.strictEqual(a.title, 'Growth & Product Marketing Lead');
  assert.strictEqual(a.link, 'https://www.careers-page.com/keyvoto-ike/job/W3X558WW');
  assert.strictEqual(a.remote_declared, true);
  assert.strictEqual(a.date_published, '2026-10-23');
  assert.strictEqual(a.source, 'Freehire (freehire.me, ATS manatal)');
  assert.ok(a.skills_required.startsWith('ab-testing, analytics'));
  assert.strictEqual(b.title, 'CRM & Lifecycle Manager');
  assert.strictEqual(b.location, 'FR, ES');
  assert.strictEqual(b.salary_range, '50000 - 60000 EUR (year)');
  assert.strictEqual(b.description, 'Own the CRM roadmap.');
});

test('Freehire : non-200 → { status, jobs: [] } ; 429 arrête la source au premier', async () => {
  assert.deepStrictEqual(await extra.fetchFreehireLive(null, ['growth'], koGet, 0), { status: 503, jobs: [] });
  const { calls, get } = recorder('freehire.json', () => 429);
  assert.deepStrictEqual(await extra.fetchFreehireLive(null, ['growth', 'crm', 'revops'], get, 0), { status: 429, jobs: [] });
  assert.strictEqual(calls.length, 1);
});

test('Freehire : paramètre ignoré par le serveur = échec visible ; 6 requêtes max', async () => {
  const body = JSON.stringify({ data: JSON.parse(fixture('freehire.json')).data, meta: { total: 3, ignored_params: [{ param: 'regionz', did_you_mean: 'regions' }] } });
  const { status, jobs } = await extra.fetchFreehireLive(null, ['growth'], async () => ({ status: 200, data: body }), 0);
  assert.strictEqual(status, 'paramètre ignoré : regionz');
  assert.deepStrictEqual(jobs, []);
  const { calls, get } = recorder('freehire.json');
  await extra.fetchFreehireLive(null, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a1'], get, 0);
  assert.strictEqual(calls.length, 6);
});

test('Workable : forme réelle, TELECOMMUTE retiré du lieu, non publié écarté, description complète', async () => {
  const { calls, get } = recorder('workable_search.json');
  const { status, jobs } = await extra.fetchWorkableSearchLive(null, ['growth marketing'], get, 0);
  assert.strictEqual(status, 200);
  assert.ok(calls[0].startsWith('https://jobs.workable.com/api/v1/jobs?query=growth%20marketing&location=Europe&workplace=remote'));
  assert.ok(!calls[0].includes('/search'));
  assert.strictEqual(jobs.length, 2);
  jobs.forEach(assertShape);
  const [a, b] = jobs;
  assert.strictEqual(a.id, 'WKS-86ffcaf6-d9f5-4c9e-bacf-691069d38296');
  assert.strictEqual(a.company, 'Carry1st');
  assert.strictEqual(a.location, 'Serbia');
  assert.strictEqual(a.remote_declared, true);
  assert.strictEqual(a.date_published, '2026-10-20');
  assert.strictEqual(a.skills_required, 'Full-time');
  assert.strictEqual(b.location, 'Lisboa, Lisboa, Portugal');
  assert.strictEqual(b.remote_declared, false); // l'auditeur verra « hybrid »
  assert.strictEqual(b.title, 'Marketing Automation Specialist – Lisboa');
});

test('Workable : non-200 → { status, jobs: [] } ; 4 requêtes max ; 200 si un appel répond', async () => {
  assert.deepStrictEqual(await extra.fetchWorkableSearchLive(null, ['growth'], koGet, 0), { status: 503, jobs: [] });
  const { calls, get } = recorder('workable_search.json', (url, n) => (n === 1 ? 503 : 200));
  const { status, jobs } = await extra.fetchWorkableSearchLive(null, ['q1', 'q2', 'q3', 'q4', 'q5'], get, 0);
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(status, 200);
  assert.strictEqual(jobs.length, 2);
  assert.deepStrictEqual(await extra.fetchWorkableSearchLive(null, [], koGet, 0), { status: 'aucune requête', jobs: [] });
});

test('next40_boards.json : forme attendue, slugs non vides, sans doublon, origine nommée', () => {
  const boards = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'next40_boards.json'), 'utf8'));
  assert.ok(String(boards._source).includes('lafrenchtech.com'));
  for (const ats of ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'teamtailor']) {
    assert.ok(Array.isArray(boards[ats]), ats);
    assert.strictEqual(new Set(boards[ats]).size, boards[ats].length, `doublon dans ${ats}`);
    boards[ats].forEach(s => assert.match(s, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, `${ats}:${s}`));
  }
  assert.ok(boards.lever.includes('Fairmat')); // casse gardée (Lever y est sensible)
  boards.other.forEach(o => assert.ok(o.company && /^https:\/\//.test(o.url)));
});
