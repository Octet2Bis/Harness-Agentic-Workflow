/**
 * Contrat partagé par les scripts du pack `systems` (copie de blocks/.shared/io.ts :
 * un pack n'importe que depuis son propre `.shared/`).
 */

export function text(value: string | undefined): string {
  return value ?? '';
}

export function nullableJson(value: string | undefined): unknown {
  const raw = (value ?? '').trim();
  if (raw === '' || raw === 'null') return null;
  return JSON.parse(raw) as unknown;
}

export function flag(value: string | undefined): boolean {
  return (value ?? '').trim() === 'true';
}

export function artifactsDir(): string {
  const value = process.env.ARTIFACTS_DIR;
  if (value === undefined || value === '') {
    throw new Error('ARTIFACTS_DIR is not set; the engine supplies it to every exec node.');
  }
  return value;
}

export function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

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
