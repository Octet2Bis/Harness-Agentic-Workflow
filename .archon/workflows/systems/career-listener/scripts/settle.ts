/**
 * Le filet : dernier nœud du listener, `trigger_rule: all_done`, il tourne quoi qu'il soit
 * arrivé avant. Quand le sous-run career-apply échoue ou est annulé (erreur d'un modèle ou d'un
 * script hors bloc, comme `resolve`, qui fait échouer `confirm_route` puis `record` ; ou un
 * cancel, même pendant `submit`), le nœud `run` échoue ; Archon ne laisse aucune liaison lire
 * un nœud en échec, donc `close` échoue aussi. Sans ce nœud l'offre resterait APPLYING jusqu'à
 * la clôture d'une prise périmée.
 *
 * Ne lie QUE `claim` (jamais `run` ni `close`, qui peuvent être en échec). Relit l'offre sous
 * le verrou du tableau ; si elle est encore APPLYING par CE run (`applying.run` = le `run` noté
 * par `claim`), personne n'a écrit son statut, et `settleClaim` (pur, testé dans
 * `.shared/pending.test.ts`) écrit, dans l'ordre :
 * 1. le statut que `record` avait calculé, quand `close` l'a sauvé dans
 *    `$ARTIFACTS_DIR/close.json` sans réussir à l'écrire (APPLIED reste APPLIED) ;
 * 2. APPLY_UNPROVEN quand le `submission/` du sous-run (`applying.artifacts`, noté par son
 *    `load`) montre qu'un clic a pu avoir lieu (`clickEvidence`) : un cancel pendant `submit`
 *    n'est jamais noté « échoué » ;
 * 3. sinon APPLY_FAILED avec la raison.
 * Une offre déjà écrite par `record`, par `close`, reprise à la main ou prise par un autre run
 * n'est pas touchée. Un sous-run en pause au go ne passe pas ici : le listener attend avec lui
 * (« blocked on sub-run »).
 *
 * Liaisons : INPUTS_CLAIM (sortie typée de `claim`), INPUTS_CAREER_DIR.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { type ChildResult, type Claimed, boardPathIn, orphanReason, settleClaim, submissionEvidence, updateBoard } from '../../.shared/pending.ts';

const claim = nullableJson(process.env.INPUTS_CLAIM) as Claimed | null;
const pendingPath = boardPathIn(text(process.env.INPUTS_CAREER_DIR).trim());

/** L'issue que `close` a sauvée pour CETTE prise, ou null. */
function savedResult(): ChildResult | null {
  const path = join(artifactsDir(), 'close.json');
  if (claim === null || !existsSync(path)) return null;
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { claim?: Claimed; result?: ChildResult | null };
    return saved.claim?.slug === claim.slug && saved.claim?.run === claim.run ? (saved.result ?? null) : null;
  } catch {
    return null;
  }
}

if (claim === null || claim.path !== 'work') {
  emit({ settled: false, slug: '', status: '', summary: 'Nothing was claimed.' });
} else if (!existsSync(pendingPath)) {
  emit({ settled: false, slug: claim.slug, status: '', summary: `pending_gold_jobs.json not found: ${claim.slug} left as is.` });
} else {
  const result = savedResult();
  const reason = orphanReason(claim.run);
  const settled = updateBoard(pendingPath, 'career-listener settle', (jobs) => {
    const outcome = settleClaim(jobs, claim, new Date(), reason, { result, evidence: submissionEvidence, by: 'career-listener (settle, from close.json)' });
    return { jobs: outcome.settled ? outcome.jobs : null, value: outcome };
  });
  const how = { result: 'the status career-apply computed, saved in close.json', evidence: 'its submission/ shows a click may have happened', reason, '': '' }[settled.via];
  emit({
    settled: settled.settled,
    slug: claim.slug,
    status: settled.status,
    summary: settled.settled ? `${claim.slug}: status set to ${settled.status} (${how}).` : `${claim.slug} is ${settled.status || 'missing'}: nothing to settle.`,
  });
}
