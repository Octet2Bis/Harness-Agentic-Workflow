/**
 * `revise-brief` lancé pour de vrai (sous-processus bun) : la copie de la première version
 * dans `application-v1/`, le dossier entier pour cv-tailor, letter.md et letter.html seuls
 * pour cover-letter, même quand `application-v1/` tient déjà la première version du CV.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dir, 'revise-brief.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const rejected = JSON.stringify({ ok: false, status: 'rejected', summary: 'Reviewer: B — generic', problems: [], findings: [{ severity: 'blocking', text: 'restates the posting' }] });

function run(artifacts: string, block: string, verdict = rejected): Record<string, unknown> {
  const proc = Bun.spawnSync(['bun', script], {
    env: { ...process.env, ARTIFACTS_DIR: artifacts, INPUTS_REMARKS: '', INPUTS_VERDICT: verdict, INPUTS_OUT_DIR: 'application', INPUTS_BLOCK: block },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
}

describe('revise-brief : la première version gardée dans application-v1/', () => {
  test('CV puis lettre : le dossier du CV copié une fois, puis la première lettre ajoutée à côté', () => {
    const artifacts = mkdtempSync(join(tmpdir(), 'revise-brief-test-'));
    dirs.push(artifacts);
    const app = join(artifacts, 'application');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'CV.md'), 'cv v1');
    const cv = run(artifacts, 'cv-tailor');
    expect(cv.ok).toBe(true);
    expect(String(cv.summary)).toContain('First version kept in application-v1/.');
    expect(readFileSync(join(artifacts, 'application-v1', 'CV.md'), 'utf8')).toBe('cv v1');
    writeFileSync(join(app, 'CV.md'), 'cv v2');
    writeFileSync(join(app, 'letter.md'), 'letter v1');
    writeFileSync(join(app, 'letter.html'), '<p>letter v1</p>');
    const letter = run(artifacts, 'cover-letter');
    expect(letter.ok).toBe(true);
    expect(String(letter.remarks)).toContain('The previous version (letter.md)');
    expect(String(letter.summary)).toContain('First version kept in application-v1/ (letter.md, letter.html).');
    expect(readFileSync(join(artifacts, 'application-v1', 'letter.md'), 'utf8')).toBe('letter v1');
    expect(readFileSync(join(artifacts, 'application-v1', 'CV.md'), 'utf8')).toBe('cv v1');
  });
  test('pas un refus : rien à réviser, rien copié', () => {
    const artifacts = mkdtempSync(join(tmpdir(), 'revise-brief-test-'));
    dirs.push(artifacts);
    mkdirSync(join(artifacts, 'application'), { recursive: true });
    writeFileSync(join(artifacts, 'application', 'letter.md'), 'x');
    const out = run(artifacts, 'cover-letter', JSON.stringify({ ok: false, status: 'unconverged', summary: 's' }));
    expect(out.ok).toBe(false);
    expect(existsSync(join(artifacts, 'application-v1'))).toBe(false);
  });
});
