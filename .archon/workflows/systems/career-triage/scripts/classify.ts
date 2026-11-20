/**
 * Pur : la décision écrite pour l'offre, depuis le verdict du bloc `job-triage` (`classify`,
 * `.shared/triage.ts`). Seul un bloc `verified` décide ; sinon « à vérifier », raison à l'appui.
 * Une annonce illisible (`load` : `readable` faux, bloc sauté) donne « à vérifier » avec la
 * raison de `load` (« Annonce illisible : … »), `block_status: unreadable`. Une offre que `load` a
 * tranchée seule (`pre_screened` : offre trop ancienne, bloc sauté) est écartée avec sa raison,
 * `block_status: pre_screened`.
 *
 * Le moteur `rules` (sans modèle) donne sa décision dans INPUTS_RULES : `block_status: rules`.
 * Le moteur `local` (modèle de la VM, sans Claude) dans INPUTS_LOCAL : `block_status: local`, ou
 * `rules` quand le modèle était injoignable (`local` est alors retombé sur les règles).
 *
 * Liaisons : INPUTS_VERDICT (sortie du bloc, "null" s'il a été sauté), INPUTS_RULES (sortie de `rules`, "null" s'il a été sauté), INPUTS_LOCAL (sortie de `local`, idem), INPUTS_LOAD (sortie de `load`).
 */

import { emit, nullableJson } from '../../.shared/io.ts';
import { type BlockVerdictLike, classify } from '../../.shared/triage.ts';

const load = nullableJson(process.env.INPUTS_LOAD) as { readable?: boolean; unreadable_reason?: string; pre_screened?: boolean; pre_screen_reason?: string } | null;
const preScreened = load !== null && load.pre_screened === true && (load.pre_screen_reason ?? '').trim() !== '' ? (load.pre_screen_reason as string) : null;
const unreadable = load !== null && load.readable === false ? (load.unreadable_reason || 'Annonce illisible : rien à lire') : null;
const rules = (nullableJson(process.env.INPUTS_RULES) ?? nullableJson(process.env.INPUTS_LOCAL)) as { decision: string; reasons: string[]; notes: string[]; engine?: string } | null;
emit(classify(nullableJson(process.env.INPUTS_VERDICT) as BlockVerdictLike | null, unreadable, preScreened, rules));
