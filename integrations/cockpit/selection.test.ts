import { describe, expect, test } from 'bun:test';
import type { PendingJob } from '../../.archon/workflows/systems/.shared/career.ts';
import type { TriageRecord } from '../../.archon/workflows/systems/.shared/triage.ts';
import {
  LAUNCH_TIMEOUT_MS, buildShortlist, coreBacked, coreFitOf, dayComplete, localDay, newDay, nextToJudge, proposedKeys, rankedPicks, readDay, readInboxAdds, readInboxAnswer, readSelectionConfig, selectionDue, staleForSelection, ukOnly,
} from './selection.ts';

const H = 'hash-actuel';
const NOW = new Date(2026, 10, 9, 9, 0, 0); // 9 novembre 2026, 9 h, heure du PC
const day = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const job = (id: string, over: Partial<PendingJob> = {}): PendingJob => ({ id, slug: id.toLowerCase(), company: `Société ${id}`, title: 'Growth Marketing Manager', link: `https://ex.com/${id}`, status: 'PENDING_VALIDATION', date_published: day(1), ...over });
const rec = (key: string, over: Partial<TriageRecord> = {}): TriageRecord => ({ key, id: key, slug: key.toLowerCase(), company: '', title: '', link: '', decision: 'retenue', reasons: ['Langues, salaire et mode de travail conformes à criteres.json'], notes: [], salary_annual_eur: null, languages_required: [], posting_full: true, block_status: 'local', attempts: 1, run_id: 'r', at: NOW.toISOString(), criteria_hash: H, ...over });
const core = (b: number, p: number, m: number): string => `Cœur du poste : ${b} exigence${b > 1 ? 's' : ''} étayée${b > 1 ? 's' : ''}, ${p} en partie, ${m} absente${m > 1 ? 's' : ''} du profil, sur 3`;
const cfg = readSelectionConfig({});

describe('réglages (selection.json)', () => {
  test('défauts : 2 par jour à 8 h, liste courte de 6, envoi verified-only, décideurs', () => {
    expect(cfg).toEqual({ enabled: true, perDay: 2, hour: 8, minute: 0, shortlistMax: 6, maxAgeDays: 7, mode: 'verified-only', verifiedPlatforms: '', contacts: true });
  });
  test('3 par jour au plus, heure HH:MM, mode connu, plateformes en liste', () => {
    expect(readSelectionConfig({ par_jour: 3, heure: '07:45', mode_envoi: 'auto', plateformes_verifiees: ['greenhouse', 'lever'], actif: false })).toMatchObject({ perDay: 3, hour: 7, minute: 45, mode: 'auto', verifiedPlatforms: 'greenhouse,lever', enabled: false });
    expect(() => readSelectionConfig({ par_jour: 4 })).toThrow('par_jour');
    expect(() => readSelectionConfig({ heure: '8h' })).toThrow('heure');
    expect(() => readSelectionConfig({ mode_envoi: 'vite' })).toThrow('mode_envoi');
    expect(() => readSelectionConfig({ plateformes_verifiees: 'greenhouse' })).toThrow('plateformes_verifiees');
  });
  test('l’heure du PC décide du jour et du départ', () => {
    expect(localDay(NOW)).toBe('2026-11-09');
    expect(selectionDue(cfg, NOW)).toBe(true);
    expect(selectionDue(cfg, new Date(2026, 10, 9, 7, 59))).toBe(false);
  });
});

describe('liste courte', () => {
  test('retenues sous les critères actuels, en attente, fraîches, jamais proposées ; Claude d’abord, puis la VM, puis les règles', () => {
    const jobs = [job('A'), job('B'), job('C'), job('D'), job('E', { status: 'APPLIED' }), job('F'), job('G', { date_published: day(10) }), job('H'), job('I')];
    const records = new Map<string, TriageRecord>([
      ['A', rec('A', { block_status: 'rules' })],
      ['B', rec('B')],
      ['C', rec('C', { block_status: 'verified' })],
      ['D', rec('D', { decision: 'ecartee' })],
      ['E', rec('E')],
      ['F', rec('F', { criteria_hash: 'vieux' })],
      ['G', rec('G')],
      ['H', rec('H', { salary_annual_eur: { min: 40000, max: 50000 } })],
      ['I', rec('I')],
    ]);
    // Le salaire affiché ne départage plus (Canonical, 2026-11-13) : à moteur égal, l'ordre du tableau (la fraîcheur) décide.
    expect(buildShortlist(jobs, records, H, new Set(['I']), cfg, NOW)).toEqual(['C', 'B', 'H', 'A']);
    expect(buildShortlist(jobs, records, H, new Set(), { ...cfg, shortlistMax: 2 }, NOW)).toEqual(['C', 'B']);
    expect(buildShortlist(jobs, records, H, new Set(), cfg, NOW, (j) => j.id !== 'H')).not.toContain('H');
  });
  test('trop vieille pour être proposée ; date illisible : gardée', () => {
    expect(staleForSelection(job('X', { date_published: day(8) }), NOW, 7)).toBe(true);
    expect(staleForSelection(job('X', { date_published: day(80), ajoutee_par: 'Antoine' }), NOW, 7)).toBe(false);
    expect(staleForSelection(job('X', { date_published: day(200), source: 'Tableaux employeurs (Greenhouse)' }), NOW, 7)).toBe(false);
    expect(staleForSelection(job('X', { date_published: day(8), source: 'LinkedIn (Live 24h)' }), NOW, 7)).toBe(true);
    expect(staleForSelection(job('X', { date_published: 'il y a 2 jours' }), NOW, 7)).toBe(false);
  });
});

describe('la journée', () => {
  const jobs = [job('A'), job('B'), job('C')];
  test('Claude juge une offre à la fois ; la journée se clôt avec les 2 meilleures, cœur du poste d’abord', () => {
    const d = newDay('2026-11-09', NOW, cfg, ['A', 'B', 'C']);
    const records = new Map<string, TriageRecord>([['A', rec('A')], ['B', rec('B')], ['C', rec('C')]]);
    expect(nextToJudge(d, records, H)).toBe('A');
    d.launched.push({ key: 'A', at: NOW.toISOString() });
    expect(nextToJudge(d, records, H)).toBe('B');
    expect(dayComplete(d, jobs, records, H, NOW)).toBe(false);
    records.set('A', rec('A', { block_status: 'verified', notes: [core(2, 1, 0)], at: new Date(NOW.getTime() + 60_000).toISOString() }));
    d.launched.push({ key: 'B', at: NOW.toISOString() });
    records.set('B', rec('B', { block_status: 'verified', decision: 'ecartee', at: new Date(NOW.getTime() + 60_000).toISOString() }));
    d.launched.push({ key: 'C', at: NOW.toISOString() });
    records.set('C', rec('C', { block_status: 'verified', notes: [core(3, 0, 0)], at: new Date(NOW.getTime() + 60_000).toISOString() }));
    expect(nextToJudge(d, records, H)).toBeNull();
    expect(dayComplete(d, jobs, records, H, NOW)).toBe(true);
    const picks = rankedPicks(d, jobs, records, H);
    expect(picks.map((p) => p.key)).toEqual(['C', 'A']);
    expect(picks[0]).toMatchObject({ slug: 'c', company: 'Société C', core: { backed: 3, partial: 0, missing: 0 } });
  });
  test('assez d’offres retenues : close avant la fin de la liste ; un tri sans verdict compte comme fait après le délai', () => {
    const d = newDay('2026-11-09', NOW, { ...cfg, perDay: 1 }, ['A', 'B']);
    const records = new Map<string, TriageRecord>([['A', rec('A', { block_status: 'verified' })], ['B', rec('B')]]);
    expect(dayComplete(d, jobs, records, H, NOW)).toBe(true);
    const d2 = newDay('2026-11-09', NOW, cfg, ['B']);
    d2.launched.push({ key: 'B', at: NOW.toISOString() });
    expect(dayComplete(d2, jobs, records, H, NOW)).toBe(false);
    expect(dayComplete(d2, jobs, records, H, new Date(NOW.getTime() + LAUNCH_TIMEOUT_MS + 1000))).toBe(true);
  });
  test('liste vide : journée « vide » d’emblée ; une offre proposée un jour ne revient pas', () => {
    expect(newDay('2026-11-09', NOW, cfg, [])).toMatchObject({ status: 'vide' });
    const d = newDay('2026-11-08', NOW, cfg, ['A']);
    d.picks = rankedPicks(d, jobs, new Map([['A', rec('A', { block_status: 'verified' })]]), H);
    expect([...proposedKeys([d])]).toEqual(['A']);
    expect(readDay(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(readDay({ date: 'x' })).toBeNull();
  });
});

describe('retour d’Antoine du 9 novembre (Forestry England, PLOS : non, non)', () => {
  test('Royaume-Uni seul : repéré ; Europe incluant le Royaume-Uni, Irlande : non', () => {
    expect(ukOnly(job('X', { location: 'Bristol, England, United Kingdom' }))).toBe(true);
    expect(ukOnly(job('X', { location: 'United Kingdom' }))).toBe(true);
    expect(ukOnly(job('X', { location: 'Remote', title: 'Growth Manager (UK)' }))).toBe(true);
    expect(ukOnly(job('X', { location: 'Remote', description: 'You must have the right to work in the UK.' }))).toBe(true);
    expect(ukOnly(job('X', { location: 'Remote (UK or EU)' }))).toBe(false);
    expect(ukOnly(job('X', { location: 'London, Paris or Berlin' }))).toBe(false);
    expect(ukOnly(job('X', { location: 'Dublin, Ireland' }))).toBe(false);
    expect(ukOnly(job('X', { location: 'Remote, EMEA' }))).toBe(false);
    expect(ukOnly(job('X', { location: 'Belfast, Northern Ireland' }))).toBe(true);
  });
  test('liste courte : hors Royaume-Uni d’abord, même déjà jugée par Claude', () => {
    const jobs = [job('U', { location: 'United Kingdom' }), job('N', { location: 'Netherlands' })];
    const records = new Map<string, TriageRecord>([['U', rec('U', { block_status: 'verified' })], ['N', rec('N')]]);
    expect(buildShortlist(jobs, records, H, new Set(), cfg, NOW)).toEqual(['N', 'U']);
  });
  test('liste courte : une offre déjà jugée par Claude à 0 exigence étayée n’y prend pas de place', () => {
    const jobs = [job('W'), job('K')];
    const records = new Map<string, TriageRecord>([['W', rec('W', { block_status: 'verified', notes: [core(0, 3, 0)] })], ['K', rec('K')]]);
    expect(buildShortlist(jobs, records, H, new Set(), cfg, NOW)).toEqual(['K']);
  });
  test('aucune exigence du cœur étayée : jamais proposée ; Royaume-Uni : une exigence étayée de moins', () => {
    expect(coreBacked(rec('A', { notes: [core(0, 3, 0)] }))).toBe(false);
    expect(coreBacked(rec('A', { notes: [core(1, 2, 0)] }))).toBe(true);
    const jobs = [job('F', { location: 'Bristol, England, United Kingdom' }), job('P', { location: 'United Kingdom' }), job('E', { location: 'Remote, Europe' }), job('L', { location: 'London' })];
    const v = (k: string, n: string): TriageRecord => rec(k, { block_status: 'verified', notes: [n] });
    const records = new Map<string, TriageRecord>([['F', v('F', core(0, 3, 0))], ['P', v('P', core(0, 2, 1))], ['E', v('E', core(1, 1, 1))], ['L', v('L', core(2, 0, 1))]]);
    const d = newDay('2026-11-09', NOW, cfg, ['F', 'P', 'E', 'L']);
    // E : 2 + 1 - 2 = 1 ; L : 4 - 2 - 2 (Royaume-Uni) = 0 ; F et P : écartées.
    expect(rankedPicks(d, jobs, records, H).map((p) => p.key)).toEqual(['E', 'L']);
    expect(dayComplete(d, jobs, records, H, NOW)).toBe(true);
  });
});

describe('boîte de réception (réponses d’Antoine)', () => {
  test('go ou non, clé et jour de la sélection', () => {
    expect(readInboxAnswer({ key: 'LI-42', date: '2026-11-09', decision: 'go', at: '2026-11-09T09:12:00Z' })).toMatchObject({ key: 'LI-42', decision: 'go', by: 'Antoine' });
    expect(() => readInboxAnswer({ key: '../x', date: '2026-11-09', decision: 'go' })).toThrow('key');
    expect(() => readInboxAnswer({ key: 'A', date: '2026-11-09', decision: 'oui' })).toThrow('decision');
    expect(() => readInboxAnswer({ key: 'A', decision: 'go' })).toThrow('date');
  });
});

test('coreFitOf lit la note du bloc', () => {
  expect(coreFitOf({ notes: ['x', core(1, 1, 1)] })).toEqual({ backed: 1, partial: 1, missing: 1 });
  expect(coreFitOf({ notes: [] })).toBeNull();
});

describe('inbox : demande d’ajout au tableau', () => {
  test('readInboxAdds lit les postes nommés, null pour une réponse oui/non, refuse une clé mal formée', () => {
    expect(readInboxAdds({ ajouter: [{ entreprise: 'greenhouse:canonical', poste: 'ATS-GR-8200686' }] })).toEqual({ items: [{ entreprise: 'greenhouse:canonical', poste: 'ATS-GR-8200686' }], by: 'Antoine' });
    expect(readInboxAdds({ key: 'X', date: '2026-11-13', decision: 'go' })).toBeNull();
    expect(() => readInboxAdds({ ajouter: [{ entreprise: 'canonical', poste: 'x' }] })).toThrow('ats:slug');
  });
});
