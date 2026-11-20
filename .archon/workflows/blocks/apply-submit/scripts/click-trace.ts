/**
 * Règles pures du « jamais deux clics » (aucune lecture disque, aucune liaison) : ce que
 * `<out_dir>/` dit d'une tentative d'envoi déjà commencée. Testé dans `click-trace.test.ts` ;
 * `arm.ts` et `check-receipt.ts` font les lectures.
 *
 * Les fichiers, dans l'ordre où ils apparaissent :
 * - `armed.json` : écrit par `arm` (script) juste avant de laisser `submit` démarrer ;
 * - `click.json` : écrit par l'agent `submit` juste avant de cliquer (consigne du prompt) ;
 * - `receipt.json`, `receipt.png` : écrits par l'agent `submit` après le clic.
 */

/** Le texte brut de chaque fichier (null s'il est absent) et la présence de la capture. */
export interface AttemptFiles {
  armed: string | null;
  click: string | null;
  receipt: string | null;
  receiptScreenshot: boolean;
}

export interface ArmDecision {
  clear: boolean;
  reason: string;
  evidence: string[];
}

function stampOf(raw: string, key: string): string {
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    const stamp = value !== null && typeof value === 'object' ? value[key] : undefined;
    return typeof stamp === 'string' && stamp.trim() !== '' ? stamp : '';
  } catch {
    return '';
  }
}

/**
 * Ce que `click.json` dit, ou null quand il n'existe pas. Un fichier présent mais illisible
 * compte quand même : l'agent l'écrit juste avant de cliquer, le clic a donc pu avoir lieu.
 */
export function clickRecorded(raw: string | null): string | null {
  if (raw === null) return null;
  const at = stampOf(raw, 'at');
  return at === '' ? 'click.json exists (the submit agent was about to click)' : `click.json records a click attempt at ${at}`;
}

/**
 * `submit` peut-il démarrer ? Seulement si rien, dans `<out_dir>/`, ne montre qu'une tentative
 * a déjà commencé dans ce run. `armed.json` suffit : `arm` l'écrit avant le premier
 * démarrage de `submit`, donc tout nouveau passage d'`arm` (Archon le rejoue à chaque
 * reprise du run, `always_run`) après un `submit` en échec trouve ce fichier et ferme la porte,
 * que l'agent ait écrit `click.json` ou non.
 */
export function armSubmit(files: AttemptFiles): ArmDecision {
  const evidence: string[] = [];
  if (files.armed !== null) {
    const at = stampOf(files.armed, 'at');
    evidence.push(`armed.json: the submit step already started in this run${at === '' ? '' : ` at ${at}`}`);
  }
  const click = clickRecorded(files.click);
  if (click !== null) evidence.push(click);
  if (files.receipt !== null) evidence.push('receipt.json exists (written after a click, or instead of one)');
  if (files.receiptScreenshot) evidence.push('receipt.png exists (taken after the click)');
  if (evidence.length === 0) {
    return { clear: true, reason: 'no earlier submit attempt in this run: submit may click once', evidence: [] };
  }
  return {
    clear: false,
    reason: 'a submit attempt already started in this run (the run was resumed or re-driven after an error): nothing is clicked again',
    evidence,
  };
}
