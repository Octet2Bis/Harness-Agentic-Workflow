/**
 * Les règles du radar côté PC (`career-radar`), pures et testées dans `radar.test.ts` : le
 * choix des sources (`selectSources`), le crible des offres brutes (`screenJobs` : doublons,
 * offres déjà au tableau, âge maximal (`offerAgeMaxDays`), jury des trois inspecteurs), l'ajout au tableau sans toucher aux
 * lignes existantes (`appendNew`), le bilan des sources (`sourceCounts`) et le rapport que lit
 * le cockpit (`buildReport`). Le code du radar lui-même (connecteurs, jury) est celui de
 * Master Plan, vendu tel quel en CommonJS sous `radar/` (`fetchers/`, `inspectors/`).
 *
 * Le jury (`runJuryEvaluation`) et le seuil (≥ 75) sont ceux de `live_job_scraper.js` sur la
 * VM, pour que les deux radars retiennent les mêmes offres ; l'objet écrit au tableau a la
 * même forme (`slug`, `match_score`, `tier`, `is_startup`, `jury_verdict`,
 * `status: PENDING_VALIDATION`, `index`), plus `radar: { run, at }` qui dit d'où il vient.
 * `enrichDecisionMaker` (décideur cible) n'est pas vendu : `target_role` reste absent.
 */

import { createRequire } from 'node:module';
import { DEFAULT_OFFER_AGE_MAX_DAYS, ageLimitFor, isoDay, parseOfferDate, readOfferAgeMaxDays, tooOld } from '../../blocks/.shared/offer-date.ts';
import type { PendingJob } from './career.ts';
import { companyLinkConflict } from './company-link.ts';

const require = createRequire(import.meta.url);
const jury = require('./radar/inspectors/jury_pipeline.js') as { runJuryEvaluation: (job: RadarJob, taxonomy: Taxonomy) => JuryResult };

/** Une offre brute telle que la rendent les connecteurs (`fetchAllActiveSources`). */
export interface RadarJob {
  id: string;
  company: string;
  title: string;
  location: string;
  remote_declared: boolean;
  remote_basis?: string;
  company_hq: string;
  skills_required: string;
  description: string;
  /** Le texte entier de l'annonce quand l'API source le donne (career-triage le lit si la page est fermée) ; le jury ne lit que `description`. */
  description_full?: string;
  /** La page de l'annonce quand elle diffère du lien de candidature (Apify : Workday …/job/… contre …/apply). */
  posting_url?: string;
  salary_range: string | null;
  link: string;
  date_published: string;
  source: string;
  [key: string]: unknown;
}

export interface Taxonomy {
  search_queries?: string[];
  startup_scaleup_signals?: string[];
  target_experience?: { disqualified_labels?: string[] };
  /** Mots de domaine du candidat (titre) ; absent : ceux d'Antoine (growth, marketing…). */
  core_domains?: string[];
  /** Requêtes des sources par mot-clé (Adzuna, Jobgether, JSearch), par priorité ; absent : `radar/fetchers/query_picker.js`. */
  source_queries?: string[];
  /** `full` (défaut) : l'auditeur télétravail écarte le présentiel ; `indifferent` : il ne juge pas. */
  remote_policy?: 'full' | 'indifferent';
  [key: string]: unknown;
}

export interface JuryResult {
  pass: boolean;
  failed_inspector: string | null;
  verdict_summary: string;
  final_score?: number;
  tier?: string;
  is_startup?: boolean;
}

/** Le bilan d'une source, tel que `fetchAllActiveSources` le rend (`sources`). */
export interface SourceReport {
  name: string;
  status: string | number;
  count: number;
  duration_ms: number;
}

export interface SourcesConfig {
  version?: string;
  sources: { name: string; enabled?: boolean; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Le seuil du radar de la VM (`live_job_scraper.js`) : en dessous, l'offre n'entre pas au tableau. */
export const MIN_SCORE = 75;

export const runJuryEvaluation = jury.runJuryEvaluation;

// ── Les sources ──────────────────────────────────────────────────────────────────────

/** Les noms demandés par l'entrée `sources` (virgules ; vide : toutes). */
export function parseSourceNames(wanted: string): string[] {
  return wanted.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Ne garde actives que les sources demandées (`wanted`, noms séparés par des virgules, par
 * inclusion insensible à la casse : « adzuna » vise « Adzuna »). Les autres passent
 * `enabled: false` plutôt que d'être retirées : le répartiteur tient pour active une source
 * absente de la configuration. `wanted` vide : la configuration telle quelle.
 */
export function selectSources(config: SourcesConfig, wanted: string): { config: SourcesConfig; selected: string[]; unknown: string[] } {
  const names = parseSourceNames(wanted);
  const sources = Array.isArray(config.sources) ? config.sources : [];
  if (names.length === 0) return { config: { ...config, sources }, selected: sources.filter((s) => s.enabled).map((s) => s.name), unknown: [] };
  const matches = (source: { name: string }, name: string): boolean => source.name.toLowerCase().includes(name.toLowerCase());
  const unknown = names.filter((name) => !sources.some((s) => matches(s, name)));
  const kept = sources.map((s) => (names.some((name) => matches(s, name)) ? s : { ...s, enabled: false }));
  return { config: { ...config, sources: kept }, selected: kept.filter((s) => s.enabled).map((s) => s.name), unknown };
}

/** OK / en échec / en attente de cadence, depuis le statut rendu par chaque connecteur. */
export function sourceCounts(sources: SourceReport[]): { ok: number; failed: number; waiting: number } {
  const counts = { ok: 0, failed: 0, waiting: 0 };
  for (const s of sources) {
    const status = String(s.status);
    if (status === '200' || /^OK\b/.test(status) || /^run (lancé|Apify en cours)/.test(status)) counts.ok++;
    else if (status.startsWith('attente')) counts.waiting++;
    else counts.failed++;
  }
  return counts;
}

/**
 * L'âge maximal d'une offre, en jours, depuis le texte de `criteres.json` du candidat (null :
 * fichier absent) : `offre_age_max_jours`, sinon 7 (`readOfferAgeMaxDays`). Un fichier
 * illisible ou une valeur invalide n'arrête pas le radar : le défaut s'applique, `note` le dit.
 */
export function offerAgeMaxDays(criteriaText: string | null): { days: number; note: string } {
  if (criteriaText === null) return { days: DEFAULT_OFFER_AGE_MAX_DAYS, note: `offers older than ${DEFAULT_OFFER_AGE_MAX_DAYS} days rejected (default, no criteres.json)` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(criteriaText.replace(/^\uFEFF/, ''));
  } catch {
    return { days: DEFAULT_OFFER_AGE_MAX_DAYS, note: `criteres.json unreadable: offers older than ${DEFAULT_OFFER_AGE_MAX_DAYS} days rejected (default)` };
  }
  const { days, problem } = readOfferAgeMaxDays(parsed);
  if (problem !== null) return { days, note: `${problem}: ${days} days used` };
  return { days, note: days > 0 ? `offers older than ${days} days rejected (offre_age_max_jours${(parsed as Record<string, unknown>)?.offre_age_max_jours === undefined ? ' absent, default' : ''})` : 'offer age rule off (offre_age_max_jours: 0)' };
}

// ── Le crible ────────────────────────────────────────────────────────────────────────

/** Le slug du radar de la VM : l'entreprise en minuscules, tout sauf [a-z0-9] remplacé par `_`, 20 caractères. */
export function slugOf(company: string): string {
  return String(company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
}

/** Les clés d'une offre déjà au tableau : liens (minuscules) et identifiants. */
export function boardKeys(board: unknown): { links: Set<string>; ids: Set<string> } {
  const links = new Set<string>();
  const ids = new Set<string>();
  for (const row of Array.isArray(board) ? board : []) {
    if (row === null || typeof row !== 'object') continue;
    const job = row as Partial<PendingJob>;
    if (typeof job.link === 'string' && job.link !== '') links.add(job.link.toLowerCase());
    if (typeof job.id === 'string' && job.id !== '') ids.add(job.id);
  }
  return { links, ids };
}

export interface Rejected {
  id: string;
  company: string;
  title: string;
  link: string;
  source: string;
  reason: string;
}

export interface Screened {
  qualified: PendingJob[];
  rejected: Rejected[];
}

/** `date_published` en `AAAA-MM-JJ` quand la source en donne une autre forme lisible ; la forme d'origine dans `date_published_raw`. */
export function withIsoDate(job: RadarJob, now: Date): RadarJob {
  const raw = job.date_published;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return job;
  const d = parseOfferDate(raw, now);
  if (d === null) return job;
  return { ...job, date_published: isoDay(d), date_published_raw: raw };
}

/** L'objet du tableau, construit comme `live_job_scraper.js` (sans `enrichDecisionMaker`). */
export function toPendingJob(job: RadarJob, verdict: JuryResult): PendingJob {
  return {
    ...job,
    slug: slugOf(job.company),
    match_score: verdict.final_score ?? 0,
    tier: verdict.tier ?? '',
    is_startup: verdict.is_startup === true,
    jury_verdict: verdict.verdict_summary,
    status: 'PENDING_VALIDATION',
  } as PendingJob;
}

/**
 * Le crible, dans l'ordre du radar de la VM, précédé d'une règle à lui : une offre dont
 * l'entreprise contredit le lien (`companyLinkConflict`, `company-link.ts` : le segment
 * `-at-<entreprise>-` d'une annonce LinkedIn) est refusée ; contre un simple identifiant d'ATS, elle
 * est gardée avec la raison dans `company_link_check`. Puis doublons entre offres brutes (lien en
 * minuscules, puis `entreprise|titre`), offres déjà au tableau (lien ou id), âge (publiée il y a
 * plus de `maxAgeDays` jours : `offre_age_max_jours` de criteres.json, 7 par défaut, 0 coupe la
 * règle ; date illisible : gardée), jury des trois inspecteurs, score ≥ 75. Chaque refus garde
 * sa raison. Une offre qualifiée dont la date est lisible mais pas au format `AAAA-MM-JJ`
 * (« il y a 3 jours », RFC 2822, epoch) part au tableau avec `date_published` en `AAAA-MM-JJ`
 * (une date relative vieillirait sur le tableau) et la forme de la source dans `date_published_raw`.
 */
export function screenJobs(
  jobs: RadarJob[],
  taxonomy: Taxonomy,
  board: unknown,
  evaluate: (job: RadarJob, taxonomy: Taxonomy) => JuryResult = runJuryEvaluation,
  options: { maxAgeDays?: number; now?: Date } = {},
): Screened {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_OFFER_AGE_MAX_DAYS;
  const now = options.now ?? new Date();
  const known = boardKeys(board);
  const seenLinks = new Set<string>();
  const seenPairs = new Set<string>();
  const qualified: PendingJob[] = [];
  const rejected: Rejected[] = [];
  const reject = (job: RadarJob, reason: string): void => {
    rejected.push({ id: String(job.id ?? ''), company: String(job.company ?? ''), title: String(job.title ?? ''), link: String(job.link ?? ''), source: String(job.source ?? ''), reason });
  };
  for (const job of jobs) {
    if (!job || typeof job.link !== 'string' || job.link === '' || typeof job.title !== 'string' || job.title === '') {
      if (job) reject(job, 'offre sans lien ou sans titre');
      continue;
    }
    // Avant les doublons : une ligne dont l'entreprise vient d'une autre annonce ne doit pas
    // prendre la place de la vraie (même lien) ; preuve faible (identifiant d'ATS) : gardée, signalée.
    const conflict = companyLinkConflict(job.company, job.link);
    if (conflict !== null && conflict.strength === 'strong') {
      reject(job, `entreprise incohérente avec le lien : ${conflict.reason}`);
      continue;
    }
    const link = job.link.toLowerCase();
    const pair = `${String(job.company ?? '').toLowerCase()}|${job.title.toLowerCase()}`;
    if (seenLinks.has(link)) {
      reject(job, 'doublon (même lien)');
      continue;
    }
    if (seenPairs.has(pair)) {
      reject(job, 'doublon (même entreprise et même titre)');
      continue;
    }
    seenLinks.add(link);
    seenPairs.add(pair);
    if (known.links.has(link) || (typeof job.id === 'string' && job.id !== '' && known.ids.has(job.id))) {
      reject(job, 'déjà au tableau');
      continue;
    }
    const old = tooOld(job.date_published, ageLimitFor(job.source, maxAgeDays), now);
    if (old !== null) {
      reject(job, old);
      continue;
    }
    const verdict = evaluate(job, taxonomy);
    if (!verdict.pass) {
      reject(job, verdict.verdict_summary || `refusée par ${verdict.failed_inspector ?? 'le jury'}`);
      continue;
    }
    if ((verdict.final_score ?? 0) < MIN_SCORE) {
      reject(job, `score ${String(verdict.final_score)} < ${MIN_SCORE}`);
      continue;
    }
    const row = toPendingJob(withIsoDate(job, now), verdict);
    qualified.push(conflict !== null ? { ...row, company_link_check: conflict.reason } : row);
  }
  qualified.sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0));
  return { qualified, rejected };
}

// ── L'ajout au tableau ───────────────────────────────────────────────────────────────

export interface Appended {
  /** Le tableau à écrire, ou null quand rien n'a été ajouté. */
  jobs: PendingJob[] | null;
  added: PendingJob[];
  skipped: { slug: string; id: string; reason: string }[];
}

/**
 * Ajoute au tableau les offres qualifiées qui n'y sont pas (lien en minuscules, ou id) ; les
 * lignes existantes ne sont ni réordonnées ni réécrites (la VM ré-indexe tout le tableau par
 * score à chaque cycle ; ici `index` continue après le plus grand existant, les nouvelles par
 * score décroissant : `pickValidated` et le cockpit s'en servent comme départage, rien de plus).
 */
export function appendNew(board: PendingJob[], qualified: PendingJob[], run: string, now: Date): Appended {
  const known = boardKeys(board);
  const added: PendingJob[] = [];
  const skipped: Appended['skipped'] = [];
  let index = board.reduce((max, row) => Math.max(max, Number(row?.index ?? 0) || 0), 0);
  const sorted = [...qualified].sort((a, b) => Number(b.match_score ?? 0) - Number(a.match_score ?? 0));
  for (const job of sorted) {
    const link = String(job.link ?? '').toLowerCase();
    const id = String(job.id ?? '');
    if (link !== '' && known.links.has(link)) {
      skipped.push({ slug: job.slug, id, reason: 'already on the board (link)' });
      continue;
    }
    if (id !== '' && known.ids.has(id)) {
      skipped.push({ slug: job.slug, id, reason: 'already on the board (id)' });
      continue;
    }
    if (link !== '') known.links.add(link);
    if (id !== '') known.ids.add(id);
    index += 1;
    added.push({ ...job, status: 'PENDING_VALIDATION', index, radar: { run, at: now.toISOString() } });
  }
  return { jobs: added.length ? [...board, ...added] : null, added, skipped };
}

// ── Le rapport pour le cockpit ───────────────────────────────────────────────────────

export interface RadarReport {
  at: string;
  run_id: string;
  ok: boolean;
  sources: SourceReport[];
  sources_ok: number;
  sources_failed: number;
  sources_waiting: number;
  raw_count: number;
  qualified_count: number;
  added: number;
  added_slugs: string[];
  skipped: number;
  rejected_count: number;
  summary: string;
}

export function buildReport(input: {
  run: string;
  now: Date;
  ok: boolean;
  sources: SourceReport[];
  raw_count: number;
  qualified_count: number;
  rejected_count: number;
  added: PendingJob[];
  skipped: number;
  summary: string;
}): RadarReport {
  const counts = sourceCounts(input.sources);
  return {
    at: input.now.toISOString(),
    run_id: input.run,
    ok: input.ok,
    sources: input.sources.map((s) => ({ name: s.name, status: s.status, count: s.count, duration_ms: s.duration_ms })),
    sources_ok: counts.ok,
    sources_failed: counts.failed,
    sources_waiting: counts.waiting,
    raw_count: input.raw_count,
    qualified_count: input.qualified_count,
    added: input.added.length,
    added_slugs: input.added.map((j) => j.slug),
    skipped: input.skipped,
    rejected_count: input.rejected_count,
    summary: input.summary,
  };
}
