#!/usr/bin/env bun
/**
 * Le radar unifié de la VM (2026-11-08) : un cycle, lancé toutes les 15 minutes par cron
 * (`install-vm.sh`), en service séparé : il ne touche ni au bot Telegram de production, ni à
 * l'ancien radar de Master Plan (`live_job_scraper.js`), ni à leurs fichiers.
 *
 *   0. l'ancien tableau de la VM (`--old-board`, lu seulement) : ses offres nouvelles entrent dans
 *      le tableau unifié (`mergeBoards`, sous le verrou du tableau) ; rien n'y est écrit ; l'index
 *      des entreprises 100 % remote de l'ancien radar (`verified_remote_companies.json`, à côté de
 *      l'ancien tableau) est recopié quand il a changé : le radar y cherche leurs tableaux d'offres ;
 *   1. le radar : les trois scripts de `career-radar` (collect → screen → record), les 18 sources
 *      du candidat plus LinkedIn (`CAREER_LINKEDIN=on` : sur la VM, comme l'ancien radar) ;
 *   2. le tri sans Claude : les scripts de `career-triage` en moteur `local` (load → local →
 *      classify → record), une offre à la fois, au plus `--max-triage` offres et `--budget-min`
 *      minutes par cycle ; l'annonce lue est gardée dans `postings/<clé>.txt` (le texte complet au
 *      moment où l'offre est trouvée : une annonce LinkedIn expire ou se tronque ensuite) et les
 *      questions du modèle dans `triage_local/<clé>.json` ;
 *   3. l'état du cycle dans `vm_radar_status.json` (le cockpit du PC l'affiche après rapatriement).
 *
 * Chaque script tourne comme sous Archon (sous-processus bun, liaisons INPUTS_*, ARTIFACTS_DIR,
 * WORKFLOW_ID), dans `<work>/<run>/radar` et `<work>/<run>/tri-<n>` ; les 30 derniers cycles
 * sont gardés. Aucune clé n'est écrite ni affichée : `--env-file` est passé tel quel à collect.
 *
 *   bun radar-vm.ts --career ~/radar-unifie/career [--env-file ~/radar-unifie/secrets.env]
 *     [--old-board <tableau de l'ancien radar>] [--max-triage 15] [--budget-min 12]
 *     [--ollama http://127.0.0.1:11434] [--model qwen2.5:7b-instruct-q4_0] [--sources a,b]
 *     [--no-linkedin] [--no-triage] [--fetch-module <faux réseau, tests>]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mergeBoards, readBoard, withBoardLock, writeBoard } from '../../.archon/workflows/systems/.shared/pending.ts';

export interface Options {
  harness: string;
  career: string;
  work: string;
  envFile: string;
  oldBoard: string;
  maxTriage: number;
  budgetMin: number;
  ollama: string;
  model: string;
  sources: string;
  linkedin: boolean;
  triage: boolean;
  fetchModule: string;
  keepRuns: number;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const home = env.HOME ?? homedir();
  const o: Options = {
    harness: resolve(import.meta.dir, '..', '..'),
    career: '',
    work: '',
    envFile: '',
    oldBoard: '',
    maxTriage: 15,
    budgetMin: 12,
    ollama: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b-instruct-q4_0',
    sources: '',
    linkedin: true,
    triage: true,
    fetchModule: '',
    keepRuns: 30,
  };
  const path = (v: string) => resolve(v.replace(/^~(?=$|\/)/, home));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} : valeur manquante`);
      return v;
    };
    if (a === '--harness') o.harness = path(next());
    else if (a === '--career') o.career = path(next());
    else if (a === '--work') o.work = path(next());
    else if (a === '--env-file') o.envFile = path(next());
    else if (a === '--old-board') o.oldBoard = path(next());
    else if (a === '--max-triage') o.maxTriage = Number(next());
    else if (a === '--budget-min') o.budgetMin = Number(next());
    else if (a === '--ollama') o.ollama = next();
    else if (a === '--model') o.model = next();
    else if (a === '--sources') o.sources = next();
    else if (a === '--no-linkedin') o.linkedin = false;
    else if (a === '--no-triage') o.triage = false;
    else if (a === '--fetch-module') o.fetchModule = path(next());
    else if (a === '--keep-runs') o.keepRuns = Number(next());
    else throw new Error(`option inconnue : ${a}`);
  }
  if (o.career === '') throw new Error('--career est obligatoire');
  if (o.work === '') o.work = join(dirname(o.career), 'runs');
  if (!Number.isFinite(o.maxTriage) || o.maxTriage < 0) throw new Error('--max-triage : un nombre ≥ 0');
  if (!Number.isFinite(o.budgetMin) || o.budgetMin <= 0) throw new Error('--budget-min : un nombre > 0');
  return o;
}

/** La dernière ligne JSON de la sortie d'un script (ce qu'`emit` écrit), ou null. */
export function lastJson(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      // ligne suivante
    }
  }
  return null;
}

interface Step {
  out: Record<string, unknown> | null;
  code: number;
  stderr: string;
  seconds: number;
}

/** Un script, en sous-processus asynchrone (un appel bloquant figerait aussi ce qui sert les pages et le modèle en test). */
async function runScript(o: Options, script: string, artifacts: string, run: string, inputs: Record<string, string>): Promise<Step> {
  mkdirSync(artifacts, { recursive: true });
  const t0 = Date.now();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('INPUTS_')) env[k] = v;
  Object.assign(env, { ARTIFACTS_DIR: artifacts, WORKFLOW_ID: run, CAREER_LINKEDIN: o.linkedin ? 'on' : '', TRIAGE_LOCAL_URL: o.ollama, TRIAGE_LOCAL_MODEL: o.model });
  for (const [k, v] of Object.entries(inputs)) env[`INPUTS_${k.toUpperCase()}`] = v;
  const proc = Bun.spawn([process.execPath, join(o.harness, '.archon', 'workflows', 'systems', script)], { env, stdout: 'pipe', stderr: 'pipe', cwd: o.harness });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out: lastJson(stdout), code, stderr: stderr.slice(-800), seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

const json = (v: unknown): string => (v === null || v === undefined ? 'null' : JSON.stringify(v));

/** Les offres nouvelles de l'ancien tableau de la VM entrent dans le tableau unifié ; l'ancien n'est jamais écrit. */
export function importOldBoard(career: string, oldBoard: string): { imported: number; note: string } {
  if (oldBoard === '' || !existsSync(oldBoard)) return { imported: 0, note: oldBoard === '' ? 'pas d\'ancien tableau' : 'ancien tableau absent' };
  const old = readBoard(oldBoard);
  const board = join(career, 'pending_gold_jobs.json');
  return withBoardLock(board, 'radar-vm import', () => {
    const current = existsSync(board) ? readBoard(board) : [];
    const { jobs } = mergeBoards(current, old);
    const imported = jobs.length - current.length;
    if (imported > 0 || !existsSync(board)) writeBoard(board, jobs, `${JSON.stringify(jobs, null, 2)}\n`);
    return { imported, note: `${imported} offre(s) de l'ancien radar` };
  });
}

/** L'index des entreprises remote de l'ancien radar (remote_company_indexer.js), recopié quand il a changé ; l'original n'est jamais écrit. */
export function importRemoteIndex(career: string, oldBoard: string): string {
  if (oldBoard === '') return 'pas d\'ancien radar';
  const from = join(dirname(oldBoard), 'verified_remote_companies.json');
  if (!existsSync(from)) return 'index des entreprises remote absent';
  const to = join(career, 'verified_remote_companies.json');
  if (existsSync(to) && readFileSync(from).equals(readFileSync(to))) return 'index des entreprises remote inchangé';
  copyFileSync(from, to);
  return 'index des entreprises remote recopié';
}

export interface CycleReport {
  at: string;
  run_id: string;
  ok: boolean;
  seconds: number;
  old_board: { imported: number; note: string };
  radar: { ok: boolean; summary: string; added: number; raw_count: number; sources_ok: number; sources_failed: number };
  triage: { key: string; decision: string; block_status: string; seconds: number; summary: string }[];
  triage_stop: string;
  errors: string[];
}

export async function runCycle(o: Options, now: () => Date = () => new Date()): Promise<CycleReport> {
  const start = Date.now();
  const at = now().toISOString();
  const run = `vm-${at.replace(/[-:]/g, '').replace(/\..*$/, '')}`;
  const base = join(o.work, run);
  const errors: string[] = [];
  mkdirSync(o.career, { recursive: true });

  // 0. L'ancien radar de la VM.
  let old_board = { imported: 0, note: '' };
  try {
    old_board = importOldBoard(o.career, o.oldBoard);
  } catch (err) {
    old_board = { imported: 0, note: `ancien tableau illisible : ${(err as Error).message.slice(0, 160)}` };
    errors.push(old_board.note);
  }
  try {
    old_board.note += ` ; ${importRemoteIndex(o.career, o.oldBoard)}`;
  } catch (err) {
    old_board.note += ` ; index des entreprises remote illisible : ${(err as Error).message.slice(0, 160)}`;
  }

  // 1. Le radar : collect → screen → record.
  const radarDir = join(base, 'radar');
  const collect = await runScript(o, 'career-radar/scripts/collect.ts', radarDir, run, { career_dir: o.career, sources: o.sources, env_file: o.envFile, fetch_module: o.fetchModule });
  if (collect.out === null) errors.push(`collect : pas de sortie (code ${collect.code}) ${collect.stderr}`);
  let screen: Step | null = null;
  if (collect.out?.go === true) {
    screen = await runScript(o, 'career-radar/scripts/screen.ts', radarDir, run, { career_dir: o.career, raw: json(collect.out.raw_path) });
    if (screen.out === null) errors.push(`screen : pas de sortie (code ${screen.code}) ${screen.stderr}`);
  }
  const record = await runScript(o, 'career-radar/scripts/record.ts', radarDir, run, { career_dir: o.career, collect: json(collect.out), screen: json(screen?.out ?? null) });
  if (record.out === null) errors.push(`record : pas de sortie (code ${record.code}) ${record.stderr}`);
  const radar = {
    ok: record.out?.ok === true,
    summary: String(record.out?.summary ?? collect.out?.summary ?? ''),
    added: Number(record.out?.added ?? 0),
    raw_count: Number(collect.out?.raw_count ?? 0),
    sources_ok: Number(collect.out?.sources_ok ?? 0),
    sources_failed: Number(collect.out?.sources_failed ?? 0),
  };

  // 2. Le tri local, une offre à la fois.
  const triage: CycleReport['triage'] = [];
  let triage_stop = o.triage ? '' : 'tri arrêté (--no-triage)';
  const seen = new Set<string>();
  for (let n = 1; o.triage && triage_stop === ''; n++) {
    if (n > o.maxTriage) {
      triage_stop = `plafond du cycle atteint (${o.maxTriage} offres) : la suite au prochain cycle`;
      break;
    }
    if ((Date.now() - start) / 60_000 > o.budgetMin) {
      triage_stop = `budget du cycle atteint (${o.budgetMin} min) : la suite au prochain cycle`;
      break;
    }
    const dir = join(base, `tri-${n}`);
    // `skip` : une offre au tri non final (annonce illisible…) est retentée au prochain cycle, pas tout de suite.
    const load = await runScript(o, 'career-triage/scripts/load.ts', dir, run, { career_dir: o.career, key: '', engine: 'local', skip: [...seen].join(',') });
    const lo = load.out;
    if (lo === null) {
      errors.push(`tri ${n} load : pas de sortie (code ${load.code}) ${load.stderr}`);
      triage_stop = 'erreur de load';
      break;
    }
    if (lo.go !== true) {
      triage_stop = 'plus rien à trier';
      break;
    }
    const key = String(lo.key ?? '');
    if (seen.has(key)) {
      errors.push(`tri ${n} : ${key} repris deux fois (le tri précédent n'a pas été écrit)`);
      triage_stop = 'boucle évitée';
      break;
    }
    seen.add(key);
    let local: Step | null = null;
    if (lo.readable === true && lo.pre_screened !== true) {
      local = await runScript(o, 'career-triage/scripts/local.ts', dir, run, { load: json(lo) });
      if (local.out === null) errors.push(`tri ${key} local : pas de sortie (code ${local.code}) ${local.stderr}`);
    }
    const classify = await runScript(o, 'career-triage/scripts/classify.ts', dir, run, { verdict: 'null', rules: 'null', local: json(local?.out ?? null), load: json(lo) });
    const rec = await runScript(o, 'career-triage/scripts/record.ts', dir, run, { career_dir: o.career, load: json(lo), classified: json(classify.out) });
    if (rec.out?.written !== true) errors.push(`tri ${key} : non écrit (${String(rec.out?.summary ?? rec.stderr).slice(0, 160)})`);
    // L'annonce complète telle que lue maintenant (le tri par Claude sur le PC la reprend si la page
    // a expiré depuis : storedPostingBody), et les questions du modèle.
    const safe = key.replace(/[^A-Za-z0-9_-]/g, '_');
    try {
      if (lo.posting_full === 'true' && existsSync(join(dir, 'posting.txt'))) {
        mkdirSync(join(o.career, 'postings'), { recursive: true });
        copyFileSync(join(dir, 'posting.txt'), join(o.career, 'postings', `${safe}.txt`));
      }
      if (existsSync(join(dir, 'local.json'))) {
        mkdirSync(join(o.career, 'triage_local'), { recursive: true });
        copyFileSync(join(dir, 'local.json'), join(o.career, 'triage_local', `${safe}.json`));
      }
    } catch (err) {
      errors.push(`tri ${key} : copie de l'annonce impossible (${(err as Error).message.slice(0, 120)})`);
    }
    triage.push({ key, decision: String(classify.out?.decision ?? ''), block_status: String(classify.out?.block_status ?? ''), seconds: Math.round((load.seconds + (local?.seconds ?? 0) + classify.seconds + rec.seconds) * 10) / 10, summary: String(rec.out?.summary ?? '').slice(0, 200) });
    // Modèle injoignable : l'offre a son tri par règles (refait en local au prochain cycle) ; inutile de lire d'autres pages ce cycle-ci.
    if (local?.out?.engine === 'rules') triage_stop = 'modèle local injoignable : tri par les règles, repris en local au prochain cycle';
  }

  const report: CycleReport = { at, run_id: run, ok: errors.length === 0 && radar.ok, seconds: Math.round((Date.now() - start) / 100) / 10, old_board, radar, triage, triage_stop, errors };
  writeFileSync(join(o.career, 'vm_radar_status.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  pruneRuns(o.work, o.keepRuns);
  return report;
}

/** Garde les `keep` derniers cycles dans le dossier de travail. */
export function pruneRuns(work: string, keep: number): void {
  if (!existsSync(work)) return;
  const runs = readdirSync(work).filter((d) => d.startsWith('vm-')).map((d) => ({ d, t: statSync(join(work, d)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const r of runs.slice(Math.max(0, keep))) rmSync(join(work, r.d), { recursive: true, force: true });
}

if (import.meta.main) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const r = await runCycle(o);
    const t = r.triage;
    console.log(`${r.at} radar : ${r.radar.summary} | ancien radar : ${r.old_board.note} | tri local : ${t.length} offre(s) (${t.filter((x) => x.decision === 'retenue').length} retenue(s)) ${r.triage_stop} | ${r.seconds} s${r.errors.length ? ` | ${r.errors.length} erreur(s) : ${r.errors[0]}` : ''}`);
    process.exitCode = r.ok ? 0 : 1;
  } catch (err) {
    console.error(`radar-vm : ${(err as Error).message}`);
    process.exitCode = 2;
  }
}
