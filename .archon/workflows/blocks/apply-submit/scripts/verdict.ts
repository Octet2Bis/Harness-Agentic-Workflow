/**
 * Issue du bloc :
 * - `unproven` avec `submitted: true` quand `prefill` dit avoir déjà envoyé le formulaire
 *   (`submitted_early`) : la boucle s'est arrêtée, rien d'autre n'a été cliqué, le juge n'a
 *   pas tourné ; l'humain vérifie sa boîte mail et la plateforme ;
 * - `unconverged` : le formulaire n'a pas passé ses contrôles au plafond de la boucle
 *   `prepare` ; aucun go n'a été demandé, rien n'a été envoyé, le juge n'a pas tourné ;
 *   ok: false, submitted: false, avec les derniers problèmes du formulaire ;
 * - `refused` : l'humain a refusé au go ; rien n'a été envoyé, le juge n'a pas tourné ;
 *   ok: false, submitted: false, avec la réponse de l'humain dans le résumé ;
 * - `superseded` : juste avant le clic, la garde `own` a relu le tableau de l'appelant et
 *   l'offre n'était plus tenue par sa prise (remise en file, prise par un autre run, déjà
 *   envoyée) ; `arm` et `submit` sont sautés, rien n'a été envoyé ; ok: false,
 *   submitted: false, résumé « Not sent: … ». Si ce run avait déjà démarré `submit` (reprise
 *   après une erreur : armed.json, click.json, reçu…), `unproven`, submitted: true ;
 * - `unproven` avec `submitted: true` quand `arm` a fermé la porte (`clear: false`) : le run a
 *   été repris après une erreur survenue une fois `submit` démarré ; rien n'a été recliqué,
 *   ni reçu ni juge ; la candidature est peut-être partie au premier passage ;
 * - `verified` : le reçu est prouvé et le juge approuve ;
 * - `unproven` : le clic a eu lieu sans preuve suffisante (l'humain doit vérifier sa boîte
 *   mail ou la plateforme : la candidature est peut-être partie) ;
 * - `rejected` sinon.
 *
 * Liaisons : INPUTS_PREPARED (sortie finale de la boucle `prepare`, c'est-à-dire celle de
 * `check_prefill` au dernier tour), INPUTS_DECISION (sortie de `decide`), INPUTS_RECEIPT
 * (sortie de check_receipt, "null" quand l'envoi n'a pas eu lieu), INPUTS_OWN (sortie de la
 * garde `own`, "null" quand elle a été sautée), INPUTS_ARM (sortie d'`arm`, "null" quand il a
 * été sauté), INPUTS_APPROVED,
 * INPUTS_REASON, INPUTS_FINDINGS ("null" quand le juge a été sauté), INPUTS_OUT_DIR.
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactPointer, artifactsDir, emit, fail, flag, nullableJson, text } from '../../.shared/io.ts';

interface PrefillCheck {
  ok: boolean;
  problems: string[];
  summary: string;
  filled: number;
  attached: boolean;
  submitted_early?: boolean;
  tries: number;
}

interface Decision {
  proceed: boolean;
  path: string;
  text: string;
}

interface Own {
  held: boolean;
  reason: string;
  evidence: string[];
}

interface Arm {
  clear: boolean;
  reason: string;
  evidence: string[];
}

interface ReceiptCheck {
  ok: boolean;
  problems: string[];
  submitted: boolean;
  proven: boolean;
  confirmation: string;
  summary: string;
}

const outDir = text(process.env.INPUTS_OUT_DIR) || 'submission';

/**
 * Rend le verdict typé et l'écrit dans `<out_dir>/verdict.json`, avec l'inventaire du dossier
 * (prefill.json, receipt.json, captures… selon l'issue). C'est ce fichier que désigne
 * `deliverable` : Archon exige d'un pointeur un fichier régulier non vide, jamais un dossier
 * (premier run réel, 2026-10-22), et aucun autre fichier n'est là dans toutes les issues
 * (pas de reçu sur un refus, pas de préremplissage sur un envoi signalé trop tôt).
 */
function conclude(verdict: Record<string, unknown>): void {
  const dir = join(artifactsDir(), outDir);
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir)
    .filter((name) => name !== 'verdict.json')
    .sort()
    .map((name) => ({ name, bytes: statSync(join(dir, name)).size }));
  const runId = process.env.WORKFLOW_ID ?? 'unknown-run';
  writeFileSync(join(dir, 'verdict.json'), JSON.stringify({ ...verdict, run_id: runId, files, at: new Date().toISOString() }, null, 2), 'utf8');
  emit({ ...verdict, deliverable: artifactPointer(`${outDir}/verdict.json`) });
}
const prepared = nullableJson(process.env.INPUTS_PREPARED) as PrefillCheck | null;
const decision = nullableJson(process.env.INPUTS_DECISION) as Decision | null;
const receipt = nullableJson(process.env.INPUTS_RECEIPT) as ReceiptCheck | null;
const own = nullableJson(process.env.INPUTS_OWN) as Own | null;
const arm = nullableJson(process.env.INPUTS_ARM) as Arm | null;
if (prepared === null) {
  fail('verdict: the prepare loop returned no output');
} else if (prepared.submitted_early === true) {
  // La boucle s'est arrêtée sur l'envoi signalé ; `gate` est sauté et `decide` a dit
  // submitted_early (proceed: false) : `submit` n'a pas tourné, rien d'autre n'a été cliqué.
  conclude({
    ok: false,
    status: 'unproven',
    submitted: true,
    summary: `The prefill agent reports the form was already submitted, before any go and without the submit step: the application may have been sent. Nothing else was clicked and the judge did not run; check the mailbox and the platform before any new attempt. ${prepared.summary}`.trim(),
    problems: prepared.problems,
    findings: [],
  });
} else if (!prepared.ok) {
  // `gate` a été sauté (`when:`), donc `decide` a dit proceed: false et `submit` n'a pas tourné.
  conclude({
    ok: false,
    status: 'unconverged',
    submitted: false,
    summary: `Checks still failing after ${prepared.tries} round(s); the judge did not run. The form was not sent and no go was asked. ${prepared.summary}`.trim(),
    problems: prepared.problems,
    findings: [],
  });
} else if (decision?.path === 'rejected') {
  // Refus au go : `submit` est sauté (`when: proceed`), ni reçu ni juge.
  const answer = (decision.text ?? '').trim();
  conclude({
    ok: false,
    status: 'refused',
    submitted: false,
    summary: `Refused at the go: nothing was sent. ${answer === '' ? 'No reason given.' : answer}`,
    problems: [],
    findings: [],
  });
} else if (decision?.proceed === true && own !== null && own.held !== true) {
  // La garde `own` : l'offre n'est plus tenue par la prise de l'appelant ; `arm` et `submit`
  // sont sautés. Un `submit` déjà démarré dans ce run (reprise) a peut-être cliqué : jamais
  // « pas envoyé » dans ce cas.
  const started = (own.evidence ?? []).length > 0;
  conclude({
    ok: false,
    status: started ? 'unproven' : 'superseded',
    submitted: started,
    summary: started
      ? `A submit attempt already started earlier in this run, and the offer is no longer held by its claim: nothing was clicked again; the application may have been sent. Check the mailbox and the platform before any new attempt. ${own.reason}`.trim()
      : own.reason.startsWith('Not sent:')
        ? own.reason
        : `Not sent: ${own.reason}`,
    problems: started ? own.evidence : [],
    findings: [],
  });
} else if (decision?.proceed === true && arm !== null && arm.clear !== true) {
  // Reprise après une erreur survenue une fois `submit` démarré : `arm` a trouvé armed.json
  // (ou click.json, receipt.json…) et `submit` est sauté ; ni reçu ni juge. Le premier passage
  // a peut-être cliqué : envoi possible, jamais « pas envoyé ».
  conclude({
    ok: false,
    status: 'unproven',
    submitted: true,
    summary: `A submit attempt already started earlier in this run (it was resumed after an error), so nothing was clicked again; the application may have been sent. Check the mailbox and the platform before any new attempt. ${arm.reason}`.trim(),
    problems: arm.evidence ?? [],
    findings: [],
  });
} else if (receipt === null) {
  fail(`verdict: check_receipt returned no output (decision: ${decision?.path ?? 'none'})`);
} else {
  const approved = flag(process.env.INPUTS_APPROVED);
  const ok = receipt.ok && approved;
  const status = ok ? 'verified' : receipt.submitted ? 'unproven' : 'rejected';
  const lead = ok
    ? `Application sent and confirmed (${receipt.confirmation}).`
    : receipt.submitted
      ? 'The submit control was clicked but the receipt does not prove the application was received: check the mailbox and the platform.'
      : 'The application was not sent.';
  conclude({
    ok,
    status,
    submitted: receipt.submitted,
    summary: `${lead} ${receipt.summary} Judge: ${text(process.env.INPUTS_REASON)}`.trim(),
    problems: receipt.problems,
    findings: (nullableJson(process.env.INPUTS_FINDINGS) as unknown[] | null) ?? [],
  });
}
