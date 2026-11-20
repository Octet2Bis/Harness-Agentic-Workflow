/**
 * Le filet d'un run lancé à la main : dernier nœud de career-apply, `trigger_rule: all_done`,
 * seulement quand `load` a pris l'offre lui-même (`self_claimed`). Un run lancé par le listener
 * n'en a pas besoin : `settle` du listener tient ce rôle (et `close` avant lui).
 *
 * Quand le run échoue (erreur d'un modèle ou d'un script hors bloc : `record` ne tourne pas),
 * l'offre resterait APPLYING par ce run jusqu'à la règle des prises périmées (deux heures),
 * et le listener ne prendrait rien entre-temps (une candidature en vol à la fois). Ce nœud ne
 * lie que `load` ; si l'offre est encore APPLYING par la prise de ce run, `settleClaim` (pur,
 * testé dans `.shared/pending.test.ts`, la même règle que `settle` du listener) écrit, dans
 * l'ordre : le statut que `record` avait calculé quand il l'a sauvé dans
 * `$ARTIFACTS_DIR/record.json` sans réussir à l'écrire ; APPLY_UNPROVEN quand `submission/`
 * montre qu'un clic a pu avoir lieu ; sinon APPLY_FAILED. Quand `record` a écrit, l'offre
 * n'est plus APPLYING par cette prise : rien à faire. Un run annulé ne passe pas ici (Archon
 * ne lance plus aucun nœud) : la règle des prises périmées le clôt.
 *
 * Liaisons : INPUTS_SLUG, INPUTS_BOARD (chemin de pending_gold_jobs.json), INPUTS_CLAIM_RUN
 * (la prise de ce run, sorties de `load`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { type ChildResult, settleClaim, submissionEvidence, updateBoard } from '../../.shared/pending.ts';

const slug = text(process.env.INPUTS_SLUG).trim();
const board = text(process.env.INPUTS_BOARD).trim();
const claimRun = text(process.env.INPUTS_CLAIM_RUN).trim();

/** L'issue que `record` a sauvée pour CETTE prise, ou null. */
function savedResult(): ChildResult | null {
  const path = join(artifactsDir(), 'record.json');
  if (!existsSync(path)) return null;
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as ChildResult & { claim_run?: string };
    return saved.claim_run === claimRun ? saved : null;
  } catch {
    return null;
  }
}

if (slug === '' || board === '' || claimRun === '') {
  emit({ settled: false, slug, status: '', summary: 'This run holds no claim: nothing to settle.' });
} else if (!existsSync(board)) {
  emit({ settled: false, slug, status: '', summary: `pending_gold_jobs.json not found: ${slug} left as is.` });
} else {
  const result = savedResult();
  const reason =
    `career-apply (run ${claimRun}, started by hand) ended without recording a final status: a model or script error outside a block, such as resolve. ` +
    'See archon workflow status for that run; check its submission/ artifacts and the mailbox before re-validating (/valider).';
  const settled = updateBoard(board, 'career-apply settle', (jobs) => {
    const outcome = settleClaim(jobs, { path: 'work', slug, run: claimRun }, new Date(), reason, { result, evidence: submissionEvidence, by: 'career-apply (settle, from record.json)' });
    return { jobs: outcome.settled ? outcome.jobs : null, value: outcome };
  });
  const how = { result: 'the status record computed, saved in record.json', evidence: 'its submission/ shows a click may have happened', reason, '': '' }[settled.via];
  emit({
    settled: settled.settled,
    slug,
    status: settled.status,
    summary: settled.settled ? `${slug}: status set to ${settled.status} (${how}).` : `${slug} is ${settled.status || 'missing'}: nothing to settle.`,
  });
}
