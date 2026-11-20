import { describe, expect, test } from 'bun:test';
import type { PendingJob } from './career.ts';
import { type RadarJob, appendNew, boardKeys, buildReport, offerAgeMaxDays, parseSourceNames, screenJobs, selectSources, slugOf, sourceCounts, toPendingJob, withIsoDate } from './radar.ts';

/** Aujourd'hui (UTC) : le crible écarte une offre de plus de 7 jours par défaut, quel que soit le jour du test. */
const TODAY = new Date().toISOString().slice(0, 10);

const taxonomy = { search_queries: ['growth marketing specialist', 'crm specialist'], startup_scaleup_signals: ['saas'], target_experience: { disqualified_labels: ['senior', 'head of', '5+ years'] } };
const job = (over: Partial<RadarJob>): RadarJob => ({
  id: 'X-1',
  company: 'Acme SAS',
  title: 'Growth Marketing Specialist',
  location: 'Remote - Europe',
  remote_declared: true,
  company_hq: '',
  skills_required: 'HubSpot',
  description: 'Fully remote role for the European team, 1-3 years of experience with the tools we use.',
  salary_range: null,
  link: 'https://jobs.example/1',
  date_published: TODAY,
  source: 'Himalayas',
  ...over,
});

describe('selectSources : l’entrée `sources`', () => {
  const config = { version: '2.1.0', sources: [{ name: 'Adzuna', enabled: true }, { name: 'Jobicy', enabled: true }, { name: 'JSearch (OpenWeb Ninja)', enabled: false }] };
  test('vide : la configuration telle quelle', () => {
    const r = selectSources(config, '');
    expect(r.selected).toEqual(['Adzuna', 'Jobicy']);
    expect(r.unknown).toEqual([]);
    expect(r.config.sources).toEqual(config.sources);
  });
  test('des noms : les autres passent enabled: false (jamais retirées : une source absente compterait pour active)', () => {
    const r = selectSources(config, ' adzuna, jsearch ');
    expect(r.config.sources.map((s) => [s.name, s.enabled])).toEqual([['Adzuna', true], ['Jobicy', false], ['JSearch (OpenWeb Ninja)', false]]);
    expect(r.selected).toEqual(['Adzuna']);
    expect(parseSourceNames('a,, b ,')).toEqual(['a', 'b']);
  });
  test('un nom inconnu est signalé', () => {
    expect(selectSources(config, 'monster').unknown).toEqual(['monster']);
    expect(selectSources({ sources: [] } as never, 'x').config.sources).toEqual([]);
  });
});

describe('sourceCounts : OK, échec, attente de cadence', () => {
  test('200, « OK · … », « run lancé » comptent OK ; « attente » à part ; le reste en échec', () => {
    expect(sourceCounts([
      { name: 'a', status: 200, count: 1, duration_ms: 1 },
      { name: 'b', status: 'OK · run terminé (2 offres)', count: 2, duration_ms: 1 },
      { name: 'c', status: 'run lancé (3 entreprises, bloc 1/1)', count: 0, duration_ms: 1 },
      { name: 'd', status: 'attente (prochain appel dans 40 min)', count: 0, duration_ms: 0 },
      { name: 'e', status: 'clé absente (APIFY_TOKEN)', count: 0, duration_ms: 0 },
      { name: 'f', status: 503, count: 0, duration_ms: 9 },
      { name: 'g', status: 'erreur : boom', count: 0, duration_ms: 9 },
    ])).toEqual({ ok: 3, waiting: 1, failed: 3 });
  });
});

describe('screenJobs : doublons, tableau, jury, seuil', () => {
  test('slug comme la VM : minuscules, [^a-z0-9] → _, 20 caractères', () => {
    expect(slugOf('Acme SAS')).toBe('acme_sas');
    expect(slugOf('Welcome to the Jungle Paris')).toBe('welcome_to_the_jungl');
  });
  test('une bonne offre passe, avec la forme du tableau de la VM', () => {
    const { qualified, rejected } = screenJobs([job({})], taxonomy, []);
    expect(rejected).toEqual([]);
    expect(qualified[0]).toMatchObject({ slug: 'acme_sas', status: 'PENDING_VALIDATION', tier: 'Silver', is_startup: false, link: 'https://jobs.example/1' });
    expect(Number(qualified[0]!.match_score)).toBeGreaterThanOrEqual(75);
    expect(String(qualified[0]!.jury_verdict)).toContain('Jury unanime');
    expect(qualified[0]!.index).toBeUndefined();
  });
  test('la description complète et la page de l’annonce vont au tableau (career-triage les lit) ; le jury ne lit que le résumé', () => {
    const full = `${'Hybrid role in Berlin. '.repeat(30)}`;
    const { qualified } = screenJobs([job({ description_full: full, posting_url: 'https://jobs.example/1/page' })], taxonomy, []);
    expect(qualified).toHaveLength(1); // « hybrid » de la description complète ne fait pas tomber le jury (parité VM)
    expect(qualified[0]!.description_full).toBe(full);
    expect(qualified[0]!.posting_url).toBe('https://jobs.example/1/page');
    const { added } = appendNew([], qualified, 'R1', new Date('2026-10-23T20:00:00Z'));
    expect(added[0]!.description_full).toBe(full);
  });
  test('doublon par lien (casse ignorée), puis par entreprise|titre ; déjà au tableau par lien ou id', () => {
    const board = [{ slug: 'old', company: 'Old', title: 't', link: 'https://jobs.example/OLD', status: 'PENDING_VALIDATION', id: 'OLD-1' }];
    const { qualified, rejected } = screenJobs([
      job({ id: 'A' }),
      job({ id: 'B', link: 'HTTPS://jobs.example/1', company: 'Other' }),
      job({ id: 'C', link: 'https://jobs.example/3' }),
      job({ id: 'D', link: 'https://jobs.example/old', title: 'CRM Specialist' }),
      job({ id: 'OLD-1', link: 'https://jobs.example/5', company: 'Fifth', title: 'CRM Specialist' }),
    ], taxonomy, board);
    expect(qualified.map((q) => q.id)).toEqual(['A']);
    expect(rejected.map((r) => [r.id, r.reason])).toEqual([
      ['B', 'doublon (même lien)'],
      ['C', 'doublon (même entreprise et même titre)'],
      ['D', 'déjà au tableau'],
      ['OLD-1', 'déjà au tableau'],
    ]);
  });
  test('le jury refuse : hybride, séniorité, langue, hors domaine ; la raison est gardée', () => {
    const { qualified, rejected } = screenJobs([
      job({ id: 'H', link: 'https://x/h', company: 'H Co', description: 'Hybrid role, 3 days a week in our Paris office.' }),
      job({ id: 'S', link: 'https://x/s', company: 'S Co', title: 'Senior Growth Marketing Manager' }),
      job({ id: 'L', link: 'https://x/l', company: 'L GmbH', title: 'Growth Marketing Specialist (m/w/d)' }),
      job({ id: 'O', link: 'https://x/o', company: 'O Co', title: 'Accountant' }),
      job({ id: 'N', link: 'https://x/n', company: 'N Co', remote_declared: false, location: 'Paris', description: 'Office in Paris, 1-3 years.' }),
    ], taxonomy, []);
    expect(qualified).toEqual([]);
    expect(rejected.map((r) => r.id)).toEqual(['H', 'S', 'L', 'O', 'N']);
    expect(rejected[0]!.reason).toContain('Remote non établi');
    expect(rejected[1]!.reason).toContain('Séniorité');
    expect(rejected[2]!.reason).toContain('Langue');
    expect(rejected[3]!.reason).toContain('hors domaine');
    expect(rejected[4]!.reason).toContain('sans mention Remote');
  });
  test('un autre candidat : ses mots de domaine et le présentiel accepté (remote_policy indifferent) ; Antoine inchangé', () => {
    const events = { search_queries: ['coordinateur bénévoles', 'événementiel sportif'], core_domains: ['bénévole', 'événementiel', 'evenementiel', 'sport'], remote_policy: 'indifferent' as const, target_experience: { disqualified_labels: ['directeur', 'directrice'] } };
    const onsite = job({ id: 'J', link: 'https://x/j', company: 'Marathon de Lyon', title: 'Coordinateur des bénévoles H/F', remote_declared: false, location: 'Lyon', description: 'Poste sur site à Lyon, présentiel, pour coordonner les bénévoles de la course et les équipes de terrain.' });
    const growth = job({ id: 'G', link: 'https://x/g', company: 'G Co', title: 'Growth Marketing Specialist' });
    const camille = screenJobs([onsite, growth], events, []);
    expect(camille.qualified.map((q) => q.id)).toEqual(['J']);
    expect(String(camille.qualified[0]!.jury_verdict)).toContain('mode de travail indifférent');
    expect(camille.rejected[0]!.reason).toContain('hors domaine du candidat');
    const antoine = screenJobs([onsite], taxonomy, []);
    expect(antoine.qualified).toEqual([]);
    expect(antoine.rejected[0]!.reason).toContain('Remote non établi');
  });
  test('le seuil 75 s’applique à un jury injecté ; tri par score décroissant ; offre sans lien écartée', () => {
    const scores: Record<string, number> = { A: 80, B: 70, C: 95 };
    const evaluate = (j: RadarJob) => ({ pass: true, failed_inspector: null, verdict_summary: 'ok', final_score: scores[j.id]!, tier: 'Gold', is_startup: true });
    const { qualified, rejected } = screenJobs([job({ id: 'A', link: 'https://x/a', company: 'A' }), job({ id: 'B', link: 'https://x/b', company: 'B' }), job({ id: 'C', link: 'https://x/c', company: 'C' }), job({ id: 'Z', link: '', company: 'Z' })], taxonomy, [], evaluate);
    expect(qualified.map((q) => q.id)).toEqual(['C', 'A']);
    expect(rejected.map((r) => [r.id, r.reason])).toEqual([['B', 'score 70 < 75'], ['Z', 'offre sans lien ou sans titre']]);
    expect(toPendingJob(job({}), { pass: true, failed_inspector: null, verdict_summary: 'v' })).toMatchObject({ match_score: 0, tier: '', is_startup: false });
  });
});

describe('screenJobs : l’entreprise contre le lien (company-link.ts)', () => {
  const evaluate = () => ({ pass: true, failed_inspector: null, verdict_summary: 'ok', final_score: 90 });
  const li = (slug: string, id: string) => `https://es.linkedin.com/jobs/view/growth-marketing-specialist-at-${slug}-${id}`;
  test('lien LinkedIn d’un autre employeur : refusée avant les doublons, la vraie ligne (même lien) passe', () => {
    const wrong = job({ id: 'LI-1', company: 'Bizneo HR', link: li('everai', '4300000002'), source: 'LinkedIn (Live 24h)' });
    const right = job({ id: 'LI-2', company: 'EverAI', link: li('everai', '4300000002'), source: 'LinkedIn (Live 24h)' });
    const { qualified, rejected } = screenJobs([wrong, right], taxonomy, [], evaluate);
    expect(qualified.map((q) => [q.company, q.slug])).toEqual([['EverAI', 'everai']]);
    expect(qualified[0]!.company_link_check).toBeUndefined();
    expect(rejected.map((r) => [r.id, r.reason])).toEqual([['LI-1', "entreprise incohérente avec le lien : « Bizneo HR » ne correspond pas à l'employeur « everai » du lien (LinkedIn link)"]]);
  });
  test('identifiant d’ATS qui ne se concilie pas : gardée, signalée dans company_link_check', () => {
    const { qualified, rejected } = screenJobs([job({ company: 'Blueprint Technologies', link: 'https://job-boards.greenhouse.io/bpcs/jobs/7477705' })], taxonomy, [], evaluate);
    expect(rejected).toEqual([]);
    expect(qualified[0]!.company_link_check).toBe("« Blueprint Technologies » ne correspond pas à l'employeur « bpcs » du lien (ATS board job-boards.greenhouse.io)");
  });
});

describe('screenJobs : l’âge de l’offre (offre_age_max_jours, 7 jours par défaut)', () => {
  const now = new Date('2026-10-23T20:00:00Z');
  const at = (id: string, date: unknown): RadarJob => job({ id, link: `https://x/${id}`, company: `${id} Co`, date_published: date as string });
  test('plus de 7 jours : écartée avec la date et N, avant le jury ; 7 jours pile, date illisible ou absente : gardée', () => {
    const evaluated: string[] = [];
    const evaluate = (j: RadarJob) => {
      evaluated.push(j.id);
      return { pass: true, failed_inspector: null, verdict_summary: 'ok', final_score: 90, tier: 'Gold', is_startup: false };
    };
    const { qualified, rejected } = screenJobs([at('OLD', '2026-10-15'), at('EDGE', '2026-10-16'), at('WTTJ', 'il y a 9 jours'), at('RSS', 'Wed, 14 Oct 2026'), at('EPOCH', Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000)), at('NONE', ''), at('LI', '< 24h (filtre LinkedIn)')], taxonomy, [], evaluate, { now });
    expect(rejected.map((r) => [r.id, r.reason])).toEqual([
      ['OLD', 'offre trop ancienne (publiée le 2026-10-15, > 7 jours)'],
      ['WTTJ', 'offre trop ancienne (publiée le 2026-10-14, > 7 jours)'],
      ['RSS', 'offre trop ancienne (publiée le 2026-10-14, > 7 jours)'],
      ['EPOCH', 'offre trop ancienne (publiée le 2026-10-01, > 7 jours)'],
    ]);
    expect(evaluated).toEqual(['EDGE', 'NONE', 'LI']); // le jury ne voit pas les offres trop anciennes
    expect(qualified.map((q) => q.id).sort()).toEqual(['EDGE', 'LI', 'NONE']);
  });
  test('N vient des options ; 0 coupe la règle ; défaut 7', () => {
    const evaluate = () => ({ pass: true, failed_inspector: null, verdict_summary: 'ok', final_score: 90 });
    expect(screenJobs([at('A', '2026-10-20')], taxonomy, [], evaluate, { now, maxAgeDays: 2 }).rejected[0]!.reason).toBe('offre trop ancienne (publiée le 2026-10-20, > 2 jours)');
    expect(screenJobs([at('A', '2020-01-01')], taxonomy, [], evaluate, { now, maxAgeDays: 0 }).qualified).toHaveLength(1);
    expect(screenJobs([at('A', '2026-10-15')], taxonomy, [], evaluate, { now }).rejected).toHaveLength(1);
  });
  test('une offre qualifiée part au tableau avec date_published en AAAA-MM-JJ, la forme de la source à côté', () => {
    const evaluate = () => ({ pass: true, failed_inspector: null, verdict_summary: 'ok', final_score: 90 });
    const { qualified } = screenJobs([at('W', 'il y a 3 jours'), at('I', '2026-10-22'), at('N', 'récent')], taxonomy, [], evaluate, { now });
    const byId = Object.fromEntries(qualified.map((q) => [q.id, q]));
    expect(byId.W).toMatchObject({ date_published: '2026-10-20', date_published_raw: 'il y a 3 jours' });
    expect(byId.I!.date_published).toBe('2026-10-22');
    expect(byId.I!.date_published_raw).toBeUndefined();
    expect(byId.N).toMatchObject({ date_published: 'récent' });
    expect(byId.N!.date_published_raw).toBeUndefined();
    expect(withIsoDate(at('R', 'Fri, 23 Oct 2026 10:00:00 +0000'), now)).toMatchObject({ date_published: '2026-10-23', date_published_raw: 'Fri, 23 Oct 2026 10:00:00 +0000' });
  });
  test('offerAgeMaxDays : criteres.json absent, illisible, sans la clé, avec, invalide, 0', () => {
    expect(offerAgeMaxDays(null).days).toBe(7);
    expect(offerAgeMaxDays('{oops').days).toBe(7);
    expect(offerAgeMaxDays('{oops').note).toContain('unreadable');
    expect(offerAgeMaxDays('{"langues":["fr"]}')).toEqual({ days: 7, note: 'offers older than 7 days rejected (offre_age_max_jours absent, default)' });
    expect(offerAgeMaxDays('\uFEFF{"offre_age_max_jours":14}')).toEqual({ days: 14, note: 'offers older than 14 days rejected (offre_age_max_jours)' });
    expect(offerAgeMaxDays('{"offre_age_max_jours":"7"}').note).toContain('must be an integer');
    expect(offerAgeMaxDays('{"offre_age_max_jours":0}')).toEqual({ days: 0, note: 'offer age rule off (offre_age_max_jours: 0)' });
  });
});

describe('appendNew : le tableau n’est jamais réécrit, seulement complété', () => {
  const now = new Date('2026-10-23T20:00:00Z');
  const existing: PendingJob[] = [
    { slug: 'old', company: 'Old', title: 't', link: 'https://jobs.example/OLD', status: 'VALIDATED', id: 'OLD-1', index: 3, validated_at: 'v' },
    { slug: 'two', company: 'Two', title: 't', link: 'https://jobs.example/2', status: 'APPLYING', index: 1 },
  ];
  const q = (id: string, link: string, score: number): PendingJob => ({ id, slug: id.toLowerCase(), company: id, title: 't', link, status: 'PENDING_VALIDATION', match_score: score });
  test('ajoute ce qui manque (lien ou id), index après le plus grand, par score ; les lignes existantes sont identiques', () => {
    const before = JSON.stringify(existing);
    const r = appendNew(existing, [q('A', 'https://jobs.example/a', 80), q('B', 'https://jobs.example/old', 90), q('C', 'https://jobs.example/c', 95), q('OLD-1', 'https://jobs.example/d', 99)], 'run-7', now);
    expect(r.added.map((j) => [j.id, j.index])).toEqual([['C', 4], ['A', 5]]);
    expect(r.skipped).toEqual([{ slug: 'old-1', id: 'OLD-1', reason: 'already on the board (id)' }, { slug: 'b', id: 'B', reason: 'already on the board (link)' }]);
    expect(r.jobs!.slice(0, 2)).toEqual(existing);
    expect(JSON.stringify(existing)).toBe(before);
    expect(r.jobs![2]).toMatchObject({ id: 'C', status: 'PENDING_VALIDATION', radar: { run: 'run-7', at: '2026-10-23T20:00:00.000Z' } });
  });
  test('rien à ajouter : jobs null (rien n’est écrit)', () => {
    const r = appendNew(existing, [q('B', 'https://jobs.example/old', 90)], 'run-7', now);
    expect(r.jobs).toBeNull();
    expect(r.added).toEqual([]);
    expect(r.skipped).toHaveLength(1);
  });
  test('tableau vide : index 1..n ; deux qualifiées de même lien : une seule entre', () => {
    const r = appendNew([], [q('A', 'https://x/a', 80), q('B', 'https://x/A', 85)], 'r', now);
    expect(r.added.map((j) => [j.id, j.index])).toEqual([['B', 1]]);
    expect(boardKeys(r.jobs).links.has('https://x/a')).toBe(true);
    expect(boardKeys('nope').ids.size).toBe(0);
  });
});

describe('buildReport : ce que lit le cockpit', () => {
  test('compte les sources, nomme les slugs ajoutés, ne porte que les quatre champs d’une source', () => {
    const r = buildReport({
      run: 'run-1', now: new Date('2026-10-23T20:00:00Z'), ok: true,
      sources: [{ name: 'Jobicy', status: 200, count: 4, duration_ms: 120, extra: 'x' } as never, { name: 'Adzuna', status: 'clé absente (ADZUNA_APP_ID)', count: 0, duration_ms: 0 }],
      raw_count: 4, qualified_count: 2, rejected_count: 2, added: [{ slug: 'acme', company: 'A', title: 't', link: 'l', status: 'PENDING_VALIDATION' }], skipped: 1, summary: 's',
    });
    expect(r).toEqual({
      at: '2026-10-23T20:00:00.000Z', run_id: 'run-1', ok: true,
      sources: [{ name: 'Jobicy', status: 200, count: 4, duration_ms: 120 }, { name: 'Adzuna', status: 'clé absente (ADZUNA_APP_ID)', count: 0, duration_ms: 0 }],
      sources_ok: 1, sources_failed: 1, sources_waiting: 0, raw_count: 4, qualified_count: 2, added: 1, added_slugs: ['acme'], skipped: 1, rejected_count: 2, summary: 's',
    });
  });
});
