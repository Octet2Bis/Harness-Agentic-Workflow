/**
 * Règles pures du système `career-triage` (tri des offres captées par le radar) : la clé d'une
 * offre, quelles offres attendent leur tri, le texte de l'annonce donné au bloc `job-triage`,
 * et l'issue écrite dans `<career_dir>/triage/<clé>.json`. Le tableau `pending_gold_jobs.json`
 * n'est jamais modifié ici : il est partagé avec la VM (radar, bot), et le tri vit à côté, sur
 * le PC, lu par le cockpit.
 *
 * Une offre n'est écartée que par un bloc `verified` (citations vérifiées par le code, lecture
 * approuvée par le juge) ; toute autre issue la laisse « à vérifier », avec la raison.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ageLimitFor, readOfferAgeMaxDays, tooOld } from '../../blocks/.shared/offer-date.ts';
import { seniorityLabelsIn } from '../../blocks/.shared/triage-checks.ts';
import type { PendingJob } from './career.ts';
import { companyLinkConflict } from './company-link.ts';

/** Les statuts du tableau qu'on trie : ce que le candidat n'a pas encore traité. */
export const TRIAGE_STATUSES: readonly string[] = ['PENDING_VALIDATION', 'VALIDATED'];

/** Nombre de tris non vérifiés (juge défavorable, boucle non convergée, erreur) avant d'abandonner : l'offre reste à vérifier à la main. */
export const MAX_TRIAGE_ATTEMPTS = 2;

export type TriageDecision = 'ecartee' | 'a_verifier' | 'retenue';
/**
 * `unreadable` : rien à lire (page fermée, résumé du radar trop court), le bloc n'a pas tourné.
 * `pre_screened` : décidée par le code avant le bloc (offre trop ancienne), aucun appel de modèle.
 * `rules` : triée par les règles du code seules (moteur `rules`, `triage-rules.ts`), aucun appel de modèle.
 * `local` : triée par le modèle local de la VM (moteur `local`, `triage-local.ts` : questions fermées,
 * réponses contrôlées par le code), aucun appel à Claude ; le cœur du poste reste à juger.
 */
export type BlockStatus = 'verified' | 'rejected' | 'unconverged' | 'unreadable' | 'pre_screened' | 'rules' | 'local' | 'none';

/** Les issues définitives : un tri vérifié, ou décidé par le code seul ; les autres se retentent. */
export const FINAL_BLOCK_STATUSES: readonly BlockStatus[] = ['verified', 'pre_screened', 'rules', 'local'];

/**
 * Le moteur du tri : `rules` (défaut depuis le 2026-10-30 : les règles du code seules, aucun appel
 * de modèle, le forfait Claude n'est pas touché) ou `llm` (le bloc job-triage : agent, contrôles,
 * juge). `local` (2026-11-08) : le modèle local de la VM, questions fermées contrôlées par le code,
 * sans Claude. Passer à `llm` refait les offres triées par `rules` ou `local` ; `local` refait celles
 * triées par `rules` ; `rules` ne refait pas un tri `local`.
 */
export type TriageEngine = 'rules' | 'local' | 'llm';
export const TRIAGE_ENGINES: readonly TriageEngine[] = ['rules', 'local', 'llm'];
export function readTriageEngine(value: unknown): TriageEngine {
  return value === 'llm' ? 'llm' : value === 'local' ? 'local' : 'rules';
}

export interface TriageRecord {
  key: string;
  id: string;
  slug: string;
  company: string;
  title: string;
  link: string;
  decision: TriageDecision;
  reasons: string[];
  notes: string[];
  salary_annual_eur: { min: number | null; max: number | null } | null;
  languages_required: string[];
  posting_full: boolean;
  block_status: BlockStatus;
  attempts: number;
  run_id: string;
  at: string;
  criteria_hash: string;
}

/** La clé d'une offre : son `id` (unique, les slugs se répètent), sinon son slug ; sûre comme nom de fichier. */
export function triageKey(job: Pick<PendingJob, 'slug'> & { id?: unknown }): string {
  const raw = typeof job.id === 'string' && job.id.trim() !== '' ? job.id.trim() : String(job.slug ?? '').trim();
  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/**
 * Les clés de `criteres.json` que le code applique seul, sans modèle, aux tris déjà écrits comme aux
 * nouveaux (`preScreen`, `scopeOverride`) : elles n'entrent pas dans l'empreinte, et les changer ne
 * relance pas le tri de toutes les offres.
 */
export const CODE_ONLY_CRITERIA_KEYS: readonly string[] = ['intitules_exclus'];

/** Empreinte des critères : un tri fait avec d'autres critères est refait (sauf `CODE_ONLY_CRITERIA_KEYS`). */
export function criteriaHash(raw: string): string {
  let value: unknown = raw;
  try {
    const parsed = JSON.parse(raw.replace(/^﻿/, '')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) for (const k of CODE_ONLY_CRITERIA_KEYS) delete (parsed as Record<string, unknown>)[k];
    value = canonical(parsed);
  } catch {
    value = raw.trim();
  }
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

/** `criteres.json` du dossier carrière, en texte, ou null. */
export function criteriaPathIn(careerDir: string): string {
  return join(careerDir, 'criteres.json');
}

/** Le profil du candidat (`master_profile.md` du dossier carrière) : le cœur du poste se juge contre lui. */
export function profilePathIn(careerDir: string): string {
  return join(careerDir, 'master_profile.md');
}

function parsedCriteria(criteriaRaw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(criteriaRaw.replace(/^\uFEFF/, '')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Le métier est-il hors périmètre ? `intitules_exclus` de criteres.json : des mots ou expressions
 * d'intitulé (« data analyst », « developer », « it operations »…), cherchés en mots entiers, sans
 * accents ni majuscules (`seniorityLabelsIn`). Rend la raison (« métier hors périmètre (« data
 * analyst ») : <intitulé> »), ou null : clé absente, liste vide, critères illisibles, rien trouvé.
 */
export function titleOutOfScope(title: unknown, criteriaRaw: string): string | null {
  const list = parsedCriteria(criteriaRaw)?.intitules_exclus;
  if (!Array.isArray(list)) return null;
  const words = list.filter((w): w is string => typeof w === 'string' && w.trim() !== '');
  const t = String(title ?? '').replace(/&amp;/g, '&').trim();
  if (words.length === 0 || t === '') return null;
  const hit = seniorityLabelsIn(t, words);
  return hit.length > 0 ? `métier hors périmètre (« ${hit[0]} ») : ${t}` : null;
}

/** La raison écrite quand `remote` = full et que l'annonce lue en entier ne dit pas « télétravail complet ». */
export const REMOTE_NOT_STATED_REASON = "Télétravail complet non écrit dans l'annonce (règle : full remote)";

/**
 * Ce que le code impose à un tri déjà écrit, sans le refaire : un métier hors périmètre
 * (`titleOutOfScope`, la liste a pu changer depuis le tri), ou, quand `remote` = full (défaut), un
 * tri « à vérifier » pour « Mode de travail non précisé » sur une annonce lue en entier (règle du
 * 2026-10-25 : le full remote est une règle dure, l'annonce qui ne le dit pas est écartée ; une
 * annonce lue en partie reste à vérifier). Null : rien à imposer.
 */
export function scopeOverride(job: { title?: unknown }, record: Pick<TriageRecord, 'decision' | 'reasons' | 'posting_full'> | null | undefined, criteriaRaw: string): { kind: 'metier' | 'remote'; reason: string } | null {
  const metier = titleOutOfScope(job.title, criteriaRaw);
  if (metier !== null) return { kind: 'metier', reason: metier };
  const criteria = parsedCriteria(criteriaRaw);
  if (criteria === null || (criteria.remote ?? 'full') !== 'full' || record === null || record === undefined) return null;
  const reasons = Array.isArray(record.reasons) ? record.reasons.map(String) : [];
  if (record.decision === 'a_verifier' && record.posting_full === true && reasons.includes("Mode de travail non précisé dans l'annonce")) return { kind: 'remote', reason: REMOTE_NOT_STATED_REASON };
  return null;
}

/** Une ligne mise au tableau à la main (« Mettre au tableau » du cockpit, ou à sa demande) : `ajoutee_par` rempli. */
export function addedByHand(job: { ajoutee_par?: unknown }): boolean {
  return typeof job.ajoutee_par === 'string' && job.ajoutee_par.trim() !== '';
}

/**
 * Le tri que le code tranche seul, avant toute lecture de page et tout appel de modèle :
 * l'offre publiée il y a plus de `offre_age_max_jours` jours (date de la ligne du tableau,
 * `date_published` ; une date relative se compte depuis la lecture du radar, `radar.at`). Rend
 * la raison, la même que la règle du bloc (`tooOldReason` : « offre trop ancienne (publiée le
 * AAAA-MM-JJ, > 7 jours) »), ou null : date absente ou illisible, règle coupée (0), critères
 * illisibles (le bloc les signalera). Ensuite, l'offre dont l'entreprise contredit le lien
 * (`companyLinkConflict`, preuve forte : le segment `-at-<entreprise>-` d'une annonce LinkedIn) :
 * « entreprise incohérente avec le lien : … ». La ligne vient alors de deux annonces (radar de la VM
 * compris, que le crible du PC ne voit pas) : la trier, puis candidater, viserait le mauvais employeur.
 * Enfin le métier hors périmètre (`titleOutOfScope` : un mot de `intitules_exclus` dans l'intitulé).
 */
export function preScreen(job: PendingJob, criteriaRaw: string, now: Date = new Date()): string | null {
  const conflict = companyLinkConflict(job.company, job.link);
  const mismatch = conflict !== null && conflict.strength === 'strong' ? `entreprise incohérente avec le lien : ${conflict.reason}` : null;
  // Une offre qu'Antoine a mise lui-même au tableau (`ajoutee_par`) est jugée sur son annonce, pas sur
  // son âge ni sur son intitulé (2026-11-13 : Canonical garde ses postes ouverts des mois, PostHog
  // « Developer Marketer » tombait sous « developer »).
  if (addedByHand(job)) return mismatch;
  const metier = titleOutOfScope(job.title, criteriaRaw);
  let criteria: unknown;
  try {
    criteria = JSON.parse(criteriaRaw.replace(/^\uFEFF/, ''));
  } catch {
    return mismatch;
  }
  const age = readOfferAgeMaxDays(criteria);
  if (age.problem !== null) return mismatch ?? metier;
  const at = (job as { radar?: { at?: unknown } }).radar?.at;
  const read = typeof at === 'string' && at !== '' ? new Date(at) : now;
  const anchor = Number.isNaN(read.getTime()) ? now : read;
  return tooOld(job.date_published, ageLimitFor(job.source, age.days), now, anchor) ?? mismatch ?? metier;
}

export function triageDirIn(careerDir: string): string {
  return join(careerDir, 'triage');
}

/** Les tris déjà écrits, par clé ; un fichier illisible est ignoré (il sera refait). */
export function readTriageRecords(careerDir: string): Map<string, TriageRecord> {
  const dir = triageDirIn(careerDir);
  const out = new Map<string, TriageRecord>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8').replace(/^﻿/, '')) as TriageRecord;
      if (record && typeof record.key === 'string') out.set(record.key, record);
    } catch {
      // illisible : refait au prochain passage
    }
  }
  return out;
}

/**
 * L'offre attend-elle son tri ? Oui si elle est à traiter (`TRIAGE_STATUSES`) et n'a pas de tri
 * avec ces critères, ou un tri non vérifié retentable (moins de MAX_TRIAGE_ATTEMPTS passages).
 */
export function needsTriage(job: PendingJob, record: TriageRecord | null | undefined, hash: string, engine: TriageEngine = 'rules'): boolean {
  if (!TRIAGE_STATUSES.includes(String(job.status))) return false;
  if (record === null || record === undefined) return true;
  if (record.criteria_hash !== hash) return true;
  if (engine === 'llm' && (record.block_status === 'rules' || record.block_status === 'local')) return true;
  if (engine === 'local' && record.block_status === 'rules') return true;
  // Un tri par le modèle demandé à la main (bouton du cockpit) et non vérifié n'est pas refait seul par les règles : sa raison reste.
  if (engine === 'rules' && (record.block_status === 'rejected' || record.block_status === 'unconverged')) return false;
  return !FINAL_BLOCK_STATUSES.includes(record.block_status) && (record.attempts ?? 1) < MAX_TRIAGE_ATTEMPTS;
}

/**
 * La prochaine offre à trier : la plus récente d'abord (`date_published`), puis l'ordre du tableau.
 * `skip` : les offres déjà passées dans ce cycle (radar de la VM), qu'un tri non final (annonce
 * illisible, retentée aux cycles suivants) ne doit pas faire reprendre tout de suite.
 */
export function pickUntriaged(jobs: unknown, records: Map<string, TriageRecord>, hash: string, key = '', engine: TriageEngine = 'rules', skip: ReadonlySet<string> = new Set()): PendingJob | null {
  if (!Array.isArray(jobs)) return null;
  const valid = (jobs as PendingJob[]).filter((j) => j && typeof j === 'object' && typeof j.slug === 'string' && j.slug !== '');
  if (key !== '') return valid.find((j) => triageKey(j) === key || j.slug === key) ?? null;
  const date = (j: PendingJob): number => {
    const t = Date.parse(String(j.date_published ?? ''));
    return Number.isNaN(t) ? 0 : t;
  };
  const waiting = valid.filter((j) => !skip.has(triageKey(j)) && needsTriage(j, records.get(triageKey(j)), hash, engine));
  waiting.sort((a, b) => date(b) - date(a) || Number(a.index ?? 0) - Number(b.index ?? 0));
  return waiting[0] ?? null;
}

/** Le salaire du radar est-il une estimation (« 38k€ - 50k€ (1-3 ans) », « Selon profil ») plutôt que celui de l'annonce ? */
export function isEstimatedSalary(value: unknown): boolean {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' || /\(\s*\d+\s*-\s*\d+\s*ans\s*\)/i.test(s) || /selon profil|non communiqu/i.test(s);
}

function squash(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * La page lue contient-elle l'annonce ? Oui si le texte vient d'un JSON-LD JobPosting de la
 * page (`structured` : l'éditeur publie la description elle-même), si la page reprend le
 * début de la description du radar, ou, sinon, si elle porte l'intitulé du poste (ses 30
 * premiers caractères, ou 70 % de ses mots : « - » contre « – », « (H/F) » en plus) dans plus
 * de 1 500 caractères. Une page de connexion ou d'erreur (courte, sans intitulé) ne passe pas.
 * Avant le 2026-10-23, une description du radar de 60 caractères ou plus qui ne se retrouvait
 * pas mot pour mot dans la page suffisait à dire « non lue », sans regarder l'intitulé : une
 * description réécrite ou tronquée par le radar (WTTJ) faisait tomber une page entière.
 */
export function postingIsFull(fetched: string, job: Pick<PendingJob, 'description' | 'title'>, structured = false): boolean {
  const page = squash(fetched);
  if (page.length < 300) return false;
  if (structured) return true;
  const description = squash(String(job.description ?? ''));
  if (description.length >= 60) {
    for (const start of [0, 20, 40]) {
      const probe = description.slice(start, start + 50);
      if (probe.length >= 40 && page.includes(probe)) return true;
    }
  }
  const title = squash(String(job.title ?? ''));
  if (page.length <= 1500 || title === '') return false;
  if (page.includes(title.slice(0, 30))) return true;
  const words = title.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const hits = words.filter((w) => page.includes(w)).length;
  return words.length > 0 && hits >= Math.ceil(words.length * 0.7);
}

/** En dessous (texte normalisé), il n'y a pas d'annonce à lire : pas une phrase de 60 caractères à citer pour sa langue. */
export const MIN_READABLE_CHARS = 200;
/** Une description complète du radar (`description_full`) plus courte ne vaut pas l'annonce. */
export const MIN_FULL_DESCRIPTION_CHARS = 500;

/** D'où vient le texte trié : la page (JSON-LD JobPosting ou texte visible), la description complète de l'API source, ou le résumé du radar. */
export type PostingOrigin = 'jsonld' | 'page' | 'radar_full' | 'stored' | 'radar_summary';

/**
 * Le texte de l'annonce à trier : la page lue quand elle contient l'annonce (`postingIsFull`),
 * sinon la description complète que l'API source a donnée au radar (`description_full` :
 * Himalayas, Jobicy, Remotive, RemoteOK, Arbeitnow, Working Nomads, flux RSS, JSearch, Apify ;
 * 2026-10-23, 34 tris sur 79 ne lisaient que le résumé), sinon le résumé du radar (`full` faux).
 */
export function choosePosting(job: PendingJob, read: { text: string; structured: boolean } | null, decode: (s: string) => string = (s) => s): { body: string; full: boolean; origin: PostingOrigin } {
  const description = decode(String(job.description ?? ''));
  if (read !== null && read.text.trim() !== '' && postingIsFull(read.text, { ...job, description }, read.structured)) return { body: read.text, full: true, origin: read.structured ? 'jsonld' : 'page' };
  const full = decode(String((job as { description_full?: unknown }).description_full ?? ''));
  if (squash(full).length >= MIN_FULL_DESCRIPTION_CHARS) return { body: full, full: true, origin: 'radar_full' };
  return { body: description, full: false, origin: 'radar_summary' };
}

/** La ligne qui sépare, dans `posting.txt`, l'annonce des champs du radar (`postingText`). */
export const RADAR_FIELDS_MARK = "--- Champs du radar (pas l'annonce) ---";

/** Où le radar unifié de la VM garde l'annonce complète lue le jour de la relève (rapatriée sur le PC par pull_radar_vm). */
export function storedPostingPath(careerDir: string, key: string): string {
  return join(careerDir, 'postings', `${key.replace(/[^A-Za-z0-9_-]/g, '_')}.txt`);
}

/**
 * Le corps d'une annonce gardée (`postings/<clé>.txt`, écrit par `postingText`) : le texte avant
 * les champs du radar, s'il fait au moins MIN_FULL_DESCRIPTION_CHARS caractères ; sinon null.
 * Une page expirée ou tronquée depuis (LinkedIn) ne fait plus perdre le texte lu à la relève.
 */
export function storedPostingBody(text: string): string | null {
  const i = text.indexOf(`\n\n${RADAR_FIELDS_MARK}`);
  const body = (i >= 0 ? text.slice(0, i) : text).replace(/^\uFEFF/, '').trim();
  return squash(body).length >= MIN_FULL_DESCRIPTION_CHARS ? body : null;
}

/** Y a-t-il une annonce à lire ? Non quand le texte (sans les champs du radar) fait moins de MIN_READABLE_CHARS caractères. */
export function postingReadable(body: string): boolean {
  return squash(body).length >= MIN_READABLE_CHARS;
}

/** La raison écrite pour une offre illisible : ce qui a été tenté, ce que le radar en donnait. */
export function unreadableReason(job: PendingJob, body: string, pages: { url: string; status: number }[]): string {
  const tried = pages.length === 0 ? 'aucun lien http à lire' : pages.map((p) => `HTTP ${p.status === 0 ? 'injoignable' : p.status}`).join(', ');
  const n = squash(body).length;
  return `Annonce illisible : la page de l'offre n'a pas pu être lue (${tried}) et le radar n'en donne que ${n} caractère${n > 1 ? 's' : ''} (source ${String(job.source ?? '?') || '?'}) ; à ouvrir à la main`;
}

/** Le texte donné au bloc : l'annonce lue (ou le résumé du radar), puis les champs du radar. */
export function postingText(job: PendingJob, fetched: string, full: boolean, decode: (s: string) => string = (s) => s): string {
  const body = full ? fetched : decode(String(job.description ?? ''));
  const lines = [
    `Entreprise : ${decode(String(job.company ?? ''))}`,
    `Poste : ${decode(String(job.title ?? ''))}`,
    `Lieu : ${String(job.location ?? '')}`,
    `Source : ${String(job.source ?? '')}`,
  ];
  if (!isEstimatedSalary(job.salary_range)) lines.push(`Salaire indiqué par la source : ${String(job.salary_range)}`);
  return `${body.trim()}\n\n${RADAR_FIELDS_MARK}\n${lines.join('\n')}\n`;
}

export interface BlockVerdictLike {
  ok: boolean;
  status: string;
  decision: string;
  reasons: string[];
  notes: string[];
  problems: string[];
  findings: { severity: string; text: string }[];
}

/**
 * La décision écrite pour l'offre. Seul un bloc `verified` décide ; un juge défavorable, une
 * boucle non convergée ou un bloc sans verdict laissent l'offre « à vérifier », raison à l'appui.
 * Une annonce illisible (`unreadable`, la raison donnée par `load`) n'est pas triée du tout :
 * « à vérifier », « Annonce illisible : … » (avant le 2026-10-23, le bloc tournait trois fois
 * sur un texte vide et finissait `unconverged` sur « posting_language »). Une offre décidée par
 * le code avant le bloc (`preScreened`, la raison donnée par `load` : offre trop ancienne) est
 * écartée, `block_status: pre_screened`, sans appel de modèle (2026-10-24, mode économe).
 */
export function classify(verdict: BlockVerdictLike | null, unreadable: string | null = null, preScreened: string | null = null, rules: { decision: string; reasons: string[]; notes: string[]; engine?: string } | null = null): { decision: TriageDecision; reasons: string[]; notes: string[]; block_status: BlockStatus } {
  if (preScreened !== null && preScreened.trim() !== '') {
    return { decision: 'ecartee', reasons: [preScreened.trim()], notes: ['Écartée par le code avant le tri (aucun appel de modèle)'], block_status: 'pre_screened' };
  }
  if (unreadable !== null && unreadable.trim() !== '') {
    return { decision: 'a_verifier', reasons: [unreadable.trim()], notes: [], block_status: 'unreadable' };
  }
  if (rules !== null && (rules.decision === 'ecartee' || rules.decision === 'a_verifier' || rules.decision === 'retenue')) {
    // Le moteur `local` rend la même forme que `rules`, avec `engine: 'local'` (ou `'rules'` quand le modèle était injoignable).
    return { decision: rules.decision, reasons: rules.reasons, notes: rules.notes, block_status: rules.engine === 'local' ? 'local' : 'rules' };
  }
  if (verdict === null) {
    return { decision: 'a_verifier', reasons: ["Le tri n'a pas abouti (erreur pendant le tri) : à relire à la main"], notes: [], block_status: 'none' };
  }
  if (verdict.status === 'verified' && (verdict.decision === 'ecartee' || verdict.decision === 'a_verifier' || verdict.decision === 'retenue')) {
    return { decision: verdict.decision, reasons: verdict.reasons, notes: verdict.notes, block_status: 'verified' };
  }
  if (verdict.status === 'rejected') {
    const blocking = verdict.findings.filter((f) => f.severity === 'blocking').map((f) => f.text);
    return { decision: 'a_verifier', reasons: [`Le juge a contesté la lecture de l'annonce : ${blocking.join(' ; ') || 'sans détail'}`], notes: [], block_status: 'rejected' };
  }
  if (verdict.status === 'unconverged') {
    return { decision: 'a_verifier', reasons: [`Lecture de l'annonce non vérifiée après deux essais : ${verdict.problems[0] ?? 'sans détail'}`], notes: [], block_status: 'unconverged' };
  }
  return { decision: 'a_verifier', reasons: [`Issue inattendue du tri (${verdict.status}) : à relire à la main`], notes: [], block_status: 'none' };
}

/** Arguments `archon` pour trier une offre (ou la prochaine, `key` vide), détaché : pour le cockpit. */
export function triageRunArgs(o: { harness: string; careerDir: string; key?: string; engine?: TriageEngine }): string[] {
  const args = ['workflow', 'run', 'career-triage', '--detach', '--cwd', o.harness, '--folder', '--input', `career_dir=${o.careerDir}`, '--input', `engine=${o.engine ?? 'rules'}`];
  if (o.key) args.push('--input', `key=${o.key}`);
  return args;
}
