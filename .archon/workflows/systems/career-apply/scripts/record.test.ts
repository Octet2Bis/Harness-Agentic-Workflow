/**
 * `record` lancé pour de vrai (sous-processus bun) sur un dossier carrière temporaire : le
 * statut s'écrit avant les copies, une copie impossible (fichier verrouillé sous Windows,
 * simulé ici par un dossier à la place du fichier) n'empêche ni l'écriture du statut ni la
 * sortie typée, et `mayRecord` garde une offre qui n'est plus celle de cette prise.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'record.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(job: Record<string, unknown>): { root: string; artifacts: string; career: string } {
  const root = mkdtempSync(join(tmpdir(), 'record-test-'));
  dirs.push(root);
  const artifacts = join(root, 'artifacts');
  const career = join(root, 'career');
  mkdirSync(join(artifacts, 'application'), { recursive: true });
  mkdirSync(join(artifacts, 'submission'), { recursive: true });
  mkdirSync(career, { recursive: true });
  for (const name of ['CV.md', 'CV.pdf', 'pitch.md']) writeFileSync(join(artifacts, 'application', name), name);
  writeFileSync(join(artifacts, 'application', 'candidate.json'), '{}');
  writeFileSync(join(artifacts, 'submission', 'receipt.json'), JSON.stringify({ submitted: true }));
  writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([{ slug: 'acme', company: 'Acme', title: 't', link: '', validated_at: 'v', ...job }]));
  return { root, artifacts, career };
}

function runRecord(artifacts: string, career: string, submit: Record<string, unknown>, claimRun = 'L1', env: Record<string, string> = {}): Record<string, unknown> {
  const ok = JSON.stringify({ ok: true, summary: 's' });
  const proc = Bun.spawnSync(['bun', script], {
    env: {
      ...process.env,
      ARTIFACTS_DIR: artifacts,
      WORKFLOW_ID: 'A1',
      INPUTS_SLUG: 'acme',
      INPUTS_CAREER_DIR: career,
      INPUTS_CLAIM_RUN: claimRun,
      INPUTS_LOAD: ok,
      INPUTS_CV: JSON.stringify({ ok: true, status: 'verified', summary: 'CV ok', problems: [], findings: [], revised: false }),
      INPUTS_RENDER: ok,
      INPUTS_ROUTE: ok,
      INPUTS_SUBMIT: JSON.stringify(submit),
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
}

const board = (career: string): Record<string, unknown>[] => JSON.parse(readFileSync(join(career, 'pending_gold_jobs.json'), 'utf8')) as Record<string, unknown>[];
const sent = { ok: true, status: 'verified', submitted: true, summary: 'Application sent and confirmed.' };

describe('record : le statut d’abord, les copies ensuite, aucune exception', () => {
  test('PDF verrouillé dans applications/ : APPLIED écrit quand même, la copie ratée citée dans le résumé', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'L1', at: '2026-10-20T10:00:00Z' } });
    // Un dossier à la place du fichier : copyFileSync échoue comme sur un PDF ouvert sous Windows.
    mkdirSync(join(career, 'applications', 'acme', 'CV_Candidat_acme.pdf'), { recursive: true });
    const out = runRecord(artifacts, career, sent);
    expect(out).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED', status_written: true });
    expect(String(out.summary)).toContain('Not done: copy to applications/acme/CV_Candidat_acme.pdf failed');
    expect(out.copied).toContain('CV_Candidat_acme.md');
    expect(out.copied).not.toContain('CV_Candidat_acme.pdf');
    expect(board(career)[0]).toMatchObject({ status: 'APPLIED', validated_at: 'v', harness: { run: 'A1', stage: 'done' } });
    expect(board(career)[0].applying).toBeUndefined();
  });

  test('journal illisible (un dossier à sa place) : le statut est écrit, l’erreur citée', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    mkdirSync(join(career, 'applications_log.csv'));
    const out = runRecord(artifacts, career, sent);
    expect(out).toMatchObject({ status: 'APPLIED', status_written: true });
    expect(String(out.summary)).toContain('applications_log.csv could not be written');
  });

  test('offre APPLIED par un run plus récent : le refus au go de ce run ne la rétrograde pas', () => {
    const { artifacts, career } = setup({ status: 'APPLIED', harness: { run: 'A2', stage: 'done', at: 'x' } });
    const out = runRecord(artifacts, career, { ok: false, status: 'refused', submitted: false, summary: 'Refused at the go: nothing was sent.' });
    expect(out).toMatchObject({ status: 'TAILORED', status_written: false });
    expect(String(out.summary)).toContain('left as APPLIED');
    expect(board(career)[0].status).toBe('APPLIED');
  });

  test('pending_gold_jobs.json illisible : status_written: false, sortie typée, et l’issue sauvée d’abord dans record.json (le filet l’écrira)', () => {
    const { artifacts, career } = setup({ status: 'APPLYING' });
    writeFileSync(join(career, 'pending_gold_jobs.json'), '{broken');
    const out = runRecord(artifacts, career, sent);
    expect(out).toMatchObject({ status: 'APPLIED', status_written: false });
    expect(String(out.summary)).toContain('could not be written');
    expect(JSON.parse(readFileSync(join(artifacts, 'record.json'), 'utf8'))).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED', claim_run: 'L1' });
  });

  test('lancé à la main : load a pris l’offre pour ce run (claim_run = ce run), record écrit comme pour le listener', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'A1', at: '2026-10-20T10:00:00Z', artifacts: '/a' } });
    const out = runRecord(artifacts, career, sent, 'A1');
    expect(out).toMatchObject({ status: 'APPLIED', status_written: true });
    expect(board(career)[0]).toMatchObject({ status: 'APPLIED', harness: { run: 'A1', stage: 'done' } });
    expect(board(career)[0].applying).toBeUndefined();
  });

  test('lancé à la main sur une offre PENDING_VALIDATION, CV non produit : record lui rend son statut d’avant, et le contrat du nœud l’accepte (premier run réel, 2026-10-22)', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', validated_at: null, applying: { run: 'A1', at: '2026-10-22T13:00:00Z', artifacts: '/a', from: 'PENDING_VALIDATION' } });
    // tailor__verdict sauté (un de ses nœuds a échoué) : `cv` rend `status: none`, lu comme "null".
    const out = runRecord(artifacts, career, {}, 'A1', { INPUTS_CV: JSON.stringify({ ok: false, status: 'none', summary: 'cv-tailor returned no verdict.', problems: [], findings: [], revised: false }), INPUTS_RENDER: 'null', INPUTS_ROUTE: 'null', INPUTS_SUBMIT: 'null' });
    expect(out).toMatchObject({ ok: false, stage: 'tailor', status: 'PENDING_VALIDATION', status_written: true });
    expect(board(career)[0]).toMatchObject({ status: 'PENDING_VALIDATION', validated_at: null, harness: { run: 'A1', stage: 'tailor', from: 'PENDING_VALIDATION' } });
    // Le contrat déclaré dans career-apply.yaml accepte ce statut : une énumération l'a refusé une fois.
    const doc = Bun.YAML.parse(readFileSync(join(import.meta.dir, '..', 'career-apply.yaml'), 'utf8')) as { nodes: { id: string; output_format?: { properties?: Record<string, { enum?: string[]; pattern?: string }> } }[] };
    const status = doc.nodes.find((n) => n.id === 'record')?.output_format?.properties?.status;
    expect(status).toBeDefined();
    expect(status?.enum).toBeUndefined();
    expect(new RegExp(status?.pattern ?? '^$').test(String(out.status))).toBe(true);
  });

  test('`cv` sauté (liaison "null") : comme un bloc sans verdict, VALIDATED au stage tailor', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    const out = runRecord(artifacts, career, {}, 'L1', { INPUTS_CV: 'null', INPUTS_RENDER: 'null', INPUTS_ROUTE: 'null', INPUTS_SUBMIT: 'null' });
    expect(out).toMatchObject({ ok: false, stage: 'tailor', status: 'VALIDATED', status_written: true });
    expect(String(out.summary)).toContain('returned no verdict');
  });

  test('dossier issu de la ronde de révision (revised: true) : l’envoi s’écrit comme avant, le résumé dit « après révision »', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    const out = runRecord(artifacts, career, sent, 'L1', { INPUTS_CV: JSON.stringify({ ok: true, status: 'verified', summary: 'CV ok. Reviewer: A — honest', problems: [], findings: [], revised: true }) });
    expect(out).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED', status_written: true });
    expect(String(out.summary)).toContain('après révision');
    expect(out.copied).toContain('CV_Candidat_acme.md');
    // Second refus du Reviewer : VALIDATED au stage tailor, « après révision » dans le résumé, rien copié.
    const twice = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    const again = runRecord(twice.artifacts, twice.career, {}, 'L1', { INPUTS_CV: JSON.stringify({ ok: false, status: 'rejected', summary: 'Reviewer: B — still copied', problems: [], findings: [{ severity: 'blocking', text: 'copied' }], revised: true }), INPUTS_RENDER: 'null', INPUTS_ROUTE: 'null', INPUTS_SUBMIT: 'null' });
    expect(again).toMatchObject({ ok: false, stage: 'tailor', status: 'VALIDATED', status_written: true, copied: [] });
    expect(String(again.summary)).toContain('CV rejected après révision: Reviewer: B — still copied');
  });

  test('lettre (letter_pick) : vérifiée après révision, recopiée ; encore refusée, jamais recopiée, le CV part seul', () => {
    const letterFiles = (artifacts: string): void => {
      writeFileSync(join(artifacts, 'application', 'letter.md'), 'letter');
      writeFileSync(join(artifacts, 'application', 'letter.pdf'), 'pdf');
    };
    const ok = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    letterFiles(ok.artifacts);
    const verified = runRecord(ok.artifacts, ok.career, sent, 'L1', { INPUTS_LETTER: JSON.stringify({ ok: true, status: 'verified', summary: 'Reviewer: A-', problems: [], findings: [], revised: true }) });
    expect(verified).toMatchObject({ ok: true, status: 'APPLIED' });
    expect(verified.copied).toContain('Lettre_Candidat_acme.md');
    expect(verified.copied).toContain('Lettre_Candidat_acme.pdf');
    expect(String(verified.summary)).toContain('Letter: verified, second version');
    const ko = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    letterFiles(ko.artifacts);
    const rejected = runRecord(ko.artifacts, ko.career, sent, 'L1', { INPUTS_LETTER: JSON.stringify({ ok: false, status: 'rejected', summary: 'Reviewer: B+ — generic', problems: [], findings: [], revised: true }) });
    expect(rejected).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED', status_written: true });
    expect(rejected.copied).toContain('CV_Candidat_acme.md');
    expect(rejected.copied).not.toContain('Lettre_Candidat_acme.md');
    expect(rejected.copied).not.toContain('Lettre_Candidat_acme.pdf');
    expect(String(rejected.summary)).toContain('Letter rejected après révision (not attached)');
  });

  test('sans prise (load a refusé l’offre : claim_run vide) : rien ne s’écrit', () => {
    const { artifacts, career } = setup({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } });
    const out = runRecord(artifacts, career, sent, '');
    expect(out).toMatchObject({ status_written: false });
    expect(String(out.summary)).toContain('holds no claim');
    expect(board(career)[0].status).toBe('APPLYING');
  });
});
