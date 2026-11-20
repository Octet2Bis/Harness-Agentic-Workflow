/**
 * La sélection du jour dans le vrai cockpit (sous-processus) contre le faux Archon : à l'heure dite,
 * la liste courte part une offre à la fois en career-triage moteur llm, la journée se clôt avec la
 * meilleure (par_jour 1), et un oui déposé dans inbox/ met l'offre en file career-apply avec le mode
 * d'envoi de selection.json ; un non est seulement noté. Sans selection.json, rien de tout ça.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criteriaHash } from '../../.archon/workflows/systems/.shared/triage.ts';
import { localDay } from './selection.ts';

const root = mkdtempSync(join(tmpdir(), 'cockpit-selection-'));
const career = join(root, 'career');
const harness = join(root, 'harness');
const statePath = join(root, 'fake-archon.json');
const criteria = JSON.stringify({ langues: ['français', 'anglais'], salaire_min_annuel: 28000 });
const H = criteriaHash(criteria);
const today = new Date().toISOString().slice(0, 10);
let proc: ReturnType<typeof Bun.spawn> | null = null;

const rec = (key: string) => ({ key, id: key, slug: key.toLowerCase(), company: key, title: 'Growth', link: '', decision: 'retenue', reasons: [], notes: [], salary_annual_eur: null, languages_required: [], posting_full: true, block_status: 'local', attempts: 1, run_id: 'vm', at: new Date(Date.now() - 3_600_000).toISOString(), criteria_hash: H });

beforeAll(async () => {
  mkdirSync(join(career, 'triage'), { recursive: true });
  mkdirSync(harness, { recursive: true });
  writeFileSync(join(career, 'criteres.json'), criteria);
  writeFileSync(join(career, 'selection.json'), JSON.stringify({ par_jour: 1, heure: '00:00', liste_courte: 2, mode_envoi: 'verified-only', plateformes_verifiees: ['greenhouse'] }));
  writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([
    { id: 'A', slug: 'alpha', company: 'Alpha', title: 'Growth Marketing Manager', link: 'https://alpha.example/job', status: 'PENDING_VALIDATION', date_published: today, location: 'Remote - Europe' },
    { id: 'B', slug: 'beta', company: 'Beta', title: 'Growth Marketing Manager', link: 'https://beta.example/job', status: 'PENDING_VALIDATION', date_published: today, location: 'Remote - Europe' },
    { id: 'C', slug: 'gamma', company: 'Gamma', title: 'Growth Marketing Manager', link: 'https://gamma.example/job', status: 'APPLIED', date_published: today },
  ]));
  for (const k of ['A', 'B']) writeFileSync(join(career, 'triage', `${k}.json`), JSON.stringify(rec(k)));
  writeFileSync(statePath, JSON.stringify({ runs: [], calls: [] }));
  proc = Bun.spawn(['bun', join(import.meta.dir, 'cockpit.ts'), '--career-dir', career, '--harness', harness, '--port', '0', '--no-open', '--no-toast', '--archon', `bun ${join(import.meta.dir, 'test', 'fake-archon.ts')}`, '--pull', `bun ${join(import.meta.dir, 'test', 'fake-pull.ts')}`, '--pull-every', '0', '--no-radar'], {
    env: { ...process.env, FAKE_ARCHON_STATE: statePath, FAKE_ARCHON_ROOT: join(root, 'archon-home'), FAKE_PULL_BOARD: join(career, 'pending_gold_jobs.json'), FAKE_PULL_COUNT: join(root, 'pulls.txt'), FAKE_PULL_FAIL_FILE: join(root, 'pull-fails'), FAKE_TRIAGE_HASH: H, COCKPIT_SELECTION_TICK_MS: '300' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
});

afterAll(() => {
  proc?.kill();
  rmSync(root, { recursive: true, force: true });
});

const calls = (): string[][] => (JSON.parse(readFileSync(statePath, 'utf8')) as { calls: string[][] }).calls;
const dayFile = (): any => JSON.parse(readFileSync(join(career, 'selection', `${localDay(new Date())}.json`), 'utf8'));
const until = async (pred: () => boolean, ms = 20_000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await Bun.sleep(100);
  }
};

test('liste courte → Claude sur une offre → journée prête → oui → career-apply en verified-only', async () => {
  await until(() => existsSync(join(career, 'selection', `${localDay(new Date())}.json`)) && dayFile().status === 'prete');
  const day = dayFile();
  expect(day.shortlist.sort()).toEqual(['A', 'B']);
  expect(day.picks).toHaveLength(1);
  const picked = day.picks[0].key as string;
  const tri = calls().filter((c) => c[2] === 'career-triage');
  // Une seule offre jugée par Claude : par_jour 1 atteint, la seconde ne coûte rien.
  expect(tri).toHaveLength(1);
  expect(tri[0]).toContain('engine=llm');
  expect(tri[0]).toContain(`key=${picked}`);
  mkdirSync(join(career, 'inbox'), { recursive: true });
  writeFileSync(join(career, 'inbox', `${picked}.json`), JSON.stringify({ key: picked, date: day.date, decision: 'go', by: 'Antoine', at: new Date().toISOString() }));
  await until(() => calls().some((c) => c[2] === 'career-apply'));
  const apply = calls().find((c) => c[2] === 'career-apply')!;
  expect(apply).toContain(`slug=${picked === 'A' ? 'alpha' : 'beta'}`);
  expect(apply).toContain('mode=verified-only');
  expect(apply).toContain('verified_platforms=greenhouse');
  await until(() => dayFile().answers[picked]?.queued === true);
  expect(existsSync(join(career, 'inbox', 'lus', `${picked}.json`))).toBe(true);
  // Une réponse pour une offre hors de la sélection est refusée, jamais lancée.
  writeFileSync(join(career, 'inbox', 'X.json'), JSON.stringify({ key: 'C', date: day.date, decision: 'go' }));
  await until(() => existsSync(join(career, 'inbox', 'refuses', 'X.json')));
  expect(calls().filter((c) => c[2] === 'career-apply')).toHaveLength(1);
}, 40_000);
