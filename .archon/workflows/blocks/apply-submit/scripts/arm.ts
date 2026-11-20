/**
 * Le verrou du clic (`arm`) : dernier nœud avant `submit`, `always_run: true`. Archon le rejoue à
 * chaque reprise du run, même s'il a déjà réussi : quand un run échoue après le démarrage de
 * `submit` (erreur du modèle, sortie hors `output_format`), le listener qui reprend relance
 * l'enfant en échec, et Archon rejoue les nœuds en échec, donc `submit` ; ce nœud passe
 * avant lui, trouve `armed.json` et ferme la porte (`clear: false`) : `submit` est sauté et le
 * verdict rend `unproven`, `submitted: true`. Au premier passage, il écrit `armed.json`
 * avant d'ouvrir la porte. La règle (`armSubmit`) est pure, testée (`click-trace.test.ts`).
 *
 * Liaisons : INPUTS_OUT_DIR.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { armSubmit } from './click-trace.ts';

const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'submission');
const readIfAny = (name: string): string | null => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
const arm = armSubmit({
  armed: readIfAny('armed.json'),
  click: readIfAny('click.json'),
  receipt: readIfAny('receipt.json'),
  receiptScreenshot: existsSync(join(dir, 'receipt.png')),
});
if (arm.clear) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'armed.json'), JSON.stringify({ at: new Date().toISOString(), run: process.env.WORKFLOW_ID ?? '' }, null, 2), 'utf8');
}
emit(arm);
