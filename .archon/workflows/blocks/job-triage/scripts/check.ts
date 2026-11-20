/**
 * Contrôle déterministe de l'extraction écrite par l'agent dans `$ARTIFACTS_DIR/<out>`
 * (triage.json) : forme, citations mot pour mot dans l'annonce (`<posting>`), langues et
 * montants que le balayage trouve et que l'extraction oublie (`.shared/triage-checks.ts`). Quand
 * tout passe, la décision est calculée ici, par la règle (`decideTriage`), jamais par l'agent,
 * et écrite dans `decision.json` à côté de l'extraction.
 *
 * Liaisons (`with:`) : INPUTS_CRITERIA (criteres.json en texte), INPUTS_OFFER (l'offre en JSON :
 * son `title` sert à la règle des intitulés senior), INPUTS_POSTING (nom du fichier de
 * l'annonce), son `source` : la règle des plateformes 100 % télétravail, son `date_published`
 * (et `radar_at`) : la règle d'âge `offre_age_max_jours`), INPUTS_POSTING_FULL, INPUTS_PROFILE (nom du
 * fichier du profil du candidat dans les artefacts ; vide ou absent : le cœur du poste n'est pas
 * évalué), INPUTS_OUT, INPUTS_SUMMARY et INPUTS_DELIVERABLE (relayés) ;
 * INPUTS_TRIES, le numéro du tour précédent (vide au premier).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nextTry, nullableJson, text } from '../../.shared/io.ts';
import { checkCoreFit, checkExtraction, decideTriage, offerPublished, offerSource, offerTitle, readCriteria, readExtraction, type TriageDecision } from '../../.shared/triage-checks.ts';

export function parseJson(raw: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(raw.replace(/^﻿/, '')), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Tous les problèmes, et la décision quand il n'y en a aucun. */
export function evaluate(input: { criteria: string; posting: string | null; extraction: string | null; out: string; postingFull: boolean; offer?: string; now?: Date; profile?: string | null }): { problems: string[]; decision: TriageDecision | null } {
  const criteria = readCriteria(parseJson(input.criteria).value);
  if (criteria.criteria === null) return { problems: criteria.problems, decision: null };
  if (input.posting === null || input.posting.trim() === '') return { problems: ['the posting file is missing or empty: nothing can be checked (caller error)'], decision: null };
  if (input.extraction === null) return { problems: [`${input.out} was not written; write the extraction there as JSON`], decision: null };
  const parsed = parseJson(input.extraction);
  if (parsed.error !== null) return { problems: [`${input.out} is not valid JSON: ${parsed.error}`], decision: null };
  const read = readExtraction(parsed.value);
  if (read.extraction === null) return { problems: read.problems, decision: null };
  const profile = input.profile ?? null;
  const profileGiven = profile !== null && profile.trim() !== '';
  const problems = [...checkExtraction(read.extraction, input.posting, criteria.criteria), ...checkCoreFit(read.extraction.core_requirements, input.posting, profile, read.extraction.tools_requested ?? [])];
  const title = offerTitle(input.offer ?? '', input.posting);
  const source = offerSource(input.offer ?? '', input.posting);
  const { published, readAt } = offerPublished(input.offer ?? '');
  return { problems, decision: problems.length === 0 ? decideTriage(read.extraction, criteria.criteria, input.postingFull, { title, source, posting: input.posting, published, readAt, now: input.now ?? new Date(), profileGiven }) : null };
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

if (import.meta.main) {
  const dir = artifactsDir();
  const out = text(process.env.INPUTS_OUT) || 'triage.json';
  const profileFile = text(process.env.INPUTS_PROFILE).trim();
  const result = evaluate({
    criteria: text(process.env.INPUTS_CRITERIA),
    offer: text(process.env.INPUTS_OFFER),
    posting: readIfExists(join(dir, text(process.env.INPUTS_POSTING) || 'posting.txt')),
    extraction: readIfExists(join(dir, out)),
    out,
    postingFull: text(process.env.INPUTS_POSTING_FULL).trim() !== 'false',
    profile: profileFile !== '' ? readIfExists(join(dir, profileFile)) : null,
  });
  if (result.decision !== null) writeFileSync(join(dir, 'decision.json'), JSON.stringify(result.decision, null, 2), 'utf8');
  emit({
    ok: result.problems.length === 0,
    problems: result.problems,
    summary: text(process.env.INPUTS_SUMMARY),
    decision: result.decision?.decision ?? '',
    reasons: result.decision?.reasons ?? [],
    notes: result.decision?.notes ?? [],
    deliverable: nullableJson(process.env.INPUTS_DELIVERABLE),
    tries: nextTry(process.env.INPUTS_TRIES),
  });
}
