/**
 * Le fichier `pending_gold_jobs.json` de Master Plan est le tableau de tâches du cas
 * d'usage carrière : NEW = VALIDATED (le candidat a dit oui sur Telegram), PICKED UP =
 * APPLYING, DONE = APPLIED / APPLY_UNPROVEN / APPLY_FAILED / TAILORED. Règles pures : prendre
 * (VALIDATED → APPLYING, par le listener ou par un run career-apply lancé à la main :
 * `claimForRun`), une seule candidature en vol à la fois (`inFlight` : les agents partagent un
 * profil de navigateur), clore une prise périmée ou orpheline (APPLYING → APPLY_FAILED, ou
 * APPLY_UNPROVEN quand son `submission/` montre qu'un clic a pu avoir lieu), écrire l'issue que
 * `record` n'a pas pu écrire (`recordUnwritten`, puis `settleClaim` depuis close.json). Aucune
 * règle d'ici ne remet une offre en VALIDATED : seul `record` (career-apply, borné par
 * `recordStatus`) ou `/valider` le fait. Et la synchronisation des deux copies du fichier, PC
 * (harness) et VM (bot) : `mergeBoards`, offre par offre, appelé par
 * `integrations/master-plan/merge_pending.ts`.
 *
 * En bas, les E/S du fichier, partagées par tous ses écrivains (`claim`, `load`, `record`,
 * `close`, les deux `settle`, la règle des prises périmées, `merge_pending.ts`) : chacun
 * relit, modifie et réécrit le fichier sous un même verrou (`updateBoard`, fichier
 * `pending_gold_jobs.json.lock` créé en exclusif, cassé après LOCK_STALE_MS si son détenteur
 * est mort), et l'écriture (tmp → rename) est refaite sur EPERM / EBUSY (Windows : antivirus,
 * indexeur, éditeur ouvert).
 */

import { existsSync, linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type JobStatus, type Outcome, type PendingJob, type Stage, type SubmissionFiles, attemptsOf, carriedAttempts, clickEvidence, holdsClaim, recordStatus } from './career.ts';

export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function stamp(job: PendingJob, key: string): number {
  const value = job[key];
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/**
 * L'offre VALIDATED à prendre : la moins tentée d'abord (`attemptsOf` : une offre qui revient
 * en file passe derrière celles qui n'ont pas encore eu leur tour), puis la plus ancienne
 * validation (`validated_at`), puis `index`. Ou null.
 */
export function pickValidated(jobs: unknown): PendingJob | null {
  if (!Array.isArray(jobs)) return null;
  const candidates = (jobs as PendingJob[]).filter((job) => job && typeof job === 'object' && job.status === 'VALIDATED' && typeof job.slug === 'string' && job.slug !== '');
  candidates.sort(
    (a, b) => attemptsOf(a) - attemptsOf(b) || stamp(a, 'validated_at') - stamp(b, 'validated_at') || Number(a.index ?? 0) - Number(b.index ?? 0)
  );
  return candidates[0] ?? null;
}

/** Une prise APPLYING plus vieille que STALE_AFTER_MS (ou sans date lisible). */
export function isStale(job: PendingJob, now: Date, maxAgeMs = STALE_AFTER_MS): boolean {
  if (job.status !== 'APPLYING') return false;
  const applying = job.applying as { at?: string } | undefined;
  const at = typeof applying?.at === 'string' ? Date.parse(applying.at) : Number.NaN;
  return Number.isNaN(at) || now.getTime() - at > maxAgeMs;
}

/** Le mot laissé sur une prise périmée close. */
export function staleNote(run: string, since: string): string {
  return (
    `The claim went stale: APPLYING since ${since || 'an unknown time'} by run ${run || 'unknown'}, for more than two hours. ` +
    'A go must be answered within two hours: that run no longer clicks, even if its go is approved now (it ends superseded, nothing sent); reject it (archon workflow reject). ' +
    'It may also have crashed after a click: check that run (archon workflow status), its submission/ artifacts and the mailbox, ' +
    'then re-validate with /valider only if nothing was sent.'
  );
}

/** Ce que le `submission/` d'un run dit d'un clic possible, ajouté à la raison d'une clôture. */
function unprovenNote(reason: string, evidence: string[]): string {
  return `${reason} But its submission/ shows the application may have been sent: ${evidence.join('; ')}. Check the mailbox and the platform before any new attempt.`;
}

/**
 * Une prise APPLYING périmée devient APPLY_FAILED, jamais VALIDATED : elle peut être un run
 * en pause au go pendant l'absence de l'humain, ou un run tombé après un clic ; la remettre en
 * file pourrait envoyer deux fois, ou envoyer ce que l'humain a refusé. Quand le `submission/`
 * du run (`applying.artifacts`, noté par `load` : `evidenceOf`) montre qu'un clic a pu avoir
 * lieu (`clickEvidence`), elle devient APPLY_UNPROVEN : jamais une candidature peut-être
 * envoyée notée « échouée ». Close, la prise n'est plus tenue (`holdsClaim`) : son run, même
 * approuvé ensuite, ne clique plus ; un go se donne dans les deux heures, sinon `/valider`.
 * Le compteur de passages est porté ; les champs du bot ne bougent pas.
 */
export function releaseStale(
  jobs: PendingJob[],
  now: Date,
  maxAgeMs = STALE_AFTER_MS,
  evidenceOf: (job: PendingJob) => string[] = () => []
): { jobs: PendingJob[]; stale: string[] } {
  const stale: string[] = [];
  const next = jobs.map((job) => {
    if (!isStale(job, now, maxAgeMs)) return job;
    stale.push(job.slug);
    const applying = (job.applying ?? {}) as { run?: string; at?: string };
    const evidence = evidenceOf(job);
    const base = staleNote(String(applying.run ?? ''), String(applying.at ?? ''));
    const note = evidence.length > 0 ? unprovenNote(base, evidence) : base;
    const status = evidence.length > 0 ? 'APPLY_UNPROVEN' : 'APPLY_FAILED';
    return { ...job, status, applying: undefined, harness: { ...carriedAttempts(job), run: String(applying.run ?? ''), stage: 'listener', at: now.toISOString(), summary: note, note } };
  });
  return { jobs: next, stale };
}

/** Les candidatures en vol : offres APPLYING dont la prise n'est pas périmée. */
export function inFlight(jobs: PendingJob[], now: Date, maxAgeMs = STALE_AFTER_MS): { slug: string; run: string }[] {
  return jobs
    .filter((job) => job && typeof job === 'object' && job.status === 'APPLYING' && !isStale(job, now, maxAgeMs))
    .map((job) => ({ slug: String(job.slug ?? ''), run: String((job.applying as { run?: unknown } | undefined)?.run ?? '') }));
}

/** Le mot d'une file arrêtée par une candidature en vol (les agents partagent un profil de navigateur). */
export function busyNote(busy: { slug: string; run: string }[]): string {
  return (
    `An application is in flight (${busy.map((b) => `${b.slug} by run ${b.run || 'unknown'}`).join(', ')}): ` +
    'one at a time, because the agents share one browser profile (.local/browser-profile). It ends when that run records its status, or after two hours.'
  );
}

/**
 * Ce que `load` (career-apply) fait de l'offre avant tout travail, sous le verrou du tableau.
 * - Lancé par le listener (`claimRun` = le run du listener) : l'offre doit être encore tenue par
 *   cette prise (`holdsClaim`), sinon le run ne fait rien ; APPLYING, elle reçoit
 *   `applying.artifacts` (le dossier d'artefacts de ce run, où `settle` et la règle des prises
 *   périmées lisent `submission/`).
 * - Lancé à la main (`claimRun` vide) : le run prend l'offre lui-même, comme le listener :
 *   APPLYING avec `applying.run` = ce run (`run`), `applying.at`, `applying.artifacts`, et
 *   `applying.from`, le statut d'avant la prise : `record` (et `settleClaim` depuis
 *   record.json) le réécrit au lieu de VALIDATED (`recordStatus`), pour qu'un run lancé sur
 *   une offre TAILORED, PENDING_VALIDATION ou APPLY_FAILED ne la mette jamais en file. Refus
 *   (rien n'est écrit) pour une offre APPLYING par une autre prise, APPLIED ou APPLY_UNPROVEN
 *   (déjà envoyée, ou peut-être), ou quand une autre candidature est en vol (`inFlight`). Une
 *   offre APPLYING par ce même run (un `load` rejoué) est gardée.
 * `claim` est la prise que le run tient ensuite (sortie `claim_run` de `load`), vide si refus.
 */
export function claimForRun(
  jobs: PendingJob[],
  slug: string,
  options: { claimRun: string; run: string; now: Date; artifacts: string }
): { jobs: PendingJob[] | null; ok: boolean; claim: string; self: boolean; summary: string } {
  const wanted = slug.trim().toLowerCase();
  const job = jobs.find((entry) => entry && typeof entry === 'object' && String(entry.slug ?? '').toLowerCase() === wanted);
  const refuse = (summary: string, self: boolean): { jobs: null; ok: false; claim: string; self: boolean; summary: string } => ({ jobs: null, ok: false, claim: '', self, summary });
  if (job === undefined) return refuse(`no offer with slug "${slug}" in pending_gold_jobs.json`, options.claimRun === '');
  const current = String(job.status ?? '');
  const applying = (job.applying ?? {}) as { run?: unknown; at?: unknown };
  const applyingRun = String(applying.run ?? '');
  const withArtifacts = (entry: PendingJob, fields: Record<string, unknown>): PendingJob[] =>
    jobs.map((other) => (other === entry ? { ...entry, status: 'APPLYING', applying: { ...(entry.applying as object | undefined), ...fields, artifacts: options.artifacts } } : other));

  if (options.claimRun !== '') {
    if (!holdsClaim(job, options.claimRun)) {
      return refuse(`${job.slug} is ${current || 'without status'}${applyingRun !== '' ? ` (applying.run ${applyingRun})` : ''}, no longer held by the listener claim ${options.claimRun}: nothing is done`, false);
    }
    const noted = current === 'APPLYING' ? withArtifacts(job, {}) : null;
    return { jobs: noted, ok: true, claim: options.claimRun, self: false, summary: `held by the listener claim ${options.claimRun}` };
  }

  if (options.run === '') return refuse('no run id (WORKFLOW_ID) to claim the offer with: nothing is done', true);
  if (current === 'APPLYING' && applyingRun === options.run) {
    return { jobs: withArtifacts(job, {}), ok: true, claim: options.run, self: true, summary: `already claimed by this run (${options.run})` };
  }
  if (current === 'APPLYING') {
    return refuse(`${job.slug} is APPLYING by another run (${applyingRun || 'unknown'}, since ${String(applying.at ?? 'an unknown time')}), which records its own status: this run does nothing`, true);
  }
  if (current === 'APPLIED' || current === 'APPLY_UNPROVEN') {
    return refuse(`${job.slug} is ${current}: it was sent (or may have been) and is never applied to twice; check the mailbox and the platform, then /valider only if nothing was sent`, true);
  }
  const busy = inFlight(jobs, options.now).filter((entry) => entry.slug !== job.slug);
  if (busy.length > 0) return refuse(`${busyNote(busy)} This run does nothing: start it again once that one has finished.`, true);
  return {
    jobs: withArtifacts(job, { run: options.run, at: options.now.toISOString(), from: current }),
    ok: true,
    claim: options.run,
    self: true,
    summary: `claimed by this run (${options.run}), from ${current || 'no status'}: APPLYING, so the listener leaves it alone`,
  };
}

export function markApplying(jobs: PendingJob[], slug: string, run: string, now: Date): PendingJob[] {
  return jobs.map((job) => (job.slug === slug ? { ...job, status: 'APPLYING', applying: { run, at: now.toISOString() } } : job));
}

export function markFailed(jobs: PendingJob[], slug: string, run: string, now: Date, reason: string): PendingJob[] {
  return jobs.map((job) => (job.slug === slug ? { ...job, status: 'APPLY_FAILED', applying: undefined, harness: { ...carriedAttempts(job), run, stage: 'listener', at: now.toISOString(), summary: reason } } : job));
}

/** La prise à clore : l'offre et la prise (`applying.run`) que le run tenait. */
export interface Claimed {
  path: string;
  slug: string;
  run: string;
}

/** La raison écrite quand un sous-run career-apply se termine sans avoir écrit de statut. */
export function orphanReason(run: string): string {
  return (
    'career-apply ended without recording a final status (its run failed or was cancelled: a model or script error outside a block, ' +
    `such as resolve, or a cancel). See archon workflow status ${run || '<listener run>'} for the sub-run; check its submission/ artifacts ` +
    'and the mailbox before re-validating (/valider).'
  );
}

/** L'issue que le sous-run career-apply a rendue (sortie de `record`), telle que `close` la lit. */
export interface ChildResult {
  ok: boolean;
  stage: string;
  status: string;
  summary: string;
  status_written?: boolean;
}

const JOB_STATUSES: readonly string[] = ['VALIDATED', 'TAILORED', 'APPLIED', 'APPLY_UNPROVEN', 'APPLY_FAILED'];
const STAGES: readonly string[] = ['load', 'tailor', 'render', 'route', 'submit', 'done'];

/** L'offre de la prise, si elle est encore APPLYING par elle ; sinon son statut. */
function appliedBy(jobs: PendingJob[], claim: Claimed | null): { job: PendingJob | null; status: string } {
  if (claim === null || claim.path !== 'work' || claim.slug === '' || claim.run === '') return { job: null, status: '' };
  const wanted = claim.slug.toLowerCase();
  const job = jobs.find((entry) => entry && typeof entry === 'object' && String(entry.slug ?? '').toLowerCase() === wanted);
  if (job === undefined) return { job: null, status: '' };
  const applying = job.applying as { run?: string } | undefined;
  if (job.status !== 'APPLYING' || applying?.run !== claim.run) return { job: null, status: String(job.status ?? '') };
  return { job, status: 'APPLYING' };
}

/** Le statut que `record` a calculé, écrit sur l'offre de la prise (compteur et plafond de `recordStatus`). */
function writeResult(jobs: PendingJob[], job: PendingJob, claim: Claimed, result: ChildResult, now: Date, note: string): { jobs: PendingJob[]; status: string } {
  // Le résumé de `record` finit par « Status <statut> (not written: …). » : on garde ce qui précède.
  const cut = result.summary.indexOf(` Status ${result.status} (not written`);
  const outcome: Outcome = {
    ok: result.ok === true,
    stage: (STAGES.includes(result.stage) ? result.stage : 'done') as Stage,
    status: result.status as JobStatus,
    summary: cut >= 0 ? result.summary.slice(0, cut) : result.summary,
  };
  const written = recordStatus(job, outcome, claim.run, now);
  return {
    jobs: jobs.map((entry) => (entry === job ? { ...entry, status: written.status, applying: undefined, harness: { ...written.harness, note } } : entry)),
    status: written.status,
  };
}

/**
 * Le filet (`settle` du listener, `settle` de career-apply pour un run lancé à la main, et
 * `close` quand le sous-run n'a rien rendu). L'offre est-elle encore APPLYING par CETTE prise
 * (`applying.run` = la prise) ? Alors le run s'est terminé sans écrire de statut, et, dans
 * l'ordre :
 * 1. l'issue que `record` avait calculée, sauvée avant toute écriture (`result` : close.json
 *    du listener, record.json de career-apply) : son statut, comme `record` l'aurait écrit
 *    (`recordStatus` : un run lancé à la main n'y remet pas en file une offre prise hors de
 *    VALIDATED, `applying.from` est réécrit à la place) ;
 * 2. sinon, si le `submission/` du run montre qu'un clic a pu avoir lieu (`evidence`,
 *    `clickEvidence` sur `applying.artifacts`) : APPLY_UNPROVEN, jamais « échoué » ;
 * 3. sinon APPLY_FAILED avec la raison.
 * Une offre que `record` a déjà écrite, close par une prise périmée, reprise à la main ou prise
 * par un autre run n'est pas touchée.
 */
export function settleClaim(
  jobs: PendingJob[],
  claim: Claimed | null,
  now: Date,
  reason: string,
  options: { result?: ChildResult | null; evidence?: (job: PendingJob) => string[]; by?: string } = {}
): { jobs: PendingJob[]; settled: boolean; status: string; via: '' | 'result' | 'evidence' | 'reason' } {
  const held = appliedBy(jobs, claim);
  if (held.job === null || claim === null) return { jobs, settled: false, status: held.status, via: '' };
  const result = options.result ?? null;
  if (result !== null && JOB_STATUSES.includes(result.status)) {
    const note = `Written by ${options.by ?? 'the listener (settle)'} from the result career-apply saved before its own write failed.`;
    const written = writeResult(jobs, held.job, claim, result, now, note);
    return { jobs: written.jobs, settled: true, status: written.status, via: 'result' };
  }
  const evidence = options.evidence?.(held.job) ?? [];
  if (evidence.length > 0) {
    const summary = unprovenNote(reason, evidence);
    const job = held.job;
    return {
      jobs: jobs.map((entry) => (entry === job ? { ...entry, status: 'APPLY_UNPROVEN', applying: undefined, harness: { ...carriedAttempts(entry), run: claim.run, stage: 'listener', at: now.toISOString(), summary } } : entry)),
      settled: true,
      status: 'APPLY_UNPROVEN',
      via: 'evidence',
    };
  }
  return { jobs: markFailed(jobs, held.job.slug, claim.run, now, reason), settled: true, status: 'APPLY_FAILED', via: 'reason' };
}

/**
 * `close` du listener quand `record` a rendu une issue sans pouvoir l'écrire
 * (`status_written: false` : fichier verrouillé ou illisible à ce moment-là). Même garde que
 * `settleClaim` : seulement si l'offre est encore APPLYING par CETTE prise ; elle reçoit alors
 * le statut que `record` a calculé (compteur et plafond de `recordStatus` compris), au lieu de
 * l'APPLY_FAILED que `settle` écrirait ensuite sur une candidature peut-être envoyée. Une
 * offre que `record` a laissée exprès (validation plus récente, envoi d'un autre run…) n'est
 * plus APPLYING par cette prise : pas touchée.
 */
export function recordUnwritten(jobs: PendingJob[], claim: Claimed | null, result: ChildResult | null, now: Date): { jobs: PendingJob[]; written: boolean; status: string } {
  if (result === null || result.status_written !== false || !JOB_STATUSES.includes(result.status)) return { jobs, written: false, status: '' };
  const held = appliedBy(jobs, claim);
  if (held.job === null || claim === null) return { jobs, written: false, status: held.status };
  const written = writeResult(jobs, held.job, claim, result, now, 'Written by career-listener (close): career-apply could not write its own status.');
  return { jobs: written.jobs, written: true, status: written.status };
}

// ── La synchronisation PC ⇄ VM (integrations/master-plan/sync_pending.ps1) ─────────────

/** Les statuts que seul le harness écrit (côté PC). */
export const HARNESS_STATUSES: readonly string[] = ['APPLYING', 'TAILORED', 'APPLIED', 'APPLY_UNPROVEN', 'APPLY_FAILED'];
/**
 * Une candidature en cours ou partie : la copie de la VM ne la remplace jamais. Le bot refuse
 * `/valider` sur ces statuts ; un `/valider` fait sur la VM pendant ce temps a été donné sur
 * une vue périmée (la VM montrait encore VALIDATED ou APPLY_FAILED) et reste sans effet.
 */
export const LOCKED_STATUSES: readonly string[] = ['APPLYING', 'APPLIED', 'APPLY_UNPROVEN'];

function parsedTime(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** La dernière écriture du harness sur l'offre (`harness.at`, `applying.at`), horloge du PC. */
function harnessStamp(job: PendingJob): number {
  const harness = job.harness as { at?: unknown } | undefined;
  const applying = job.applying as { at?: unknown } | undefined;
  return Math.max(parsedTime(harness?.at), parsedTime(applying?.at));
}

function withHarnessFields(base: PendingJob, from: PendingJob, status: string): PendingJob {
  const out: PendingJob = { ...base, status };
  for (const key of ['harness', 'applying'] as const) {
    if (from[key] === undefined) delete out[key];
    else out[key] = from[key];
  }
  return out;
}

/**
 * Une offre présente des deux côtés. Les champs du bot (tout sauf `status`, `harness`,
 * `applying`) viennent de la VM, où vit le bot. `status`, `harness`, `applying` :
 * 1. statut verrouillé côté PC (APPLYING, APPLIED, APPLY_UNPROVEN) : ceux du PC, toujours ;
 * 2. sinon, nouvelle validation sur la VM (`validated_at` plus récent : `/valider`) ou statut
 *    que seul le bot écrit sur la VM (PENDING_VALIDATION, ou tout statut hors du harness et
 *    hors VALIDATED) : le statut de la VM (sans `applying`), l'historique `harness` du PC ;
 * 3. sinon, ceux du côté dont la dernière écriture du harness est la plus récente, le PC à
 *    égalité (le PC est le seul à les écrire : la VM n'a que ce qu'il a poussé).
 */
export function mergeJob(pc: PendingJob, vm: PendingJob): { job: PendingJob; from: 'pc' | 'vm'; why: string } {
  const pcStatus = String(pc.status ?? '');
  const vmStatus = String(vm.status ?? '');
  if (LOCKED_STATUSES.includes(pcStatus)) {
    return { job: withHarnessFields(vm, pc, pcStatus), from: 'pc', why: `${pcStatus} on the PC (in progress or sent) is never replaced` };
  }
  const revalidated = parsedTime(vm.validated_at) > parsedTime(pc.validated_at);
  const botStatus = !HARNESS_STATUSES.includes(vmStatus) && vmStatus !== 'VALIDATED';
  if (revalidated || botStatus) {
    const harness = pc.harness !== undefined ? pc : vm;
    const job = withHarnessFields(vm, { ...harness, applying: undefined } as PendingJob, vmStatus);
    return { job, from: 'vm', why: revalidated ? `re-validated on the VM (validated_at ${String(vm.validated_at)})` : `${vmStatus} set by the bot` };
  }
  if (harnessStamp(vm) > harnessStamp(pc)) {
    return { job: withHarnessFields(vm, vm, vmStatus), from: 'vm', why: 'newer harness write on the VM copy' };
  }
  return { job: withHarnessFields(vm, pc, pcStatus), from: 'pc', why: 'harness status kept from the PC' };
}

/**
 * Fusionne les deux copies de `pending_gold_jobs.json`, offre par offre (`mergeJob`), au lieu
 * d'écraser l'une par l'autre. Même règle au `pull` (avant le tour : la copie de la VM entre
 * dans celle du PC) et au `push` (après le tour : une copie de la VM relue à l'instant reçoit
 * les statuts du PC, puis est renvoyée), pour qu'un `/valider` fait entre-temps sur la VM ne
 * soit pas perdu, ni un statut écrit sur le PC après un go donné entre deux tours.
 * L'ordre est celui de la VM ; une offre présente d'un seul côté est gardée (à la fin pour le
 * PC) : le harness ne supprime jamais une offre. `notes` dit chaque offre où les copies
 * différaient et laquelle l'a emporté.
 */
export function mergeBoards(pc: unknown, vm: unknown): { jobs: PendingJob[]; notes: string[] } {
  const pcJobs = (Array.isArray(pc) ? pc : []) as PendingJob[];
  const vmJobs = (Array.isArray(vm) ? vm : []) as PendingJob[];
  const isJob = (entry: unknown): entry is PendingJob => entry !== null && typeof entry === 'object' && typeof (entry as PendingJob).slug === 'string' && (entry as PendingJob).slug !== '';
  // L'offre se reconnaît à son `id` ; le slug seul ne suffit pas : deux annonces d'une même entreprise
  // le partagent (2026-11-03, COROS : la deuxième, seulement sur le PC, était jetée à chaque fusion).
  // Sans id commun, une ligne retombe sur le slug : la première ligne du PC de ce slug, sans id et encore libre.
  const idOf = (job: PendingJob): string => {
    const id = (job as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : '';
  };
  const pcById = new Map<string, PendingJob>();
  for (const job of pcJobs) if (isJob(job) && idOf(job) !== '' && !pcById.has(idOf(job))) pcById.set(idOf(job), job);
  const used = new Set<PendingJob>();
  const notes: string[] = [];
  const jobs: PendingJob[] = [];
  for (const entry of vmJobs) {
    if (!isJob(entry)) {
      jobs.push(entry);
      continue;
    }
    const id = idOf(entry);
    let local = id !== '' ? pcById.get(id) : undefined;
    if (local !== undefined && used.has(local)) local = undefined;
    if (local === undefined) local = pcJobs.find((j) => isJob(j) && !used.has(j) && j.slug === entry.slug && idOf(j) === '');
    if (local === undefined) {
      jobs.push(entry);
      continue;
    }
    used.add(local);
    const merged = mergeJob(local, entry);
    if (local.status !== entry.status) notes.push(`${entry.slug}${id !== '' ? ` (${id})` : ''}: PC ${String(local.status)} / VM ${String(entry.status)} → ${String(merged.job.status)} (${merged.why})`);
    jobs.push(merged.job);
  }
  const kept = new Set<string>();
  for (const job of pcJobs) {
    if (!isJob(job) || used.has(job)) continue;
    const id = idOf(job);
    const key = id !== '' ? `id:${id}` : `slug:${job.slug}`;
    if (kept.has(key) || (id !== '' && jobs.some((j) => isJob(j) && idOf(j) === id))) continue;
    kept.add(key);
    jobs.push(job);
    notes.push(`${job.slug}${id !== '' ? ` (${id})` : ''}: only on the PC, kept`);
  }
  return { jobs, notes };
}

// ── Le fichier lui-même : verrou, lecture, écriture (E/S de tous ses écrivains) ─────────

/** Âge au-delà duquel un verrou est celui d'un écrivain mort (une écriture tient en millisecondes). */
export const LOCK_STALE_MS = 15_000;
/** Attente maximale du verrou avant d'abandonner sans rien écrire. */
export const LOCK_WAIT_MS = 40_000;
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function codeOf(err: unknown): string {
  return err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
}

/** Attente synchrone (les scripts des nœuds sont synchrones). */
export function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Refait `what` sur EPERM / EBUSY / EACCES (Windows : fichier tenu un instant par un autre), avec un délai croissant. */
export function retrying<T>(what: () => T, delays: readonly number[] = [50, 100, 200, 400, 800, 1600]): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return what();
    } catch (err) {
      if (!RETRYABLE.has(codeOf(err)) || attempt >= delays.length) throw err;
      pause(delays[attempt]!);
    }
  }
}

/** Le chemin du tableau dans le dossier carrière, et celui de son verrou. */
export function boardPathIn(careerDir: string): string {
  return join(careerDir, 'pending_gold_jobs.json');
}
export function lockPathOf(boardPath: string): string {
  return `${boardPath}.lock`;
}

/** Lit le tableau (BOM toléré) ; lève si absent, illisible ou pas un tableau. */
export function readBoard(boardPath: string): PendingJob[] {
  const raw = retrying(() => readFileSync(boardPath, 'utf8'));
  const parsed = JSON.parse(raw.replace(/^﻿/, '')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${boardPath} is not a JSON array`);
  return parsed as PendingJob[];
}

/** Écrit le tableau d'un bloc (tmp → rename), chaque étape refaite sur EPERM / EBUSY. */
export function writeBoard(boardPath: string, jobs: unknown[], content = JSON.stringify(jobs, null, 2)): void {
  const tmp = `${boardPath}.tmp`;
  retrying(() => writeFileSync(tmp, content, 'utf8'));
  retrying(() => renameSync(tmp, boardPath));
}

function lockAge(lock: string): number | null {
  try {
    return Date.now() - statSync(lock).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Casse un verrou plus vieux que `staleMs` (son détenteur est mort : une écriture dure des
 * millisecondes). Le renommer de côté est atomique : un seul des écrivains en attente y
 * parvient. Celui qui l'a renommé revérifie l'âge du fichier mis de côté : s'il est récent, un
 * autre écrivain venait de prendre le verrou entre la mesure et le renommage, et il est remis
 * en place (lien exclusif).
 */
function breakIfStale(lock: string, staleMs: number, token: string): void {
  const age = lockAge(lock);
  if (age === null || age <= staleMs) return;
  const aside = `${lock}.stale-${token}`;
  try {
    renameSync(lock, aside);
  } catch {
    return;
  }
  const asideAge = lockAge(aside);
  if (asideAge !== null && asideAge <= staleMs) {
    try {
      linkSync(aside, lock);
    } catch {
      // Un troisième écrivain a déjà pris le verrou : celui mis de côté n'est plus remis.
    }
  }
  try {
    retrying(() => rmSync(aside, { force: true }));
  } catch {
    // Reste un fichier .stale-* sans effet sur le verrou.
  }
}

/**
 * Prend le verrou du tableau (`pending_gold_jobs.json.lock`, créé en exclusif) et rend son
 * jeton. Attend son tour (délai croissant, avec un peu de hasard) ; casse un verrou plus vieux
 * que `staleMs` ; abandonne après `waitMs` en levant une erreur (rien n'est écrit).
 */
export function acquireBoardLock(boardPath: string, holder: string, options: { staleMs?: number; waitMs?: number } = {}): string {
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const lock = lockPathOf(boardPath);
  const token = `${process.pid}-${randomUUID()}`;
  const deadline = Date.now() + waitMs;
  let delay = 10;
  for (;;) {
    try {
      writeFileSync(lock, JSON.stringify({ token, holder, pid: process.pid, at: new Date().toISOString() }), { encoding: 'utf8', flag: 'wx' });
      return token;
    } catch (err) {
      const code = codeOf(err);
      if (code !== 'EEXIST' && !RETRYABLE.has(code)) throw err;
    }
    breakIfStale(lock, staleMs, token);
    if (Date.now() >= deadline) {
      throw new Error(`pending_gold_jobs.json is locked by another writer (${lock}) for more than ${Math.round(waitMs / 1000)} s; nothing was written`);
    }
    pause(delay + Math.floor(Math.random() * delay));
    delay = Math.min(delay * 2, 200);
  }
}

/** Rend le verrou, seulement s'il porte encore ce jeton (cassé comme périmé, il est à un autre). */
export function releaseBoardLock(boardPath: string, token: string): void {
  const lock = lockPathOf(boardPath);
  try {
    const held = JSON.parse(retrying(() => readFileSync(lock, 'utf8'))) as { token?: unknown };
    if (held.token === token) retrying(() => rmSync(lock, { force: true }));
  } catch {
    // Déjà rendu, ou illisible : rien à rendre.
  }
}

/** `body` sous le verrou du tableau ; le verrou est rendu même si `body` lève. */
export function withBoardLock<T>(boardPath: string, holder: string, body: () => T, options: { staleMs?: number; waitMs?: number } = {}): T {
  const token = acquireBoardLock(boardPath, holder, options);
  try {
    return body();
  } finally {
    releaseBoardLock(boardPath, token);
  }
}

/**
 * Relit, modifie et réécrit le tableau sous son verrou : la forme qu'emprunte chaque écrivain.
 * `change` rend les offres à écrire (null : rien à écrire) et une valeur pour l'appelant.
 */
export function updateBoard<T>(boardPath: string, holder: string, change: (jobs: PendingJob[]) => { jobs: PendingJob[] | null; value: T }): T {
  return withBoardLock(boardPath, holder, () => {
    const { jobs, value } = change(readBoard(boardPath));
    if (jobs !== null) writeBoard(boardPath, jobs);
    return value;
  });
}

/**
 * Ce qu'apply-submit a laissé dans un dossier `submission/` (texte brut des JSON, présence
 * de la capture), pour `clickEvidence`. Un fichier présent mais illisible vaut '' : il compte
 * comme une trace.
 */
export function readSubmission(dir: string): SubmissionFiles {
  const read = (name: string): string | null => {
    const path = join(dir, name);
    try {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
      return '';
    }
  };
  return {
    decision: read('decision.json'),
    armed: read('armed.json'),
    click: read('click.json'),
    prefill: read('prefill.json'),
    receipt: read('receipt.json'),
    receiptScreenshot: existsSync(join(dir, 'receipt.png')),
  };
}

/**
 * Les traces d'un clic possible dans le `submission/` du run qui tenait l'offre
 * (`applying.artifacts`, noté par `load` de career-apply ; `out_dir: submission`). Aucune
 * trace quand le dossier n'est pas noté (prise d'avant ce champ, ou `load` jamais arrivé).
 */
export function submissionEvidence(job: PendingJob): string[] {
  const artifacts = (job.applying as { artifacts?: unknown } | undefined)?.artifacts;
  if (typeof artifacts !== 'string' || artifacts === '') return [];
  return clickEvidence(readSubmission(join(artifacts, 'submission')));
}
