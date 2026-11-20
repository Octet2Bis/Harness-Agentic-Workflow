/**
 * Choisit l'offre à trier et prépare ce que le bloc `job-triage` lit : `criteres.json` du
 * dossier carrière (obligatoire : aucun critère par défaut caché), l'offre (celle de `key`, sinon
 * la plus récente qui attend son tri : `pickUntriaged`), et l'annonce relue en ligne, écrite
 * dans `posting.txt` des artefacts avec les champs du radar (`postingText`). Si la page ne
 * contient pas l'annonce (connexion, erreur, délai), le résumé du radar sert de texte et
 * `posting_full` vaut "false" : l'offre pourra être écartée sur ce qui a été lu, jamais retenue.
 * N'écrit rien dans le dossier carrière. L'offre passée au bloc porte `date_published` (et
 * `radar_at`) : une offre plus vieille que `offre_age_max_jours` (7 jours par défaut) y est écartée.
 *
 * Lecture de la page (`fetchPage`) : en-têtes de navigateur (User-Agent Chrome, Accept,
 * Accept-Language fr-FR), comme le radar (`systems/.shared/radar/fetchers/common.js`, qui lit
 * WTTJ depuis le PC), redirections suivies ; l'ancien `Mozilla/5.0 (harness career-triage)`
 * rendait, pour une page WTTJ pourtant publique, un texte sans annonce (`posting_full: false`,
 * 2026-10-23). Puis (`readPosting`) : quand la page porte un `<script type="application/ld+json">`
 * JobPosting (WTTJ, la plupart des ATS), son `description` (HTML retiré), son titre, sa date
 * limite, son salaire et son expérience requise servent de texte, c'est l'annonce telle que
 * l'éditeur la publie, sans habillage de page ; sinon le texte visible de la page (`visibleText`).
 *
 * Les liens lus, dans l'ordre : `posting_url` (la page de l'annonce quand l'ATS la distingue du
 * formulaire de candidature, Apify) puis `link`. Si aucune page ne contient l'annonce, la
 * description complète que l'API source a donnée au radar (`description_full`) sert de texte
 * (`posting_full` "true") ; à défaut, l'annonce complète que le radar unifié de la VM a lue à la
 * relève (`postings/<clé>.txt`, `storedPostingBody`, 2026-11-08 : une page LinkedIn expirée ou
 * tronquée depuis) ; sinon le résumé du radar. Quand il ne reste pas
 * `MIN_READABLE_CHARS` caractères à lire (page fermée et résumé vide : Jobdatalake, Jobgether,
 * Apify sur Workday), `readable` vaut false et `unreadable_reason` dit pourquoi : le bloc est
 * sauté, l'offre est « à vérifier » (« Annonce illisible : … ») sans trois tours d'Opus perdus.
 *
 * Mode économe (2026-10-24) : une offre que le code tranche seul (`preScreen` : publiée il y a
 * plus de `offre_age_max_jours` jours, ou entreprise contredite par le lien LinkedIn) n'est ni
 * relue en ligne ni donnée au bloc :
 * `pre_screened` vrai, `pre_screen_reason` la raison de la règle, aucun appel de modèle. Le profil
 * du candidat (`<career_dir>/master_profile.md`), quand il existe et n'est pas vide, est copié
 * dans `profile.md` des artefacts (`profile_file`) : le bloc y juge le cœur du poste ; absent,
 * `profile_file` est vide et l'adéquation n'est pas évaluée.
 *
 * Liaisons : INPUTS_CAREER_DIR, INPUTS_KEY, INPUTS_ENGINE (`rules`, `local` ou `llm` : une offre triée par `rules` attend un tri `local` ou `llm`, une offre triée par `local` un tri `llm`).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEntities, visibleText } from '../../.shared/career.ts';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { boardPathIn } from '../../.shared/pending.ts';
import { addedByHand, choosePosting, criteriaHash, criteriaPathIn, pickUntriaged, postingReadable, readTriageEngine, postingText, preScreen, profilePathIn, readTriageRecords, storedPostingBody, storedPostingPath, triageKey, unreadableReason } from '../../.shared/triage.ts';

// ── Lecture de la page ──────────────────────────────────────────────────────

/** Les en-têtes d'un navigateur de bureau : ce que les sites d'offres servent sans mur. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
};

export interface FetchedPage {
  ok: boolean;
  status: number;
  /** L'URL après redirections. */
  finalUrl: string;
  /** Le HTML, vide hors 2xx ou sur erreur. */
  html: string;
}

/** GET avec les en-têtes de navigateur, redirections suivies ; ne rejette jamais (erreur ou délai : `ok: false`, `status: 0`). */
export async function fetchPage(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): Promise<FetchedPage> {
  try {
    const response = await fetchImpl(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const html = response.ok ? await response.text() : '';
    return { ok: response.ok, status: response.status, finalUrl: response.url || url, html };
  } catch {
    return { ok: false, status: 0, finalUrl: url, html: '' };
  }
}

// ── JSON-LD JobPosting ──────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const LD_JSON = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

function findJobPosting(node: unknown, depth = 0): Json | null {
  if (depth > 4 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const o = node as Json;
  const types = Array.isArray(o['@type']) ? o['@type'] : [o['@type']];
  if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'jobposting') && typeof o.description === 'string') return o;
  if (Array.isArray(o['@graph'])) return findJobPosting(o['@graph'], depth + 1);
  return null;
}

/** Le premier objet JobPosting (avec une `description`) des blocs `application/ld+json` de la page, ou null. */
export function jobPostingFrom(html: string): Json | null {
  for (const match of html.matchAll(LD_JSON)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const found = findJobPosting(parsed);
    if (found !== null) return found;
  }
  return null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const UNIT_FR: Record<string, string> = { YEAR: 'an', MONTH: 'mois', WEEK: 'semaine', DAY: 'jour', HOUR: 'heure' };

/** « 60000 - 68000 EUR par an » depuis `baseSalary` (MonetaryAmount, valeur simple ou QuantitativeValue), ou vide. */
export function salaryLine(baseSalary: unknown): string {
  if (baseSalary === null || typeof baseSalary !== 'object') return '';
  const money = baseSalary as Json;
  const currency = str(money.currency).toUpperCase();
  const value = money.value;
  let amount = '';
  let unit = '';
  if (typeof value === 'number') amount = String(value);
  else if (value !== null && typeof value === 'object') {
    const q = value as Json;
    const min = typeof q.minValue === 'number' ? q.minValue : null;
    const max = typeof q.maxValue === 'number' ? q.maxValue : null;
    const single = typeof q.value === 'number' ? q.value : null;
    amount = min !== null && max !== null ? `${min} - ${max}` : String(min ?? max ?? single ?? '');
    unit = UNIT_FR[str(q.unitText).toUpperCase()] ?? '';
  }
  if (amount === '' || currency === '') return '';
  return `${amount} ${currency}${unit !== '' ? ` par ${unit}` : ''}`;
}

/** « au moins 7 ans d'expérience » (mois entiers d'années), sinon « au moins 18 mois d'expérience », ou le texte donné. */
export function experienceLine(requirements: unknown): string {
  if (typeof requirements === 'string') return requirements.trim();
  if (requirements === null || typeof requirements !== 'object') return '';
  const months = (requirements as Json).monthsOfExperience;
  if (typeof months !== 'number' || months <= 0) return '';
  return months % 12 === 0 ? `au moins ${months / 12} ans d'expérience` : `au moins ${months} mois d'expérience`;
}

/**
 * Le texte de l'annonce depuis un JobPosting : titre, description (HTML retiré), puis les
 * champs publiés par l'éditeur (contrat, lieu, télétravail, dates, salaire, expérience), que
 * l'agent peut citer comme le reste de l'annonce.
 */
export function postingFromJobPosting(posting: Json): string {
  const lines: string[] = [];
  const title = visibleText(str(posting.title), 300);
  if (title !== '') lines.push(title);
  const organization = posting.hiringOrganization !== null && typeof posting.hiringOrganization === 'object' ? str((posting.hiringOrganization as Json).name) : '';
  if (organization !== '') lines.push(`Entreprise : ${organization}`);
  lines.push('', visibleText(str(posting.description), 30_000), '');
  const fields: string[] = [];
  const employment = Array.isArray(posting.employmentType) ? posting.employmentType.map(str).filter(Boolean).join(', ') : str(posting.employmentType);
  if (employment !== '') fields.push(`Type de contrat : ${employment}`);
  const location = posting.jobLocation !== null && typeof posting.jobLocation === 'object' ? ((Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation) as Json) : null;
  const address = location !== null && location.address !== null && typeof location.address === 'object' ? (location.address as Json) : null;
  const place = [str(address?.addressLocality), str(address?.addressRegion), str(address?.addressCountry)].filter(Boolean).join(', ');
  if (place !== '') fields.push(`Lieu : ${place}`);
  if (str(posting.jobLocationType).toUpperCase() === 'TELECOMMUTE') fields.push('Lieu de travail (jobLocationType) : TELECOMMUTE, poste à distance selon l\'éditeur');
  if (str(posting.datePosted) !== '') fields.push(`Publiée le : ${str(posting.datePosted)}`);
  if (str(posting.validThrough) !== '') fields.push(`Candidatures jusqu'au : ${str(posting.validThrough)}`);
  const salary = salaryLine(posting.baseSalary);
  if (salary !== '') fields.push(`Salaire (baseSalary) : ${salary}`);
  const experience = experienceLine(posting.experienceRequirements);
  if (experience !== '') fields.push(`Expérience requise (experienceRequirements) : ${experience}`);
  if (fields.length > 0) lines.push("--- Champs JSON-LD JobPosting (publiés par l'éditeur) ---", ...fields);
  return lines.join('\n').trim();
}

export interface ReadPosting {
  text: string;
  /** Vrai quand le texte vient d'un JobPosting avec une description d'au moins 200 caractères. */
  structured: boolean;
}

/** Le texte de l'annonce d'une page : le JobPosting quand il y en a un, sinon le texte visible. */
export function readPosting(html: string): ReadPosting {
  const posting = jobPostingFrom(html);
  if (posting !== null && visibleText(str(posting.description), 1_000).length >= 200) return { text: postingFromJobPosting(posting), structured: true };
  return { text: visibleText(html, 30_000), structured: false };
}

// ── Le script ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
  const wanted = text(process.env.INPUTS_KEY).trim();
  const engine = readTriageEngine(text(process.env.INPUTS_ENGINE).trim());
  // Les offres déjà passées dans ce cycle du radar de la VM (radar-vm.ts) : pas reprises tout de suite.
  const skip = new Set(text(process.env.INPUTS_SKIP).split(',').map((k) => k.trim()).filter((k) => k !== ''));

  const done = (ok: boolean, go: boolean, summary: string, extra: Record<string, unknown> = {}): void => {
    emit({ ok, go, summary, key: '', offer_json: '{}', criteria_json: '{}', criteria_hash: '', posting_full: 'false', readable: false, unreadable_reason: '', pre_screened: false, pre_screen_reason: '', profile_file: '', attempts: 0, ...extra });
  };

  const criteriaPath = criteriaPathIn(careerDir);
  const boardPath = boardPathIn(careerDir);
  if (careerDir === '') done(false, false, 'career_dir is required');
  else if (!existsSync(criteriaPath)) done(false, false, `criteres.json not found in ${careerDir}: write it first (langues, salaire_min_annuel; see blocks/job-triage/README.md)`);
  else if (!existsSync(boardPath)) done(false, false, `pending_gold_jobs.json not found in ${careerDir}`);
  else {
    try {
      const criteria = readFileSync(criteriaPath, 'utf8').replace(/^﻿/, '');
      const hash = criteriaHash(criteria);
      const records = readTriageRecords(careerDir);
      const jobs = JSON.parse(readFileSync(boardPath, 'utf8').replace(/^﻿/, '')) as unknown;
      const job = pickUntriaged(jobs, records, hash, wanted, engine, skip);
      if (job === null) {
        done(true, false, wanted === '' ? 'Every offer waiting for the candidate is already triaged with these criteria.' : `Offer ${wanted} not found in pending_gold_jobs.json.`);
      } else {
        const key = triageKey(job);
        const previous = records.get(key);
        const attempts = previous !== undefined && previous.criteria_hash === hash ? (previous.attempts ?? 1) : 0;
        const offer = {
          key,
          id: job.id ?? '',
          slug: job.slug,
          company: decodeEntities(job.company ?? ''),
          title: decodeEntities(job.title ?? ''),
          link: job.link ?? '',
          location: String(job.location ?? ''),
          source: String(job.source ?? ''),
          status: job.status,
          // La règle d'âge du bloc (`offre_age_max_jours`) : la date du tableau telle quelle, et le
          // moment où le radar du PC l'a lue (une date relative se compte depuis là).
          // Une offre mise au tableau à la main n'a pas de limite d'âge : pas de date pour le bloc.
          date_published: addedByHand(job) ? '' : (job.date_published ?? ''),
          radar_at: typeof (job.radar as { at?: unknown } | undefined)?.at === 'string' ? String((job.radar as { at: string }).at) : '',
        };
        const base = { key, offer_json: JSON.stringify(offer), criteria_json: criteria, criteria_hash: hash, attempts };
        // Mode économe : trop ancienne, ou entreprise contredite par le lien, la règle a tranché ;
        // ni page à lire, ni modèle à appeler.
        const screened = preScreen(job, criteria);
        if (screened !== null) {
          done(true, true, `Offer ${offer.company} — ${offer.title} (${key}) pre-screened by code: ${screened}; page not read, the block is skipped (no model call).`, {
            ...base,
            readable: true,
            pre_screened: true,
            pre_screen_reason: screened,
          });
        } else {
          let read: ReadPosting | null = null;
          const pages: { url: string; status: number }[] = [];
          const urls = [...new Set([String(job.posting_url ?? ''), String(job.link ?? '')].filter((u) => /^https?:\/\//.test(u)))];
          for (const url of urls) {
            const page = await fetchPage(url);
            pages.push({ url, status: page.status });
            if (!page.ok) continue;
            read = readPosting(page.html);
            const origin = choosePosting(job, read, decodeEntities).origin;
            if (origin === 'jsonld' || origin === 'page') break;
          }
          let chosen = choosePosting(job, read, decodeEntities);
          // Page expirée ou tronquée depuis la relève : l'annonce complète que le radar de la VM a lue ce jour-là.
          if (!chosen.full) {
            const storedPath = storedPostingPath(careerDir, key);
            const stored = existsSync(storedPath) ? storedPostingBody(readFileSync(storedPath, 'utf8')) : null;
            if (stored !== null) chosen = { body: stored, full: true, origin: 'stored' };
          }
          const full = chosen.full;
          const readable = postingReadable(chosen.body);
          writeFileSync(join(artifactsDir(), 'posting.txt'), postingText(job, chosen.body, full, decodeEntities), 'utf8');
          const profilePath = profilePathIn(careerDir);
          const profile = existsSync(profilePath) ? readFileSync(profilePath, 'utf8').replace(/^﻿/, '') : '';
          const profileFile = profile.trim() !== '' ? 'profile.md' : '';
          if (profileFile !== '') writeFileSync(join(artifactsDir(), profileFile), profile, 'utf8');
          const status = pages.map((p) => `HTTP ${p.status}`).join(', ') || 'no link';
          const how = {
            jsonld: `posting read (${chosen.body.length} chars, JSON-LD JobPosting)`,
            page: `posting read (${chosen.body.length} chars, page text)`,
            radar_full: `page not readable (${status}), the source's full description from the radar (${chosen.body.length} chars)`,
            stored: `page not readable or partial (${status}), the full posting the VM radar read at capture (${chosen.body.length} chars, postings/${key}.txt)`,
            radar_summary: `posting not readable (${status}, no JobPosting, no full description), radar summary only (${chosen.body.length} chars)`,
          }[chosen.origin];
          const reason = readable ? '' : unreadableReason(job, chosen.body, pages);
          const fit = profileFile !== '' ? 'candidate profile given (core-of-role fit)' : 'no master_profile.md, core-of-role fit not assessed';
          done(true, true, `Offer ${offer.company} — ${offer.title} (${key}) to triage; ${how}${readable ? '' : ' — unreadable, the block is skipped'}; ${fit}.`, {
            ...base,
            posting_full: full ? 'true' : 'false',
            readable,
            unreadable_reason: reason,
            profile_file: profileFile,
          });
        }
      }
    } catch (error) {
      done(false, false, `triage load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
