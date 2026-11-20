/**
 * Une seule déclaration de « on envoie » : automatique quand aucun go n'était requis,
 * approuvé quand l'humain a dit oui, refusé sinon. Jamais d'envoi sans cran : quand `gate`
 * n'a pas tourné (le formulaire n'a pas passé ses contrôles au plafond de la boucle
 * `prepare`), la décision est `unconverged`, sans envoi. Jamais de second clic : quand
 * `prefill` dit avoir déjà envoyé le formulaire (`submitted_early`), la décision est
 * `submitted_early`, sans envoi, go ou pas. Un refus n'annule pas le run : `submit` est sauté
 * et le verdict rend `refused`. La règle est pure, testée (`decide.test.ts`), exécutée pour de
 * vrai par les fixtures.
 *
 * La décision est aussi écrite dans `$ARTIFACTS_DIR/<out_dir>/decision.json` : si le bloc ne
 * rend pas de verdict (un nœud en aval a échoué), l'appelant y lit que le clic avait été
 * autorisé (`proceed: true`) et ne note pas la candidature « prête, pas envoyée ».
 *
 * Liaisons : INPUTS_NEEDS_GO ("true" / "false", ou "null" si `gate` a été sauté),
 * INPUTS_GO ({ decision, text } ou null si le nœud a été sauté), INPUTS_SUBMITTED_EARLY
 * ("true" quand `prefill` a dit avoir envoyé), INPUTS_OUT_DIR.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';

export interface Go {
  decision: 'approve' | 'reject';
  text: string;
}

export interface Decision {
  proceed: boolean;
  path: 'auto' | 'approved' | 'rejected' | 'unconverged' | 'submitted_early';
  text: string;
}

/**
 * `needsGo` est la sortie de `gate` : null quand le cran n'a pas tourné. Seul un `false`
 * explicite dispense du go humain ; toute autre valeur l'exige. `submittedEarly` (seul un
 * `true` explicite compte) l'emporte sur tout : rien ne se clique après un envoi signalé.
 */
export function decide(needsGo: unknown, go: Go | null, submittedEarly: unknown = false): Decision {
  if (submittedEarly === true) {
    return { proceed: false, path: 'submitted_early', text: 'prefill reports the form was already submitted: nothing more is clicked' };
  }
  if (needsGo === null) {
    return { proceed: false, path: 'unconverged', text: 'the form never passed its checks: no go was asked and nothing is sent' };
  }
  if (needsGo === false) return { proceed: true, path: 'auto', text: '' };
  if (go?.decision === 'approve') return { proceed: true, path: 'approved', text: go.text ?? '' };
  return { proceed: false, path: 'rejected', text: go?.text ?? 'no answer' };
}

if (import.meta.main) {
  const decision = decide(
    nullableJson(process.env.INPUTS_NEEDS_GO),
    nullableJson(process.env.INPUTS_GO) as Go | null,
    nullableJson(process.env.INPUTS_SUBMITTED_EARLY)
  );
  const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'submission');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'decision.json'), JSON.stringify({ ...decision, at: new Date().toISOString() }, null, 2), 'utf8');
  emit(decision);
}
