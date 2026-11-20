/**
 * Contrôle déterministe du bloc `implement` : lance la commande de tests du projet et lit
 * le journal. `ok` n'est vrai que si les tests passent ET que `## Reste` est vide.
 * Liaisons : INPUTS_TEST_CMD, INPUTS_OUT, INPUTS_SUMMARY, INPUTS_DELIVERABLE ; INPUTS_TRIES,
 * le numéro du tour précédent (vide au premier), d'où `tries` : la boucle s'arrête au
 * plafond (8 tours) même si `ok` reste faux, et le verdict dit alors `unconverged`.
 *
 * La commande de tests passe par bash, trouvé comme Archon trouve le sien (`resolveBash`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { journalProblems, remainingTasks, testProblems } from '../../.shared/implement-checks.ts';
import { artifactsDir, emit, fail, nextTry, nullableJson, text } from '../../.shared/io.ts';

/** Les emplacements de Git Bash sous Windows, dans l'ordre où Archon les essaie. */
export function gitBashCandidates(env: Record<string, string | undefined>): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA;
  const userProfile = env.USERPROFILE;
  return [
    `${programFiles}\\Git\\bin\\bash.exe`,
    `${programFiles}\\Git\\usr\\bin\\bash.exe`,
    `${programFilesX86}\\Git\\bin\\bash.exe`,
    ...(localAppData ? [`${localAppData}\\Programs\\Git\\bin\\bash.exe`] : []),
    ...(userProfile ? [`${userProfile}\\scoop\\apps\\git\\current\\bin\\bash.exe`] : []),
  ];
}

/**
 * Le bash qui lance la commande de tests, dans l'ordre de `resolveBashPath` d'Archon
 * (packages/git/src/exec.ts), qui lance ainsi ses propres nœuds `bash:` :
 * 1. `ARCHON_BASH_PATH` s'il est posé (un chemin absent est une erreur, pas un repli) ;
 * 2. sous Windows, le premier Git Bash installé aux emplacements usuels — un `bash` nu y
 *    lancerait `C:\Windows\System32\bash.exe`, le lanceur WSL, qui casse les commandes ;
 *    aucun trouvé : le chemin canonique, pour que l'erreur nomme un chemin réel ;
 * 3. ailleurs (Linux, macOS), `bash`, cherché dans le PATH : le comportement d'avant.
 * Pure : l'environnement, la plateforme et le test d'existence sont passés en paramètres.
 */
export function resolveBash(
  env: Record<string, string | undefined>,
  platform: string,
  exists: (path: string) => boolean,
): string {
  const override = env.ARCHON_BASH_PATH;
  if (override) {
    if (!exists(override)) {
      throw new Error(
        `ARCHON_BASH_PATH points to a path that does not exist: '${override}'. ` +
          'Unset it to fall back to the platform default, or correct the path ' +
          "(on Windows, a common user-scope Git install path is '%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe').",
      );
    }
    return override;
  }
  if (platform === 'win32') {
    return gitBashCandidates(env).find(exists) ?? `${env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`;
  }
  return 'bash';
}

function main(): void {
  const command = text(process.env.INPUTS_TEST_CMD) || 'npm test';
  let run: ReturnType<typeof Bun.spawnSync>;
  try {
    run = Bun.spawnSync([resolveBash(process.env, process.platform, existsSync), '-lc', command], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 20 * 60 * 1000,
    });
  } catch (error) {
    // Pas de bash : ce n'est pas un test rouge, le nœud échoue avec de quoi corriger.
    const err = error as Error & { code?: string };
    const hint = err.code === 'ENOENT' ? ' Set ARCHON_BASH_PATH if Git Bash is installed elsewhere.' : '';
    fail(`check: cannot run the test command through bash: ${err.message.replace(/\.$/, '')}.${hint}`);
    return;
  }
  const output = `${run.stdout.toString()}\n${run.stderr.toString()}`;
  const testsPassed = run.exitCode === 0;

  const journalPath = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'implement.md');
  const journal = existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : null;
  const remaining = journal === null ? [] : remainingTasks(journal);

  const problems = [...testProblems(run.exitCode, output, command), ...journalProblems(journal)];
  if (remaining.length > 0) problems.push(`${remaining.length} task(s) still under ## Reste: ${remaining.map((t) => t.replace(/^[-*]\s+/, '')).join(' | ')}`);

  emit({
    ok: problems.length === 0,
    problems,
    summary: text(process.env.INPUTS_SUMMARY),
    tests_passed: testsPassed,
    remaining: remaining.length,
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}

if (import.meta.main) main();
