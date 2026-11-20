import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CompanyEntry, amountEur, freshness, learnDirections, normName, readHeadline, scoreCompany, validCompanyName } from './lib.ts';
import { EMPTY_HISTORY, FEEDS, bodaccSignals, lookupFrance, newsSignals, parseFeed, readSite, registrySignals, siteMatches, siteSignals, ycSignals } from './sources.ts';
import { type SignalsDoc, parseArgs, probe, runPass } from './signals-vm.ts';

const T = join(import.meta.dir, 'test');
const read = (n: string) => readFileSync(join(T, n), 'utf8');
const NOW = new Date('2026-11-14T02:00:00Z');
const fake = (await import('./test/fake-fetch.ts')).default;

describe('titres d’articles', () => {
  const cases: [string, string | null, string | null][] = [
    ['YC-backed Luminal raises $25M from Standard Capital to loosen Nvidia’s grip', 'levee', 'Luminal'],
    ['Paris-based Qonto raises €486M in Series D', 'levee', 'Qonto'],
    ['La startup lyonnaise Pennylane lève 40 millions d’euros pour accélérer', 'levee', 'Pennylane'],
    ['Swan, la fintech de l’embedded banking, lève 42 M€', 'levee', 'Swan'],
    ['Exclusive: PostHog raises $70M at a $1.4B valuation', 'levee', 'PostHog'],
    ['Alan appoints Jane Doe as Chief Marketing Officer', 'nouveau_dirigeant', 'Alan'],
    ['Jane Doe joins Swile as VP Marketing', 'nouveau_dirigeant', 'Swile'],
    ['Berlin-based Personio lays off 50 employees', 'licenciements', 'Personio'],
    ['Ynsect placée en redressement judiciaire', 'procedure', 'Ynsect'],
    ['Doctolib expands into Italy', 'expansion', 'Doctolib'],
    ['Spendesk rachète la startup Okay', 'rachat', 'Spendesk'],
    // Récaps et articles sans entreprise lisible : rien (contrôle contre les faux signaux).
    ['Les startups françaises ont levé 118 millions d’euros cette semaine', null, null],
    ['Deux anciens d’iBanFirst bouclent un tour de table pour leur assistant IA', null, null],
    ['Europe’s €7.5B female-founder rebound has a missing metric', null, null],
    ['Jensen Huang’s Nvidia exit shakes European tech', null, null],
    ['Why European tech and Asia will be ‘a lot closer’', null, null],
  ];
  for (const [title, type, company] of cases)
    test(title, () => {
      const h = readHeadline(title);
      expect(h?.type ?? null).toBe(type as never);
      expect(h?.company ?? null).toBe(company);
    });
  test('montants', () => {
    expect(amountEur('raises $25M')).toBe(23_000_000);
    expect(amountEur('lève 40 millions d’euros')).toBe(40_000_000);
    expect(amountEur('raises €1.2bn')).toBe(1_200_000_000);
    expect(amountEur('in 2026')).toBeUndefined();
  });
  test('noms', () => {
    expect(normName('Qonto SAS')).toBe('qonto');
    expect(normName('Doctolib GmbH')).toBe('doctolib');
    expect(normName('Équipe & Co Ltd.')).toBe('equipeandco');
    expect(validCompanyName('The')).toBe(false);
    expect(validCompanyName('Un nom beaucoup trop long pour une entreprise')).toBe(false);
    expect(validCompanyName('Mistral AI')).toBe(true);
  });
});

describe('flux', () => {
  test('RSS 2.0 et Atom', () => {
    const rss = parseFeed(read('maddyness.rss'));
    expect(rss.length).toBe(4);
    expect(rss[2]).toMatchObject({ title: 'La fintech Pennylane lève 40 millions d\'euros pour s\'attaquer à l\'Europe', date: '2026-11-12', categories: ['Fintech'] });
    const atom = parseFeed(read('producthunt.atom'));
    expect(atom[0]).toMatchObject({ title: 'Aven App Agent', link: 'https://www.producthunt.com/products/aven-app-agent', date: '2026-11-11' });
  });
  test('signaux d’un flux : pays lu dans le texte, récaps écartés, preuve gardée', () => {
    const feed = FEEDS.find((f) => f.id === 'techfundingnews')!;
    const r = newsSignals(feed, read('techfundingnews.rss'), NOW);
    expect(r.items).toBe(3);
    expect(r.signals.map((s) => [s.company, s.country])).toEqual([
      ['Luminal', 'US'],
      ['Lemon Analytics', 'DE'],
    ]);
    expect(r.signals[1]).toMatchObject({ type: 'levee', amount_eur: 12_000_000, url: 'https://techfundingnews.com/lemon-analytics-12m/' });
    expect(r.signals[1].evidence).toContain('Lemon Analytics raises €12M');
  });
  test('Maddyness : pays France par défaut', () => {
    const r = newsSignals(FEEDS[0], read('maddyness.rss'), NOW);
    expect(r.signals.map((s) => [s.type, s.company, s.country])).toEqual([
      ['levee', 'Pennylane', 'FR'],
      ['nouveau_dirigeant', 'Swile', 'FR'],
    ]);
  });
});

describe('YC', () => {
  test('Europe, active, récente, qui recrute', () => {
    const r = ycSignals(read('yc.json'), NOW);
    expect(r.read).toBe(3);
    // CircuitHub (lancée en 2011) et Acme (États-Unis) écartées.
    expect(r.signals.map((s) => s.company)).toEqual(['Lemon Analytics']);
    expect(r.sites[normName('Lemon Analytics')]).toBe('https://lemonanalytics.io');
  });
  test('JSON illisible : rien', () => expect(ycSignals('<html>', NOW).signals).toEqual([]));
});

describe('registre du radar', () => {
  const companies = (total: number) => ({ companies: { 'ashby:acme': { name: 'Acme', kind: 'full', total, careers: 'https://jobs.ashbyhq.com/acme' } } });
  const jobs = (titles: string[]) => ({ companies: { 'ashby:acme': { jobs: titles.map((t, i) => ({ title: t, link: `https://jobs.ashbyhq.com/acme/${i}` })) } } });
  test('premier relevé : aucun signal ; ensuite poste de responsable, premier poste marketing, vague', () => {
    const d0 = new Date('2026-10-01T00:00:00Z');
    const a = registrySignals(companies(10), jobs(['Product Designer']), EMPTY_HISTORY, d0);
    expect(a.signals).toEqual([]);
    const d1 = new Date('2026-10-20T00:00:00Z');
    const b = registrySignals(companies(20), jobs(['Product Designer', 'Head of Marketing', 'Growth Marketer', 'Content Lead', 'SEO Specialist']), a.history, d1);
    const types = b.signals.map((s) => s.type).sort();
    expect(types).toEqual(['premier_marketing', 'recrute_leader', 'vague_recrutement', 'vague_recrutement']);
    expect(b.signals.find((s) => s.type === 'recrute_leader')!.evidence).toContain('Head of Marketing');
  });
  test('moins de 7 jours de suivi : pas de « nouveau poste »', () => {
    const d0 = new Date('2026-10-01T00:00:00Z');
    const a = registrySignals(companies(10), jobs(['Designer']), EMPTY_HISTORY, d0);
    const b = registrySignals(companies(10), jobs(['Designer', 'Head of Growth']), a.history, new Date('2026-10-03T00:00:00Z'));
    expect(b.signals).toEqual([]);
  });
});

describe('sites', () => {
  test('outils, langues, blog ; le premier relevé ne donne rien', () => {
    const v1 = readSite('https://lemonanalytics.io', read('site-lemon-v1.html'), new Date('2026-11-01'));
    const v2 = readSite('https://lemonanalytics.io', read('site-lemon-v2.html'), NOW);
    expect(v1.tools).toEqual(['Google Tag Manager']);
    expect(v2.tools).toEqual(['HubSpot', 'Google Tag Manager']);
    expect(v2.languages).toEqual(['en', 'fr']);
    expect(siteSignals('Lemon Analytics', null, v1, NOW)).toEqual([]);
    expect(siteSignals('Lemon Analytics', v1, v2, NOW).map((s) => s.type)).toEqual(['stack', 'nouvelle_langue', 'blog']);
  });
  test('une page vide la fois d’avant ne fait pas croire à cinq outils', () => {
    const empty = readSite('https://x.io', '<html></html>', new Date('2026-11-01'));
    const full = readSite('https://x.io', '<script src="//js.hs-scripts.com/1.js"></script><script src="https://cdn.segment.com/a.js"></script>', NOW);
    expect(siteSignals('X', empty, full, NOW)).toEqual([]);
  });
  test('domaine deviné gardé seulement si la page porte le nom', () => {
    expect(siteMatches('Lemon Analytics', read('site-lemon-v1.html'))).toBe(true);
    expect(siteMatches('Acme', read('site-lemon-v1.html'))).toBe(false);
  });
});

describe('registres', () => {
  test('France : nom exact seulement (PENNYLANE CONSEIL écarté)', async () => {
    const r = await lookupFrance('Pennylane', fake);
    expect(r.facts).toMatchObject({ siren: '880000001', naf: '58.29C', effectif: '250-499', ville: 'PARIS' });
    expect((await lookupFrance('Inconnue', fake)).facts).toBeNull();
  });
  test('BODACC : augmentation de capital retenue, dépôt des comptes ignoré', async () => {
    const r = await bodaccSignals('880000001', 'Pennylane', fake, NOW);
    expect(r.signals.map((s) => [s.type, s.date])).toEqual([['capital', '2026-10-02']]);
    expect((await bodaccSignals('12', 'X', fake, NOW)).signals).toEqual([]);
  });
});

describe('score et directions', () => {
  const entry = (over: Partial<CompanyEntry>): CompanyEntry => ({ name: 'X', norm: 'x', country: '', remote_key: '', remote_kind: '', careers: '', facts: {}, signals: [], score: 0, why: [], ...over });
  const sig = (type: 'levee' | 'licenciements', date: string) => ({ id: `${type}${date}`, type, company: 'X', date, source: 's', url: 'https://x', evidence: 'e', found_at: '' });
  test('fraîcheur : demi-vie 45 jours, rien après 180', () => {
    expect(freshness('2026-11-14', NOW)).toBeCloseTo(1, 1);
    expect(freshness('2026-09-30', NOW)).toBeCloseTo(0.5, 1);
    expect(freshness('2026-01-01', NOW)).toBe(0);
  });
  test('Europe seulement, Royaume-Uni pénalisé, 100 % remote favorisé, licenciements négatifs', () => {
    const base = scoreCompany(entry({ signals: [sig('levee', '2026-11-13')] }), NOW).score;
    expect(scoreCompany(entry({ country: 'US', signals: [sig('levee', '2026-11-13')] }), NOW).score).toBe(0);
    expect(scoreCompany(entry({ country: 'GB', signals: [sig('levee', '2026-11-13')] }), NOW).score).toBeLessThan(base);
    expect(scoreCompany(entry({ remote_kind: 'full', signals: [sig('levee', '2026-11-13')] }), NOW).score).toBeGreaterThan(base);
    expect(scoreCompany(entry({ signals: [sig('levee', '2026-11-13'), sig('licenciements', '2026-11-12')] }), NOW).score).toBeLessThan(0.1);
  });
  test('cinq articles sur la même levée ne valent pas cinq levées', () => {
    const one = scoreCompany(entry({ signals: [sig('levee', '2026-11-13')] }), NOW).score;
    const five = scoreCompany(entry({ signals: ['10', '11', '12', '13', '09'].map((d) => sig('levee', `2026-11-${d}`)) }), NOW).score;
    expect(five).toBeLessThan(one * 1.6);
  });
  test('directions : les levées en fintech marchent, les rachats non', () => {
    const cs: CompanyEntry[] = [];
    const v: Record<string, 'bon' | 'non'> = {};
    for (let i = 0; i < 4; i++) {
      cs.push(entry({ norm: `f${i}`, facts: { sectors: ['Fintech'] }, signals: [sig('levee', '2026-11-10')] }));
      v[`f${i}`] = 'bon';
    }
    for (let i = 0; i < 4; i++) {
      cs.push(entry({ norm: `r${i}`, facts: { sectors: ['Santé'] }, signals: [{ ...sig('levee', '2026-11-10'), type: 'rachat' as never }] }));
      v[`r${i}`] = 'non';
    }
    const d = learnDirections(cs, v, NOW.toISOString());
    expect(d.bySector.Fintech).toBeGreaterThan(1);
    expect(d.bySector['Santé']).toBeLessThan(1);
    expect(d.byType.rachat).toBeLessThan(1);
    expect(d.lines.join(' ')).toContain('Secteur Fintech : 4 bonnes pistes sur 4');
  });
});

describe('passage complet (faux réseau)', () => {
  test('deux passages : signaux, registres, puis changement de site', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'signaux-'));
    const career = join(dir, 'career');
    mkdirSync(career);
    writeFileSync(join(career, 'remote_companies.json'), JSON.stringify({ companies: { 'lever:pennylane': { name: 'Pennylane', kind: 'full', total: 30, careers: 'https://jobs.lever.co/pennylane' } } }));
    writeFileSync(join(career, 'signals_feedback.json'), JSON.stringify({ verdicts: { luminal: 'non' } }));
    const o = parseArgs(['--career', career, '--fetch-module', join(T, 'fake-fetch.ts')], { HOME: dir });
    process.env.SIGNALS_SITE_VERSION = '1';
    const r1 = await runPass(o, () => new Date('2026-11-14T02:00:00Z'));
    expect(r1.failed.map((f) => f.source)).toContain('Sifted');
    const d1 = JSON.parse(readFileSync(join(career, 'company_signals.json'), 'utf8')) as SignalsDoc;
    const p = d1.companies.pennylane;
    expect(p.remote_kind).toBe('full');
    expect(p.facts.siren).toBe('880000001');
    expect(p.signals.map((s) => s.type).sort()).toEqual(['capital', 'levee']);
    expect(d1.companies.luminal.score).toBe(0);
    expect(d1.companies.lemonanalytics.facts.website).toBe('https://lemonanalytics.io');
    // Huit jours plus tard : le site a changé (HubSpot, français, blog).
    process.env.SIGNALS_SITE_VERSION = '2';
    const r2 = await runPass(o, () => new Date('2026-11-22T02:00:00Z'));
    const d2 = JSON.parse(readFileSync(join(career, 'company_signals.json'), 'utf8')) as SignalsDoc;
    expect(d2.companies.lemonanalytics.signals.map((s) => s.type).sort()).toEqual(['accelerateur', 'blog', 'levee', 'nouvelle_langue', 'stack']);
    expect(r2.new_signals).toBe(3);
    // Les articles relus ne créent pas de doublon.
    expect(d2.companies.pennylane.signals.length).toBe(2);
    delete process.env.SIGNALS_SITE_VERSION;
  });
  test('--probe : une ligne par source, rien d’écrit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'signaux-'));
    const lines = await probe(parseArgs(['--career', dir, '--probe', '--fetch-module', join(T, 'fake-fetch.ts')], { HOME: dir }), NOW);
    expect(lines.some((l) => l.startsWith('OK') && l.includes('Maddyness') && l.includes('Pennylane'))).toBe(true);
    expect(lines.some((l) => l.startsWith('ÉCHEC') && l.includes('Sifted'))).toBe(true);
    expect(lines.some((l) => l.includes('Companies House') && l.includes('pas de clé'))).toBe(true);
  });
});

describe('cockpit : onglet Signaux', async () => {
  const { queueProspect, setVerdict, signalsView } = await import('./cockpit-signals.ts');
  test('vue, avis, file À prospecter ; noms refusés', () => {
    const career = mkdtempSync(join(tmpdir(), 'signaux-cockpit-'));
    writeFileSync(join(career, 'company_signals.json'), JSON.stringify({ _meta: { at: '2026-11-14T02:00:00Z', rule: 'r', directions: { lines: [] }, sources: { yc: { ok: 1, fail: 0, last_status: 200, last_at: '', last_signals: 1 } } }, companies: { qonto: { name: 'Qonto', score: 2, why: ['Levée'], facts: {}, signals: [{ type: 'levee', date: '2026-11-13', url: 'https://x/a', amount_eur: 12e6, evidence: 'Qonto raises' }, { type: 'levee', date: '2026-11-13', url: 'javascript:alert(1)' }] }, 'Bad Key': { name: 'x' } } }));
    const v = signalsView(career);
    expect(v.companies.map((c) => c.norm)).toEqual(['qonto']);
    expect(v.companies[0].signals).toHaveLength(1); // un lien non http(s) n'est pas montré
    expect(v.companies[0].signals[0]).toMatchObject({ label: 'Levée de fonds', amount: '12 M€' });
    expect(setVerdict(career, 'qonto', 'bon').ok).toBe(true);
    expect(signalsView(career).companies[0].verdict).toBe('bon');
    expect(setVerdict(career, '../x', 'bon').ok).toBe(false);
    expect(queueProspect(career, 'qonto').ok).toBe(true);
    expect(JSON.parse(readFileSync(join(career, 'a_prospecter', 'qonto.json'), 'utf8')).signaux[0].lien).toBe('https://x/a');
    expect(signalsView(career).companies[0].prospect).toBe(true);
    expect(setVerdict(career, 'qonto', null).ok).toBe(true);
    expect(signalsView(career).companies[0].verdict).toBeNull();
    expect(queueProspect(career, 'absente').ok).toBe(false);
  });
});
