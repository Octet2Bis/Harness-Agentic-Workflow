import { describe, expect, test } from 'bun:test';
import { buildRecord } from './record.ts';

const load = {
  ok: true, go: true, summary: 's', key: 'LI-1', criteria_hash: 'h', posting_full: 'true', attempts: 1,
  offer_json: JSON.stringify({ id: 'LI-1', slug: 'smartness', company: 'Smartness', title: 'Sales Ops', link: 'https://x' }),
};

describe('career-triage record', () => {
  test('un tri vérifié garde les chiffres de decision.json', () => {
    const r = buildRecord(load, { decision: 'ecartee', reasons: ["Exige l'italien"], notes: [], block_status: 'verified' }, { salary_annual_eur: { min: 38000, max: 45000 }, languages_required: ['en', 'it'] }, 'run-1', new Date('2026-10-22T18:00:00Z'));
    expect(r).toMatchObject({ key: 'LI-1', slug: 'smartness', decision: 'ecartee', languages_required: ['en', 'it'], attempts: 2, posting_full: true, at: '2026-10-22T18:00:00.000Z' });
    expect(r.salary_annual_eur).toEqual({ min: 38000, max: 45000 });
  });
  test('un tri non vérifié ne garde aucun chiffre', () => {
    const r = buildRecord({ ...load, attempts: 0, posting_full: 'false' }, { decision: 'a_verifier', reasons: ['juge'], notes: [], block_status: 'rejected' }, { salary_annual_eur: { min: 1, max: 1 }, languages_required: ['it'] }, 'run-2', new Date());
    expect(r.salary_annual_eur).toBeNull();
    expect(r.languages_required).toEqual([]);
    expect(r.attempts).toBe(1);
    expect(r.posting_full).toBe(false);
  });
});
