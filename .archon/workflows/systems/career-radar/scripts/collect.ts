/**
 * Interroge les sources d'offres du candidat et écrit les offres brutes dans les artefacts du
 * run (`radar/raw.json` : `{ fetched_at, run_id, jobs, sources }`). Les sources viennent de
 * `<career_dir>/job_sources.json`, sinon du fichier par défaut du système
 * (`job_sources.default.json`, la 2.1.0 de Master Plan : le résumé le dit) ; l'entrée
 * `sources` (noms séparés par des virgules) n'en garde que celles-là. `career_taxonomy.json`
 * du dossier carrière est obligatoire (requêtes cibles, séniorité : sans elle tout passerait).
 * Les liens déjà au tableau (`knownLinks`) évitent à LinkedIn de relire des annonces connues.
 *
 * Les clés d'API sont lues par NOM (`resolveKeys`) : `process.env`, puis la chaîne de
 * `.shared/radar-env.ts` (`env_file`, sinon `<dépôt>/.local/secrets.env`, puis
 * `<career_dir>/../../.secrets/.env`). Aucune valeur de clé, aucun chemin de fichier d'env ne
 * sort d'ici. La cadence par source (`min_interval_min`) vit dans `<career_dir>/source_state.json`.
 * `offre_age_max_jours` de `<career_dir>/criteres.json` (7 par défaut, `offerAgeMaxDays`) va aux
 * filtres de fraîcheur côté source qui en ont un (Adzuna `max_days_old`, Apify `postedWithinDays`,
 * Jobdatalake `{since_ms}`), qu'il ne fait que resserrer ; le crible (`screen`) applique la règle.
 *
 * Liaisons : INPUTS_CAREER_DIR, INPUTS_SOURCES, INPUTS_ENV_FILE, INPUTS_FETCH_MODULE (tests
 * seulement : chemin d'un module qui exporte `fetchUrl` et `request`, fausses réponses, aucun
 * réseau ; vide en production).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { artifactPointer, artifactsDir, emit, text } from '../../.shared/io.ts';
import { boardPathIn, readBoard } from '../../.shared/pending.ts';
import { describeEnvChain, envCandidates, existingEnvFiles } from '../../.shared/radar-env.ts';
import { type RadarJob, type SourceReport, type SourcesConfig, type Taxonomy, boardKeys, offerAgeMaxDays, selectSources, sourceCounts } from '../../.shared/radar.ts';

const require = createRequire(import.meta.url);
const { fetchAllActiveSources } = require('../../.shared/radar/fetchers/index.js') as {
  fetchAllActiveSources: (options: Record<string, unknown>) => Promise<{ jobs: RadarJob[]; sources: SourceReport[] }>;
};

const RAW_FILE = 'radar/raw.json';
const DEFAULT_SOURCES = join(import.meta.dir, '..', 'job_sources.default.json');

const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const wantedSources = text(process.env.INPUTS_SOURCES).trim();
const envFile = text(process.env.INPUTS_ENV_FILE).trim();
const fetchModule = text(process.env.INPUTS_FETCH_MODULE).trim();
const runId = process.env.WORKFLOW_ID ?? '';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
}

/** Écrit raw.json (toujours, même vide : le pointeur rendu doit nommer un fichier qui existe) et rend la sortie. */
function done(ok: boolean, summary: string, jobs: RadarJob[], sources: SourceReport[], extra: Record<string, unknown> = {}): void {
  const dir = artifactsDir();
  mkdirSync(join(dir, 'radar'), { recursive: true });
  writeFileSync(join(dir, RAW_FILE), JSON.stringify({ fetched_at: new Date().toISOString(), run_id: runId, career_dir: careerDir, ok, summary, jobs, sources, ...extra }, null, 2), 'utf8');
  const counts = sourceCounts(sources);
  emit({ ok, go: ok && jobs.length > 0, summary, raw_count: jobs.length, sources_ok: counts.ok, sources_failed: counts.failed, raw_path: artifactPointer(RAW_FILE) });
}

const taxonomyPath = join(careerDir, 'career_taxonomy.json');
const sourcesPath = join(careerDir, 'job_sources.json');
if (careerDir === '') done(false, 'career_dir is required', [], []);
else if (!existsSync(careerDir)) done(false, `career_dir not found: ${careerDir}`, [], []);
else if (!existsSync(taxonomyPath)) done(false, `career_taxonomy.json not found in ${careerDir}: the radar needs the candidate's queries and seniority labels (copy Master Plan's Workspace/career/career_taxonomy.json)`, [], []);
else {
  try {
    const taxonomy = readJson(taxonomyPath) as Taxonomy;
    const ownSources = existsSync(sourcesPath);
    const config = readJson(ownSources ? sourcesPath : DEFAULT_SOURCES) as SourcesConfig;
    const selection = selectSources(config, wantedSources);
    const boardPath = boardPathIn(careerDir);
    const board = existsSync(boardPath) ? readBoard(boardPath) : [];
    const knownLinks = new Set<string>();
    for (const row of board) if (typeof row.link === 'string' && row.link !== '') knownLinks.add(row.link);
    const candidates = envCandidates({ explicit: envFile, careerDir });
    const envPaths = existingEnvFiles(candidates);
    const fake = fetchModule !== '' ? (require(fetchModule) as Record<string, unknown>) : null;
    const criteriaPath = join(careerDir, 'criteres.json');
    const age = offerAgeMaxDays(existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : null);
    const { jobs, sources } = await fetchAllActiveSources({
      careerDir,
      envPath: envPaths,
      sourcesConfig: selection.config,
      taxonomy,
      knownLinks,
      onlyListed: true, // une source absente de job_sources.json ne tourne pas (sur la VM, elle tournerait avec son adresse par défaut)
      maxAgeDays: age.days,
      ...(fake ? { fetchUrl: fake.fetchUrl, request: fake.request, jobgetherPauseMs: 0, jitterMs: 0 } : {}),
    });
    const counts = sourceCounts(sources);
    const notes = [
      `${jobs.length} raw offer(s) from ${sources.length} source(s) (${counts.ok} ok, ${counts.failed} failed, ${counts.waiting} waiting for their interval)`,
      ownSources ? `sources: ${careerDir}/job_sources.json (${String(config.version ?? '?')})` : `sources: the system's job_sources.default.json (${String(config.version ?? '?')}), no job_sources.json in career_dir`,
      wantedSources ? `selected: ${selection.selected.join(', ') || 'none'}${selection.unknown.length ? ` ; unknown: ${selection.unknown.join(', ')}` : ''}` : '',
      `${knownLinks.size} link(s) already on the board`,
      describeEnvChain(envPaths, envFile),
      jobs.length === 0 ? 'nothing to screen' : '',
    ].filter(Boolean);
    done(true, notes.join(' ; '), jobs, sources, { sources_file: ownSources ? sourcesPath : 'job_sources.default.json', selected: selection.selected, unknown_sources: selection.unknown, known_links: knownLinks.size, board_keys: { links: boardKeys(board).links.size } });
  } catch (error) {
    done(false, `radar collect failed: ${error instanceof Error ? error.message : String(error)}`, [], []);
  }
}
