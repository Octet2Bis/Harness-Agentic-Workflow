/**
 * Le cycle du radar VM, de bout en bout et sans réseau : faux module réseau pour les sources
 * (fixtures de `.shared/radar/test/`), page d'annonce et faux Ollama servis en local. Les
 * vrais scripts de career-radar et career-triage tournent en sous-processus, comme sur la VM.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importOldBoard, importRemoteIndex, lastJson, parseArgs, pruneRuns, runCycle } from './radar-vm.ts';

const FIXTURES = join(import.meta.dir, '..', '..', '.archon', 'workflows', 'systems', '.shared', 'radar', 'test');
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  for (const s of servers) s.stop(true);
});
const servers: { stop: (force?: boolean) => void }[] = [];

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const POSTING = `<html><body><h1>Growth Marketing Manager</h1><p>${'You will own the growth of our product and run experiments with the team, build the lifecycle playbook and report to the CEO. '.repeat(14)}</p><p>This is a fully remote role. Fluent German is a must for this role.</p></body></html>`;

/** Page d'annonce et faux Ollama sur le même serveur local : le modèle répond « exigée » à la question de langue. */
function serve(): { url: string; asked: string[] } {
  const asked: string[] = [];
  const s = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/api/tags') return Response.json({ models: [{ name: 'qwen2.5:7b-instruct-q4_0' }] });
      if (u.pathname === '/api/generate') {
        const body = (await req.json()) as { prompt: string };
        asked.push(body.prompt.split('\n')[2] ?? '');
        const answer = body.prompt.includes('LANGUAGE') ? { answer: 'required' } : { answer: 'not_stated', sentence: 0 };
        return Response.json({ response: JSON.stringify(answer) });
      }
      if (u.pathname === '/job') return new Response(POSTING, { headers: { 'content-type': 'text/html' } });
      return new Response('', { status: 404 });
    },
  });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, asked };
}

function bench(board: unknown[]): { root: string; career: string; fake: string } {
  const root = mkdtempSync(join(tmpdir(), 'radar-vm-'));
  roots.push(root);
  const career = join(root, 'career');
  mkdirSync(career);
  writeFileSync(join(career, 'career_taxonomy.json'), JSON.stringify({ version: 'test', target_experience: { min_years: 1, max_years: 3, disqualified_labels: ['senior'] }, search_queries: ['growth marketing manager'] }));
  writeFileSync(join(career, 'job_sources.json'), JSON.stringify({ version: 'test', sources: [{ name: 'Jobicy (jobicy.com)', type: 'jobicy', endpoint: 'https://jobicy.com/api/v2/remote-jobs', enabled: true }] }));
  writeFileSync(join(career, 'criteres.json'), JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 28000, salaire_inconnu: 'garder', remote: 'full', experience_max_annees: 4, offre_age_max_jours: 7 }));
  writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify(board, null, 2));
  const fake = join(root, 'fake-fetch.cjs');
  writeFileSync(fake, `
const fs = require('node:fs'); const path = require('node:path');
const TODAY = new Date().toISOString().slice(0, 10);
async function fetchUrl(url) {
  if (url.includes('jobicy')) return { status: 200, data: fs.readFileSync(path.join(${JSON.stringify(FIXTURES)}, 'jobicy.json'), 'utf8').replace(/2026-10-2[123]/g, TODAY) };
  return { status: 503, data: '' };
}
async function request() { return { status: 500, data: '' }; }
module.exports = { fetchUrl, request };
`);
  return { root, career, fake };
}

describe('radar-vm', () => {
  test('options : --career obligatoire, chemins en ~, défauts de la VM', () => {
    expect(() => parseArgs([])).toThrow('--career');
    const o = parseArgs(['--career', '~/radar-unifie/career'], { HOME: '/home/ubuntu' });
    expect(o.career).toBe('/home/ubuntu/radar-unifie/career');
    expect(o.work).toBe('/home/ubuntu/radar-unifie/runs');
    expect(o).toMatchObject({ maxTriage: 15, budgetMin: 12, model: 'qwen2.5:7b-instruct-q4_0', linkedin: true });
  });
  test('lastJson : la dernière ligne JSON de la sortie', () => {
    expect(lastJson('log\n{"a":1}\n{"b":2}\n')).toEqual({ b: 2 });
    expect(lastJson('rien')).toBeNull();
  });
  test('ancien tableau : ses offres nouvelles entrent, il n\'est jamais écrit', () => {
    const b = bench([{ id: 'A', slug: 'a', company: 'A', title: 't', link: 'https://a', status: 'PENDING_VALIDATION' }]);
    const old = join(b.root, 'old.json');
    const content = JSON.stringify([{ id: 'A', slug: 'a', company: 'A', title: 't', link: 'https://a', status: 'PENDING_VALIDATION' }, { id: 'B', slug: 'b', company: 'B', title: 't', link: 'https://b', status: 'PENDING_VALIDATION' }]);
    writeFileSync(old, content);
    expect(importOldBoard(b.career, old).imported).toBe(1);
    expect(readFileSync(old, 'utf8')).toBe(content);
    expect(JSON.parse(readFileSync(join(b.career, 'pending_gold_jobs.json'), 'utf8')).map((j: { id: string }) => j.id)).toEqual(['A', 'B']);
    expect(importOldBoard(b.career, join(b.root, 'absent.json')).note).toBe('ancien tableau absent');
  });
  test('index des entreprises remote de l\'ancien radar : recopié quand il change, l\'original jamais écrit', () => {
    const b = bench([]);
    const old = join(b.root, 'old.json');
    writeFileSync(old, '[]');
    expect(importRemoteIndex(b.career, old)).toBe('index des entreprises remote absent');
    const index = JSON.stringify([{ id: 'posthog', name: 'PostHog', careers_url: 'https://posthog.com/careers' }]);
    writeFileSync(join(b.root, 'verified_remote_companies.json'), index);
    expect(importRemoteIndex(b.career, old)).toBe('index des entreprises remote recopié');
    expect(readFileSync(join(b.career, 'verified_remote_companies.json'), 'utf8')).toBe(index);
    expect(importRemoteIndex(b.career, old)).toBe('index des entreprises remote inchangé');
    expect(readFileSync(join(b.root, 'verified_remote_companies.json'), 'utf8')).toBe(index);
    expect(importRemoteIndex(b.career, '')).toBe('pas d\'ancien radar');
  });
  test('un cycle : relève, tri local de l\'offre (allemand exigé → écartée), annonce et questions gardées, état écrit', async () => {
    const srv = serve();
    const b = bench([{ id: 'LI-1', slug: 'acme', company: 'Acme', title: 'Growth Marketing Manager', link: `${srv.url}/job`, status: 'PENDING_VALIDATION', date_published: yesterday, source: 'LinkedIn' }]);
    const o = parseArgs(['--career', b.career, '--fetch-module', b.fake, '--ollama', srv.url, '--max-triage', '1', '--no-linkedin']);
    const r = await runCycle(o);
    expect(r.errors).toEqual([]);
    expect(r.radar.sources_ok + r.radar.sources_failed).toBeGreaterThan(0);
    expect(r.triage).toHaveLength(1);
    expect(r.triage[0]).toMatchObject({ key: 'LI-1', decision: 'ecartee', block_status: 'local' });
    const rec = JSON.parse(readFileSync(join(b.career, 'triage', 'LI-1.json'), 'utf8'));
    expect(rec).toMatchObject({ decision: 'ecartee', block_status: 'local' });
    expect(rec.reasons.join(' ')).toContain("l'allemand");
    expect(readFileSync(join(b.career, 'postings', 'LI-1.txt'), 'utf8')).toContain('Fluent German is a must');
    expect(JSON.parse(readFileSync(join(b.career, 'triage_local', 'LI-1.json'), 'utf8')).questions.length).toBeGreaterThan(0);
    expect(srv.asked.some((q) => q.includes('LANGUAGE'))).toBe(true);
    const status = JSON.parse(readFileSync(join(b.career, 'vm_radar_status.json'), 'utf8'));
    expect(status.run_id).toBe(r.run_id);
    expect(r.triage_stop).toContain('plafond');
  }, 60_000);
  test('Ollama injoignable : le tri retombe sur les règles, block_status rules', async () => {
    const srv = serve();
    const b = bench([{ id: 'LI-2', slug: 'beta', company: 'Beta', title: 'Growth Marketing Manager', link: `${srv.url}/job`, status: 'PENDING_VALIDATION', date_published: yesterday, source: 'LinkedIn' }]);
    const o = parseArgs(['--career', b.career, '--fetch-module', b.fake, '--ollama', 'http://127.0.0.1:9', '--no-linkedin']);
    const r = await runCycle(o);
    expect(r.triage[0]).toMatchObject({ key: 'LI-2', block_status: 'rules' });
    expect(r.triage_stop).toContain('modèle local injoignable');
    expect(r.errors).toEqual([]);
    const rec = JSON.parse(readFileSync(join(b.career, 'triage', 'LI-2.json'), 'utf8'));
    expect(rec.notes.join(' ')).toContain('Tri local impossible');
  }, 60_000);
  test('annonce illisible : triée une fois par cycle, sans bloquer les autres offres (CapsLock, 2026-11-11)', async () => {
    const srv = serve();
    const b = bench([
      { id: 'JDL-1', slug: 'capslock', company: 'CapsLock', title: 'Creative Marketing Project Coordinator', link: `${srv.url}/vide`, status: 'PENDING_VALIDATION', date_published: new Date().toISOString().slice(0, 10), source: 'Jobdatalake' },
      { id: 'LI-3', slug: 'gamma', company: 'Gamma', title: 'Growth Marketing Manager', link: `${srv.url}/job`, status: 'PENDING_VALIDATION', date_published: yesterday, source: 'LinkedIn' },
    ]);
    const o = parseArgs(['--career', b.career, '--fetch-module', b.fake, '--ollama', srv.url, '--max-triage', '5', '--no-linkedin']);
    const r = await runCycle(o);
    expect(r.errors).toEqual([]);
    expect(r.triage.map((t) => [t.key, t.block_status])).toEqual([['JDL-1', 'unreadable'], ['LI-3', 'local']]);
    expect(r.triage_stop).toBe('plus rien à trier');
    // Au cycle suivant, l'annonce illisible est retentée (une fois).
    const r2 = await runCycle(o);
    expect(r2.errors).toEqual([]);
    expect(r2.triage.map((t) => t.key)).toEqual(['JDL-1']);
  }, 90_000);
  test('les vieux cycles sont effacés au-delà de keep', () => {
    const w = mkdtempSync(join(tmpdir(), 'radar-vm-runs-'));
    roots.push(w);
    for (const d of ['vm-1', 'vm-2', 'vm-3']) mkdirSync(join(w, d));
    pruneRuns(w, 2);
    expect(['vm-1', 'vm-2', 'vm-3'].filter((d) => existsSync(join(w, d)))).toHaveLength(2);
  });
});
