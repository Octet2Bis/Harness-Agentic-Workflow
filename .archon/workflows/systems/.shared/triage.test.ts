import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PendingJob } from './career.ts';
import {
  MAX_TRIAGE_ATTEMPTS,
  MIN_READABLE_CHARS,
  type TriageRecord,
  choosePosting,
  classify,
  criteriaHash,
  isEstimatedSalary,
  needsTriage,
  pickUntriaged,
  postingIsFull,
  postingReadable,
  postingText,
  preScreen,
  REMOTE_NOT_STATED_REASON,
  scopeOverride,
  titleOutOfScope,
  profilePathIn,
  readTriageRecords,
  triageKey,
  triageRunArgs,
  unreadableReason,
} from './triage.ts';

const job = (over: Partial<PendingJob> = {}): PendingJob => ({
  id: 'LI-1642423340',
  slug: 'smartness',
  company: 'Smartness',
  title: 'Sales Operations &amp; Enablement Specialist',
  link: 'https://pt.linkedin.com/jobs/view/x-4475957729',
  description: 'About The Company At Smartness , we are building the future of hospitality tech. Our SaaS helps lodging providers boost revenues.',
  status: 'PENDING_VALIDATION',
  date_published: '2026-10-22',
  salary_range: '38k€ - 50k€ (1-3 ans)',
  ...over,
});

const record = (over: Partial<TriageRecord> = {}): TriageRecord => ({
  key: 'LI-1642423340', id: 'LI-1642423340', slug: 'smartness', company: 'Smartness', title: 't', link: 'l',
  decision: 'ecartee', reasons: [], notes: [], salary_annual_eur: null, languages_required: [], posting_full: true,
  block_status: 'verified', attempts: 1, run_id: 'r', at: '2026-10-22T00:00:00Z', criteria_hash: 'h1', ...over,
});

describe('clé et critères', () => {
  test('la clé est l’id, sinon le slug, sûre comme nom de fichier', () => {
    expect(triageKey(job())).toBe('LI-1642423340');
    expect(triageKey(job({ id: undefined, slug: '1840 / company' }))).toBe('1840___company');
  });
  test('l’empreinte ne dépend pas de l’ordre des clés ni des espaces', () => {
    expect(criteriaHash('{"langues":["fr","en"],"salaire_min_annuel":35000}')).toBe(criteriaHash('{ "salaire_min_annuel": 35000, "langues": ["fr","en"] }'));
    expect(criteriaHash('{"salaire_min_annuel":35000}')).not.toBe(criteriaHash('{"salaire_min_annuel":40000}'));
  });
});

describe('quelles offres trier', () => {
  test('à traiter et sans tri, ou trié avec d’autres critères', () => {
    expect(needsTriage(job(), null, 'h1')).toBe(true);
    expect(needsTriage(job(), record(), 'h1')).toBe(false);
    expect(needsTriage(job(), record(), 'h2')).toBe(true);
    expect(needsTriage(job({ status: 'APPLIED' }), null, 'h1')).toBe(false);
  });
  test('un tri non vérifié est retenté, une fois (moteur llm ; les règles ne refont pas un tri du modèle)', () => {
    expect(needsTriage(job(), record({ block_status: 'rejected', attempts: 1 }), 'h1', 'llm')).toBe(true);
    expect(needsTriage(job(), record({ block_status: 'rejected', attempts: MAX_TRIAGE_ATTEMPTS }), 'h1', 'llm')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'rejected', attempts: 1 }), 'h1')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'none', attempts: 1 }), 'h1')).toBe(true);
  });
  test('la plus récente d’abord ; une clé demandée est prise même déjà triée', () => {
    const jobs = [job({ id: 'A', date_published: '2026-10-20' }), job({ id: 'B', date_published: '2026-10-22' }), job({ id: 'C', status: 'APPLIED' })];
    expect(pickUntriaged(jobs, new Map(), 'h')?.id).toBe('B');
    expect(pickUntriaged(jobs, new Map([['B', record({ key: 'B', criteria_hash: 'h' })]]), 'h')?.id).toBe('A');
    expect(pickUntriaged(jobs, new Map([['B', record({ key: 'B', criteria_hash: 'h' })]]), 'h', 'B')?.id).toBe('B');
    expect(pickUntriaged('x', new Map(), 'h')).toBeNull();
    expect(pickUntriaged(jobs, new Map(), 'h', '', 'rules', new Set(['B']))?.id).toBe('A');
  });
  test('lit les tris écrits, ignore un fichier illisible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'));
    mkdirSync(join(dir, 'triage'));
    writeFileSync(join(dir, 'triage', 'LI-1.json'), JSON.stringify(record({ key: 'LI-1' })));
    writeFileSync(join(dir, 'triage', 'bad.json'), '{');
    expect([...readTriageRecords(dir).keys()]).toEqual(['LI-1']);
    expect(readTriageRecords(join(dir, 'absent')).size).toBe(0);
  });
});

describe('texte de l’annonce', () => {
  test('le salaire estimé du radar n’est pas l’annonce', () => {
    expect(isEstimatedSalary('38k€ - 50k€ (1-3 ans)')).toBe(true);
    expect(isEstimatedSalary('Selon profil')).toBe(true);
    expect(isEstimatedSalary('$30000 - $35000')).toBe(false);
    expect(postingText(job(), 'page', true)).not.toContain('38k');
    expect(postingText(job({ salary_range: '$30000 - $35000' }), 'page', true)).toContain('Salaire indiqué par la source : $30000 - $35000');
  });
  test('une page qui reprend la description est complète ; une page de connexion non', () => {
    const page = `Sign in\n${job().description}\n${'Requirements: Fluent in English and Italian. '.repeat(20)}`;
    expect(postingIsFull(page, job())).toBe(true);
    expect(postingIsFull('Sign in to LinkedIn to see this job. '.repeat(20), job())).toBe(false);
    expect(postingIsFull('court', job())).toBe(false);
  });
  test('description du radar réécrite : l’intitulé dans une page longue suffit (tiret et « (H/F) » en plus)', () => {
    const long = `Product Marketing Manager – Outils du Cabinet (H/F)\n${'Vous construisez le discours produit avec les équipes Produit et Sales. '.repeat(30)}`;
    const rewritten = job({ title: 'Product Marketing Manager - Outils du cabinet', description: 'Inqom recrute un Product Marketing Manager pour ses outils du cabinet, poste en télétravail complet depuis la France.' });
    expect(postingIsFull(long, rewritten)).toBe(true);
    expect(postingIsFull(long.slice(0, 1200), rewritten)).toBe(false);
    expect(postingIsFull(`Sign in to see this job. ${'Join now. '.repeat(200)}`, rewritten)).toBe(false);
  });
  test('un JSON-LD JobPosting vaut l’annonce dès 300 caractères, quelle que soit la description du radar', () => {
    const text = 'Profil senior. Minimum 7 ans d’expérience en Product Marketing. '.repeat(6);
    expect(postingIsFull(text, job({ description: 'Résumé du radar sans rapport avec la page, écrit par le parseur, long de plus de soixante caractères.' }), true)).toBe(true);
    expect(postingIsFull('court', job(), true)).toBe(false);
  });
  test('annonce partielle : le résumé du radar sert de texte', () => {
    expect(postingText(job(), 'page de connexion', false, (s) => s.replace('&amp;', '&'))).toContain('About The Company');
  });
});

describe('issue', () => {
  const base = { ok: true, status: 'verified', decision: 'ecartee', reasons: ["Exige l'italien"], notes: [], problems: [], findings: [] };
  test('seul un bloc vérifié décide', () => {
    expect(classify(base)).toEqual({ decision: 'ecartee', reasons: ["Exige l'italien"], notes: [], block_status: 'verified' });
  });
  test('juge défavorable, non convergé, pas de verdict : à vérifier, avec la raison', () => {
    const rejected = classify({ ...base, ok: false, status: 'rejected', decision: '', findings: [{ severity: 'blocking', text: 'italien = un plus' }] });
    expect(rejected.decision).toBe('a_verifier');
    expect(rejected.reasons[0]).toContain('italien = un plus');
    expect(classify({ ...base, ok: false, status: 'unconverged', decision: '', problems: ['quote missing'] }).reasons[0]).toContain('quote missing');
    expect(classify(null)).toMatchObject({ decision: 'a_verifier', block_status: 'none' });
    expect(classify({ ...base, decision: 'bof' }).decision).toBe('a_verifier');
  });
  test('commande du cockpit', () => {
    expect(triageRunArgs({ harness: 'H', careerDir: 'C', key: 'K' })).toEqual(['workflow', 'run', 'career-triage', '--detach', '--cwd', 'H', '--folder', '--input', 'career_dir=C', '--input', 'engine=rules', '--input', 'key=K']);
    expect(triageRunArgs({ harness: 'H', careerDir: 'C', engine: 'llm' })).toContain('engine=llm');
  });
  test('moteur rules : sa décision, block_status rules, définitive sauf sous le moteur llm', () => {
    expect(classify(null, null, null, { decision: 'retenue', reasons: ['ok'], notes: [] })).toEqual({ decision: 'retenue', reasons: ['ok'], notes: [], block_status: 'rules' });
    expect(classify(null, 'Annonce illisible : x', null, { decision: 'retenue', reasons: [], notes: [] }).block_status).toBe('unreadable');
    expect(needsTriage(job(), record({ block_status: 'rules' }), 'h1')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'rules' }), 'h1', 'llm')).toBe(true);
    expect(needsTriage(job(), record({ block_status: 'verified' }), 'h1', 'llm')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'unconverged', attempts: 1 }), 'h1')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'unconverged', attempts: 1 }), 'h1', 'llm')).toBe(true);
  });
});

describe('annonce lue ailleurs, ou illisible', () => {
  const LONG = 'You will own lifecycle campaigns and HubSpot workflows for our European customers, reporting to the CMO. '.repeat(8);
  const job = (over: Partial<PendingJob> & Record<string, unknown> = {}): PendingJob => ({ slug: 'acme', id: 'HIM-1', company: 'Acme', title: 'CRM Manager', link: 'https://him.test/1', status: 'PENDING_VALIDATION', source: 'Himalayas', description: 'Short summary.', ...over }) as PendingJob;
  test('page fermée : la description complète de la source sert de texte, annonce complète', () => {
    const chosen = choosePosting(job({ description_full: LONG }), null);
    expect(chosen).toEqual({ body: LONG, full: true, origin: 'radar_full' });
    expect(postingReadable(chosen.body)).toBe(true);
  });
  test('la page qui contient l’annonce passe avant la description du radar ; une description courte ne vaut pas l’annonce', () => {
    const page = `CRM Manager at Acme. ${LONG}${LONG}`; // plus de 1 500 caractères avec l’intitulé
    expect(choosePosting(job({ description_full: LONG }), { text: page, structured: false }).origin).toBe('page');
    expect(choosePosting(job({ description_full: LONG }), { text: page, structured: true }).origin).toBe('jsonld');
    expect(choosePosting(job({ description_full: 'Too short to be the posting.' }), { text: 'Sign in', structured: false })).toEqual({ body: 'Short summary.', full: false, origin: 'radar_summary' });
  });
  test('rien à lire (Jobdatalake, Jobgether, Apify sur Workday) : illisible, la raison dit ce qui a été tenté', () => {
    const empty = job({ source: 'Jobdatalake', description: '' });
    const chosen = choosePosting(empty, null);
    expect(postingReadable(chosen.body)).toBe(false);
    expect(postingReadable('x'.repeat(MIN_READABLE_CHARS))).toBe(true);
    expect(unreadableReason(empty, chosen.body, [{ url: 'https://x.test/apply', status: 0 }, { url: 'https://x.test/job', status: 403 }])).toBe("Annonce illisible : la page de l'offre n'a pas pu être lue (HTTP injoignable, HTTP 403) et le radar n'en donne que 0 caractère (source Jobdatalake) ; à ouvrir à la main");
    expect(unreadableReason(job({ source: 'Jobgether', description: 'Full time · Mid-level' }), 'Full time · Mid-level', [])).toContain('aucun lien http à lire');
  });
  test('issue d’une annonce illisible : à vérifier, sans verdict du bloc, statut « unreadable »', () => {
    expect(classify(null, "Annonce illisible : rien")).toEqual({ decision: 'a_verifier', reasons: ['Annonce illisible : rien'], notes: [], block_status: 'unreadable' });
    expect(classify(null, '').block_status).toBe('none');
  });
});

describe('pré-tri par le code (mode économe : aucun appel de modèle)', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  const criteria = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000 });
  test('plus de offre_age_max_jours jours (7 par défaut) : la raison de la règle du bloc', () => {
    expect(preScreen(job({ date_published: '2026-10-12' }), criteria, now)).toBe('offre trop ancienne (publiée le 2026-10-12, > 7 jours)');
    expect(preScreen(job({ date_published: '2026-10-17' }), criteria, now)).toBeNull();
    // Mise au tableau à la main : ni l'âge ni l'intitulé ne l'écartent (Canonical, PostHog « Developer Marketer »).
    expect(preScreen(job({ date_published: '2026-07-06', ajoutee_par: 'Antoine' }), criteria, now)).toBeNull();
    expect(preScreen(job({ date_published: '2026-10-20' }), JSON.stringify({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: 2 }), now)).toBe('offre trop ancienne (publiée le 2026-10-20, > 2 jours)');
  });
  test('date relative comptée depuis la lecture du radar ; sans date lisible, règle coupée ou critères illisibles : rien', () => {
    expect(preScreen(job({ date_published: 'il y a 3 jours', radar: { at: '2026-10-12T08:00:00Z' } } as Partial<PendingJob>), criteria, now)).toBe('offre trop ancienne (publiée le 2026-10-09, > 7 jours)');
    expect(preScreen(job({ date_published: 'récent' }), criteria, now)).toBeNull();
    expect(preScreen(job({ date_published: '2020-01-01' }), JSON.stringify({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: 0 }), now)).toBeNull();
    expect(preScreen(job({ date_published: '2020-01-01' }), '{', now)).toBeNull();
    expect(preScreen(job({ date_published: '2020-01-01' }), JSON.stringify({ offre_age_max_jours: 'sept' }), now)).toBeNull();
  });
  test('entreprise contredite par le lien LinkedIn (ligne faite de deux annonces) : écartée par le code, l’âge d’abord', () => {
    const mixed = { company: 'Bizneo HR', link: 'https://es.linkedin.com/jobs/view/growth-marketing-specialist-at-everai-4300000002' };
    const reason = "entreprise incohérente avec le lien : « Bizneo HR » ne correspond pas à l'employeur « everai » du lien (LinkedIn link)";
    expect(preScreen(job({ ...mixed, date_published: '2026-10-23' }), criteria, now)).toBe(reason);
    expect(preScreen(job({ ...mixed, date_published: '2026-10-23' }), '{', now)).toBe(reason);
    expect(preScreen(job({ ...mixed, date_published: '2026-10-12' }), criteria, now)).toBe('offre trop ancienne (publiée le 2026-10-12, > 7 jours)');
    expect(preScreen(job({ ...mixed, company: 'EverAI', date_published: '2026-10-23' }), criteria, now)).toBeNull();
    expect(preScreen(job({ company: 'Blueprint Technologies', link: 'https://job-boards.greenhouse.io/bpcs/jobs/7477705', date_published: '2026-10-23' }), criteria, now)).toBeNull();
  });
  test('issue : écartée, statut « pre_screened », sans verdict du bloc ; tri définitif, pas retenté', () => {
    const c = classify(null, null, 'offre trop ancienne (publiée le 2026-10-12, > 7 jours)');
    expect(c).toMatchObject({ decision: 'ecartee', reasons: ['offre trop ancienne (publiée le 2026-10-12, > 7 jours)'], block_status: 'pre_screened' });
    expect(classify(null, null, '').block_status).toBe('none');
    expect(needsTriage(job(), record({ block_status: 'pre_screened', attempts: 1 }), 'h1')).toBe(false);
    expect(needsTriage(job(), record({ block_status: 'pre_screened', attempts: 1 }), 'h2')).toBe(true);
  });
  test('le profil du candidat : master_profile.md du dossier carrière', () => {
    expect(profilePathIn('/c')).toBe(join('/c', 'master_profile.md'));
  });
});

describe('règles de criteres.json appliquées par le code seul (Antoine, 2026-10-25)', () => {
  const now = new Date('2026-10-24T20:00:00Z');
  const criteria = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, remote: 'full', intitules_exclus: ['data analyst', 'developer', 'it operations', 'fullstack'] });
  test('intitules_exclus : mots entiers, sans casse ni accents, entités HTML lues', () => {
    expect(titleOutOfScope('Data Analyst', criteria)).toBe('métier hors périmètre (« data analyst ») : Data Analyst');
    expect(titleOutOfScope('Marketing Data Analyst', criteria)).toBe('métier hors périmètre (« data analyst ») : Marketing Data Analyst');
    expect(titleOutOfScope('D365 CRM Developer (Remote within Poland)', criteria)).toContain('« developer »');
    expect(titleOutOfScope('IT Operations &amp; Case Management Specialist', criteria)).toBe('métier hors périmètre (« it operations ») : IT Operations & Case Management Specialist');
    expect(titleOutOfScope('Revenue Operations Analyst', criteria)).toBeNull();
    expect(titleOutOfScope('Growth Marketing Specialist', criteria)).toBeNull();
    expect(titleOutOfScope('Data Analyst', JSON.stringify({ langues: ['fr'] }))).toBeNull();
    expect(preScreen(job({ title: 'Developer Marketer - Sales', date_published: '' }), criteria)).toContain('« developer »');
    expect(preScreen(job({ title: 'Developer Marketer - Sales', date_published: '', ajoutee_par: 'Antoine' }), criteria)).toBeNull();
    expect(titleOutOfScope('Data Analyst', '{')).toBeNull();
  });
  test('la liste n’entre pas dans l’empreinte : la changer ne relance pas tous les tris', () => {
    const base = { langues: ['fr', 'en'], salaire_min_annuel: 35000 };
    expect(criteriaHash(JSON.stringify({ ...base, intitules_exclus: ['data analyst'] }))).toBe(criteriaHash(JSON.stringify(base)));
  });
  test('preScreen : métier exclu écarté avant toute lecture de page, après l’âge', () => {
    expect(preScreen(job({ title: 'Data Analyst', date_published: '2026-10-23' }), criteria, now)).toBe('métier hors périmètre (« data analyst ») : Data Analyst');
    expect(preScreen(job({ title: 'Data Analyst', date_published: '2026-10-12' }), criteria, now)).toBe('offre trop ancienne (publiée le 2026-10-12, > 7 jours)');
    expect(preScreen(job({ date_published: '2026-10-23' }), criteria, now)).toBeNull();
  });
  test('scopeOverride : métier exclu, ou « mode de travail non précisé » sur une annonce lue en entier quand remote = full', () => {
    const notStated = { decision: 'a_verifier' as const, reasons: ["Mode de travail non précisé dans l'annonce"], posting_full: true };
    expect(scopeOverride({ title: 'Sales Operations Specialist' }, notStated, criteria)).toEqual({ kind: 'remote', reason: REMOTE_NOT_STATED_REASON });
    // Annonce lue en partie : le texte complet dit peut-être « remote » : reste à vérifier.
    expect(scopeOverride({ title: 'Sales Operations Specialist' }, { ...notStated, posting_full: false, reasons: [...notStated.reasons, 'Annonce complète non lue : seul le résumé du radar a été trié'] }, criteria)).toBeNull();
    expect(scopeOverride({ title: 'Sales Operations Specialist' }, notStated, JSON.stringify({ langues: ['fr'], remote: 'hybride_ok' }))).toBeNull();
    expect(scopeOverride({ title: 'Sales Operations Specialist' }, { ...notStated, decision: 'retenue', reasons: ['Langues, salaire et mode de travail conformes à criteres.json'] }, criteria)).toBeNull();
    expect(scopeOverride({ title: 'Data Analyst' }, null, criteria)).toEqual({ kind: 'metier', reason: 'métier hors périmètre (« data analyst ») : Data Analyst' });
    expect(scopeOverride({ title: 'Growth Marketer' }, null, criteria)).toBeNull();
  });
});
