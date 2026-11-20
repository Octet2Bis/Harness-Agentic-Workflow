/**
 * Contrôles déterministes d'une soumission de candidature : le formulaire rempli
 * (`prefill.json`) avant le clic, le reçu (`receipt.json`) après. Purs : les fichiers
 * sont lus par les scripts, l'existence des captures leur est passée en paramètre.
 *
 * Avant le clic, en plus du formulaire complet : la page remplie est sur un hôte autorisé
 * (`pageHostProblems`, `platforms.ts`) ; un formulaire Workday passe la main ; chaque réponse
 * libre vient d'une source permise et lui est identique (`freeTextProblems`) — le fichier de
 * réponses validées par Antoine (`reponses_formulaires.md`, `parseAnswers`), le profil maître,
 * les champs factuels de `candidate.json`, et pour une lettre de motivation le pitch ou la
 * lettre ; une question sans réponse reste vide, « à remplir par Antoine » si un go suit
 * (`prefillRecap`) ; la lettre, quand il y en a une, est jointe là où le formulaire l'attend.
 */

import { type HostPolicy, confirmationFound, handoverFor, pageHostProblems } from './platforms.ts';

export interface PrefillField {
  label: string;
  value: string;
  source: string;
  status: 'filled' | 'skipped';
  /** `free_text` : une question ouverte ; `choice` : liste, bouton radio, case, date ; `upload` ; `text` sinon. */
  kind?: 'text' | 'free_text' | 'choice' | 'upload';
}
export interface Prefill {
  apply_url: string;
  final_url: string;
  platform: string;
  fields: PrefillField[];
  attachments: { field: string; file: string; status: 'attached' | 'failed' }[];
  unanswered: { label: string; reason: string; required?: boolean }[];
  /** Ce que le formulaire offre pour une lettre de motivation. */
  cover_letter_field?: 'upload' | 'text' | 'both' | 'none';
  submit_control: { label: string; visible: boolean; enabled: boolean };
  screenshot: string;
  blocked: boolean;
  blocker: string;
  submitted: boolean;
}

/** Une entrée de `reponses_formulaires.md` : la question, ses autres libellés, les options admises, la réponse validée. */
export interface AnswerEntry {
  question: string;
  variants: string[];
  choices: string[];
  answer: string;
}

/** Ce d'où une réponse libre peut venir, lu par le script (null : absent ou illisible). */
export interface AnswerSources {
  candidate: Record<string, unknown> | null;
  /** Les entrées de `reponses_formulaires.md` (vide : pas de fichier). */
  answers: AnswerEntry[];
  /** Le profil maître (`master_profile.md`). */
  profile: string | null;
  pitch: string | null;
  /** La version texte de la lettre (`letterTextPath`). */
  letterText: string | null;
}

export interface PrefillContext {
  /** E-mail du profil : il doit être dans un champ rempli. */
  email: string;
  /** Un CV doit être joint (faux pour `email`/`manual`). */
  requireCv: boolean;
  /** La capture d'écran existe sur le disque. */
  screenshotExists: boolean;
  /** Les hôtes où l'agent peut saisir (`hostPolicy`) ; absent : pas de page à vérifier (e-mail, manuel). */
  hosts?: HostPolicy;
  /** Le formulaire passe la main (Workday) : la raison ; il n'est jamais rempli par le harness. */
  handover?: string;
  /** Un go humain suivra (`needsHumanGo`, le calcul de `gate`) : une question sans réponse reste à Antoine au lieu de rougir. */
  humanGo?: boolean;
  /** Les sources des réponses libres ; absent : pas de contrôle des réponses libres. */
  sources?: AnswerSources;
  /** La lettre de motivation (chemin), vide sans lettre : rien ne change alors. */
  letter?: string;
  /** Le CV (chemin) : avec une lettre, il doit être joint, et la lettre jamais à sa place. */
  cv?: string;
}

export interface PrefillOutcome {
  ok: boolean;
  problems: string[];
  filled: number;
  attached: boolean;
  /** Le récapitulatif montré au go : d'où vient chaque réponse libre, et ce qui reste « à remplir par Antoine ». */
  recap: string;
}

/** Le nom d'un fichier, que le chemin soit Windows ou POSIX. */
export function fileName(path: string): string {
  return path.trim().split(/[\\/]/).pop() ?? '';
}

/** La version texte de la lettre : le même chemin en `.md` (`lettre.pdf` → `lettre.md`) ; vide sans lettre. */
export function letterTextPath(letter: string): string {
  const path = letter.trim();
  if (path === '') return '';
  return /\.[A-Za-z0-9]+$/.test(fileName(path)) ? path.replace(/\.[A-Za-z0-9]+$/, '.md') : `${path}.md`;
}

export function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Les réponses libres : d'où elles viennent ───────────────────────────────────────

/** Le nom du fichier de réponses validées par Antoine, dans le dossier carrière (lu, jamais écrit par un agent). */
export const ANSWERS_FILE = 'reponses_formulaires.md';
/** La source d'une réponse tirée de ce fichier : `reponses_formulaires:<question>`. */
export const ANSWERS_SOURCE = 'reponses_formulaires:';

/** Les champs de `candidate.json` qui recopient le profil maître (cv-tailor) ; `answers` n'en est pas : c'est du texte composé. */
export const FACT_KEYS = ['name', 'email', 'phone', 'linkedin', 'portfolio', 'location', 'work_format', 'availability', 'salary_expectation', 'languages'];

/** Un libellé comparable : sans accents, en minuscules, la ponctuation réduite à des espaces. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Questions factuelles : elles ne se répondent que depuis les faits (profil, fiche, fichier validé).
const FACTUAL_QUESTION =
  /\b(salaire|salary|remuneration|compensation|pretention|package|notice|preavis|start date|date de debut|date d entree|disponib|availability|available|authori[sz]|visa|sponsor|permis de travail|titre de sejour|right to work|work permit|eligib|relocat|demenag|mobilite)/;
// Questions de motivation et champs de lettre : le pitch ou la lettre y répondent aussi.
const MOTIVATION_QUESTION =
  /\b(motivation|why|pourquoi|cover letter|lettre|message|tell us|about yourself|parlez nous|presentez vous|additional information|informations complementaires|anything else)/;
const CV_FIELD = /\b(resume|cv|curriculum)\b/;

/**
 * Une question ouverte : déclarée `free_text`, ou un champ de saisie dont le libellé est une
 * question de motivation ou de fait (salaire, préavis, autorisation de travail, mobilité…).
 * Une liste, un bouton radio ou un téléversement n'en est pas une : le juge les relit.
 */
export function isOpenQuestion(field: Pick<PrefillField, 'label' | 'kind'>): boolean {
  if (field.kind === 'free_text') return true;
  if (field.kind === 'choice' || field.kind === 'upload') return false;
  const label = normalizeLabel(String(field.label ?? ''));
  return FACTUAL_QUESTION.test(label) || MOTIVATION_QUESTION.test(label);
}

/**
 * Lit `reponses_formulaires.md` : une entrée par titre `## <question>`, puis, facultatives et
 * juste sous le titre, `Variantes : a | b` (autres libellés de la même question) et
 * `Choix : x | y` (options admises dans une liste), puis la réponse jusqu'au titre suivant. Le
 * texte avant le premier `##` et les commentaires HTML sont ignorés ; une entrée sans réponse
 * est gardée vide (une question notée, pas encore répondue : jamais tapée). Pur.
 */
// Adapté de proficiently-claude-skills/skills/apply/SKILL.md (MIT) : des réponses standard validées par le candidat, tenues dans un fichier et réutilisées d'une candidature à l'autre.
export function parseAnswers(markdown: string): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  let current: { question: string; variants: string[]; choices: string[]; lines: string[]; head: boolean } | null = null;
  const flush = (): void => {
    if (current !== null) entries.push({ question: current.question, variants: current.variants, choices: current.choices, answer: current.lines.join('\n').trim() });
  };
  for (const line of markdown.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      flush();
      current = { question: heading[1]!.trim(), variants: [], choices: [], lines: [], head: true };
      continue;
    }
    if (/^#\s/.test(line)) {
      flush();
      current = null;
      continue;
    }
    if (current === null) continue;
    const meta = /^(variantes|choix)\s*:\s*(.*)$/i.exec(line.trim());
    if (current.head && meta) {
      const list = meta[2]!.split('|').map((item) => item.trim()).filter((item) => item !== '');
      (meta[1]!.toLowerCase() === 'variantes' ? current.variants : current.choices).push(...list);
      continue;
    }
    if (line.trim() !== '') current.head = false;
    current.lines.push(line);
  }
  flush();
  return entries;
}

/** L'entrée dont la question ou une variante a ce libellé (accents, casse et ponctuation ignorés), ou null. */
export function findAnswer(entries: AnswerEntry[], label: string): AnswerEntry | null {
  const key = normalizeLabel(label);
  if (key === '') return null;
  return entries.find((entry) => normalizeLabel(entry.question) === key || entry.variants.some((variant) => normalizeLabel(variant) === key)) ?? null;
}

const collapse = (value: string): string => value.normalize('NFC').replace(/\s+/g, ' ').trim();
/** Un texte Markdown comparé sans sa mise en forme (`**`, `_`, `#`, `>`, accents graves). */
const plain = (value: string): string => collapse(value.replace(/[*_`>#]/g, ' '));
const isEmptyFact = (fact: unknown): boolean => fact === undefined || fact === null || (typeof fact === 'string' && fact.trim() === '') || (Array.isArray(fact) && fact.length === 0);
const factText = (fact: unknown): string => (Array.isArray(fact) ? fact.map(String).join(', ') : String(fact));

/** La valeur tapée est-elle ce fait de la fiche ? Une liste (langues) admet une partie de ses éléments, séparés par , ; / ou |. */
function sameFact(value: string, fact: unknown): boolean {
  if (Array.isArray(fact)) {
    const items = fact.map((item) => collapse(String(item)).toLowerCase()).filter((item) => item !== '');
    const parts = value.split(/[,;/|]/).map((part) => collapse(part).toLowerCase()).filter((part) => part !== '');
    return parts.length > 0 && parts.every((part) => items.includes(part));
  }
  return (typeof fact === 'string' || typeof fact === 'number') && collapse(String(fact)) !== '' && collapse(String(fact)).toLowerCase() === collapse(value).toLowerCase();
}

const LEAVE_BLANK = ' ; sinon laisser le champ vide et le lister dans unanswered (« à remplir par Antoine »)';

/** Le problème d'une réponse libre remplie, ou null quand elle vient mot pour mot d'une source permise. */
function freeTextProblem(field: PrefillField, sources: AnswerSources): string | null {
  const where = `Réponse libre « ${field.label} »`;
  const value = String(field.value ?? '');
  const source = String(field.source ?? '').trim();
  if (source.startsWith(ANSWERS_SOURCE)) {
    const key = source.slice(ANSWERS_SOURCE.length).trim();
    if (sources.answers.length === 0) return `${where} cite ${ANSWERS_FILE}, absent ou vide ici${LEAVE_BLANK}`;
    const entry = findAnswer(sources.answers, key);
    if (entry === null || entry.answer === '') return `${where} : aucune réponse validée « ${key} » dans ${ANSWERS_FILE}${LEAVE_BLANK}`;
    if (collapse(value) !== collapse(entry.answer)) return `${where} diffère de la réponse validée « ${entry.question} » de ${ANSWERS_FILE} : la recopier telle quelle, sans la retoucher${LEAVE_BLANK}`;
    return null;
  }
  if (source === 'profil') {
    if (!sources.profile) return `${where} cite le profil maître, introuvable ici${LEAVE_BLANK}`;
    if (plain(value).split(' ').filter((word) => word !== '').length < 3) {
      return `${where} : un extrait du profil maître fait au moins trois mots ; une réponse plus courte vient d'un fait de candidate.json ou de ${ANSWERS_FILE}`;
    }
    if (!plain(sources.profile).includes(plain(value))) return `${where} n'est pas un extrait mot pour mot du profil maître${LEAVE_BLANK}`;
    return null;
  }
  if (source.startsWith('answers.') || source.startsWith('candidate.answers')) {
    return `${where} : « ${source} » est une réponse composée de candidate.json (cv-tailor) ; les réponses composées de candidate.json (answers) ne valent pas pour une question ouverte${LEAVE_BLANK}`;
  }
  if (source.startsWith('candidate.')) {
    const key = source.slice('candidate.'.length);
    if (!FACT_KEYS.includes(key)) {
      return `${where} : « ${source} » n'est pas un fait du profil (candidate.${FACT_KEYS.join(', candidate.')}) ; les réponses composées de candidate.json (answers) ne valent pas pour une question ouverte${LEAVE_BLANK}`;
    }
    const fact = sources.candidate?.[key];
    if (isEmptyFact(fact)) return `${where} : ${source} est vide dans candidate.json (le profil n'en dit rien)${LEAVE_BLANK}`;
    if (!sameFact(value, fact)) return `${where} diffère de ${source} (« ${factText(fact)} ») : le recopier tel quel${LEAVE_BLANK}`;
    return null;
  }
  if (source === 'pitch' || source === 'lettre') {
    const name = source === 'pitch' ? 'le pitch' : 'la lettre';
    if (FACTUAL_QUESTION.test(normalizeLabel(field.label))) {
      return `${where} est une question factuelle (salaire, préavis, autorisation de travail, mobilité…) : ${name} n'y répond pas ; seuls ${ANSWERS_FILE}, le profil maître ou candidate.json y répondent${LEAVE_BLANK}`;
    }
    const doc = source === 'pitch' ? sources.pitch : sources.letterText;
    if (!doc) return source === 'lettre' ? `${where} cite la lettre, qui n'a pas de version texte (le même nom en .md à côté du PDF) : y coller le pitch` : `${where} cite le pitch, introuvable ici`;
    if (!plain(doc).includes(plain(value))) return `${where} n'est pas tirée mot pour mot de ${name}`;
    return null;
  }
  return `${where} a pour source « ${source || 'rien'} » : une question ouverte ne se répond que depuis ${ANSWERS_FILE} (réponses validées par Antoine), le profil maître ou les faits de candidate.json, et une lettre de motivation depuis le pitch ou la lettre ; jamais une réponse composée${LEAVE_BLANK}`;
}

/** Chaque réponse libre remplie vient mot pour mot d'une source permise ; sinon, un problème par champ. Pur. */
export function freeTextProblems(fields: PrefillField[], sources: AnswerSources): string[] {
  return fields
    .filter((field) => field.status === 'filled' && isOpenQuestion(field))
    .map((field) => freeTextProblem(field, sources))
    .filter((problem): problem is string => problem !== null);
}

/**
 * La lettre de motivation, quand il y en a une : jointe au champ prévu (`upload`, `both`), ou
 * collée dans le champ texte (`text` : sa version texte, à défaut le pitch) ; le CV reste joint
 * et la lettre n'est jamais à sa place. Sans lettre, rien (le comportement d'avant). Pur.
 */
export function letterProblems(prefill: Partial<Prefill>, letter: string, cv: string): string[] {
  if (letter.trim() === '') return [];
  const letterName = fileName(letter);
  const cvName = fileName(cv);
  const fields = Array.isArray(prefill.fields) ? prefill.fields : [];
  const attachments = Array.isArray(prefill.attachments) ? prefill.attachments : [];
  const isAttached = (name: string): boolean => attachments.some((attachment) => attachment.status === 'attached' && fileName(String(attachment.file ?? '')) === name);
  const problems: string[] = [];
  const offer = prefill.cover_letter_field;
  if (offer !== 'upload' && offer !== 'text' && offer !== 'both' && offer !== 'none') {
    problems.push(`une lettre est fournie (${letterName}) mais prefill.json ne dit pas ce que le formulaire offre pour elle : cover_letter_field = upload, text, both ou none`);
  }
  if ((offer === 'upload' || offer === 'both') && !isAttached(letterName)) problems.push(`la lettre (${letterName}) n'est pas jointe au champ de lettre de motivation`);
  if (offer === 'text' && !fields.some((field) => field.status === 'filled' && (field.source === 'lettre' || field.source === 'pitch'))) {
    problems.push('le champ texte de lettre de motivation est vide : y coller la lettre (sa version texte) ou, à défaut, le pitch');
  }
  if (cvName !== '' && cvName !== letterName && !isAttached(cvName)) problems.push(`le CV (${cvName}) n'est pas joint : la lettre ne le remplace pas`);
  for (const attachment of attachments) {
    if (attachment.status === 'attached' && fileName(String(attachment.file ?? '')) === letterName && CV_FIELD.test(normalizeLabel(String(attachment.field ?? '')))) {
      problems.push(`la lettre est jointe au champ « ${attachment.field} », qui attend le CV`);
    }
  }
  return problems;
}

const sourceLabel = (source: string): string => {
  const value = source.trim();
  if (value.startsWith(ANSWERS_SOURCE)) return `${ANSWERS_FILE} « ${value.slice(ANSWERS_SOURCE.length).trim()} »`;
  if (value === 'profil') return 'profil maître';
  if (value.startsWith('candidate.')) return `candidate.json (${value.slice('candidate.'.length)})`;
  return value || 'source inconnue';
};

/**
 * Le récapitulatif montré au go : d'où vient chaque réponse libre, ce qui reste « à remplir
 * par Antoine » (avec la réponse validée qui existe peut-être déjà sous un autre libellé), et
 * ce qu'est devenue la lettre. Pur.
 */
export function prefillRecap(prefill: Partial<Prefill>, context: { letter?: string; answers?: AnswerEntry[] } = {}): string {
  const fields = Array.isArray(prefill.fields) ? prefill.fields : [];
  const unanswered = Array.isArray(prefill.unanswered) ? prefill.unanswered : [];
  const free = fields.filter((field) => field.status === 'filled' && isOpenQuestion(field)).map((field) => `« ${field.label} » ← ${sourceLabel(String(field.source ?? ''))}`);
  const todo = unanswered.map((entry) => {
    const known = findAnswer(context.answers ?? [], String(entry.label ?? ''));
    const hint = known !== null && known.answer !== '' ? ` (réponse validée possible : ${ANSWERS_FILE} « ${known.question} »)` : '';
    return `« ${entry.label} »${entry.required === true ? ' (obligatoire)' : ''}${hint}`;
  });
  const lines = [`Réponses libres : ${free.length > 0 ? free.join(' ; ') : 'aucune'}.`, `À remplir par Antoine : ${todo.length > 0 ? todo.join(' ; ') : 'rien'}.`];
  const letter = (context.letter ?? '').trim();
  if (letter !== '') {
    const name = fileName(letter);
    const attached = (Array.isArray(prefill.attachments) ? prefill.attachments : []).some((attachment) => attachment.status === 'attached' && fileName(String(attachment.file ?? '')) === name);
    const pasted = fields.find((field) => field.status === 'filled' && (field.source === 'lettre' || field.source === 'pitch'));
    const state = attached
      ? 'jointe'
      : pasted?.source === 'lettre'
        ? `collée dans « ${pasted.label} »`
        : pasted !== undefined && prefill.cover_letter_field === 'text'
          ? `pas de champ pour un fichier : le pitch est collé dans « ${pasted.label} »`
          : prefill.cover_letter_field === 'none'
            ? "le formulaire n'a pas de champ de lettre"
            : 'pas jointe';
    lines.push(`Lettre (${name}) : ${state}.`);
  }
  return lines.join('\n');
}

/** Le formulaire est prêt à partir : rempli, pièce jointe, bouton visible, pas déjà envoyé, capture présente, sur un hôte autorisé, réponses libres sourcées. */
export function evaluatePrefill(raw: Record<string, unknown> | null, context: PrefillContext): PrefillOutcome {
  if (raw === null) return { ok: false, problems: ['prefill.json is missing or is not a JSON object'], filled: 0, attached: false, recap: '' };
  const prefill = raw as Partial<Prefill>;
  const problems: string[] = [];
  const fields = Array.isArray(prefill.fields) ? prefill.fields : [];
  const attachments = Array.isArray(prefill.attachments) ? prefill.attachments : [];
  const unanswered = Array.isArray(prefill.unanswered) ? prefill.unanswered : [];
  const filled = fields.filter((field) => field.status === 'filled').length;
  const attached = attachments.some((attachment) => attachment.status === 'attached');
  const finalUrl = typeof prefill.final_url === 'string' ? prefill.final_url : '';

  if (prefill.submitted === true) problems.push('prefill must not submit the form: submitted is true');
  if (prefill.blocked === true) problems.push(`blocked before the form could be filled: ${prefill.blocker || 'no reason given'}`);
  // Le passage de main (Workday) : jamais rempli par le harness, que l'URL de départ ou la page atteinte le dise.
  const handover = context.handover || handoverFor(finalUrl);
  if (handover) problems.push(handover);
  // L'hôte de la page remplie : un agent arrêté avant toute page (blocage, passage de main) n'en a pas.
  if (context.hosts && !(prefill.blocked === true && finalUrl.trim() === '')) {
    problems.push(...pageHostProblems(finalUrl, context.hosts, 'Le formulaire rempli (final_url de prefill.json)'));
  }
  if (filled === 0) problems.push('no field was filled');
  if (context.email !== '' && !fields.some((field) => field.status === 'filled' && field.value.trim().toLowerCase() === context.email.toLowerCase())) {
    problems.push(`no filled field carries the candidate e-mail (${context.email})`);
  }
  if (context.requireCv && !attached) problems.push('the CV is not attached (no attachment with status "attached")');
  for (const attachment of attachments) {
    if (attachment.status === 'failed') problems.push(`attachment failed on field "${attachment.field}"`);
  }
  // Une question sans réponse reste vide : Antoine la remplit au go. Sans go (mode auto, ou
  // plateforme déjà vérifiée), personne ne la remplirait : le formulaire reste rouge.
  if (unanswered.length > 0 && context.humanGo !== true) {
    problems.push(
      `champs sans réponse : ${unanswered.map((entry) => `"${entry.label}" (${entry.reason || 'sans raison'})`).join(', ')} ; aucun go humain ne suit (mode auto, ou plateforme déjà vérifiée), personne ne les remplirait : ajouter la réponse validée à ${ANSWERS_FILE}, ou relancer en mode confirm`
    );
  }
  if (context.sources) problems.push(...freeTextProblems(fields, context.sources));
  problems.push(...letterProblems(prefill, context.letter ?? '', context.cv ?? ''));
  const control = prefill.submit_control;
  if (!control || control.visible !== true) problems.push('submit control not located (submit_control.visible must be true)');
  if (!context.screenshotExists) problems.push(`screenshot "${prefill.screenshot || 'prefill.png'}" not found in the artifacts`);
  for (const field of fields) {
    if (field.status === 'filled' && (field.value ?? '').trim() === '') problems.push(`field "${field.label}" is marked filled but empty`);
  }
  const recap = prefillRecap(prefill, { letter: context.letter, answers: context.sources?.answers });
  return { ok: problems.length === 0, problems, filled, attached, recap };
}

export interface Receipt {
  submitted: boolean;
  clicked_at: string;
  /** La page où l'agent a cliqué « Envoyer » (son hôte est contrôlé). */
  clicked_url: string;
  final_url: string;
  confirmation_text: string;
  page_excerpt: string;
  screenshot: string;
  error: string;
}

export interface ReceiptOutcome {
  ok: boolean;
  problems: string[];
  submitted: boolean;
  proven: boolean;
  confirmation: string;
}

/**
 * Le reçu prouve l'envoi : clic fait, confirmation reconnue, capture présente, pas d'erreur ;
 * et, quand `hosts` est donné, le clic a eu lieu sur un hôte autorisé (`clicked_url` du reçu,
 * à défaut `url` de click.json). Un clic ailleurs n'est jamais prouvé : `unproven`.
 */
export function evaluateReceipt(
  raw: Record<string, unknown> | null,
  platform: string,
  screenshotExists: boolean,
  context: { hosts?: HostPolicy; clickUrl?: string } = {}
): ReceiptOutcome {
  if (raw === null) return { ok: false, problems: ['receipt.json is missing or is not a JSON object'], submitted: false, proven: false, confirmation: '' };
  const receipt = raw as Partial<Receipt>;
  const problems: string[] = [];
  const submitted = receipt.submitted === true;
  if (!submitted) problems.push(`the form was not submitted${receipt.error ? `: ${receipt.error}` : ''}`);
  if (receipt.error && receipt.error.trim() !== '') problems.push(`the page reported an error after the click: ${receipt.error}`);
  const confirmation = confirmationFound(`${receipt.confirmation_text ?? ''}\n${receipt.page_excerpt ?? ''}`, platform) ?? '';
  if (submitted && confirmation === '') problems.push('no recognised confirmation in confirmation_text or page_excerpt');
  if (!screenshotExists) problems.push(`screenshot "${receipt.screenshot || 'receipt.png'}" not found in the artifacts`);
  const hostProblems: string[] = [];
  if (context.hosts) {
    const clicked = (typeof receipt.clicked_url === 'string' ? receipt.clicked_url.trim() : '') || (context.clickUrl ?? '').trim();
    if (clicked !== '') hostProblems.push(...pageHostProblems(clicked, context.hosts, "Le clic d'envoi (clicked_url de receipt.json)"));
    else if (submitted) hostProblems.push("URL du clic inconnue (ni clicked_url dans receipt.json, ni url dans click.json) : l'hôte où l'envoi a eu lieu ne peut pas être vérifié");
  }
  problems.push(...hostProblems);
  const proven = submitted && confirmation !== '' && screenshotExists && !(receipt.error && receipt.error.trim() !== '') && hostProblems.length === 0;
  return { ok: problems.length === 0 && proven, problems, submitted, proven, confirmation };
}
