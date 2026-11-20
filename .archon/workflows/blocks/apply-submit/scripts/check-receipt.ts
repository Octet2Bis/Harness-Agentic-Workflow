/**
 * Contrôle du reçu après le clic : lit `$ARTIFACTS_DIR/<out_dir>/receipt.json`, vérifie la
 * capture, applique `evaluateReceipt` (confirmation reconnue pour la plateforme ; clic sur un
 * hôte autorisé, `hostPolicy` : `clicked_url` du reçu, à défaut `url` de click.json).
 *
 * `click.json` (écrit par l'agent `submit` juste avant de cliquer) compte comme un envoi
 * possible : quand un nouvel essai du nœud `submit` (Archon rejoue un nœud agent après une
 * erreur passagère) le trouve, il ne clique pas et rend `clicked: false`, souvent sans reçu ;
 * la candidature est peut-être partie au premier essai. `submitted` est alors vrai et le
 * verdict dit `unproven`, jamais « pas envoyé » (`clickRecorded`, `click-trace.test.ts`).
 * Un clic sur un hôte hors liste n'est jamais prouvé : `unproven`, avec le problème en français.
 *
 * Liaisons : INPUTS_PLATFORM, INPUTS_APPLY_URL, INPUTS_METHOD, INPUTS_OUT_DIR, INPUTS_SUMMARY,
 * INPUTS_CLICKED.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, flag, text } from '../../.shared/io.ts';
import { hostPolicy } from '../../.shared/platforms.ts';
import { evaluateReceipt, parseJsonObject } from '../../.shared/submission-checks.ts';
import { clickRecorded } from './click-trace.ts';

const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'submission');
const platform = text(process.env.INPUTS_PLATFORM) || 'unknown';
const method = text(process.env.INPUTS_METHOD) || 'form';
const receipt = parseJsonObject(existsSync(join(dir, 'receipt.json')) ? readFileSync(join(dir, 'receipt.json'), 'utf8') : null);
const screenshot = typeof receipt?.screenshot === 'string' && receipt.screenshot !== '' ? receipt.screenshot : 'receipt.png';
const clickRaw = existsSync(join(dir, 'click.json')) ? readFileSync(join(dir, 'click.json'), 'utf8') : null;
const clickUrl = parseJsonObject(clickRaw)?.url;
const result = evaluateReceipt(receipt, platform, existsSync(join(dir, screenshot)), {
  hosts: method === 'form' || method === 'easy_apply' ? hostPolicy(text(process.env.INPUTS_APPLY_URL).trim(), platform) : undefined,
  clickUrl: typeof clickUrl === 'string' ? clickUrl : '',
});
const click = clickRecorded(clickRaw);
const problems = [...result.problems];
if (flag(process.env.INPUTS_CLICKED) && !result.submitted) {
  problems.push('the agent reports a click but receipt.json says submitted: false; a human must check the platform');
}
if (click !== null && !result.submitted && !flag(process.env.INPUTS_CLICKED)) {
  problems.push(`${click}, but no receipt confirms it: the application may have been sent; check the mailbox and the platform before any new attempt`);
}
emit({
  ok: problems.length === 0 && result.proven,
  problems,
  submitted: result.submitted || flag(process.env.INPUTS_CLICKED) || click !== null,
  proven: result.proven,
  confirmation: result.confirmation,
  summary: text(process.env.INPUTS_SUMMARY),
});
