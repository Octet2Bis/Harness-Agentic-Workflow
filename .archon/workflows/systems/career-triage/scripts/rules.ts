/**
 * Le tri sans modèle (moteur `rules`) : lit `posting.txt` que `load` a écrit dans les artefacts,
 * applique les règles du code (`triageByRules`, `.shared/triage-rules.ts`) et écrit
 * `decision.json` à côté, comme le contrôle du bloc job-triage. Aucun appel de modèle.
 *
 * Liaisons : INPUTS_LOAD (sortie de `load` : offer_json, criteria_json, posting_full).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson } from '../../.shared/io.ts';
import { readCriteria, triageByRules } from '../../.shared/triage-rules.ts';

const load = nullableJson(process.env.INPUTS_LOAD) as { offer_json?: string; criteria_json?: string; posting_full?: string } | null;
let criteriaRaw: unknown = null;
try {
  criteriaRaw = JSON.parse(String(load?.criteria_json ?? '').replace(/^﻿/, ''));
} catch {
  criteriaRaw = null;
}
const { criteria, problems } = readCriteria(criteriaRaw);
if (criteria === null) {
  emit({ decision: 'a_verifier', reasons: [`criteres.json illisible : ${problems.join(' ; ')}`], notes: [] });
} else {
  const dir = artifactsDir();
  const posting = readFileSync(join(dir, 'posting.txt'), 'utf8');
  const result = triageByRules(String(load?.offer_json ?? '{}'), posting, criteria, load?.posting_full !== 'false');
  writeFileSync(join(dir, 'decision.json'), JSON.stringify(result, null, 2), 'utf8');
  emit({ decision: result.decision, reasons: result.reasons, notes: result.notes });
}
