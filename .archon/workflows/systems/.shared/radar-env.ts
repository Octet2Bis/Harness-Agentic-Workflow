/**
 * Où le radar trouve ses clés d'API (`career-radar`). Pure, sauf `existingEnvFiles` qui
 * interroge le disque par une fonction injectable. Les clés ne sont jamais lues ici : seuls
 * les CHEMINS des fichiers d'env sont résolus, et `resolveKeys` (`radar/fetchers/index.js`)
 * les lit par NOM de variable, `process.env` d'abord.
 *
 * La chaîne, dans l'ordre :
 *   1. `process.env` (toujours, en premier) ;
 *   2. l'entrée `env_file` du système quand elle est donnée (elle remplace alors la chaîne) ;
 *   3. `<dépôt>/.local/secrets.env` (`.local/` n'est jamais versionné) : toutes les clés, depuis la
 *      migration du 2026-11-13 (plus aucune lecture dans Master Plan).
 * Aucun chemin, aucune valeur de clé n'apparaît dans les sorties des nœuds : seul le NOMBRE
 * de fichiers lus est rendu (`describeEnvChain`).
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** La racine du dépôt, depuis `.archon/workflows/systems/.shared/`. */
export const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

/** Les variables que le radar lit (les mêmes que `ENV_KEY_NAMES` de `radar/fetchers/index.js`). */
export const RADAR_KEY_NAMES = ['JOBDATALAKE_API_KEY', 'APIFY_TOKEN', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JSEARCH_API_KEY', 'FIRECRAWL_API_KEY'] as const;

export interface EnvChainOptions {
  /** L'entrée `env_file` du système ('' : la chaîne par défaut). */
  explicit?: string;
  repoRoot?: string;
  careerDir: string;
}

/** Les fichiers d'env candidats, dans l'ordre de lecture (existants ou non). */
export function envCandidates(options: EnvChainOptions): string[] {
  const explicit = (options.explicit ?? '').trim();
  if (explicit !== '') return [resolve(explicit)];
  const root = options.repoRoot ?? REPO_ROOT;
  return [join(root, '.local', 'secrets.env')];
}

/** Ceux des candidats qui existent, dans le même ordre. */
export function existingEnvFiles(candidates: string[], exists: (path: string) => boolean = existsSync): string[] {
  return candidates.filter((path) => {
    try {
      return exists(path);
    } catch {
      return false;
    }
  });
}

/** Une phrase pour le résumé du nœud : combien de fichiers d'env ont été lus, jamais lesquels ni leur contenu. */
export function describeEnvChain(found: string[], explicit = ''): string {
  if (explicit.trim() !== '' && found.length === 0) return 'env_file not found: keys from process.env only';
  if (found.length === 0) return 'no env file found: keys from process.env only';
  return `keys from process.env then ${found.length} env file(s)`;
}
