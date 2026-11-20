#!/usr/bin/env bun
/**
 * Rapatrie sur le PC ce que le radar unifié de la VM a produit (`pull_radar_vm.ps1` l'appelle
 * après le scp, depuis la fusion habituelle `sync_pending.ps1 pull`) :
 *   - le tableau unifié entre dans celui du PC offre par offre (`mergeBoards`, sous le verrou du
 *     tableau, comme `merge_pending.ts pull`) : le PC garde ses statuts ;
 *   - un tri de la VM (`triage/<clé>.json`) remplace celui du PC quand il est fait sous les critères
 *     actuels du PC et vaut mieux (moteur local plutôt que règles), ou quand le PC n'en a pas ou en
 *     a un sous d'anciens critères ; un tri de Claude (`verified`, `rejected`, `unconverged`) sous les
 *     critères actuels n'est jamais remplacé ;
 *   - l'annonce lue par la VM (`postings/<clé>.txt`) et les questions du modèle
 *     (`triage_local/<clé>.json`) sont copiées quand elles manquent ou ont changé ;
 *   - l'état du dernier cycle (`vm_radar_status.json`) est copié ;
 *   - les entreprises full remote (`remote_companies.json`) et leurs annonces à part
 *     (`remote_company_jobs.json`) : la VM fait foi, sauf une entreprise que le PC a lue après le
 *     cycle de la VM (relève lancée depuis le cockpit), qui reste celle du PC ;
 *   - les signaux d'entreprises (`company_signals.json`, `signals_status.json`) : la VM fait foi.
 *
 *   bun merge_radar_vm.ts <dossier carrière du PC> <dossier extrait de la VM>
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeBoards, readBoard, withBoardLock, writeBoard } from '../../.archon/workflows/systems/.shared/pending.ts';
import { type BlockStatus, type TriageRecord, criteriaHash, criteriaPathIn } from '../../.archon/workflows/systems/.shared/triage.ts';

/** Le rang d'un tri : Claude vérifié > modèle local > règles et pré-tri du code > le reste. */
const RANK: Partial<Record<BlockStatus, number>> = { verified: 4, local: 3, rules: 2, pre_screened: 2, unreadable: 1, rejected: 1, unconverged: 1, none: 0 };
const rank = (r: Pick<TriageRecord, 'block_status'>): number => RANK[r.block_status] ?? 0;
/** Les tris qui ont coûté un appel à Claude (bloc job-triage). */
const CLAUDE_STATUSES: readonly BlockStatus[] = ['verified', 'rejected', 'unconverged'];

/** Le tri de la VM remplace-t-il celui du PC ? */
export function vmTriageWins(pc: TriageRecord | null, vm: TriageRecord, currentHash: string): boolean {
  if (vm.criteria_hash !== currentHash) return pc === null;
  if (pc === null) return true;
  // Un tri payé à Claude (vérifié, refusé par son juge, non convergé) sous les critères actuels reste : le remplacer ferait retrier par Claude.
  if (CLAUDE_STATUSES.includes(pc.block_status) && pc.criteria_hash === currentHash) return false;
  if (pc.criteria_hash !== currentHash) return true;
  if (rank(vm) !== rank(pc)) return rank(vm) > rank(pc);
  return Date.parse(vm.at) > Date.parse(pc.at);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
  } catch {
    return null;
  }
}

function sameFile(a: string, b: string): boolean {
  if (!existsSync(b)) return false;
  return readFileSync(a).equals(readFileSync(b));
}

export interface MergeReport {
  board: { before: number; after: number };
  triage: { copied: number; kept: number };
  postings: number;
  questions: number;
  /** Les signaux d'entreprises ont été rapatriés. */
  signals?: boolean;
  status: boolean;
  remoteCompanies: number | null;
  notes: string[];
}

interface RemoteFile {
  _meta?: { at?: string; [k: string]: unknown };
  companies?: Record<string, { last_read?: string; read_at?: string; [k: string]: unknown }>;
}

/** Les fichiers des entreprises full remote : ceux de la VM, plus les entreprises que le PC a lues après le cycle de la VM. */
export function mergeRemoteFile(pc: RemoteFile | null, vm: RemoteFile): RemoteFile {
  const vmAt = Date.parse(vm._meta?.at ?? '');
  const companies = { ...(vm.companies ?? {}) };
  for (const [key, entry] of Object.entries(pc?.companies ?? {})) {
    const at = Date.parse(entry.last_read ?? entry.read_at ?? '');
    const vmEntry = companies[key];
    const vmEntryAt = vmEntry ? Date.parse(vmEntry.last_read ?? vmEntry.read_at ?? '') : Number.NaN;
    if (!Number.isNaN(at) && (Number.isNaN(vmAt) || at > vmAt) && (Number.isNaN(vmEntryAt) || at > vmEntryAt)) companies[key] = entry;
  }
  return { _meta: vm._meta, companies };
}

export function mergeRadarVm(pcCareer: string, vmDir: string): MergeReport {
  const notes: string[] = [];
  const report: MergeReport = { board: { before: 0, after: 0 }, triage: { copied: 0, kept: 0 }, postings: 0, questions: 0, status: false, remoteCompanies: null, notes };

  // Le tableau.
  const vmBoard = join(vmDir, 'pending_gold_jobs.json');
  if (existsSync(vmBoard)) {
    const vm = readBoard(vmBoard);
    const pcBoard = join(pcCareer, 'pending_gold_jobs.json');
    withBoardLock(pcBoard, 'merge_radar_vm', () => {
      const pc = existsSync(pcBoard) ? readBoard(pcBoard) : [];
      const merged = mergeBoards(pc, vm);
      report.board = { before: pc.length, after: merged.jobs.length };
      if (merged.jobs.length !== pc.length || JSON.stringify(merged.jobs) !== JSON.stringify(pc)) writeBoard(pcBoard, merged.jobs, `${JSON.stringify(merged.jobs, null, 2)}\n`);
    });
  } else notes.push('pas de tableau dans le paquet de la VM');

  // Les tris.
  const criteriaPath = criteriaPathIn(pcCareer);
  const currentHash = existsSync(criteriaPath) ? criteriaHash(readFileSync(criteriaPath, 'utf8')) : '';
  const vmTriage = join(vmDir, 'triage');
  if (existsSync(vmTriage)) {
    mkdirSync(join(pcCareer, 'triage'), { recursive: true });
    for (const f of readdirSync(vmTriage).filter((n) => n.endsWith('.json'))) {
      const vm = readJson<TriageRecord>(join(vmTriage, f));
      if (vm === null) continue;
      const pcPath = join(pcCareer, 'triage', f);
      const pc = existsSync(pcPath) ? readJson<TriageRecord>(pcPath) : null;
      if (vmTriageWins(pc, vm, currentHash)) {
        copyFileSync(join(vmTriage, f), pcPath);
        report.triage.copied++;
      } else report.triage.kept++;
    }
  }

  // Les annonces et les questions du modèle.
  for (const [dir, field] of [['postings', 'postings'], ['triage_local', 'questions']] as const) {
    const from = join(vmDir, dir);
    if (!existsSync(from)) continue;
    mkdirSync(join(pcCareer, dir), { recursive: true });
    for (const f of readdirSync(from)) {
      if (sameFile(join(from, f), join(pcCareer, dir, f))) continue;
      copyFileSync(join(from, f), join(pcCareer, dir, f));
      report[field]++;
    }
  }

  // Les entreprises full remote et leurs annonces.
  for (const f of ['remote_companies.json', 'remote_company_jobs.json']) {
    const vm = readJson<RemoteFile>(join(vmDir, f));
    if (vm === null || typeof vm.companies !== 'object' || vm.companies === null) continue;
    const merged = mergeRemoteFile(readJson<RemoteFile>(join(pcCareer, f)), vm);
    const out = join(pcCareer, f);
    writeFileSync(`${out}.tmp`, `${JSON.stringify(merged, null, 1)}\n`, 'utf8');
    renameSync(`${out}.tmp`, out);
    if (f === 'remote_companies.json') report.remoteCompanies = Object.keys(merged.companies ?? {}).length;
  }

  // Les signaux d'entreprises (integrations/company-signals) : la VM fait foi ; tes avis restent sur le PC (signals_feedback.json).
  for (const f of ['company_signals.json', 'signals_status.json']) {
    const from = join(vmDir, f);
    if (readJson<unknown>(from) === null || sameFile(from, join(pcCareer, f))) continue;
    copyFileSync(from, `${join(pcCareer, f)}.tmp`);
    renameSync(`${join(pcCareer, f)}.tmp`, join(pcCareer, f));
    report.signals = true;
  }

  const status = join(vmDir, 'vm_radar_status.json');
  if (existsSync(status)) {
    copyFileSync(status, join(pcCareer, 'vm_radar_status.json'));
    report.status = true;
  }
  return report;
}

if (import.meta.main) {
  const [pcCareer, vmDir] = process.argv.slice(2);
  if (!pcCareer || !vmDir) {
    process.stderr.write('usage: bun merge_radar_vm.ts <dossier carrière du PC> <dossier extrait de la VM>\n');
    process.exitCode = 2;
  } else {
    try {
      const r = mergeRadarVm(pcCareer, vmDir);
      process.stdout.write(`radar VM : tableau ${r.board.before} → ${r.board.after} offre(s) ; ${r.triage.copied} tri(s) repris de la VM (${r.triage.kept} gardé(s) du PC) ; ${r.postings} annonce(s), ${r.questions} journal(aux) de questions ; état ${r.status ? 'rapatrié' : 'absent'}${r.remoteCompanies !== null ? ` ; ${r.remoteCompanies} entreprise(s) full remote` : ''}${r.signals ? ' ; signaux d’entreprises rapatriés' : ''}${r.notes.length ? ` ; ${r.notes.join(' ; ')}` : ''}\n`);
    } catch (err) {
      process.stderr.write(`merge_radar_vm: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  }
}
