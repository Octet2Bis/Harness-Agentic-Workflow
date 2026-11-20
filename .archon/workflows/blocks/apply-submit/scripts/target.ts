/**
 * Où et comment ouvrir le formulaire, avant tout navigateur : le résultat d'un script, que les
 * agents `prefill` et `submit` suivent au lieu de le deviner. Pur (`.shared/platforms.ts`,
 * testé) ; aucune lecture disque : les fixtures l'exécutent pour de vrai.
 *
 * - `form_url`, `how` : la page à ouvrir (Greenhouse : `embed/job_app` hors de l'iframe ;
 *   Lever : `/apply` ; Ashby : `/application` ; Workable : `/apply/`…) et la marche à suivre ;
 * - `needs_login` : le formulaire est derrière un compte (la session du profil de navigateur,
 *   jamais un compte créé : Workday, SuccessFactors, Taleo, où Antoine crée lui-même son compte dans
 *   ce navigateur) ; `handover` : le harness ne le remplit pas, Antoine postule (aucune plateforme
 *   depuis le 2026-10-24 ; le mécanisme reste) ;
 * - `hosts` : les seuls hôtes où l'agent saisit et clique (`hostPolicy`) ; `check_prefill` et
 *   `check_receipt` refont le même calcul et refusent une page ailleurs ;
 * - `letter`, `letter_text` : la lettre de motivation (vide sans lettre) et sa version texte
 *   (le même nom en `.md`), pour un champ texte.
 *
 * Liaisons : INPUTS_APPLY_URL, INPUTS_PLATFORM, INPUTS_LETTER.
 */

import { emit, text } from '../../.shared/io.ts';
import { applicationForm, hostPolicy } from '../../.shared/platforms.ts';
import { letterTextPath } from '../../.shared/submission-checks.ts';

const applyUrl = text(process.env.INPUTS_APPLY_URL).trim();
const platform = text(process.env.INPUTS_PLATFORM).trim() || 'unknown';
const letter = text(process.env.INPUTS_LETTER).trim();
emit({
  ...applicationForm(applyUrl, platform),
  hosts: hostPolicy(applyUrl, platform).hosts,
  letter,
  letter_text: letterTextPath(letter),
});
