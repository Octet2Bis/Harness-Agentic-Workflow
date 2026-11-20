/**
 * Écrit le tri de l'offre dans `<career_dir>/triage/<clé>.json` (écriture tmp → rename), que le
 * cockpit lit pour afficher la décision et ses raisons. Les chiffres (salaire annuel en euros,
 * langues exigées) viennent de `decision.json`, écrit par le contrôle du bloc quand il a
 * conclu. Le tableau `pending_gold_jobs.json` n'est pas touché.
 *
 * Liaisons : INPUTS_CAREER_DIR, INPUTS_LOAD (sortie de `load`), INPUTS_CLASSIFIED (sortie de
 * `classify`, "null" quand il n'y avait rien à trier).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { type TriageRecord, triageDirIn } from '../../.shared/triage.ts';

interface Load {
  ok: boolean;
  go: boolean;
  summary: string;
  key: string;
  offer_json: string;
  criteria_hash: string;
  posting_full: string;
  attempts: number;
}

export function buildRecord(load: Load, classified: Pick<TriageRecord, 'decision' | 'reasons' | 'notes' | 'block_status'>, extras: { salary_annual_eur?: TriageRecord['salary_annual_eur']; languages_required?: string[] }, run: string, now: Date): TriageRecord {
  const offer = JSON.parse(load.offer_json || '{}') as Record<string, string>;
  return {
    key: load.key,
    id: offer.id ?? '',
    slug: offer.slug ?? '',
    company: offer.company ?? '',
    title: offer.title ?? '',
    link: offer.link ?? '',
    decision: classified.decision,
    reasons: classified.reasons,
    notes: classified.notes,
    salary_annual_eur: classified.block_status === 'verified' || classified.block_status === 'rules' || classified.block_status === 'local' ? (extras.salary_annual_eur ?? null) : null,
    languages_required: classified.block_status === 'verified' || classified.block_status === 'rules' || classified.block_status === 'local' ? (extras.languages_required ?? []) : [],
    posting_full: load.posting_full === 'true',
    block_status: classified.block_status,
    attempts: (load.attempts ?? 0) + 1,
    run_id: run,
    at: now.toISOString(),
    criteria_hash: load.criteria_hash,
  };
}

if (import.meta.main) {
  const load = nullableJson(process.env.INPUTS_LOAD) as Load | null;
  const classified = nullableJson(process.env.INPUTS_CLASSIFIED) as Pick<TriageRecord, 'decision' | 'reasons' | 'notes' | 'block_status'> | null;
  if (load === null || !load.ok || !load.go || classified === null) {
    emit({ ok: load?.ok ?? false, written: false, key: load?.key ?? '', decision: '', path: '', summary: load?.summary ?? 'load returned nothing' });
  } else {
    const decisionPath = join(artifactsDir(), 'decision.json');
    let extras = {};
    try {
      if (existsSync(decisionPath)) extras = JSON.parse(readFileSync(decisionPath, 'utf8'));
    } catch {
      extras = {};
    }
    const record = buildRecord(load, classified, extras, process.env.WORKFLOW_ID ?? '', new Date());
    const dir = triageDirIn(text(process.env.INPUTS_CAREER_DIR));
    const path = join(dir, `${record.key}.json`);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2), 'utf8');
      renameSync(`${path}.tmp`, path);
      emit({ ok: true, written: true, key: record.key, decision: record.decision, path, summary: `${record.company} — ${record.title}: ${record.decision} (${record.reasons.join(' ; ')})` });
    } catch (error) {
      emit({ ok: false, written: false, key: record.key, decision: record.decision, path, summary: `triage not written: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
}
