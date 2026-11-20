/**
 * Outils des tests des trois scripts (collect, screen, record) : un dossier carrière
 * temporaire, un dossier d'artefacts, un faux module réseau (`CAREER_RADAR_FETCH_MODULE`) qui
 * sert les fixtures de `.shared/radar/test/` et journalise les URL appelées, et le lancement
 * d'un script en sous-processus bun, comme Archon le fait. Aucun réseau.
 */

import { expect } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactPointer } from '../../.shared/io.ts';

export const FIXTURES = join(import.meta.dir, '..', '..', '.shared', 'radar', 'test');

export const TAXONOMY = {
  version: 'test',
  target_experience: { min_years: 1, max_years: 3, disqualified_labels: ['senior', 'head of', 'director', '5+ years'] },
  search_queries: ['growth marketing specialist', 'marketing manager', 'crm specialist', 'partner manager'],
  startup_scaleup_signals: ['saas', 'startup'],
};

export interface Bench {
  root: string;
  career: string;
  artifacts: string;
  fake: string;
  calls: string;
}

const benches: Bench[] = [];

/** Un banc : <root>/career, <root>/artifacts, le faux module réseau et son journal d'appels. */
export function bench(options: { taxonomy?: boolean; sources?: unknown; board?: unknown } = {}): Bench {
  const root = mkdtempSync(join(tmpdir(), 'career-radar-'));
  const career = join(root, 'career');
  const artifacts = join(root, 'artifacts');
  mkdirSync(career);
  mkdirSync(artifacts);
  if (options.taxonomy !== false) writeFileSync(join(career, 'career_taxonomy.json'), JSON.stringify(TAXONOMY));
  if (options.sources !== undefined) writeFileSync(join(career, 'job_sources.json'), JSON.stringify(options.sources));
  if (options.board !== undefined) writeFileSync(join(career, 'pending_gold_jobs.json'), typeof options.board === 'string' ? options.board : JSON.stringify(options.board, null, 2));
  const calls = join(root, 'calls.log');
  const fake = join(root, 'fake-fetch.cjs');
  // Les fixtures réelles sont datées du 2026-10-23 : ramenées à aujourd'hui pour le filtre 48 h.
  writeFileSync(fake, `
const fs = require('node:fs');
const path = require('node:path');
const TODAY = new Date().toISOString().slice(0, 10);
const RFC_TODAY = new Date().toUTCString().slice(0, 16);
const fixture = (name) => fs.readFileSync(path.join(${JSON.stringify(FIXTURES)}, name), 'utf8').replace(/2026-10-2[123]/g, TODAY).replace(/Fri, 23 Oct 2026/g, RFC_TODAY);
const log = (url) => fs.appendFileSync(${JSON.stringify(calls)}, url + '\\n');
async function fetchUrl(url) {
  log(url);
  if (url.includes('growthtalent')) return { status: 200, data: fixture('growthtalent.json') };
  if (url.includes('jobicy')) return { status: 200, data: fixture('jobicy.json') };
  return { status: 503, data: '' };
}
async function request(url) { log(url); return { status: 500, data: '' }; }
module.exports = { fetchUrl, request };
`);
  const b = { root, career, artifacts, fake, calls };
  benches.push(b);
  return b;
}

export function cleanBenches(): void {
  for (const b of benches.splice(0)) rmSync(b.root, { recursive: true, force: true });
}

/** Lance un script du système comme Archon : liaisons en INPUTS_*, ARTIFACTS_DIR, WORKFLOW_ID ; rend sa sortie JSON. */
export function runScript(script: string, b: Bench, env: Record<string, string>): { out: Record<string, unknown>; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['bun', join(import.meta.dir, script)], {
    env: { ...process.env, CAREER_LINKEDIN: '', INPUTS_CAREER_DIR: b.career, INPUTS_SOURCES: '', INPUTS_ENV_FILE: '', ARTIFACTS_DIR: b.artifacts, WORKFLOW_ID: 'R9', INPUTS_FETCH_MODULE: b.fake, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  expect(stderr).toBe('');
  expect(proc.exitCode).toBe(0);
  return { out: JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>, stdout, stderr };
}

export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const callsOf = (b: Bench): string[] => {
  try {
    return readFileSync(b.calls, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};
/** Un pointeur d'artefact tel que le rend un nœud amont (même run que les scripts lancés : R9). */
export const pointer = (path: string): string => {
  process.env.WORKFLOW_ID = 'R9';
  return JSON.stringify(artifactPointer(path));
};
