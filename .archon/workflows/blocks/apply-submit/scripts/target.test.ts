/**
 * `target` lancé pour de vrai (sous-processus bun), comme le moteur le lance : le contrat de
 * sortie que lisent `prefill` et `submit`. Les règles elles-mêmes sont dans
 * `.shared/platforms.test.ts` et `.shared/submission-checks.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const script = join(import.meta.dir, 'target.ts');

function runTarget(env: Record<string, string>): Record<string, unknown> {
  const proc = Bun.spawnSync(['bun', script], { env: { ...process.env, INPUTS_PLATFORM: '', INPUTS_LETTER: '', ...env }, stdout: 'pipe', stderr: 'pipe' });
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
}

describe('target : le formulaire, ses hôtes, la lettre', () => {
  test('Greenhouse avec une lettre : la page embed/job_app, les hôtes Greenhouse, la version texte de la lettre', () => {
    expect(runTarget({ INPUTS_APPLY_URL: 'https://boards.greenhouse.io/acme/jobs/4567', INPUTS_PLATFORM: 'greenhouse', INPUTS_LETTER: '/run/application/lettre.pdf' })).toEqual({
      platform: 'greenhouse',
      form_url: 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4567',
      needs_login: false,
      handover: false,
      how: "Greenhouse : le formulaire de l'annonce vit souvent dans un iframe ; on ouvre directement sa page embed/job_app, au premier plan.",
      hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io'],
      letter: '/run/application/lettre.pdf',
      letter_text: '/run/application/lettre.md',
    });
  });

  test('Workday sans lettre : la session du navigateur du robot ; lettre et version texte vides', () => {
    const out = runTarget({ INPUTS_APPLY_URL: 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/Growth_R1' });
    expect(out).toMatchObject({ platform: 'workday', needs_login: true, handover: false, letter: '', letter_text: '' });
  });

  test('un sosie en URL de candidature : rien à ouvrir, son hôte jamais autorisé', () => {
    const out = runTarget({ INPUTS_APPLY_URL: 'https://jobs.lever.co@evil.com/acme/1', INPUTS_PLATFORM: 'lever' });
    expect(out.form_url).toBe('');
    expect(out.hosts).toEqual(['jobs.lever.co', 'jobs.eu.lever.co']);
  });
});
