import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Verdict, decide } from './done.ts';

const verified = (summary: string, path: string): Verdict => ({ ok: true, status: 'verified', summary, deliverable: { path } });
const rejected = (summary: string, path: string): Verdict => ({ ok: false, status: 'rejected', summary, deliverable: { path } });
const unconverged = (rounds: number, summary: string, path: string): Verdict => ({
  ok: false,
  status: 'unconverged',
  summary: `Checks still failing after ${rounds} round(s); the judge did not run. ${summary}`,
  deliverable: { path },
});
const research = verified('R ok', 'research.md');
const report = verified('Rep ok', 'report.md');

// Chaque cas a un chemin réel : la fixture qui le joue est nommée dans le titre ; sinon le
// commentaire dit ce qui le rend possible.
describe('done : chaque bloc arrête la chaîne pour une raison nommée', () => {
  test('[approved] tout ok et approuvé : ok true, stage done', () => {
    expect(decide(research, report, { decision: 'approve', text: '' })).toEqual({
      ok: true,
      stage: 'done',
      summary: 'Approved at final review. Rep ok',
      deliverables: { research: 'research.md', report: 'report.md' },
    });
  });

  test("[research-unconverged] pas convergé, distinct d'un refus du juge", () => {
    expect(decide(unconverged(4, 'two sources', 'research.md'), null, null)).toEqual({
      ok: false,
      stage: 'research',
      summary: 'Research did not converge: Checks still failing after 4 round(s); the judge did not run. two sources',
      deliverables: { research: 'research.md', report: null },
    });
  });

  // La boucle de report est plafonnée à 3 tours : le même verdict `unconverged` une fois
  // research `ok`.
  test('report unconverged : stage report, les deux livrables nommés', () => {
    const outcome = decide(research, unconverged(3, 'too long', 'report.md'), null);
    expect(outcome.stage).toBe('report');
    expect(outcome.summary).toBe('Report did not converge: Checks still failing after 3 round(s); the judge did not run. too long');
    expect(outcome.deliverables).toEqual({ research: 'research.md', report: 'report.md' });
  });

  test('unconverged : le constat « checks still failing » une seule fois, celui du bloc', () => {
    for (const outcome of [decide(unconverged(4, 'a', 'research.md'), null, null), decide(research, unconverged(3, 'b', 'report.md'), null)]) {
      expect(outcome.summary.match(/checks still failing/gi)).toHaveLength(1);
      expect(outcome.summary).not.toContain('last round');
    }
  });

  test('[research-rejected, report-rejected] le juge a refusé', () => {
    expect(decide(rejected('no source', 'research.md'), null, null)).toEqual({
      ok: false,
      stage: 'research',
      summary: 'Research rejected: no source',
      deliverables: { research: 'research.md', report: null },
    });
    expect(decide(research, rejected('unfaithful', 'report.md'), null)).toEqual({
      ok: false,
      stage: 'report',
      summary: 'Report rejected: unfaithful',
      deliverables: { research: 'research.md', report: 'report.md' },
    });
  });

  // [research-no-verdict] pour research ; pour report, le même saut du verdict
  // (`none_failed_min_one_success`) sur une erreur de son juge ou de sa boucle.
  test('verdict null : un nœud a échoué, jamais « pas convergé »', () => {
    for (const [outcome, block] of [
      [decide(null, null, null), 'Research'],
      [decide(research, null, null), 'Report'],
    ] as const) {
      expect(outcome.ok).toBe(false);
      expect(outcome.stage).toBe(block.toLowerCase());
      expect(outcome.summary).toBe(
        `${block} returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.`,
      );
      expect(outcome.summary).not.toContain('converge');
    }
  });
});

describe('done : le seul garde-fou fait échouer le nœud', () => {
  // Deux blocs `ok` sans « go » : le YAML l'interdit (`review` tourne toujours après un
  // rapport `ok`, un refus annule le run par `drop`). Le script, lancé pour de vrai, sort en
  // échec sans rien rendre : pas d'issue inventée.
  test('blocs ok sans « go » : « done: unexpected state », code 1, rien sur stdout', () => {
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'done.ts')], {
      env: {
        ...process.env,
        INPUTS_RESEARCH: JSON.stringify(research),
        INPUTS_REPORT: JSON.stringify(report),
        INPUTS_REVIEW: JSON.stringify({ decision: 'reject', text: 'budget' }),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toBe('');
    expect(proc.stderr.toString()).toStartWith(
      'done: unexpected state: both blocks passed but the final review answer is {"decision":"reject","text":"budget"}',
    );
  });
});
