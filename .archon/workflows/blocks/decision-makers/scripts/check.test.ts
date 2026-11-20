import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherPieces, maxPeople } from './check.ts';
import { type Produced, decide, verdictFile } from './verdict.ts';

const root = mkdtempSync(join(tmpdir(), 'decision-makers-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const profile = `# 👤 Profil Maître : Antoine Lecerf

### Way2Tech.ai — Product Manager · CRM Manager · Growth
* **Automatisations :** flux n8n / Zapier pour l'enrichissement de leads, le scoring et la synchronisation CRM en temps réel.
* **Campagnes :** campagnes B2B multicanales (Apollo, Lemlist, HubSpot).

### 1001 Goûts — Digital Marketing & Operations Automation
* **Reporting :** reporting marketing et commercial automatisé (Google Sheets / Looker Studio).
`;

const englishPosting = 'Dana is hiring a Sales Operations Analyst. You will work with the sales leaders and the finance team to build the reporting that our regions use every week, and you will own the CRM data quality for the whole business.';

/** Un dossier carrière jetable : `<career>/applications/<slug>/` et `<career>/pending_gold_jobs.json`. */
function career(name: string, files: Record<string, string>, board?: unknown[]): { app: string; profile: string } {
  const dir = join(root, name);
  const app = join(dir, 'applications', 'dana-sales-ops');
  mkdirSync(app, { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(join(app, file), content);
  if (board) writeFileSync(join(dir, 'pending_gold_jobs.json'), `﻿${JSON.stringify(board)}`);
  writeFileSync(join(dir, 'master_profile.md'), profile);
  return { app, profile: join(dir, 'master_profile.md') };
}

const empty = { application: '', offer: '', profile: '', cv: '', pitch: '' };

describe('decision-makers : les pièces de la candidature', () => {
  test('dossier sans CV ni pitch (run en pause au go) : offre de offer.json, nom du candidat du profil', () => {
    const { app, profile: p } = career('no-cv', { 'offer.json': JSON.stringify({ company: 'Dana Incorporated', title: 'Sales Operations Analyst', description_full: englishPosting }) });
    const pieces = gatherPieces({ ...empty, application: app, profile: p });
    expect(pieces).toMatchObject({ company: 'Dana Incorporated', title: 'Sales Operations Analyst', language: 'en', cv: '', pitch: '', candidate: 'Antoine Lecerf' });
    expect(pieces.posting).toContain('CRM data quality');
    expect(pieces.profile).toContain('Way2Tech.ai');
  });
  test('sans offer.json, l’offre du tableau par le nom du dossier ; l’annonce du dossier s’y ajoute', () => {
    const { app, profile: p } = career('board', { 'annonce.md': englishPosting }, [
      { slug: 'globex', company: 'Globex' },
      { slug: 'dana-sales-ops', company: 'Dana Incorporated', title: 'Sales Operations Analyst', description: 'Résumé du radar', skills_required: 'Salesforce, 12 regions' },
    ]);
    const pieces = gatherPieces({ ...empty, application: app, profile: p });
    expect(pieces.company).toBe('Dana Incorporated');
    expect(pieces.language).toBe('en');
    expect(pieces.posting).toContain('Résumé du radar');
    expect(pieces.posting).toContain('12 regions');
  });
  test('l’entrée offer prime ; le CV du dossier donne le nom ; interlocuteur_cible.json en dernier recours', () => {
    const { app, profile: p } = career('explicit', {
      'offer.json': JSON.stringify({ company: 'Globex' }),
      'CV_Antoine_Lecerf_dana.md': '# CV — Antoine Lecerf\n',
      'Message_Accroche_dana.md': 'Bonjour',
    });
    const pieces = gatherPieces({ ...empty, application: app, profile: p, offer: JSON.stringify({ company: 'Dana', title: 'Analyste Sales Ops', description: 'Nous recrutons un analyste pour notre équipe commerciale, dans le cadre de la croissance de nos ventes en France et en Europe.' }) });
    expect(pieces).toMatchObject({ company: 'Dana', language: 'fr', candidate: 'Antoine Lecerf', pitch: 'Bonjour' });
    const contactOnly = career('contact', { 'interlocuteur_cible.json': JSON.stringify({ company: 'Dana Incorporated', title: 'Sales Ops' }) });
    expect(gatherPieces({ ...empty, application: contactOnly.app, profile: contactOnly.profile })).toMatchObject({ company: 'Dana Incorporated', title: 'Sales Ops' });
  });
  test('rien de lisible : tout vide, le français par défaut', () => {
    expect(gatherPieces({ ...empty, application: join(root, 'absent') })).toMatchObject({ company: '', title: '', posting: '', language: 'fr', profile: '', candidate: '' });
  });
  test('max_people : 1 à 10, sinon 4', () => {
    expect(maxPeople('2')).toBe(2);
    expect(maxPeople('')).toBe(4);
    expect(maxPeople('0')).toBe(4);
    expect(maxPeople('beaucoup')).toBe(4);
  });
});

const produced: Produced = {
  ok: true,
  problems: [],
  summary: 'stub: deux décideurs',
  people: 2,
  deliverable: { type: 'archon_artifact', run_id: 'r', path: 'decideurs.json' },
  tries: 1,
};

describe('decision-makers : le verdict', () => {
  test('verified, rejected, unconverged', () => {
    expect(decide(produced, { approved: true, grade: 'A', reason: 'ok', findings: [] })).toMatchObject({ ok: true, status: 'verified' });
    const rejected = decide(produced, { approved: false, grade: 'B', reason: 'non', findings: [{ severity: 'blocking', text: 'x' }] });
    expect(rejected).toMatchObject({ ok: false, status: 'rejected', findings: [{ severity: 'blocking', text: 'x' }] });
    const red = decide({ ...produced, ok: false, problems: ['p'], tries: 3 }, { approved: true, grade: '', reason: '', findings: [{ severity: 'minor', text: 'ignoré' }] });
    expect(red).toMatchObject({ ok: false, status: 'unconverged', problems: ['p'], findings: [] });
    expect(red.summary).toContain('3 tour(s)');
  });
  test('le fichier du verdict suit le livrable', () => {
    expect(verdictFile('decideurs.json')).toBe('decideurs.verdict.json');
    expect(verdictFile('')).toBe('decideurs.verdict.json');
    expect(verdictFile('contacts.json')).toBe('contacts.verdict.json');
  });
  test('le script écrit decideurs.verdict.json même quand le juge est sauté', () => {
    const artifacts = join(root, 'artifacts');
    mkdirSync(artifacts, { recursive: true });
    const run = Bun.spawnSync(['bun', join(import.meta.dir, 'verdict.ts')], {
      env: { ...process.env, ARTIFACTS_DIR: artifacts, INPUTS_PRODUCED: JSON.stringify({ ...produced, ok: false, problems: ['p'], tries: 3 }), INPUTS_APPROVED: 'null', INPUTS_GRADE: 'null', INPUTS_REASON: 'null', INPUTS_FINDINGS: 'null', INPUTS_OUT: 'decideurs.json' },
    });
    expect(run.exitCode).toBe(0);
    const out = JSON.parse(run.stdout.toString());
    expect(out).toMatchObject({ ok: false, status: 'unconverged' });
    expect(JSON.parse(readFileSync(join(artifacts, 'decideurs.verdict.json'), 'utf8'))).toEqual(out);
  });
});

describe('decision-makers : le contrôle de bout en bout', () => {
  test('un fichier correct passe, sans CV dans le dossier ; un e-mail deviné ne passe pas', () => {
    const { app, profile: p } = career('e2e', { 'offer.json': JSON.stringify({ company: 'Dana Incorporated', title: 'Sales Operations Analyst', description_full: englishPosting }) });
    const artifacts = join(root, 'e2e-artifacts');
    mkdirSync(artifacts, { recursive: true });
    const body = `Hi Maria,

Dana is building the reporting that its regions use every week, and keeping CRM data clean for the whole business. That is close to what I did at Way2Tech.ai, where I built n8n and Zapier workflows for lead enrichment, lead scoring and real-time CRM synchronisation. At 1001 Goûts I automated the marketing and sales reporting in Google Sheets and Looker Studio.

Could we have a short call next week about how the Sales Operations Analyst role works with your team?

Best regards,
Antoine Lecerf`;
    const doc = {
      company: 'Dana',
      job_title: 'Sales Operations Analyst',
      domain: 'dana.com',
      language: 'en',
      people: [{ name: 'Maria Lopez', role: 'VP Sales Operations', why: 'Dirige la fonction du poste.', source: 'https://www.dana.com/leadership', evidence: 'Maria Lopez, Vice President, Sales Operations' }],
      searches: ['Dana "Sales Operations"', 'Dana "Talent Acquisition"'],
      linkedin_note: { to: 'Maria Lopez', text: 'Hi Maria, I saw the Sales Operations Analyst role at Dana. I build CRM syncs, lead scoring and sales reporting (n8n, HubSpot, Looker Studio) and would be glad to connect. Antoine' },
      email: { to: 'Maria Lopez', subject: 'Sales Operations Analyst at Dana', body },
      sources: ['https://www.dana.com/leadership'],
      notes: ['Aucun recruteur nommé en public.'],
    };
    const run = (content: string) => {
      writeFileSync(join(artifacts, 'decideurs.json'), content);
      const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'check.ts')], {
        env: { ...process.env, ARTIFACTS_DIR: artifacts, INPUTS_APPLICATION: app, INPUTS_PROFILE: p, INPUTS_OFFER: '', INPUTS_CV: '', INPUTS_PITCH: '', INPUTS_MAX_PEOPLE: '4', INPUTS_OUT: 'decideurs.json', INPUTS_SUMMARY: 's', INPUTS_DELIVERABLE: 'null', INPUTS_TRIES: '1' },
      });
      return JSON.parse(proc.stdout.toString());
    };
    expect(run(JSON.stringify(doc))).toMatchObject({ ok: true, problems: [], people: 1, tries: 2 });
    const guessed = run(JSON.stringify({ ...doc, notes: ['Format probable : maria.lopez@dana.com'] }));
    expect(guessed.ok).toBe(false);
    expect(guessed.problems.join('\n')).toContain('adresse e-mail');
  });
});
