/**
 * `screen` lancé pour de vrai sur des artefacts temporaires : doublons, offres déjà au
 * tableau, âge (offre_age_max_jours de criteres.json, 7 jours par défaut), jury, fichiers
 * qualified.json / rejected.json, pointeur rendu ; raw.json absent.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bench, cleanBenches, pointer, readJson, runScript } from './radar-test-helpers.ts';

afterEach(cleanBenches);

const DAY_MS = 86_400_000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

const job = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 'X-1', company: 'Acme SAS', title: 'Growth Marketing Specialist', location: 'Remote - Europe', remote_declared: true, company_hq: '',
  skills_required: 'HubSpot', description: 'Fully remote role for the European team, 1-3 years of experience with the tools we use.',
  salary_range: null, link: 'https://jobs.example/1', date_published: daysAgo(0), source: 'Himalayas', ...over,
});

describe('screen : le crible sans modèle', () => {
  test('qualifie, rejette avec raison, écrit les deux fichiers et rend go: true', () => {
    const b = bench({ board: [{ slug: 'old', company: 'Old', title: 't', link: 'https://jobs.example/old', status: 'VALIDATED' }] });
    mkdirSync(join(b.artifacts, 'radar'));
    writeFileSync(join(b.artifacts, 'radar', 'raw.json'), JSON.stringify({ jobs: [
      job({ id: 'A' }),
      job({ id: 'B', link: 'https://JOBS.example/1' }),
      job({ id: 'C', link: 'https://jobs.example/old', title: 'CRM Specialist' }),
      job({ id: 'D', link: 'https://jobs.example/d', company: 'Hybrid Co', description: 'Hybrid, 3 days a week in our office.' }),
      job({ id: 'E', link: 'https://jobs.example/e', company: 'Startup SaaS Co', description: 'Fully remote SaaS startup, 1-3 years.' }),
    ] }));
    const { out } = runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/raw.json') });
    expect(out).toMatchObject({ ok: true, go: true, qualified_count: 2, rejected_count: 3, qualified_path: { type: 'archon_artifact', run_id: 'R9', path: 'radar/qualified.json' } });
    const qualified = (readJson(join(b.artifacts, 'radar', 'qualified.json')) as { qualified: Record<string, unknown>[] }).qualified;
    expect(qualified.map((q) => q.id)).toEqual(['E', 'A']); // la startup gagne 10 points
    expect(qualified[0]).toMatchObject({ slug: 'startup_saas_co', status: 'PENDING_VALIDATION', is_startup: true, tier: 'Gold' });
    expect(qualified[1]).toMatchObject({ slug: 'acme_sas', status: 'PENDING_VALIDATION', tier: 'Silver' });
    const rejected = (readJson(join(b.artifacts, 'radar', 'rejected.json')) as { rejected: { id: string; reason: string }[] }).rejected;
    expect(rejected.map((r) => r.id)).toEqual(['B', 'C', 'D']);
    expect(rejected[0]!.reason).toBe('doublon (même lien)');
    expect(rejected[1]!.reason).toBe('déjà au tableau');
    expect(rejected[2]!.reason).toContain('Remote non établi');
    expect(String(out.summary)).toContain('2 qualified of 5 raw offer(s), 3 rejected');
    expect(String(out.summary)).toContain('Startup SaaS Co — Growth Marketing Specialist');
  });

  test('rien ne passe : go: false, ok: true ; raw.json absent : ok: false, fichiers quand même écrits', () => {
    const b = bench({});
    mkdirSync(join(b.artifacts, 'radar'));
    writeFileSync(join(b.artifacts, 'radar', 'raw.json'), JSON.stringify({ jobs: [job({ title: 'Senior Growth Lead' })] }));
    expect(runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/raw.json') }).out).toMatchObject({ ok: true, go: false, qualified_count: 0, rejected_count: 1 });
    const missing = runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/absent.json') }).out;
    expect(missing).toMatchObject({ ok: false, go: false, qualified_count: 0 });
    expect(String(missing.summary)).toContain('raw offers not found');
    expect(readJson(join(b.artifacts, 'radar', 'qualified.json'))).toMatchObject({ ok: false, qualified: [] });
  });

  test('âge : 7 jours par défaut, offre_age_max_jours de criteres.json sinon ; date illisible gardée', () => {
    const raw = { jobs: [
      job({ id: 'OLD', link: 'https://jobs.example/old', company: 'Old Co', date_published: daysAgo(10) }),
      job({ id: 'MID', link: 'https://jobs.example/mid', company: 'Mid Co', date_published: `il y a 4 jours` }),
      job({ id: 'NODATE', link: 'https://jobs.example/nodate', company: 'Nodate Co', date_published: '' }),
    ] };
    const b = bench({});
    mkdirSync(join(b.artifacts, 'radar'));
    writeFileSync(join(b.artifacts, 'radar', 'raw.json'), JSON.stringify(raw));
    const byDefault = runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/raw.json') }).out;
    expect(byDefault).toMatchObject({ ok: true, qualified_count: 2, rejected_count: 1 });
    expect(String(byDefault.summary)).toContain('offre trop ancienne ×1');
    expect(String(byDefault.summary)).toContain('offers older than 7 days rejected (default, no criteres.json)');
    const rejected = (readJson(join(b.artifacts, 'radar', 'rejected.json')) as { rejected: { id: string; reason: string }[] }).rejected;
    expect(rejected).toEqual([expect.objectContaining({ id: 'OLD', reason: `offre trop ancienne (publiée le ${daysAgo(10)}, > 7 jours)` })]);
    const qualified = (readJson(join(b.artifacts, 'radar', 'qualified.json')) as { qualified: Record<string, unknown>[] }).qualified;
    expect(qualified.find((q) => q.id === 'MID')).toMatchObject({ date_published: daysAgo(4), date_published_raw: 'il y a 4 jours' });

    writeFileSync(join(b.career, 'criteres.json'), JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, offre_age_max_jours: 3 }));
    const strict = runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/raw.json') }).out;
    expect(strict).toMatchObject({ ok: true, qualified_count: 1, rejected_count: 2 });
    expect(String(strict.summary)).toContain('offers older than 3 days rejected (offre_age_max_jours)');
    writeFileSync(join(b.career, 'criteres.json'), JSON.stringify({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: 0 }));
    expect(runScript('screen.ts', b, { INPUTS_RAW: pointer('radar/raw.json') }).out).toMatchObject({ ok: true, qualified_count: 3, rejected_count: 0 });
  });
});
