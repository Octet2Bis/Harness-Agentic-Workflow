import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type ImplementVerdict, type Lint, type Plan, type ReviewVerdict, decide } from './done.ts';

const plan: Plan = { summary: 'three tasks', tasks: 3, deliverable: { path: 'plan.md' } };
const green: ImplementVerdict = { ok: true, status: 'verified', summary: 'all tasks done' };
const lintOk: Lint = { ok: true, exit_code: 0, log: 'lint.log' };
const reviewOk: ReviewVerdict = { ok: true, status: 'verified', code_verdict: 'pass', summary: 'matches the plan' };
const go = { decision: 'approve' as const, text: '' };
const pr = { summary: 'draft PR #12', pr_url: 'https://github.com/example/repo/pull/12' };

// Chaque cas ci-dessous a un chemin réel : la fixture qui le joue est nommée dans le titre.
describe('done : chaque étape arrête la chaîne pour une raison nommée', () => {
  test('[shipped] tout vert, approuvé, PR ouverte : ok true, stage done', () => {
    expect(decide(plan, green, lintOk, reviewOk, go, pr)).toEqual({
      ok: true,
      stage: 'done',
      summary: 'Draft PR open: https://github.com/example/repo/pull/12. Review said pass: matches the plan',
      pr_url: 'https://github.com/example/repo/pull/12',
    });
  });

  test("[tests-never-green] implement unconverged : tests jamais verts ou tâches restantes, distinct d'une erreur", () => {
    const implement: ImplementVerdict = {
      ok: false,
      status: 'unconverged',
      summary: 'Checks still failing after 8 round(s). Tests: red; remaining tasks: 2. T2 done',
    };
    expect(decide(plan, implement, null, null, null, null)).toEqual({
      ok: false,
      stage: 'implement',
      summary:
        'Implementation did not converge (tests never went green or tasks were left): ' +
        'Checks still failing after 8 round(s). Tests: red; remaining tasks: 2. T2 done',
      pr_url: null,
    });
  });

  test("[review-unconverged] pas de review.json valide dans ses tours, distinct d'un refus du juge", () => {
    const review: ReviewVerdict = {
      ok: false,
      status: 'unconverged',
      code_verdict: 'unknown',
      summary: 'Checks still failing after 3 round(s); the judge did not run. one blocking defect',
    };
    expect(decide(plan, green, lintOk, review, null, null)).toEqual({
      ok: false,
      stage: 'review',
      summary:
        'Review did not converge (no valid review.json, so nothing reliable is said about the code): ' +
        'Checks still failing after 3 round(s); the judge did not run. one blocking defect',
      pr_url: null,
    });
  });

  test('unconverged : « did not converge » une fois, puis le résumé du bloc tel quel', () => {
    const implement: ImplementVerdict = { ok: false, status: 'unconverged', summary: 'Checks still failing after 8 round(s). Tests: red; remaining tasks: 1. T1' };
    const review: ReviewVerdict = { ok: false, status: 'unconverged', code_verdict: 'unknown', summary: 'Checks still failing after 3 round(s); the judge did not run. x' };
    for (const outcome of [decide(plan, implement, null, null, null, null), decide(plan, green, lintOk, review, null, null)]) {
      expect(outcome.summary.match(/converge/g)).toHaveLength(1);
      expect(outcome.summary.match(/Checks still failing after/g)).toHaveLength(1);
      expect(outcome.summary).not.toContain('last round');
    }
  });

  test('[review-refused] review rejected : contrôles verts, juge défavorable', () => {
    const review: ReviewVerdict = { ok: false, status: 'rejected', code_verdict: 'pass', summary: 'misses a test' };
    expect(decide(plan, green, lintOk, review, null, null)).toEqual({
      ok: false,
      stage: 'review',
      summary: 'Review not trustworthy: misses a test',
      pr_url: null,
    });
  });

  // Une erreur du modèle dans un bloc (une étape de sa boucle, ou le juge de `review`) fait
  // échouer ce nœud ; le verdict, en `none_failed_min_one_success`, est alors sauté et `done`
  // le lit `null` (`if_skipped: null`). Même mécanisme que la fixture `research-no-verdict`
  // de pipeline ; ici, la phrase de `done`.
  test('verdict null : un nœud du bloc a échoué, jamais « pas convergé »', () => {
    for (const [outcome, stage, block] of [
      [decide(plan, null, null, null, null, null), 'implement', 'Implementation'],
      [decide(plan, green, lintOk, null, null, null), 'review', 'Review'],
    ] as const) {
      expect(outcome.ok).toBe(false);
      expect(outcome.stage).toBe(stage);
      expect(outcome.summary).toBe(
        `${block} returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.`,
      );
      expect(outcome.summary).not.toContain('converge');
    }
  });

  test('[lint-failed] lint rouge : stage lint, la relecture ne compte pas', () => {
    expect(decide(plan, green, { ok: false, exit_code: 1, log: 'lint.log' }, null, null, null)).toEqual({
      ok: false,
      stage: 'lint',
      summary: "Lint failed (exit 1, output in lint.log in the run's artifacts); the review did not run.",
      pr_url: null,
    });
  });

  // `lint` a `on_timeout: skip` : un dépassement le saute, `done` le lit `null`.
  test('lint sauté sur dépassement (lu null) : stage lint', () => {
    expect(decide(plan, green, null, null, null, null)).toMatchObject({
      stage: 'lint',
      summary: 'Lint gave no result (timed out); the review did not run.',
    });
  });

  test('[plan-failed] plan en échec (relais sauté, lu null) : stage plan, rien en aval', () => {
    expect(decide(null, null, null, null, null, null)).toEqual({
      ok: false,
      stage: 'plan',
      summary: 'No plan: the plan step failed (a model or tool error), so nothing after it ran.',
      pr_url: null,
    });
  });

  test('[ship-failed] ship en échec après le « go » (relais sauté, lu null) : stage ship, pas de PR', () => {
    expect(decide(plan, green, lintOk, reviewOk, go, null)).toEqual({
      ok: false,
      stage: 'ship',
      summary:
        'Ship failed after the go (a model or tool error): no PR URL was recorded; check the branch before running it again, a commit or push may already exist.',
      pr_url: null,
    });
  });

  // `ship.md` rend `pr_url: null` quand rien n'est à publier ou que gh manque.
  test('ship sans PR (pr_url null) : stage ship', () => {
    expect(decide(plan, green, lintOk, reviewOk, go, { summary: 'nothing to publish', pr_url: null })).toEqual({
      ok: false,
      stage: 'ship',
      summary: 'Ship did not open a PR: nothing to publish',
      pr_url: null,
    });
  });
});

describe('done : le seul garde-fou fait échouer le nœud', () => {
  // Relecture `ok` sans réponse `approve` : le YAML l'interdit (`approve` tourne toujours
  // après une relecture `ok`, un refus annule le run par `drop`). Le script, lancé pour de
  // vrai, sort en échec sans rien rendre : pas d'issue inventée.
  test('relecture ok sans « go » : « done: unexpected state », code 1, rien sur stdout', () => {
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'done.ts')], {
      env: {
        ...process.env,
        INPUTS_PLAN: JSON.stringify(plan),
        INPUTS_IMPLEMENT: JSON.stringify(green),
        INPUTS_LINT: JSON.stringify(lintOk),
        INPUTS_REVIEW: JSON.stringify(reviewOk),
        INPUTS_APPROVE: JSON.stringify({ decision: 'reject', text: 'fix X' }),
        INPUTS_SHIP: 'null',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toBe('');
    expect(proc.stderr.toString()).toStartWith('done: unexpected state: the review passed but the human answer is {"decision":"reject","text":"fix X"}');
  });
});
