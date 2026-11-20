/**
 * `load` de career-triage : la lecture de la page (en-têtes de navigateur, redirections) sur
 * un serveur local, jamais un site réel ; le JSON-LD JobPosting d'une page faite à la main
 * (`samples/jobposting.sample.html`, aucune donnée personnelle) préféré au texte visible ; et
 * le script entier lancé en sous-processus sur un dossier carrière temporaire : `posting.txt`
 * porte la description de l'éditeur et `posting_full` vaut "true" même quand la description
 * du radar ne se retrouve pas mot pour mot dans la page.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSER_HEADERS, experienceLine, fetchPage, jobPostingFrom, postingFromJobPosting, readPosting, salaryLine } from './load.ts';

/** Une date de publication d'hier : la règle des 7 jours ne doit pas écarter l'offre de test (la date fixe 2026-10-22 a fait échouer ces tests à partir du 2026-10-30). */
const FRESH = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const SAMPLE = readFileSync(join(import.meta.dir, 'samples', 'jobposting.sample.html'), 'utf8');
const PLAIN = `<html><head><title>Growth Manager</title></head><body><nav>Menu</nav><h1>Growth Manager</h1><p>${'We are hiring a Growth Manager to run paid campaigns with the team. '.repeat(10)}</p></body></html>`;

let server: ReturnType<typeof Bun.serve>;
let base = '';
const seen: Record<string, string>[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      seen.push(Object.fromEntries(request.headers.entries()));
      if (url.pathname === '/r') return Response.redirect(`${base}/job`, 302);
      if (url.pathname === '/job') return new Response(SAMPLE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (url.pathname === '/plain') return new Response(PLAIN, { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/wall') return new Response('<html><body>Sign in to see this job.</body></html>', { status: 403 });
      return new Response('not found', { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => {
  server.stop(true);
});

describe('lecture de la page', () => {
  test('en-têtes de navigateur (Chrome, Accept, fr-FR) et redirection suivie', async () => {
    const page = await fetchPage(`${base}/r`);
    expect(page.ok).toBe(true);
    expect(page.status).toBe(200);
    expect(page.finalUrl).toBe(`${base}/job`);
    expect(page.html).toContain('JobPosting');
    const headers = seen.at(-1) as Record<string, string>;
    expect(headers['user-agent']).toContain('Chrome/');
    expect(headers['user-agent']).not.toContain('harness');
    expect(headers['accept-language']).toBe('fr-FR,fr;q=0.9,en;q=0.8');
    expect(headers.accept).toContain('text/html');
    expect(BROWSER_HEADERS['User-Agent']).toMatch(/^Mozilla\/5\.0 \(Windows NT/);
  });
  test('hors 2xx ou injoignable : ok false, html vide, jamais d’exception', async () => {
    expect(await fetchPage(`${base}/wall`)).toMatchObject({ ok: false, status: 403, html: '' });
    expect(await fetchPage('http://127.0.0.1:9/nothing', fetch, 500)).toMatchObject({ ok: false, status: 0 });
  });
});

describe('JSON-LD JobPosting', () => {
  test('trouve le JobPosting, pas l’Organization qui le précède, attributs dans n’importe quel ordre', () => {
    const posting = jobPostingFrom(SAMPLE);
    expect(posting?.['@type']).toBe('JobPosting');
    expect(posting?.title).toBe('Product Marketing Manager - Outils du cabinet (H/F)');
    expect(jobPostingFrom(PLAIN)).toBeNull();
    expect(jobPostingFrom('<script type="application/ld+json">{pas du json</script>')).toBeNull();
    expect(jobPostingFrom('<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["JobPosting"],"description":"<p>x</p>"}]}</script>')?.description).toBe('<p>x</p>');
  });
  test('le texte : titre, description sans HTML, salaire, date limite, expérience, télétravail', () => {
    const text = postingFromJobPosting(jobPostingFrom(SAMPLE) as Record<string, unknown>);
    expect(text.startsWith('Product Marketing Manager - Outils du cabinet (H/F)\nEntreprise : Exemplia')).toBe(true);
    expect(text).toContain("Profil senior. Minimum 7 ans d'expérience en Product Marketing, idéalement en SaaS B2B.");
    expect(text).toContain('Vous pilotez les lancements de fonctionnalités.');
    expect(text).not.toContain('<p>');
    expect(text).not.toContain('Offres similaires');
    expect(text).toContain('Salaire (baseSalary) : 60000 - 68000 EUR par an');
    expect(text).toContain("Candidatures jusqu'au : 2026-12-31T23:59:59");
    expect(text).toContain("Expérience requise (experienceRequirements) : au moins 7 ans d'expérience");
    expect(text).toContain('Lieu de travail (jobLocationType) : TELECOMMUTE');
    expect(text).toContain('Lieu : Paris, FR');
  });
  test('salaire et expérience : formes admises', () => {
    expect(salaryLine({ currency: 'eur', value: 42000 })).toBe('42000 EUR');
    expect(salaryLine({ currency: 'GBP', value: { minValue: 3000, unitText: 'MONTH' } })).toBe('3000 GBP par mois');
    expect(salaryLine({ value: 1 })).toBe('');
    expect(salaryLine('n/a')).toBe('');
    expect(experienceLine({ monthsOfExperience: 18 })).toBe("au moins 18 mois d'expérience");
    expect(experienceLine('3 years in a similar role')).toBe('3 years in a similar role');
    expect(experienceLine(null)).toBe('');
  });
  test('readPosting : le JobPosting d’abord, le texte visible sinon', () => {
    const structured = readPosting(SAMPLE);
    expect(structured.structured).toBe(true);
    expect(structured.text).not.toContain('Se connecter');
    const plain = readPosting(PLAIN);
    expect(plain.structured).toBe(false);
    expect(plain.text).toContain('We are hiring a Growth Manager');
    const short = readPosting('<script type="application/ld+json">{"@type":"JobPosting","description":"<p>trop court</p>"}</script><p>Page text here.</p>');
    expect(short.structured).toBe(false);
  });
});

describe('le script entier (sous-processus)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function run(job: Record<string, unknown>, profile: string | null = null, stored: string | null = null): Promise<{ out: Record<string, unknown>; posting: string; profile: string | null }> {
    const root = mkdtempSync(join(tmpdir(), 'triage-load-'));
    dirs.push(root);
    const career = join(root, 'career');
    const artifacts = join(root, 'artifacts');
    mkdirSync(career);
    mkdirSync(artifacts);
    writeFileSync(join(career, 'criteres.json'), JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, experience_max_annees: 3 }));
    if (profile !== null) writeFileSync(join(career, 'master_profile.md'), profile);
    if (stored !== null) {
      mkdirSync(join(career, 'postings'));
      writeFileSync(join(career, 'postings', 'WTTJ-1.txt'), stored);
    }
    writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([{ id: 'WTTJ-1', slug: 'exemplia-pmm', company: 'Exemplia', title: 'Product Marketing Manager - Outils du cabinet', status: 'PENDING_VALIDATION', date_published: FRESH, ...job }]));
    const proc = Bun.spawn(['bun', join(import.meta.dir, 'load.ts')], {
      env: { ...process.env, INPUTS_CAREER_DIR: career, INPUTS_KEY: '', ARTIFACTS_DIR: artifacts },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const line = stdout.trim().split('\n').pop() ?? '{}';
    let posting = '';
    try {
      posting = readFileSync(join(artifacts, 'posting.txt'), 'utf8');
    } catch {
      posting = '';
    }
    let copied: string | null = null;
    try {
      copied = readFileSync(join(artifacts, 'profile.md'), 'utf8');
    } catch {
      copied = null;
    }
    return { out: JSON.parse(line) as Record<string, unknown>, posting, profile: copied };
  }

  test('page avec JobPosting et description du radar réécrite : annonce complète, texte de l’éditeur', async () => {
    const { out, posting } = await run({ link: `${base}/r`, description: 'Exemplia recrute un PMM pour ses outils du cabinet, résumé écrit par le radar sans rapport mot pour mot avec la page.', salary_range: '38k€ - 50k€ (1-3 ans)' });
    expect(out.ok).toBe(true);
    expect(out.go).toBe(true);
    expect(out.posting_full).toBe('true');
    expect(String(out.summary)).toContain('JSON-LD JobPosting');
    expect(posting).toContain("Minimum 7 ans d'expérience en Product Marketing");
    expect(posting).toContain('Salaire (baseSalary) : 60000 - 68000 EUR par an');
    expect(posting).toContain('--- Champs du radar');
    expect(posting).not.toContain('38k');
    expect(JSON.parse(String(out.offer_json)).title).toBe('Product Marketing Manager - Outils du cabinet');
    // La règle d'âge du bloc lit la date du tableau, et le moment de lecture du radar (vide ici).
    expect(JSON.parse(String(out.offer_json))).toMatchObject({ date_published: FRESH, radar_at: '' });
  });
  test('offre du radar du PC : date relative et moment de lecture (radar.at) passés au bloc', async () => {
    const at = new Date(Date.now() - 86_400_000).toISOString();
    const { out } = await run({ link: `${base}/wall`, date_published: 'il y a 3 jours', radar: { run: 'R1', at } });
    expect(out.pre_screened).toBe(false);
    expect(JSON.parse(String(out.offer_json))).toMatchObject({ date_published: 'il y a 3 jours', radar_at: at });
  });
  test('mode économe : offre trop ancienne tranchée par le code, ni page lue ni bloc (aucun appel de modèle)', async () => {
    const before = seen.length;
    const { out, posting, profile } = await run({ link: `${base}/job`, date_published: 'il y a 3 jours', radar: { run: 'R1', at: '2026-10-12T08:00:00.000Z' } }, '# Profil');
    expect(seen.length - before).toBe(0);
    expect(out).toMatchObject({ ok: true, go: true, pre_screened: true, pre_screen_reason: 'offre trop ancienne (publiée le 2026-10-09, > 7 jours)' });
    expect(String(out.summary)).toContain('no model call');
    expect(JSON.parse(String(out.offer_json))).toMatchObject({ date_published: 'il y a 3 jours', radar_at: '2026-10-12T08:00:00.000Z' });
    expect(posting).toBe('');
    expect(profile).toBeNull();
  });
  test('le profil du candidat (master_profile.md) est copié pour le bloc ; absent : profile_file vide', async () => {
    const withProfile = await run({ link: `${base}/r` }, '# Antoine\n- **CRM** : refonte des emails de lifecycle.');
    expect(withProfile.out.profile_file).toBe('profile.md');
    expect(withProfile.profile).toContain('refonte des emails de lifecycle');
    expect(String(withProfile.out.summary)).toContain('candidate profile given');
    const without = await run({ link: `${base}/r` });
    expect(without.out.profile_file).toBe('');
    expect(without.profile).toBeNull();
    expect(String(without.out.summary)).toContain('core-of-role fit not assessed');
  });
  test('mur (403) : résumé du radar seul, posting_full false, la raison dans le résumé', async () => {
    const { out, posting } = await run({ link: `${base}/wall`, description: 'Résumé du radar : un poste de Product Marketing Manager en télétravail complet depuis la France.' });
    expect(out.posting_full).toBe('false');
    expect(String(out.summary)).toContain('HTTP 403');
    expect(posting).toContain('Résumé du radar');
    // 96 caractères de résumé : rien à trier, le bloc sera sauté avec la raison.
    expect(out.readable).toBe(false);
    expect(String(out.unreadable_reason)).toBe("Annonce illisible : la page de l'offre n'a pas pu être lue (HTTP 403) et le radar n'en donne que 96 caractères (source ?) ; à ouvrir à la main");
  });
  test('mur (403), mais la source a donné l’annonce entière au radar (description_full) : annonce complète, lisible', async () => {
    const full = 'Nous recrutons un Product Marketing Manager pour nos outils du cabinet, en télétravail complet. '.repeat(8);
    const { out, posting } = await run({ link: `${base}/wall`, source: 'Himalayas', description: 'Résumé court.', description_full: full });
    expect(out.posting_full).toBe('true');
    expect(out.readable).toBe(true);
    expect(out.unreadable_reason).toBe('');
    expect(String(out.summary)).toContain("the source's full description from the radar");
    expect(posting.startsWith('Nous recrutons un Product Marketing Manager')).toBe(true);
  });
  test('mur (403), mais le radar de la VM a gardé l’annonce complète lue à la relève (postings/<clé>.txt) : elle sert, sans ses champs du radar', async () => {
    const body = 'Annonce lue par la VM : Product Marketing Manager pour nos outils du cabinet, télétravail complet. '.repeat(8);
    const stored = `${body}\n\n--- Champs du radar (pas l'annonce) ---\nEntreprise : Exemplia\nPoste : PMM\n`;
    const { out, posting } = await run({ link: `${base}/wall`, description: 'Résumé court.' }, null, stored);
    expect(out.posting_full).toBe('true');
    expect(out.readable).toBe(true);
    expect(String(out.summary)).toContain('the full posting the VM radar read at capture');
    expect(posting.startsWith('Annonce lue par la VM')).toBe(true);
    expect(posting.split("--- Champs du radar (pas l'annonce) ---").length).toBe(2);
    // Une annonce gardée trop courte ne vaut pas mieux que le résumé.
    const short = await run({ link: `${base}/wall`, description: 'Résumé court.' }, null, 'trop court');
    expect(short.out.posting_full).toBe('false');
  });
  test('la page de l’annonce (posting_url) est lue avant le lien de candidature (formulaire Workday)', async () => {
    const before = seen.length;
    const { out, posting } = await run({ link: `${base}/wall`, posting_url: `${base}/job`, description: '' });
    expect(seen.length - before).toBe(1); // la page suffit : le formulaire n'est pas demandé
    expect(out.posting_full).toBe('true');
    expect(out.readable).toBe(true);
    expect(posting).toContain("Minimum 7 ans d'expérience en Product Marketing");
  });
  test('Jobdatalake / Jobgether : page fermée et aucun texte du radar : illisible', async () => {
    const { out } = await run({ link: `${base}/missing`, source: 'Jobgether', description: 'Full time · Mid-level' });
    expect(out.go).toBe(true);
    expect(out.readable).toBe(false);
    expect(String(out.unreadable_reason)).toContain('HTTP 404');
    expect(String(out.unreadable_reason)).toContain('source Jobgether');
  });
});
