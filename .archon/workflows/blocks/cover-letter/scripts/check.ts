/**
 * Contrôle déterministe de la lettre écrite par l'agent dans `$ARTIFACTS_DIR/<out_dir>/letter.md`,
 * et son rendu imprimable `letter.html` à côté (le code met en page, l'agent n'écrit jamais
 * de HTML). Les règles sont dans `.shared/letter-checks.ts` (pures, testées) et le rendu dans
 * `.shared/letter-html.ts` (testé) ; ici on lit les fichiers, l'offre, le profil et le CV.
 *
 * Liaisons (`with:`) : INPUTS_OFFER (JSON texte), INPUTS_PROFILE (chemin), INPUTS_CV (chemin
 * du CV sur mesure, facultatif : il donne le nom du candidat), INPUTS_NAME (le nom, s'il est
 * imposé), INPUTS_LANGUAGE (fr | en, vide : celle de l'annonce), INPUTS_OUT_DIR,
 * INPUTS_EVIDENCE (le registre de preuves déclaré par l'agent), INPUTS_SUMMARY et
 * INPUTS_DELIVERABLE (relayés) ; INPUTS_TRIES, le numéro du tour précédent (vide au premier),
 * d'où `tries` : la boucle s'arrête au plafond même si `ok` reste faux.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { DEFAULT_LETTER_RULES, candidateName, checkLetter, expectedLanguage, parseEvidence, readOffer } from '../../.shared/letter-checks.ts';
import { renderLetterHtml } from '../../.shared/letter-html.ts';

function readIfExists(path: string): string | null {
  return path !== '' && existsSync(path) ? readFileSync(path, 'utf8') : null;
}

if (import.meta.main) {
  const offer = readOffer(text(process.env.INPUTS_OFFER));
  const profilePath = text(process.env.INPUTS_PROFILE);
  const profile = readIfExists(profilePath) ?? '';
  const cv = readIfExists(text(process.env.INPUTS_CV)) ?? '';
  const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'application');
  const letter = readIfExists(join(dir, 'letter.md'));
  const evidence = parseEvidence(text(process.env.INPUTS_EVIDENCE));
  const language = expectedLanguage(text(process.env.INPUTS_LANGUAGE), offer.posting);
  const name = candidateName(text(process.env.INPUTS_NAME), cv, profile);
  const result = checkLetter(
    { letter, evidence },
    { ...DEFAULT_LETTER_RULES, company: offer.company, title: offer.title, profile, posting: offer.posting, name, language }
  );
  const problems = [...result.problems];
  if (profile === '') problems.unshift(`profil maître introuvable à « ${profilePath} » : aucun fait ne peut être vérifié`);
  if (letter !== null && letter.trim() !== '') {
    try {
      writeFileSync(join(dir, 'letter.html'), renderLetterHtml(letter, { lang: language }), 'utf8');
    } catch (error) {
      problems.push(`letter.html n'a pas pu être écrit : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  emit({
    ok: problems.length === 0,
    problems,
    summary: text(process.env.INPUTS_SUMMARY),
    language,
    words: result.words,
    lines: result.lines,
    traced: result.traced,
    evidence,
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
