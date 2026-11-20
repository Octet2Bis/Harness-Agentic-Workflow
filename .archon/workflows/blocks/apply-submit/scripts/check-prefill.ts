/**
 * Contrôle du formulaire rempli (avant tout clic) : lit `$ARTIFACTS_DIR/<out_dir>/prefill.json`,
 * l'e-mail de `candidate.json`, vérifie la capture, et applique `evaluatePrefill`.
 *
 * Liaisons : INPUTS_CANDIDATE (chemin), INPUTS_METHOD, INPUTS_OUT_DIR, INPUTS_SUMMARY,
 * INPUTS_BLOCKED, INPUTS_BLOCKER (relayés / ajoutés aux problèmes) ; INPUTS_TRIES, le numéro
 * du tour précédent (vide au premier), d'où `tries` : la boucle s'arrête au plafond même si
 * `ok` reste faux, et le verdict dit alors `unconverged` (rien n'est envoyé) ;
 * INPUTS_SUBMITTED_BEFORE, le `submitted_early` du tour précédent ;
 * INPUTS_APPLY_URL, INPUTS_PLATFORM (les hôtes autorisés, `hostPolicy`, et le passage de main
 * Workday, `applicationForm` : le même calcul que le nœud `target`) ; INPUTS_MODE,
 * INPUTS_VERIFIED_PLATFORMS (un go suivra-t-il ? le calcul de `gate`) ; INPUTS_CV, INPUTS_LETTER
 * (la lettre, vide sans lettre) ; INPUTS_PITCH, INPUTS_PROFILE, INPUTS_ANSWERS_FILE (les sources
 * permises des réponses libres, chemins lus ici, vides ou absents tolérés).
 *
 * `submitted_early` : l'agent dit avoir déjà envoyé le formulaire (prefill.json
 * `submitted: true`), à ce tour ou à un tour précédent (le drapeau ne retombe jamais). La
 * boucle s'arrête alors tout de suite, `ok` est faux, `decide` ne clique jamais, et le verdict
 * rend `unproven`, `submitted: true`. C'est la seule trace qu'a le code : un clic que l'agent
 * tait ne se voit pas ici (seulement sur la capture, que l'humain voit au go).
 *
 * `summary` : celui de l'agent, suivi du récapitulatif du code (`prefillRecap`) que le go
 * montre à Antoine : d'où vient chaque réponse libre, ce qui reste « à remplir par Antoine », la
 * lettre. Une question sans réponse ne rougit le formulaire que si aucun go ne suit : sinon
 * c'est Antoine qui la remplit, dans l'onglet resté ouvert.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, flag, nextTry, text } from '../../.shared/io.ts';
import { applicationForm, hostPolicy, needsHumanGo, parseSubmitMode, parseVerifiedPlatforms } from '../../.shared/platforms.ts';
import { evaluatePrefill, letterTextPath, parseAnswers, parseJsonObject } from '../../.shared/submission-checks.ts';

/** Le texte d'un fichier facultatif : null s'il n'est pas donné, absent ou illisible. */
const readOptional = (path: string): string | null => {
  try {
    return path !== '' && existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
};

const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'submission');
const candidatePath = text(process.env.INPUTS_CANDIDATE);
const candidate = parseJsonObject(existsSync(candidatePath) ? readFileSync(candidatePath, 'utf8') : null);
const email = typeof candidate?.email === 'string' ? candidate.email : '';
const method = text(process.env.INPUTS_METHOD) || 'form';
const prefill = parseJsonObject(existsSync(join(dir, 'prefill.json')) ? readFileSync(join(dir, 'prefill.json'), 'utf8') : null);
const screenshot = typeof prefill?.screenshot === 'string' && prefill.screenshot !== '' ? prefill.screenshot : 'prefill.png';
const applyUrl = text(process.env.INPUTS_APPLY_URL).trim();
const platform = text(process.env.INPUTS_PLATFORM).trim() || 'unknown';
const form = applicationForm(applyUrl, platform);
const letter = text(process.env.INPUTS_LETTER).trim();
const onPage = method === 'form' || method === 'easy_apply';

const result = evaluatePrefill(prefill, {
  email,
  requireCv: onPage,
  screenshotExists: existsSync(join(dir, screenshot)),
  hosts: onPage ? hostPolicy(applyUrl, platform) : undefined,
  handover: form.handover ? form.how : undefined,
  humanGo: needsHumanGo(parseSubmitMode(text(process.env.INPUTS_MODE)), platform, parseVerifiedPlatforms(text(process.env.INPUTS_VERIFIED_PLATFORMS))),
  sources: {
    candidate,
    answers: parseAnswers(readOptional(text(process.env.INPUTS_ANSWERS_FILE).trim()) ?? ''),
    profile: readOptional(text(process.env.INPUTS_PROFILE).trim()),
    pitch: readOptional(text(process.env.INPUTS_PITCH).trim()),
    letterText: readOptional(letterTextPath(letter)),
  },
  letter,
  cv: text(process.env.INPUTS_CV).trim(),
});
const problems = [...result.problems];
const submittedEarly = prefill?.submitted === true || flag(process.env.INPUTS_SUBMITTED_BEFORE);
if (submittedEarly && prefill?.submitted !== true) {
  problems.unshift('an earlier round reported the form as already submitted; nothing more may be clicked');
}
if (candidate === null) problems.unshift(`candidate.json not found or invalid at "${candidatePath}"`);
if (flag(process.env.INPUTS_BLOCKED) && !problems.some((problem) => problem.startsWith('blocked'))) {
  problems.push(`agent reported a blocker: ${text(process.env.INPUTS_BLOCKER) || 'no reason given'}`);
}
emit({
  ok: problems.length === 0 && !submittedEarly,
  problems,
  summary: [text(process.env.INPUTS_SUMMARY).trim(), result.recap].filter((part) => part !== '').join('\n'),
  filled: result.filled,
  attached: result.attached,
  submitted_early: submittedEarly,
  tries: nextTry(process.env.INPUTS_TRIES),
});
