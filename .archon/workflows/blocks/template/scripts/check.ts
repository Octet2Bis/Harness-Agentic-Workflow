/**
 * Contrôle déterministe du livrable : lit `$ARTIFACTS_DIR/deliverable.md` et applique
 * les règles du bloc. Aucun jugement ici : ce que le code ne peut pas trancher va au juge.
 *
 * Liaisons (`with:`) : INPUTS_SUMMARY, INPUTS_DELIVERABLE (pointeur d'artefact certifié
 * par le nœud `work`), toutes deux relayées telles quelles dans la sortie pour que le
 * verdict les lise depuis `$produce.output` ; INPUTS_TRIES, le numéro du tour précédent
 * (vide au premier), d'où `tries` : la boucle s'arrête au plafond même si `ok` reste faux.
 *
 * GABARIT : adapte RULES au métier du bloc (sections attendues, longueur minimale).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CheckRules, DEFAULT_RULES, evaluateDeliverable } from '../../.shared/deliverable-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const RULES: CheckRules = {
  ...DEFAULT_RULES,
  requiredSections: [],
  minChars: 200,
};

export function readDeliverable(dir: string): string | null {
  const path = join(dir, text(process.env.INPUTS_OUT) || 'deliverable.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

if (import.meta.main) {
  const result = evaluateDeliverable(readDeliverable(artifactsDir()), RULES);
  emit({
    ok: result.ok,
    problems: result.problems,
    summary: text(process.env.INPUTS_SUMMARY),
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
