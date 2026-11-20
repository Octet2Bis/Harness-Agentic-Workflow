/**
 * La source Free-Hire proposée pour le radar, sur une réponse sauvegardée
 * (`test/freehire_search.sample.json`, écrite à la main dans la forme de l'API) : aucun appel
 * réseau, aucun tableau écrit. La lecture des deux formes (API, CLI d'ai-job-search), le
 * passage aux champs du tableau, l'écart des doublons, la requête que ferait le radar.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardSlug, dedupe, linkKey, mapSavedResponse, parseFreehireResponse, salaryRange, searchPath, toBoardCandidate } from './radar_freehire.ts';

const SAMPLE = join(import.meta.dir, 'test', 'freehire_search.sample.json');
const sample = (): unknown => JSON.parse(readFileSync(SAMPLE, 'utf8')) as unknown;
const NOW = new Date('2026-10-22T06:00:00Z');

/** Le tableau du bot : une offre vue par LinkedIn (autre lien, même entreprise et intitulé), une autre au même lien d'ATS. */
const BOARD = [
  { slug: 'nordlys_ops', company: 'NORDLYS', title: 'Sales Operations Lead', link: 'https://fr.linkedin.com/jobs/view/123', status: 'APPLIED' },
  { slug: 'kestrel_auto', company: 'Kestrel', title: 'Automation Engineer', link: 'https://apply.workable.com/kestrel/j/AB12CD34EF', status: 'PENDING_VALIDATION' },
];

describe('parseFreehireResponse : la réponse sauvegardée', () => {
  test('enveloppe de l’API : les jobs lisibles, les autres écartés avec leur raison (clos, sans URL)', () => {
    const { jobs, skipped } = parseFreehireResponse(sample());
    expect(jobs.map((job) => job.public_slug)).toEqual([
      'growth-ops-manager-acme-7k2p9qxa',
      'revops-analyst-borealis-3hq8m2zd',
      'sales-ops-nordlys-9zz1c4ab',
      'automation-engineer-kestrel-2mm7v1qe',
    ]);
    expect(skipped).toEqual(['#4 (closed-role-acme-0aa0aa0a): closed_at 2026-10-01T00:00:00Z', '#5 (no-url-1): missing http(s) url']);
  });

  test('sortie de la CLI d’ai-job-search (`results`, `id`, `date`) et tableau nu : lus pareil', () => {
    const cli = { meta: { count: 1, page: 1, total: 1 }, results: [{ id: 'ops-acme-1a2b3c4d', title: 'Ops', company: 'Acme', url: 'https://jobs.lever.co/acme/1', date: '2026-10-21' }] };
    expect(parseFreehireResponse(cli).jobs[0]).toMatchObject({ public_slug: 'ops-acme-1a2b3c4d', posted_at: '2026-10-21' });
    expect(parseFreehireResponse(cli.results).jobs).toHaveLength(1);
    expect(parseFreehireResponse({ error: 'not found' })).toEqual({ jobs: [], skipped: [] });
    expect(parseFreehireResponse(null)).toEqual({ jobs: [], skipped: [] });
  });
});

describe('toBoardCandidate : les champs d’une offre du tableau', () => {
  test('un job complet : chaque champ du tableau, les extras Free-Hire à part', () => {
    const job = parseFreehireResponse(sample()).jobs[0]!;
    expect(toBoardCandidate(job, NOW)).toEqual({
      id: 'FH-growth-ops-manager-acme-7k2p9qxa',
      slug: 'acme_7k2p9qxa',
      company: 'Acme',
      title: 'Growth Ops Manager & GTM Engineer',
      link: 'https://boards.greenhouse.io/acme/jobs/4410021?gh_src=freehire',
      source: 'freehire',
      location: 'Paris, France',
      description: 'Acme recrute un Growth Ops Manager.\n- Automatiser le GTM (n8n, HubSpot)\n- Piloter le tracking',
      skills_required: 'n8n, hubspot, sql',
      salary_range: '48000–55000 EUR/year',
      date_published: '2026-10-20',
      found_at: '2026-10-22T06:00:00.000Z',
      freehire: {
        public_slug: 'growth-ops-manager-acme-7k2p9qxa',
        ats: 'greenhouse',
        external_id: '4410021',
        company_slug: 'acme',
        work_mode: 'hybrid',
        seniority: 'middle',
        category: 'operations',
        employment_type: 'full_time',
        countries: ['fr'],
        regions: ['eu'],
      },
    });
  });

  test('un job pauvre : champs vides plutôt qu’inventés, lieu tiré de la ville et du pays', () => {
    const job = parseFreehireResponse(sample()).jobs[1]!;
    expect(toBoardCandidate(job, NOW)).toMatchObject({ slug: 'borealis_logistique_3hq8m2zd', location: 'Lyon, FR', description: '', skills_required: '', salary_range: '', date_published: '' });
  });

  test('salaire : une borne, la période gardée ; slug : entreprise + suffixe stable', () => {
    expect(salaryRange({ salary_min: 3000, salary_currency: 'EUR', salary_period: 'month' })).toBe('3000 EUR/month');
    expect(salaryRange({})).toBe('');
    expect(boardSlug({ public_slug: 'x-y-zz9', url: 'u', title: 't', company: 'Société Générale' })).toBe('societe_generale_zz9');
  });
});

describe('dedupe : jamais deux fois la même offre sur le tableau', () => {
  test('même lien d’ATS (suivi et / final ignorés), même entreprise + intitulé vus par une autre source : écartés, quel que soit le statut', () => {
    const { fresh, duplicates } = mapSavedResponse(sample(), BOARD, NOW);
    expect(fresh.map((offer) => offer.slug)).toEqual(['acme_7k2p9qxa', 'borealis_logistique_3hq8m2zd']);
    expect(duplicates).toEqual([
      { slug: 'nordlys_9zz1c4ab', reason: 'same company and title as nordlys_ops' },
      { slug: 'kestrel_2mm7v1qe', reason: 'same posting link as kestrel_auto' },
    ]);
  });

  test('même public_slug Free-Hire déjà importé (le lien a pu changer) ; même offre deux fois dans la réponse', () => {
    const job = parseFreehireResponse(sample()).jobs[0]!;
    const candidate = toBoardCandidate(job, NOW);
    const board = [{ slug: 'acme_old', company: 'Acme', title: 'Autre intitulé', link: 'https://acme.fr/x', freehire: { public_slug: job.public_slug } }];
    expect(dedupe([candidate], board).duplicates).toEqual([{ slug: 'acme_7k2p9qxa', reason: 'same Free-Hire posting as acme_old' }]);
    expect(dedupe([candidate, { ...candidate }], []).duplicates).toHaveLength(1);
  });

  test('une offre neuve n’est pas écartée (le cas qui doit passer)', () => {
    const candidate = toBoardCandidate(parseFreehireResponse(sample()).jobs[0]!, NOW);
    expect(dedupe([candidate], BOARD)).toEqual({ fresh: [candidate], duplicates: [] });
  });

  test('linkKey : schéma, www, suivi, ancre et / final ignorés ; l’identifiant de l’annonce gardé', () => {
    expect(linkKey('https://www.Boards.greenhouse.io/acme/jobs/1/?gh_src=x&utm_source=y#apply')).toBe('boards.greenhouse.io/acme/jobs/1');
    expect(linkKey('https://boards.greenhouse.io/acme/jobs?gh_jid=1')).toBe('boards.greenhouse.io/acme/jobs?gh_jid=1');
  });
});

describe('searchPath : la requête que ferait le radar (une chaîne, jamais envoyée ici)', () => {
  test('recherche agent, texte, filtres répétés', () => {
    expect(searchPath({ query: 'title:growth OR title:revops', countries: ['FR'], workModes: ['remote', 'hybrid'], postedWithinDays: 3, limit: 25 })).toBe(
      '/api/v1/agent/jobs/search?q=title%3Agrowth+OR+title%3Arevops&limit=25&offset=0&description_format=text&posted_within_days=3&countries=fr&work_mode=remote%2Chybrid'
    );
  });
  test('plus de 5 alternatives : refusé avant tout appel (l’API répondrait 400)', () => {
    expect(() => searchPath({ query: 'a OR b OR c OR d OR e OR f' })).toThrow('at most 5');
  });
});

describe('radar_freehire.ts en ligne de commande', () => {
  test('lit la réponse sauvegardée et le tableau, imprime fresh / duplicates / skipped, sans réseau', () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-freehire-'));
    const board = join(dir, 'pending_gold_jobs.json');
    writeFileSync(board, JSON.stringify(BOARD));
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'radar_freehire.ts'), SAMPLE, '--board', board, '--now', NOW.toISOString()], { stdout: 'pipe', stderr: 'pipe' });
    rmSync(dir, { recursive: true, force: true });
    expect(proc.stderr.toString()).toBe('');
    const out = JSON.parse(proc.stdout.toString()) as { fresh: { slug: string }[]; duplicates: unknown[]; skipped: unknown[] };
    expect(out.fresh.map((offer) => offer.slug)).toEqual(['acme_7k2p9qxa', 'borealis_logistique_3hq8m2zd']);
    expect(out.duplicates).toHaveLength(2);
    expect(out.skipped).toHaveLength(2);
    expect(readFileSync(join(import.meta.dir, 'radar_freehire.ts'), 'utf8')).not.toMatch(/\bfetch\s*\(/);
  });
});
