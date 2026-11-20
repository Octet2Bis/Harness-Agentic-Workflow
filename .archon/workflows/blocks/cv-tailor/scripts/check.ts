/**
 * Contrôle déterministe du dossier de candidature écrit par le Drafter dans
 * `$ARTIFACTS_DIR/<out_dir>/` : CV.md, pitch.md, candidate.json. Les règles sont dans
 * `.shared/cv-checks.ts` (pures, testées) ; ici on lit les fichiers, l'offre et le profil.
 * Le profil maître est la seule source des faits : chiffres, portées (B2B, P&L, budget,
 * management, clients nommés) ; l'entreprise et l'intitulé de l'offre sont retirés du CV
 * avant d'y chercher une portée, puisque l'en-tête les recopie.
 *
 * Liaisons (`with:`) : INPUTS_OFFER (JSON texte), INPUTS_PROFILE (chemin), INPUTS_KEYWORDS,
 * INPUTS_MIN_COVERAGE, INPUTS_OUT_DIR, INPUTS_SUMMARY et INPUTS_DELIVERABLE (relayés) ;
 * INPUTS_TRIES, le numéro du tour précédent (vide au premier), d'où `tries` : la boucle
 * s'arrête au plafond même si `ok` reste faux.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASH_BUDGET, DEFAULT_SLOP, ONE_PAGE, checkApplication } from '../../.shared/cv-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

export interface Offer {
  company?: string;
  title?: string;
  skills_required?: string;
  keywords?: string;
}

/** Les offres scrapées portent des entités HTML (`&amp;`, `&#39;`) : on les décode avant de comparer. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function readOffer(raw: string): Offer {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const offer = value as Record<string, unknown>;
    const field = (key: string): string | undefined => (typeof offer[key] === 'string' ? decodeEntities(offer[key] as string) : undefined);
    return { company: field('company'), title: field('title'), skills_required: field('skills_required'), keywords: field('keywords') };
  } catch {
    return {};
  }
}

/** Les mots-clés explicites, sinon ceux de l'offre, sinon `skills_required` ; séparés par virgule, point-virgule ou saut de ligne. */
export function parseKeywords(explicit: string, offer: Offer): string[] {
  const source = explicit.trim() !== '' ? explicit : (offer.keywords ?? offer.skills_required ?? '');
  return [...new Set(source.split(/[,;\n]/).map((keyword) => keyword.trim()).filter((keyword) => keyword !== ''))];
}

export const REQUIRED_SECTIONS = ['Profil|Profile', 'Expériences|Experience|Experiences', 'Compétences|Skills'];

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

if (import.meta.main) {
  const offer = readOffer(text(process.env.INPUTS_OFFER));
  const profilePath = text(process.env.INPUTS_PROFILE);
  const profile = readIfExists(profilePath) ?? '';
  const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'application');
  const minCoverage = Number(text(process.env.INPUTS_MIN_COVERAGE) || '0.7');
  let candidate: unknown = null;
  const candidateRaw = readIfExists(join(dir, 'candidate.json'));
  if (candidateRaw !== null) {
    try {
      candidate = JSON.parse(candidateRaw);
    } catch {
      candidate = null;
    }
  }
  const result = checkApplication(
    { cv: readIfExists(join(dir, 'CV.md')), pitch: readIfExists(join(dir, 'pitch.md')), candidate },
    {
      company: offer.company ?? '',
      title: offer.title ?? '',
      keywords: parseKeywords(text(process.env.INPUTS_KEYWORDS), offer),
      minCoverage: Number.isFinite(minCoverage) ? minCoverage : 0.7,
      requiredSections: REQUIRED_SECTIONS,
      profile,
      pageBudget: ONE_PAGE,
      maxPitchWords: 180,
      slop: DEFAULT_SLOP,
      dashBudget: DASH_BUDGET,
    }
  );
  const problems = [...result.problems];
  if (profile === '') problems.unshift(`master profile not found at "${profilePath}": no fact can be checked`);
  emit({
    ok: problems.length === 0,
    problems,
    summary: text(process.env.INPUTS_SUMMARY),
    coverage: result.coverage,
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
