import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criteriaHash, type TriageRecord } from '../../.archon/workflows/systems/.shared/triage.ts';
import { vmRadarAlive } from '../cockpit/lib.ts';
import { mergeRadarVm, mergeRemoteFile, vmTriageWins } from './merge_radar_vm.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const CRITERIA = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 28000 });
const H = criteriaHash(CRITERIA);
const rec = (over: Partial<TriageRecord>): TriageRecord => ({ key: 'K', id: 'K', slug: 'k', company: 'C', title: 'T', link: '', decision: 'retenue', reasons: [], notes: [], salary_annual_eur: null, languages_required: [], posting_full: true, block_status: 'rules', attempts: 1, run_id: 'r', at: '2026-11-08T10:00:00Z', criteria_hash: H, ...over });

describe('vmTriageWins', () => {
  test('le tri local de la VM remplace un tri par règles du PC, jamais un tri de Claude', () => {
    expect(vmTriageWins(null, rec({ block_status: 'local' }), H)).toBe(true);
    expect(vmTriageWins(rec({ block_status: 'rules' }), rec({ block_status: 'local' }), H)).toBe(true);
    expect(vmTriageWins(rec({ block_status: 'verified' }), rec({ block_status: 'local', at: '2026-11-09T00:00:00Z' }), H)).toBe(false);
    expect(vmTriageWins(rec({ block_status: 'local' }), rec({ block_status: 'rules', at: '2026-11-09T00:00:00Z' }), H)).toBe(false);
    // Un tri de Claude « à vérifier » (juge défavorable, boucle non convergée) n'est pas remplacé non plus : il serait repayé.
    expect(vmTriageWins(rec({ block_status: 'rejected', decision: 'a_verifier' }), rec({ block_status: 'local', at: '2026-11-09T00:00:00Z' }), H)).toBe(false);
    expect(vmTriageWins(rec({ block_status: 'unconverged', decision: 'a_verifier' }), rec({ block_status: 'local', at: '2026-11-09T00:00:00Z' }), H)).toBe(false);
    expect(vmTriageWins(rec({ block_status: 'unreadable', decision: 'a_verifier' }), rec({ block_status: 'local' }), H)).toBe(true);
  });
  test('critères : un tri de la VM sous d\'anciens critères ne remplace rien ; un tri du PC sous d\'anciens critères est remplacé', () => {
    expect(vmTriageWins(rec({}), rec({ block_status: 'local', criteria_hash: 'vieux' }), H)).toBe(false);
    expect(vmTriageWins(null, rec({ block_status: 'local', criteria_hash: 'vieux' }), H)).toBe(true);
    expect(vmTriageWins(rec({ block_status: 'verified', criteria_hash: 'vieux' }), rec({ block_status: 'local' }), H)).toBe(true);
  });
});

describe('mergeRadarVm', () => {
  test('tableau fusionné offre par offre, tris, annonces et état rapatriés', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-radar-vm-'));
    roots.push(root);
    const pc = join(root, 'pc');
    const vm = join(root, 'vm');
    for (const d of [pc, join(pc, 'triage'), vm, join(vm, 'triage'), join(vm, 'postings'), join(vm, 'triage_local')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(pc, 'criteres.json'), CRITERIA);
    writeFileSync(join(pc, 'pending_gold_jobs.json'), JSON.stringify([{ id: 'A', slug: 'a', company: 'A', title: 't', link: 'https://a', status: 'APPLIED' }]));
    writeFileSync(join(vm, 'pending_gold_jobs.json'), JSON.stringify([{ id: 'A', slug: 'a', company: 'A', title: 't', link: 'https://a', status: 'PENDING_VALIDATION' }, { id: 'B', slug: 'b', company: 'B', title: 't', link: 'https://b', status: 'PENDING_VALIDATION' }]));
    writeFileSync(join(pc, 'triage', 'A.json'), JSON.stringify(rec({ key: 'A', block_status: 'verified' })));
    writeFileSync(join(vm, 'triage', 'A.json'), JSON.stringify(rec({ key: 'A', block_status: 'local', decision: 'ecartee' })));
    writeFileSync(join(vm, 'triage', 'B.json'), JSON.stringify(rec({ key: 'B', block_status: 'local' })));
    writeFileSync(join(vm, 'postings', 'B.txt'), 'annonce B');
    writeFileSync(join(vm, 'triage_local', 'B.json'), '{"questions":[]}');
    writeFileSync(join(vm, 'vm_radar_status.json'), JSON.stringify({ at: new Date().toISOString() }));
    const r = mergeRadarVm(pc, vm);
    expect(r.board).toEqual({ before: 1, after: 2 });
    const board = JSON.parse(readFileSync(join(pc, 'pending_gold_jobs.json'), 'utf8'));
    expect(board.find((j: { id: string }) => j.id === 'A').status).toBe('APPLIED');
    expect(r.triage).toEqual({ copied: 1, kept: 1 });
    expect(JSON.parse(readFileSync(join(pc, 'triage', 'A.json'), 'utf8')).block_status).toBe('verified');
    expect(JSON.parse(readFileSync(join(pc, 'triage', 'B.json'), 'utf8')).block_status).toBe('local');
    expect(readFileSync(join(pc, 'postings', 'B.txt'), 'utf8')).toBe('annonce B');
    expect(r).toMatchObject({ postings: 1, questions: 1, status: true });
    expect(mergeRadarVm(pc, vm)).toMatchObject({ postings: 0, questions: 0 });
  });

  test('entreprises full remote : la VM fait foi, sauf une entreprise relue par le PC après le cycle de la VM', () => {
    const vmFile = { _meta: { at: '2026-11-08T12:00:00Z' }, companies: { 'ashby:posthog': { name: 'PostHog', last_read: '2026-11-08T11:00:00Z' } } };
    const pcFile = { _meta: { at: '2026-11-08T13:00:00Z' }, companies: { 'ashby:posthog': { name: 'vieux', last_read: '2026-11-08T05:00:00Z' }, 'lever:old': { last_read: '2026-11-07T05:00:00Z' }, 'greenhouse:pc': { last_read: '2026-11-08T12:30:00Z' } } };
    expect(Object.keys(mergeRemoteFile(pcFile, vmFile).companies ?? {}).sort()).toEqual(['ashby:posthog', 'greenhouse:pc']);
    expect(mergeRemoteFile(pcFile, vmFile).companies?.['ashby:posthog']?.name).toBe('PostHog');
    const root = mkdtempSync(join(tmpdir(), 'merge-radar-vm-'));
    roots.push(root);
    const pc = join(root, 'pc');
    const vm = join(root, 'vm');
    for (const d of [pc, vm]) mkdirSync(d, { recursive: true });
    writeFileSync(join(vm, 'remote_companies.json'), JSON.stringify(vmFile));
    writeFileSync(join(vm, 'remote_company_jobs.json'), JSON.stringify({ _meta: vmFile._meta, companies: { 'ashby:posthog': { read_at: '2026-11-08T11:00:00Z', jobs: [{ id: 'ATS-AS-ph1' }], others: 0 } } }));
    expect(mergeRadarVm(pc, vm).remoteCompanies).toBe(1);
    expect(JSON.parse(readFileSync(join(pc, 'remote_company_jobs.json'), 'utf8')).companies['ashby:posthog'].jobs[0].id).toBe('ATS-AS-ph1');
  });
});

describe('mergeRadarVm : signaux d’entreprises', () => {
  test('la VM fait foi, tes avis du PC ne sont pas touchés, un fichier illisible est ignoré', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-radar-vm-'));
    roots.push(root);
    const pc = join(root, 'pc');
    const vm = join(root, 'vm');
    for (const d of [pc, vm]) mkdirSync(d, { recursive: true });
    writeFileSync(join(pc, 'signals_feedback.json'), '{"verdicts":{"qonto":"bon"}}');
    writeFileSync(join(pc, 'company_signals.json'), '{"companies":{}}');
    writeFileSync(join(vm, 'company_signals.json'), '{"_meta":{"at":"2026-11-14T02:00:00Z"},"companies":{"qonto":{"name":"Qonto"}}}');
    writeFileSync(join(vm, 'signals_status.json'), '{oups');
    expect(mergeRadarVm(pc, vm).signals).toBe(true);
    expect(JSON.parse(readFileSync(join(pc, 'company_signals.json'), 'utf8')).companies.qonto.name).toBe('Qonto');
    expect(readFileSync(join(pc, 'signals_feedback.json'), 'utf8')).toBe('{"verdicts":{"qonto":"bon"}}');
    expect(() => readFileSync(join(pc, 'signals_status.json'), 'utf8')).toThrow();
    expect(mergeRadarVm(pc, vm).signals).toBeUndefined();
  });
});

describe('vmRadarAlive (cockpit)', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  test('vivant sous une heure, sinon le PC reprend la relève', () => {
    expect(vmRadarAlive({ at: '2026-11-08T11:50:00Z' }, now)).toMatchObject({ alive: true });
    expect(vmRadarAlive({ at: '2026-11-08T10:00:00Z' }, now)).toMatchObject({ alive: false });
    expect(vmRadarAlive(null, now)).toMatchObject({ alive: false, reason: 'pas de radar sur la VM' });
  });
});
