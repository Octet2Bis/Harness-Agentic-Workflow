/**
 * Chargement commun des portes : blocs, systèmes, registre, déclencheurs.
 * Zéro dépendance : le YAML est lu par `Bun.YAML` (Bun ≥ 1.2.21, première version qui l'a).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export type Node = Record<string, unknown> & { id?: string; nodes?: Node[]; loop_group?: { nodes?: Node[]; until_bash?: string } };

export interface Workflow {
  /** Nom du workflow (`name:`), égal au nom du dossier sauf pour le gabarit. */
  id: string;
  kind: 'block' | 'system';
  dir: string;
  yamlPath: string;
  doc: Record<string, unknown>;
  nodes: Node[];
  fixtures: string[];
}

export interface Harness {
  root: string;
  blocks: Workflow[];
  systems: Workflow[];
  /** statut du registre par identifiant (`research` → `VERIFIED`). */
  registry: Map<string, string>;
  /** Les identifiants qui ont plus d'une ligne dans le registre (R5). */
  registryDuplicates: string[];
  registryPath: string;
  /** Les fichiers YAML de `.archon/workflows/` qui ne sont ni un bloc ni un système (R5). */
  strayWorkflows: string[];
  triggers: { path: string; doc: Record<string, unknown> | null; error?: string }[];
}

export const STATUSES = ['GABARIT', 'DRAFT', 'VERIFIED', 'PROUVÉ'] as const;
export const NOT_WORKFLOW_DIRS = new Set(['.shared', 'proofs']);

/**
 * Le nœud dont la sortie est le résultat du workflow, et le champ qui en donne l'issue.
 * Archon déclare les deux dans `returns: { node: <id>, outcome: <champ> }` ; l'ancienne forme
 * (`returns: <id>` + `outcome_field: <champ>`) est encore lue, pour un dépôt pas encore migré.
 */
export function returnsOf(doc: Record<string, unknown>): { node: string; outcome: string } {
  const returns = doc.returns;
  if (returns !== null && typeof returns === 'object') {
    const { node, outcome } = returns as { node?: unknown; outcome?: unknown };
    return { node: String(node ?? ''), outcome: String(outcome ?? 'ok') };
  }
  return { node: String(returns ?? ''), outcome: String(doc.outcome_field ?? 'ok') };
}

export function rootFromArgs(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith('--root='));
  return arg ? resolve(arg.slice('--root='.length)) : resolve(import.meta.dir, '..', '..');
}

/** Tous les nœuds d'un workflow, corps de boucle compris, dans l'ordre du fichier. */
export function allNodes(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.loop_group?.nodes) out.push(...allNodes(node.loop_group.nodes));
  }
  return out;
}

function loadPack(root: string, kind: 'block' | 'system'): Workflow[] {
  const packDir = join(root, '.archon', 'workflows', kind === 'block' ? 'blocks' : 'systems');
  if (!existsSync(packDir)) return [];
  const out: Workflow[] = [];
  for (const name of readdirSync(packDir).sort()) {
    const dir = join(packDir, name);
    if (NOT_WORKFLOW_DIRS.has(name) || !statSync(dir).isDirectory()) continue;
    const yamls = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    if (yamls.length !== 1) throw new Error(`${dir} : un seul fichier .yaml attendu, ${yamls.length} trouvé(s)`);
    const yamlPath = join(dir, yamls[0]!);
    const doc = Bun.YAML.parse(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>;
    const fixturesDir = join(dir, 'fixtures');
    const fixtures = existsSync(fixturesDir)
      ? readdirSync(fixturesDir).filter((f) => f.endsWith('.stubs.yaml')).map((f) => basename(f, '.stubs.yaml')).sort()
      : [];
    out.push({ id: String(doc.name ?? name), kind, dir, yamlPath, doc, nodes: (doc.nodes as Node[] | undefined) ?? [], fixtures });
  }
  return out;
}

/** Les lignes du registre : `| \`id\` | … | STATUT | … |` → Map(id → statut). Un statut illisible vaut `?`. */
export function readRegistry(path: string): Map<string, string> {
  return readRegistryRows(path).registry;
}

function readRegistryRows(path: string): { registry: Map<string, string>; duplicates: string[] } {
  const registry = new Map<string, string>();
  const duplicates: string[] = [];
  if (!existsSync(path)) return { registry, duplicates };
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\|\s*`([a-z0-9-]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const cells = match[2]!.split('|').map((c) => c.trim());
    const status = cells.find((c) => (STATUSES as readonly string[]).includes(c)) ?? '?';
    if (registry.has(match[1]!)) duplicates.push(match[1]!);
    registry.set(match[1]!, status);
  }
  return { registry, duplicates };
}

/**
 * Les YAML de `.archon/workflows/` hors de `blocks/<id>/<id>.yaml` et `systems/<id>/<id>.yaml` :
 * Archon les charge comme des workflows, mais aucune porte ne les vérifie (orphelins, R5).
 */
function findStrayWorkflows(root: string, known: Set<string>): string[] {
  const base = join(root, '.archon', 'workflows');
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'fixtures' && !NOT_WORKFLOW_DIRS.has(name)) walk(path);
      } else if (/\.ya?ml$/.test(name) && !known.has(path)) {
        out.push(path);
      }
    }
  };
  walk(base);
  return out;
}

export function loadHarness(root: string): Harness {
  const registryPath = join(root, '.archon', 'workflows', 'blocks', 'REGISTRY.md');
  const triggersDir = join(root, 'triggers');
  const triggers = existsSync(triggersDir)
    ? readdirSync(triggersDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => {
          const path = join(triggersDir, f);
          try {
            return { path, doc: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> };
          } catch (error) {
            return { path, doc: null, error: (error as Error).message };
          }
        })
    : [];
  const blocks = loadPack(root, 'block');
  const systems = loadPack(root, 'system');
  const { registry, duplicates } = readRegistryRows(registryPath);
  const strayWorkflows = findStrayWorkflows(root, new Set([...blocks, ...systems].map((w) => w.yamlPath)));
  return { root, blocks, systems, registry, registryDuplicates: duplicates, registryPath, strayWorkflows, triggers };
}

/** Le dossier d'un bloc est aussi son identifiant de registre, sauf le gabarit (`template` ↔ `block-template`). */
export function registryId(workflow: Workflow): string {
  return basename(workflow.dir);
}

/**
 * Un nœud juge : `command: judge` (ou une commande `…-judge` / `…_judge`), ou un id qui finit
 * par `judge` (`judge`, `review-judge`, `design_judge`).
 */
export function isJudgeNode(node: Node): boolean {
  const named = (value: unknown): boolean => /(^|[_-])judge$/.test(String(value ?? ''));
  return named(node.command) || named(node.id);
}

/** La commande Archon : $ARCHON_CMD, sinon `bun $ARCHON_SRC/packages/cli/src/cli.ts`, sinon `archon`. */
export function archonCommand(): string[] {
  if (process.env.ARCHON_CMD) return process.env.ARCHON_CMD.split(' ').filter(Boolean);
  if (process.env.ARCHON_SRC) return ['bun', join(process.env.ARCHON_SRC, 'packages', 'cli', 'src', 'cli.ts')];
  return ['archon'];
}

export interface FixtureFile {
  expect: 'completed' | 'failed' | 'paused' | 'cancelled';
  inputs: Record<string, string>;
  execCode: boolean;
  /** Les sorties stubbées, par id de nœud (tout sauf `fixture` et `exec-code`). */
  stubs: Record<string, unknown>;
  /**
   * Les lignes `# attendu: ok=false status=rejected` (nœud `returns:`) et
   * `# attendu(submit__verdict): status=verified` (un autre nœud exécuté pour de vrai),
   * par nœud ('' = le nœud `returns:`). Vide si la fixture n'en a pas.
   */
  attendu: Map<string, Record<string, unknown>>;
  /** La raison donnée par `# sans-attendu: <raison>` quand rien ne s'y exécute pour de vrai, sinon null. */
  exempt: string | null;
}

/** Lit une fixture Archon (`fixtures/<nom>.stubs.yaml`) et ses lignes `# attendu`. */
export function readFixture(path: string): FixtureFile {
  const text = readFileSync(path, 'utf8');
  const doc = (Bun.YAML.parse(text) ?? {}) as Record<string, unknown>;
  const decl = (doc.fixture ?? {}) as { expect?: FixtureFile['expect']; inputs?: Record<string, string> };
  const stubs = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'fixture' && k !== 'exec-code'));
  const attendu = new Map<string, Record<string, unknown>>();
  for (const line of text.matchAll(/^#\s*attendu(?:\(([A-Za-z0-9_-]+)\))?\s*:\s*(.+)$/gm)) {
    const fields = attendu.get(line[1] ?? '') ?? {};
    for (const pair of line[2]!.trim().split(/\s+/)) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const raw = pair.slice(eq + 1);
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        // texte nu : status=rejected
      }
      fields[pair.slice(0, eq)] = value;
    }
    attendu.set(line[1] ?? '', fields);
  }
  const exempt = /^#\s*sans-attendu\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  return { expect: decl.expect ?? 'completed', inputs: decl.inputs ?? {}, execCode: doc['exec-code'] === true, stubs, attendu, exempt };
}
