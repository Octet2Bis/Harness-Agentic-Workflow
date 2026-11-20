/**
 * Crible les offres brutes de `collect` (`radar/raw.json`) sans modèle : doublons entre elles
 * (lien, puis entreprise|titre), offres déjà au tableau (lien ou id), offres publiées il y a
 * plus de `offre_age_max_jours` jours (`criteres.json` du dossier carrière, 7 par défaut ; date
 * illisible : gardée), jury des trois inspecteurs de Master Plan (langue, télétravail,
 * séniorité) avec la taxonomie du candidat, score ≥ 75 (`screenJobs`, `.shared/radar.ts`). Écrit `radar/qualified.json` (objets prêts
 * pour le tableau, forme de la VM) et `radar/rejected.json` (une raison par offre). Ne touche
 * ni au tableau ni au dossier carrière.
 *
 * Liaisons : INPUTS_CAREER_DIR, INPUTS_RAW (pointeur d'artefact rendu par collect).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ArtifactPointer, artifactPointer, artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { boardPathIn, readBoard } from '../../.shared/pending.ts';
import { type RadarJob, type Taxonomy, offerAgeMaxDays, runJuryEvaluation, screenJobs } from '../../.shared/radar.ts';

const QUALIFIED_FILE = 'radar/qualified.json';
const REJECTED_FILE = 'radar/rejected.json';

const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const raw = nullableJson(process.env.INPUTS_RAW) as ArtifactPointer | null;

function done(ok: boolean, summary: string, qualified: unknown[], rejected: unknown[]): void {
  const dir = artifactsDir();
  mkdirSync(join(dir, 'radar'), { recursive: true });
  writeFileSync(join(dir, QUALIFIED_FILE), JSON.stringify({ at: new Date().toISOString(), run_id: process.env.WORKFLOW_ID ?? '', ok, summary, qualified }, null, 2), 'utf8');
  writeFileSync(join(dir, REJECTED_FILE), JSON.stringify({ at: new Date().toISOString(), ok, summary, rejected }, null, 2), 'utf8');
  emit({ ok, go: ok && qualified.length > 0, summary, qualified_count: qualified.length, rejected_count: rejected.length, qualified_path: artifactPointer(QUALIFIED_FILE) });
}

try {
  const rawPath = raw === null ? '' : join(artifactsDir(), raw.path);
  const taxonomyPath = join(careerDir, 'career_taxonomy.json');
  if (raw === null || !existsSync(rawPath)) done(false, 'raw offers not found (collect returned no file)', [], []);
  else if (!existsSync(taxonomyPath)) done(false, `career_taxonomy.json not found in ${careerDir}`, [], []);
  else {
    const data = JSON.parse(readFileSync(rawPath, 'utf8')) as { jobs?: RadarJob[] };
    const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8').replace(/^﻿/, '')) as Taxonomy;
    const boardPath = boardPathIn(careerDir);
    const board = existsSync(boardPath) ? readBoard(boardPath) : [];
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    const criteriaPath = join(careerDir, 'criteres.json');
    const age = offerAgeMaxDays(existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : null);
    const { qualified, rejected } = screenJobs(jobs, taxonomy, board, runJuryEvaluation, { maxAgeDays: age.days, now: new Date() });
    const reasons = new Map<string, number>();
    // « offre trop ancienne (publiée le …) » compte comme une seule raison.
    const head = (reason: string): string => reason.split(' : ')[0]!.replace(/^(offre trop ancienne) \(.*$/, '$1');
    for (const r of rejected) reasons.set(head(r.reason), (reasons.get(head(r.reason)) ?? 0) + 1);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([reason, n]) => `${reason} ×${n}`);
    done(true, `${qualified.length} qualified of ${jobs.length} raw offer(s), ${rejected.length} rejected${top.length ? ` (${top.join(', ')})` : ''}${qualified.length ? ` ; top: ${qualified.slice(0, 3).map((q) => `${q.company} — ${q.title} (${String(q.match_score)})`).join(' | ')}` : ''} ; ${age.note}`, qualified, rejected);
  }
} catch (error) {
  done(false, `radar screen failed: ${error instanceof Error ? error.message : String(error)}`, [], []);
}
