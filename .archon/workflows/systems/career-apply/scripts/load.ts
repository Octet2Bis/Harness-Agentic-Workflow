/**
 * Prend l'offre, puis charge ce qu'il faut pour y postuler : l'offre de
 * `pending_gold_jobs.json`, les remarques laissées sur ce dossier, l'annonce en ligne si
 * possible, et écrit `offer.json` dans les artefacts.
 *
 * La prise, d'abord, sous le verrou du tableau (`claimForRun` et `updateBoard`,
 * `.shared/pending.ts`) :
 * - lancé par le listener (`claim_run` = son run, noté dans `applying.run` par `claim`), le run
 *   ne travaille que si l'offre est encore tenue par cette prise ; il y note son dossier
 *   d'artefacts (`applying.artifacts`), où le filet lit `submission/` ;
 * - lancé à la main (`claim_run` vide), le run prend l'offre lui-même : APPLYING, avec
 *   `applying.run` = ce run (WORKFLOW_ID), comme le listener l'aurait fait. Le listener la
 *   laisse donc tranquille (il ne prend que VALIDATED, et rien tant qu'une candidature est en
 *   vol), `record` écrit son statut comme pour une prise du listener, et `settle` (dernier
 *   nœud) la clôt si le run échoue. `applying.from` garde le statut d'avant la prise : une
 *   issue VALIDATED le réécrit à la place, jamais une mise en file que personne n'a validée
 *   (`recordStatus`). Refus, sans rien écrire : offre APPLYING par une autre
 *   prise, APPLIED ou APPLY_UNPROVEN, ou autre candidature en vol.
 * Un refus rend `ok: false` (rien d'autre ne tourne, `record` n'écrit rien : `claim_run` vide).
 *
 * Puis la garde d'annonce (`.shared/posting-guard.ts`) sur la page lue (statut, URL après
 * redirections, titre, texte visible) :
 * - `expirée` (404/410, redirection vers une liste, « offre expirée », date limite passée…) :
 *   `ok: false`, `posting: expirée` et ses raisons ; la prise reste, et `record` clôt l'offre
 *   en APPLY_FAILED au stage `load` (`outcome`, `.shared/career.ts`) au lieu de la remettre en
 *   file : rien n'est adapté ni envoyé, et `/valider` la remet en file si l'annonce vit encore ;
 * - `suspecte` (argent demandé, contact par WhatsApp, messagerie personnelle, crypto, paie
 *   irréaliste, consignes écrites pour un agent…) : le run continue (un signal, pas un
 *   blocage), le résumé de `load` et `offer.json` (`posting_guard`) le disent à l'humain ;
 * - `ok`, ou `non lue` quand la page n'a pas répondu ou pas en 2xx sans rien prouver.
 * `offer.json` porte le verdict ; l'offre passée à cv-tailor (`offer_json`) non : une raison
 * cite la ligne suspecte, l'agent n'a pas à la relire. Le texte de l'annonce passé à l'agent
 * (`description_full`) est sans caractères invisibles (`cleanPostingText`).
 *
 * Liaisons : INPUTS_SLUG, INPUTS_CAREER_DIR, INPUTS_CLAIM_RUN.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { POSTING_HEADERS, answersForOffer, deriveKeywords, findJob, linkedinApplyUrl, offerForBlock, postingText, postingUrl, visibleText } from '../../.shared/career.ts';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { boardPathIn, claimForRun, updateBoard } from '../../.shared/pending.ts';
import { type PostingGuard, cleanPostingText, guardPosting } from '../../.shared/posting-guard.ts';

const slug = text(process.env.INPUTS_SLUG).trim();
const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const claimRun = text(process.env.INPUTS_CLAIM_RUN).trim();
const run = process.env.WORKFLOW_ID ?? '';
const pendingPath = boardPathIn(careerDir);
const profile = join(careerDir, 'master_profile.md');
const proofs = join(careerDir, 'skill_proof_graph.json');
const remarksPath = join(careerDir, 'applications', slug, 'remarques_utilisateur.txt');
const answersPath = join(careerDir, 'reponses_formulaires.md');
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

let claim = { claim: '', self: false };

function done(ok: boolean, summary: string, extra: Record<string, unknown> = {}): void {
  emit({
    ok,
    summary,
    slug,
    profile,
    proofs: existsSync(proofs) ? proofs : '',
    remarks: '',
    keywords: '',
    offer_json: '{}',
    link: '',
    direct_apply: '',
    board: pendingPath,
    claim_run: claim.claim,
    self_claimed: claim.self,
    posting: 'non lue',
    posting_reasons: [],
    answers: existsSync(answersPath) ? answersPath : '',
    ...extra,
  });
}

if (slug === '' || careerDir === '') {
  done(false, 'slug and career_dir are required');
} else if (!existsSync(pendingPath)) {
  done(false, `pending_gold_jobs.json not found in ${careerDir}`);
} else if (!existsSync(profile)) {
  done(false, `master_profile.md not found in ${careerDir}`);
} else {
  let taken: ReturnType<typeof claimForRun> | null = null;
  try {
    taken = updateBoard(pendingPath, 'career-apply load', (jobs) => {
      const outcome = claimForRun(jobs, slug, { claimRun, run, now: new Date(), artifacts: artifactsDir() });
      return { jobs: outcome.jobs, value: outcome };
    });
  } catch (error) {
    done(false, `pending_gold_jobs.json could not be read or claimed: ${errorText(error)}`);
  }
  if (taken !== null && !taken.ok) {
    done(false, `Not claimed: ${taken.summary}.`);
  } else if (taken !== null) {
    claim = { claim: taken.claim, self: taken.self };
    // Prise faite : toute erreur d'ici rend ok: false (record écrit alors son issue sur la prise).
    try {
      const job = findJob(JSON.parse(readFileSync(pendingPath, 'utf8').replace(/^﻿/, '')), slug);
      if (job === null) throw new Error(`offer ${slug} vanished from pending_gold_jobs.json`);
      let descriptionFull = '';
      // La garde d'annonce : null tant que la page n'a pas répondu (lien absent, réseau, délai).
      let guard: PostingGuard | null = null;
      let read = false;
      // Offre LinkedIn « Postuler » hors LinkedIn : la page employeur, lue sur la page publique (route s'en sert).
      let directApply = '';
      if (/^https?:\/\//.test(job.link ?? '')) {
        try {
          const response = await fetch(postingUrl(job.link), { headers: POSTING_HEADERS, signal: AbortSignal.timeout(15000) });
          const html = await response.text();
          const pageText = postingText(html, 20_000);
          const title = visibleText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '', 200);
          guard = guardPosting({ url: job.link, status: response.status, finalUrl: response.url, title, text: pageText, now: new Date() });
          read = response.ok;
          if (response.ok) directApply = linkedinApplyUrl(html);
          if (response.ok) descriptionFull = cleanPostingText(pageText).slice(0, 8000);
        } catch {
          descriptionFull = '';
        }
      }
      // `non lue` : pas de réponse, ou une réponse hors 2xx qui ne prouve rien (403, mur…).
      const posting = guard === null || (guard.verdict === 'ok' && !read) ? 'non lue' : guard.verdict;
      const postingReasons = guard?.reasons ?? [];
      // Les mots-clés exigés du CV sont ceux de l'annonce : titre + description du tableau + page lue.
      const keywords = deriveKeywords(job, [job.title ?? '', job.description ?? '', descriptionFull].join('\n'));
      const offer = offerForBlock(job, descriptionFull, keywords);
      writeFileSync(join(artifactsDir(), 'offer.json'), JSON.stringify({ ...offer, posting_guard: { verdict: posting, reasons: postingReasons } }, null, 2), 'utf8');
      const guarded = { posting, posting_reasons: postingReasons, link: job.link ?? '', direct_apply: directApply };
      if (posting === 'expirée') {
        done(
          false,
          `Posting expired (posting guard): ${postingReasons.join(' ; ')}. Nothing was tailored or sent; record closes the offer APPLY_FAILED (/valider re-queues it if the posting is still open; ${taken.summary}).`,
          guarded
        );
      } else {
        const remarks = existsSync(remarksPath) ? readFileSync(remarksPath, 'utf8').trim() : '';
        // Les réponses validées, adaptées à cette offre (salaire : son minimum, sinon le plancher ; la source).
        let answers = '';
        if (existsSync(answersPath)) {
          answers = join(artifactsDir(), 'reponses_formulaires.md');
          writeFileSync(answers, answersForOffer(readFileSync(answersPath, 'utf8'), job), 'utf8');
        }
        const flag = posting === 'suspecte' ? ` Posting flagged as suspicious (posting guard, nothing blocked): ${postingReasons.join(' ; ')}. Check the employer before any go.` : '';
        done(true, `Offer ${job.company} — ${offer.title} loaded (${descriptionFull === '' ? 'posting not fetched' : `posting read, ${descriptionFull.length} chars`}; ${keywords.length} keywords; ${taken.summary}).${flag}`, {
          ...guarded,
          remarks,
          answers,
          keywords: keywords.join(', '),
          offer_json: JSON.stringify(offer),
        });
      }
    } catch (error) {
      done(false, `Offer claimed (${taken.summary}) but not loaded: ${errorText(error)}`);
    }
  }
}
