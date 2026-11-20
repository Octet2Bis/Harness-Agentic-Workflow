/**
 * `check_prefill` lancé pour de vrai (sous-processus bun) sur des artefacts temporaires, comme
 * le moteur le lance : les liaisons arrivent bien aux règles (`.shared/submission-checks.ts`,
 * `.shared/platforms.ts`, testées à part). Une question sans réponse reste « à remplir par
 * Antoine » seulement si un go suit (même calcul que `gate`) ; une réponse libre vient du
 * fichier validé ; une page hors des hôtes autorisés rougit le contrôle, en français.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'check-prefill.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ANSWERS = '# Réponses\n\n## Prétentions salariales\nVariantes : Salary expectations\n45 000 € bruts annuels.\n';

function run(prefill: Record<string, unknown>, env: Record<string, string> = {}): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), 'check-prefill-test-'));
  dirs.push(root);
  const out = join(root, 'artifacts', 'submission');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'prefill.json'), JSON.stringify(prefill));
  writeFileSync(join(out, 'prefill.png'), 'png');
  writeFileSync(join(root, 'candidate.json'), JSON.stringify({ name: 'Jane Doe', email: 'jane@example.org', availability: 'Un mois' }));
  writeFileSync(join(root, 'reponses_formulaires.md'), ANSWERS);
  const proc = Bun.spawnSync(['bun', script], {
    env: {
      ...process.env,
      ARTIFACTS_DIR: join(root, 'artifacts'),
      INPUTS_OUT_DIR: 'submission',
      INPUTS_CANDIDATE: join(root, 'candidate.json'),
      INPUTS_METHOD: 'form',
      INPUTS_APPLY_URL: 'https://jobs.lever.co/acme/1',
      INPUTS_PLATFORM: 'lever',
      INPUTS_MODE: 'confirm',
      INPUTS_VERIFIED_PLATFORMS: '',
      INPUTS_CV: '/run/application/CV.pdf',
      INPUTS_PITCH: '',
      INPUTS_LETTER: '',
      INPUTS_PROFILE: '',
      INPUTS_ANSWERS_FILE: join(root, 'reponses_formulaires.md'),
      INPUTS_SUMMARY: 'stub: filled',
      INPUTS_BLOCKED: 'false',
      INPUTS_BLOCKER: '',
      INPUTS_TRIES: '',
      INPUTS_SUBMITTED_BEFORE: '',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
}

const form = {
  apply_url: 'https://jobs.lever.co/acme/1',
  final_url: 'https://jobs.lever.co/acme/1/apply',
  platform: 'lever',
  fields: [
    { label: 'Email', value: 'jane@example.org', source: 'candidate.email', kind: 'text', status: 'filled' },
    { label: 'Salary expectations', value: '45 000 € bruts annuels.', source: 'reponses_formulaires:Prétentions salariales', kind: 'free_text', status: 'filled' },
  ],
  attachments: [{ field: 'Resume/CV', file: '/run/application/CV.pdf', status: 'attached' }],
  unanswered: [{ label: 'Visa sponsorship?', reason: 'no source', required: true }],
  submit_control: { label: 'Submit application', visible: true, enabled: true },
  screenshot: 'prefill.png',
  blocked: false,
  blocker: '',
  submitted: false,
};

describe('check_prefill : liaisons → règles', () => {
  test('mode confirm : la réponse validée passe, la question sans réponse reste à Antoine, le récapitulatif suit le résumé', () => {
    const out = run(form);
    expect(out).toMatchObject({ ok: true, problems: [], filled: 2, attached: true, submitted_early: false, tries: 1 });
    expect(out.summary).toBe(
      'stub: filled\nRéponses libres : « Salary expectations » ← reponses_formulaires.md « Prétentions salariales ».\nÀ remplir par Antoine : « Visa sponsorship? » (obligatoire).'
    );
  });

  test('mode auto (aucun go ne suit) : la même question sans réponse rougit le formulaire', () => {
    const out = run(form, { INPUTS_MODE: 'auto' });
    expect(out.ok).toBe(false);
    expect(String((out.problems as string[])[0])).toStartWith('champs sans réponse : "Visa sponsorship?"');
  });

  test('verified-only, plateforme vérifiée : pas de go, donc rouge ; non vérifiée : go, donc vert', () => {
    expect(run(form, { INPUTS_MODE: 'verified-only', INPUTS_VERIFIED_PLATFORMS: 'lever' }).ok).toBe(false);
    expect(run(form, { INPUTS_MODE: 'verified-only', INPUTS_VERIFIED_PLATFORMS: 'greenhouse' }).ok).toBe(true);
  });

  test('une réponse retouchée, un formulaire sur un sosie : rouges, en français', () => {
    const edited = run({ ...form, fields: [form.fields[0], { ...form.fields[1], value: '50 000 €' }] });
    expect((edited.problems as string[]).some((p) => p.includes('diffère de la réponse validée « Prétentions salariales »'))).toBe(true);
    const foreign = run({ ...form, final_url: 'https://jobs.lever.co.evil.com/acme/1/apply' });
    expect(foreign.ok).toBe(false);
    expect((foreign.problems as string[])[0]).toStartWith('Le formulaire rempli (final_url de prefill.json) est sur « jobs.lever.co.evil.com »');
  });

  test('Workday rempli avec la session d’Antoine : vert comme un autre formulaire ; bloqué sans session : rouge (2026-10-24)', () => {
    const env = { INPUTS_APPLY_URL: 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/X_R1', INPUTS_PLATFORM: 'workday' };
    const out = run({ ...form, final_url: 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/X_R1/apply' }, env);
    expect(out.problems).toEqual([]);
    const blocked = run({ ...form, fields: [], blocked: true, blocker: 'Compte Acme à créer ou à ouvrir sur acme.wd3.myworkdayjobs.com dans le navigateur du robot, puis relancer', final_url: 'https://acme.wd3.myworkdayjobs.com/x/login' }, env);
    expect(blocked.ok).toBe(false);
    expect((blocked.problems as string[])[0]).toContain('navigateur du robot');
  });

  test('une lettre donnée mais pas jointe au champ prévu : rouge ; sans lettre, la même fiche passe', () => {
    const withUpload = { ...form, cover_letter_field: 'upload' };
    expect(run(withUpload).ok).toBe(true);
    const out = run(withUpload, { INPUTS_LETTER: '/run/application/lettre.pdf' });
    expect(out.ok).toBe(false);
    expect(out.problems).toContain("la lettre (lettre.pdf) n'est pas jointe au champ de lettre de motivation");
  });
});
