/**
 * Un faux `archon`, pour listener.test.ts seulement (aucun nœud ne le lance) : les scripts
 * d'état (claim, hold, close, settle) l'appellent par `ARCHON_CLI_COMMAND`, comme le moteur
 * dans un run. Il répond aux seules commandes qu'ils emploient, dans le format du vrai CLI
 * (Archon packages/cli/src/commands/state.ts et workflow.ts) :
 *
 * - `state get <nom>` → `{ scope, name, revision, value }` (absent : révision 0, valeur null) ;
 *   si `race.json` a des ops pour ce nom, elles sont appliquées juste APRÈS la lecture (une
 *   reprise à la main entre la lecture d'un script et son écriture), une fois ;
 * - `state list --prefix <p>` → `{ scope, documents: [{ name, revision, deleted }] }` ;
 * - `state patch <nom> [--if-revision <n>]`, ops `set | append | remove` lues sur stdin →
 *   exit 3 si la révision a bougé (ou si le nom est dans `conflicts`, une fois) ;
 * - `workflow status --json` → `{ runs, scopeFallback }` (exit 1 si `runs` vaut null) ;
 * - `workflow get <id> --json [--verbose]` → le run (`nodes` avec --verbose), exit 1 s'il est inconnu.
 *
 * L'état vit dans le dossier `FAKE_ARCHON_DIR` : `state.json` (nom → { revision, value }),
 * `runs.json` ({ runs: ActiveRun[] | null, get: { <id>: run } }), `conflicts.json` (noms dont
 * la prochaine écriture est refusée), `race.json` (nom → ops), et `calls.log` (une ligne JSON
 * par appel).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Doc {
  revision: number;
  value: unknown;
}

const dir = process.env.FAKE_ARCHON_DIR ?? '';
if (dir === '') {
  process.stderr.write('fake-archon: FAKE_ARCHON_DIR is not set\n');
  process.exit(2);
}
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), `${JSON.stringify(args)}\n`);

const read = <T>(file: string, fallback: T): T => (existsSync(join(dir, file)) ? (JSON.parse(readFileSync(join(dir, file), 'utf8')) as T) : fallback);
const write = (file: string, value: unknown) => writeFileSync(join(dir, file), JSON.stringify(value, null, 2));
const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const option = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const scope = { kind: 'project', key: 'fake' };

interface Op {
  op: string;
  path: string;
  value?: unknown;
}

/** Applique une op sur un pointeur JSON (`/a`, `/a/b`), comme `archon state patch`. */
function apply(target: Record<string, unknown>, op: Op): void {
  const keys = op.path.split('/').slice(1);
  const last = keys.pop()!;
  let node = target;
  for (const key of keys) node = (node[key] ??= {}) as Record<string, unknown>;
  if (op.op === 'set') node[last] = op.value;
  else if (op.op === 'remove') delete node[last];
  else if (op.op === 'append') node[last] = [...((node[last] as unknown[] | undefined) ?? []), op.value];
  else throw new Error(`unknown op ${op.op}`);
}

const [group, command, name] = args;
if (group === 'state') {
  const docs = read<Record<string, Doc>>('state.json', {});
  if (command === 'get') {
    const doc = docs[name!];
    out({ scope, name, revision: doc?.revision ?? 0, value: doc?.value ?? null });
    const races = read<Record<string, Op[]>>('race.json', {});
    if (doc !== undefined && races[name!] !== undefined) {
      const value = structuredClone(doc.value) as Record<string, unknown>;
      for (const op of races[name!]!) apply(value, op);
      docs[name!] = { revision: doc.revision + 1, value };
      delete races[name!];
      write('state.json', docs);
      write('race.json', races);
    }
  } else if (command === 'list') {
    const prefix = option('--prefix') ?? '';
    out({ scope, documents: Object.entries(docs).filter(([n]) => n.startsWith(prefix)).map(([n, d]) => ({ name: n, revision: d.revision, deleted: false })) });
  } else if (command === 'patch') {
    const { ops } = JSON.parse(await Bun.stdin.text()) as { ops: Op[] };
    const current = docs[name!] ?? { revision: 0, value: {} };
    const expected = option('--if-revision');
    const conflicts = read<string[]>('conflicts.json', []);
    if (conflicts.includes(name!) || (expected !== undefined && Number(expected) !== current.revision)) {
      write('conflicts.json', conflicts.filter((n) => n !== name));
      out({ ok: false, error: `revision conflict on ${name}`, code: 3 });
      process.exit(3);
    }
    const value = structuredClone(current.value) as Record<string, unknown>;
    for (const op of ops) apply(value, op);
    docs[name!] = { revision: current.revision + 1, value };
    write('state.json', docs);
    out({ scope, name, revision: current.revision + 1, value });
  } else {
    out({ ok: false, error: `fake-archon: state ${command} is not faked`, code: 2 });
    process.exit(2);
  }
} else if (group === 'workflow') {
  const runs = read<{ runs?: unknown[] | null; get?: Record<string, Record<string, unknown>> }>('runs.json', {});
  if (command === 'status') {
    if (!Array.isArray(runs.runs)) process.exit(1);
    out({ runs: runs.runs, scopeFallback: false });
  } else if (command === 'get') {
    const run = runs.get?.[name!];
    if (run === undefined) {
      out({ ok: false, runId: name, error: 'not_found' });
      process.exit(1);
    }
    const { nodes, ...record } = run;
    out(args.includes('--verbose') ? { ...record, nodes: nodes ?? [] } : record);
  } else {
    process.exit(2);
  }
} else {
  process.stderr.write(`fake-archon: ${args.join(' ')} is not faked\n`);
  process.exit(2);
}
