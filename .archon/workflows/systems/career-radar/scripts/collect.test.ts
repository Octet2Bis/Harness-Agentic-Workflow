/**
 * `collect` lancé pour de vrai (sous-processus bun) sur un dossier carrière temporaire, avec
 * un faux réseau (`CAREER_RADAR_FETCH_MODULE`) : sources du candidat ou fichier par défaut,
 * filtre `sources`, liens connus du tableau, taxonomie obligatoire, chaîne des clés sans fuite.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Bench, bench, callsOf, cleanBenches, readJson, runScript } from './radar-test-helpers.ts';

afterEach(cleanBenches);

const twoSources = {
  version: 'test-sources',
  sources: [
    { name: 'Growth.Talent', type: 'api_json', endpoint: 'https://www.growthtalent.org/api/v1/jobs', enabled: true },
    { name: 'Jobicy', type: 'api_json', endpoint: 'https://jobicy.com/api/v2/remote-jobs', enabled: true },
    { name: 'Himalayas Remote', type: 'api_json', endpoint: 'https://himalayas.app/jobs/api', enabled: false },
  ],
};
const raw = (b: Bench): { jobs: Record<string, unknown>[]; sources: { name: string; status: unknown }[]; ok: boolean } => readJson(join(b.artifacts, 'radar', 'raw.json')) as never;

describe('collect : les offres brutes du candidat', () => {
  test('job_sources.json du candidat : les sources actives sont appelées, raw.json écrit, le tableau donne les liens connus', () => {
    const b = bench({ sources: twoSources, board: [{ slug: 'yubo', company: 'Yubo', title: 't', link: 'https://www.growthtalent.org/jobs/yubo-1', status: 'PENDING_VALIDATION' }] });
    const { out, stdout } = runScript('collect.ts', b, {});
    expect(out).toMatchObject({ ok: true, go: true, sources_ok: 2, sources_failed: 0, raw_path: { type: 'archon_artifact', run_id: 'R9', path: 'radar/raw.json' } });
    expect(Number(out.raw_count)).toBeGreaterThanOrEqual(2);
    const data = raw(b);
    expect(data.jobs).toHaveLength(Number(out.raw_count));
    expect(new Set(data.jobs.map((j) => j.source))).toEqual(new Set(['Growth.Talent', 'Jobicy (jobicy.com)']));
    expect(data.sources.map((s) => s.name).sort()).toEqual(['Growth.Talent', 'Jobicy']);
    const calls = callsOf(b);
    expect(calls.some((u) => u.includes('growthtalent')) && calls.some((u) => u.includes('jobicy'))).toBe(true);
    expect(calls.some((u) => u.includes('himalayas') || u.includes('linkedin'))).toBe(false);
    expect(String(out.summary)).toContain('job_sources.json (test-sources)');
    expect(String(out.summary)).toContain('1 link(s) already on the board');
    expect(String(out.summary)).toContain('keys from process.env only');
    expect(stdout.trim().split('\n')).toHaveLength(1);
  });

  test('entrée `sources` : seule la source nommée tourne (les autres passent enabled: false), un nom inconnu est signalé', () => {
    const b = bench({ sources: twoSources });
    const { out } = runScript('collect.ts', b, { INPUTS_SOURCES: 'jobicy, monster' });
    expect(out).toMatchObject({ ok: true, go: true, sources_ok: 1 });
    expect(raw(b).sources.map((s) => s.name)).toEqual(['Jobicy']);
    expect(callsOf(b).every((u) => u.includes('jobicy'))).toBe(true);
    expect(String(out.summary)).toContain('selected: Jobicy ; unknown: monster');
  });

  test('sans job_sources.json : le fichier par défaut du système (2.2.0), dit dans le résumé ; LinkedIn jamais appelé sans CAREER_LINKEDIN=on ; une source muette → go: false, ok: true', () => {
    const b = bench({});
    const { out } = runScript('collect.ts', b, {});
    expect(out).toMatchObject({ ok: true, go: true }); // Growth.Talent et Jobicy du fichier par défaut répondent (faux réseau)
    expect(String(out.summary)).toContain("the system's job_sources.default.json (2.2.0)");
    const silent = runScript('collect.ts', b, { INPUTS_SOURCES: 'himalayas' }).out;
    expect(silent).toMatchObject({ ok: true, go: false, raw_count: 0, sources_ok: 0, sources_failed: 1 });
    expect(String(silent.summary)).toContain('nothing to screen');
    const data = raw(b);
    expect(data.sources.map((s) => s.name)).toEqual(['Himalayas']); // le dernier run : une seule source
    const fresh = bench({}); // un dossier neuf : la cadence posée par le premier run ne joue pas
    const first = runScript('collect.ts', fresh, {}).out;
    const all = raw(fresh);
    expect(callsOf(fresh).some((u) => u.includes('linkedin.com'))).toBe(false);
    expect(all.sources.length).toBeGreaterThanOrEqual(10);
    expect(all.sources.some((s) => s.name === 'LinkedIn')).toBe(false);
    expect(callsOf(b).some((u) => u.includes('linkedin.com'))).toBe(false);
    expect(all.sources.find((s) => s.name === 'Apify ATS')?.status).toBe('clé absente (APIFY_TOKEN)');
    expect(all.sources.find((s) => s.name === 'JSearch')).toBeUndefined(); // enabled: false dans la 2.2.0
    expect(Number(first.sources_failed)).toBeGreaterThan(0);
    // La cadence a été posée dans source_state.json du dossier carrière (jamais de secret dedans).
    expect(existsSync(join(b.career, 'source_state.json'))).toBe(true);
  });

  test('career_taxonomy.json absent : ok: false, raw.json quand même écrit (le pointeur rendu nomme un fichier qui existe)', () => {
    const b = bench({ taxonomy: false, sources: twoSources });
    const { out } = runScript('collect.ts', b, {});
    expect(out).toMatchObject({ ok: false, go: false, raw_count: 0, sources_ok: 0 });
    expect(String(out.summary)).toContain('career_taxonomy.json not found');
    expect(raw(b)).toMatchObject({ ok: false, jobs: [] });
    expect(callsOf(b)).toEqual([]);
    const missing = runScript('collect.ts', b, { INPUTS_CAREER_DIR: join(b.root, 'nope') }).out;
    expect(missing.ok).toBe(false);
    expect(String(missing.summary)).toContain('career_dir not found');
  });

  test('env_file : les clés sont lues par nom et servent la source ; aucune valeur de clé, aucun chemin d’env dans la sortie ni dans raw.json', () => {
    const b = bench({});
    const envFile = join(b.root, 'my.env');
    writeFileSync(envFile, 'ADZUNA_APP_ID=id-test-value\nADZUNA_APP_KEY="key-test-value"\nTELEGRAM_BOT_TOKEN_PRO=never-read\n');
    const { out, stdout } = runScript('collect.ts', b, { INPUTS_SOURCES: 'adzuna', INPUTS_ENV_FILE: envFile });
    expect(out).toMatchObject({ ok: true, go: false });
    expect(String(out.summary)).toContain('keys from process.env then 1 env file(s)');
    // La clé a bien atteint le connecteur : l'appel est parti (faux réseau : 500), pas « clé absente ».
    expect(raw(b).sources.find((s) => s.name === 'Adzuna')?.status).toBe(500);
    expect(callsOf(b).some((u) => u.includes('adzuna') && u.includes('key-test-value'))).toBe(true);
    const everything = `${stdout}${JSON.stringify(raw(b))}`;
    expect(everything).not.toContain('key-test-value');
    expect(everything).not.toContain('id-test-value');
    expect(everything).not.toContain('my.env');
    // env_file inexistant : process.env seulement, dit sans nommer le chemin.
    const none = runScript('collect.ts', b, { INPUTS_SOURCES: 'adzuna', INPUTS_ENV_FILE: join(b.root, 'absent.env') }).out;
    expect(String(none.summary)).toContain('env_file not found: keys from process.env only');
    expect(String(none.summary)).not.toContain('absent.env');
  });
});
