#!/usr/bin/env bun
/**
 * Porte R3 : l'issue de chaque fixture est assertée.
 *
 * `archon workflow test` vérifie qu'une fixture atteint les bons nœuds et finit dans le bon
 * état, mais quand le nœud `returns:` (verdict.ts, done.ts…) s'exécute pour de vrai, Archon
 * n'asserte pas ce qu'il rend (« Authored outcome: undeclared ») : une fixture « rejected »
 * pourrait rendre `ok: true` sans que rien ne rougisse. Cette porte rejoue chaque fixture en
 * dry-run (`archon workflow run --dry-run --json`) et compare les sorties aux lignes de
 * commentaire de la fixture :
 *
 *   # attendu: ok=false status=rejected               ← le nœud `returns:`
 *   # attendu(submit__verdict): ok=true status=verified ← un autre nœud exécuté pour de vrai
 *
 * Valeurs lues en JSON quand c'est possible (`ok=false`, `variants={"a":true}`), texte sinon.
 * Une fixture `completed` sans ligne `# attendu` est une violation, sauf si elle dit
 * pourquoi rien n'y tourne pour de vrai : `# sans-attendu: <raison>` (fixture de contrat qui
 * stubbe `verdict`, nœud qui écrit dans l'état Archon…). Une fixture `cancelled` / `failed`
 * / `paused` ne rend pas de valeur (Archon asserte son état) mais peut asserter des nœuds
 * nommés : `# attendu(decide): proceed=false`.
 *
 * Chaque dry-run tourne dans une copie jetable du dépôt (git init + commit), remise à zéro
 * entre deux fixtures : un script exécuté ne touche jamais le dépôt réel.
 *
 * Usage : bun scripts/gates/fixture-outcomes.ts <workflow>... | --all  [--root=<dossier>] [--show]
 *         (ARCHON_CMD / ARCHON_SRC comme verify-block.sh)
 * `--show` imprime ce que rendent les nœuds exécutés, pour écrire les lignes `# attendu`.
 */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { type Workflow, archonCommand, loadHarness, readFixture, returnsOf, rootFromArgs } from './lib.ts';

const argv = process.argv.slice(2);
const root = rootFromArgs(argv);
const wanted = argv.filter((a) => !a.startsWith('--'));
const ALL = argv.includes('--all');
const SHOW = argv.includes('--show');
const h = loadHarness(root);
const workflows = [...h.blocks, ...h.systems].filter((w) => ALL || wanted.includes(w.id));
if (!ALL && wanted.length === 0) {
  console.error('usage : bun scripts/gates/fixture-outcomes.ts <workflow>... | --all [--show]');
  process.exit(2);
}

const SKIP = new Set(['.git', '.local', 'node_modules']);
const git = (dir: string, ...args: string[]) =>
  Bun.spawnSync(['git', '-c', 'user.name=gate', '-c', 'user.email=gate@localhost', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-outcomes-'));
  cpSync(root, dir, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'sandbox');
  return dir;
}

type Outputs = Map<string, string>;

/**
 * Le premier document JSON d'une sortie. Quand le run finit `failed`, la CLI imprime après le
 * DryRunResult un second document (`{"ok": false, "error": …}`) : on ne lit que le premier.
 */
export function firstJsonDocument(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Les sorties des nœuds terminés pour de vrai (pas stubbés) d'un dry-run, ou un motif d'échec. */
function dryRun(dir: string, wf: Workflow, fixturePath: string): { outputs?: Outputs; error?: string } {
  const fx = readFixture(fixturePath);
  const stubsPath = join(tmpdir(), `harness-outcome-stubs-${process.pid}.json`);
  writeFileSync(stubsPath, JSON.stringify(fx.stubs));
  const cmd = [
    ...archonCommand(),
    'workflow', 'run', wf.id, '--dry-run', '--json', '--stubs', stubsPath,
    ...(fx.execCode ? ['--exec-code'] : []),
    ...Object.entries(fx.inputs).flatMap(([k, v]) => ['--input', `${k}=${v}`]),
    '--cwd', dir,
  ];
  const run = Bun.spawnSync(cmd, { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
  rmSync(stubsPath, { force: true });
  const out = run.stdout.toString();
  let result: { outcome?: string; trace?: { nodeId: string; state: string; output?: string }[]; error?: string };
  try {
    result = JSON.parse(firstJsonDocument(out));
  } catch {
    return { error: `dry-run illisible (code ${run.exitCode}) : ${`${out}${run.stderr.toString()}`.trim().split('\n').slice(-3).join(' | ')}` };
  }
  if (result.error) return { error: `dry-run en échec : ${result.error}` };
  if (result.outcome !== undefined && result.outcome !== fx.expect) {
    return { error: `le dry-run finit « ${result.outcome} », la fixture attend « ${fx.expect} »` };
  }
  const outputs: Outputs = new Map();
  for (const e of result.trace ?? []) if (e.state === 'completed') outputs.set(e.nodeId, String(e.output ?? ''));
  return { outputs };
}

function compare(node: string, raw: string | undefined, expected: Record<string, unknown>): string | null {
  if (raw === undefined) return `le nœud « ${node} » ne s'est pas exécuté pour de vrai`;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw.trim()) as Record<string, unknown>;
  } catch {
    return `sortie non JSON de « ${node} » : ${raw.slice(0, 120)}`;
  }
  const diffs = Object.entries(expected)
    .filter(([k, v]) => JSON.stringify(value[k]) !== JSON.stringify(v))
    .map(([k, v]) => `${node}.${k} attendu ${JSON.stringify(v)}, rendu ${JSON.stringify(value[k])}`);
  return diffs.length ? diffs.join(' ; ') : null;
}

const errors: string[] = [];
const quiet: string[] = [];
let asserted = 0;
const box = sandbox();
try {
  for (const wf of workflows) {
    const returns = returnsOf(wf.doc).node;
    for (const name of wf.fixtures) {
      const path = join(wf.dir, 'fixtures', `${name}.stubs.yaml`);
      const rel = relative(root, path);
      const fx = readFixture(path);
      if (fx.attendu.size === 0 && !SHOW) {
        if (fx.expect !== 'completed') quiet.push(`${rel} (expect: ${fx.expect} ; état asserté par Archon)`);
        else if (fx.exempt) quiet.push(`${rel} (sans-attendu : ${fx.exempt})`);
        else errors.push(`R3 ${rel} : ni « # attendu: champ=valeur » ni « # sans-attendu: raison » — l'issue de la fixture n'est pas assertée`);
        continue;
      }
      const returnsStubbed = returns === '' || Object.hasOwn(fx.stubs, returns);
      if (fx.attendu.has('') && (returnsStubbed || fx.expect !== 'completed')) {
        errors.push(`R3 ${rel} : « # attendu: » vise le nœud returns « ${returns} », qui ne rend rien ici (stubbé ou run non terminé) ; nommer le nœud : « # attendu(<nœud>): … »`);
        continue;
      }
      git(box, 'checkout', '-q', '--', '.');
      git(box, 'clean', '-fdxq');
      const got = dryRun(box, wf, path);
      if (got.error) {
        errors.push(`R3 ${rel} : ${got.error}`);
        continue;
      }
      if (SHOW) {
        console.log(rel);
        for (const [node, out] of got.outputs!) if (!Object.hasOwn(fx.stubs, node)) console.log(`  ${node} : ${out.trim().slice(0, 300)}`);
      }
      const problems = [...fx.attendu].map(([node, expected]) => compare(node || returns, got.outputs!.get(node || returns), expected)).filter(Boolean);
      asserted += fx.attendu.size ? 1 : 0;
      if (problems.length) errors.push(`R3 ${rel} : issue attendue non obtenue (${problems.join(' ; ')})`);
      else if (fx.attendu.size) console.log(`✓ ${rel}`);
    }
  }
} finally {
  rmSync(box, { recursive: true, force: true });
}

for (const n of wanted.filter((n) => !workflows.some((w) => w.id === n))) errors.push(`workflow inconnu « ${n} »`);
for (const q of quiet) console.log(`· ${q}`);
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n✗ ${errors.length} issue(s) de fixture non prouvée(s)`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ ${asserted} issue(s) de fixture assertée(s), ${quiet.length} fixture(s) sans valeur rendue à asserter`);
}
