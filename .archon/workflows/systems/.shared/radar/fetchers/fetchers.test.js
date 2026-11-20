/**
 * fetchers.test.js — Connecteurs sans clé, WTTJ, LinkedIn, auditeur remote
 * Lancement : node --test career_ops/fetchers/   (node:test, sans dépendance)
 * Les fixtures réelles sous ./test sont datées du 2026-10-23 : les dates sont ramenées à aujourd'hui
 * avant analyse pour que le filtre 48 h reste vrai quel que soit le jour du test.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const boards = require('./board_fetchers');
const { fetchLinkedInLive, DESC_FETCH_CAP } = require('./linkedin_fetcher');
const { evaluateRemote } = require('../inspectors/remote_auditor');
const { request } = require('./request');

const TODAY = new Date().toISOString().slice(0, 10);
const RFC_TODAY = new Date().toUTCString().slice(0, 16);
const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'test', name), 'utf8')
  .replace(/2026-10-2[13]/g, TODAY).replace(/Fri, 23 Oct 2026/g, RFC_TODAY);
const okGet = name => async () => ({ status: 200, data: fixture(name) });
const koGet = async () => ({ status: 503, data: '' });
const SHAPE = ['id', 'company', 'title', 'location', 'remote_declared', 'company_hq', 'skills_required', 'description', 'salary_range', 'link', 'date_published', 'source'];
const assertShape = job => SHAPE.forEach(k => assert.ok(k in job, `champ manquant : ${k}`));

test('Jobgether : mapping réel, dédoublonnage par url, 6 requêtes max, pas de pause en test', async () => {
  const calls = [];
  const get = async (url) => { calls.push(url); return { status: 200, data: fixture('jobgether.json') }; };
  const queries = ['growth marketing specialist', 'traffic manager', 'crm specialist', 'gtm specialist', 'lifecycle marketing specialist', 'demand generation specialist', 'revenue analyst', 'marketing coordinator'];
  const { status, jobs } = await boards.fetchJobgetherLive(null, queries, get, 0);
  assert.strictEqual(status, 200);
  assert.strictEqual(calls.length, 6);
  assert.ok(calls[0].includes('keyword=growth%20marketing%20specialist') && calls[0].includes('remoteType=full-remote'));
  assert.strictEqual(jobs.length, 2); // 3 items × 6 appels → 2 urls distinctes
  assertShape(jobs[0]);
  assert.strictEqual(jobs[0].id, 'JG-6adad54322c2644c03e0cc65');
  assert.strictEqual(jobs[0].company, 'Beglaubigt.de');
  assert.strictEqual(jobs[0].remote_declared, true);
  assert.strictEqual(jobs[0].remote_basis, 'filtre full-remote de Jobgether');
  assert.strictEqual(jobs[0].date_published, TODAY);
});

test('Jobgether : non-200 → status visible, aucune offre', async () => {
  assert.deepStrictEqual(await boards.fetchJobgetherLive(null, ['growth marketing'], koGet, 0), { status: 503, jobs: [] });
});

test('Growth.Talent : enveloppe { data } réelle, company.name, remote REMOTE', async () => {
  const { status, jobs } = await boards.fetchGrowthTalentLive(null, okGet('growthtalent.json'));
  assert.strictEqual(status, 200);
  assert.strictEqual(jobs.length, 2);
  assertShape(jobs[1]);
  assert.strictEqual(jobs[1].company, 'Yubo');
  assert.strictEqual(jobs[1].location, 'Paris - Full Remote');
  assert.strictEqual(jobs[1].remote_declared, true);
  assert.strictEqual(jobs[1].source, 'Growth.Talent');
  assert.strictEqual(jobs[0].location, 'Hybrid Paris'); // l'auditeur verra « hybrid »
  assert.deepStrictEqual(await boards.fetchGrowthTalentLive(null, koGet), { status: 503, jobs: [] });
});

test('Growth.Talent : plusieurs marchés, chaque URL appelée, doublons retirés, 200 si un appel répond', async () => {
  const calls = [];
  const get = async url => { calls.push(url); return url.includes('market=latam') ? { status: 503, data: '' } : { status: 200, data: fixture('growthtalent.json') }; };
  const urls = ['https://gt.test/jobs?market=france', 'https://gt.test/jobs?market=usa&seniority=JUNIOR,MID', 'https://gt.test/jobs?market=latam'];
  const { status, jobs } = await boards.fetchGrowthTalentLive(urls, get);
  assert.deepStrictEqual(calls, urls);
  assert.strictEqual(status, 200);
  assert.strictEqual(jobs.length, 2); // les deux marchés renvoient les mêmes offres : une seule fois chacune
  assert.deepStrictEqual(await boards.fetchGrowthTalentLive(['https://gt.test/a', 'https://gt.test/b'], koGet), { status: 503, jobs: [] });
});

test('Jobicy : champs réels (jobTitle, salaryMin/Max, tableaux), crédit dans source', async () => {
  const { jobs } = await boards.fetchJobicyLive(null, okGet('jobicy.json'));
  assert.strictEqual(jobs.length, 2);
  assertShape(jobs[0]);
  assert.strictEqual(jobs[0].id, 'JCY-156542');
  assert.strictEqual(jobs[0].title, 'Partner Manager - German Speaker');
  assert.strictEqual(jobs[0].location, 'UK');
  assert.strictEqual(jobs[0].salary_range, '108000 - 150000 GBP (yearly)');
  assert.ok(jobs[0].skills_required.includes('Senior'));
  assert.ok(jobs[0].source.includes('Jobicy') && jobs[0].link.startsWith('https://jobicy.com/jobs/'));
  assert.deepStrictEqual(await boards.fetchJobicyLive(null, koGet), { status: 503, jobs: [] });
});

test('EU Remote Jobs : flux réel sans entreprise, titre nu conservé, « Titre – Entreprise » découpé', async () => {
  const { jobs } = await boards.fetchEuRemoteJobsLive(null, okGet('euremotejobs.rss'));
  assert.strictEqual(jobs.length, 3);
  assertShape(jobs[0]);
  assert.strictEqual(jobs[0].title, 'Product Owner (Matchmaking)');
  assert.strictEqual(jobs[0].company, 'Entreprise non communiquée');
  assert.strictEqual(jobs[1].title, 'CPT-11642 Administrative & Student Accounts Virtual Assistant');
  assert.strictEqual(jobs[0].date_published, TODAY);
  const split = fixture('euremotejobs.rss').replace('Talent Acquisition Manager', 'Growth Marketer – Acme Remote');
  const { jobs: j2 } = await boards.fetchEuRemoteJobsLive(null, async () => ({ status: 200, data: split }));
  assert.strictEqual(j2[2].title, 'Growth Marketer');
  assert.strictEqual(j2[2].company, 'Acme Remote');
  assert.deepStrictEqual(await boards.fetchEuRemoteJobsLive(null, async () => ({ status: 'timeout', data: '' })), { status: 'timeout', jobs: [] });
});

test('WTTJ : cartes de la page fixture, liens absolus, id par hash, 48 h, jamais de paramètre', async () => {
  const urls = [];
  const get = async (url) => { urls.push(url); return { status: 200, data: fixture('wttj_teletravail.html') }; };
  const { status, jobs } = await boards.fetchWttjTeletravailLive('https://www.welcometothejungle.com/fr/pages/emploi-teletravail?page=2', get);
  assert.strictEqual(status, 200);
  assert.strictEqual(urls[0], 'https://www.welcometothejungle.com/fr/pages/emploi-teletravail');
  assert.strictEqual(jobs.length, 2); // « il y a 3 jours » écarté
  assertShape(jobs[0]);
  assert.strictEqual(jobs[0].title, 'Commercial F/H');
  assert.strictEqual(jobs[0].company, 'LOSTE');
  assert.strictEqual(jobs[0].location, "Villenave-d'Ornon");
  assert.strictEqual(jobs[0].salary_range, '35K à 42K €');
  assert.strictEqual(jobs[0].link, 'https://www.welcometothejungle.com/fr/companies/loste/jobs/commercial-f-h_villenave-d-ornon');
  assert.ok(/^WTTJ-\d+$/.test(jobs[0].id));
  assert.strictEqual(jobs[0].remote_basis, 'page « emploi télétravail » de Welcome to the Jungle (100 % télétravail)');
  assert.strictEqual(jobs[1].company, 'Youtrust');
  assert.strictEqual(jobs[1].date_published, 'il y a 1 heure');
  assert.deepStrictEqual(await boards.fetchWttjTeletravailLive(null, koGet), { status: 503, jobs: [] });
});

test('WTTJ : JSON-LD JobPosting prioritaire quand la page en sert', async () => {
  const ld = { '@type': 'ItemList', itemListElement: [{ item: { '@type': 'JobPosting', title: 'CRM Specialist', url: '/fr/companies/acme/jobs/crm', datePosted: TODAY, hiringOrganization: { name: 'Acme' }, jobLocation: { address: { addressLocality: 'Lyon' } }, employmentType: 'CDI' } }] };
  const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
  const { jobs } = await boards.fetchWttjTeletravailLive(null, async () => ({ status: 200, data: html }));
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].company, 'Acme');
  assert.strictEqual(jobs[0].location, 'Lyon');
  assert.strictEqual(jobs[0].link, 'https://www.welcometothejungle.com/fr/companies/acme/jobs/crm');
});

function linkedinSearchHtml(n) {
  return Array.from({ length: n }, (_, i) => {
    const sub = ['www', 'gr', 'fr', 'de'][i % 4];
    return `<div class="base-card"><a class="base-card__full-link" href="https://${sub}.linkedin.com/jobs/view/growth-${i}-40000000${String(i).padStart(2, '0')}?trk=x"></a>` +
      `<h3 class="base-search-card__title">Growth Marketing Specialist ${i}</h3><h4 class="base-search-card__subtitle"><a href="#">Company ${i}</a></h4>` +
      `<span class="job-search-card__location">Athens, Greece</span><time datetime="${TODAY}">1 hour ago</time></div>`;
  }).join('');
}

test('LinkedIn : description relue pour les liens inconnus seulement (tous sous-domaines), plafond 12, remote_basis posé', async () => {
  const careerDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'radar-li-'));
  const descCalls = [];
  const get = async (url) => {
    if (url.includes('/jobPosting/')) { descCalls.push(url); return { status: 200, data: '<div class="show-more-less-html__markup">This is a hybrid role with 3 days a week in our Athens office, applying to all candidates in Europe.</div>' }; }
    return { status: 200, data: linkedinSearchHtml(16) };
  };
  const known = new Set(['https://www.linkedin.com/jobs/view/growth-0-4000000000', 'https://gr.linkedin.com/jobs/view/growth-1-4000000001']);
  const { status, jobs } = await fetchLinkedInLive(['growth marketing specialist'], { careerDir, fetchUrl: get, jitterMs: 0, knownLinks: known });
  assert.strictEqual(status, 200);
  assert.strictEqual(jobs.length, 16);
  assert.strictEqual(descCalls.length, DESC_FETCH_CAP);
  assert.strictEqual(DESC_FETCH_CAP, 12);
  assert.ok(!descCalls.some(u => u.endsWith('/4000000000') || u.endsWith('/4000000001')), 'liens connus non relus');
  assert.ok(descCalls.some(u => u.endsWith('/4000000002')), 'www.linkedin.com relu');
  assert.ok(descCalls.some(u => u.endsWith('/4000000005')), 'gr.linkedin.com relu');
  assert.ok(jobs[2].description.includes('hybrid'));
  assert.ok(jobs[0].description.startsWith('Growth Marketing Specialist 0 at Company 0')); // connu : description synthétique
  assert.strictEqual(jobs[0].remote_basis, 'filtre « Remote » de LinkedIn (choix de l’annonceur, non vérifié)');
  assert.strictEqual(evaluateRemote(jobs[2]).pass, false);
  fs.rmSync(careerDir, { recursive: true, force: true });
});

test('Auditeur remote : nouveaux termes éliminatoires, sans faux positif sur « remote-first »', () => {
  const base = { title: 'Growth Marketer', location: 'Remote', company_hq: '', remote_declared: true, source: 'T' };
  for (const d of ['Expect 2 days a week from our office in Athens.', 'You will work twice a week on site.', 'Candidates must be willing to relocate to Berlin.', 'Based in our Paris hub.', 'Some in-office days each month.', 'three times a week in Madrid']) {
    assert.strictEqual(evaluateRemote({ ...base, description: d }).pass, false, d);
  }
  for (const d of ['Remote-first team, office optional. Must be located in the EU.', 'We have offices in Paris and Lisbon but the team is fully remote.', 'Office-first culture is not for us: 100 % remote.']) {
    const r = evaluateRemote({ ...base, description: d });
    assert.strictEqual(r.pass, true, `${d} → ${r.reason}`);
  }
  assert.ok(evaluateRemote({ ...base, remote_basis: 'filtre X', description: 'fully remote' }).reason.startsWith('filtre X —'));
});

test('request : URL invalide et serveur local injoignable résolvent sans lever', async () => {
  assert.deepStrictEqual(await request('pas une url'), { status: 'url invalide', data: '' });
  const r = await request('http://127.0.0.1:9/x', { method: 'POST', body: { a: 1 }, timeoutMs: 1500 });
  assert.ok(['erreur réseau', 'timeout'].includes(r.status), String(r.status));
});

test('RSS (Jobspresso, WeWorkRemotely) : pubDate RFC 2822 → date_published AAAA-MM-JJ', async () => {
  const { fetchWeWorkRemotelyLive } = require('./rss_fetchers');
  const rss = `<rss><channel><item><title>Acme: Growth Manager</title><link>https://wwr.test/1</link><pubDate>${new Date().toUTCString()}</pubDate><description>Short</description></item></channel></rss>`;
  const { jobs } = await fetchWeWorkRemotelyLive('https://wwr.test/feed', async () => ({ status: 200, data: rss }));
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].date_published, TODAY);
});

test('territoire : un remote réservé hors Europe est écarté, l\'Europe et le monde passent', () => {
  const base = { title: 'Growth Marketer', description: 'mid', remote_declared: true, source: 'Growth.Talent' };
  for (const location of ['Remote, AMER', 'Canada', 'New York, New York', 'San Francisco', 'Remote - US', 'India', 'Austin, TX', 'SF Office', 'Toronto, Canada', 'Remote APAC', 'São Paulo, Brazil']) {
    const r = evaluateRemote({ ...base, location });
    assert.strictEqual(r.pass, false, location);
    assert.ok(r.reason.startsWith('Zone hors Europe'), r.reason);
  }
  for (const location of ['London', 'Remote', 'Anywhere', 'Warsaw', 'EMEA', 'Paris - Full Remote', 'Remote (US or Europe)', 'Lisbon, Portugal', 'Remote - Worldwide', 'Berlin or New York', 'Télétravail, nous recrutons', '']) {
    assert.strictEqual(evaluateRemote({ ...base, location }).pass, true, location);
  }
  assert.strictEqual(evaluateRemote({ ...base, location: 'Remote', description: 'Candidates must be US-based.' }).pass, false);
  assert.strictEqual(evaluateRemote({ ...base, location: 'Remote', description: 'Our campus-based team, nous recrutons' }).pass, true);
});

test('séniorité : mots de niveau dans l\'intitulé seulement, années dans le texte ; lead et partner ne disqualifient plus (2026-11-14)', () => {
  const { evaluateSeniority } = require('../inspectors/seniority_calibrator');
  const tax = { target_experience: { disqualified_labels: ['senior', 'sr.', 'lead', 'partner', 'head of', '5+ years'] }, search_queries: [] };
  const ok = (title, description = '') => evaluateSeniority({ title, description, skills_required: '' }, tax).pass;
  assert.equal(ok('Sales Enablement Manager', 'Drive lead generation with our sales leaders; report to the Senior Director.'), true);
  assert.equal(ok('Product Marketing Lead'), true);
  assert.equal(ok('Partner Marketing Manager'), true);
  assert.equal(ok('Developer Marketer - Sales'), true);
  assert.equal(ok('Senior Product Marketing Manager'), false);
  assert.equal(ok('Sr. Growth Marketer'), false);
  assert.equal(ok('Head of Growth'), false);
  assert.equal(ok('Marketing Manager', 'You bring 5+ years of B2B experience.'), false);
});

test('remote : « Home based - EMEA » et « remote-first » comptent', () => {
  const { evaluateRemote } = require('../inspectors/remote_auditor');
  assert.equal(evaluateRemote({ title: 'Content Marketing Manager', location: 'Home based - EMEA', description: '' }).pass, true);
  assert.equal(evaluateRemote({ title: 'Growth Marketer', location: 'Lisbon', description: 'We are a fully distributed company.' }).pass, true);
  assert.equal(evaluateRemote({ title: 'Growth Marketer', location: 'Lisbon', description: '' }).pass, false);
});
