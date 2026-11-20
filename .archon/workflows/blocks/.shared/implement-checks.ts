/**
 * Règles pures du bloc `implement` : le journal de bord (`## Fait` / `## Reste`) et la
 * lecture du résultat des tests. Le code juge ; l'agent code.
 */

export const JOURNAL_SECTIONS = ['Fait', 'Reste'] as const;

/** Le contenu d'une section `## <titre>` jusqu'au titre de même niveau suivant. */
export function section(content: string, title: string): string | null {
  const match = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm').exec(content);
  return match ? match[1]!.trim() : null;
}

const LIST_ITEM = /^([-*+]|\d+[.)])\s+\S/;
const EMPTY_MARKER = /^(?:[-*+]|\d+[.)])?\s*\(?\s*(rien|aucune?|néant|neant|none|nothing|n\/a)\s*\)?\s*\.?$/i;

/** Les éléments de liste (puces `-`, `*`, `+` ou numéros `1.`, `1)`) d'une section. */
const items = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => LIST_ITEM.test(l));

/**
 * Les tâches encore listées sous `## Reste` : chaque élément de liste, puce ou numéro, et
 * chaque ligne de texte non indentée (une tâche écrite en prose reste une tâche). Seul un
 * marqueur explicite de vide ne compte pas : « (rien) », « - Aucune », « Néant. », « none ».
 */
export function remainingTasks(content: string): string[] {
  const rest = section(content, 'Reste');
  if (!rest) return [];
  return rest
    .split('\n')
    .filter((line) => line.trim() !== '' && !/^\s{2,}\S/.test(line) && !/^#/.test(line.trim()))
    .map((line) => line.trim())
    .filter((line) => !EMPTY_MARKER.test(line));
}

/** Les tâches consignées sous `## Fait`. */
export function doneTasks(content: string): string[] {
  const done = section(content, 'Fait');
  return done ? items(done) : [];
}

export function journalProblems(content: string | null): string[] {
  if (content === null) return ['journal not found: write the journal with ## Fait and ## Reste'];
  const problems: string[] = [];
  for (const title of JOURNAL_SECTIONS) {
    if (section(content, title) === null) problems.push(`journal: section "## ${title}" missing`);
  }
  if (problems.length === 0 && doneTasks(content).length === 0) problems.push('journal: "## Fait" lists nothing: record the task done this turn');
  return problems;
}

/** Lecture du résultat de la commande de tests : code de sortie et fin de sortie. */
export function testProblems(exitCode: number | null, output: string, command: string, tailLines = 15): string[] {
  if (exitCode === 0) return [];
  const tail = output.trim().split('\n').slice(-tailLines).join('\n');
  if (exitCode === null) return [`test command did not finish (\`${command}\`): ${tail}`];
  return [`tests failed (exit ${exitCode}, \`${command}\`):\n${tail}`];
}
