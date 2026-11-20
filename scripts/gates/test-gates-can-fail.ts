#!/usr/bin/env bun
/**
 * Méta-test : chaque porte doit encore échouer sur sa violation connue (scripts/gates/fixtures.ts),
 * et passer sur le dépôt sain. À lancer en premier : si une porte ne sait plus attraper une
 * violation connue, ses verdicts verts ne valent rien.
 * Usage : bun scripts/gates/test-gates-can-fail.ts   (ARCHON_CMD / ARCHON_SRC comme verify-block.sh)
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { type Fixture, fixtures } from './fixtures.ts';
import { archonCommand } from './lib.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
const SKIP = new Set(['.git', '.local', 'node_modules']);
const git = (dir: string, ...args: string[]) =>
  Bun.spawnSync(['git', '-c', 'user.name=gate', '-c', 'user.email=gate@localhost', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-gate-'));
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
  // `archon validate` exige un dépôt git, et les fixtures exec-code un commit (Archon les
  // exécute dans un worktree détaché de HEAD) : la copie devient un dépôt à un commit.
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'sandbox');
  return dir;
}

/** Après la violation, le commit de la copie la contient aussi (les fixtures exec-code lisent HEAD). */
function commit(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'violation');
}

function gate(kind: Fixture['gate'], dir: string, workflow?: string): { status: number; output: string } {
  const cmd =
    kind === 'validate' ? ['bun', join(ROOT, 'scripts', 'gates', 'validate.ts'), `--root=${dir}`]
    : kind === 'build' ? ['bun', join(ROOT, 'scripts', 'gates', 'build-harness.ts'), '--check', `--root=${dir}`]
    : kind === 'unit' ? ['bun', 'test', join(dir, 'scripts')]
    : kind === 'verify' ? ['bash', join(dir, 'scripts', 'verify-block.sh'), workflow ?? '']
    : [...archonCommand(), 'validate', 'workflows', workflow ?? '', '--cwd', dir];
  const run = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe', cwd: dir });
  return { status: run.exitCode, output: `${run.stdout.toString()}\n${run.stderr.toString()}` };
}

let failures = 0;

// Un « (fail) » nu prendrait n'importe quel test cassé, par exemple par un chantier voisin.
/** Les textes attendus d'une violation (vide : la règle seule). */
const expects = (f: Fixture): string[] => (f.expect === undefined ? [] : [f.expect].flat());

for (const f of fixtures.filter((x) => expects(x).some((e) => /^\(fail\)\s*$/.test(e)))) {
  failures++;
  console.error(`✗ ${f.name} : expect « (fail) » sans nom de test ; nommer le test qui doit tomber (« (fail) <describe> > <test> »)`);
}

// Le dépôt sain passe chaque porte : sinon un « attrapé » ne prouverait rien.
const clean = sandbox();
// Chaque porte visée par une violation connue, sur chacun de ses workflows visés.
const cleanRuns: [Fixture['gate'], string?][] = [
  ...new Map(fixtures.map((f) => [`${f.gate} ${f.workflow ?? ''}`, [f.gate, f.workflow] as [Fixture['gate'], string?]])).values(),
];
for (const [kind, workflow] of cleanRuns) {
  const r = gate(kind, clean, workflow);
  if (r.status !== 0) {
    failures++;
    console.error(`✗ ${kind}${workflow ? ` ${workflow}` : ''} échoue sur le dépôt sain :\n${r.output.trim().split('\n').slice(-12).join('\n')}`);
  }
}
rmSync(clean, { recursive: true, force: true });

for (const f of fixtures) {
  const dir = sandbox();
  try {
    f.apply(dir);
    commit(dir);
    const r = gate(f.gate, dir, f.workflow);
    // Attrapé = la porte échoue en citant la violation : une ligne « R<n> … » (ou le texte
    // `expect`), jamais un plantage de nos portes (validate, build) dont la pile afficherait
    // par hasard « R1 » dans le source. bun test et archon impriment des piles légitimes.
    const ours = f.gate === 'validate' || f.gate === 'build';
    const crashed = ours && (/^\s+at .+:\d+:\d+\)?$/m.test(r.output) || /^error: /m.test(r.output));
    // Un test rouge (`bun test`) ne compte que s'il est celui qu'on attend : `expect` nomme le
    // test et ouvre une ligne « (fail) <describe> > <test> » de la sortie. Une liste : chacun.
    const wanted = expects(f);
    const cited = wanted.length === 0 ? new RegExp(`^${f.rule} `, 'm').test(r.output)
      : wanted.every((e) => e.startsWith('(fail)') ? r.output.split('\n').some((l) => l.trimStart().startsWith(e)) : r.output.includes(e));
    const caught = r.status !== 0 && cited && !crashed;
    console.log(`${caught ? '✓' : '✗'} ${f.name} → ${f.gate} ${caught ? `attrape ${f.rule}` : crashed ? `PLANTE au lieu d'attraper ${f.rule}` : `NE DÉTECTE PLUS la violation ${f.rule}`}`);
    if (!caught) {
      failures++;
      console.error(r.output.trim().split('\n').slice(-6).join('\n'));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures) {
  console.error(`\n✗ ${failures} porte(s) aveugle(s)`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ ${fixtures.length} violation(s) connue(s) toutes attrapées`);
}
