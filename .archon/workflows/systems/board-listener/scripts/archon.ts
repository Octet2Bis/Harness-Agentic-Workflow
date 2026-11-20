/**
 * Ce que les scripts du tableau lisent hors de l'état (`archon state` : .shared/state.ts) :
 * les runs actifs et un run (`archon workflow status | get --json`), le YAML d'un workflow du
 * dépôt (un système du tableau, ou le workflow d'un run qui tient le dossier), et le remote
 * `origin` du dépôt. Lectures seules ; toute erreur rend null, à l'appelant de décider.
 *
 * Dans un run, le moteur fournit `ARCHON_CLI_COMMAND` (argv JSON) ; hors run (`board.ts`), on
 * retombe sur `ARCHON_CMD` ou `archon`, comme .shared/state.ts.
 */

import { readFileSync, readdirSync } from 'node:fs';
import type { ActiveRun } from '../../.shared/board.ts';

function archonArgv(): string[] {
  const inRun = process.env.ARCHON_CLI_COMMAND;
  if (inRun !== undefined && inRun !== '') return JSON.parse(inRun) as string[];
  const cmd = process.env.ARCHON_CMD;
  if (cmd !== undefined && cmd !== '') return cmd.split(' ').filter((part) => part !== '');
  return ['archon'];
}

/** `archon <args> --json` : le document JSON imprimé, ou null (sortie non nulle ou illisible). */
async function archonJson(args: string[]): Promise<Record<string, unknown> | null> {
  try {
    const child = Bun.spawn([...archonArgv(), ...args, '--json'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) return null;
    // Un seul document, souvent indenté sur plusieurs lignes.
    const doc = JSON.parse(out.slice(out.indexOf('{'))) as unknown;
    return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Les runs `running` et `paused` du projet courant, ou null. */
export async function activeRuns(): Promise<ActiveRun[] | null> {
  const doc = await archonJson(['workflow', 'status']);
  return Array.isArray(doc?.runs) ? (doc.runs as ActiveRun[]) : null;
}

/** Le statut d'un run (`running`, `paused`, `completed`…), ou null s'il est introuvable. */
export async function runStatus(id: string): Promise<string | null> {
  const doc = await archonJson(['workflow', 'get', id]);
  return typeof doc?.status === 'string' ? doc.status : null;
}

/** Les nœuds d'un run, résumés (`nodes` de `workflow get --verbose`), ou null. */
export async function runNodes(id: string): Promise<unknown> {
  const doc = await archonJson(['workflow', 'get', id, '--verbose']);
  return doc?.nodes ?? null;
}

/** Un YAML lu, ou null s'il est absent ou illisible. */
function yamlDoc(url: URL): Record<string, unknown> | null {
  try {
    const doc = Bun.YAML.parse(readFileSync(url, 'utf8')) as unknown;
    return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Le YAML d'un système du tableau (systems/<nom>/<nom>.yaml), ou null s'il est illisible. */
export function systemDoc(workflow: string): Record<string, unknown> | null {
  return workflowDoc(workflow);
}

/**
 * Le YAML d'un workflow du dépôt par son nom, dans n'importe quel pack
 * (.archon/workflows/<pack>/<nom>/<nom>.yaml, `systems` d'abord), ou null : nom hors dépôt
 * (un workflow livré avec Archon), illisible, ou qui n'est pas un nom de dossier.
 */
export function workflowDoc(name: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return null;
  const workflows = new URL('../../../', import.meta.url);
  let packs: string[];
  try {
    packs = readdirSync(workflows, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    packs = [];
  }
  for (const pack of ['systems', ...packs.filter((p) => p !== 'systems').sort()]) {
    const doc = yamlDoc(new URL(`${pack}/${name}/${name}.yaml`, workflows));
    if (doc !== null) return doc;
  }
  return null;
}

/** Le dépôt du dossier courant a-t-il un remote `origin` ? */
export function hasOriginRemote(): boolean {
  try {
    return Bun.spawnSync(['git', 'remote', 'get-url', 'origin'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    return false;
  }
}
