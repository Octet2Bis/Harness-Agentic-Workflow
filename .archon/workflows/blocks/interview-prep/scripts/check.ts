/**
 * Contrôle déterministe de la préparation d'entretien écrite par l'agent dans
 * `$ARTIFACTS_DIR/<out>` (défaut `interview-prep.md`). Les règles sont dans
 * `.shared/interview-checks.ts` (pures, testées) ; ici on lit le livrable et les pièces du
 * dossier : profil maître, offre et annonce, CV et pitch envoyés, notes, remarques.
 *
 * Les pièces viennent des entrées explicites d'abord, sinon du dossier de candidature
 * (`applications/<slug>/`, entrée `application`) : `offer.json`, `annonce.md|txt`,
 * `CV_*.md`, `Message_Accroche_*.md`, `interlocuteur_cible.json`,
 * `remarques_utilisateur.txt` (`pickApplicationFiles`, testé dans `check.test.ts`). Sans
 * offre dans le dossier, l'offre est celle du tableau, `pending_gold_jobs.json` deux dossiers
 * plus haut (`<career_dir>/applications/<slug>/` → `<career_dir>/`), lue sans être modifiée
 * (`offerFromBoard`).
 *
 * Liaisons (`with:`) : INPUTS_APPLICATION, INPUTS_OFFER (JSON texte), INPUTS_POSTING,
 * INPUTS_PROFILE, INPUTS_CV, INPUTS_PITCH (chemins), INPUTS_STAGE, INPUTS_RESEARCH (texte ou
 * chemin), INPUTS_MIN_STORIES, INPUTS_MIN_COVERAGE, INPUTS_OUT ; INPUTS_SUMMARY et
 * INPUTS_DELIVERABLE (relayés) ; INPUTS_TRIES, le numéro du tour précédent (vide au
 * premier), d'où `tries` : la boucle s'arrête au plafond même si `ok` reste faux.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DEFAULT_PREP_RULES, checkInterviewPrep } from '../../.shared/interview-checks.ts';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';

export interface Offer {
  company: string;
  title: string;
  keywords: string;
  skills_required: string;
  /** Le texte de l'annonce que l'offre porte : `description_full`, sinon `description`. */
  posting: string;
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

/** L'offre en JSON texte (celle de `pending_gold_jobs.json`, ou `offer.json` d'un run `career-apply`). */
export function readOffer(raw: string): Offer {
  const empty: Offer = { company: '', title: '', keywords: '', skills_required: '', posting: '' };
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return empty;
    const offer = value as Record<string, unknown>;
    const field = (...keys: string[]): string => {
      for (const key of keys) if (typeof offer[key] === 'string' && (offer[key] as string).trim() !== '') return decodeEntities(offer[key] as string);
      return '';
    };
    return {
      company: field('company'),
      title: field('title', 'job_title'),
      keywords: field('keywords'),
      skills_required: field('skills_required'),
      posting: field('description_full', 'description'),
    };
  } catch {
    return empty;
  }
}

/**
 * L'offre `slug` du tableau (`pending_gold_jobs.json`, liste d'offres), en JSON texte pour
 * `readOffer`, ou chaîne vide. Le tableau ne porte que le résumé (`description`), pas
 * l'annonce lue (`description_full`, dans `offer.json` du run `career-apply`).
 */
export function offerFromBoard(raw: string, slug: string): string {
  try {
    const jobs = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
    if (!Array.isArray(jobs) || slug.trim() === '') return '';
    const wanted = slug.trim().toLowerCase();
    const job = jobs.find((entry) => entry !== null && typeof entry === 'object' && String((entry as { slug?: unknown }).slug ?? '').toLowerCase() === wanted);
    return job === undefined ? '' : JSON.stringify(job);
  } catch {
    return '';
  }
}

/** Les mots-clés de l'offre (`keywords`, sinon `skills_required`), séparés par virgule, point-virgule ou saut de ligne. */
export function parseKeywords(offer: Offer): string[] {
  const source = offer.keywords.trim() !== '' ? offer.keywords : offer.skills_required;
  return [...new Set(source.split(/[,;\n]/).map((k) => k.trim()).filter((k) => k !== ''))];
}

export interface ApplicationFiles {
  offer?: string;
  posting?: string;
  cv?: string;
  pitch?: string;
  contact?: string;
  remarks?: string;
}

/**
 * Les pièces d'un dossier `applications/<slug>/`, d'après les noms que `career-apply`
 * (`record`) et le bot Telegram y écrivent : `CV_<nom>_<slug>.md`, `Message_Accroche_<slug>.md`,
 * `interlocuteur_cible.json`, `remarques_utilisateur.txt` ; plus `offer.json` et
 * `annonce.md|txt` quand l'appelant les y a déposés. `CV.md` et `pitch.md` (les noms dans les
 * artefacts de `cv-tailor`) sont acceptés aussi. Le premier nom trié l'emporte.
 */
export function pickApplicationFiles(names: string[]): ApplicationFiles {
  const sorted = [...names].sort();
  const first = (pattern: RegExp): string | undefined => sorted.find((name) => pattern.test(name));
  return {
    offer: first(/^offer\.json$/i),
    posting: first(/^(annonce|posting|job_posting)\.(md|txt)$/i),
    cv: first(/^CV_.+\.md$/i) ?? first(/^CV\.md$/i),
    pitch: first(/^Message_Accroche_.+\.md$/i) ?? first(/^pitch\.md$/i),
    contact: first(/^interlocuteur_cible\.json$/i),
    remarks: first(/^remarques_utilisateur\.txt$/i),
  };
}

/** Une entrée qui est soit un chemin de fichier, soit le texte lui-même (notes de recherche). */
export function textOrFile(value: string, read: (path: string) => string | null): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes('\n') || trimmed.length > 1024) return trimmed;
  return read(trimmed) ?? trimmed;
}

function readFile(path: string): string | null {
  try {
    return path !== '' && existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const appDir = text(process.env.INPUTS_APPLICATION).trim();
  let names: string[] = [];
  try {
    names = appDir !== '' && existsSync(appDir) ? readdirSync(appDir) : [];
  } catch {
    names = [];
  }
  const picked = pickApplicationFiles(names);
  const inFolder = (name: string | undefined): string => (name ? join(appDir, name) : '');
  const explicitOffer = text(process.env.INPUTS_OFFER).trim();
  const boardOffer = (): string => (appDir === '' ? '' : offerFromBoard(readFile(join(dirname(dirname(appDir)), 'pending_gold_jobs.json')) ?? '', basename(appDir)));
  const offer = readOffer(explicitOffer || readFile(inFolder(picked.offer)) || boardOffer());
  const contact = readOffer(readFile(inFolder(picked.contact)) ?? '');
  const company = offer.company || contact.company;
  const postingPath = text(process.env.INPUTS_POSTING).trim() || inFolder(picked.posting);
  const posting = [readFile(postingPath) ?? '', offer.posting].filter((p) => p.trim() !== '').join('\n\n');
  const profilePath = text(process.env.INPUTS_PROFILE).trim();
  const profile = readFile(profilePath) ?? '';
  const cv = readFile(text(process.env.INPUTS_CV).trim() || inFolder(picked.cv)) ?? '';
  const pitch = readFile(text(process.env.INPUTS_PITCH).trim() || inFolder(picked.pitch)) ?? '';
  const research = textOrFile(text(process.env.INPUTS_RESEARCH), readFile);
  const remarks = readFile(inFolder(picked.remarks)) ?? '';
  const minStories = Number.parseInt(text(process.env.INPUTS_MIN_STORIES) || '3', 10);
  const minCoverage = Number(text(process.env.INPUTS_MIN_COVERAGE) || '0.5');
  const out = text(process.env.INPUTS_OUT) || 'interview-prep.md';

  const result = checkInterviewPrep(readFile(join(artifactsDir(), out)), {
    ...DEFAULT_PREP_RULES,
    stage: (text(process.env.INPUTS_STAGE) || 'rh').trim().toLowerCase(),
    company,
    profile,
    sources: [posting, cv, pitch, research, remarks, offer.skills_required, offer.keywords],
    cv,
    pitch,
    keywords: parseKeywords(offer),
    minCoverage: Number.isFinite(minCoverage) ? minCoverage : DEFAULT_PREP_RULES.minCoverage,
    minStories: Number.isFinite(minStories) && minStories > 0 ? minStories : DEFAULT_PREP_RULES.minStories,
  });
  // Le chemin lu, pour qu'un humain voie quel profil manquait.
  const problems = result.problems.map((p) => (p.startsWith('profil maître vide') ? `${p} (lu : « ${profilePath} »)` : p));
  emit({
    ok: problems.length === 0,
    problems,
    summary: text(process.env.INPUTS_SUMMARY),
    stories: result.stories,
    coverage: result.coverage,
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
