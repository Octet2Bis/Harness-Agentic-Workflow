/**
 * Clôt le tour du listener quand le sous-run career-apply a terminé (`completed`). En `idle`
 * rien à écrire. Quand le sous-run a rendu une issue, `record` (dans career-apply) a en
 * général déjà écrit le statut : on le relaie, `ok: false` compris (un bloc `unconverged` ou
 * un refus au go y arrive en APPLY_FAILED ou TAILORED, déjà écrit).
 *
 * Avant toute écriture, l'issue du sous-run est sauvée dans `$ARTIFACTS_DIR/close.json` : si
 * l'écriture ci-dessous échoue (fichier verrouillé, verrou du tableau introuvable à temps),
 * `settle`, qui passe ensuite, y relit le statut calculé par `record` et l'écrit, au lieu
 * d'APPLY_FAILED sur une candidature peut-être envoyée.
 *
 * Quand `record` a rendu une issue SANS pouvoir l'écrire (`status_written: false` : fichier
 * verrouillé ou illisible), on l'écrit ici, sous la garde de `recordUnwritten` (seulement si
 * l'offre est encore APPLYING par cette prise). Quand le sous-run n'a rien rendu, l'offre ne
 * reste pas APPLYING : `settleClaim` la passe APPLY_UNPROVEN si son `submission/` montre un
 * clic possible, sinon APPLY_FAILED, si elle l'est encore par cette prise.
 *
 * Un sous-run en ÉCHEC ou annulé n'arrive pas jusqu'ici : Archon ne laisse jamais une liaison
 * lire un nœud en échec (même avec `if_skipped`), donc `close` échoue avec `run`. C'est
 * `settle`, le dernier nœud, qui ne lie que `claim`, qui clôt alors l'offre (même règle).
 *
 * Toute écriture se fait sous le verrou du tableau (`updateBoard`, `.shared/pending.ts`).
 *
 * Liaisons : INPUTS_CLAIM (sortie de `claim`), INPUTS_RESULT (issue de career-apply, null si
 * sauté ou sans sortie), INPUTS_CAREER_DIR.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { type ChildResult, type Claimed, boardPathIn, recordUnwritten, settleClaim, submissionEvidence, updateBoard } from '../../.shared/pending.ts';

interface Claim extends Claimed {
  summary: string;
}

const claim = nullableJson(process.env.INPUTS_CLAIM) as Claim | null;
const result = nullableJson(process.env.INPUTS_RESULT) as ChildResult | null;
const pendingPath = boardPathIn(text(process.env.INPUTS_CAREER_DIR).trim());
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

if (claim === null || claim.path === 'idle') {
  emit({ ok: true, path: 'idle', slug: '', status: '', summary: claim?.summary ?? 'Nothing to do.' });
} else {
  // D'abord close.json : `settle` le relit si l'écriture du tableau échoue ici.
  writeFileSync(join(artifactsDir(), 'close.json'), JSON.stringify({ claim: { path: claim.path, slug: claim.slug, run: claim.run }, result, at: new Date().toISOString() }, null, 2), 'utf8');
  if (result !== null) {
    let note = '';
    if (result.status_written === false && existsSync(pendingPath)) {
      try {
        const recorded = updateBoard(pendingPath, 'career-listener close', (jobs) => {
          const outcome = recordUnwritten(jobs, claim, result, new Date());
          return { jobs: outcome.written ? outcome.jobs : null, value: outcome };
        });
        if (recorded.written) note = ` career-apply could not write its status; the listener wrote ${recorded.status}.`;
        else if (recorded.status !== '') note = ` Not rewritten: the offer is ${recorded.status}, no longer APPLYING by this claim.`;
      } catch (err) {
        note = ` The status could not be written here either (${errorText(err)}); settle retries from close.json.`;
      }
    }
    emit({ ok: result.ok, path: result.ok ? 'done' : 'failed', slug: claim.slug, status: result.status, summary: `${claim.slug} (${result.stage}): ${result.summary}${note}` });
  } else {
    let status = '';
    if (existsSync(pendingPath)) {
      try {
        status = updateBoard(pendingPath, 'career-listener close', (jobs) => {
          const settled = settleClaim(jobs, claim, new Date(), 'career-apply completed without returning a result; check its submission/ artifacts and the mailbox before re-validating (/valider).', { evidence: submissionEvidence });
          return { jobs: settled.settled ? settled.jobs : null, value: settled.status };
        });
      } catch (err) {
        status = `unknown (${errorText(err)}; settle retries)`;
      }
    }
    emit({ ok: false, path: 'failed', slug: claim.slug, status, summary: `${claim.slug}: career-apply returned no result; status ${status || 'unknown (pending_gold_jobs.json unavailable)'}.` });
  }
}
