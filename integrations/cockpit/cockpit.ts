#!/usr/bin/env bun
/**
 * Cockpit local du plan carrière : une page sur le PC (127.0.0.1 seulement) qui lit le
 * tableau du bot, lance `career-apply` sur les offres choisies (une à la fois, `mode=confirm`),
 * montre l'annonce (lien, champs du tableau, texte de la page lu comme `load` le lit), tes
 * remarques sur l'offre (le même fichier que `/remarque` du bot, lu par le prochain run),
 * l'avancement du run, le CV et la lettre (en PDF tels qu'ils seront joints), la fiche candidat,
 * les décideurs à qui écrire et les messages (bloc decision-makers, rien n'est envoyé), le reçu,
 * et relaie ton go (`archon workflow approve`) ou ton refus (`reject`). Ce qui attend ton geste
 * (go, compte à ouvrir, candidature à finir, envoi à vérifier, étape en échec) est en tête de la
 * page et, sous Windows, en notification (une fois par situation ; `--no-toast` l'arrête). Le tableau est
 * rafraîchi depuis la VM (sync_pending.ps1 -Direction pull : scp + fusion offre par offre, rien
 * ne part) au démarrage, toutes les --pull-every minutes (5) et sur le bouton. Les sources
 * d'offres sont relevées par le système `career-radar` (scripts seulement, aucun modèle) : une
 * relève à la fois, 60 s après le démarrage puis toutes les 15 min (`radar_auto: false` dans
 * candidat.json ou `--no-radar` l'arrêtent) et sur le bouton ; son rapport
 * (`<career>/last_radar_report.json`) est montré sous les outils de la liste.
 *
 * Avec `selection.json` dans le dossier carrière, la sélection du jour (selection.ts, 2026-11-08) :
 * à l'heure dite, Claude (Sonnet) juge une liste courte, les meilleures vont dans selection/<date>.json,
 * et un oui d'Antoine déposé dans inbox/ part en career-apply ; c'est le seul chemin automatique qui
 * fait appeler un modèle (quelques offres par jour, plafonné).
 * Il n'appelle aucun modèle et n'envoie rien lui-même : il lance Archon, qui s'arrête au go.
 * Lancement : bun integrations/cockpit/cockpit.ts --career-dir "<harness>\.local\career"
 * (ou cockpit.cmd sous Windows). Fonctions pures et testées : lib.ts ; ce fichier branche
 * le disque, Archon et HTTP. Les runs lancés sont notés dans .local/cockpit/launches.json
 * (`.local/` n'est jamais versionné).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import {
  type AttentionItem, attentionItems, contactsRunArgs, type CoreFit, coreFit, contactsView, pickPdf, toastCommand,
  INTERVIEW_STAGES, type InterviewStage, type Offer, RADAR_FIRST_DELAY_MS, type RadarReport, type RunRow, allowedHosts, artifactsDirOf, candidatePaths, canLaunch, chromePath, chromeProfileDir, chromeProfileWanted, robotBrowserArgs, interviewRunArgs, isLive, isLocalHost, openableUrl, openerArgs, zoneOf, isTextFile, latestRunBySlug, nodeLabel, own, parseArgs,
  parseDetachedRunId, parseRemarks, parseRuns, progress, pullArgs, radarRunArgs, readCandidate, readOffers, readRadarReport, refusal, remarkEntry, respondArgs, stopArgs, runArgs, runStatusLabel, runsOfCareer, sortOffers, stepStateKind, stepStateLabel, vmRadarAlive,
} from './lib.ts';
import { POSTING_HEADERS, type PendingJob, postingText, postingUrl, visibleText } from '../../.archon/workflows/systems/.shared/career.ts';
import { MAX_TRIAGE_ATTEMPTS, type TriageRecord, criteriaHash, criteriaPathIn, needsTriage, pickUntriaged, preScreen, readTriageRecords, scopeOverride, triageKey, triageRunArgs } from '../../.archon/workflows/systems/.shared/triage.ts';
import { type PostingGuard, guardPosting } from '../../.archon/workflows/systems/.shared/posting-guard.ts';
import { checkAccess, remoteConfigLoader } from './remote.ts';
import {
  INBOX_DIR, SELECTION_CONFIG, SELECTION_DIR, type SelectionConfig, type SelectionDay, buildShortlist, dayComplete, localDay, newDay, nextToJudge, proposedKeys, rankedPicks, readDay, readInboxAdds, readInboxAnswer, readSelectionConfig, selectionDue,
} from './selection.ts';
import { REMOTE_COMPANIES_FILE, REMOTE_JOBS_FILE, type RemoteView, remoteJobToPending, remoteView } from './remote-companies.ts';
import { queueProspect, setVerdict, signalsView } from '../company-signals/cockpit-signals.ts';
import { withBoardLock, writeBoard } from '../../.archon/workflows/systems/.shared/pending.ts';
import { appendNew } from '../../.archon/workflows/systems/.shared/radar.ts';
import { envCandidates, existingEnvFiles } from '../../.archon/workflows/systems/.shared/radar-env.ts';
import { LINK_FILE, TOKEN_NAME, TelegramError, cockpitUrlFrom, parseBotLink, readBotLink, readEnvKey, tg, writeJsonAtomic } from '../telegram-radar/telegram.ts';
import { type BotState, type Call, handleUpdate, parseBotState, settlePending } from '../telegram-radar/pc-bot.ts';

const { evaluateTerritory } = createRequire(import.meta.url)('../../.archon/workflows/systems/.shared/radar/inspectors/remote_auditor.js') as {
  evaluateTerritory: (job: { location: string; description: string }) => { pass: boolean; reason?: string };
};

const args = parseArgs(process.argv.slice(2));
const harness = resolve(args.harness ?? join(import.meta.dir, '..', '..'));
const careerDir = resolve(args.careerDir);
const boardPath = join(careerDir, 'pending_gold_jobs.json');
const candidatePath = join(careerDir, 'candidat.json');
const pagePath = join(import.meta.dir, 'page.html');
// L'icône du bureau sert aussi d'icône à la fenêtre (barre des tâches) : Chrome --app prend celle de la page.
const iconPath = join(import.meta.dir, 'cockpit-v2.ico');
// Accès depuis le téléphone (tailscale-phone.ps1) : comptes autorisés, relus quand le fichier change.
const remoteConfig = remoteConfigLoader(() => join(harness, '.local', 'cockpit', `remote-${server.port}.json`));
const MAX_TEXT = 200_000;

if (!existsSync(boardPath)) {
  console.error(`Tableau introuvable : ${boardPath}\n(--career-dir doit pointer sur le dossier carrière : .local\\career du harness, ou celui d'un autre candidat)`);
  process.exit(2);
}

// ── Le candidat ─────────────────────────────────────────────────────────────────────────
// Sans candidat.json : le candidat d'origine, comme avant. Avec : son nom, son port, son profil de
// navigateur (passé à Archon par HARNESS_BROWSER_PROFILE, lu par .archon/mcp/browser.json) et ses
// runs notés à part. Les runs d'un autre dossier carrière ne sont jamais montrés ni attendus ici.
let candidate: ReturnType<typeof readCandidate>;
try {
  candidate = readCandidate(existsSync(candidatePath) ? (JSON.parse(readFileSync(candidatePath, 'utf8').replace(/^\uFEFF/, '')) as unknown) : null);
} catch (err) {
  console.error(`${candidatePath} : ${(err as Error).message}`);
  process.exit(2);
}
const { browserProfile, launches: launchesPath } = candidatePaths(candidate, harness, join, isAbsolute);
const port = args.port ?? candidate.port ?? 8766;
const archonEnv = { ...process.env, HARNESS_BROWSER_PROFILE: browserProfile };

/**
 * Le profil Chrome d'Antoine où s'ouvrent les annonces (celui qui porte l'extension Claude, pas un profil
 * de travail) : `chrome.json` (`{"profil": "<nom du profil ou compte Google>"}`) à côté de la liste des
 * runs, résolu dans `Local State` de Chrome à chaque ouverture (un profil créé ou renommé est vu tout de
 * suite). Null : pas de réglage, pas Windows, ou aucun profil ne correspond (Chrome ouvre alors le dernier utilisé).
 */
let chromeProfileWarned = '';
function chromeProfile(): string | null {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  let wanted = '';
  try {
    const conf = join(dirname(launchesPath), 'chrome.json');
    wanted = existsSync(conf) ? chromeProfileWanted(JSON.parse(readFileSync(conf, 'utf8').replace(/^\uFEFF/, ''))) : '';
    if (wanted === '') return null;
    const state = join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Local State');
    const localState = existsSync(state) ? (JSON.parse(readFileSync(state, 'utf8')) as unknown) : null;
    const dir = chromeProfileDir(localState, wanted);
    if (dir !== null) return dir;
    // Un nom de dossier Chrome (« Profile 1 », « Default ») vaut par lui-même, même si Local State n'a pas pu être lu.
    if (/^(Default|Profile \d+)$/i.test(wanted)) return wanted;
    if (chromeProfileWarned !== wanted) {
      chromeProfileWarned = wanted;
      const cache = (localState as { profile?: { info_cache?: Record<string, { name?: unknown }> } } | null)?.profile?.info_cache ?? {};
      console.error(`chrome.json : aucun profil Chrome ne correspond à « ${wanted} » ; profils : ${Object.entries(cache).map(([d, i]) => `${d} (${String(i?.name ?? '')})`).join(', ') || 'Local State illisible'}`);
    }
    return null;
  } catch {
    return /^(Default|Profile \d+)$/i.test(wanted) ? wanted : null;
  }
}

// ── Archon ──────────────────────────────────────────────────────────────────────────────
interface Exec {
  code: number;
  stdout: string;
  stderr: string;
}

async function archon(argv: string[], timeoutMs = 90_000): Promise<Exec> {
  const proc = Bun.spawn([...args.archon, ...argv], { cwd: harness, stdout: 'pipe', stderr: 'pipe', env: archonEnv });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, stdout, stderr };
}

/** La première ligne JSON objet de la sortie (Archon peut l'entourer de texte). */
function firstJsonObject(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  try {
    const v = JSON.parse(text) as unknown;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* plusieurs lignes */
  }
  for (const line of text.split('\n')) {
    try {
      const v = JSON.parse(line) as unknown;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* texte */
    }
  }
  return null;
}

const errors: { at: string; text: string }[] = [];
const note = (text: string): void => {
  errors.unshift({ at: new Date().toISOString(), text });
  errors.splice(20);
  console.error(text);
};

// ── Le tableau de la VM ─────────────────────────────────────────────────────────────────
interface PullState {
  at: string | null;
  ok: boolean | null;
  output: string;
  running: boolean;
  every: number;
  command: string;
}

const pullCommand = args.pull ?? pullArgs({ harness, careerDir, platform: process.platform, join, resolve });
// Un candidat dont le tableau ne vient pas de la VM (`tableau_depuis_vm` absent de candidat.json) n'est jamais rafraîchi d'ici.
const pullEnabled = args.pull !== null || candidate.pull === 'vm';
const pull: PullState = { at: null, ok: null, output: pullEnabled ? '' : 'ce tableau ne vient pas de la VM', running: false, every: pullEnabled ? args.pullEvery : 0, command: pullEnabled ? pullCommand.join(' ') : '' };

/** Rapatrie le tableau de la VM et le fusionne dans la copie du PC (jamais deux à la fois). */
async function pullFromVm(): Promise<PullState> {
  if (pull.running || !pullEnabled) return pull;
  pull.running = true;
  try {
    const proc = Bun.spawn(pullCommand, { cwd: harness, stdout: 'pipe', stderr: 'pipe', env: process.env });
    const timer = setTimeout(() => proc.kill(), 180_000);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(timer);
    pull.at = new Date().toISOString();
    pull.ok = code === 0;
    pull.output = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim().slice(-1500);
    if (!pull.ok) note(`rafraîchissement depuis la VM refusé (code ${code}) : ${pull.output.slice(-400)}`);
    else console.log(`⟳ tableau rafraîchi depuis la VM (${pull.at})`);
  } catch (err) {
    pull.at = new Date().toISOString();
    pull.ok = false;
    pull.output = (err as Error).message;
    note(`rafraîchissement depuis la VM : ${pull.output}`);
  } finally {
    pull.running = false;
  }
  return pull;
}

// ── État ────────────────────────────────────────────────────────────────────────────────
function readLaunches(): Record<string, string> {
  try {
    const v = JSON.parse(readFileSync(launchesPath, 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function noteLaunch(slug: string, runId: string): void {
  const launches = readLaunches();
  launches[slug] = runId;
  mkdirSync(join(launchesPath, '..'), { recursive: true });
  writeFileSync(launchesPath, JSON.stringify(launches, null, 2), 'utf8');
}

/** La clé de launches.json sous laquelle la dernière relève des sources est notée : un slug d'offre est `[a-z0-9_]{1,20}`, jamais `#radar`. (Une ancienne clé `radar` est lue comme un slug ; latestRunBySlug ignore un run qui n'est pas une candidature.) */
const RADAR_KEY = '#radar';
/** Les candidatures lancées (slug → run), sans la relève. */
function applyLaunches(): Record<string, string> {
  const { [RADAR_KEY]: _radar, ...rest } = readLaunches();
  return rest;
}

// ── Préparation d'entretien (bloc interview-prep, un run par offre et par étape) ─────────
interface InterviewLaunch {
  id: string;
  stage: InterviewStage;
  at: string;
  /** Le dossier `interview-prep.md` recopié dans applications/<slug>/ une fois le run fini. */
  copied: string | null;
}
const interviewsPath = join(harness, '.local', 'cockpit', 'interviews.json');
function readInterviews(): Record<string, InterviewLaunch> {
  try {
    const v = JSON.parse(readFileSync(interviewsPath, 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, InterviewLaunch>) : {};
  } catch {
    return {};
  }
}
function writeInterviews(all: Record<string, InterviewLaunch>): void {
  mkdirSync(join(harness, '.local', 'cockpit'), { recursive: true });
  writeFileSync(interviewsPath, JSON.stringify(all, null, 2), 'utf8');
}

async function launchInterview(slug: string, stage: InterviewStage): Promise<Record<string, unknown>> {
  const appDir = join(careerDir, 'applications', slug);
  if (!existsSync(appDir)) return { error: `pas encore de dossier applications/${slug}/ : prépare d'abord la candidature (le bloc lit l'annonce, le CV et le pitch qui s'y trouvent)` };
  const known = own(readInterviews(), slug);
  if (known) {
    const row = (await listRuns()).rows.find((r) => r.id === known.id);
    if (row && isLive(row.status)) return { error: `une préparation (${known.stage}) est déjà en cours sur cette offre` };
  }
  const r = await archon(interviewRunArgs({ harness, careerDir, slug, stage, join }), 120_000);
  const runId = parseDetachedRunId(r.stdout);
  if (runId === null) return { error: `lancement refusé : ${(r.stderr || r.stdout).trim().slice(0, 600)}` };
  const all = readInterviews();
  all[slug] = { id: runId, stage, at: new Date().toISOString(), copied: null };
  writeInterviews(all);
  runsCache.at = 0;
  console.log(`▶ entretien ${stage} pour ${slug} : run ${runId}`);
  return { ok: true, id: runId, stage };
}

/** Les runs interview-prep par offre ; un run fini voit son `interview-prep.md` recopié dans applications/<slug>/Entretien_<étape>.md. */
function interviewViews(rows: RunRow[]): Record<string, RunView & { stage: InterviewStage; copied: string | null }> {
  const all = readInterviews();
  const latest = latestRunBySlug(rows, Object.fromEntries(Object.entries(all).map(([slug, l]) => [slug, l.id])), 'interview-prep');
  const out: Record<string, RunView & { stage: InterviewStage; copied: string | null }> = {};
  let changed = false;
  for (const [slug, run] of latest) {
    const launch = own(all, slug);
    const stage = launch?.stage ?? 'rh';
    if (launch && launch.copied === null && run.status === 'completed') {
      const dir = artifactsDirOf(run, join);
      const src = dir === null ? '' : join(dir, 'interview-prep.md');
      if (src !== '' && existsSync(src)) {
        const name = `Entretien_${stage}.md`;
        try {
          mkdirSync(join(careerDir, 'applications', slug), { recursive: true });
          writeFileSync(join(careerDir, 'applications', slug, name), readFileSync(src, 'utf8'), 'utf8');
          launch.copied = name;
          changed = true;
        } catch (err) {
          note(`copie de ${name} pour ${slug} : ${(err as Error).message}`);
        }
      }
    }
    out[slug] = { ...runView(run), stage, copied: launch?.copied ?? null };
  }
  if (changed) writeInterviews(all);
  return out;
}

// ── Décideurs (bloc decision-makers, un run par offre) ──────────────────────────────────
// Les personnes à qui écrire et les messages, cherchés sur des pages publiques (jamais LinkedIn) ;
// rien n'est envoyé. Un run à la fois : sur le bouton de l'onglet contacts, et tout seul (sauf
// --no-contacts) une fois par offre dont le CV est prêt depuis moins de CONTACTS_AUTO_DAYS jours.
// Le run fini, decideurs.json et decideurs.verdict.json sont recopiés dans applications/<slug>/.
interface ContactsLaunch {
  id: string;
  at: string;
  copied: boolean;
  auto: boolean;
}
const cockpitDir = dirname(launchesPath);
const contactsPath = join(cockpitDir, 'decideurs.json');
const CONTACTS_FILES = ['decideurs.json', 'decideurs.verdict.json'];
const CONTACTS_AUTO_DAYS = 7;
let contactsBusy = false;

function readJsonRecord<T>(path: string): Record<string, T> {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};
  } catch {
    return {};
  }
}
function writeJsonRecord(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

const liveContacts = (rows: RunRow[]): RunRow | null => rows.find((r) => r.workflow_name === 'decision-makers' && isLive(r.status)) ?? null;

async function launchContacts(slug: string, auto: boolean): Promise<Record<string, unknown>> {
  if (contactsBusy) return { error: 'une recherche de décideurs démarre déjà' };
  contactsBusy = true;
  try {
    const live = liveContacts((await listRuns()).rows);
    if (live !== null) return { error: 'une recherche de décideurs est déjà en cours (une à la fois)', id: live.id };
    if (!readBoard().offers.some((o) => o.slug === slug)) return { error: 'offre absente du tableau' };
    mkdirSync(join(careerDir, 'applications', slug), { recursive: true });
    const r = await archon(contactsRunArgs({ harness, careerDir, slug, join }), 120_000);
    const runId = parseDetachedRunId(r.stdout);
    if (runId === null) {
      const reason = `recherche des décideurs pour ${slug} refusée : ${(r.stderr || r.stdout).trim().slice(0, 600)}`;
      note(reason);
      return { error: reason };
    }
    const all = readJsonRecord<ContactsLaunch>(contactsPath);
    all[slug] = { id: runId, at: new Date().toISOString(), copied: false, auto };
    writeJsonRecord(contactsPath, all);
    runsCache.at = 0;
    console.log(`☎ décideurs pour ${slug}${auto ? ' (CV prêt)' : ''} : run ${runId}`);
    return { ok: true, id: runId };
  } finally {
    contactsBusy = false;
  }
}

/** Les runs decision-makers par offre ; un run fini voit ses fichiers recopiés dans applications/<slug>/. */
function contactsViews(rows: RunRow[]): Record<string, RunView & { copied: boolean }> {
  const all = readJsonRecord<ContactsLaunch>(contactsPath);
  const latest = latestRunBySlug(rows, Object.fromEntries(Object.entries(all).map(([slug, l]) => [slug, l.id])), 'decision-makers');
  const out: Record<string, RunView & { copied: boolean }> = {};
  let changed = false;
  for (const [slug, run] of latest) {
    const launch = own(all, slug);
    if (launch && launch.id === run.id && !launch.copied && run.status === 'completed') {
      const dir = artifactsDirOf(run, join);
      try {
        for (const name of CONTACTS_FILES) {
          const src = dir === null ? '' : join(dir, name);
          if (src !== '' && existsSync(src)) {
            mkdirSync(join(careerDir, 'applications', slug), { recursive: true });
            writeFileSync(join(careerDir, 'applications', slug, name), readFileSync(src, 'utf8'), 'utf8');
          }
        }
        launch.copied = true;
        changed = true;
      } catch (err) {
        note(`copie des décideurs pour ${slug} : ${(err as Error).message}`);
      }
    }
    out[slug] = { ...runView(run), copied: launch?.copied ?? false };
  }
  if (changed) writeJsonRecord(contactsPath, all);
  return out;
}

/** Le CV d'une offre est prêt : copié dans son dossier, ou dans le run qui attend le go. */
function cvReady(slug: string, run: RunRow | undefined): boolean {
  const dir = join(careerDir, 'applications', slug);
  if (existsSync(dir) && readdirSync(dir).some((f) => /^CV_.*\.md$/i.test(f))) return true;
  return run !== undefined && isLive(run.status) && progress(run).waiting !== null;
}

/** Une recherche à la fois, une seule fois toute seule par offre : la plus récente dont le CV est prêt et qui n'a pas encore ses décideurs. */
async function contactsTick(): Promise<void> {
  if (contactsBusy) return;
  // Hors --contacts : seules les offres à qui Antoine a dit oui dans la sélection du jour (decideurs, selection.json).
  const only = args.contacts ? null : readSelectionConfigFile()?.contacts === true ? selectionGoSlugs() : new Set<string>();
  if (only !== null && only.size === 0) return;
  try {
    const runs = await listRuns();
    if (liveContacts(runs.rows) !== null) return;
    const launched = readJsonRecord<ContactsLaunch>(contactsPath);
    const apply = latestRunBySlug(runs.rows, applyLaunches());
    const recent = Date.now() - CONTACTS_AUTO_DAYS * 86_400_000;
    const seen = new Set<string>();
    for (const o of sortOffers(readBoard().offers)) {
      if (seen.has(o.slug)) continue;
      seen.add(o.slug);
      if (only !== null && !only.has(o.slug)) continue;
      if (own(launched, o.slug) !== null || existsSync(join(careerDir, 'applications', o.slug, 'decideurs.json'))) continue;
      const run = apply.get(o.slug);
      const at = Date.parse(String(run?.started_at ?? o.harness?.at ?? ''));
      if (!Number.isFinite(at) || at < recent || !cvReady(o.slug, run)) continue;
      await launchContacts(o.slug, true);
      return;
    }
  } catch (err) {
    note(`décideurs : ${(err as Error).message}`);
  }
}

// ── Ce qui attend ton geste (alerte « à toi ») ──────────────────────────────────────────
// Calculé à chaque état (attentionItems, lib.ts). Une alerte marquée vue sur la page ne revient
// que si la situation change (autre run, autre passage) ; la notification Windows part une fois
// par situation, même après un redémarrage du cockpit (alertes.json).
const alertsPath = join(cockpitDir, 'alertes.json');
interface AlertsState {
  seen: Record<string, string>;
  toasted: Record<string, string>;
}
function readAlerts(): AlertsState {
  const raw = readJsonRecord<Record<string, string>>(alertsPath);
  return { seen: raw.seen ?? {}, toasted: raw.toasted ?? {} };
}

function currentAttention(offers: Offer[], rows: RunRow[]): AttentionItem[] {
  const latest = latestRunBySlug(rows, applyLaunches());
  const runs = Object.fromEntries([...latest].map(([slug, r]) => {
    const p = progress(r);
    return [slug, { id: r.id, status: r.status, waiting: p.waiting, failed: p.failed }];
  }));
  return attentionItems(offers, runs);
}

async function toastTick(): Promise<void> {
  if (!args.toast || process.platform !== 'win32' || !runsLoaded) return;
  try {
    const items = currentAttention(readBoard().offers, (await listRuns({ stale: true })).rows);
    const alerts = readAlerts();
    const fresh = items.filter((i) => own(alerts.toasted, i.key) === null && own(alerts.seen, i.key) === null);
    if (fresh.length === 0) return;
    const first = fresh[0]!;
    const title = fresh.length > 1 ? `${first.title} (+${fresh.length - 1})` : first.title;
    Bun.spawn(toastCommand(title, first.detail, `http://127.0.0.1:${server.port}/#${encodeURIComponent(first.slug)}`), { stdout: 'ignore', stderr: 'ignore' });
    for (const i of fresh) alerts.toasted[i.key] = new Date().toISOString();
    writeJsonRecord(alertsPath, alerts);
  } catch (err) {
    note(`notification : ${(err as Error).message}`);
  }
}

function readBoard(): { offers: Offer[]; raw: PendingJob[]; error: string | null } {
  try {
    const raw = JSON.parse(readFileSync(boardPath, 'utf8')) as unknown;
    return { offers: readOffers(raw), raw: Array.isArray(raw) ? (raw as PendingJob[]) : [], error: null };
  } catch (err) {
    return { offers: [], raw: [], error: `pending_gold_jobs.json illisible : ${(err as Error).message}` };
  }
}

// ── Tri des offres (career-triage) ──────────────────────────────────────────────────────
// Le tableau n'est jamais modifié : le tri vit dans <career>/triage/<clé>.json, écrit par le
// système career-triage et lu ici. Quand criteres.json existe, le cockpit lance un tri à la
// fois sur l'offre en attente la plus récente (jamais plus de MAX_TRIAGE_ATTEMPTS lancements
// par offre dans une session : un run qui n'écrit rien ne tourne pas en boucle).
interface TriageView {
  key: string;
  decision: TriageRecord['decision'];
  reasons: string[];
  notes: string[];
  /** `zone` : écartée par la règle de zone du radar, sans modèle (zoneOf) ; `regle` : par une règle de criteres.json que le code applique seul (`preRule` : offre trop ancienne, entreprise ≠ lien, métier exclu ; `scopeOverride` : full remote non écrit). */
  blockStatus: TriageRecord['block_status'] | 'zone' | 'regle';
  attempts: number;
  at: string;
  salary: TriageRecord['salary_annual_eur'];
  languages: string[];
  /** Un tri est encore attendu (critères changés, ou tri non vérifié retentable). */
  stale: boolean;
  /** L'adéquation au cœur du poste notée par le tri (`coreFit`), à la place du score du radar. */
  fit: CoreFit | null;
}
const triageLaunches = new Map<string, number>();
let triaging = false;
const criteriaPath = criteriaPathIn(careerDir);

function readCriteriaText(): string | null {
  if (!args.triage || !existsSync(criteriaPath)) return null;
  try {
    return readFileSync(criteriaPath, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

function readCriteriaHash(): string | null {
  const text = readCriteriaText();
  return text === null ? null : criteriaHash(text);
}

/**
 * L'offre pas encore touchée (à valider, validée) que le code écarte d'avance avec criteres.json, comme
 * `load` de career-triage (`preScreen`) : publiée depuis plus de `offre_age_max_jours` jours, entreprise
 * qui contredit le lien, métier exclu (`intitules_exclus`). Aucun run à lancer pour elle, et elle sort de la
 * liste sans attendre son tour. Une offre déjà préparée ou envoyée n'est jamais cachée pour son âge.
 */
function preRule(job: PendingJob, criteria: string | null): string | null {
  const status = String(job.status ?? '');
  if (criteria === null || (status !== '' && status !== 'PENDING_VALIDATION' && status !== 'VALIDATED')) return null;
  return preScreen(job, criteria);
}

function outOfScope(job: PendingJob, criteria: string | null): boolean {
  return preRule(job, criteria) !== null;
}

function triageViews(raw: PendingJob[], records: Map<string, TriageRecord>, hash: string | null, criteria: string | null = null): Record<string, TriageView> {
  const out: Record<string, TriageView> = {};
  for (const job of raw) {
    if (!job || typeof job !== 'object' || typeof job.slug !== 'string' || job.slug === '') continue;
    const key = triageKey(job);
    const r = records.get(key);
    const zone = zoneOf(job, evaluateTerritory);
    if (!zone.pass) {
      out[key] = {
        key, decision: 'ecartee', reasons: [zone.reason], notes: r ? [`tri par le modèle : ${r.decision}`] : [], blockStatus: 'zone',
        attempts: Number(r?.attempts ?? 0), at: String(r?.at ?? ''), salary: r?.salary_annual_eur ?? null,
        languages: Array.isArray(r?.languages_required) ? r.languages_required.map(String) : [], stale: false, fit: null,
      };
      continue;
    }
    // Règle que le code applique seul, au tri déjà écrit comme à l'offre pas encore triée.
    const pre = preRule(job, criteria);
    const rule = pre !== null ? { reason: pre } : criteria === null ? null : scopeOverride(job, r, criteria);
    if (rule !== null) {
      out[key] = {
        key, decision: 'ecartee', reasons: [rule.reason], notes: r ? [`tri par le modèle : ${r.decision}${r.reasons?.length ? ` (${r.reasons.map(String).join(' ; ')})` : ''}`] : [], blockStatus: 'regle',
        attempts: Number(r?.attempts ?? 0), at: String(r?.at ?? ''), salary: r?.salary_annual_eur ?? null,
        languages: Array.isArray(r?.languages_required) ? r.languages_required.map(String) : [], stale: false, fit: null,
      };
      continue;
    }
    if (!r) continue;
    out[key] = {
      key,
      decision: r.decision,
      reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [],
      notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
      blockStatus: r.block_status,
      attempts: Number(r.attempts ?? 1),
      at: String(r.at ?? ''),
      salary: r.salary_annual_eur ?? null,
      languages: Array.isArray(r.languages_required) ? r.languages_required.map(String) : [],
      stale: hash !== null && needsTriage(job, r, hash, args.triageEngine),
      fit: coreFit(r.notes),
    };
  }
  return out;
}

function liveTriage(rows: RunRow[]): { id: string; key: string; status: string } | null {
  const live = rows.filter((r) => r.workflow_name === 'career-triage' && isLive(r.status));
  live.sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  const r = live[0];
  if (!r) return null;
  const key = r.metadata?.inputs_values?.key ?? r.metadata?.inputs?.key;
  return { id: r.id, key: typeof key === 'string' ? key : '', status: r.status };
}

/** Un tri à la fois : la prochaine offre qui attend son tri part quand aucun run career-triage n'est vivant. */
async function triageTick(): Promise<void> {
  // La sélection du jour attend Claude sur sa liste courte : le tri par règles lui laisse la place.
  if (triaging || selectionJudging) return;
  const hash = readCriteriaHash();
  if (hash === null) return;
  triaging = true;
  try {
    const board = readBoard();
    const runs = await listRuns();
    if (liveTriage(runs.rows) !== null) return;
    const records = readTriageRecords(careerDir);
    const criteria = readCriteriaText();
    // Hors zone ou métier exclu : déjà écartée par une règle, aucun tri par le modèle à payer.
    const candidates = board.raw.filter((j) => j && typeof j === 'object' && (triageLaunches.get(triageKey(j)) ?? 0) < MAX_TRIAGE_ATTEMPTS && zoneOf(j, evaluateTerritory).pass && !outOfScope(j, criteria));
    const next = pickUntriaged(candidates, records, hash, '', args.triageEngine);
    if (next === null) return;
    const key = triageKey(next);
    triageLaunches.set(key, (triageLaunches.get(key) ?? 0) + 1);
    const r = await archon(triageRunArgs({ harness, careerDir, key, engine: args.triageEngine }), 120_000);
    const runId = parseDetachedRunId(r.stdout);
    if (runId === null) {
      note(`tri de ${next.slug} refusé : ${(r.stderr || r.stdout).trim().slice(0, 600)}`);
      return;
    }
    runsCache.at = 0;
    console.log(`⚖ tri de ${next.slug} : run ${runId}`);
  } catch (err) {
    note(`tri : ${(err as Error).message}`);
  } finally {
    triaging = false;
  }
}

/**
 * Le tri par Claude d'une offre, sur le bouton « Trier avec Claude » de sa fiche (2026-11-03) : le seul
 * chemin du cockpit qui appelle un modèle pour trier (2 à 3 appels Sonnet). La ligne la plus récente de
 * ce slug ; refusé quand un tri tourne déjà.
 */
async function launchLlmTriage(slug: string): Promise<{ id?: string; key?: string; error?: string }> {
  if (triaging) return { error: 'un tri démarre déjà, réessaie dans quelques secondes' };
  triaging = true;
  try {
    const runs = await listRuns();
    const live = liveTriage(runs.rows);
    if (live !== null) return { error: 'un tri est déjà en cours (un à la fois)', id: live.id };
    const rows = readBoard().raw.filter((j) => j && typeof j === 'object' && j.slug === slug);
    if (rows.length === 0) return { error: 'offre absente du tableau' };
    const time = (j: PendingJob): number => { const t = Date.parse(String(j.date_published ?? '')); return Number.isNaN(t) ? 0 : t; };
    const job = [...rows].sort((a, b) => time(b) - time(a))[0]!;
    const key = triageKey(job);
    const r = await archon(triageRunArgs({ harness, careerDir, key, engine: 'llm' }), 120_000);
    const runId = parseDetachedRunId(r.stdout);
    if (runId === null) return { error: `tri Claude de ${slug} refusé : ${(r.stderr || r.stdout).trim().slice(0, 600)}` };
    runsCache.at = 0;
    console.log(`⚖ tri Claude de ${slug} (${key}) : run ${runId}`);
    return { id: runId, key };
  } catch (err) {
    return { error: `tri Claude : ${(err as Error).message}` };
  } finally {
    triaging = false;
  }
}

// ── La sélection du jour (selection.ts) ─────────────────────────────────────────────────
// Sans <career>/selection.json : rien (aucun appel de modèle). Avec : à l'heure dite, la liste courte
// du jour, Claude (career-triage moteur llm) sur ses offres une à une, puis les meilleures dans
// selection/<date>.json. Les oui et non d'Antoine arrivent dans inbox/ (écrits par Claude depuis le
// projet) : un oui met l'offre en file career-apply, comme le bouton « Postuler ».
const selectionConfigPath = join(careerDir, SELECTION_CONFIG);
const selectionDir = join(careerDir, SELECTION_DIR);
const inboxDir = join(careerDir, INBOX_DIR);
let selectionJudging = false;
let selectionBusy = false;
let selectionError: string | null = null;

function readSelectionConfigFile(): SelectionConfig | null {
  if (!existsSync(selectionConfigPath)) return null;
  try {
    const cfg = readSelectionConfig(JSON.parse(readFileSync(selectionConfigPath, 'utf8').replace(/^﻿/, '')) as unknown);
    selectionError = null;
    return cfg;
  } catch (err) {
    selectionError = (err as Error).message;
    return null;
  }
}

const dayPath = (date: string): string => join(selectionDir, `${date}.json`);
function readDayFile(date: string): SelectionDay | null {
  try {
    return readDay(JSON.parse(readFileSync(dayPath(date), 'utf8').replace(/^﻿/, '')) as unknown);
  } catch {
    return null;
  }
}
function writeDayFile(day: SelectionDay): void {
  mkdirSync(selectionDir, { recursive: true });
  const path = dayPath(day.date);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(day, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
function pastDays(): SelectionDay[] {
  if (!existsSync(selectionDir)) return [];
  return readdirSync(selectionDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => readDayFile(f.slice(0, 10))).filter((d): d is SelectionDay => d !== null);
}

/** Une étape à la fois : créer la journée, lancer le prochain tri de Claude, ou clore avec les meilleures. */
async function selectionTick(): Promise<void> {
  if (selectionBusy) return;
  const cfg = readSelectionConfigFile();
  const now = new Date();
  if (cfg === null || !cfg.enabled || !selectionDue(cfg, now)) {
    selectionJudging = false;
    return;
  }
  const hash = readCriteriaHash();
  if (hash === null) return;
  selectionBusy = true;
  try {
    const date = localDay(now);
    const board = readBoard();
    const records = readTriageRecords(careerDir);
    let day = readDayFile(date);
    if (day === null) {
      const criteria = readCriteriaText();
      const shortlist = buildShortlist(board.raw, records, hash, proposedKeys(pastDays()), cfg, now, (j) => zoneOf(j, evaluateTerritory).pass && !outOfScope(j, criteria));
      day = newDay(date, now, cfg, shortlist);
      writeDayFile(day);
      console.log(`★ sélection du ${date} : liste courte de ${shortlist.length} offre(s)`);
    }
    if (day.status !== 'tri') {
      selectionJudging = false;
      return;
    }
    selectionJudging = true;
    const runs = await listRuns();
    if (liveTriage(runs.rows) !== null || triaging) return;
    if (dayComplete(day, board.raw, records, hash, now)) {
      day.picks = rankedPicks(day, board.raw, records, hash).slice(0, day.per_day);
      day.status = day.picks.length > 0 ? 'prete' : 'vide';
      day.finished_at = now.toISOString();
      if (day.picks.length === 0) day.notes.push('aucune offre de la liste courte retenue par Claude');
      writeDayFile(day);
      selectionJudging = false;
      console.log(`★ sélection du ${date} : ${day.picks.length} offre(s) prête(s) pour ton oui`);
      return;
    }
    const key = nextToJudge(day, records, hash);
    if (key === null) return; // le dernier tri lancé n'a pas encore écrit son verdict
    triaging = true;
    try {
      const r = await archon(triageRunArgs({ harness, careerDir, key, engine: 'llm' }), 120_000);
      const runId = parseDetachedRunId(r.stdout);
      day.launched.push({ key, at: new Date().toISOString() });
      if (runId === null) day.notes.push(`tri Claude de ${key} refusé : ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
      writeDayFile(day);
      runsCache.at = 0;
      if (runId !== null) console.log(`★ sélection : tri Claude de ${key} (run ${runId})`);
    } finally {
      triaging = false;
    }
  } catch (err) {
    note(`sélection du jour : ${(err as Error).message}`);
  } finally {
    selectionBusy = false;
  }
}

/** Les offres à qui Antoine a dit oui (toutes journées) : leurs décideurs se cherchent dès le CV prêt. */
function selectionGoSlugs(): Set<string> {
  return new Set(pastDays().flatMap((d) => Object.entries(d.answers).filter(([, a]) => a.decision === 'go').map(([key]) => d.picks.find((p) => p.key === key)?.slug ?? '')).filter((s) => s !== ''));
}

/**
 * Les demandes d'ajout au tableau (a_ajouter/*.json, écrites par Claude à la demande d'Antoine ; 2026-11-13 :
 * « rajoute-moi les offres de Canonical ») : chaque poste d'entreprise full remote nommé va au tableau comme
 * avec « Mettre au tableau » ; le fichier part dans a_ajouter/lus/ (ou refuses/ s'il est illisible).
 */
const addsDir = join(careerDir, 'a_ajouter');
function addsTick(): void {
  if (!existsSync(addsDir)) return;
  for (const f of readdirSync(addsDir).filter((n) => n.endsWith('.json'))) {
    const path = join(addsDir, f);
    let done = 'lus';
    try {
      const adds = readInboxAdds(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown);
      if (adds === null) throw new Error('« ajouter » manque');
      for (const x of adds.items) {
        const r = addRemoteJob(x.entreprise, x.poste);
        console.log(`★ ajout demandé (${adds.by}) ${x.entreprise} ${x.poste} : ${r.note}`);
        if (!r.ok) note(`a_ajouter/${f} : ${x.entreprise} ${x.poste} : ${r.note}`);
      }
    } catch (err) {
      done = 'refuses';
      note(`a_ajouter/${f} : ${(err as Error).message}`);
    }
    try {
      mkdirSync(join(addsDir, done), { recursive: true });
      renameSync(path, join(addsDir, done, f));
    } catch (err) {
      note(`a_ajouter/${f} : ${(err as Error).message}`);
    }
  }
}

/** Les réponses d'Antoine (inbox/*.json) : notées dans la journée, un oui mis en file career-apply ; le fichier part dans inbox/lus/. */
function inboxTick(): void {
  try {
    addsTick();
  } catch (err) {
    note(`a_ajouter : ${(err as Error).message}`);
  }
  if (!existsSync(inboxDir)) return;
  const cfg = readSelectionConfigFile();
  for (const f of readdirSync(inboxDir).filter((n) => n.endsWith('.json'))) {
    const path = join(inboxDir, f);
    let done = 'lus';
    try {
      const a = readInboxAnswer(JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as unknown);
      const day = readDayFile(a.date);
      const pick = day?.picks.find((p) => p.key === a.key) ?? null;
      if (day === null || pick === null) throw new Error(`${a.key} n'est pas dans la sélection du ${a.date}`);
      let queued = false;
      let why = '';
      if (a.decision === 'go') {
        const offer = sortOffers(readBoard().offers).find((o) => o.slug === pick.slug);
        const ok = offer ? canLaunch(offer) : { ok: false, reason: 'absente du tableau' };
        if (!ok.ok) why = ok.reason;
        else if (queue.includes(pick.slug)) why = 'déjà en file';
        else {
          orders[pick.slug] = { at: new Date().toISOString(), consigne: '', mode: cfg?.mode ?? 'verified-only', verifiedPlatforms: cfg?.verifiedPlatforms ?? '', from: 'selection' };
          queue.push(pick.slug);
          queued = true;
          void tick();
        }
      }
      day.answers[a.key] = { decision: a.decision, at: a.at || new Date().toISOString(), by: a.by, queued, note: a.decision === 'non' ? 'non : rien ne part' : queued ? 'en file career-apply' : `pas lancée : ${why}` };
      writeDayFile(day);
      console.log(`★ réponse ${a.decision} pour ${pick.slug} : ${day.answers[a.key]!.note}`);
    } catch (err) {
      done = 'refuses';
      note(`inbox/${f} : ${(err as Error).message}`);
    }
    try {
      mkdirSync(join(inboxDir, done), { recursive: true });
      renameSync(path, join(inboxDir, done, f));
    } catch (err) {
      note(`inbox/${f} : ${(err as Error).message}`);
    }
  }
}

/** Ce que la page et Claude voient de la sélection : réglages, journée du jour, et les 60 derniers jours (onglet « Sélectionnées »). */
function selectionState(): Record<string, unknown> {
  const cfg = readSelectionConfigFile();
  const history = pastDays().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
    .map((d) => ({ date: d.date, status: d.status, picks: d.picks, answers: d.answers, notes: d.notes }));
  return { enabled: cfg?.enabled ?? false, config: cfg, error: selectionError, today: readDayFile(localDay(new Date())), history };
}

// ── Entreprises full remote (onglet du cockpit) ─────────────────────────────────────────
// Le radar écrit remote_companies.json et remote_company_jobs.json (rapatriés de la VM) ; le cockpit
// les lit à la demande de la page et met au tableau, sous son verrou, le poste qu'Antoine choisit.
function readJsonFile(path: string): unknown {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown) : null;
  } catch {
    return null;
  }
}
function remoteCompaniesState(): RemoteView {
  return remoteView(readJsonFile(join(careerDir, REMOTE_COMPANIES_FILE)), readJsonFile(join(careerDir, REMOTE_JOBS_FILE)), readBoard().raw, (where) => evaluateTerritory({ location: where, description: '' }).pass);
}
/** Met au tableau le poste `id` de l'entreprise `key` ; rend le slug de sa ligne (déjà là ou ajoutée). */
function addRemoteJob(key: string, id: string): { ok: boolean; slug?: string; note: string } {
  const view = remoteCompaniesState();
  const company = view.companies.find((c) => c.key === key);
  const job = company?.jobs.find((j) => j.id === id);
  if (!company || !job) return { ok: false, note: 'poste introuvable : la liste a changé, rafraîchis' };
  if (job.onBoard !== null) return { ok: true, slug: job.onBoard, note: 'déjà au tableau' };
  const row = remoteJobToPending(company, job);
  return withBoardLock(boardPath, 'cockpit', () => {
    const raw = existsSync(boardPath) ? (JSON.parse(readFileSync(boardPath, 'utf8').replace(/^\uFEFF/, '')) as unknown) : [];
    if (!Array.isArray(raw)) throw new Error('pending_gold_jobs.json n\'est pas une liste');
    const r = appendNew(raw as PendingJob[], [row], 'cockpit', new Date());
    if (r.jobs === null) return { ok: true, slug: row.slug, note: 'déjà au tableau' };
    writeBoard(boardPath, r.jobs, `${JSON.stringify(r.jobs, null, 2)}\n`);
    console.log(`★ mis au tableau : ${row.company} · ${row.title} (entreprise full remote)`);
    return { ok: true, slug: row.slug, note: 'mise au tableau : le tri la lit, tu peux postuler depuis sa fiche' };
  });
}

/**
 * « Arrêter la candidature » (Antoine, 2026-11-11 : un run lancé sans bouton pour l'arrêter a brûlé ses
 * crédits) : retire l'offre de la file, arrête son run career-apply et sa recherche de décideurs
 * (`archon workflow cancel`, sinon `abandon`), et rend à sa ligne le statut d'avant le run. Rien n'est envoyé.
 */
async function stopApplication(slug: string): Promise<{ ok: boolean; stopped: string[]; note: string }> {
  const i = queue.indexOf(slug);
  if (i >= 0) queue.splice(i, 1);
  const ids = new Set<string>();
  const launched = readLaunches()[slug];
  if (typeof launched === 'string' && RUN_ID.test(launched)) ids.add(launched);
  const contact = readJsonRecord<ContactsLaunch>(contactsPath)[slug];
  if (contact && RUN_ID.test(String(contact.id))) ids.add(String(contact.id));
  for (const j of readBoard().raw as Record<string, unknown>[]) {
    if (j?.slug !== slug) continue;
    for (const holder of [j.harness, j.applying]) {
      const run = holder !== null && typeof holder === 'object' ? (holder as Record<string, unknown>).run : null;
      if (typeof run === 'string' && RUN_ID.test(run)) ids.add(run);
    }
  }
  runsCache.at = 0;
  const live = new Set((await listRuns()).rows.filter((r) => ['running', 'paused', 'waiting', 'pending', 'queued'].includes(String(r.status))).map((r) => r.id));
  const stopped: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    if (!live.has(id)) continue;
    let r = await archon([...stopArgs(id, 'cancel'), '--cwd', harness], 60_000);
    if (r.code !== 0) r = await archon([...stopArgs(id, 'abandon'), '--cwd', harness], 60_000);
    (r.code === 0 ? stopped : failed).push(id.slice(0, 8));
    if (r.code !== 0) note(`arrêt du run ${id.slice(0, 8)} (${slug}) refusé : ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  }
  // La ligne restée APPLYING (le run arrêté n'écrira pas son issue) reprend le statut d'avant le run.
  withBoardLock(boardPath, 'cockpit', () => {
    const raw = existsSync(boardPath) ? (JSON.parse(readFileSync(boardPath, 'utf8').replace(/^\uFEFF/, '')) as unknown) : [];
    if (!Array.isArray(raw)) return;
    let changed = false;
    for (const j of raw as Record<string, unknown>[]) {
      if (j?.slug !== slug || j.status !== 'APPLYING') continue;
      const h = j.harness !== null && typeof j.harness === 'object' ? (j.harness as Record<string, unknown>) : {};
      j.status = typeof h.from === 'string' && h.from !== '' && h.from !== 'APPLYING' ? h.from : 'PENDING_VALIDATION';
      j.harness = { ...h, stage: 'arrêtée', at: new Date().toISOString(), summary: 'Candidature arrêtée par Antoine depuis le cockpit : rien n\'a été envoyé.' };
      changed = true;
    }
    if (changed) writeBoard(boardPath, raw, `${JSON.stringify(raw, null, 2)}\n`);
  });
  runsCache.at = 0;
  console.log(`■ ${slug} : candidature arrêtée${stopped.length ? ` (run ${stopped.join(', ')})` : ''}`);
  const msg = failed.length ? `arrêt refusé pour ${failed.join(', ')} : voir les erreurs du cockpit` : stopped.length ? `arrêtée (run ${stopped.join(', ')}) ; rien n'a été envoyé` : 'plus aucun run en cours ; la ligne est remise à son statut d\'avant';
  return { ok: failed.length === 0, stopped, note: msg };
}

// ── Relève des sources (career-radar) ───────────────────────────────────────────────────
// Le système career-radar (scripts seulement, aucun modèle, `mutates_checkout: false` : pas de verrou,
// indépendant des candidatures et des tris) lit les sources d'offres et fusionne les nouvelles dans le
// tableau, puis écrit <career>/last_radar_report.json. Une relève à la fois par dossier carrière : le
// cockpit ne lance rien tant qu'un run career-radar de ce dossier est vivant. Le serveur décide seul du
// rythme (60 s après le démarrage, puis toutes les --radar-every minutes) ; la page ne fait que demander.
const radarReportPath = join(careerDir, 'last_radar_report.json');
const radarAuto = args.radar && candidate.radarAuto && args.radarEvery > 0;
let radarBusy = false;

function liveRadar(rows: RunRow[]): RunRow | null {
  const live = rows.filter((r) => r.workflow_name === 'career-radar' && isLive(r.status));
  live.sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  return live[0] ?? null;
}

function readRadarReportFile(): { report: RadarReport | null; error: string | null } {
  if (!existsSync(radarReportPath)) return { report: null, error: null };
  try {
    const report = readRadarReport(JSON.parse(readFileSync(radarReportPath, 'utf8').replace(/^\uFEFF/, '')) as unknown);
    return report === null ? { report: null, error: 'last_radar_report.json : pas un rapport de relève' } : { report, error: null };
  } catch (err) {
    return { report: null, error: `last_radar_report.json illisible : ${(err as Error).message}` };
  }
}

/** Lance une relève si aucune n'est vivante ; `why` dit qui demande (le bouton ou l'horloge), pour le journal. */
async function radarTick(why: 'bouton' | 'auto'): Promise<Record<string, unknown>> {
  if (!args.radar) return { error: 'relève arrêtée (--no-radar)' };
  // Le radar unifié de la VM tourne (son état rapatrié a moins d'une heure) : pas de relève automatique en double depuis le PC ; le bouton reste.
  let vmStatus: unknown = null;
  try {
    vmStatus = JSON.parse(readFileSync(join(careerDir, 'vm_radar_status.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    vmStatus = null;
  }
  const vm = vmRadarAlive(vmStatus, new Date());
  if (why === 'auto' && vm.alive) return { skipped: true, reason: vm.reason };
  if (radarBusy) return { error: 'relève en cours' };
  radarBusy = true;
  try {
    const runs = await listRuns();
    const live = liveRadar(runs.rows);
    if (live !== null) return { error: 'relève en cours', id: live.id };
    const r = await archon(radarRunArgs({ harness, careerDir }), 120_000);
    const runId = parseDetachedRunId(r.stdout);
    if (runId === null) {
      const reason = `relève des sources refusée : ${(r.stderr || r.stdout).trim().slice(0, 600)}`;
      note(reason);
      return { error: reason };
    }
    noteLaunch(RADAR_KEY, runId);
    runsCache.at = 0;
    console.log(`⌖ relève des sources (${why}) : run ${runId}`);
    return { ok: true, id: runId };
  } catch (err) {
    const reason = `relève des sources : ${(err as Error).message}`;
    note(reason);
    return { error: reason };
  } finally {
    radarBusy = false;
  }
}

let runsCache: { at: number; rows: RunRow[]; error: string | null } = { at: 0, rows: [], error: null };
let runsLoaded = false;
let runsInFlight: Promise<{ rows: RunRow[]; error: string | null }> | null = null;

/** Un seul `archon workflow runs` à la fois : les appels simultanés attendent le même. */
function refreshRuns(): Promise<{ rows: RunRow[]; error: string | null }> {
  runsInFlight ??= (async () => {
    const r = await archon(['workflow', 'runs', '--json', '--verbose', '--limit', '60', '--cwd', harness]);
    const all = parseRuns(r.stdout);
    const rows = runsOfCareer(all, careerDir, { ...readLaunches(), ...Object.fromEntries(Object.entries(readInterviews()).map(([slug, l]) => [`entretien:${slug}`, l.id])) });
    const error = r.code !== 0 && all.length === 0 ? `archon workflow runs : ${(r.stderr || r.stdout).trim().slice(0, 400)}` : null;
    runsCache = { at: Date.now(), rows, error };
    runsLoaded = true;
    return runsCache;
  })().finally(() => {
    runsInFlight = null;
  });
  return runsInFlight;
}

/**
 * Les runs d'Archon (cache 3 s). `stale` : la page n'attend pas Archon (plusieurs secondes sous Windows) ;
 * elle reçoit la dernière liste connue et la suivante est demandée en fond. Les décisions (file, go)
 * appellent sans `stale` et attendent une liste fraîche.
 */
async function listRuns(opts: { stale?: boolean } = {}): Promise<{ rows: RunRow[]; error: string | null }> {
  if (Date.now() - runsCache.at < 3000) return runsCache;
  if (opts.stale) {
    void refreshRuns();
    return runsLoaded ? runsCache : { rows: [], error: null };
  }
  return refreshRuns();
}

const queue: string[] = [];
/** Les ordres « Postuler » reçus depuis le démarrage : quand, et avec quelle consigne (montrés sur la fiche). */
const orders: Record<string, { at: string; consigne: string; mode?: SelectionConfig['mode'] | 'cv-only'; verifiedPlatforms?: string; from?: 'selection' | 'telegram' }> = {};
let launching = false;

interface RunView {
  id: string;
  status: string;
  statusLabel: string;
  startedAt: string | null;
  progress: ReturnType<typeof progress>;
  steps: { id: string; label: string; state: string; stateLabel: string; kind: string }[];
  waitingLabel: string | null;
  /** Les étapes en cours, en français (« CV sur mesure : rédaction ») : ce que la liste et la fiche montrent pendant le run. */
  runningLabel: string | null;
  artifactsDir: string | null;
}

function runView(run: RunRow): RunView {
  const p = progress(run);
  return {
    id: run.id,
    status: run.status,
    statusLabel: runStatusLabel(run.status),
    startedAt: run.started_at ?? null,
    progress: p,
    steps: (run.nodes ?? []).map((n) => ({ id: n.nodeId, label: nodeLabel(n.nodeId, run.workflow_name), state: n.state, stateLabel: stepStateLabel(n.state), kind: stepStateKind(n.state) })),
    waitingLabel: p.waiting ? nodeLabel(p.waiting, run.workflow_name) : null,
    runningLabel: p.running.length ? [...new Set(p.running.map((n) => nodeLabel(n, run.workflow_name)))].join(', ') : null,
    artifactsDir: artifactsDirOf(run, join),
  };
}

async function state(): Promise<Record<string, unknown>> {
  const board = readBoard();
  const runs = await listRuns({ stale: true });
  const latest = latestRunBySlug(runs.rows, applyLaunches());
  const views: Record<string, RunView> = {};
  for (const [slug, run] of latest) views[slug] = runView(run);
  const live = [...latest.entries()].filter(([, r]) => isLive(r.status)).map(([slug, r]) => ({ slug, id: r.id, status: r.status }));
  const criteria = readCriteriaText();
  const hash = criteria === null ? null : criteriaHash(criteria);
  const records = readTriageRecords(careerDir);
  const triage = triageViews(board.raw, records, hash, criteria);
  const triageLive = liveTriage(runs.rows);
  const waiting = hash === null ? 0 : board.raw.filter((j) => j && typeof j === 'object' && typeof j.slug === 'string' && needsTriage(j, records.get(triageKey(j)), hash, args.triageEngine) && zoneOf(j, evaluateTerritory).pass && !outOfScope(j, criteria)).length;
  const radarLive = liveRadar(runs.rows);
  const radarStep = radarLive === null ? null : (progress(radarLive).running[0] ?? progress(radarLive).waiting ?? null);
  const radarReport = readRadarReportFile();
  const alerts = readAlerts();
  const attention = runsLoaded ? currentAttention(board.offers, runs.rows).map((i) => ({ ...i, seen: own(alerts.seen, i.key) !== null })) : [];
  return {
    offers: sortOffers(board.offers).map((o) => ({ ...o, launch: canLaunch(o), triage: own(triage, triageKey(o)) })),
    runs: views,
    interviews: interviewViews(runs.rows),
    contacts: { runs: contactsViews(runs.rows), auto: args.contacts },
    attention,
    live,
    triage: {
      enabled: hash !== null,
      reason: !args.triage ? 'tri arrêté (--no-triage)' : hash === null ? `pas de criteres.json dans ${careerDir}` : '',
      live: triageLive ? { ...triageLive, slug: board.raw.find((j) => j && typeof j === 'object' && triageKey(j) === triageLive.key)?.slug ?? '' } : null,
      waiting,
    },
    queue: [...queue],
    orders,
    selection: selectionState(),
    pull: { ...pull },
    radar: {
      enabled: args.radar,
      auto: radarAuto,
      every: radarAuto ? args.radarEvery : 0,
      reason: !args.radar ? 'relève arrêtée (--no-radar)' : !candidate.radarAuto ? 'relève automatique coupée (radar_auto: false dans candidat.json) : sur le bouton seulement' : args.radarEvery === 0 ? 'relève sur le bouton seulement (--radar-every 0)' : '',
      live: radarLive === null ? null : { id: radarLive.id, status: radarLive.status, statusLabel: runStatusLabel(radarLive.status), startedAt: radarLive.started_at ?? null, step: radarStep, stepLabel: radarStep === null ? 'démarrage' : nodeLabel(radarStep, 'career-radar'), progress: progress(radarLive) },
      report: radarReport.report,
      reportError: radarReport.error,
    },
    runsLoading: !runsLoaded,
    errors: [board.error, runs.error].filter((e) => e !== null).concat(errors.map((e) => `${e.at} ${e.text}`)),
    candidate: { id: candidate.id, name: candidate.name },
    config: { harness, careerDir, browserProfile, mode: args.mode, verifiedPlatforms: args.verifiedPlatforms, archon: args.archon.join(' ') },
  };
}

/** Une candidature en vol à la fois (règle de prise du tableau) : la file avance quand aucun run career-apply n'est vivant. */
async function tick(): Promise<void> {
  if (launching || queue.length === 0) return;
  launching = true;
  try {
    const runs = await listRuns();
    const latest = latestRunBySlug(runs.rows, applyLaunches());
    const live = [...latest.values()].some((r) => isLive(r.status));
    if (live) return;
    const slug = queue.shift()!;
    // Un oui donné à la sélection du jour part avec le mode d'envoi de selection.json ; le bouton, avec celui du cockpit.
    const order = own(orders, slug);
    const r = await archon(runArgs({ harness, slug, careerDir, mode: order?.mode ?? args.mode, verifiedPlatforms: order?.verifiedPlatforms ?? args.verifiedPlatforms }), 120_000);
    const runId = parseDetachedRunId(r.stdout);
    if (runId === null) {
      note(`lancement de ${slug} refusé : ${(r.stderr || r.stdout).trim().slice(0, 600)}`);
      return;
    }
    noteLaunch(slug, runId);
    if (order?.from === 'telegram') botLaunched(slug, runId);
    runsCache.at = 0;
    void refreshRuns(); // la page voit le nouveau run à son prochain rafraîchissement, pas au suivant
    console.log(`▶ ${slug} : run ${runId}`);
  } catch (err) {
    note(`lancement : ${(err as Error).message}`);
  } finally {
    launching = false;
  }
}
setInterval(() => void tick(), 5000);
setInterval(() => void triageTick(), 5000);
setInterval(() => void contactsTick(), 5000);
// Cadences de la sélection et de la boîte de réception ; COCKPIT_SELECTION_TICK_MS les raccourcit pour les tests.
const selectionEvery = Number(process.env.COCKPIT_SELECTION_TICK_MS ?? '') || 30_000;
setInterval(() => void selectionTick(), selectionEvery);
setInterval(() => inboxTick(), Math.min(selectionEvery, 10_000));
setInterval(() => void toastTick(), 10_000);
if (pullEnabled && args.pullEvery > 0) {
  void pullFromVm();
  setInterval(() => void pullFromVm(), args.pullEvery * 60_000);
}
if (radarAuto) {
  // Première relève 60 s après le démarrage (ou plus tôt si la cadence est plus courte), puis à la cadence.
  const everyMs = args.radarEvery * 60_000;
  setTimeout(() => {
    void radarTick('auto');
    setInterval(() => void radarTick('auto'), everyMs);
  }, Math.min(RADAR_FIRST_DELAY_MS, everyMs));
}

// ── Fichiers ────────────────────────────────────────────────────────────────────────────
interface FileView {
  path: string;
  bytes: number;
  text: string | null;
}

function fileView(root: string, rel: string): FileView | null {
  const full = join(root, rel);
  if (!existsSync(full)) return null;
  const st = statSync(full);
  if (!st.isFile()) return null;
  const text = isTextFile(rel) && st.size <= MAX_TEXT ? readFileSync(full, 'utf8') : null;
  return { path: rel.replace(/\\/g, '/'), bytes: st.size, text };
}

function listDir(root: string, rel = ''): string[] {
  const dir = join(root, rel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const r = rel === '' ? name : `${rel}/${name}`;
    const st = statSync(join(dir, name));
    if (st.isDirectory()) out.push(...listDir(root, r));
    else out.push(r);
  }
  return out;
}

const SLUG = /^[\w.-]{1,80}$/;
const RUN_ID = /^[\w-]{1,80}$/;

async function runFiles(runId: string): Promise<Record<string, unknown>> {
  const r = await archon(['workflow', 'get', runId, '--json', '--cwd', harness]);
  const run = firstJsonObject(r.stdout);
  if (run === null) return { error: `archon workflow get ${runId} : ${(r.stderr || r.stdout).trim().slice(0, 400)}`, files: [] };
  const dir = artifactsDirOf({ id: runId, output_root: typeof run.output_root === 'string' ? run.output_root : null }, join);
  if (dir === null || !existsSync(dir)) return { error: 'le run n’a pas (encore) de dossier d’artefacts', dir, files: [] };
  const files = listDir(dir)
    .filter((f) => /^(application|submission)\//.test(f) || /^(record|offer)\.json$/.test(f))
    .map((f) => fileView(dir, f))
    .filter((f): f is FileView => f !== null);
  return { dir, status: run.status, files };
}

function applicationFiles(slug: string): Record<string, unknown> {
  const dir = join(careerDir, 'applications', slug);
  const files = listDir(dir).map((f) => fileView(dir, f)).filter((f): f is FileView => f !== null);
  return { dir, files };
}

async function logs(runId: string): Promise<Record<string, unknown>> {
  const r = await archon(['workflow', 'logs', runId, '--format', 'text', '--cwd', harness]);
  const lines = (r.stdout || r.stderr).split('\n');
  return { lines: lines.slice(-150) };
}

// ── Annonce et remarques ────────────────────────────────────────────────────────────────
interface Posting {
  slug: string;
  link: string;
  title: string;
  text: string;
  fetchedAt: string;
  error: string | null;
  /** La garde d'annonce (systems/.shared/posting-guard.ts), celle que `load` applique : expirée, suspecte ou ok. */
  guard: PostingGuard | null;
}

const postings = new Map<string, Posting>();

/** La page de l'annonce, lue comme `load` la lit (même en-tête, même délai, même `visibleText`), gardée 10 min. */
async function posting(slug: string, reload: boolean): Promise<Posting> {
  const cached = postings.get(slug);
  if (cached && !reload && Date.now() - Date.parse(cached.fetchedAt) < 600_000) return cached;
  const offer = readBoard().offers.find((o) => o.slug === slug);
  const link = offer?.link ?? '';
  const out: Posting = { slug, link, title: '', text: '', fetchedAt: new Date().toISOString(), error: null, guard: null };
  if (!offer) out.error = 'offre absente du tableau';
  else if (!/^https?:\/\//i.test(link)) out.error = `l'offre n'a pas de lien http(s) : « ${link} »`;
  else {
    try {
      const response = await fetch(postingUrl(link), { headers: POSTING_HEADERS, signal: AbortSignal.timeout(15000), redirect: 'follow' });
      const html = await response.text();
      if (!response.ok) out.error = `la page répond ${response.status}`;
      out.title = visibleText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '', 200);
      out.text = postingText(html, 20_000);
      out.guard = guardPosting({ url: link, status: response.status, finalUrl: response.url, title: out.title, text: out.text });
      if (out.text === '' && out.error === null) out.error = 'la page ne contient aucun texte lisible (annonce rendue par script, ou connexion exigée) : ouvre le lien';
    } catch (err) {
      out.error = `lecture impossible : ${(err as Error).message}`;
    }
  }
  postings.set(slug, out);
  return out;
}

const remarksPath = (slug: string): string => join(careerDir, 'applications', slug, 'remarques_utilisateur.txt');

/** Les remarques déjà laissées sur l'offre, par le bot (`/remarque`) ou d'ici : même fichier. */
function remarks(slug: string): Record<string, unknown> {
  const path = remarksPath(slug);
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return { path, remarks: parseRemarks(content) };
}

function addRemark(slug: string, text: string): Record<string, unknown> {
  const entry = remarkEntry(text, new Date());
  mkdirSync(join(careerDir, 'applications', slug), { recursive: true });
  appendFileSync(remarksPath(slug), entry, 'utf8');
  return { ok: true, ...remarks(slug) };
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = (await req.json()) as unknown;
    return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const h = req.headers;
    const remote = remoteConfig();
    const access = checkAccess(h, remote);
    if (!access.ok) return json({ error: access.reason }, access.status);
    const refused = refusal({ method: req.method, host: h.get('host'), origin: h.get('origin'), referer: h.get('referer'), contentType: h.get('content-type') }, allowedHosts(server.port, [...args.allowHosts, ...remote.hosts]));
    if (refused !== null) return json({ error: `refusé : ${refused}` }, 403);
    try {
      if (req.method === 'GET' && p === '/') return new Response(readFileSync(pagePath, 'utf8'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (req.method === 'GET' && p === '/favicon.ico') return new Response(readFileSync(iconPath), { headers: { 'content-type': 'image/x-icon', 'cache-control': 'no-cache' } });
      if (req.method === 'GET' && p === '/api/state') return json(await state());
      if (req.method === 'GET' && p === '/api/remote-companies') return json(remoteCompaniesState());
      // L'onglet Signaux (entreprises à signal : levée, nouveau CMO, vague de recrutement…), tes avis, la file « À prospecter ».
      if (req.method === 'GET' && p === '/api/signals') return json(signalsView(careerDir));
      if (req.method === 'POST' && p === '/api/signals/verdict') {
        const b = await body(req);
        const v = b.verdict === 'bon' || b.verdict === 'non' ? b.verdict : null;
        const r = setVerdict(careerDir, String(b.norm ?? ''), v);
        return json(r, r.ok ? 200 : 400);
      }
      if (req.method === 'POST' && p === '/api/signals/prospect') {
        const b = await body(req);
        const r = queueProspect(careerDir, String(b.norm ?? ''));
        return json(r, r.ok ? 200 : 409);
      }
      if (req.method === 'POST' && p === '/api/remote-companies/add') {
        const b = await body(req);
        const key = String(b.key ?? '');
        const id = String(b.id ?? '');
        if (key === '' || key.length > 200 || id === '' || id.length > 200) return json({ error: 'poste invalide' }, 400);
        const r = addRemoteJob(key, id);
        return json(r, r.ok ? 200 : 409);
      }
      if (req.method === 'GET' && p.startsWith('/api/application/')) {
        const slug = decodeURIComponent(basename(p));
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        return json(applicationFiles(slug));
      }
      if (req.method === 'GET' && /^\/api\/offer\/[^/]+\/posting$/.test(p)) {
        const slug = decodeURIComponent(p.split('/')[3]!);
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        return json(await posting(slug, url.searchParams.get('reload') === '1'));
      }
      // Le CV ou la lettre en PDF, tel qu'il sera joint (pickPdf) : s'ouvre aussi dans le navigateur du téléphone.
      const pdf = req.method === 'GET' ? /^\/api\/pdf\/([^/]+)\/(cv|lettre)$/.exec(p) : null;
      if (pdf) {
        const slug = decodeURIComponent(pdf[1]!);
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        const run = latestRunBySlug((await listRuns({ stale: true })).rows, applyLaunches()).get(slug);
        const runDir = run ? artifactsDirOf(run, join) : null;
        const runNames = runDir === null ? [] : ['application/CV.pdf', 'application/letter.pdf'].filter((f) => existsSync(join(runDir, f)));
        const appDir = join(careerDir, 'applications', slug);
        const appNames = existsSync(appDir) ? readdirSync(appDir) : [];
        const pick = pickPdf(pdf[2] as 'cv' | 'lettre', runNames, appNames);
        if (pick === null) return json({ error: `pas encore de ${pdf[2] === 'cv' ? 'CV' : 'lettre'} en PDF pour cette offre` }, 404);
        const full = pick.from === 'run' ? join(runDir!, pick.path) : join(appDir, pick.path);
        return new Response(Bun.file(full), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${basename(full).replace(/"/g, '')}"`, 'cache-control': 'no-store' } });
      }
      if (req.method === 'GET' && p.startsWith('/api/contacts/')) {
        const slug = decodeURIComponent(basename(p));
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        const dir = join(careerDir, 'applications', slug);
        const read = (name: string): { value: unknown; error: string | null } => {
          const path = join(dir, name);
          if (!existsSync(path)) return { value: null, error: null };
          try {
            return { value: JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as unknown, error: null };
          } catch (err) {
            return { value: null, error: `${name} illisible : ${(err as Error).message}` };
          }
        };
        const found = read('decideurs.json');
        const verdict = read('decideurs.verdict.json');
        const view = contactsView(found.value);
        return json({ view, verdict: verdict.value, error: found.error ?? (found.value !== null && view === null ? 'decideurs.json : pas un fichier de décideurs' : null) });
      }
      if (req.method === 'POST' && p === '/api/contacts') {
        const slug = String((await body(req)).slug ?? '');
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        const r = await launchContacts(slug, false);
        return json(r, r.error ? 409 : 200);
      }
      if (req.method === 'POST' && p === '/api/attention/seen') {
        const key = String((await body(req)).key ?? '');
        if (key === '' || key.length > 300) return json({ error: 'alerte invalide' }, 400);
        const alerts = readAlerts();
        alerts.seen[key] = new Date().toISOString();
        writeJsonRecord(alertsPath, alerts);
        return json({ ok: true });
      }
      if (req.method === 'GET' && p.startsWith('/api/remarks/')) {
        const slug = decodeURIComponent(basename(p));
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        return json(remarks(slug));
      }
      if (req.method === 'POST' && p === '/api/remarks') {
        const b = await body(req);
        const slug = String(b.slug ?? '');
        const text = typeof b.text === 'string' ? b.text : '';
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        if (text.trim() === '') return json({ error: 'remarque vide' }, 400);
        return json(addRemark(slug, text));
      }
      if (req.method === 'GET' && /^\/api\/run\/[^/]+\/files$/.test(p)) {
        const id = decodeURIComponent(p.split('/')[3]!);
        if (!RUN_ID.test(id)) return json({ error: 'run invalide' }, 400);
        return json(await runFiles(id));
      }
      if (req.method === 'GET' && /^\/api\/run\/[^/]+\/logs$/.test(p)) {
        const id = decodeURIComponent(p.split('/')[3]!);
        if (!RUN_ID.test(id)) return json({ error: 'run invalide' }, 400);
        return json(await logs(id));
      }
      if (req.method === 'POST' && p === '/api/run') {
        const b = await body(req);
        const slugs = Array.isArray(b.slugs) ? b.slugs.filter((s): s is string => typeof s === 'string' && SLUG.test(s)) : [];
        const consigne = typeof b.consigne === 'string' ? b.consigne.trim().slice(0, 4000) : '';
        // Même ligne que la page : la plus récente du slug (sortOffers), pas la première du fichier.
        const offers = sortOffers(readBoard().offers);
        const added: string[] = [];
        const refused: { slug: string; reason: string }[] = [];
        for (const slug of slugs) {
          const offer = offers.find((o) => o.slug === slug);
          if (!offer) {
            refused.push({ slug, reason: 'absente du tableau' });
            continue;
          }
          const ok = canLaunch(offer);
          if (!ok.ok) refused.push({ slug, reason: ok.reason });
          else if (queue.includes(slug)) refused.push({ slug, reason: 'déjà en file' });
          else {
            // La consigne (« postule, insiste sur X ») part dans le fichier de remarques que `load` lit au début du run.
            if (consigne !== '' && slugs.length === 1) addRemark(slug, `Consigne de candidature : ${consigne}`);
            orders[slug] = { at: new Date().toISOString(), consigne: slugs.length === 1 ? consigne : '' };
            queue.push(slug);
            added.push(slug);
          }
        }
        void tick();
        return json({ added, refused, queue: [...queue], orders: Object.fromEntries(added.map((s) => [s, orders[s]])) });
      }
      // La fenêtre du cockpit est en mode application : un lien y resterait coincé, sans barre d'adresse.
      // La page demande donc au cockpit d'ouvrir l'annonce dans Chrome (sinon le navigateur par défaut du PC ; jamais à distance).
      if (req.method === 'POST' && p === '/api/open') {
        if (!isLocalHost(h.get('host'), server.port)) return json({ error: 'ouverture réservée au PC' }, 403);
        const target = openableUrl((await body(req)).url);
        if (target === null) return json({ error: 'adresse invalide' }, 400);
        Bun.spawn(openerArgs(process.platform, target, process.platform === 'win32' ? chromePath(process.env, existsSync) : null, chromeProfile()), { stdout: 'ignore', stderr: 'ignore' });
        return json({ ok: true });
      }
      // Le navigateur du robot : Antoine y crée ou ouvre ses comptes candidats ; jamais pendant qu'un run s'en sert.
      if (req.method === 'POST' && p === '/api/open-robot') {
        if (!isLocalHost(h.get('host'), server.port)) return json({ error: 'ouverture réservée au PC' }, 403);
        const target = openableUrl((await body(req)).url);
        if (target === null) return json({ error: 'adresse invalide' }, 400);
        const chrome = process.platform === 'win32' ? chromePath(process.env, existsSync) : null;
        if (chrome === null) return json({ error: 'Chrome introuvable sur ce PC' }, 409);
        const runs = await listRuns();
        if (runs.rows.some((r) => r.status === 'running')) return json({ error: 'un run se sert du navigateur du robot : attends qu’il ait fini' }, 409);
        Bun.spawn(robotBrowserArgs(chrome, browserProfile, target), { stdout: 'ignore', stderr: 'ignore' });
        return json({ ok: true });
      }
      if (req.method === 'POST' && p === '/api/pull') return json(await pullFromVm());
      if (req.method === 'POST' && p === '/api/triage-llm') {
        const slug = String((await body(req)).slug ?? '');
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        const r = await launchLlmTriage(slug);
        return json(r, r.error ? 409 : 200);
      }
      if (req.method === 'POST' && p === '/api/radar') {
        const r = await radarTick('bouton');
        return json(r, r.error ? 409 : 200);
      }
      if (req.method === 'POST' && p === '/api/interview') {
        const b = await body(req);
        const slug = String(b.slug ?? '');
        const stage = String(b.stage ?? 'rh');
        if (!SLUG.test(slug)) return json({ error: 'slug invalide' }, 400);
        if (!(INTERVIEW_STAGES as readonly string[]).includes(stage)) return json({ error: `étape inconnue : ${stage} (${INTERVIEW_STAGES.join(', ')})` }, 400);
        const r = await launchInterview(slug, stage as InterviewStage);
        return json(r, r.error ? 409 : 200);
      }
      if (req.method === 'POST' && p === '/api/stop') {
        const b = await body(req);
        const slug = String(b.slug ?? '');
        if (!/^[a-z0-9_]{1,40}$/.test(slug)) return json({ error: 'offre invalide' }, 400);
        const r = await stopApplication(slug);
        return json(r, r.ok ? 200 : 409);
      }
      if (req.method === 'POST' && p === '/api/dequeue') {
        const b = await body(req);
        const i = queue.indexOf(String(b.slug));
        if (i >= 0) queue.splice(i, 1);
        return json({ queue: [...queue] });
      }
      if (req.method === 'POST' && p === '/api/respond') {
        const b = await body(req);
        const runId = String(b.runId ?? '');
        const decision = b.decision === 'approve' ? 'approve' : b.decision === 'reject' ? 'reject' : null;
        if (!RUN_ID.test(runId) || decision === null) return json({ error: 'runId ou decision invalide' }, 400);
        const r = await archon([...respondArgs(runId, decision, typeof b.text === 'string' ? b.text : ''), '--cwd', harness], 120_000);
        runsCache.at = 0;
        return json({ ok: r.code === 0, output: (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim().slice(0, 2000) });
      }
      return json({ error: 'introuvable' }, 404);
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
});

const url = `http://127.0.0.1:${server.port}/`;
void refreshRuns(); // la première liste se charge pendant que la page s'ouvre
// Qui tourne : pid et heure de départ, pour que cockpit-launch.ps1 redémarre le cockpit quand son code a changé depuis.
try {
  const stampPath = join(harness, '.local', 'cockpit', `running-${server.port}.json`);
  mkdirSync(join(stampPath, '..'), { recursive: true });
  writeFileSync(stampPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), harness, careerDir, chromeProfile: chromeProfile() }, null, 2), 'utf8');
} catch {
  /* sans ce fichier, l'icône redémarre le cockpit à chaque clic */
}
console.log(`Cockpit : ${url}\n  candidat : ${candidate.name || '(principal)'}\n  harness  : ${harness}\n  carrière : ${careerDir}\n  navigateur : ${browserProfile}\n  mode     : ${args.mode}  (archon : ${args.archon.join(' ')})\n  tri      : ${!args.triage ? 'arrêté (--no-triage)' : args.triageEngine === 'rules' ? 'règles du code, sans modèle (--triage-engine llm pour le bloc job-triage)' : 'bloc job-triage (appels de modèle)'} ; décideurs auto : ${args.contacts ? 'oui (appels de modèle)' : 'non (--contacts pour les allumer)'}\n  VM       : ${!pullEnabled ? 'non (tableau propre à ce candidat)' : args.pullEvery > 0 ? `tableau rafraîchi toutes les ${args.pullEvery} min` : 'rafraîchi sur le bouton seulement'} (${pull.command})\n  sources  : ${!args.radar ? 'relève arrêtée (--no-radar)' : radarAuto ? `relève career-radar toutes les ${args.radarEvery} min (première dans 60 s) et sur le bouton` : 'relève career-radar sur le bouton seulement'}`);
if (args.open) {
  const opener = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
  try {
    Bun.spawn(opener, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    /* le navigateur s'ouvre à la main */
  }
}

// ── Le bot Telegram du radar (bot à part, jamais celui de production) ────────────────────
// Actif seulement quand RADAR_BOT_TOKEN est dans les secrets de CE candidat (lu par son nom).
// La VM envoie les alertes ; ici : /start réserve le bot, « CV sur mesure » → career-apply
// mode cv-only (crédits Claude : l'appui est la demande), puis le PDF repart dans Telegram.
const readBotToken = (): string => readEnvKey(existingEnvFiles(envCandidates({ careerDir })), TOKEN_NAME);
let botToken = readBotToken();
const botStatePath = join(harness, '.local', 'cockpit', `radar-bot-${server.port}.json`);
let botState: BotState = parseBotState(null);
try {
  if (existsSync(botStatePath)) botState = parseBotState(JSON.parse(readFileSync(botStatePath, 'utf8')));
} catch {
  /* état illisible : on repart de zéro (Telegram rejoue les 24 dernières heures) */
}
const saveBot = (): void => {
  try {
    mkdirSync(dirname(botStatePath), { recursive: true });
    writeJsonAtomic(botStatePath, botState);
  } catch (err) {
    note(`bot radar : état non sauvé (${(err as Error).message})`);
  }
};
function botLaunched(slug: string, runId: string): void {
  const p = botState.pending[slug];
  if (p) {
    p.run = runId;
    saveBot();
  }
}
/** radar_bot.json (poussé vers la VM) : le compte réservé et l'adresse du cockpit au téléphone. */
function writeLink(chatId: number | null): void {
  const path = join(careerDir, LINK_FILE);
  let current: Record<string, unknown> = {};
  try {
    if (existsSync(path)) current = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    current = {};
  }
  const url = cockpitUrlFrom(remoteConfig().hosts);
  const next = { ...current, chat_id: chatId ?? parseBotLink(current).chat_id, cockpit_url: url, claimed_at: chatId !== null && parseBotLink(current).chat_id !== chatId ? new Date().toISOString() : (current.claimed_at ?? '') };
  if (JSON.stringify(next) !== JSON.stringify(current)) writeJsonAtomic(path, next);
}
async function botCall(c: Call): Promise<void> {
  try {
    if (c.file !== undefined) {
      const form = new FormData();
      for (const [k, v] of Object.entries(c.payload)) form.append(k, String(v));
      form.append('document', Bun.file(c.file), basename(c.file));
      await tg(botToken, c.method, form, fetch, 120_000);
    } else await tg(botToken, c.method, c.payload);
  } catch (err) {
    note(`bot radar : ${(err as Error).message}`);
  }
}
function botCanQueue(slug: string): { ok: boolean; reason: string; title: string } {
  const offer = sortOffers(readBoard().offers).find((o) => o.slug === slug);
  if (!offer) return { ok: false, reason: "l'offre n'est pas (encore) dans le tableau du PC", title: slug };
  const title = `${offer.title || 'Offre'} — ${offer.company || slug}`;
  if (queue.includes(slug)) return { ok: false, reason: 'déjà en file dans le cockpit', title };
  const ok = canLaunch(offer);
  return ok.ok ? { ok: true, reason: '', title } : { ok: false, reason: ok.reason, title };
}
async function botSettle(): Promise<void> {
  if (Object.keys(botState.pending).length === 0) return;
  const runs = (await listRuns()).rows;
  const calls = settlePending(botState, {
    queued: (slug) => queue.includes(slug),
    runStatus: (id) => runs.find((r) => r.id === id)?.status ?? null,
    cvPdf: (_slug, id) => {
      const row = runs.find((r) => r.id === id);
      const dir = row ? artifactsDirOf(row, join) : null;
      const pdf = dir === null ? null : join(dir, 'application', 'CV.pdf');
      return pdf !== null && existsSync(pdf) ? pdf : null;
    },
    summary: (slug) => {
      const o = sortOffers(readBoard().offers).find((x) => x.slug === slug);
      return o?.harness?.summary ? o.harness.summary.slice(0, 600) : '';
    },
    isLive,
    cockpitUrl: cockpitUrlFrom(remoteConfig().hosts),
    now: new Date(),
  });
  if (calls.length === 0) return;
  saveBot();
  for (const c of calls) await botCall(c);
}
async function botLoop(): Promise<void> {
  let wait = 0;
  for (;;) {
    if (wait > 0) await Bun.sleep(wait);
    try {
      const updates = await tg<unknown[]>(botToken, 'getUpdates', { offset: botState.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, fetch, 40_000);
      wait = 0;
      if (updates.length === 0) continue;
      const calls: Call[] = [];
      for (const u of updates) {
        const r = handleUpdate(u, botState, {
          chatId: readBotLink(careerDir).chat_id,
          canQueue: botCanQueue,
          queue: (slug) => {
            orders[slug] = { at: new Date().toISOString(), consigne: '', mode: 'cv-only', from: 'telegram' };
            queue.push(slug);
          },
          now: new Date(),
        });
        if (r.claim !== undefined) {
          writeLink(r.claim);
          console.log('bot radar : réservé au premier /start');
        }
        calls.push(...r.calls);
      }
      saveBot();
      void tick();
      for (const c of calls) await botCall(c);
    } catch (err) {
      // 409 : un autre programme lit déjà ce bot (deux cockpits ?) ; 401 : jeton refusé.
      // Jeton refusé : on le relit toutes les minutes (corrigé dans .local\secrets.env, il repart sans relancer le cockpit).
      if (err instanceof TelegramError && err.code === 401) {
        const before = botToken;
        note('bot radar : jeton RADAR_BOT_TOKEN refusé par Telegram (401) ; corrige-le dans .local\\secrets.env, il est relu chaque minute');
        for (;;) {
          await Bun.sleep(60_000);
          botToken = readBotToken();
          if (botToken !== '' && botToken !== before) break;
        }
        console.log('bot radar : nouveau jeton lu, reprise');
        wait = 0;
        continue;
      }
      if (!(err instanceof TelegramError && err.code === 0)) note(`bot radar : ${(err as Error).message}`);
      wait = Math.min(Math.max(wait * 2, 5_000), 300_000);
    }
  }
}
if (botToken !== '') {
  writeLink(null);
  void botLoop();
  setInterval(() => void botSettle(), 15_000);
  console.log('bot radar : à l’écoute (alertes envoyées par la VM)');
}
