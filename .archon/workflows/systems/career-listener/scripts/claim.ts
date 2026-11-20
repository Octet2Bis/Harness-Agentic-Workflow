/**
 * Prend l'offre VALIDATED suivante de `pending_gold_jobs.json` (la moins tentée, puis la plus
 * ancienne : `pickValidated`) : la passe APPLYING en notant ce run dans `applying.run` et
 * l'annonce. Clôt d'abord les prises APPLYING de plus de deux heures (`releaseStale`) en
 * APPLY_FAILED, ou en APPLY_UNPROVEN quand le `submission/` de leur run montre qu'un clic a pu
 * avoir lieu (`submissionEvidence`), sans jamais les remettre en file. Ne prend rien tant
 * qu'une autre candidature est en vol (`inFlight` : une offre APPLYING récente, par exemple
 * celle d'un career-apply lancé à la main) : les agents partagent un profil de navigateur.
 * Aucune offre : `idle`.
 *
 * Tout se fait sous le verrou du tableau (`updateBoard`, `.shared/pending.ts`) : `record`,
 * `close`, `settle`, `load` et la synchronisation avec la VM (`merge_pending.ts`) le prennent
 * aussi, aucune écriture n'en efface une autre.
 *
 * Liaisons : INPUTS_CAREER_DIR.
 */

import { existsSync } from 'node:fs';
import { emit, text } from '../../.shared/io.ts';
import { boardPathIn, busyNote, inFlight, markApplying, pickValidated, releaseStale, submissionEvidence, updateBoard } from '../../.shared/pending.ts';

const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const pendingPath = boardPathIn(careerDir);
const run = process.env.WORKFLOW_ID ?? 'unknown-run';
const now = new Date();
const idle = { path: 'idle', slug: '', company: '', title: '', run: '' };

if (!existsSync(pendingPath)) {
  emit({ ...idle, stale: [], summary: `pending_gold_jobs.json not found in ${careerDir}` });
} else {
  emit(
    updateBoard(pendingPath, 'career-listener claim', (jobs) => {
      const { jobs: fresh, stale } = releaseStale(jobs, now, undefined, submissionEvidence);
      const closed = stale.length > 0 ? ` Closed stale claim(s): ${stale.join(', ')}.` : '';
      const changed = stale.length > 0 ? fresh : null;
      const busy = inFlight(fresh, now);
      if (busy.length > 0) return { jobs: changed, value: { ...idle, stale, summary: `${busyNote(busy)}${closed}` } };
      const job = pickValidated(fresh);
      if (job === null) return { jobs: changed, value: { ...idle, stale, summary: `No validated offer waiting.${closed}` } };
      return {
        jobs: markApplying(fresh, job.slug, run, now),
        value: { path: 'work', slug: job.slug, company: job.company ?? '', title: job.title ?? '', run, stale, summary: `Picked ${job.slug} (${job.company} — ${job.title}).${closed}` },
      };
    })
  );
}
