/**
 * Contrôle déterministe de la proposition (`$ARTIFACTS_DIR/<out>`, proposal.md) : règles de
 * `.shared/company-checks.ts` (`checkProposal`, pures, testées) contre le dossier vérifié
 * (`$ARTIFACTS_DIR/<dossier>`) et le profil du candidat (chemin absolu). Aucun jugement ici.
 *
 * Liaisons (`with:`) : INPUTS_DOSSIER, INPUTS_PROFILE, INPUTS_FORMULAS, INPUTS_OUT,
 * INPUTS_SUMMARY et INPUTS_DELIVERABLE (relayés) ; INPUTS_TRIES, le numéro du tour précédent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkProposal } from '../../.shared/company-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

function readIfExists(path: string): string | null {
  return path !== '' && existsSync(path) ? readFileSync(path, 'utf8') : null;
}

const dir = artifactsDir();
const dossier = readIfExists(join(dir, text(process.env.INPUTS_DOSSIER) || 'dossier.md'));
const profile = readIfExists(text(process.env.INPUTS_PROFILE).trim());
const formulas = text(process.env.INPUTS_FORMULAS).split(',').map((f) => f.trim()).filter(Boolean);
const problems: string[] = [];
if (dossier === null) problems.push('the company dossier is missing from the run\'s artifacts (caller error)');
if (profile === null) problems.push('the candidate profile file is missing (caller error)');
const result = dossier !== null && profile !== null
  ? checkProposal(readIfExists(join(dir, text(process.env.INPUTS_OUT) || 'proposal.md')), { dossier, profile, formulas: formulas.length > 0 ? formulas : ['CDI', 'freelance', 'portage'] })
  : { ok: false, problems: [] };
problems.push(...result.problems);
emit({
  ok: problems.length === 0,
  problems,
  summary: text(process.env.INPUTS_SUMMARY),
  deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
  tries: nextTry(process.env.INPUTS_TRIES),
});
