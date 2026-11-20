/**
 * Contrôle déterministe du dossier d'entreprise (`$ARTIFACTS_DIR/<out>`, dossier.md) :
 * règles de `.shared/company-checks.ts` (`checkDossier`, pures, testées). Aucun jugement ici :
 * ce que disent vraiment les sources va au juge.
 *
 * Liaisons (`with:`) : INPUTS_COMPANY (JSON texte, dont `name`), INPUTS_TODAY, INPUTS_OUT,
 * INPUTS_SUMMARY et INPUTS_DELIVERABLE (relayés) ; INPUTS_TRIES, le numéro du tour précédent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDossier } from '../../.shared/company-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

const company = (nullableJson(process.env.INPUTS_COMPANY) ?? {}) as { name?: unknown };
const path = join(artifactsDir(), text(process.env.INPUTS_OUT) || 'dossier.md');
const result = checkDossier(existsSync(path) ? readFileSync(path, 'utf8') : null, typeof company.name === 'string' ? company.name : '', text(process.env.INPUTS_TODAY).trim());
emit({
  ok: result.ok,
  problems: result.problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
