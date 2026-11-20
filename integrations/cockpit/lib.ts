/**
 * Cockpit local : les fonctions pures. Le tableau du bot (`pending_gold_jobs.json`), les
 * commandes Archon à lancer, l'état des runs tel que `archon workflow runs --json --verbose`
 * le rend. Tout ce qui touche le disque, Archon ou HTTP est dans cockpit.ts ; tout ce qui
 * est ici est testé dans lib.test.ts.
 */

import { employerBoardSource } from '../../.archon/workflows/blocks/.shared/offer-date.ts';
import { postingUrl } from '../../.archon/workflows/systems/.shared/career.ts';

export interface Offer {
  /** L'identifiant du radar (unique ; les slugs se répètent) : la clé du tri. */
  id: string;
  slug: string;
  company: string;
  title: string;
  link: string;
  source: string;
  location: string;
  score: number | null;
  tier: string;
  status: string;
  hook: string;
  verdict: string;
  description: string;
  skills: string;
  salary: string;
  date: string;
  /** Mise au tableau à la main (`ajoutee_par`) : le jour de l'ajout (AAAA-MM-JJ), qui la classe et la date dans la période ; sinon vide. */
  added: string;
  /** Offre du site ou du tableau de l'employeur (sans limite d'âge) : le jour où le radar l'a trouvée, qui la classe dans la période ; sinon vide. */
  seen: string;
  targetRole: string;
  hq: string;
  harness: { run: string; stage: string; at: string; summary: string; apply_url: string } | null;
  applying: { run: string; at: string } | null;
}

/**
 * Lecture d'un objet indexé par slug sans tomber sur le prototype : une offre dont le slug est
 * `constructor` (l'entreprise Constructor, vue le 22 octobre) rendait `runs['constructor']` vrai
 * (Object.prototype.constructor) et la liste du cockpit vide.
 */
export function own<T>(obj: Record<string, T> | null | undefined, key: string): T | null {
  return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key]! : null;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

/** Les entités HTML des offres scrapées (`&amp;`, `&#39;`), décodées pour l'affichage. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Les offres du tableau, normalisées ; une ligne sans slug est ignorée. */
export function readOffers(board: unknown): Offer[] {
  if (!Array.isArray(board)) return [];
  const offers: Offer[] = [];
  for (const row of board) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const slug = str(r.slug).trim();
    if (slug === '') continue;
    const scoreRaw = r.match_score ?? r.final_score ?? r.score;
    const score = typeof scoreRaw === 'number' ? scoreRaw : Number.isFinite(Number(scoreRaw)) && str(scoreRaw) !== '' ? Number(scoreRaw) : null;
    const h = r.harness !== null && typeof r.harness === 'object' ? (r.harness as Record<string, unknown>) : null;
    const a = r.applying !== null && typeof r.applying === 'object' ? (r.applying as Record<string, unknown>) : null;
    offers.push({
      id: str(r.id),
      slug,
      company: decodeEntities(str(r.company)),
      title: decodeEntities(str(r.title)),
      // L'adresse à ouvrir : une offre LinkedIn sur www (sinon la page s'affiche dans la langue du sous-domaine du pays).
      link: postingUrl(str(r.link)),
      source: str(r.source),
      location: decodeEntities(str(r.location)),
      score,
      tier: str(r.tier),
      status: str(r.status) || 'SANS_STATUT',
      hook: decodeEntities(str(r.hook_angle)),
      verdict: decodeEntities(str(r.jury_verdict)),
      description: decodeEntities(str(r.description)),
      skills: decodeEntities(str(r.skills_required)),
      salary: decodeEntities(str(r.salary_range)),
      date: str(r.date_published),
      added: str(r.ajoutee_par) !== '' ? str((r.radar as Record<string, unknown> | undefined)?.at).slice(0, 10) || str(r.ajoutee_le).slice(0, 10) : '',
      seen: employerBoardSource(r.source) ? str((r.radar as Record<string, unknown> | undefined)?.at).slice(0, 10) : '',
      targetRole: decodeEntities(str(r.target_role)),
      hq: decodeEntities(str(r.company_hq)),
      harness: h ? { run: str(h.run), stage: str(h.stage), at: str(h.at), summary: str(h.summary), apply_url: /^https:\/\//i.test(str(h.apply_url)) ? str(h.apply_url) : '' } : null,
      applying: a ? { run: str(a.run), at: str(a.at) } : null,
    });
  }
  return offers;
}

/**
 * La règle de zone du radar (remote_auditor.evaluateTerritory : localisation qui ne nomme que des zones hors
 * Europe, ou résidence hors Europe exigée) appliquée à une ligne du tableau. Les lignes entrées avant la règle
 * (Growth.Talent, Apify ATS du 23-24 octobre) passent ainsi par le même filtre que les nouvelles.
 */
export function zoneOf(row: unknown, evaluate: (job: { location: string; description: string }) => { pass: boolean; reason?: string }): { pass: boolean; reason: string } {
  if (row === null || typeof row !== 'object') return { pass: true, reason: '' };
  const r = row as Record<string, unknown>;
  const res = evaluate({ location: decodeEntities(str(r.location)), description: decodeEntities(str(r.description)) });
  return { pass: res.pass, reason: res.pass ? '' : String(res.reason ?? 'zone hors Europe') };
}

/** Les statuts depuis lesquels un run lancé à la main peut prendre l'offre (claimForRun, .shared/pending.ts). */
export const LAUNCHABLE = new Set(['PENDING_VALIDATION', 'VALIDATED', 'TAILORED', 'APPLY_FAILED']);

export function canLaunch(offer: Offer): { ok: boolean; reason: string } {
  if (offer.status === 'APPLYING') return { ok: false, reason: `déjà en cours (run ${offer.applying?.run.slice(0, 8) ?? '?'})` };
  if (offer.status === 'APPLIED') return { ok: false, reason: 'candidature envoyée : jamais deux fois' };
  if (offer.status === 'APPLY_UNPROVEN') return { ok: false, reason: 'envoi possible mais non prouvé : vérifie la boîte mail et la plateforme avant tout' };
  if (!LAUNCHABLE.has(offer.status)) return { ok: false, reason: `statut ${offer.status} : le harness ne le prend pas` };
  return { ok: true, reason: '' };
}

export interface RunOptions {
  harness: string;
  slug: string;
  careerDir: string;
  /** `cv-only` : le bouton « CV sur mesure » du radar Telegram (CV seul, rien envoyé). */
  mode?: 'confirm' | 'auto' | 'verified-only' | 'cv-only';
  verifiedPlatforms?: string;
}

/** `archon workflow run career-apply …` détaché : le cockpit rend la main tout de suite et suit le run par son id. */
export function runArgs(o: RunOptions): string[] {
  const args = ['workflow', 'run', 'career-apply', '--cwd', o.harness, '--folder', '--input', `slug=${o.slug}`, '--input', `career_dir=${o.careerDir}`, '--input', `mode=${o.mode ?? 'confirm'}`];
  if (o.verifiedPlatforms !== undefined && o.verifiedPlatforms !== '') args.push('--input', `verified_platforms=${o.verifiedPlatforms}`);
  args.push('--detach');
  return args;
}

/** Les étapes d'entretien que connaît le bloc interview-prep. */
export const INTERVIEW_STAGES = ['rh', 'manager', 'technique', 'final'] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

/** `archon workflow run interview-prep … --detach` sur le dossier `applications/<slug>/` (README du bloc). */
export function interviewRunArgs(o: { harness: string; careerDir: string; slug: string; stage: InterviewStage; join: (...parts: string[]) => string }): string[] {
  return ['workflow', 'run', 'interview-prep', '--cwd', o.harness, '--folder',
    '--input', `application=${o.join(o.careerDir, 'applications', o.slug)}`,
    '--input', `profile=${o.join(o.careerDir, 'master_profile.md')}`,
    '--input', `stage=${o.stage}`, '--detach'];
}

/** `archon workflow run decision-makers … --detach` sur le dossier `applications/<slug>/` : les décideurs à qui écrire, et les messages (rien n'est envoyé). */
export function contactsRunArgs(o: { harness: string; careerDir: string; slug: string; join: (...parts: string[]) => string }): string[] {
  return ['workflow', 'run', 'decision-makers', '--cwd', o.harness, '--folder',
    '--input', `application=${o.join(o.careerDir, 'applications', o.slug)}`,
    '--input', `profile=${o.join(o.careerDir, 'master_profile.md')}`, '--detach'];
}

/** Les sources de noms que le cockpit n'affiche jamais en lien de preuve (LinkedIn : jamais lu par le robot ; courtiers de données). */
const NO_SOURCE_HOSTS = /(^|\.)(linkedin\.com|rocketreach\.co|zoominfo\.com|lusha\.com|apollo\.io|contactout\.com|signalhire\.com|leadiq\.com|kaspr\.io|hunter\.io)$/i;

export interface ContactPerson {
  name: string;
  role: string;
  why: string;
  source: string;
  /** La recherche LinkedIn de la personne, qu'Antoine ouvre lui-même (connecté) : le robot ne lit jamais LinkedIn. */
  linkedin: string;
}

export interface ContactsView {
  company: string;
  jobTitle: string;
  domain: string;
  people: ContactPerson[];
  /** Les recherches LinkedIn à faire à la main quand une personne n'a pas été trouvée en public. */
  searches: { text: string; url: string }[];
  /** La recherche d'e-mails sur le domaine (Hunter, gratuit : 25 recherches par mois) ; vide sans domaine. */
  hunter: string;
  note: { to: string; text: string };
  email: { to: string; subject: string; body: string };
  sources: string[];
  notes: string[];
}

const linkedinPeopleSearch = (keywords: string): string => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords.trim())}`;
const httpsUrl = (v: unknown): string => {
  const s = str(v).trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !NO_SOURCE_HOSTS.test(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
};

/**
 * `decideurs.json` (bloc decision-makers) déjà parsé, normalisé pour l'onglet contacts ; null si ce n'est
 * pas un tel fichier. Une source LinkedIn ou d'un courtier de données est retirée, et rien de ce qui
 * ressemble à une adresse e-mail ou à un numéro n'est gardé : le bloc n'en écrit pas, Hunter les donne.
 */
export function contactsView(raw: unknown): ContactsView | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.people)) return null;
  const clean = (v: unknown, max: number): string => str(v).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[adresse retirée]').slice(0, max).trim();
  const company = clean(r.company, 200);
  const domain = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(str(r.domain).trim()) ? str(r.domain).trim().toLowerCase() : '';
  const people = (r.people as unknown[])
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => ({ name: clean(p.name, 120), role: clean(p.role, 200), why: clean(p.why, 600), source: httpsUrl(p.source) }))
    .filter((p) => p.name !== '')
    .map((p) => ({ ...p, linkedin: linkedinPeopleSearch(`${p.name} ${company}`) }));
  const note = r.linkedin_note !== null && typeof r.linkedin_note === 'object' ? (r.linkedin_note as Record<string, unknown>) : {};
  const email = r.email !== null && typeof r.email === 'object' ? (r.email as Record<string, unknown>) : {};
  return {
    company,
    jobTitle: clean(r.job_title, 200),
    domain,
    people,
    searches: (Array.isArray(r.searches) ? r.searches : []).map((s) => clean(s, 200)).filter((s) => s !== '').map((text) => ({ text, url: linkedinPeopleSearch(text) })),
    hunter: domain === '' ? '' : `https://hunter.io/search/${domain}`,
    note: { to: clean(note.to, 120), text: clean(note.text, 400) },
    email: { to: clean(email.to, 120), subject: clean(email.subject, 200), body: clean(email.body, 4000) },
    sources: (Array.isArray(r.sources) ? r.sources : []).map(httpsUrl).filter((s) => s !== ''),
    notes: (Array.isArray(r.notes) ? r.notes : []).map((s) => clean(s, 400)).filter((s) => s !== ''),
  };
}

/**
 * Le PDF à ouvrir, tel qu'il sera joint : celui du run (`application/CV.pdf`, `application/letter.pdf`, rendus et
 * contrôlés par `render`) quand le run le porte, sinon celui du dossier de candidature (`CV_<nom>_<slug>.pdf`,
 * `Lettre_<nom>_<slug>.pdf`, recopiés par `record`). Un PDF refusé (`*.rejected.pdf`) n'est jamais proposé.
 */
export function pickPdf(kind: 'cv' | 'lettre', runFiles: string[], appFiles: string[]): { from: 'run' | 'dossier'; path: string } | null {
  const inRun = kind === 'cv' ? 'application/CV.pdf' : 'application/letter.pdf';
  if (runFiles.includes(inRun)) return { from: 'run', path: inRun };
  const re = kind === 'cv' ? /^CV_.+\.pdf$/i : /^Lettre_.+\.pdf$/i;
  const found = appFiles.filter((f) => re.test(f) && !/\.rejected\.pdf$/i.test(f)).sort();
  return found.length > 0 ? { from: 'dossier', path: found[0]! } : null;
}

// ── Ce qui attend Antoine : l'alerte « à toi » ──────────────────────────────────────────
export type AttentionKind = 'go' | 'compte' | 'main' | 'verifier' | 'panne';

export interface AttentionItem {
  /** Change quand la situation change (un autre run, un autre passage) : une alerte vue ne revient que si elle est nouvelle. */
  key: string;
  slug: string;
  company: string;
  kind: AttentionKind;
  title: string;
  detail: string;
}

/** Ce que l'alerte lit d'un run : son statut, l'étape en pause (le go), les étapes en échec. */
export interface AttentionRun {
  id: string;
  status: string;
  waiting: string | null;
  failed: string[];
}

const ACCOUNT_WORDS = /\b(compte|account|sign[ -]?in|sign[ -]?up|log[ -]?in|connexion|mot de passe|password|successfactors|workday|taleo)\b/i;

/**
 * Les offres qui attendent un geste d'Antoine, une par slug (la ligne la plus récente du tableau), dans
 * l'ordre : go attendu, compte à ouvrir, candidature à finir à la main, envoi à vérifier, étape en échec.
 * Un refus au go (« Refused at the go ») ou une offre reprise ailleurs (« Not sent: ») n'en est pas une :
 * c'est Antoine, ou le tableau, qui a décidé. Un run vivant qui travaille n'attend rien.
 */
export function attentionItems(offers: Offer[], runs: Record<string, AttentionRun>): AttentionItem[] {
  const out: AttentionItem[] = [];
  const seen = new Set<string>();
  for (const o of sortOffers(offers)) {
    if (seen.has(o.slug)) continue;
    seen.add(o.slug);
    const run = own(runs, o.slug);
    const company = o.company || o.slug;
    if (run && isLive(run.status)) {
      if (run.waiting !== null) out.push({ key: `go:${run.id}`, slug: o.slug, company, kind: 'go', title: `Go attendu : ${company}`, detail: 'Le formulaire est prérempli et contrôlé. Relis le CV, puis donne ton go ou refuse.' });
      continue;
    }
    if (run && run.status === 'failed') {
      out.push({ key: `panne:${run.id}`, slug: o.slug, company, kind: 'panne', title: `Étape en échec : ${company}`, detail: `${run.failed.length ? `Étape : ${run.failed.map((n) => nodeLabel(n)).join(', ')}. ` : ''}Le journal du run dit pourquoi ; rien n'a été envoyé.` });
      continue;
    }
    const h = o.harness;
    const at = h?.at ?? '';
    if (o.status === 'APPLY_UNPROVEN') {
      out.push({ key: `verifier:${o.slug}:${at}`, slug: o.slug, company, kind: 'verifier', title: `Envoi à vérifier : ${company}`, detail: 'La candidature est peut-être partie : regarde ta boîte mail et la plateforme avant toute relance.' });
      continue;
    }
    if (o.status !== 'TAILORED' || !h || (h.stage !== 'route' && h.stage !== 'submit') || /Refused at the go|Not sent:/i.test(h.summary)) continue;
    let host = '';
    try {
      host = h.apply_url === '' ? '' : new URL(h.apply_url).hostname;
    } catch {
      /* pas d'adresse lisible */
    }
    if (ACCOUNT_WORDS.test(h.summary)) out.push({ key: `compte:${o.slug}:${at}`, slug: o.slug, company, kind: 'compte', title: `Compte à ouvrir : ${company}`, detail: `Le site de candidature${host ? ` (${host})` : ''} demande un compte. CV et lettre prêts : postule à la main, ou ouvre ton compte dans le navigateur du robot puis relance.` });
    else if (h.stage === 'route') out.push({ key: `main:${o.slug}:${at}`, slug: o.slug, company, kind: 'main', title: `À postuler à la main : ${company}`, detail: "Le robot n'a pas trouvé la page de candidature. CV et lettre prêts : postule depuis l'annonce." });
    else out.push({ key: `main:${o.slug}:${at}`, slug: o.slug, company, kind: 'main', title: `Formulaire à finir : ${company}`, detail: "Le robot n'a pas pu remplir le formulaire jusqu'au bout ; rien n'a été envoyé. L'onglet envoi dit ce qui manque." });
  }
  const order: AttentionKind[] = ['go', 'compte', 'main', 'verifier', 'panne'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

const xmlEscape = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/**
 * La notification Windows (toast) d'une alerte, par Windows PowerShell sans module : le script passe en
 * `-EncodedCommand` (UTF-16LE en base64), donc aucun guillemet du titre n'atteint la ligne de commande. Un
 * clic sur la notification ouvre `launch` (la fiche de l'offre dans le cockpit).
 */
export function toastCommand(title: string, body: string, launch: string): string[] {
  const xml = `<toast activationType="protocol" launch="${xmlEscape(launch)}"><visual><binding template="ToastGeneric"><text>${xmlEscape(title.slice(0, 120))}</text><text>${xmlEscape(body.slice(0, 240))}</text></binding></visual></toast>`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]',
    '[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${xml.replace(/'/g, "''")}')`,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join('\n');
  return ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

/**
 * `archon workflow run career-radar … --detach` : la relève des sources d'offres (système sans modèle,
 * `mutates_checkout: false`), même forme que career-triage. `sources` (noms séparés par des virgules) et
 * `env_file` ne sont passés que s'ils sont donnés : le système prend ses défauts.
 */
export function radarRunArgs(o: { harness: string; careerDir: string; sources?: string; envFile?: string }): string[] {
  const args = ['workflow', 'run', 'career-radar', '--cwd', o.harness, '--folder', '--input', `career_dir=${o.careerDir}`];
  if (o.sources !== undefined && o.sources.trim() !== '') args.push('--input', `sources=${o.sources.trim()}`);
  if (o.envFile !== undefined && o.envFile.trim() !== '') args.push('--input', `env_file=${o.envFile.trim()}`);
  args.push('--detach');
  return args;
}

/** Minutes entre deux relèves automatiques des sources, et délai de la première après le démarrage du cockpit. */
export const RADAR_EVERY_MINUTES = 15;
export const RADAR_FIRST_DELAY_MS = 60_000;

/**
 * La famille d'un statut de source du rapport de relève (`last_radar_report.json`), pour la pastille,
 * avec les règles de `sourceCounts` du radar (systems/.shared/radar.ts) : `ok` (`200`, `OK…`, `run lancé…`),
 * `warn` (`attente (prochain appel dans N min)`), sinon `bad` (`erreur réseau`, `clé absente (NOM)`, 4xx/5xx…).
 * Les statuts viennent du radar et ne nomment que des variables.
 */
export function radarSourceKind(status: unknown): 'ok' | 'warn' | 'bad' {
  const s = str(status).trim();
  if (s === '200' || /^OK\b/i.test(s) || /^run (lancé|Apify en cours)/.test(s)) return 'ok';
  if (/^attente/i.test(s)) return 'warn';
  return 'bad';
}

/** Une suite de 20 caractères et plus mêlant lettres et chiffres (ce à quoi ressemble une clé) est masquée : jamais une valeur de clé à l'écran. */
export function maskSecretLike(text: unknown): string {
  return str(text).slice(0, 160).replace(/[A-Za-z0-9_\-./+=]{20,}/g, (m) => (/[A-Za-z]/.test(m) && /\d/.test(m) ? '[valeur masquée]' : m));
}

export interface RadarSource {
  name: string;
  status: string;
  kind: 'ok' | 'warn' | 'bad';
  count: number;
  durationMs: number;
}

export interface RadarReport {
  at: string;
  sources: RadarSource[];
  rawCount: number;
  qualifiedCount: number;
  added: number;
  addedSlugs: string[];
  rejectedCount: number;
  /** Sources OK et en échec, telles que le radar les compte (`sources_ok`, `sources_failed`) ; recomptées par famille si le rapport ne les donne pas (une source en attente n'est ni l'un ni l'autre). */
  okCount: number;
  failedCount: number;
}

const int = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

/** `<career_dir>/last_radar_report.json` déjà parsé, normalisé ; null si ce n'est pas un rapport. */
export function readRadarReport(raw: unknown): RadarReport | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const sources: RadarSource[] = (Array.isArray(r.sources) ? r.sources : [])
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .map((s) => ({ name: maskSecretLike(s.name) || '?', status: maskSecretLike(s.status), kind: radarSourceKind(s.status), count: int(s.count), durationMs: int(s.duration_ms) }));
  return {
    at: str(r.at),
    sources,
    rawCount: int(r.raw_count),
    qualifiedCount: int(r.qualified_count),
    added: int(r.added),
    addedSlugs: Array.isArray(r.added_slugs) ? r.added_slugs.map((s) => str(s)).filter((s) => s !== '') : [],
    rejectedCount: int(r.rejected_count),
    okCount: typeof r.sources_ok === 'number' ? int(r.sources_ok) : sources.filter((s) => s.kind === 'ok').length,
    failedCount: typeof r.sources_failed === 'number' ? int(r.sources_failed) : sources.filter((s) => s.kind === 'bad').length,
  };
}

/** L'id du run dans la sortie de `workflow run --detach` (« Run id: … »). */
export function parseDetachedRunId(stdout: string): string | null {
  const m = /Run id:\s*(\S+)/i.exec(stdout);
  return m ? m[1]! : null;
}

/** `archon workflow approve <run>` ou `reject` ; le refus peut porter une raison (respond). */
/** Arrêter un run (bouton « Arrêter la candidature », 2026-11-11) : `cancel` arrête le processus qui le porte ; `abandon` le marque annulé quand plus rien ne le porte. */
export function stopArgs(runId: string, how: 'cancel' | 'abandon' = 'cancel'): string[] {
  return ['workflow', how, runId];
}

export function respondArgs(runId: string, decision: 'approve' | 'reject', text = ''): string[] {
  if (text.trim() === '') return ['workflow', decision, runId];
  return ['workflow', 'respond', runId, decision, text.trim()];
}

export interface RunRow {
  id: string;
  status: string;
  workflow_name?: string;
  started_at?: string | null;
  completed_at?: string | null;
  output_root?: string | null;
  metadata?: { inputs?: Record<string, unknown>; inputs_values?: Record<string, unknown> } | null;
  nodes?: { nodeId: string; state: string }[];
  attention?: unknown;
}

/** Les lignes de `archon workflow runs --json --verbose` (une ligne JSON par run, ou un tableau). */
export function parseRuns(stdout: string): RunRow[] {
  const text = stdout.trim();
  if (text === '') return [];
  const rows: RunRow[] = [];
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) push(v);
    } else if (value !== null && typeof value === 'object' && typeof (value as RunRow).id === 'string') {
      rows.push(value as RunRow);
    } else if (value !== null && typeof value === 'object' && Array.isArray((value as { runs?: unknown }).runs)) {
      push((value as { runs: unknown }).runs);
    }
  };
  try {
    push(JSON.parse(text));
    return rows;
  } catch {
    for (const line of text.split('\n')) {
      try {
        push(JSON.parse(line));
      } catch {
        /* une ligne de texte parmi le JSON : ignorée */
      }
    }
    return rows;
  }
}

/** Le slug d'une offre, lu dans les entrées du run (`metadata.inputs.slug`, ou le dossier `application=…/<slug>` d'interview-prep). */
export function slugOfRun(run: RunRow): string | null {
  const m = run.metadata;
  if (!m) return null;
  const v = m.inputs_values?.slug ?? m.inputs?.slug;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  const app = m.inputs_values?.application ?? m.inputs?.application;
  if (typeof app === 'string' && app.trim() !== '') return app.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null;
  return null;
}

/** Le dossier carrière d'un run (`career_dir` ; pour interview-prep, le grand-parent de `application=<carrière>/applications/<slug>`), ou null. */
export function careerDirOfRun(run: RunRow): string | null {
  const m = run.metadata;
  if (!m) return null;
  const v = m.inputs_values?.career_dir ?? m.inputs?.career_dir;
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  const app = m.inputs_values?.application ?? m.inputs?.application;
  if (typeof app === 'string' && app.trim() !== '') {
    const parts = app.trim().replace(/[\\/]+$/, '').split(/[\\/]/);
    if (parts.length >= 3 && parts[parts.length - 2] === 'applications') return parts.slice(0, -2).join(app.includes('\\') ? '\\' : '/');
  }
  return null;
}

/** Deux chemins désignent le même dossier (séparateurs, slash final ; casse ignorée sous Windows). */
export function samePath(a: string, b: string, platform: string = process.platform): boolean {
  const norm = (p: string): string => {
    const x = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' ? x.toLowerCase() : x;
  };
  return norm(a) === norm(b);
}

/**
 * Les runs de ce candidat : ceux dont `career_dir` est son dossier carrière, plus ceux que son
 * cockpit a lancés (`known`). Deux candidats peuvent avoir une offre au même slug, et leurs runs
 * tournent en même temps (un profil de navigateur chacun) : sans ce filtre, un cockpit verrait les
 * runs de l'autre et attendrait qu'ils finissent.
 */
export function runsOfCareer(rows: RunRow[], careerDir: string, known: Record<string, string> = {}, platform: string = process.platform): RunRow[] {
  const ids = new Set(Object.values(known));
  return rows.filter((r) => {
    const dir = careerDirOfRun(r);
    return dir !== null ? samePath(dir, careerDir, platform) : ids.has(r.id);
  });
}

/** Le run le plus récent par slug, parmi les runs d'un workflow (career-apply par défaut) ; `known` (slug → run id) couvre les runs que le cockpit a lancés. */
export function latestRunBySlug(rows: RunRow[], known: Record<string, string> = {}, workflow = 'career-apply'): Map<string, RunRow> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const idToSlug = new Map<string, string>();
  for (const [slug, id] of Object.entries(known)) idToSlug.set(id, slug);
  const latest = new Map<string, RunRow>();
  for (const run of rows) {
    if (run.workflow_name !== undefined && run.workflow_name !== workflow) continue;
    const slug = slugOfRun(run) ?? idToSlug.get(run.id) ?? null;
    if (slug === null) continue;
    const current = latest.get(slug);
    if (!current || str(run.started_at) > str(current.started_at)) latest.set(slug, run);
  }
  for (const [slug, id] of Object.entries(known)) {
    const run = byId.get(id);
    // Un run noté sous un autre workflow (la relève des sources, clé `#radar` de launches.json) n'est pas une candidature.
    if (!latest.has(slug) && run && (run.workflow_name === undefined || run.workflow_name === workflow)) latest.set(slug, run);
  }
  return latest;
}

/** Libellés des nœuds de career-apply (les nœuds d'un bloc inclus portent le préfixe `<include>__`, ceux d'une boucle non). */
export const NODE_LABELS: Record<string, string> = {
  load: "Lecture de l'offre et prise sur le tableau",
  tailor__produce: 'CV sur mesure : rédaction et contrôle',
  work: 'CV sur mesure : rédaction',
  check: 'CV sur mesure : contrôle',
  tailor__judge: 'Relecture du CV (juge, contexte vierge)',
  tailor__verdict: 'Verdict CV',
  letter__produce: 'Lettre de motivation : rédaction et contrôle',
  write_letter: 'Lettre de motivation : rédaction',
  check_letter: 'Lettre de motivation : contrôle',
  letter__judge: 'Relecture de la lettre (juge, contexte vierge)',
  letter__verdict: 'Verdict lettre',
  render: 'PDF du CV et de la lettre',
  route: 'Plateforme de candidature',
  resolve: 'Résolution du lien (navigateur)',
  confirm_route: 'Plateforme confirmée',
  submit__target: 'Page de candidature',
  submit__prepare: 'Préremplissage du formulaire',
  prefill: 'Préremplissage du formulaire',
  check_prefill: 'Contrôle du préremplissage',
  submit__gate: 'Porte avant envoi',
  submit__go: 'Ton go',
  submit__decide: 'Décision',
  submit__own: "Vérification que l'offre est toujours tenue",
  submit__arm: "Armement de l'envoi",
  submit__submit: 'Envoi',
  submit__check_receipt: 'Reçu',
  submit__judge: "Relecture de l'envoi (juge)",
  submit__verdict: 'Verdict envoi',
  record: 'Enregistrement sur le tableau',
  settle: 'Clôture',
  guard: "Garde d'annonce (expirée, suspecte ou saine)",
  tailor: 'CV sur mesure', letter: 'Lettre de motivation', submit: 'Candidature',
  tailor__write: 'CV sur mesure : rédaction', tailor__check: 'CV sur mesure : contrôle',
  // sorties de boucle génériques et interview-prep (workflow de premier niveau : ids sans préfixe)
  produce: 'Rédaction et contrôle', judge: 'Relecture (juge, contexte vierge)', verdict: 'Verdict',
  target: 'Page de candidature', prepare: 'Préremplissage du formulaire', gate: 'Porte avant envoi', go: 'Ton go', decide: 'Décision',
  own: "Vérification que l'offre est toujours tenue", arm: "Armement de l'envoi", submit__submit: 'Envoi', check_receipt: 'Reçu',
};

/** Libellés propres à un workflow, lus avant NODE_LABELS (le `record` de la relève n'est pas celui de career-apply). */
export const WORKFLOW_NODE_LABELS: Record<string, Record<string, string>> = {
  'career-radar': { collect: 'lecture des sources', screen: 'contrôles', record: 'fusion dans le tableau' },
  'decision-makers': { work: 'recherche des décideurs et messages', check: 'contrôle des sources et des messages', produce: 'recherche des décideurs et messages', judge: 'relecture (juge : sources rouvertes)', verdict: 'verdict' },
};

/** L'état d'une étape, en français (les états d'Archon sont en anglais). */
export const STEP_STATE_LABELS: Record<string, string> = {
  completed: 'faite', success: 'faite', succeeded: 'faite', done: 'faite',
  skipped: 'sautée',
  running: 'en cours', in_progress: 'en cours', started: 'en cours',
  waiting: 'attend', paused: 'attend', attention: 'attend', blocked: 'attend',
  pending: 'à venir', queued: 'à venir',
  failed: 'échec', error: 'échec', cancelled: 'annulée', canceled: 'annulée',
};

export function stepStateLabel(state: string): string {
  return own<string>(STEP_STATE_LABELS, String(state).toLowerCase()) ?? state;
}

/** La famille d'un état d'étape, pour la pastille : ok, bad, live, warn, ou rien (à venir, sautée). */
export function stepStateKind(state: string): 'ok' | 'bad' | 'live' | 'warn' | '' {
  const s = String(state).toLowerCase();
  if (s === 'skipped') return '';
  if (DONE_STATES.has(s)) return 'ok';
  if (FAILED_STATES.has(s)) return 'bad';
  if (RUNNING_STATES.has(s)) return 'live';
  if (WAITING_STATES.has(s)) return 'warn';
  return '';
}

export function nodeLabel(nodeId: string, workflow?: string): string {
  const short = nodeId.replace(/^.*__/, '');
  const scoped = workflow === undefined ? null : own(WORKFLOW_NODE_LABELS, workflow);
  const known = (scoped ? own<string>(scoped, nodeId) ?? own<string>(scoped, short) : null) ?? own<string>(NODE_LABELS, nodeId) ?? own<string>(NODE_LABELS, short);
  if (known) return known;
  // Un id jamais vu reste lisible : « submit__check_receipt » → « submit › check receipt ».
  return nodeId.split('__').map((part) => part.replace(/_/g, ' ')).join(' › ');
}

export interface Progress {
  total: number;
  done: number;
  failed: string[];
  running: string[];
  waiting: string | null;
}

const DONE_STATES = new Set(['completed', 'skipped', 'success', 'succeeded', 'done']);
const FAILED_STATES = new Set(['failed', 'error', 'cancelled', 'canceled']);
const RUNNING_STATES = new Set(['running', 'in_progress', 'started']);
const WAITING_STATES = new Set(['waiting', 'paused', 'attention', 'blocked']);

/** Où en est le run, d'après ses nœuds ; un nœud « waiting » est la pause (le go) qui attend Antoine. */
export function progress(run: RunRow): Progress {
  const nodes = run.nodes ?? [];
  const failed: string[] = [];
  const running: string[] = [];
  let waiting: string | null = null;
  let done = 0;
  for (const n of nodes) {
    const s = str(n.state).toLowerCase();
    if (DONE_STATES.has(s)) done += 1;
    else if (FAILED_STATES.has(s)) failed.push(n.nodeId);
    else if (RUNNING_STATES.has(s)) running.push(n.nodeId);
    else if (WAITING_STATES.has(s)) waiting = waiting ?? n.nodeId;
  }
  return { total: nodes.length, done, failed, running, waiting };
}

/** Le dossier d'artefacts d'un run (Archon : `<output_root>/artifacts/runs/<id>`), ou null si le run n'en a pas enregistré. */
export function artifactsDirOf(run: { id: string; output_root?: string | null }, join: (...parts: string[]) => string): string | null {
  const root = str(run.output_root).trim();
  if (root === '') return null;
  return join(root, 'artifacts', 'runs', run.id);
}

/** Les fichiers du dossier de candidature que la page affiche en texte. */
export function isTextFile(name: string): boolean {
  return /\.(md|json|txt|csv|html|log)$/i.test(name);
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'en cours',
  paused: 'en pause : ton go est attendu',
  waiting: 'en attente',
  completed: 'terminé',
  failed: 'échoué',
  cancelled: 'annulé',
  canceled: 'annulé',
  pending: 'démarre',
  queued: 'en file',
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

/** Un run encore vivant occupe la file : une candidature en vol à la fois (règle de prise du tableau). */
export function isLive(status: string): boolean {
  return ['running', 'paused', 'waiting', 'pending', 'queued'].includes(status);
}

export interface CockpitArgs {
  careerDir: string;
  harness: string | null;
  /** null : le port de `candidat.json`, sinon 8766. */
  port: number | null;
  archon: string[];
  mode: 'confirm' | 'auto' | 'verified-only';
  verifiedPlatforms: string;
  open: boolean;
  /** Commande de rafraîchissement depuis la VM (défaut : `pullArgs`, soit sync_pending.ps1 -Direction pull). */
  pull: string[] | null;
  /** Minutes entre deux rafraîchissements automatiques depuis la VM (0 : seulement sur le bouton). */
  pullEvery: number;
  /** Hôtes acceptés en plus de 127.0.0.1:<port> et localhost:<port> (`--allow-host`, répétable : un proxy privé devant le cockpit). */
  allowHosts: string[];
  /** Trier les offres en attente (career-triage, un run à la fois) quand `criteres.json` existe ; `--no-triage` l'arrête. */
  triage: boolean;
  /** Moteur du tri automatique : `rules` (défaut, 2026-10-30 : règles du code, aucun appel de modèle, forfait Claude intact) ou `llm` (bloc job-triage) ; `--triage-engine llm`. */
  triageEngine: 'rules' | 'local' | 'llm';
  /** Relever les sources d'offres (career-radar) : bouton et relève automatique ; `--no-radar` arrête les deux. */
  radar: boolean;
  /** Minutes entre deux relèves automatiques (défaut RADAR_EVERY_MINUTES ; 0 : seulement sur le bouton). */
  radarEvery: number;
  /** Notification Windows quand une offre attend Antoine (go, compte, envoi à vérifier) ; `--no-toast` l'arrête. */
  toast: boolean;
  /** Chercher les décideurs (bloc decision-makers, appels de modèle) tout seul dès qu'un CV est prêt : coupé par défaut depuis le 2026-10-30, `--contacts` l'allume (le bouton reste). */
  contacts: boolean;
}

/** `--career-dir <dossier>` (obligatoire), `--harness <dossier>`, `--port <n>` (défaut : `candidat.json`, sinon 8766), `--archon "<commande>"`, `--mode confirm`, `--verified-platforms …`, `--no-open`, `--pull "<commande>"`, `--pull-every 5`, `--allow-host <hôte[:port]>`, `--no-triage`, `--triage-engine rules|llm`, `--no-radar`, `--radar-every 15`, `--no-toast`, `--contacts` / `--no-contacts`. */
export function parseArgs(argv: string[]): CockpitArgs {
  const out: CockpitArgs = { careerDir: '', harness: null, port: null, archon: ['archon'], mode: 'confirm', verifiedPlatforms: '', open: true, pull: null, pullEvery: 5, allowHosts: [], triage: true, triageEngine: 'rules', radar: true, radarEvery: RADAR_EVERY_MINUTES, toast: true, contacts: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} attend une valeur`);
      i += 1;
      return v;
    };
    if (a === '--career-dir') out.careerDir = next();
    else if (a === '--harness') out.harness = next();
    else if (a === '--port') out.port = Number(next());
    else if (a === '--archon') out.archon = next().split(' ').filter(Boolean);
    else if (a === '--mode') {
      const m = next();
      if (m !== 'confirm' && m !== 'auto' && m !== 'verified-only') throw new Error(`--mode ${m} : confirm, auto ou verified-only`);
      out.mode = m;
    } else if (a === '--verified-platforms') out.verifiedPlatforms = next();
    else if (a === '--no-open') out.open = false;
    else if (a === '--pull') out.pull = next().split(' ').filter(Boolean);
    else if (a === '--pull-every') out.pullEvery = Number(next());
    else if (a === '--allow-host') out.allowHosts.push(next().trim().toLowerCase());
    else if (a === '--no-triage') out.triage = false;
    else if (a === '--triage-engine') {
      const e = next();
      if (e !== 'rules' && e !== 'local' && e !== 'llm') throw new Error(`--triage-engine ${e} : rules, local ou llm`);
      out.triageEngine = e;
    }
    else if (a === '--no-radar') out.radar = false;
    else if (a === '--radar-every') out.radarEvery = Number(next());
    else if (a === '--no-toast') out.toast = false;
    else if (a === '--no-contacts') out.contacts = false;
    else if (a === '--contacts') out.contacts = true;
    else throw new Error(`argument inconnu : ${a}`);
  }
  if (out.careerDir === '') throw new Error('--career-dir <dossier carrière, .local\\career du harness> est obligatoire');
  if (out.port !== null && (!Number.isInteger(out.port) || out.port < 0)) throw new Error('--port attend un entier (0 : un port libre)');
  if (!Number.isFinite(out.pullEvery) || out.pullEvery < 0) throw new Error('--pull-every attend un nombre de minutes (0 : jamais tout seul)');
  if (!Number.isFinite(out.radarEvery) || out.radarEvery < 0) throw new Error('--radar-every attend un nombre de minutes (0 : seulement sur le bouton)');
  return out;
}

/**
 * Une requête vient-elle de la page du cockpit ? Le serveur n'écoute que 127.0.0.1, mais une autre page ouverte
 * dans le navigateur peut viser 127.0.0.1 : un POST d'ailleurs (lancer, envoyer le go) ou une lecture par un nom
 * de domaine rebondi sur 127.0.0.1 doit être refusé. Règles : l'en-tête Host est un hôte accepté ; un POST porte
 * `content-type: application/json` (un autre site ne peut pas l'envoyer sans pré-vol, auquel rien ne répond) et,
 * quand le navigateur les donne, son Origin, sinon son Referer, désignent un hôte accepté. Un client sans
 * navigateur (curl, les tests) n'envoie ni l'un ni l'autre : il tourne déjà sur ce PC.
 * Rend la raison du refus, ou null.
 */
export function refusal(req: { method: string; host: string | null; origin: string | null; referer: string | null; contentType: string | null }, allowed: string[]): string | null {
  const ok = (host: string): boolean => allowed.includes(host.toLowerCase());
  if (req.host === null || !ok(req.host)) return `hôte non accepté : ${req.host ?? '(aucun)'}`;
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  if (!/^application\/json\b/i.test(req.contentType ?? '')) return 'content-type application/json attendu';
  const from = req.origin ?? req.referer;
  if (from === null) return null;
  let u: URL;
  try {
    u = new URL(from);
  } catch {
    return `origine illisible : ${from}`;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !ok(u.host)) return `requête venue d'une autre page : ${from}`;
  return null;
}

/**
 * Une adresse d'annonce que le cockpit peut ouvrir dans le navigateur par défaut du PC : http(s) seulement,
 * sans espace ni caractère de contrôle, 2 048 caractères au plus ; `null` sinon.
 */
export function openableUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * La commande qui ouvre `url` dans le navigateur par défaut, sans shell (une adresse avec « & » passe telle quelle) :
 * sous Windows `rundll32 url.dll,FileProtocolHandler`, sinon `open` / `xdg-open`.
 */
export function openerArgs(platform: string, url: string, chrome: string | null = null, profileDir: string | null = null): string[] {
  // Chrome d'Antoine (son profil à lui, pas celui du robot) ; `profileDir` : le profil Chrome choisi (chrome.json), sinon le dernier utilisé.
  if (platform === 'win32' && chrome !== null) return profileDir !== null ? [chrome, `--profile-directory=${profileDir}`, url] : [chrome, url];
  return platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : platform === 'darwin' ? ['open', url] : ['xdg-open', url];
}

/**
 * Chrome sous Windows, là où Google l'installe (machine, puis utilisateur) ; `null` s'il manque.
 * Le navigateur des agents (Playwright MCP) est Chrome : son profil ne s'ouvre qu'avec Chrome.
 */
export function chromePath(env: Record<string, string | undefined>, exists: (path: string) => boolean): string | null {
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
    if (!root) continue;
    const path = `${root}\\Google\\Chrome\\Application\\chrome.exe`;
    if (exists(path)) return path;
  }
  return null;
}

/**
 * Le dossier du profil Chrome (« Default », « Profile 3 »…) à qui `wanted` correspond, lu dans `Local State`
 * de Chrome (déjà parsé : `profile.info_cache`, une entrée par dossier avec `name`, `user_name`,
 * `gaia_name`). `wanted` est le nom du dossier, le nom du profil, son compte Google (e-mail, ou ce qui
 * précède @) ou le nom de la personne, sans casse ; à défaut d'égalité, le seul profil dont le nom ou le
 * compte contient `wanted`. Null : rien ne correspond, ou plusieurs profils à égalité de doute.
 */
export function chromeProfileDir(localState: unknown, wanted: string): string | null {
  const w = wanted.trim().toLowerCase();
  const cache = (localState as { profile?: { info_cache?: unknown } } | null)?.profile?.info_cache;
  if (w === '' || cache === null || typeof cache !== 'object' || Array.isArray(cache)) return null;
  const entries = Object.entries(cache as Record<string, Record<string, unknown>>).map(([dir, info]) => {
    const s = (k: string): string => (info && typeof info[k] === 'string' ? (info[k] as string).trim().toLowerCase() : '');
    const user = s('user_name');
    return { dir, names: [dir.toLowerCase(), s('name'), user, user.split('@')[0] ?? '', s('gaia_name')].filter((x) => x !== '') };
  });
  const exact = entries.filter((e) => e.names.includes(w));
  if (exact.length === 1) return exact[0]!.dir;
  if (exact.length > 1) return null;
  const partial = entries.filter((e) => e.names.some((n) => n.includes(w)));
  return partial.length === 1 ? partial[0]!.dir : null;
}

/** `chrome.json` du cockpit (`{"profil": "…"}`, à côté de la liste des runs) déjà parsé : le profil Chrome où s'ouvrent les annonces ; '' sans réglage. */
export function chromeProfileWanted(raw: unknown): string {
  const p = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).profil : undefined;
  return typeof p === 'string' ? p.trim() : '';
}

/**
 * La commande qui ouvre `url` dans le navigateur du robot (le profil de navigateur du candidat), sans shell :
 * Antoine y crée ou ouvre lui-même ses comptes candidats (Workday, SuccessFactors…), que les agents
 * réutilisent ensuite. Jamais pendant un run qui se sert du même profil.
 */
export function robotBrowserArgs(chrome: string, profile: string, url: string): string[] {
  return [chrome, `--user-data-dir=${profile}`, '--no-first-run', url];
}

/** La requête vient du PC lui-même (hôte 127.0.0.1 ou localhost du cockpit), pas du téléphone. */
export function isLocalHost(host: string | null, port: number): boolean {
  return host !== null && [`127.0.0.1:${port}`, `localhost:${port}`].includes(host.toLowerCase());
}

/** Les hôtes que le cockpit accepte : lui-même sur 127.0.0.1 et localhost, plus `--allow-host`. */
export function allowedHosts(port: number, extra: string[] = []): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, ...extra.map((h) => h.toLowerCase())];
}

/**
 * La commande qui rapatrie le tableau de la VM : `integrations/master-plan/sync_pending.ps1 -Direction pull`
 * (scp + fusion offre par offre sous le verrou du tableau ; rien ne part vers la VM), sur le dossier carrière
 * du cockpit (`-CareerDir`) ; PowerShell est `powershell` sous Windows, `pwsh` ailleurs.
 */
export function pullArgs(opts: { harness: string; careerDir: string; platform: string; join: (...parts: string[]) => string; resolve: (...parts: string[]) => string }): string[] {
  const shell = opts.platform === 'win32' ? 'powershell' : 'pwsh';
  const script = opts.join(opts.harness, 'integrations', 'master-plan', 'sync_pending.ps1');
  return [shell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Direction', 'pull', '-CareerDir', opts.resolve(opts.careerDir)];
}

/**
 * L'adéquation au cœur du poste, lue dans la note du tri (career-triage, `checkCoreFit`) : « Cœur du poste :
 * 2 exigences étayées, 1 en partie, 0 absente du profil, sur 3 ». Forte : au moins deux exigences étayées par
 * le profil et aucune absente ; faible : aucune étayée et au moins une absente ; moyenne entre les deux. Null :
 * pas de note (tri d'avant l'économe, ou adéquation non évaluée). Remplace le score du radar, qui ne départage
 * rien (75 à 95 pour toutes les offres du tableau).
 */
export interface CoreFit {
  level: 'forte' | 'moyenne' | 'faible';
  proven: number;
  partial: number;
  missing: number;
  total: number;
}
export function coreFit(notes: readonly unknown[] | null | undefined): CoreFit | null {
  for (const n of notes ?? []) {
    const m = /^Cœur du poste : (\d+) exigences? étayées?, (\d+) en partie, (\d+) absentes? du profil, sur (\d+)/.exec(String(n));
    if (!m) continue;
    const [proven, partial, missing, total] = m.slice(1).map(Number) as [number, number, number, number];
    if (total === 0) return null;
    const level = missing === 0 && proven >= 2 ? 'forte' : proven === 0 && missing > 0 ? 'faible' : 'moyenne';
    return { level, proven, partial, missing, total };
  }
  return null;
}

/** Les offres les plus récentes d'abord (date de publication, ou jour de l'ajout à la main, puis score), le reste dans l'ordre du tableau. */
export function sortOffers<T extends { date: string; score: number | null; added?: string; seen?: string }>(offers: T[]): T[] {
  // Une offre mise au tableau à la main se range au jour de son ajout, une offre du site de l'employeur au jour où
  // le radar l'a trouvée (Canonical garde ses postes ouverts des mois) ; les autres à leur date de publication.
  const day = (o: T): string => o.added || o.seen || o.date;
  return offers.map((o, i) => ({ o, i })).sort((a, b) => {
    if (day(a.o) !== day(b.o)) return day(a.o) < day(b.o) ? 1 : -1;
    const sa = a.o.score ?? -1;
    const sb = b.o.score ?? -1;
    if (sa !== sb) return sb - sa;
    return a.i - b.i;
  }).map((x) => x.o);
}

/** Une remarque, dans la forme de `/remarque` du bot (`[<ISO>] <texte>`), ajoutée à `applications/<slug>/remarques_utilisateur.txt` ; `load` la lit au prochain run sur l'offre. */
export function remarkEntry(text: string, now: Date): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean === '') throw new Error('remarque vide');
  return `[${now.toISOString()}] ${clean}\n`;
}

export interface Remark {
  at: string;
  text: string;
}

/** Les remarques d'un fichier, une par entrée `[<ISO>] …` (une ligne sans en-tête prolonge la précédente, ou vaut une entrée sans date). */
export function parseRemarks(content: string): Remark[] {
  const out: Remark[] = [];
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\[([^\]]+)\]\s?(.*)$/.exec(line);
    if (m) out.push({ at: m[1]!, text: m[2]! });
    else if (line.trim() === '') continue;
    else if (out.length > 0) out[out.length - 1]!.text += `\n${line}`;
    else out.push({ at: '', text: line });
  }
  return out;
}

/**
 * Un candidat du cockpit, lu dans `<career_dir>/candidat.json` (facultatif). Sans ce fichier,
 * c'est le candidat d'origine (Antoine) : profil de navigateur `.local/browser-profile`, runs notés
 * dans `.local/cockpit/launches.json`, tableau rafraîchi depuis la VM. Avec, chaque candidat a son
 * nom, son port, son profil de navigateur (ses connexions à lui ou elle, jamais celles de l'autre),
 * ses runs notés à part, et `pull: "none"` quand son tableau ne vient pas de la VM.
 */
export interface Candidate {
  /** Identifiant court (lettres, chiffres, - et _) : nomme le profil de navigateur et le dossier des runs. */
  id: string | null;
  /** Le prénom affiché dans le cockpit. */
  name: string;
  port: number | null;
  /** Profil de navigateur des candidatures (absolu, ou relatif au dossier du harness) ; null : celui par défaut. */
  browserProfile: string | null;
  pull: 'vm' | 'none';
  /** Logins Tailscale autorisés à ouvrir ce cockpit depuis un téléphone (lu par l'accès distant). */
  allowUsers: string[];
  /** Relève automatique des sources (career-radar) toutes les RADAR_EVERY_MINUTES ; `radar_auto: false` la coupe (le bouton reste). */
  radarAuto: boolean;
}

export const LEGACY_CANDIDATE: Candidate = { id: null, name: '', port: null, browserProfile: null, pull: 'vm', allowUsers: [], radarAuto: true };

const CANDIDATE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** `candidat.json` déjà parsé (null : fichier absent). Refuse un fichier mal formé plutôt que de deviner. */
export function readCandidate(raw: unknown): Candidate {
  if (raw === null || raw === undefined) return { ...LEGACY_CANDIDATE };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('candidat.json doit être un objet JSON');
  const o = raw as Record<string, unknown>;
  const id = o.id;
  if (typeof id !== 'string' || !CANDIDATE_ID.test(id)) throw new Error('candidat.json : "id" obligatoire, en minuscules (lettres, chiffres, - et _), 32 caractères au plus');
  const name = typeof o.nom === 'string' && o.nom.trim() !== '' ? o.nom.trim() : id;
  let port: number | null = null;
  if (o.port !== undefined && o.port !== null) {
    if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('candidat.json : "port" doit être un entier entre 1 et 65535');
    port = o.port;
  }
  let browserProfile: string | null = null;
  if (o.profil_navigateur !== undefined && o.profil_navigateur !== null) {
    if (typeof o.profil_navigateur !== 'string' || o.profil_navigateur.trim() === '') throw new Error('candidat.json : "profil_navigateur" doit être un chemin');
    browserProfile = o.profil_navigateur.trim();
  }
  const pull = o.tableau_depuis_vm === true ? 'vm' : 'none';
  const allow = o.acces_telephone;
  const allowUsers = Array.isArray(allow) ? allow.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
  if (o.radar_auto !== undefined && o.radar_auto !== null && typeof o.radar_auto !== 'boolean') throw new Error('candidat.json : "radar_auto" doit être true ou false');
  const radarAuto = o.radar_auto !== false;
  return { id, name, port, browserProfile, pull, allowUsers, radarAuto };
}

/** Où vont le profil de navigateur et la liste des runs lancés de ce candidat, sous le dossier du harness. */
export function candidatePaths(c: Candidate, harness: string, join: (...parts: string[]) => string, isAbsolute: (p: string) => boolean): { browserProfile: string; launches: string } {
  const local = join(harness, '.local');
  const browserProfile = c.browserProfile !== null
    ? (isAbsolute(c.browserProfile) ? c.browserProfile : join(harness, c.browserProfile))
    : join(local, c.id === null ? 'browser-profile' : `browser-profile-${c.id}`);
  const launches = c.id === null ? join(local, 'cockpit', 'launches.json') : join(local, 'cockpit', c.id, 'launches.json');
  return { browserProfile, launches };
}

/**
 * Le radar unifié de la VM (`integrations/vm-radar/radar-vm.ts`) est-il vivant ? Oui quand son état
 * (`vm_radar_status.json`, rapatrié avec le tableau) date de moins de `maxAgeMin` minutes (60) :
 * le cockpit ne lance alors plus de relève automatique depuis le PC (le bouton reste).
 */
export function vmRadarAlive(status: unknown, now: Date, maxAgeMin = 60): { alive: boolean; reason: string; at: string | null } {
  const at = status !== null && typeof status === 'object' && typeof (status as { at?: unknown }).at === 'string' ? (status as { at: string }).at : null;
  const t = at === null ? Number.NaN : Date.parse(at);
  if (Number.isNaN(t)) return { alive: false, reason: 'pas de radar sur la VM', at: null };
  const age = Math.round((now.getTime() - t) / 60_000);
  return age <= maxAgeMin ? { alive: true, reason: `relève faite par le radar de la VM (dernier cycle il y a ${age} min)`, at } : { alive: false, reason: `radar de la VM silencieux depuis ${age} min : relève depuis le PC`, at };
}

