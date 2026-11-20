/**
 * Règles pures du système `career-apply` : lire une offre dans `pending_gold_jobs.json`,
 * en dériver les mots-clés, nommer les fichiers que le bot Telegram attend, dériver l'issue du
 * run (et le statut de l'offre) des verdicts des blocs, `unconverged` et `refused` compris, des
 * preuves de clic quand apply-submit n'a rien rendu, et borner les retours en file (compteur
 * de passages) ; les rondes de révision du CV et de la lettre (le brief remis au Drafter après
 * un refus du Reviewer, `revisionBrief`, et le verdict qui compte ensuite, `pickVerdict`, dont
 * `pickCv` est le cas cv-tailor). Testé à l'unité ; les scripts font les E/S.
 */

export interface PendingJob {
  id?: string;
  slug: string;
  company: string;
  title: string;
  link: string;
  skills_required?: string;
  matched_skills?: string;
  description?: string;
  hook_angle?: string;
  target_role?: string;
  status: string;
  [key: string]: unknown;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function findJob(jobs: unknown, slug: string): PendingJob | null {
  if (!Array.isArray(jobs)) return null;
  const wanted = slug.trim().toLowerCase();
  const job = jobs.find((entry) => entry && typeof entry === 'object' && String((entry as PendingJob).slug ?? '').toLowerCase() === wanted);
  return (job as PendingJob | undefined) ?? null;
}

/**
 * Mots-clés ATS : skills_required ∪ matched_skills, dédoublonnés, entités décodées.
 * `hook_angle` n'en fait pas partie : c'est l'angle que le jury suggère, écrit en français pour
 * Antoine ; exigé mot à mot, il finissait collé tel quel dans un CV anglais (test du 22 octobre,
 * juge : « machine-stuffed »). Le bloc le reçoit dans l'offre (`hook_angle`) comme consigne.
 *
 * Avec `posting` (titre + annonce), un mot-clé n'est gardé que s'il y figure (phrase entière, ou
 * chacun de ses mots) : `skills_required` posé par le radar LinkedIn est la requête de la
 * taxonomie qui a fait remonter l'annonce (« chargé de revops »), pas un mot de l'annonce ;
 * exigé dans un CV anglais, il faisait échouer cv-tailor trois tours de suite (Smartness, 23/10).
 * Un mot-clé qui n'est pas dans l'annonce n'est pas un mot-clé ATS.
 */
export function deriveKeywords(job: Pick<PendingJob, 'skills_required' | 'matched_skills'>, posting?: string): string[] {
  const raw = [job.skills_required ?? '', job.matched_skills ?? ''].join(',');
  const seen = new Set<string>();
  const out: string[] = [];
  const hay = posting === undefined ? null : posting.toLowerCase();
  for (const part of decodeEntities(raw).split(/[,;\n]| et | and /i)) {
    const keyword = part.trim().replace(/^[-–•]\s*/, '');
    if (keyword === '' || keyword.toLowerCase() === 'aucune') continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (hay !== null && !keywordInPosting(key, hay)) continue;
    out.push(keyword);
  }
  return out;
}

const KEYWORD_STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'of', 'the', 'and', 'in', 'for', 'à', 'a', 'd', 'l']);

function wordPattern(word: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

/** Le mot-clé figure dans l'annonce : la phrase entière, ou chacun de ses mots pleins (délimités). */
export function keywordInPosting(keyword: string, postingLower: string): boolean {
  const key = keyword.toLowerCase().trim();
  if (key === '') return false;
  if (wordPattern(key).test(postingLower)) return true;
  const words = key.split(/[^\p{L}\p{N}+#./-]+/u).filter((w) => w !== '' && !KEYWORD_STOPWORDS.has(w));
  return words.length >= 1 && words.every((w) => wordPattern(w).test(postingLower));
}

/** L'offre telle que le bloc cv-tailor la reçoit : champs utiles, entités décodées, annonce lue si on l'a. */
export function offerForBlock(job: PendingJob, descriptionFull: string, keywords: string[]): Record<string, unknown> {
  return {
    id: job.id ?? '',
    company: decodeEntities(job.company ?? ''),
    title: decodeEntities(job.title ?? ''),
    link: job.link ?? '',
    slug: job.slug,
    skills_required: decodeEntities(job.skills_required ?? ''),
    description: decodeEntities(job.description ?? ''),
    description_full: descriptionFull,
    keywords: keywords.join(', '),
    hook_angle: decodeEntities(job.hook_angle ?? ''),
    target_role: job.target_role ?? '',
  };
}

/** Texte lisible d'une page HTML d'annonce : sans scripts, styles ni balises, espaces normalisés, tronqué. */
export function visibleText(html: string, max = 8000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  return decodeEntities(text).slice(0, max);
}

/** Les en-têtes de lecture d'une annonce : la page en anglais quand le site le permet. */
export const POSTING_HEADERS = { 'User-Agent': 'Mozilla/5.0 (harness career-apply)', 'Accept-Language': 'en-GB,en;q=0.9,fr;q=0.8' };

/**
 * L'adresse à lire ou à ouvrir pour une annonce. LinkedIn sert l'offre dans la langue du pays de son
 * sous-domaine (hu.linkedin.com en hongrois, es.linkedin.com en espagnol, vu le 2026-10-24 sur Dana) :
 * la même offre est lue sur www.linkedin.com, dans la langue du navigateur. Le lien du tableau ne change pas.
 */
export function postingUrl(link: string): string {
  return String(link ?? '').replace(/^(https?:\/\/)(?!www\.)[a-z]{2}\.linkedin\.com\//i, 'https://www.linkedin.com/');
}

/**
 * La page employeur derrière une offre LinkedIn « Postuler » hors LinkedIn. La page publique de
 * l'offre la porte, sans connexion, dans `<code id="applyUrl"><!--"…/externalApply/…?url=<page>"--></code>`
 * (lecture faite par JobSpy, MIT). '' quand la balise manque : candidature simplifiée LinkedIn,
 * qui demande une session, ou page d'un autre site.
 */
export function linkedinApplyUrl(html: string): string {
  const code = /<code[^>]*\bid=["']applyUrl["'][^>]*>([\s\S]*?)<\/code>/i.exec(String(html ?? ''))?.[1] ?? '';
  const raw = /[?&]url=([^"&\s]+)/.exec(decodeEntities(code))?.[1] ?? '';
  if (raw === '') return '';
  let url = '';
  try {
    url = decodeURIComponent(raw);
  } catch {
    return '';
  }
  return /^https:\/\/[^\s"<>]+$/i.test(url) && !/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(url) ? url : '';
}

/**
 * Le texte d'une annonce. Une page d'offre LinkedIn porte des milliers de caractères de bandeau
 * (cookies, connexion répétée cinq fois, offres voisines) : seuls le titre, le bloc de description et
 * les critères (niveau, contrat, secteur) sont gardés quand la page les a. Ailleurs : tout le texte visible.
 */
export function postingText(html: string, max = 8000): string {
  const description = /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)(?:<button[^>]*show-more-less-html__button|<\/section>)/i.exec(html)?.[1];
  if (!description) return visibleText(html, max);
  const title = visibleText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '', 300);
  const criteria = /<ul[^>]*class="[^"]*description__job-criteria-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(html)?.[1] ?? '';
  return [title, visibleText(description, max), visibleText(criteria, 1000)].filter(Boolean).join('\n').slice(0, max);
}

/** Les noms de fichiers que `career_bot_engine.js` (Master Plan) lit dans applications/<slug>/. */
export function applicationFileNames(candidateName: string, slug: string): { cv: string; pitch: string; contact: string; receipt: string; pdf: string; letter: string; letterPdf: string } {
  const name = candidateName.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Candidat';
  return {
    cv: `CV_${name}_${slug}.md`,
    pdf: `CV_${name}_${slug}.pdf`,
    pitch: `Message_Accroche_${slug}.md`,
    letter: `Lettre_${name}_${slug}.md`,
    letterPdf: `Lettre_${name}_${slug}.pdf`,
    contact: 'interlocuteur_cible.json',
    receipt: 'submission_receipt.json',
  };
}

/**
 * Verdict typé d'un bloc (`cv-tailor`, `apply-submit`). `status: unconverged` : ses contrôles
 * étaient encore rouges à son dernier tour permis ; sa boucle a rendu la main au plafond
 * (compteur `tries`) et son juge n'a pas tourné ; son résumé commence déjà par « Checks still
 * failing after N round(s) ». `status: refused` (apply-submit) : l'humain a refusé au go, rien
 * n'est parti ; son résumé commence par « Refused at the go: nothing was sent. ».
 * `status: superseded` (apply-submit) : juste avant le clic, l'offre n'était plus tenue par la
 * prise de ce run ; rien n'est parti ; son résumé commence par « Not sent: ». Un verdict
 * null (`if_skipped: null`) veut dire qu'un de ses nœuds a échoué (erreur du modèle ou d'un
 * script), jamais « pas convergé » ni « refusé ».
 */
export interface BlockVerdict {
  ok: boolean;
  status?: string;
  summary: string;
  submitted?: boolean;
  problems?: string[];
  /** Verdict de cv-tailor après la ronde de révision de career-apply (`pickCv`) : l'issue vient du second passage. */
  revised?: boolean;
}
export interface StageOutputs {
  /**
   * `posting` : le verdict de la garde d'annonce (`posting-guard.ts`) que `load` rend
   * (`ok`, `expirée`, `suspecte`, `non lue`) ; absent chez les appelants d'avant la garde.
   */
  load: { ok: boolean; summary: string; posting?: string } | null;
  tailor: BlockVerdict | null;
  render: { ok: boolean; summary: string } | null;
  route: { ok: boolean; summary: string; apply_url?: string } | null;
  submit: BlockVerdict | null;
}
export type Stage = 'load' | 'tailor' | 'render' | 'route' | 'submit' | 'done';
export type JobStatus = 'VALIDATED' | 'TAILORED' | 'APPLIED' | 'APPLY_UNPROVEN' | 'APPLY_FAILED';
export interface Outcome {
  ok: boolean;
  stage: Stage;
  status: JobStatus;
  summary: string;
}

/** Les derniers problèmes d'un verdict, pour que le résumé écrit dans Master Plan dise pourquoi. */
function lastProblems(verdict: BlockVerdict): string {
  const problems = (verdict.problems ?? []).filter((problem) => typeof problem === 'string' && problem.trim() !== '');
  return problems.length > 0 ? ` Last problems: ${problems.slice(0, 3).join('; ')}.` : '';
}

// ── Les rondes de révision (career-apply : tailor → revise_brief → tailor2 → cv, et
//    letter → revise_letter_brief → letter2 → letter_pick) ──────────────────────────────

/** Un constat du Reviewer d'un bloc (`findings` du verdict). */
export interface Finding {
  severity: string;
  text: string;
}
/** Le pointeur d'artefact que le bloc rend (cv-tailor : CV.md ; cover-letter : letter.md). */
export interface Deliverable {
  type: string;
  run_id: string;
  path: string;
}
/** Le verdict d'un bloc révisable (cv-tailor, cover-letter) tel que career-apply le lit : `findings` et `deliverable` compris. */
export interface CvBlockVerdict extends BlockVerdict {
  findings?: Finding[];
  deliverable?: Deliverable | null;
}
export type CvStatus = 'verified' | 'rejected' | 'unconverged' | 'none';
/** La sortie d'un nœud de choix (`cv`, `letter_pick`) : la forme du verdict du bloc, plus `revised`, ou `status: none` sans aucun verdict. */
export interface VerdictChoice {
  ok: boolean;
  status: CvStatus;
  summary: string;
  problems: string[];
  findings: Finding[];
  deliverable: Deliverable | null;
  revised: boolean;
}
/** Le choix du verdict de CV (nœud `cv`) : un `VerdictChoice` de cv-tailor. */
export type CvChoice = VerdictChoice;

/**
 * Ce qu'une ronde de révision réécrit : le bloc rejoué (nommé dans les résumés) et ses
 * fichiers (nommés dans le brief, et copiés dans `<out_dir>-v1/` avant la réécriture).
 */
export interface RevisionTarget {
  block: string;
  files: string[];
}
export const CV_REVISION: RevisionTarget = { block: 'cv-tailor', files: ['CV.md', 'pitch.md', 'candidate.json'] };
export const LETTER_REVISION: RevisionTarget = { block: 'cover-letter', files: ['letter.md', 'letter.html'] };
/** La cible d'une ronde par le nom du bloc (`cv-tailor` par défaut : l'entrée vide de `revise_brief`). */
export function revisionTarget(block: string): RevisionTarget {
  return block.trim() === LETTER_REVISION.block ? LETTER_REVISION : CV_REVISION;
}

/** Longueur maximale des remarques remises au Drafter pour la seconde ronde. */
export const REVISION_BRIEF_MAX = 4000;
export const REVISION_HEADER = 'Reviewer findings on the previous version (fix every blocking one, honour the minor ones; never invent facts the profile does not state):';
const REMARKS_SHARE = 1500;
const FINDING_MAX = 500;

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 2)).trimEnd()} […]`;
}

/** Les constats exploitables d'un verdict : texte non vide, bloquants d'abord (ordre du Reviewer conservé ensuite). */
export function usableFindings(findings: unknown): Finding[] {
  if (!Array.isArray(findings)) return [];
  const clean = findings
    .filter((f): f is Finding => f !== null && typeof f === 'object' && typeof (f as Finding).text === 'string' && (f as Finding).text.trim() !== '')
    .map((f) => ({ severity: f.severity === 'blocking' ? 'blocking' : 'minor', text: f.text.trim() }));
  return [...clean.filter((f) => f.severity === 'blocking'), ...clean.filter((f) => f.severity !== 'blocking')];
}

/** La partie « Reviewer: <note> — <motif> » du résumé du verdict, vide si elle n'y est pas. */
export function reviewerLine(summary: string): string {
  const m = /Reviewer:\s*(.+)$/s.exec(summary ?? '');
  return m ? m[1]!.trim() : '';
}

/**
 * Le brief de la seconde ronde d'un bloc (cv-tailor par défaut, cover-letter avec
 * `LETTER_REVISION`), quand le Reviewer a refusé un livrable aux contrôles verts : les remarques du candidat d'abord (telles quelles, puisqu'elles priment),
 * puis les constats du Reviewer numérotés avec leur gravité, bloquants d'abord, puis où
 * retrouver la version précédente. Borné à `max` caractères : les remarques du candidat ont
 * une part réservée, un constat trop long est coupé, les constats qui ne tiennent pas sont
 * comptés. `ok: false` (rien à réviser) si le verdict n'est pas un refus du Reviewer :
 * `unconverged` a déjà épuisé ses tours, `verified` n'a rien à corriger, `null` n'a rien dit.
 */
export function revisionBrief(remarks: string, verdict: CvBlockVerdict | null, outDir = 'application', max = REVISION_BRIEF_MAX, target: RevisionTarget = CV_REVISION): { ok: boolean; remarks: string; summary: string } {
  const own = (remarks ?? '').trim();
  if (verdict === null || verdict.status !== 'rejected') {
    const why = verdict === null ? `${target.block} returned no verdict` : `the verdict is ${String(verdict.status ?? 'unknown')}, not rejected`;
    return { ok: false, remarks: own, summary: `No revision round: ${why}.` };
  }
  const findings = usableFindings(verdict.findings);
  const reviewer = reviewerLine(verdict.summary);
  const lines: string[] = [];
  if (own !== '') lines.push(clip(own, Math.min(REMARKS_SHARE, max)), '');
  lines.push(REVISION_HEADER);
  if (reviewer !== '') lines.push(`Overall verdict: ${clip(reviewer, FINDING_MAX)}`);
  // Les fichiers que l'agent écrit lui-même (letter.html est mis en page par le contrôle).
  const written = target.files.filter((f) => !f.endsWith('.html'));
  const footer =
    written.length > 1
      ? `The previous version (${written.join(', ')}) is still in \`${outDir}/\`: start from it, keep what was right, and rewrite the ${written.length === 3 ? 'three' : String(written.length)} files.`
      : `The previous version (${written[0] ?? 'the deliverable'}) is still in \`${outDir}/\`: start from it, keep what was right, and rewrite it.`;
  const budget = max - footer.length - 2;
  let shown = 0;
  for (const [i, f] of findings.entries()) {
    const line = `${i + 1}. [${f.severity}] ${clip(f.text, FINDING_MAX)}`;
    const omitted = findings.length - shown - 1;
    const tail = omitted > 0 ? `\n(${omitted} more finding(s) not shown)`.length : 0;
    if ([...lines, line].join('\n').length + tail > budget) break;
    lines.push(line);
    shown++;
  }
  if (findings.length === 0) lines.push('(no itemised finding: fix what the overall verdict names)');
  else if (shown < findings.length) lines.push(`(${findings.length - shown} more finding(s) not shown)`);
  lines.push('', footer);
  const text = lines.join('\n').slice(0, max);
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  return { ok: true, remarks: text, summary: `Revision round: ${shown}/${findings.length} Reviewer finding(s) passed to the Drafter (${blocking} blocking)${own !== '' ? ', after the candidate\'s own remarks' : ''}.` };
}

/**
 * Le verdict qui compte pour la suite du run : celui de la seconde ronde (`tailor2`,
 * `letter2`) quand elle a rendu un verdict, sinon celui de la première (`tailor`, `letter`). `attempted` dit que la
 * seconde ronde a été lancée (le brief de révision a rendu ok) : si elle n'a rendu aucun
 * verdict (un de ses nœuds a échoué), le premier refus reste l'issue, et le résumé le dit.
 * Sans aucun verdict : `status: none`, que `outcome` lit comme un bloc sans verdict.
 */
export function pickVerdict(first: CvBlockVerdict | null, second: CvBlockVerdict | null, attempted = second !== null, block = 'cv-tailor'): VerdictChoice {
  const chosen = second ?? first;
  if (chosen === null) {
    return { ok: false, status: 'none', summary: `${block} returned no verdict.`, problems: [], findings: [], deliverable: null, revised: false };
  }
  const revised = second !== null;
  const status = (['verified', 'rejected', 'unconverged'] as const).find((s) => s === chosen.status) ?? 'none';
  const lost = attempted && second === null ? ' The revision round returned no verdict (one of its nodes failed): the first verdict stands.' : '';
  return {
    ok: chosen.ok === true && status !== 'none',
    status,
    summary: `${chosen.summary}${lost}`,
    problems: Array.isArray(chosen.problems) ? chosen.problems.filter((p): p is string => typeof p === 'string') : [],
    findings: usableFindings(chosen.findings),
    deliverable: chosen.deliverable ?? null,
    revised,
  };
}

/** Le verdict de CV qui compte (nœud `cv`) : `pickVerdict` pour cv-tailor. */
export function pickCv(first: CvBlockVerdict | null, second: CvBlockVerdict | null, attempted = second !== null): CvChoice {
  return pickVerdict(first, second, attempted, 'cv-tailor');
}

/**
 * La note sur la lettre dans le résumé de `record` : la lettre n'arrête jamais la
 * candidature, son issue est seulement citée. `null` (lettre sautée) : rien.
 */
export function letterNote(letter: { status?: string; summary?: string; revised?: boolean } | null): string {
  if (letter === null) return '';
  const revised = letter.revised === true ? ', second version after the Reviewer\'s findings on the first (après révision)' : '';
  if (letter.status === 'verified') return ` Letter: verified${revised}.`;
  return ` Letter ${letter.status ?? 'unknown'}${letter.revised === true ? ' après révision' : ''} (not attached): ${(letter.summary ?? '').slice(0, 200)}`;
}

// ── Preuves d'un clic quand apply-submit n'a pas rendu de verdict ─────────────────────

/**
 * Ce qu'apply-submit laisse dans son `out_dir` (`submission/` chez career-apply), lu par
 * `record` : texte brut de chaque JSON (null s'il est absent) et présence de la capture.
 * - `decision.json` : écrit par `decide` (script) avant `submit`, `proceed: true` quand le
 *   clic est autorisé ;
 * - `armed.json` : écrit par `arm` (script) juste avant que `submit` démarre ;
 * - `click.json` : écrit par l'agent `submit` juste avant de cliquer ;
 * - `prefill.json` : écrit par l'agent `prefill`, `submitted: true` s'il dit avoir envoyé ;
 * - `receipt.json`, `receipt.png` : écrits par l'agent `submit` après le clic (ou
 *   `submitted: false` quand il n'a pas cliqué). `check_receipt` ne fait que les lire.
 * `armed` et `click` sont facultatifs (absents : null) pour les appelants d'avant le verrou.
 */
export interface SubmissionFiles {
  decision: string | null;
  armed?: string | null;
  click?: string | null;
  prefill: string | null;
  receipt: string | null;
  receiptScreenshot: boolean;
}

function parseObject(raw: string | null): Record<string, unknown> | null | 'unreadable' {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * Les indices qu'un clic a pu avoir lieu, pour un apply-submit sans verdict. Prudent : dans le
 * doute, c'est un indice (un « peut-être parti » fait vérifier la boîte mail ; un « pas parti »
 * à tort fait postuler deux fois). Vide : rien n'a été autorisé ni cliqué.
 */
export function clickEvidence(files: SubmissionFiles): string[] {
  const evidence: string[] = [];
  const decision = parseObject(files.decision);
  if (decision === 'unreadable') evidence.push('decision.json is unreadable');
  else if (decision?.proceed === true) evidence.push(`decision.json says the submit step was cleared to click (path ${String(decision.path ?? '?')})`);
  // Présents, même illisibles, ils comptent : `arm` écrit armed.json juste avant que `submit`
  // démarre, l'agent écrit click.json juste avant de cliquer.
  const armed = parseObject(files.armed ?? null);
  if (armed !== null) evidence.push(`armed.json says the submit step started${armed !== 'unreadable' && typeof armed.at === 'string' && armed.at !== '' ? ` at ${armed.at}` : ''}`);
  const click = parseObject(files.click ?? null);
  if (click !== null) evidence.push(`click.json says the submit agent was about to click${click !== 'unreadable' && typeof click.at === 'string' && click.at !== '' ? ` at ${click.at}` : ''}`);
  const receipt = parseObject(files.receipt);
  if (receipt === 'unreadable') evidence.push('receipt.json exists but is unreadable');
  else if (receipt !== null) {
    if (receipt.submitted === true) evidence.push('receipt.json says submitted: true');
    else if (receipt.submitted !== false) evidence.push('receipt.json exists without submitted: false');
    else if (typeof receipt.clicked_at === 'string' && receipt.clicked_at.trim() !== '') evidence.push(`receipt.json records a click at ${receipt.clicked_at}`);
  }
  if (files.receiptScreenshot) evidence.push('receipt.png (taken after the click) exists');
  const prefill = parseObject(files.prefill);
  if (prefill !== 'unreadable' && prefill?.submitted === true) evidence.push('prefill.json says the form was already submitted during prefill');
  return evidence;
}

/**
 * Où le run s'est arrêté, le statut à écrire dans pending_gold_jobs.json, et le résumé.
 *
 * `VALIDATED` remet l'offre dans la file du listener (il la reprend au tour suivant) : ce
 * statut ne sert qu'aux arrêts qu'un nouveau passage peut lever (offre non lue, dossier
 * refusé par le Reviewer, cv-tailor sans verdict après une erreur), et `recordStatus` le
 * borne à MAX_ATTEMPTS passages. Un bloc `unconverged` a déjà épuisé ses tours : le relancer
 * referait la même chose, alors il clôt l'offre :
 * - `cv-tailor` unconverged → `APPLY_FAILED` (aucun dossier vérifié, rien copié ni envoyé ;
 *   `/valider` la remet en file après une `/remarque` ou une retouche du profil) ;
 * - `apply-submit` unconverged → `TAILORED` (dossier vérifié et PDF prêts, formulaire jamais
 *   envoyé, aucun go demandé : l'humain reprend la main, CAPTCHA ou mur de connexion compris).
 * Une annonce que la garde de `load` a lue expirée (`posting: expirée`) → `APPLY_FAILED`, au
 * stage `load` : la relire au passage suivant dirait la même chose.
 * Un refus au go (`apply-submit` refused) → `TAILORED` : rien n'est parti, le listener ne
 * reprend jamais une offre TAILORED, l'humain décide. Une offre qui n'était plus tenue par
 * cette prise juste avant le clic (`apply-submit` superseded) → `TAILORED` aussi, rien n'est
 * parti, et `mayRecord` ne l'écrit pas. Une candidature n'est dite envoyée
 * (`APPLIED`, `APPLY_UNPROVEN`) que si `apply-submit` rend `submitted: true`, ou, quand il n'a
 * rendu aucun verdict, si `submission/` montre qu'un clic a pu avoir lieu (`evidence`, voir
 * `clickEvidence`) : `APPLY_UNPROVEN`, jamais « prêt, pas envoyé ».
 */
/**
 * `cvOnly` (mode `cv-only`, bouton « CV sur mesure » du radar Telegram) : après un CV vérifié
 * et rendu en PDF, l'issue est TAILORED, `stage: done`, rien n'a été cherché ni envoyé.
 */
export function outcome(stages: StageOutputs, evidence: string[] = [], cvOnly = false): Outcome {
  if (!stages.load?.ok) {
    // La garde d'annonce de `load` a lu une annonce close : un nouveau passage relirait la même
    // page, alors l'offre est close (APPLY_FAILED, que `/valider` remet en file si l'annonce vit
    // encore), jamais remise en file ; rien n'a été adapté ni envoyé.
    if (stages.load?.posting === 'expirée') return { ok: false, stage: 'load', status: 'APPLY_FAILED', summary: stages.load.summary };
    return { ok: false, stage: 'load', status: 'VALIDATED', summary: stages.load?.summary ?? 'Offer not loaded.' };
  }
  const tailor = stages.tailor;
  if (tailor === null || tailor.status === 'none') {
    return { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV not produced: cv-tailor returned no verdict (one of its nodes failed: a model or script error, so its verdict was skipped).' };
  }
  if (!tailor.ok) {
    // Après la ronde de révision (`revised`), un second refus ou une seconde ronde pas
    // convergée est la même issue que la première, et le résumé le dit (« après révision »).
    const revised = tailor.revised === true ? ' après révision' : '';
    if (tailor.status === 'unconverged') {
      return { ok: false, stage: 'tailor', status: 'APPLY_FAILED', summary: `CV did not converge${revised}: ${tailor.summary} Nothing was rendered or sent.${lastProblems(tailor)}` };
    }
    return { ok: false, stage: 'tailor', status: 'VALIDATED', summary: `CV rejected${revised}: ${tailor.summary}` };
  }
  if (!stages.render?.ok) return { ok: false, stage: 'render', status: 'TAILORED', summary: stages.render ? `PDF not rendered: ${stages.render.summary}` : 'PDF not rendered.' };
  if (cvOnly) return { ok: true, stage: 'done', status: 'TAILORED', summary: `CV only (cv-only): CV verified and rendered, no letter, nothing sent. ${stages.render.summary}`.trim() };
  if (!stages.route?.ok) return { ok: false, stage: 'route', status: 'TAILORED', summary: stages.route ? `No application page: ${stages.route.summary}` : 'Application page not resolved.' };
  const submit = stages.submit;
  if (submit === null) {
    if (evidence.length > 0) {
      return {
        ok: false,
        stage: 'submit',
        status: 'APPLY_UNPROVEN',
        summary: `Submission gave no verdict (one of apply-submit's nodes failed: a model or script error), but the application may have been sent: ${evidence.join('; ')}. Check the mailbox and the platform before any new attempt.`,
      };
    }
    return {
      ok: false,
      stage: 'submit',
      status: 'TAILORED',
      summary: "Submission gave no verdict: one of apply-submit's nodes failed (a model or script error) and nothing in submission/ shows a click or a go to click. Check submission/ and the mailbox before sending by hand.",
    };
  }
  if (submit.submitted === true) {
    if (submit.ok) return { ok: true, stage: 'done', status: 'APPLIED', summary: submit.summary };
    return { ok: false, stage: 'submit', status: 'APPLY_UNPROVEN', summary: submit.summary };
  }
  if (submit.status === 'refused') {
    // Le résumé du bloc dit déjà « Refused at the go: nothing was sent. <réponse> ».
    return { ok: false, stage: 'submit', status: 'TAILORED', summary: submit.summary };
  }
  if (submit.status === 'superseded') {
    // La garde `own` a trouvé, juste avant le clic, que l'offre n'était plus tenue par cette
    // prise : rien n'est parti. `mayRecord` refuse alors d'écrire (l'offre n'est plus à ce run).
    return { ok: false, stage: 'submit', status: 'TAILORED', summary: submit.summary };
  }
  if (submit.status === 'unconverged') {
    return { ok: false, stage: 'submit', status: 'TAILORED', summary: `Form did not converge: ${submit.summary}${lastProblems(submit)}` };
  }
  if (submit.ok) {
    return { ok: false, stage: 'submit', status: 'APPLY_FAILED', summary: `apply-submit returned ok without submitted: true; not recorded as sent. ${submit.summary}` };
  }
  return { ok: false, stage: 'submit', status: 'APPLY_FAILED', summary: submit.summary };
}

// ── Le compteur de passages, porté d'une écriture à l'autre ───────────────────────────

/** Plafond des passages de career-apply pour une même validation : au-delà, l'offre ne revient plus en file. */
export const MAX_ATTEMPTS = 3;

/** L'objet `harness` que le harness écrit sur une offre (il ne réécrit jamais les champs du bot). */
export interface JobHarness {
  run?: string;
  stage?: string;
  at?: string;
  summary?: string;
  note?: string;
  /** Passages de career-apply comptés pour la validation `attempts_for`. */
  attempts?: number;
  /** Le `validated_at` (écrit par `/valider`) que le compteur compte. */
  attempts_for?: string;
  /** Run lancé à la main : le statut de l'offre avant sa prise (`applying.from`), réécrit au lieu de VALIDATED. */
  from?: string;
  /** La page de candidature de l'employeur trouvée par la route (le cockpit l'ouvre dans le navigateur du robot). */
  apply_url?: string;
}

function harnessOf(job: PendingJob): JobHarness {
  const value = job.harness;
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JobHarness) : {};
}

function validationOf(job: PendingJob): string {
  return typeof job.validated_at === 'string' ? job.validated_at : '';
}

/**
 * Les passages de career-apply déjà comptés pour la validation en cours. Le compteur est
 * attaché au `validated_at` qu'il compte : un nouveau `/valider` (le bot réécrit
 * `validated_at`) le remet à zéro sans que le harness touche aux champs du bot.
 */
export function attemptsOf(job: PendingJob): number {
  const harness = harnessOf(job);
  const n = typeof harness.attempts === 'number' && Number.isInteger(harness.attempts) && harness.attempts > 0 ? harness.attempts : 0;
  return (harness.attempts_for ?? '') === validationOf(job) ? n : 0;
}

/** Ce que toute écriture de `harness` reporte : le compteur et la validation qu'il compte. */
export function carriedAttempts(job: PendingJob): Pick<JobHarness, 'attempts' | 'attempts_for'> {
  return { attempts: attemptsOf(job), attempts_for: validationOf(job) };
}

/** Les statuts qui disent qu'une candidature est (peut-être) partie : jamais rétrogradés. */
export const SENT_STATUSES: readonly string[] = ['APPLIED', 'APPLY_UNPROVEN'];

/**
 * L'offre est-elle encore tenue par la prise `claimRun` ? Toute prise passe par là : celle du
 * listener (`claim`, son run noté dans `applying.run`) et celle d'un run career-apply lancé à
 * la main (`load` prend l'offre lui-même, `applying.run` = son propre run). Tenue veut dire
 * APPLYING avec `applying.run` = cette prise, et rien d'autre. Une prise que le filet du
 * listener a close (APPLY_FAILED ou APPLY_UNPROVEN : prise périmée de plus de deux heures, ou
 * `settle` après un run en échec) n'est plus tenue : un go approuvé après coup ne clique plus
 * (`superseded`, rien d'envoyé). Sinon, un `/valider` envoyé sur la VM puis un vieux go
 * approuvé sur le PC avant le pull suivant ferait cliquer ce vieux run, et le pull remettrait
 * l'offre en file : le listener postulerait une seconde fois, sans go.
 * Lue par `mayRecord`, par `load` (un run lancé par le listener ne travaille que sur sa prise)
 * et, juste avant le clic, par la garde `own` d'apply-submit (même règle, recopiée dans le bloc
 * et comparée à celle-ci dans `career.test.ts`).
 */
export function holdsClaim(job: PendingJob, claimRun: string): boolean {
  if (claimRun === '') return false;
  const applyingRun = String((job.applying as { run?: unknown } | undefined)?.run ?? '');
  return String(job.status ?? '') === 'APPLYING' && applyingRun === claimRun;
}

/**
 * `record` (ou, à sa place, `close` du listener) peut-il écrire l'issue de ce run sur l'offre ?
 * `run` est le run career-apply (WORKFLOW_ID) ; `claimRun` la prise que ce run tient (sortie
 * `claim_run` de `load`) : le run du listener qui a pris l'offre, ou ce run lui-même quand il
 * a été lancé à la main (`load` prend alors l'offre). Vide : `load` n'a rien pris (offre
 * introuvable, déjà envoyée, ou prise par un autre run) et rien ne s'écrit.
 *
 * Une issue « pas envoyé » (TAILORED, APPLY_FAILED, VALIDATED) ne remplace que :
 * - l'offre encore tenue par CETTE prise (`holdsClaim` : APPLYING par elle) ;
 * - ce que ce même run a déjà écrit (un `record` rejoué), sauf un statut envoyé. Ce que le
 *   filet du listener a écrit (`harness.stage: listener`) n'en est pas, même quand
 *   `harness.run` est ce run (prise d'un run lancé à la main, close par la règle des prises
 *   périmées ou par `settle`) : sinon le TAILORED d'un vieux run refusé ou `superseded`
 *   remplacerait une offre remise en file par un `/valider` plus récent, et le bot refuse
 *   `/valider` sur TAILORED.
 * Jamais une offre remise en file par une validation plus récente (VALIDATED après la
 * clôture de cette prise), jamais une offre prise par un autre run, jamais APPLIED ni
 * APPLY_UNPROVEN : un refus d'un run plus ancien ne rétrograde pas un envoi plus récent.
 *
 * Une issue « envoyé » (APPLIED, APPLY_UNPROVEN) s'écrit partout, sauf sur une offre APPLYING
 * par un autre run (il écrira la sienne), sur APPLIED d'un autre run, et APPLY_UNPROVEN sur
 * APPLY_UNPROVEN d'un autre run. Elle s'écrit donc aussi sur une offre que `/valider` a remise
 * en file pendant que ce run attendait le go : sinon le listener la reprendrait et postulerait
 * une seconde fois (le bot refuse `/valider` sur APPLIED et APPLY_UNPROVEN).
 */
export function mayRecord(job: PendingJob, status: string, run: string, claimRun: string): { allowed: boolean; reason: string } {
  const current = String(job.status ?? '');
  const harness = harnessOf(job);
  const applyingRun = String((job.applying as { run?: unknown } | undefined)?.run ?? '');
  const sameRun = run !== '' && harness.run === run && harness.stage !== 'listener';
  const yes = { allowed: true, reason: '' };
  if (claimRun === '') return { allowed: false, reason: 'this run holds no claim on the offer (load did not take it), so it writes nothing' };
  if (holdsClaim(job, claimRun)) return yes;
  if (current === 'APPLYING') return { allowed: false, reason: `the offer is APPLYING by another run (${applyingRun || 'unknown'}), which records its own status` };
  if (SENT_STATUSES.includes(status)) {
    if (current === 'APPLIED' && !sameRun) return { allowed: false, reason: 'the offer is already APPLIED by another run' };
    if (current === 'APPLY_UNPROVEN' && status === 'APPLY_UNPROVEN' && !sameRun) return { allowed: false, reason: 'the offer is already APPLY_UNPROVEN by another run' };
    return yes;
  }
  if (SENT_STATUSES.includes(current)) return { allowed: false, reason: `the offer is ${current}: a sent application is never downgraded` };
  if (sameRun) return yes;
  if (current === 'VALIDATED') return { allowed: false, reason: 'the offer was re-queued by a newer validation (/valider) after this claim was closed; that validation stands' };
  return { allowed: false, reason: `the offer is ${current || 'without status'}, no longer this claim's (${claimRun})` };
}

/**
 * Le statut qu'avait l'offre avant qu'un run lancé à la main la prenne (`applying.from`, noté
 * par `claimForRun` ; `harness.from` quand ce même run l'a déjà écrit : `record` rejoué), ou
 * null pour une prise du listener (toujours prise VALIDATED).
 */
export function claimedFrom(job: PendingJob, run: string): string | null {
  const applying = job.applying as { from?: unknown } | undefined;
  if (job.status === 'APPLYING' && typeof applying?.from === 'string') return applying.from;
  const harness = harnessOf(job);
  return run !== '' && harness.run === run && typeof harness.from === 'string' ? harness.from : null;
}

/**
 * Ce que `record` écrit sur l'offre à la fin d'un run career-apply, quand `mayRecord` le
 * permet : le statut final de CE run. Une prise périmée a pu passer l'offre APPLY_FAILED
 * pendant que le run attendait le go (`releaseStale`) : ce run ne clique plus (`own`), mais
 * un envoi déjà fait (APPLIED, APPLY_UNPROVEN) s'écrit quand même, sinon il resterait noté
 * « échoué ». Chaque passage compte (`attempts`), une seule fois par run (un `record` rejoué
 * ne recompte pas) ; une issue qui remettrait l'offre en file (VALIDATED) au
 * MAX_ATTEMPTS-ième passage la clôt en APPLY_FAILED : une offre ne bloque pas la file.
 * Un run lancé à la main sur une offre que personne n'a validée (prise TAILORED,
 * PENDING_VALIDATION, APPLY_FAILED : `claimedFrom`) ne la remet jamais en file : une issue
 * VALIDATED y réécrit le statut d'avant la prise (APPLY_FAILED s'il n'y en avait pas), sinon
 * le listener postulerait sans go sur une plateforme vérifiée. Seuls `status` et `harness`
 * changent ; `validated_at` et les autres champs du bot restent.
 */
export function recordStatus(job: PendingJob, result: Outcome, run: string, now: Date): { status: string; summary: string; harness: JobHarness } {
  const attempts = attemptsOf(job) + (run !== '' && harnessOf(job).run === run && attemptsOf(job) > 0 ? 0 : 1);
  const from = claimedFrom(job, run);
  const unvalidated = result.status === 'VALIDATED' && from !== null && from !== 'VALIDATED';
  const exhausted = result.status === 'VALIDATED' && !unvalidated && attempts >= MAX_ATTEMPTS;
  const status = unvalidated ? from || 'APPLY_FAILED' : exhausted ? 'APPLY_FAILED' : result.status;
  const summary = unvalidated
    ? `${result.summary} Not re-queued: this run was started by hand on an offer that was ${from || 'without status'}, not validated; it is left ${status}, and only /valider re-queues it.`
    : exhausted
      ? `Stopped after ${attempts} attempts, each of which left the offer to retry; fix the cause, then /valider re-queues it. Last attempt: ${result.summary}`
      : result.summary;
  const harness: JobHarness = { run, stage: result.stage, at: now.toISOString(), summary, attempts, attempts_for: validationOf(job) };
  if (from !== null) harness.from = from;
  return { status, summary, harness };
}

// ── Les réponses aux formulaires, adaptées à l'offre ──────────────────────────────────────

/** Le plancher de salaire d'Antoine (2026-10-23) : la réponse quand l'offre ne donne pas de minimum. */
export const SALARY_FLOOR = 35_000;

/**
 * Le minimum annuel en euros d'une fourchette d'offre (« 38k€ - 50k€ », « 40 000 - 55 000 € »,
 * « 45000-60000 »), ou null : autre devise, taux horaire ou journalier, texte sans chiffre, ou
 * minimum sous le plancher (une fourchette mal lue ne fait jamais baisser la réponse).
 */
export function salaryMinimum(range: unknown, floor = SALARY_FLOOR): number | null {
  if (typeof range !== 'string') return null;
  const text = range.toLowerCase();
  if (/\$|usd|£|gbp|chf|\/\s*(?:h|hour|heure|day|jour)|hourly|par heure|per hour|tjm|daily/.test(text)) return null;
  const first = /(\d{1,3}(?:[ .  ]\d{3})+|\d+(?:[.,]\d+)?)\s*(k)?/.exec(text);
  if (first === null) return null;
  let value = Number(first[1]!.replace(/[ .  ](?=\d{3}\b)/g, '').replace(',', '.'));
  if (first[2] === 'k' || (value < 1000 && /\dk/.test(text))) value *= 1000;
  return Number.isFinite(value) && value >= floor && value < 1_000_000 ? Math.round(value) : null;
}

/** « LinkedIn (Live 24h) » → « LinkedIn » ; un tableau d'employeurs ou un ATS lu directement → le site carrière. */
export function sourceLabel(source: unknown): string {
  const name = String(source ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  if (name === '') return '';
  return /^(tableaux employeurs|apify ats)$/i.test(name) ? "Site carrière de l'entreprise" : name;
}

const euros = (n: number): string => `${n.toLocaleString('fr-FR').replace(/[  ]/g, ' ')} € bruts annuels`;

/**
 * `reponses_formulaires.md` adapté à une offre (Antoine, 2026-10-24) : « Prétentions salariales »
 * prend le minimum de la fourchette de l'offre, sinon le plancher ; « Comment avez-vous connu
 * l'offre ? » prend le site d'où vient l'offre. Le reste ne change pas. Pur.
 */
export function answersForOffer(markdown: string, offer: { salary_range?: unknown; source?: unknown }): string {
  const salary = euros(salaryMinimum(offer.salary_range) ?? SALARY_FLOOR);
  const source = sourceLabel(offer.source);
  const parts = markdown.split(/(?=^##\s)/m);
  return parts
    .map((part) => {
      const heading = /^##\s+(.+)$/m.exec(part)?.[1] ?? '';
      const value = /prétentions salariales/i.test(heading) ? salary : /connu l.offre/i.test(heading) && source !== '' ? source : null;
      if (value === null || !part.startsWith('##')) return part;
      const lines = part.replace(/\s+$/, '').split('\n');
      const head = [lines[0]!];
      for (const line of lines.slice(1)) {
        if (/^(variantes|choix)\s*:/i.test(line.trim())) head.push(line);
        else break;
      }
      return `${head.join('\n')}\n${value}\n\n`;
    })
    .join('');
}
