/**
 * La sélection du jour (2026-11-08). Le radar unifié de la VM relève et trie toutes les offres sans
 * Claude ; chaque jour, à l'heure dite, le cockpit du PC en propose quelques-unes à Antoine :
 *
 *   1. liste courte, par le code : les offres retenues sous les critères actuels (tri de la VM, des
 *      règles, ou déjà de Claude), jamais proposées, encore fraîches, rangées par `shortlistRank`
 *      (hors Royaume-Uni d'abord) ;
 *   2. Claude juge le cœur du poste (career-triage moteur `llm` : bloc job-triage, Sonnet), une offre
 *      à la fois, jusqu'à en avoir `par_jour` vérifiées retenues ou la liste courte épuisée ;
 *   3. le code garde les `par_jour` meilleures (`pickScore` : cœur du poste étayé, Royaume-Uni pénalisé,
 *      salaire, fraîcheur ; aucune exigence du cœur étayée : jamais proposée)
 *      dans `selection/<date>.json`, que Claude lit pour poser une carte par offre dans le projet ;
 *   4. un oui d'Antoine devient `inbox/<clé>.json` (`decision: "go"`), que le cockpit met en file
 *      career-apply (une candidature à la fois) ; un non est seulement noté.
 *
 * Réglages : `<dossier carrière>/selection.json` (absent : pas de sélection, aucun appel de modèle).
 * Fonctions pures, testées dans selection.test.ts ; cockpit.ts branche le disque et Archon.
 */

import type { PendingJob } from '../../.archon/workflows/systems/.shared/career.ts';
import { ageLimitFor } from '../../.archon/workflows/blocks/.shared/offer-date.ts';
import { type TriageRecord, addedByHand, triageKey } from '../../.archon/workflows/systems/.shared/triage.ts';

export const SELECTION_CONFIG = 'selection.json';
export const SELECTION_DIR = 'selection';
export const INBOX_DIR = 'inbox';
/** Plafond du forfait Pro (Antoine, 2026-11-07) : 2 par jour pour commencer, 3 au plus. */
export const MAX_PER_DAY = 3;
/** Un tri lancé dont aucun verdict n'est revenu après ce délai est compté comme fait (run en échec). */
export const LAUNCH_TIMEOUT_MS = 30 * 60_000;

export type SendMode = 'confirm' | 'auto' | 'verified-only';

export interface SelectionConfig {
  enabled: boolean;
  perDay: number;
  hour: number;
  minute: number;
  shortlistMax: number;
  maxAgeDays: number;
  mode: SendMode;
  verifiedPlatforms: string;
  contacts: boolean;
}

const int = (v: unknown, name: string, min: number, max: number, fallback: number): number => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${SELECTION_CONFIG} : « ${name} » doit être un entier de ${min} à ${max}`);
  return v;
};

/** Les réglages, en français comme criteres.json ; une valeur absente prend son défaut, une valeur fausse est refusée. */
export function readSelectionConfig(raw: unknown): SelectionConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${SELECTION_CONFIG} : un objet JSON est attendu`);
  const o = raw as Record<string, unknown>;
  const heure = o.heure === undefined ? '08:00' : String(o.heure);
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(heure);
  if (m === null) throw new Error(`${SELECTION_CONFIG} : « heure » au format HH:MM (heure du PC)`);
  const mode = o.mode_envoi === undefined ? 'verified-only' : String(o.mode_envoi);
  if (mode !== 'confirm' && mode !== 'auto' && mode !== 'verified-only') throw new Error(`${SELECTION_CONFIG} : « mode_envoi » vaut confirm, auto ou verified-only`);
  const platforms = o.plateformes_verifiees === undefined ? [] : o.plateformes_verifiees;
  if (!Array.isArray(platforms) || platforms.some((p) => typeof p !== 'string' || !/^[a-z0-9_-]+$/i.test(p))) throw new Error(`${SELECTION_CONFIG} : « plateformes_verifiees » est une liste d'identifiants (greenhouse, lever…)`);
  return {
    enabled: o.actif !== false,
    perDay: int(o.par_jour, 'par_jour', 1, MAX_PER_DAY, 2),
    hour: Number(m[1]),
    minute: Number(m[2]),
    shortlistMax: int(o.liste_courte, 'liste_courte', 1, 12, 6),
    maxAgeDays: int(o.offre_age_max_jours, 'offre_age_max_jours', 1, 30, 7),
    mode,
    verifiedPlatforms: (platforms as string[]).join(','),
    contacts: o.decideurs !== false,
  };
}

/** La date du jour à l'heure du PC (AAAA-MM-JJ). */
export function localDay(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** L'heure de la sélection est-elle passée aujourd'hui ? */
export function selectionDue(cfg: SelectionConfig, now: Date): boolean {
  return now.getHours() * 60 + now.getMinutes() >= cfg.hour * 60 + cfg.minute;
}

export interface CoreFit {
  backed: number;
  partial: number;
  missing: number;
}

/** Le cœur du poste d'après la note du bloc job-triage (« Cœur du poste : 2 exigences étayées, 1 en partie, 0 absente du profil, sur 3 »). */
export function coreFitOf(rec: Pick<TriageRecord, 'notes'>): CoreFit | null {
  for (const n of rec.notes ?? []) {
    const m = /Cœur du poste : (\d+) exigences? étayées?, (\d+) en partie, (\d+) absentes? du profil/.exec(n);
    if (m) return { backed: Number(m[1]), partial: Number(m[2]), missing: Number(m[3]) };
  }
  return null;
}

const published = (job: PendingJob): number => {
  const t = Date.parse(String(job.date_published ?? ''));
  return Number.isNaN(t) ? 0 : t;
};

/** Trop vieille pour être proposée ? Date illisible : non (le tri l'a déjà jugée). */
export function staleForSelection(job: PendingJob, now: Date, maxAgeDays: number): boolean {
  if (addedByHand(job)) return false;
  const t = published(job);
  const limit = ageLimitFor(job.source, maxAgeDays);
  return limit > 0 && t > 0 && now.getTime() - t > limit * 86_400_000;
}

const salaryTop = (rec: TriageRecord): number => rec.salary_annual_eur?.max ?? rec.salary_annual_eur?.min ?? 0;

const UK_WORDS = /\b(united kingdom|uk|u\.k\.|great britain|britain|england|scotland|wales|northern ireland|london|manchester|bristol|birmingham|leeds|liverpool|edinburgh|glasgow|cardiff|belfast|cambridge|oxford|brighton|nottingham|sheffield|newcastle)\b/gi;
const WIDER = /\b(europe|european|eu|eea|emea|cet|worldwide|anywhere|global|international|ireland|irlande|france|germany|spain|portugal|netherlands|belgium|luxembourg|italy|switzerland|austria|poland|czech|czechia|romania|bulgaria|greece|croatia|sweden|norway|denmark|finland|estonia|latvia|lithuania|hungary|slovakia|slovenia|serbia|malta|cyprus|paris|berlin|madrid|barcelona|lisbon|amsterdam|dublin|brussels|milan|munich|vienna|warsaw|prague)\b/i;
const UK_RIGHT_TO_WORK = /\b(right to work in the uk|uk right to work|eligible to work in the uk|authori[sz]ed to work in the uk|uk[- ]based (candidates|applicants|only)|uk residents? only|must (live|reside) in the uk)\b/i;

/**
 * Une offre réservée au Royaume-Uni ? Pour Antoine (2026-11-09), une candidature y est compliquée depuis
 * le Brexit (droit de travailler) : pas exclue, mais classée après les autres. Le lieu (ou le titre)
 * ne cite que le Royaume-Uni, sans l'Europe ni un autre pays, ou l'annonce exige le droit d'y travailler.
 */
export function ukOnly(job: PendingJob): boolean {
  const where = `${String(job.location ?? '')} ${String(job.title ?? '')}`;
  if (UK_RIGHT_TO_WORK.test(String(job.description ?? ''))) return true;
  if (!new RegExp(UK_WORDS.source, 'i').test(where)) return false;
  return !WIDER.test(where.replace(UK_WORDS, ' '));
}

/** Ce que coûte le Royaume-Uni au score final : une exigence du cœur du poste étayée de moins. */
export const UK_PENALTY = 2;

/**
 * Le rang dans la liste courte : hors Royaume-Uni d'abord, puis déjà jugée par Claude (rien à payer), le modèle local, les règles ; annonce complète, fraîcheur.
 * Un salaire non affiché ne fait plus reculer une offre (Antoine, 2026-11-13 : Canonical, qui n'affiche jamais de salaire, n'entrait jamais dans les 6 ; règle « salaire inconnu → garder »).
 */
export function shortlistRank(rec: TriageRecord, job: PendingJob): number[] {
  const engine = rec.block_status === 'verified' ? 3 : rec.block_status === 'local' ? 2 : 1;
  return [ukOnly(job) ? 0 : 1, engine, rec.posting_full ? 1 : 0, published(job)];
}

/** Le score final d'une offre retenue par Claude : cœur du poste étayé (moins la pénalité Royaume-Uni), puis salaire, puis fraîcheur. */
export function pickScore(rec: TriageRecord, job: PendingJob): number[] {
  const core = coreFitOf(rec);
  const fit = core === null ? 0 : 2 * core.backed + core.partial - 2 * core.missing;
  return [fit - (ukOnly(job) ? UK_PENALTY : 0), salaryTop(rec), published(job)];
}

/** Proposable ? Pas une offre dont aucune exigence du cœur du poste n'est étayée par le profil (Antoine, 2026-11-09 : Forestry England et PLOS, 0 sur 3, refusées). */
export function coreBacked(rec: TriageRecord): boolean {
  const core = coreFitOf(rec);
  return core === null || core.backed > 0;
}

const byDesc = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
};

export interface SelectionPick {
  key: string;
  slug: string;
  title: string;
  company: string;
  link: string;
  source: string;
  location: string;
  date_published: string;
  salary_annual_eur: { min: number | null; max: number | null } | null;
  reasons: string[];
  notes: string[];
  core: CoreFit | null;
}

export interface SelectionAnswer {
  decision: 'go' | 'non';
  at: string;
  by: string;
  queued: boolean;
  note: string;
}

export interface SelectionDay {
  date: string;
  created_at: string;
  status: 'tri' | 'prete' | 'vide';
  per_day: number;
  shortlist: string[];
  launched: { key: string; at: string }[];
  picks: SelectionPick[];
  answers: Record<string, SelectionAnswer>;
  finished_at: string | null;
  notes: string[];
}

/** Les offres déjà proposées un autre jour : jamais deux fois. */
export function proposedKeys(days: SelectionDay[]): Set<string> {
  return new Set(days.flatMap((d) => (d.picks ?? []).map((p) => p.key)));
}

type Board = PendingJob[];

/** Une ligne par clé (la plus récente d'un même id). */
function byKey(jobs: Board): Map<string, PendingJob> {
  const out = new Map<string, PendingJob>();
  for (const j of jobs) {
    if (!j || typeof j !== 'object' || typeof j.slug !== 'string') continue;
    const k = triageKey(j);
    const prev = out.get(k);
    if (prev === undefined || published(j) >= published(prev)) out.set(k, j);
  }
  return out;
}

/**
 * La liste courte du jour : en attente de validation (PENDING_VALIDATION ; VALIDATED est déjà dans
 * le circuit du bot), retenue sous les critères actuels, jamais proposée, fraîche ; `keep` dit si
 * l'offre passe les règles du cockpit (zone, métiers exclus).
 */
export function buildShortlist(jobs: Board, records: Map<string, TriageRecord>, hash: string, proposed: Set<string>, cfg: SelectionConfig, now: Date, keep: (j: PendingJob) => boolean = () => true): string[] {
  const rows: { key: string; rank: number[] }[] = [];
  for (const [key, job] of byKey(jobs)) {
    if (job.status !== 'PENDING_VALIDATION' || proposed.has(key)) continue;
    const rec = records.get(key);
    if (!rec || rec.criteria_hash !== hash || rec.decision !== 'retenue') continue;
    if (!['verified', 'local', 'rules'].includes(rec.block_status)) continue;
    // Déjà jugée par Claude sans aucune exigence du cœur étayée : jamais proposée, inutile qu'elle prenne une place (2026-11-12).
    if (rec.block_status === 'verified' && !coreBacked(rec)) continue;
    if (staleForSelection(job, now, cfg.maxAgeDays) || !keep(job)) continue;
    rows.push({ key, rank: shortlistRank(rec, job) });
  }
  return rows.sort((a, b) => byDesc(a.rank, b.rank)).slice(0, cfg.shortlistMax).map((r) => r.key);
}

/** Un tri lancé pour la sélection est-il revenu (verdict de Claude, ou délai passé) ? */
function judged(key: string, day: SelectionDay, records: Map<string, TriageRecord>, hash: string, now: Date): boolean {
  const rec = records.get(key);
  if (rec && rec.criteria_hash === hash && rec.block_status === 'verified') return true;
  const launch = day.launched.find((l) => l.key === key);
  if (!launch) return false;
  if (rec && rec.criteria_hash === hash && !['local', 'rules'].includes(rec.block_status) && Date.parse(rec.at) >= Date.parse(launch.at)) return true;
  return now.getTime() - Date.parse(launch.at) > LAUNCH_TIMEOUT_MS;
}

/** Les offres de la liste courte retenues par Claude (bloc vérifié, critères actuels) dont au moins une exigence du cœur du poste est étayée, les meilleures d'abord. */
export function rankedPicks(day: SelectionDay, jobs: Board, records: Map<string, TriageRecord>, hash: string): SelectionPick[] {
  const rows = byKey(jobs);
  const out: { pick: SelectionPick; score: number[] }[] = [];
  for (const key of day.shortlist) {
    const rec = records.get(key);
    const job = rows.get(key);
    if (!rec || !job || rec.criteria_hash !== hash || rec.block_status !== 'verified' || rec.decision !== 'retenue' || !coreBacked(rec)) continue;
    out.push({
      score: pickScore(rec, job),
      pick: {
        key,
        slug: job.slug,
        title: String(job.title ?? ''),
        company: String(job.company ?? ''),
        link: String(job.link ?? ''),
        source: String(job.source ?? ''),
        location: String(job.location ?? ''),
        date_published: String(job.date_published ?? ''),
        salary_annual_eur: rec.salary_annual_eur,
        reasons: rec.reasons,
        notes: rec.notes,
        core: coreFitOf(rec),
      },
    });
  }
  return out.sort((a, b) => byDesc(a.score, b.score)).map((r) => r.pick);
}

/** La prochaine offre de la liste courte à faire juger par Claude, ou null (toutes jugées ou lancées). */
export function nextToJudge(day: SelectionDay, records: Map<string, TriageRecord>, hash: string): string | null {
  for (const key of day.shortlist) {
    const rec = records.get(key);
    if (rec && rec.criteria_hash === hash && rec.block_status === 'verified') continue;
    if (day.launched.some((l) => l.key === key)) continue;
    return key;
  }
  return null;
}

/** La journée est-elle tranchée : assez d'offres retenues par Claude, ou toute la liste courte jugée ? */
export function dayComplete(day: SelectionDay, jobs: Board, records: Map<string, TriageRecord>, hash: string, now: Date): boolean {
  if (rankedPicks(day, jobs, records, hash).length >= day.per_day) return true;
  return day.shortlist.every((k) => judged(k, day, records, hash, now));
}

export function newDay(date: string, now: Date, cfg: SelectionConfig, shortlist: string[]): SelectionDay {
  return { date, created_at: now.toISOString(), status: shortlist.length === 0 ? 'vide' : 'tri', per_day: cfg.perDay, shortlist, launched: [], picks: [], answers: {}, finished_at: shortlist.length === 0 ? now.toISOString() : null, notes: shortlist.length === 0 ? ['aucune offre retenue et fraîche à proposer aujourd’hui'] : [] };
}

export function readDay(raw: unknown): SelectionDay | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Partial<SelectionDay>;
  if (typeof d.date !== 'string' || !Array.isArray(d.shortlist) || !['tri', 'prete', 'vide'].includes(String(d.status))) return null;
  return { date: d.date, created_at: String(d.created_at ?? ''), status: d.status as SelectionDay['status'], per_day: typeof d.per_day === 'number' ? d.per_day : 2, shortlist: d.shortlist.map(String), launched: Array.isArray(d.launched) ? d.launched : [], picks: Array.isArray(d.picks) ? d.picks : [], answers: d.answers && typeof d.answers === 'object' ? d.answers : {}, finished_at: d.finished_at ?? null, notes: Array.isArray(d.notes) ? d.notes : [] };
}

export interface InboxAnswer {
  key: string;
  date: string;
  decision: 'go' | 'non';
  by: string;
  at: string;
}

/** Un fichier de `inbox/` (écrit par Claude après la réponse d'Antoine à sa carte), validé ; sinon une erreur qui dit pourquoi. */
/**
 * Une demande d'ajout au tableau dans inbox/ : `{ "ajouter": [{ "entreprise": "greenhouse:canonical", "poste": "ats-gr-8200686" }], "by": "Antoine" }`
 * (clé de l'entreprise et id du poste tels que remote_company_jobs.json les porte). null : ce n'est pas une demande d'ajout.
 */
export function readInboxAdds(raw: unknown): { items: { entreprise: string; poste: string }[]; by: string } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray((raw as Record<string, unknown>).ajouter)) return null;
  const o = raw as Record<string, unknown>;
  const items = (o.ajouter as unknown[]).map((x) => {
    const e = x !== null && typeof x === 'object' ? (x as Record<string, unknown>) : {};
    const entreprise = String(e.entreprise ?? '');
    const poste = String(e.poste ?? '');
    if (!/^(greenhouse|lever|ashby):[A-Za-z0-9_.-]{1,120}$/.test(entreprise) || !/^[A-Za-z0-9_-]{1,200}$/.test(poste)) throw new Error('« ajouter » : des { entreprise: "ats:slug", poste: "<id>" }');
    return { entreprise, poste };
  });
  return { items, by: String(o.by ?? '').slice(0, 80) || 'Antoine' };
}

export function readInboxAnswer(raw: unknown): InboxAnswer {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('un objet JSON est attendu');
  const o = raw as Record<string, unknown>;
  const key = String(o.key ?? '');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key)) throw new Error('« key » : la clé de l’offre (triageKey)');
  if (o.decision !== 'go' && o.decision !== 'non') throw new Error('« decision » vaut go ou non');
  const date = String(o.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('« date » : le jour de la sélection (AAAA-MM-JJ)');
  return { key, date, decision: o.decision, by: String(o.by ?? '').slice(0, 80) || 'Antoine', at: String(o.at ?? '') };
}
