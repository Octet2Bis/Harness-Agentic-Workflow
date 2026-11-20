/**
 * `record` lancé pour de vrai sur un dossier carrière temporaire : ajout sous le verrou sans
 * toucher aux lignes existantes, tableau créé s'il manque, rapport et journal pour le cockpit,
 * idle et collecte en échec, tableau illisible (rien d'écrit, verrou rendu).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Bench, bench, cleanBenches, pointer, readJson, runScript } from './radar-test-helpers.ts';

afterEach(cleanBenches);

const collectOut = (over: Record<string, unknown> = {}): string => JSON.stringify({ ok: true, go: true, summary: 'collected', raw_count: 5, sources_ok: 2, sources_failed: 1, raw_path: { type: 'archon_artifact', run_id: 'R9', path: 'radar/raw.json' }, ...over });
const screenOut = (over: Record<string, unknown> = {}): string => JSON.stringify({ ok: true, go: true, summary: 'screened', qualified_count: 2, rejected_count: 3, qualified_path: { type: 'archon_artifact', run_id: 'R9', path: 'radar/qualified.json' }, ...over });
const q = (id: string, link: string, score: number): Record<string, unknown> => ({ id, slug: id.toLowerCase(), company: id, title: 'Growth Marketing Specialist', link, status: 'PENDING_VALIDATION', match_score: score, tier: 'Silver', is_startup: false, jury_verdict: 'ok', source: 'T' });
const sources = [{ name: 'Jobicy', status: 200, count: 4, duration_ms: 120 }, { name: 'Adzuna', status: 'clé absente (ADZUNA_APP_ID)', count: 0, duration_ms: 0 }];

function artifacts(b: Bench, qualified: Record<string, unknown>[]): void {
  mkdirSync(join(b.artifacts, 'radar'));
  writeFileSync(join(b.artifacts, 'radar', 'raw.json'), JSON.stringify({ jobs: [], sources }));
  writeFileSync(join(b.artifacts, 'radar', 'qualified.json'), JSON.stringify({ qualified }));
}
const board = (b: Bench): Record<string, unknown>[] => readJson(join(b.career, 'pending_gold_jobs.json')) as Record<string, unknown>[];
const report = (b: Bench): Record<string, unknown> => readJson(join(b.career, 'last_radar_report.json')) as Record<string, unknown>;

describe('record : le tableau et le rapport', () => {
  test('ajoute ce qui manque (lien), index après le plus grand, lignes existantes intactes ; rapport et journal écrits', () => {
    const existing = [
      { slug: 'old', company: 'Old', title: 't', link: 'https://jobs.example/OLD', status: 'VALIDATED', validated_at: 'v', index: 7, harness: { attempts: 1 } },
      { slug: 'two', company: 'Two', title: 't', link: 'https://jobs.example/2', status: 'APPLYING', applying: { run: 'L1', at: 'x' }, index: 2 },
    ];
    const b = bench({ board: existing });
    artifacts(b, [q('A', 'https://jobs.example/a', 80), q('B', 'https://jobs.example/old', 90)]);
    const { out } = runScript('record.ts', b, { INPUTS_COLLECT: collectOut(), INPUTS_SCREEN: screenOut() });
    expect(out).toMatchObject({ ok: true, added: 1, skipped: 1, report_path: join(b.career, 'last_radar_report.json') });
    expect(String(out.summary)).toContain('1 offer(s) added to the board (3 row(s) now), 1 already there : A — Growth Marketing Specialist (80)');
    const rows = board(b);
    expect(rows.slice(0, 2)).toEqual(existing);
    expect(rows[2]).toMatchObject({ id: 'A', slug: 'a', status: 'PENDING_VALIDATION', index: 8, radar: { run: 'R9' } });
    expect(existsSync(join(b.career, 'pending_gold_jobs.json.lock'))).toBe(false);
    expect(report(b)).toMatchObject({ run_id: 'R9', ok: true, raw_count: 5, qualified_count: 2, rejected_count: 3, added: 1, added_slugs: ['a'], skipped: 1, sources_ok: 1, sources_failed: 1, sources });
    const log = readFileSync(join(b.career, 'radar_log.jsonl'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!)).toMatchObject({ added: 1, added_slugs: ['a'] });
    expect(JSON.parse(log[0]!).sources).toBeUndefined();
  });

  test('tableau absent : créé avec les offres, index 1..n par score', () => {
    const b = bench({});
    artifacts(b, [q('A', 'https://x/a', 80), q('C', 'https://x/c', 95)]);
    const { out } = runScript('record.ts', b, { INPUTS_COLLECT: collectOut(), INPUTS_SCREEN: screenOut() });
    expect(out).toMatchObject({ ok: true, added: 2, skipped: 0 });
    expect(String(out.summary)).toContain('board created');
    expect(board(b).map((r) => [r.id, r.index])).toEqual([['C', 1], ['A', 2]]);
  });

  test('idle (screen sauté) et « rien de qualifié » : ok: true, rien d’ajouté, rapport écrit avec les comptes', () => {
    const b = bench({ board: [] });
    artifacts(b, []);
    const idle = runScript('record.ts', b, { INPUTS_COLLECT: collectOut({ go: false, raw_count: 0 }), INPUTS_SCREEN: 'null' }).out;
    expect(idle).toMatchObject({ ok: true, added: 0, skipped: 0 });
    expect(String(idle.summary)).toContain('nothing to screen');
    expect(report(b)).toMatchObject({ ok: true, raw_count: 0, qualified_count: 0, added: 0, added_slugs: [], sources_ok: 1 });
    const none = runScript('record.ts', b, { INPUTS_COLLECT: collectOut(), INPUTS_SCREEN: screenOut({ go: false, qualified_count: 0, rejected_count: 5 }) }).out;
    expect(none).toMatchObject({ ok: true, added: 0 });
    expect(String(none.summary)).toContain('nothing qualified');
    expect(report(b)).toMatchObject({ raw_count: 5, rejected_count: 5 });
    expect(board(b)).toEqual([]);
    expect(readFileSync(join(b.career, 'radar_log.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  test('collecte en échec : ok: false, rapport écrit si le dossier carrière existe, sinon rien (report_path vide)', () => {
    const b = bench({});
    const failed = runScript('record.ts', b, { INPUTS_COLLECT: collectOut({ ok: false, go: false, summary: 'career_taxonomy.json not found', raw_count: 0 }), INPUTS_SCREEN: 'null' }).out;
    expect(failed).toMatchObject({ ok: false, added: 0, skipped: 0, report_path: join(b.career, 'last_radar_report.json') });
    expect(String(failed.summary)).toContain('radar collect failed: career_taxonomy.json not found');
    expect(report(b)).toMatchObject({ ok: false, added: 0 });
    const nowhere = runScript('record.ts', b, { INPUTS_CAREER_DIR: '/stub/career', INPUTS_COLLECT: collectOut({ ok: false, go: false }), INPUTS_SCREEN: 'null' }).out;
    expect(nowhere).toMatchObject({ ok: false, added: 0, skipped: 0, report_path: '' });
    expect(String(nowhere.summary)).toContain('Report not written (career_dir not found)');
    expect(runScript('record.ts', b, { INPUTS_COLLECT: 'null', INPUTS_SCREEN: 'null' }).out).toMatchObject({ ok: false, added: 0 });
  });

  test('tableau illisible : ok: false, rien d’écrit, verrou rendu ; qualified.json absent : ok: false', () => {
    const b = bench({ board: '{ not json' });
    artifacts(b, [q('A', 'https://x/a', 80)]);
    const { out } = runScript('record.ts', b, { INPUTS_COLLECT: collectOut(), INPUTS_SCREEN: screenOut() });
    expect(out).toMatchObject({ ok: false, added: 0 });
    expect(String(out.summary)).toContain('board not updated');
    expect(readFileSync(join(b.career, 'pending_gold_jobs.json'), 'utf8')).toBe('{ not json');
    expect(existsSync(join(b.career, 'pending_gold_jobs.json.lock'))).toBe(false);
    expect(report(b)).toMatchObject({ ok: false });
    const gone = runScript('record.ts', b, { INPUTS_COLLECT: collectOut(), INPUTS_SCREEN: screenOut({ qualified_path: { type: 'archon_artifact', run_id: 'R9', path: 'radar/nope.json' } }) }).out;
    expect(String(gone.summary)).toContain('qualified offers not found');
  });
});
