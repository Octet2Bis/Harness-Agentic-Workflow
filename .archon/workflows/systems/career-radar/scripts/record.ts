/**
 * Ajoute au tableau `pending_gold_jobs.json` les offres qualifiées qui n'y sont pas encore
 * (lien ou id), sous le verrou du tableau (`withBoardLock`, le même que `claim`, `record`,
 * `close`, `settle` et `merge_pending.ts`) ; les lignes existantes ne sont ni réécrites ni
 * réordonnées (`appendNew`, `.shared/radar.ts`). Un tableau absent est créé ; un tableau
 * illisible ou un verrou qui ne se libère pas rend `ok: false`, rien n'est écrit.
 *
 * Tourne aussi quand rien n'a qualifié ou quand il n'y avait rien à cribler (`all_done`) :
 * écrit alors seulement le rapport. Le rapport `<career_dir>/last_radar_report.json`
 * (`{ at, run_id, ok, sources: [{ name, status, count, duration_ms }], raw_count,
 * qualified_count, added, added_slugs, skipped, rejected_count, summary }`) est ce que le
 * cockpit affiche ; une ligne JSON par run s'ajoute à `<career_dir>/radar_log.jsonl`.
 * Quand `collect` a échoué, `ok: false`, et le rapport n'est écrit que si le dossier carrière
 * existe (il dit l'échec).
 *
 * Liaisons : INPUTS_CAREER_DIR, INPUTS_COLLECT (sortie de collect), INPUTS_SCREEN (sortie de
 * screen, "null" quand il a été sauté).
 */

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PendingJob } from '../../.shared/career.ts';
import { type ArtifactPointer, artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { boardPathIn, readBoard, withBoardLock, writeBoard } from '../../.shared/pending.ts';
import { type SourceReport, appendNew, buildReport } from '../../.shared/radar.ts';

interface Collect {
  ok: boolean;
  go: boolean;
  summary: string;
  raw_count: number;
  sources_ok: number;
  sources_failed: number;
  raw_path: ArtifactPointer;
}
interface Screen {
  ok: boolean;
  go: boolean;
  summary: string;
  qualified_count: number;
  rejected_count: number;
  qualified_path: ArtifactPointer;
}

export const REPORT_FILE = 'last_radar_report.json';
export const LOG_FILE = 'radar_log.jsonl';

const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const collect = nullableJson(process.env.INPUTS_COLLECT) as Collect | null;
const screen = nullableJson(process.env.INPUTS_SCREEN) as Screen | null;
const run = process.env.WORKFLOW_ID ?? '';
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Un fichier des artefacts de ce run, lu par son pointeur ; null s'il manque ou ne se lit pas. */
function artifact<T>(pointer: ArtifactPointer | undefined): T | null {
  try {
    if (!pointer || typeof pointer.path !== 'string') return null;
    const path = join(artifactsDir(), pointer.path);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
  } catch {
    return null;
  }
}

/** Le rapport et la ligne de journal, dans le dossier carrière (tmp → rename) ; rend le chemin du rapport ou ''. */
function writeReport(report: ReturnType<typeof buildReport>): { path: string; error: string } {
  if (careerDir === '' || !existsSync(careerDir)) return { path: '', error: 'career_dir not found' };
  const path = join(careerDir, REPORT_FILE);
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2), 'utf8');
    renameSync(`${path}.tmp`, path);
    appendFileSync(join(careerDir, LOG_FILE), `${JSON.stringify({ ...report, sources: undefined })}\n`, 'utf8');
    return { path, error: '' };
  } catch (err) {
    return { path: '', error: errorText(err) };
  }
}

function finish(ok: boolean, summary: string, added: PendingJob[], skipped: number, sources: SourceReport[], counts: { raw: number; qualified: number; rejected: number }): void {
  const report = buildReport({ run, now: new Date(), ok, sources, raw_count: counts.raw, qualified_count: counts.qualified, rejected_count: counts.rejected, added, skipped, summary });
  const written = writeReport(report);
  const note = written.path === '' ? ` Report not written (${written.error}).` : '';
  emit({ ok, summary: `${summary}${note}`, added: added.length, skipped, report_path: written.path });
}

if (collect === null) {
  finish(false, 'collect returned nothing', [], 0, [], { raw: 0, qualified: 0, rejected: 0 });
} else {
  const raw = artifact<{ sources?: SourceReport[] }>(collect.raw_path);
  const sources = Array.isArray(raw?.sources) ? raw!.sources! : [];
  const counts = { raw: Number(collect.raw_count ?? 0), qualified: Number(screen?.qualified_count ?? 0), rejected: Number(screen?.rejected_count ?? 0) };
  if (!collect.ok) {
    finish(false, `radar collect failed: ${collect.summary}`, [], 0, sources, counts);
  } else if (screen !== null && !screen.ok) {
    finish(false, `radar screen failed: ${screen.summary}`, [], 0, sources, counts);
  } else if (screen === null || !screen.go) {
    finish(true, screen === null ? `nothing to screen: ${collect.summary}` : `nothing qualified: ${screen.summary}`, [], 0, sources, counts);
  } else {
    const data = artifact<{ qualified?: PendingJob[] }>(screen.qualified_path);
    const qualified = Array.isArray(data?.qualified) ? data!.qualified! : [];
    if (qualified.length === 0) {
      finish(false, 'qualified offers not found in the run artifacts (radar/qualified.json)', [], 0, sources, counts);
    } else if (careerDir === '' || !existsSync(careerDir)) {
      finish(false, `career_dir not found: ${careerDir}`, [], 0, sources, counts);
    } else {
      const boardPath = boardPathIn(careerDir);
      try {
        const outcome = withBoardLock(boardPath, 'career-radar record', () => {
          const existed = existsSync(boardPath);
          const board = existed ? readBoard(boardPath) : [];
          const result = appendNew(board, qualified, run, new Date());
          if (result.jobs !== null) writeBoard(boardPath, result.jobs);
          return { ...result, created: !existed && result.jobs !== null, total: (result.jobs ?? board).length };
        });
        const names = outcome.added.map((j) => `${j.company} — ${j.title} (${String(j.match_score)})`).slice(0, 5).join(' | ');
        finish(true, `${outcome.added.length} offer(s) added to the board (${outcome.total} row(s) now${outcome.created ? ', board created' : ''}), ${outcome.skipped.length} already there${names ? ` : ${names}` : ''}`, outcome.added, outcome.skipped.length, sources, counts);
      } catch (err) {
        finish(false, `board not updated: ${errorText(err)}`, [], 0, sources, counts);
      }
    }
  }
}
