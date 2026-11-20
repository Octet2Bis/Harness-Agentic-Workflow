/**
 * Contrôle déterministe de la fiche « à qui écrire » écrite par l'agent dans
 * `$ARTIFACTS_DIR/<out>` (défaut `decideurs.json`). Les règles sont dans
 * `.shared/contact-checks.ts` (pures, testées) ; ici on lit le livrable et les pièces du
 * dossier : profil maître, offre et annonce, CV et pitch s'ils existent déjà.
 *
 * Les pièces viennent des entrées explicites d'abord, sinon du dossier de candidature
 * (`applications/<slug>/`, entrée `application`), avec les lecteurs du bloc `interview-prep`
 * (`pickApplicationFiles`, `readOffer`, `offerFromBoard`, importés, testés là-bas) : sans offre
 * dans le dossier, l'offre est celle du tableau, `pending_gold_jobs.json` deux dossiers plus
 * haut, lue sans être modifiée. Le dossier peut ne porter encore aucun CV (run `career-apply`
 * en pause au go, avant `record`) : le CV ne sert qu'à lire le nom du candidat, que le profil
 * donne aussi.
 *
 * Liaisons (`with:`) : INPUTS_APPLICATION, INPUTS_OFFER (JSON texte), INPUTS_PROFILE,
 * INPUTS_CV, INPUTS_PITCH (chemins), INPUTS_MAX_PEOPLE, INPUTS_OUT ; INPUTS_SUMMARY et
 * INPUTS_DELIVERABLE (relayés) ; INPUTS_TRIES, le numéro du tour précédent (vide au
 * premier), d'où `tries` : la boucle s'arrête au plafond même si `ok` reste faux.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_CONTACT_RULES, type ContactRules, checkDecideurs } from '../../.shared/contact-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { type Language, candidateName, expectedLanguage } from '../../.shared/letter-checks.ts';
import { offerFromBoard, pickApplicationFiles, readOffer } from '../../interview-prep/scripts/check.ts';

export interface Explicit {
  application: string;
  offer: string;
  profile: string;
  cv: string;
  pitch: string;
}

export interface Pieces {
  company: string;
  title: string;
  /** L'annonce (annonce.* du dossier, puis `description_full` ou `description` de l'offre) et les champs de l'offre. */
  posting: string;
  language: Language;
  profile: string;
  cv: string;
  pitch: string;
  candidate: string;
}

/** Un fichier lisible, ou `null` (absent, dossier, illisible). */
export function readFile(path: string): string | null {
  try {
    return path !== '' && existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

function listDir(dir: string): string[] {
  try {
    return dir !== '' && existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

/**
 * Les pièces d'une candidature : les entrées explicites priment, puis le dossier
 * `applications/<slug>/`, puis le tableau. CV et pitch sont facultatifs.
 */
export function gatherPieces(input: Explicit, read: (path: string) => string | null = readFile, list: (dir: string) => string[] = listDir): Pieces {
  const appDir = input.application.trim();
  const picked = pickApplicationFiles(list(appDir));
  const inFolder = (name: string | undefined): string => (name && appDir !== '' ? join(appDir, name) : '');
  const boardOffer = (): string => (appDir === '' ? '' : offerFromBoard(read(join(dirname(dirname(appDir)), 'pending_gold_jobs.json')) ?? '', basename(appDir)));
  const offer = readOffer(input.offer.trim() || read(inFolder(picked.offer)) || boardOffer());
  const contact = readOffer(read(inFolder(picked.contact)) ?? '');
  const annonce = read(inFolder(picked.posting)) ?? '';
  const posting = [annonce, offer.posting].filter((p) => p.trim() !== '').join('\n\n');
  const profile = read(input.profile.trim()) ?? '';
  const cv = read(input.cv.trim() || inFolder(picked.cv)) ?? '';
  const pitch = read(input.pitch.trim() || inFolder(picked.pitch)) ?? '';
  return {
    company: offer.company || contact.company,
    title: offer.title || contact.title,
    posting: [posting, offer.title, offer.skills_required, offer.keywords].filter((p) => p.trim() !== '').join('\n'),
    language: expectedLanguage('', posting),
    profile,
    cv,
    pitch,
    candidate: candidateName('', cv, profile),
  };
}

/** Le plafond de personnes : l'entrée `max_people` (1 à 10), sinon 4. */
export function maxPeople(raw: string): number {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : DEFAULT_CONTACT_RULES.maxPeople;
}

export function contactRules(pieces: Pieces, max: number): ContactRules {
  return {
    ...DEFAULT_CONTACT_RULES,
    company: pieces.company,
    title: pieces.title,
    language: pieces.language,
    profile: pieces.profile,
    posting: pieces.posting,
    candidate: pieces.candidate,
    maxPeople: max,
  };
}

if (import.meta.main) {
  const profilePath = text(process.env.INPUTS_PROFILE).trim();
  const pieces = gatherPieces({
    application: text(process.env.INPUTS_APPLICATION),
    offer: text(process.env.INPUTS_OFFER),
    profile: profilePath,
    cv: text(process.env.INPUTS_CV),
    pitch: text(process.env.INPUTS_PITCH),
  });
  const out = text(process.env.INPUTS_OUT).trim() || 'decideurs.json';
  const result = checkDecideurs(readFile(join(artifactsDir(), out)), contactRules(pieces, maxPeople(text(process.env.INPUTS_MAX_PEOPLE))));
  // Le chemin lu, pour qu'un humain voie quel profil manquait.
  const problems = result.problems.map((p) => (p.startsWith('profil maître vide') ? `${p} (lu : « ${profilePath} »)` : p));
  emit({
    ok: problems.length === 0,
    problems,
    summary: text(process.env.INPUTS_SUMMARY),
    people: result.people,
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
