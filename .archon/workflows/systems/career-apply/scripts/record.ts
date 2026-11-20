/**
 * Clôt le run côté Master Plan : écrit D'ABORD le statut dans `pending_gold_jobs.json`
 * (écriture atomique), puis recopie le dossier vérifié dans `applications/<slug>/` sous les
 * noms que le bot Telegram lit, dépose le reçu et ajoute une ligne à `applications_log.csv`.
 * Le statut passe avant les copies : un fichier verrouillé (un PDF ouvert sous Windows) ne
 * doit jamais laisser une candidature envoyée en APPLYING, que le listener clôturerait en
 * APPLY_FAILED ; chaque copie ou écriture du journal qui échoue est rattrapée et citée dans le
 * résumé, jamais une exception.
 *
 * L'issue est dérivée par `outcome()` (pur, testé dans `systems/.shared/career.test.ts`) des
 * verdicts des étapes : un bloc `unconverged` clôt l'offre (`cv-tailor` → APPLY_FAILED,
 * `apply-submit` → TAILORED) au lieu de la remettre en file, un refus au go donne TAILORED,
 * et rien n'est dit envoyé sans `submitted: true`, sauf quand apply-submit n'a rendu aucun
 * verdict : `record` lit alors `submission/` (decision.json, armed.json, click.json,
 * prefill.json, receipt.json, receipt.png : `clickEvidence`) et écrit APPLY_UNPROVEN s'il y a
 * trace d'un clic possible. Le statut n'est écrit que si `mayRecord` le permet (l'offre est
 * encore tenue par CETTE prise, `holdsClaim` ; jamais un statut envoyé
 * rétrogradé ni une validation plus récente écrasée), puis calculé par `recordStatus` (compteur
 * de passages : un retour en file au 3e passage devient APPLY_FAILED ; un run lancé à la main
 * sur une offre qu'il n'a pas prise VALIDATED y réécrit son statut d'avant, `applying.from`,
 * au lieu de la mettre en file). Le dossier n'est
 * recopié que si `cv-tailor` a rendu `ok: true`.
 *
 * Le statut s'écrit sous le verrou du tableau (`updateBoard`, `.shared/pending.ts`, partagé
 * avec le listener et la synchronisation VM), et l'issue est d'abord sauvée dans
 * `$ARTIFACTS_DIR/record.json`.
 *
 * `record` ne tourne pas si une étape qu'il lie a échoué (Archon ne lit jamais un nœud en
 * échec) : le filet clôt alors l'offre (`settle` de ce workflow pour un run lancé à la main,
 * `settle` du listener sinon). Quand il tourne sans pouvoir écrire le statut (fichier
 * illisible ou verrouillé), `status_written: false` : le filet l'écrit à sa place si l'offre
 * est encore APPLYING par cette prise (`close` du listener, ou `settle` depuis record.json).
 *
 * Liaisons : INPUTS_SLUG, INPUTS_CAREER_DIR, INPUTS_CLAIM_RUN (la prise que ce run tient,
 * sortie `claim_run` de `load` : le run du listener, ou ce run lancé à la main ; vide si `load`
 * n'a rien pris, et rien ne s'écrit), INPUTS_LOAD, INPUTS_CV (le verdict de CV qui compte,
 * nœud `cv` : celui de la ronde de révision `tailor2` s'il a tourné, sinon celui de `tailor`,
 * `revised` compris ; `status: none` quand aucun des deux n'a rendu de verdict), INPUTS_LETTER
 * (de même, la lettre qui compte, nœud `letter_pick`), INPUTS_RENDER,
 * INPUTS_RENDER_CV (le rendu du CV seul en mode `cv-only`), INPUTS_MODE, INPUTS_ROUTE, INPUTS_SUBMIT (sorties typées, null si l'étape a été sautée ou si le bloc n'a
 * pas rendu de verdict après une erreur).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CvChoice, type StageOutputs, type VerdictChoice, applicationFileNames, clickEvidence, findJob, letterNote as noteOnLetter, mayRecord, outcome, recordStatus } from '../../.shared/career.ts';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';
import { boardPathIn, readSubmission, updateBoard } from '../../.shared/pending.ts';

const slug = text(process.env.INPUTS_SLUG).trim();
const careerDir = text(process.env.INPUTS_CAREER_DIR).trim();
const claimRun = text(process.env.INPUTS_CLAIM_RUN).trim();
const run = process.env.WORKFLOW_ID ?? '';
// Le nœud `cv` rend `status: none` quand aucune ronde de cv-tailor n'a rendu de verdict : ici
// comme un bloc sans verdict (null), ce que `outcome` lit tel quel.
const cv = nullableJson(process.env.INPUTS_CV) as CvChoice | null;
const stages: StageOutputs = {
  load: nullableJson(process.env.INPUTS_LOAD) as StageOutputs['load'],
  tailor: cv === null || cv.status === 'none' ? null : cv,
  // `cv-only` : le rendu du CV seul (`render_cv`) tient la place de `render`, sauté.
  render: (nullableJson(process.env.INPUTS_RENDER) ?? nullableJson(process.env.INPUTS_RENDER_CV)) as StageOutputs['render'],
  route: nullableJson(process.env.INPUTS_ROUTE) as StageOutputs['route'],
  submit: nullableJson(process.env.INPUTS_SUBMIT) as StageOutputs['submit'],
};
// La lettre qui compte (nœud `letter_pick` : `letter2` s'il a tourné, sinon `letter`) : jamais
// bloquante, son issue est seulement citée (`letterNote`, pur), et une lettre non vérifiée
// n'est pas recopiée dans applications/<slug>/ (seul le CV y part).
const letter = nullableJson(process.env.INPUTS_LETTER) as Partial<VerdictChoice> | null;
const letterNote = noteOnLetter(letter);
const letterVerified = letter?.ok === true && letter.status === 'verified';
// Le dossier vient de la ronde de révision : dit dans le résumé (l'issue négative le dit déjà via `outcome`).
const cvNote = stages.tailor?.ok && stages.tailor.revised === true ? ' CV: second version, after the Reviewer\'s findings on the first (après révision).' : '';
const artifacts = artifactsDir();
const submission = join(artifacts, 'submission');
const evidence = stages.submit === null ? clickEvidence(readSubmission(submission)) : [];
const cvOnly = text(process.env.INPUTS_MODE).trim() === 'cv-only';
const result = outcome(stages, evidence, cvOnly);
const errors: string[] = [];
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ── 1. Le statut, d'abord ────────────────────────────────────────────────────────────
// L'issue est d'abord sauvée dans record.json : si l'écriture du tableau échoue, le filet
// (`settle` de career-apply pour une prise de ce run, `close` puis `settle` du listener) écrit
// ce statut-là, jamais APPLY_FAILED sur une candidature envoyée.
try {
  writeFileSync(join(artifacts, 'record.json'), JSON.stringify({ ...result, claim_run: claimRun, at: new Date().toISOString() }, null, 2), 'utf8');
} catch (err) {
  errors.push(`record.json could not be saved (${errorText(err)})`);
}
const pendingPath = boardPathIn(careerDir);
let statusWritten = false;
let status: string = result.status;
let summary = result.summary;
let notWritten = 'pending_gold_jobs.json unavailable';
if (existsSync(pendingPath)) {
  try {
    // Sous le verrou du tableau, relu juste avant d'écrire ; l'écriture est refaite sur EPERM / EBUSY.
    const written = updateBoard(pendingPath, 'career-apply record', (jobs) => {
      const job = findJob(jobs, slug);
      if (job === null) {
        notWritten = `offer ${slug} not found in pending_gold_jobs.json`;
        return { jobs: null, value: null };
      }
      const allowed = mayRecord(job, result.status, run, claimRun);
      if (!allowed.allowed) {
        notWritten = `left as ${String(job.status)}: ${allowed.reason}`;
        return { jobs: null, value: null };
      }
      // Seuls `status` et `harness` changent : jamais `validated_at` ni les autres champs du bot.
      const next = recordStatus(job, result, run, new Date());
      job.status = next.status;
      // La page employeur trouvée : le cockpit l'ouvre dans le navigateur du robot (compte à créer, Antoine, 2026-10-24).
      const applyUrl = typeof stages.route?.apply_url === 'string' && /^https:\/\//i.test(stages.route.apply_url) ? stages.route.apply_url : '';
      job.harness = applyUrl === '' ? next.harness : { ...next.harness, apply_url: applyUrl };
      job.applying = undefined;
      return { jobs, value: next };
    });
    if (written !== null) {
      statusWritten = true;
      status = written.status;
      summary = written.summary;
    }
  } catch (err) {
    notWritten = `pending_gold_jobs.json could not be written (${errorText(err)})`;
  }
}

// ── 2. Le dossier, recopié pour le bot (chaque échec est cité, aucun n'arrête record) ─
const appSrc = join(artifacts, 'application');
const appDir = join(careerDir, 'applications', slug);
const copied: string[] = [];
const copy = (from: string, to: string): void => {
  try {
    copyFileSync(from, to);
    copied.push(to.slice(appDir.length + 1));
  } catch (err) {
    errors.push(`copy to applications/${slug}/${to.slice(appDir.length + 1)} failed (${errorText(err)})`);
  }
};

if (stages.tailor?.ok && existsSync(appSrc)) {
  try {
    mkdirSync(appDir, { recursive: true });
    let name = 'Candidat';
    try {
      const candidate = JSON.parse(readFileSync(join(appSrc, 'candidate.json'), 'utf8')) as { name?: string };
      if (typeof candidate.name === 'string' && candidate.name.trim() !== '') name = candidate.name;
    } catch {
      name = 'Candidat';
    }
    const names = applicationFileNames(name, slug);
    const pairs: [string, string][] = [
      ['CV.md', names.cv],
      ['CV.pdf', names.pdf],
      ['pitch.md', names.pitch],
      ...(letterVerified
        ? ([
            ['letter.md', names.letter],
            ['letter.pdf', names.letterPdf],
          ] as [string, string][])
        : []),
      ['candidate.json', 'candidate.json'],
    ];
    for (const [from, to] of pairs) {
      if (existsSync(join(appSrc, from))) copy(join(appSrc, from), join(appDir, to));
    }
    let offer: Record<string, unknown> = {};
    try {
      offer = JSON.parse(readFileSync(join(artifacts, 'offer.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      offer = {};
    }
    try {
      writeFileSync(
        join(appDir, names.contact),
        JSON.stringify({ company: offer.company ?? '', job_title: offer.title ?? '', target_role: offer.target_role ?? '', link: offer.link ?? '', generated_at: new Date().toISOString().slice(0, 10), generated_by: 'harness career-apply' }, null, 2),
        'utf8'
      );
      copied.push(names.contact);
    } catch (err) {
      errors.push(`write applications/${slug}/${names.contact} failed (${errorText(err)})`);
    }
    if (existsSync(join(submission, 'receipt.json'))) copy(join(submission, 'receipt.json'), join(appDir, names.receipt));
    for (const shot of ['prefill.png', 'receipt.png']) {
      if (existsSync(join(submission, shot))) copy(join(submission, shot), join(appDir, shot));
    }
  } catch (err) {
    errors.push(`applications/${slug}/ could not be prepared (${errorText(err)})`);
  }
}

// ── 3. Le journal ────────────────────────────────────────────────────────────────────
// Sans dossier carrière (chemin faux, ou fixture), rien à journaliser : l'issue reste typée
// (status_written: false) au lieu d'un nœud en échec sur ENOENT.
if (careerDir !== '' && existsSync(careerDir)) {
  try {
    const logPath = join(careerDir, 'applications_log.csv');
    const line = [new Date().toISOString(), slug, status, result.stage, run, summary.replace(/[\r\n,]+/g, ' ')].join(',');
    writeFileSync(logPath, `${existsSync(logPath) ? readFileSync(logPath, 'utf8') : 'at,slug,status,stage,run,summary\n'}${line}\n`, 'utf8');
  } catch (err) {
    errors.push(`applications_log.csv could not be written (${errorText(err)})`);
  }
}

const problems = errors.length > 0 ? ` Not done: ${errors.join('; ')}.` : '';
emit({
  ok: result.ok,
  stage: result.stage,
  status,
  status_written: statusWritten,
  app_dir: copied.length > 0 ? appDir : '',
  copied,
  summary: `${summary} Status ${status}${statusWritten ? '' : ` (not written: ${notWritten})`}.${cvNote}${letterNote}${problems}`,
});
