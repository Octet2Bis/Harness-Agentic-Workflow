import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Verdict, decide } from './done.ts';

const verified = (summary: string, path: string): Verdict => ({ ok: true, status: 'verified', summary, deliverable: { path } });
const rejected = (summary: string, path: string): Verdict => ({ ok: false, status: 'rejected', summary, deliverable: { path } });
// `rounds` : le plafond de la boucle du bloc (research 4, design 3, report 3).
const unconverged = (rounds: number, summary: string, path: string): Verdict => ({
  ok: false,
  status: 'unconverged',
  summary: `Checks still failing after ${rounds} round(s); the judge did not run. ${summary}`,
  deliverable: { path },
});
const research = verified('R ok', 'research.md');
const design = verified('D ok', 'design.md');
const report = verified('Rep ok', 'report.md');

// Chaque cas a un chemin réel : la fixture qui le joue est nommée dans le titre ; sinon le
// commentaire dit ce qui le rend possible.
describe('done : chaque bloc arrête la chaîne pour une raison nommée', () => {
  test('[approved] tout ok et approuvé : ok true, stage done', () => {
    expect(decide(research, design, report, { decision: 'approve', text: '' })).toEqual({
      ok: true,
      stage: 'done',
      summary: 'Approved at final review. Rep ok',
      deliverables: { research: 'research.md', design: 'design.md', report: 'report.md' },
    });
  });

  test("[research-unconverged] le bloc n'a pas convergé, distinct d'un refus du juge", () => {
    expect(decide(unconverged(4, 'two sources', 'research.md'), null, null, null)).toEqual({
      ok: false,
      stage: 'research',
      summary: 'Research did not converge: Checks still failing after 4 round(s); the judge did not run. two sources',
      deliverables: { research: 'research.md', design: null, report: null },
    });
  });

  // Chaque bloc a sa boucle plafonnée (design et report à 3 tours) : le même verdict
  // `unconverged` peut venir de design ou de report, une fois le bloc précédent `ok`.
  test('unconverged sur design puis sur report : le stage reste celui du bloc', () => {
    const d = decide(research, unconverged(3, 'no option', 'design.md'), null, null);
    expect(d.stage).toBe('design');
    expect(d.summary).toBe('Design did not converge: Checks still failing after 3 round(s); the judge did not run. no option');
    const r = decide(research, design, unconverged(3, 'too long', 'report.md'), null);
    expect(r.stage).toBe('report');
    expect(r.summary).toBe('Report did not converge: Checks still failing after 3 round(s); the judge did not run. too long');
    expect(r.deliverables).toEqual({ research: 'research.md', design: 'design.md', report: 'report.md' });
  });

  test('unconverged : le constat « checks still failing » une seule fois, celui du bloc', () => {
    for (const outcome of [
      decide(unconverged(4, 'a', 'research.md'), null, null, null),
      decide(research, unconverged(3, 'b', 'design.md'), null, null),
      decide(research, design, unconverged(3, 'c', 'report.md'), null),
    ]) {
      expect(outcome.summary.match(/checks still failing/gi)).toHaveLength(1);
      expect(outcome.summary).not.toContain('last round');
    }
  });

  test('[research-rejected, design-rejected, report-rejected] le juge a refusé', () => {
    expect(decide(rejected('no source', 'research.md'), null, null, null).summary).toBe('Research rejected: no source');
    expect(decide(research, rejected('weak option', 'design.md'), null, null)).toEqual({
      ok: false,
      stage: 'design',
      summary: 'Design rejected: weak option',
      deliverables: { research: 'research.md', design: 'design.md', report: null },
    });
    expect(decide(research, design, rejected('unfaithful', 'report.md'), null)).toEqual({
      ok: false,
      stage: 'report',
      summary: 'Report rejected: unfaithful',
      deliverables: { research: 'research.md', design: 'design.md', report: 'report.md' },
    });
  });

  // [research-no-verdict] pour research ; pour design et report, le même saut du verdict
  // (`none_failed_min_one_success`) sur une erreur de leur juge ou de leur boucle.
  test('verdict null : un nœud a échoué, jamais « pas convergé »', () => {
    for (const [outcome, block] of [
      [decide(null, null, null, null), 'Research'],
      [decide(research, null, null, null), 'Design'],
      [decide(research, design, null, null), 'Report'],
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
  // Trois blocs `ok` sans « go » : le YAML l'interdit (`review` tourne toujours après un
  // rapport `ok`, un refus annule le run par `drop`). Le script, lancé pour de vrai, sort en
  // échec sans rien rendre : pas d'issue inventée.
  test('blocs ok sans « go » : « done: unexpected state », code 1, rien sur stdout', () => {
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'done.ts')], {
      env: {
        ...process.env,
        INPUTS_RESEARCH: JSON.stringify(research),
        INPUTS_DESIGN: JSON.stringify(design),
        INPUTS_REPORT: JSON.stringify(report),
        INPUTS_REVIEW: 'null',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toBe('');
    expect(proc.stderr.toString()).toStartWith('done: unexpected state: the three blocks passed but the final review answer is null');
  });
});
