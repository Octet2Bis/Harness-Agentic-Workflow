/**
 * Un deuxième candidat : le même cockpit lancé sur un autre dossier carrière qui porte un
 * `candidat.json`. Il montre son nom, ne rafraîchit pas son tableau depuis la VM (celle-ci tient le
 * tableau d'origine), ignore les runs d'un autre dossier carrière (même au même slug, même en vol),
 * lance ses runs avec son propre profil de navigateur (HARNESS_BROWSER_PROFILE) et les note à part.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cockpit-candidat-'));
const career = join(root, 'Carriere-Camille');
const other = join(root, 'MasterPlan', 'career');
const harness = join(root, 'harness');
const statePath = join(root, 'fake-archon.json');
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = '';

beforeAll(async () => {
  mkdirSync(career, { recursive: true });
  mkdirSync(harness, { recursive: true });
  writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([{ slug: 'acme', company: 'Acme', title: 'Chargée de projet', link: '', status: 'VALIDATED' }]));
  writeFileSync(join(career, 'candidat.json'), JSON.stringify({ id: 'camille', nom: 'Camille', port: 8767 }));
  // Un run de l'autre candidat, au même slug, encore en vol : ni montré ni attendu ici.
  writeFileSync(statePath, JSON.stringify({ calls: [], runs: [{ id: 'other-acme', status: 'paused', workflow_name: 'career-apply', started_at: '2026-10-22T10:00:00Z', metadata: { inputs: { slug: 'acme', career_dir: other } }, nodes: [] }] }));
  proc = Bun.spawn(['bun', join(import.meta.dir, 'cockpit.ts'), '--career-dir', career, '--harness', harness, '--port', '0', '--no-open', '--archon', `bun ${join(import.meta.dir, 'test', 'fake-archon.ts')}`], {
    env: { ...process.env, FAKE_ARCHON_STATE: statePath, FAKE_ARCHON_ROOT: join(root, 'archon-home') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = proc.stdout.getReader();
  let text = '';
  while (!/Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`le cockpit s'est arrêté : ${text}\n${await new Response(proc.stderr).text()}`);
    text += new TextDecoder().decode(value);
  }
  base = /Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text)![1]!;
  reader.releaseLock();
});

afterAll(() => {
  proc?.kill();
  rmSync(root, { recursive: true, force: true });
});

const get = async (p: string): Promise<any> => (await fetch(base + p.replace(/^\//, ''))).json();
const post = async (p: string, body: unknown): Promise<any> => (await fetch(base + p.replace(/^\//, ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const fake = (): { runs: Record<string, unknown>[]; calls: string[][] } => JSON.parse(readFileSync(statePath, 'utf8'));

describe('cockpit d’un deuxième candidat', () => {
  test('son nom, son profil de navigateur, et pas de VM', async () => {
    const s = await get('/api/state');
    expect(s.candidate).toEqual({ id: 'camille', name: 'Camille' });
    expect(s.config.browserProfile).toBe(join(harness, '.local', 'browser-profile-camille'));
    expect(s.pull).toMatchObject({ command: '', every: 0 });
    const r = await post('/api/pull', {});
    expect(r.at).toBeNull();
    expect(r.output).toContain('ne vient pas de la VM');
  });

  test('le run de l’autre candidat au même slug n’est ni montré ni attendu', async () => {
    const s = await get('/api/state');
    expect(s.runs).toEqual({});
    expect(s.live).toEqual([]);
  });

  test('son run part tout de suite, avec son dossier carrière et son profil de navigateur, noté à part', async () => {
    const r = await post('/api/run', { slugs: ['acme'] });
    expect(r.added).toEqual(['acme']);
    const t0 = Date.now();
    while (!fake().runs.some((x) => x.id === 'run-acme')) {
      if (Date.now() - t0 > 8000) throw new Error('délai dépassé');
      await Bun.sleep(100);
    }
    const run = fake().runs.find((x) => x.id === 'run-acme')!;
    expect(run.browser_profile).toBe(join(harness, '.local', 'browser-profile-camille'));
    expect((run.metadata as any).inputs.career_dir).toBe(career);
    expect(JSON.parse(readFileSync(join(harness, '.local', 'cockpit', 'camille', 'launches.json'), 'utf8'))).toEqual({ acme: 'run-acme' });
    expect(existsSync(join(harness, '.local', 'cockpit', 'launches.json'))).toBe(false);
    const t1 = Date.now();
    while ((await get('/api/state')).runs.acme === undefined) {
      if (Date.now() - t1 > 8000) throw new Error('délai dépassé');
      await Bun.sleep(100);
    }
    expect((await get('/api/state')).runs.acme.id).toBe('run-acme');
  });
});
