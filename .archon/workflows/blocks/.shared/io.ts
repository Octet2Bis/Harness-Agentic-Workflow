/**
 * Contrat partagé par tous les scripts déterministes du pack `blocks`.
 *
 * Un script reçoit ses liaisons `with:` sous forme de variables d'environnement
 * `INPUTS_<NOM_EN_MAJUSCULES>`, toujours en texte : un booléen arrive en "true"/"false",
 * un objet ou un tableau en JSON canonique, un producteur sauté (`if_skipped: null`) en "null".
 *
 * Règles (héritées du pack sdlc d'Archon) :
 * - lire chaque liaison sous la forme littérale `process.env.INPUTS_<NOM>` dans le script
 *   lui-même : le moteur scanne le source au chargement et refuse un script qui lit une
 *   liaison qu'aucun `with:` ne fournit ;
 * - ne jamais appeler `process.exit()` : Bun quitte sans vider stdout. On positionne
 *   `process.exitCode` et on laisse le runtime terminer.
 */

/** La valeur d'une liaison, ou la chaîne vide quand elle est absente. */
export function text(value: string | undefined): string {
  return value ?? '';
}

/** Une liaison JSON qui peut être nulle ou absente. */
export function nullableJson(value: string | undefined): unknown {
  const raw = (value ?? '').trim();
  if (raw === '' || raw === 'null') return null;
  return JSON.parse(raw) as unknown;
}

/** Une liaison booléenne ("true" exactement). */
export function flag(value: string | undefined): boolean {
  return (value ?? '').trim() === 'true';
}

/**
 * Le numéro du tour de contrôle en cours. La liaison `tries` porte celui du tour précédent
 * (`$LOOP_PREV.check.output.tries`, vide au premier tour). La boucle s'arrête quand les
 * contrôles passent ou quand ce compteur atteint son plafond : elle rend toujours la main,
 * et le verdict dit `unconverged` au lieu d'un nœud en échec que le moteur rejouerait.
 */
export function nextTry(previous: string | undefined): number {
  const n = Number.parseInt((previous ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n + 1 : 1;
}

/** Le dossier d'artefacts du run, fourni par le moteur à chaque nœud exécutable. */
export function artifactsDir(): string {
  const value = process.env.ARTIFACTS_DIR;
  if (value === undefined || value === '') {
    throw new Error('ARTIFACTS_DIR is not set; the engine supplies it to every exec node.');
  }
  return value;
}

/** Écrit la sortie typée du nœud : un seul document JSON sur stdout. */
export function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** Signale un échec au moteur sans couper stdout. */
export function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

/** Un pointeur d'artefact Archon : `{ type: "archon_artifact", run_id, path }`, `path` relatif aux artefacts du run. */
export interface ArtifactPointer {
  type: 'archon_artifact';
  run_id: string;
  path: string;
}

/**
 * Le pointeur `archon_artifact` qu'un script rend vers un fichier des artefacts de ce run.
 * Archon vérifie chaque pointeur au moment où il est produit : `path` doit être relatif,
 * sans `..`, et désigner un fichier régulier non vide — jamais un dossier (premier run réel,
 * 2026-10-22 : « does not refer to a regular file »). Ici on refuse ce qui ne nomme pas un
 * fichier (`<nom>.<ext>`) ; l'existence, c'est le moteur qui la prouve.
 */
export function artifactPointer(path: string): ArtifactPointer {
  const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const name = clean.split('/').pop() ?? '';
  if (clean === '' || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) {
    throw new Error(`artifact pointer "${path}": the path must be relative to the run's artifacts directory`);
  }
  if (clean.split('/').includes('..')) throw new Error(`artifact pointer "${path}": no '..' segment`);
  if (!/^[^.\s][^/]*\.[A-Za-z0-9]+$/.test(name)) {
    throw new Error(`artifact pointer "${path}": must name a regular file (<name>.<ext>), never a directory — Archon refuses the node otherwise`);
  }
  return { type: 'archon_artifact', run_id: process.env.WORKFLOW_ID ?? 'unknown-run', path: clean };
}
