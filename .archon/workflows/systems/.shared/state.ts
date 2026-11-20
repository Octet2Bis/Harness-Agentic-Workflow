/**
 * Accès aux documents d'état durables d'Archon (`archon state`) depuis un script.
 *
 * Dans un run, le moteur fournit `ARCHON_CLI_COMMAND` (argv JSON) et le script écrit au
 * nom du run. Hors run (le petit CLI `board.ts`), on retombe sur `ARCHON_CMD` ou `archon`.
 */

export interface StateCall {
  code: number;
  value: unknown;
}

function archonArgv(): string[] {
  const inRun = process.env.ARCHON_CLI_COMMAND;
  if (inRun !== undefined && inRun !== '') return JSON.parse(inRun) as string[];
  const cmd = process.env.ARCHON_CMD;
  if (cmd !== undefined && cmd !== '') return cmd.split(' ').filter((part) => part !== '');
  return ['archon'];
}

/** Lance `archon state <args>` ; `stdin` porte le document ou les opérations. */
export async function state(args: string[], stdin?: string): Promise<StateCall> {
  const child = Bun.spawn([...archonArgv(), 'state', ...args], {
    stdin: stdin === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  if (stdin !== undefined) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  const out = await new Response(child.stdout).text();
  const code = await child.exited;
  let value: unknown = null;
  try {
    value = out.trim() === '' ? null : JSON.parse(out);
  } catch {
    value = out;
  }
  return { code, value };
}

export async function stateGet(name: string): Promise<{ revision: number; value: unknown }> {
  const call = await state(['get', name]);
  if (call.code !== 0) throw new Error(`archon state get ${name} failed with exit ${call.code}`);
  const doc = call.value as { revision: number; value: unknown };
  return { revision: doc.revision, value: doc.value };
}

export async function stateList(prefix: string): Promise<{ name: string; revision: number; deleted: boolean }[]> {
  const call = await state(['list', '--prefix', prefix]);
  if (call.code !== 0) throw new Error(`archon state list --prefix ${prefix} failed with exit ${call.code}`);
  return (call.value as { documents: { name: string; revision: number; deleted: boolean }[] }).documents;
}

export async function statePut(name: string, value: unknown, ifRevision: number): Promise<number> {
  const call = await state(['put', name, '--if-revision', String(ifRevision)], JSON.stringify(value));
  return call.code;
}

export interface PatchOp {
  op: 'set' | 'remove' | 'append';
  path: string;
  value?: unknown;
}

/** Exit 0 : appliqué ; 3 : la révision a bougé (quelqu'un d'autre a écrit). */
export async function statePatch(name: string, ops: PatchOp[], ifRevision?: number): Promise<number> {
  const args = ['patch', name];
  if (ifRevision !== undefined) args.push('--if-revision', String(ifRevision));
  const call = await state(args, JSON.stringify({ ops }));
  return call.code;
}
