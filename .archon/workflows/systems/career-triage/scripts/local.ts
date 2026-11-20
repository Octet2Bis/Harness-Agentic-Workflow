/**
 * Le tri par le modèle local (moteur `local`), sans Claude : lit `posting.txt` que `load` a écrit
 * dans les artefacts, pose au modèle local (Ollama) les questions fermées que le code ne tranche
 * pas, contrôle chaque réponse et laisse `decideTriage` décider (`triageLocal`,
 * `.shared/triage-local.ts`). Écrit `decision.json` et `local.json` (questions, réponses,
 * contrôles, durées) à côté. Ollama injoignable : retombe sur les règles du code
 * (`triageByRules`), `engine: rules`, une note le dit.
 *
 * Liaisons : INPUTS_LOAD (sortie de `load` : offer_json, criteria_json, posting_full).
 * Environnement : TRIAGE_LOCAL_URL (défaut http://127.0.0.1:11434, l'Ollama de la VM),
 * TRIAGE_LOCAL_MODEL (défaut qwen2.5:7b-instruct-q4_0), TRIAGE_LOCAL_KEEP_ALIVE (défaut 30m).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson } from '../../.shared/io.ts';
import { DEFAULT_LOCAL_MODEL, LOCAL_NOTE, ollamaAsk, triageLocal } from '../../.shared/triage-local.ts';
import { readCriteria, triageByRules } from '../../.shared/triage-rules.ts';

const load = nullableJson(process.env.INPUTS_LOAD) as { offer_json?: string; criteria_json?: string; posting_full?: string } | null;
const url = (process.env.TRIAGE_LOCAL_URL ?? '').trim() || 'http://127.0.0.1:11434';
const model = (process.env.TRIAGE_LOCAL_MODEL ?? '').trim() || DEFAULT_LOCAL_MODEL;
let criteriaRaw: unknown = null;
try {
  criteriaRaw = JSON.parse(String(load?.criteria_json ?? '').replace(/^﻿/, ''));
} catch {
  criteriaRaw = null;
}
const { criteria, problems } = readCriteria(criteriaRaw);
if (criteria === null) {
  emit({ decision: 'a_verifier', reasons: [`criteres.json illisible : ${problems.join(' ; ')}`], notes: [], engine: 'local' });
} else {
  const dir = artifactsDir();
  const posting = readFileSync(join(dir, 'posting.txt'), 'utf8');
  const offerJson = String(load?.offer_json ?? '{}');
  const full = load?.posting_full !== 'false';
  // Le modèle est-il là ? (liste des modèles d'Ollama, 5 s) ; sinon les règles, et la note le dit.
  let reachable = '';
  try {
    const tags = (await (await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()) as { models?: { name?: string }[] };
    reachable = (tags.models ?? []).some((m) => m.name === model) ? 'ok' : `modèle ${model} absent d'Ollama`;
  } catch (err) {
    reachable = `Ollama injoignable (${(err as Error).message.slice(0, 80)})`;
  }
  if (reachable !== 'ok') {
    const result = triageByRules(offerJson, posting, criteria, full);
    writeFileSync(join(dir, 'decision.json'), JSON.stringify(result, null, 2), 'utf8');
    emit({ decision: result.decision, reasons: result.reasons, notes: [...result.notes, `Tri local impossible : ${reachable} ; tri par les règles du code`], engine: 'rules' });
  } else {
    const t0 = Date.now();
    const result = await triageLocal(offerJson, posting, criteria, full, ollamaAsk(url, model, { keepAlive: (process.env.TRIAGE_LOCAL_KEEP_ALIVE ?? '').trim() || '30m' }));
    const { questions, controls, ...decision } = result;
    writeFileSync(join(dir, 'decision.json'), JSON.stringify(decision, null, 2), 'utf8');
    writeFileSync(join(dir, 'local.json'), JSON.stringify({ model, url_host: new URL(url).host, seconds: Math.round((Date.now() - t0) / 100) / 10, questions, controls }, null, 2), 'utf8');
    emit({ decision: decision.decision, reasons: decision.reasons, notes: [...decision.notes, `${LOCAL_NOTE} (${model}, ${questions.length} question(s))`], engine: 'local' });
  }
}
