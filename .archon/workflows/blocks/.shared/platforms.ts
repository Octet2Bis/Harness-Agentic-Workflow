/**
 * Les plateformes de candidature : reconnaître où une offre se postule, décider si
 * l'envoi est automatique ou attend un « go », reconnaître une confirmation d'envoi.
 * Pur : une table et des fonctions, testables à l'unité.
 *
 * Deux familles :
 * - les ATS (Lever, Greenhouse, Ashby, Workable, …) : la candidature se dépose sur un
 *   formulaire public ; c'est là qu'on postule ;
 * - les agrégateurs (LinkedIn, Himalayas, RemoteOK, …) : ils pointent vers l'ATS réel. On
 *   ne postule pas là, on y résout l'URL de candidature (sauf LinkedIn « Candidature
 *   simplifiée », qui est un formulaire LinkedIn).
 *
 * Et, pour apply-submit : où s'ouvre le formulaire d'une annonce (`applicationForm` : l'iframe
 * Greenhouse, le suffixe `/apply` de Lever, le compte Workday qu'on ne crée jamais…), et sur
 * quels hôtes l'agent a le droit de saisir et de cliquer (`hostPolicy`, `pageHostProblems` :
 * l'hôte exact ou un vrai sous-domaine, jamais un sosie, jamais hors https).
 */

export type ApplyMethod = 'form' | 'easy_apply' | 'email' | 'manual';

export interface Platform {
  id: string;
  label: string;
  /** Suffixes d'hôte reconnus (`host === suffix` ou `host` finit par `.suffix`). */
  hosts: string[];
  method: ApplyMethod;
  aggregator: boolean;
  /** Le formulaire exige un compte (et donc une session de navigateur déjà connectée). */
  needsAccount: boolean;
  /** Fragments (en minuscules) qu'une page de confirmation contient sur cette plateforme. */
  confirmation: string[];
  /**
   * Le harness ne remplit jamais ce formulaire : la raison, en français. Workday : un compte
   * propre à chaque employeur, qu'on ne crée jamais, puis un assistant en plusieurs pages.
   */
  handover?: string;
}

export const GENERIC_CONFIRMATION: string[] = [
  'application submitted',
  'application has been submitted',
  'application received',
  "we've received your application",
  'we have received your application',
  'thank you for applying',
  'thanks for applying',
  'thank you for your application',
  'your application was sent',
  'candidature envoyée',
  'candidature a bien été envoyée',
  'candidature a été envoyée',
  'candidature a bien été transmise',
  'nous avons bien reçu votre candidature',
  'merci pour votre candidature',
  'merci d’avoir postulé',
  "merci d'avoir postulé",
];

export const PLATFORMS: Platform[] = [
  { id: 'lever', label: 'Lever', hosts: ['jobs.lever.co', 'jobs.eu.lever.co'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['application submitted', 'thank you for applying'] },
  { id: 'greenhouse', label: 'Greenhouse', hosts: ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards.eu.greenhouse.io', 'job-boards.eu.greenhouse.io'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application has been submitted'] },
  { id: 'ashby', label: 'Ashby', hosts: ['jobs.ashbyhq.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['application submitted', 'thank you for applying'] },
  { id: 'workable', label: 'Workable', hosts: ['apply.workable.com', 'jobs.workable.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application submitted'] },
  { id: 'smartrecruiters', label: 'SmartRecruiters', hosts: ['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application has been submitted'] },
  { id: 'teamtailor', label: 'Teamtailor', hosts: ['teamtailor.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for your application', 'application received'] },
  { id: 'personio', label: 'Personio', hosts: ['jobs.personio.de', 'jobs.personio.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for your application', 'application has been submitted'] },
  { id: 'recruitee', label: 'Recruitee', hosts: ['recruitee.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application received'] },
  { id: 'jobvite', label: 'Jobvite', hosts: ['jobs.jobvite.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying'] },
  { id: 'bamboohr', label: 'BambooHR', hosts: ['bamboohr.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application has been submitted'] },
  // Adapté de proficiently-claude-skills/shared/references/ats-patterns.md (MIT) : Workday exige un compte avant l'assistant en six pages, et créer un compte est interdit à l'automate.
  // Antoine, 2026-10-24 : il crée lui-même le compte dans le navigateur du robot, qui remplit ensuite connecté.
  {
    id: 'workday',
    label: 'Workday',
    hosts: ['myworkdayjobs.com'],
    method: 'form',
    aggregator: false,
    needsAccount: true,
    confirmation: ['application submitted', 'thank you for applying'],
  },
  // SAP SuccessFactors et Oracle Taleo : même cas que Workday, un compte candidat propre à l'employeur
  // avant le formulaire (Dana, 2026-10-24 : jobs.dana.com renvoie vers career4.successfactors.com).
  {
    id: 'successfactors',
    label: 'SAP SuccessFactors',
    hosts: ['successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu'],
    method: 'form',
    aggregator: false,
    needsAccount: true,
    confirmation: ['application submitted', 'thank you for applying'],
  },
  {
    id: 'taleo',
    label: 'Oracle Taleo',
    hosts: ['taleo.net'],
    method: 'form',
    aggregator: false,
    needsAccount: true,
    confirmation: ['application submitted', 'thank you for applying'],
  },
  { id: 'icims', label: 'iCIMS', hosts: ['icims.com'], method: 'form', aggregator: false, needsAccount: false, confirmation: ['thank you for applying', 'application has been submitted'] },
  { id: 'wttj', label: 'Welcome to the Jungle', hosts: ['welcometothejungle.com'], method: 'form', aggregator: false, needsAccount: true, confirmation: ['candidature envoyée', 'candidature a bien été envoyée', 'application sent'] },
  { id: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'], method: 'easy_apply', aggregator: true, needsAccount: true, confirmation: ['your application was sent', 'candidature envoyée', 'application sent to'] },
  { id: 'himalayas', label: 'Himalayas', hosts: ['himalayas.app'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'remoteok', label: 'RemoteOK', hosts: ['remoteok.com', 'remoteok.io'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'remotive', label: 'Remotive', hosts: ['remotive.com', 'remotive.io'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'workingnomads', label: 'Working Nomads', hosts: ['workingnomads.com'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'weworkremotely', label: 'We Work Remotely', hosts: ['weworkremotely.com'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'jobspresso', label: 'Jobspresso', hosts: ['jobspresso.co'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'arbeitnow', label: 'Arbeitnow', hosts: ['arbeitnow.com'], method: 'manual', aggregator: true, needsAccount: false, confirmation: [] },
  { id: 'indeed', label: 'Indeed', hosts: ['indeed.com', 'indeed.fr'], method: 'manual', aggregator: true, needsAccount: true, confirmation: [] },
  { id: 'glassdoor', label: 'Glassdoor', hosts: ['glassdoor.com', 'glassdoor.fr'], method: 'manual', aggregator: true, needsAccount: true, confirmation: [] },
];

export interface Route {
  platform: string;
  label: string;
  method: ApplyMethod;
  aggregator: boolean;
  needsAccount: boolean;
  host: string;
}

export const UNKNOWN_ROUTE: Omit<Route, 'host'> = { platform: 'unknown', label: 'Unknown site', method: 'form', aggregator: false, needsAccount: false };

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function platformFor(url: string): Platform | null {
  const host = hostOf(url);
  if (host === '') return null;
  return PLATFORMS.find((platform) => platform.hosts.some((suffix) => hostMatches(host, suffix))) ?? null;
}

/** Où l'URL mène : une plateforme connue (ATS ou agrégateur) ou un site inconnu (le site carrière de l'entreprise, le plus souvent). */
export function detectRoute(url: string): Route {
  const host = hostOf(url);
  const platform = platformFor(url);
  if (platform === null) return { ...UNKNOWN_ROUTE, host };
  return { platform: platform.id, label: platform.label, method: platform.method, aggregator: platform.aggregator, needsAccount: platform.needsAccount, host };
}

/** Un `mailto:` est une candidature par e-mail ; on la reconnaît sans passer par `URL.host`. */
export function isMailto(url: string): boolean {
  return /^mailto:[^@\s]+@[^@\s]+$/i.test(url.trim());
}

/**
 * Une URL où l'on peut effectivement déposer la candidature : https, pas un agrégateur
 * (sauf LinkedIn « Candidature simplifiée » annoncée comme telle), ou un mailto.
 */
export function applyUrlProblems(url: string, options: { easyApply?: boolean } = {}): string[] {
  const problems: string[] = [];
  const trimmed = url.trim();
  if (trimmed === '') return ['apply URL is empty'];
  if (isMailto(trimmed)) return [];
  if (!/^https:\/\//i.test(trimmed)) problems.push(`apply URL is not https: ${trimmed}`);
  const route = detectRoute(trimmed);
  if (route.host === '') problems.push(`apply URL is not a valid URL: ${trimmed}`);
  if (route.aggregator && !(route.platform === 'linkedin' && options.easyApply === true)) {
    problems.push(`apply URL still points at an aggregator (${route.label}); resolve the employer's real application page first`);
  }
  return problems;
}

/** La page lue après l'envoi contient-elle une confirmation reconnue ? Renvoie le fragment trouvé, ou null. */
export function confirmationFound(pageText: string, platformId: string): string | null {
  const text = pageText.toLowerCase();
  const specific = PLATFORMS.find((platform) => platform.id === platformId)?.confirmation ?? [];
  for (const fragment of [...specific, ...GENERIC_CONFIRMATION]) {
    if (text.includes(fragment)) return fragment;
  }
  return null;
}

export type SubmitMode = 'confirm' | 'auto' | 'verified-only';

/**
 * Faut-il attendre un « go » humain avant le clic final ?
 * - `confirm` : toujours ;
 * - `auto` : jamais ;
 * - `verified-only` : seulement tant que la plateforme n'est pas dans la liste des
 *   plateformes vérifiées (un envoi supervisé réussi l'y fait entrer).
 */
export function needsHumanGo(mode: SubmitMode, platformId: string, verified: string[]): boolean {
  if (mode === 'confirm') return true;
  if (mode === 'auto') return false;
  return !verified.includes(platformId);
}

/** Le mode lu dans une liaison : `auto`, `confirm`, sinon `verified-only` (le plus prudent des deux autres). */
export function parseSubmitMode(raw: string): SubmitMode {
  const mode = raw.trim();
  return mode === 'auto' || mode === 'confirm' ? mode : 'verified-only';
}

/** `verified_platforms` : une liste séparée par des virgules, sans les vides. */
export function parseVerifiedPlatforms(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

// ── Le formulaire : où l'ouvrir, et derrière quoi ─────────────────────────────────────

/** Ce qu'un script sait de la page de candidature à partir de son URL seule (nœud `target`). */
export interface ApplicationForm {
  /** La plateforme reconnue sur l'URL, sinon celle que l'appelant a résolue, sinon `unknown`. */
  platform: string;
  /** L'URL à ouvrir pour remplir le formulaire ; vide quand il n'y a rien à ouvrir. */
  form_url: string;
  /** Le formulaire est derrière une connexion à un compte (la session du profil de navigateur, jamais un compte créé). */
  needs_login: boolean;
  /** Le harness ne remplit pas ce formulaire : Antoine postule à la main (Workday). */
  handover: boolean;
  /** En français : comment on atteint le formulaire, pour l'agent et pour l'humain. */
  how: string;
}

const segmentsOf = (url: URL): string[] => url.pathname.split('/').filter((segment) => segment !== '');

/**
 * Greenhouse : le formulaire d'une annonce vit souvent dans un iframe (`grnhse_iframe`)
 * qu'un navigateur piloté ne lit pas ; sa page `embed/job_app` s'ouvre seule, au premier plan.
 * `boards.greenhouse.io/<board>/jobs/<id>`, `job-boards.greenhouse.io/<board>/jobs/<id>`,
 * `…/<board>?gh_jid=<id>` et `…/embed/job_app?for=<board>&token=<id>` y mènent ; l'UE garde son hôte.
 */
// Adapté de proficiently-claude-skills/shared/references/ats-patterns.md (MIT) : URL directe du formulaire Greenhouse hors de l'iframe.
export function greenhouseFormUrl(url: URL): string | null {
  const segments = segmentsOf(url);
  let board = '';
  let job = '';
  if (segments[0] === 'embed' && segments[1] === 'job_app') {
    board = url.searchParams.get('for') ?? '';
    job = url.searchParams.get('token') ?? '';
  } else if (segments.length >= 3 && segments[1] === 'jobs') {
    board = segments[0]!;
    job = segments[2]!;
  } else if (segments.length === 1) {
    board = segments[0]!;
    job = url.searchParams.get('gh_jid') ?? '';
  }
  if (!/^[A-Za-z0-9_-]+$/.test(board) || !/^\d+$/.test(job)) return null;
  const host = url.hostname.includes('.eu.') ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io';
  return `https://${host}/embed/job_app?for=${board}&token=${job}`;
}

/** L'annonce `/<a>/<b>` devient `/<a>/<b>/<suffixe>` (Lever `apply`, Ashby `application`) ; déjà suffixée, elle reste. */
function suffixed(url: URL, depth: number, suffix: string): string | null {
  const segments = segmentsOf(url);
  if (segments.length === depth + 1 && segments[depth] === suffix) return `${url.origin}/${segments.join('/')}${url.search}`;
  if (segments.length !== depth) return null;
  return `${url.origin}/${segments.join('/')}/${suffix}${url.search}`;
}

/**
 * Où et comment ouvrir le formulaire de candidature d'une URL : le résultat d'un script, que
 * l'agent `prefill` suit au lieu de le deviner. Pur.
 * - Greenhouse : la page `embed/job_app` (le formulaire hors de l'iframe) ;
 * - Lever : l'annonce + `/apply` ; Ashby : + `/application` ; Workable : + `/apply/` ;
 * - Workday : `handover` (compte propre à l'employeur, jamais créé) : on s'arrête, Antoine postule ;
 * - Welcome to the Jungle, LinkedIn, Indeed… : `needs_login` (la session du profil de navigateur) ;
 * - un agrégateur autre que LinkedIn n'est pas un formulaire : rien à ouvrir ;
 * - le site de l'employeur : l'URL telle quelle, avec la marche à suivre s'il embarque un ATS.
 */
export function applicationForm(url: string, platformHint = 'unknown'): ApplicationForm {
  const raw = url.trim();
  const hint = platformHint.trim() || 'unknown';
  if (isMailto(raw)) return { platform: 'email', form_url: '', needs_login: false, handover: false, how: 'Candidature par e-mail : pas de formulaire à remplir.' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { platform: hint, form_url: '', needs_login: false, handover: false, how: `URL de candidature illisible (« ${raw} ») : rien à ouvrir.` };
  }
  // Les URL se dérivent de la plateforme reconnue sur l'URL ; celle de l'appelant ne dit que
  // le compte et le passage de main (une page carrière devant Workday reste un Workday).
  const detected = platformFor(raw);
  const entry = detected ?? PLATFORMS.find((platform) => platform.id === hint) ?? null;
  const platform = entry?.id ?? hint;
  const needsLogin = entry?.needsAccount ?? false;
  const unsafe = urlSafetyProblems(raw, "L'URL de candidature");
  if (unsafe.length > 0) return { platform, form_url: '', needs_login: needsLogin, handover: false, how: `${unsafe.join(' ; ')} : rien à ouvrir.` };
  const form = (formUrl: string | null, how: string, more: Partial<ApplicationForm> = {}): ApplicationForm => ({
    platform,
    form_url: formUrl ?? parsed.href,
    needs_login: needsLogin,
    handover: false,
    how,
    ...more,
  });
  if (entry?.handover) return form(null, entry.handover, { handover: true });
  switch (detected?.id) {
    case 'workday': {
      // Adapté de proficiently-claude-skills/shared/references/ats-patterns.md (MIT) : la page de candidature Workday est l'annonce suivie de `/apply`.
      const onPosting = !/\/apply(?:\/|$)/.test(parsed.pathname) && segmentsOf(parsed).includes('job');
      return form(onPosting ? `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/apply` : null, "Workday : compte candidat propre à cet employeur, que le robot ne crée jamais. Il remplit avec la session qu'Antoine a ouverte lui-même dans le navigateur du robot ; une page de connexion, de création de compte ou de confirmation par e-mail : on s'arrête, Antoine crée le compte ou s'y connecte dans ce navigateur, puis relance.");
    }
    case 'successfactors':
      return form(null, "SAP SuccessFactors : compte candidat propre à cet employeur, que le robot ne crée jamais. Il remplit avec la session qu'Antoine a ouverte lui-même dans le navigateur du robot ; une page de connexion, de création de compte ou de confirmation par e-mail : on s'arrête, Antoine crée le compte ou s'y connecte dans ce navigateur, puis relance.");
    case 'taleo':
      return form(null, "Oracle Taleo : compte candidat propre à cet employeur, que le robot ne crée jamais. Il remplit avec la session qu'Antoine a ouverte lui-même dans le navigateur du robot ; une page de connexion, de création de compte ou de confirmation par e-mail : on s'arrête, Antoine crée le compte ou s'y connecte dans ce navigateur, puis relance.");
    case 'greenhouse': {
      const direct = greenhouseFormUrl(parsed);
      return form(
        direct,
        direct === null
          ? "Greenhouse : pas d'identifiant d'annonce dans l'URL ; ouvrir l'annonce et suivre « Apply for this job »."
          : "Greenhouse : le formulaire de l'annonce vit souvent dans un iframe ; on ouvre directement sa page embed/job_app, au premier plan."
      );
    }
    case 'lever': {
      // Adapté de proficiently-claude-skills/shared/references/ats-patterns.md (MIT) : formulaire Lever = annonce + /apply, sans iframe.
      const direct = suffixed(parsed, 2, 'apply');
      return form(direct, direct === null ? "Lever : ouvrir l'annonce et suivre « Apply for this job »." : "Lever : le formulaire est l'annonce suivie de /apply, sur la page même (pas d'iframe).");
    }
    case 'ashby': {
      const direct = suffixed(parsed, 2, 'application');
      return form(direct, direct === null ? "Ashby : ouvrir l'annonce et suivre « Apply for this job »." : "Ashby : le formulaire est l'annonce suivie de /application.");
    }
    case 'workable': {
      const segments = segmentsOf(parsed);
      const onApply = parsed.hostname === 'apply.workable.com' && segments[1] === 'j' && segments.length >= 3;
      const direct = onApply ? `${parsed.origin}/${segments.slice(0, 3).join('/')}/apply/` : null;
      return form(direct, direct === null ? "Workable : ouvrir l'annonce et suivre « Apply for this job »." : "Workable : le formulaire est l'annonce suivie de /apply/.");
    }
    case 'smartrecruiters':
      return form(null, "SmartRecruiters : ouvrir l'annonce et suivre « I'm interested » / « Postuler » ; le formulaire s'ouvre sur jobs.smartrecruiters.com.");
    case 'wttj':
      return form(null, "Welcome to the Jungle : bouton « Postuler » de l'annonce ; il faut la session du compte, déjà ouverte dans le profil du navigateur. Une demande de connexion ou de création de compte : on s'arrête.");
    case 'linkedin':
      return form(null, "LinkedIn « Candidature simplifiée » : il faut la session du compte, déjà ouverte dans le profil du navigateur. Une demande de connexion : on s'arrête.");
    default:
      break;
  }
  if (detected?.aggregator) {
    return form('', `${detected.label} est un agrégateur : on n'y postule pas ; la page de candidature de l'employeur doit être résolue d'abord (career-apply, nœud resolve).`);
  }
  if (detected !== null) {
    return form(null, `${detected.label} : ouvrir l'annonce et suivre son bouton de candidature.${detected.needsAccount ? " Il faut la session d'un compte déjà ouverte dans le profil du navigateur ; sinon on s'arrête." : ''}`);
  }
  const ghJob = parsed.searchParams.get('gh_jid');
  const embedded =
    ghJob !== null && /^\d+$/.test(ghJob)
      ? ` Cette page embarque Greenhouse (gh_jid=${ghJob}) : lire l'attribut src de l'iframe grnhse_iframe et ouvrir https://job-boards.greenhouse.io/embed/job_app?for=<for>&token=<token> avec ses paramètres.`
      : " Si la page embarque Greenhouse (iframe grnhse_iframe), ouvrir https://job-boards.greenhouse.io/embed/job_app?for=<for>&token=<token> avec les paramètres de son attribut src ; si elle mène à un autre ATS connu, ouvrir le formulaire de celui-ci.";
  return form(null, `Site de l'employeur : suivre son lien de candidature.${embedded}`);
}

// ── Les hôtes où l'agent saisit et clique ─────────────────────────────────────────────

/**
 * Les hôtes où l'agent peut remplir le formulaire et cliquer : chacun vaut pour lui-même et
 * ses vrais sous-domaines (`greenhouse.io` autorise `job-boards.greenhouse.io`, jamais
 * `greenhouse.io.evil.com` ni `greenhouse-io.com`).
 */
export interface HostPolicy {
  /** La plateforme, pour les messages. */
  platform: string;
  hosts: string[];
}

/** Les hôtes des ATS (pas des agrégateurs) : un site carrière y renvoie souvent son formulaire. */
export const ATS_HOSTS: string[] = PLATFORMS.filter((platform) => !platform.aggregator).flatMap((platform) => platform.hosts);

/** On ne remplit jamais un formulaire sur un agrégateur, sauf LinkedIn « Candidature simplifiée ». */
const fillable = (platform: Platform | undefined | null): platform is Platform => !!platform && (!platform.aggregator || platform.id === 'linkedin');

/**
 * Les hôtes autorisés pour une candidature : ceux de la plateforme (donnée par l'appelant, ou
 * reconnue sur l'URL), l'hôte de l'URL de candidature elle-même (sans `www.`), et, pour le site
 * d'un employeur, ceux des ATS connus, où son lien « Postuler » mène souvent. Jamais un
 * agrégateur (sauf LinkedIn « Candidature simplifiée »), jamais l'hôte d'une URL douteuse
 * (http, sosie…) ; rien pour un mailto. Pur.
 */
// Adapté de ai-job-search/.claude/commands/apply.md (MIT) : liste d'apex ATS, l'hôte exact ou un sous-domaine, les sosies échouent fermés.
export function hostPolicy(applyUrl: string, platformId = 'unknown'): HostPolicy {
  const raw = applyUrl.trim();
  if (isMailto(raw) || platformId === 'email') return { platform: 'email', hosts: [] };
  const given = PLATFORMS.find((platform) => platform.id === platformId);
  const detected = platformFor(raw);
  const platform = detected?.id ?? (given ? given.id : platformId || 'unknown');
  const hosts: string[] = [];
  for (const known of [given, detected]) if (fillable(known)) hosts.push(...known.hosts);
  if (urlSafetyProblems(raw, 'url').length === 0 && (detected === null || fillable(detected))) {
    const own = new URL(raw).hostname.replace(/^www\./, '');
    if (!hostAllowed(own, hosts)) hosts.push(own);
  }
  if (!fillable(given) && !fillable(detected)) hosts.push(...ATS_HOSTS);
  return { platform, hosts: [...new Set(hosts)] };
}

/** `host` est l'un des hôtes autorisés, ou l'un de leurs vrais sous-domaines. */
export function hostAllowed(host: string, hosts: string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * Ce qui rend une URL douteuse avant même de regarder l'hôte : pas https, des identifiants
 * avant l'hôte (`https://greenhouse.io@evil.com`), un port explicite, un hôte en punycode
 * (IDN : un sosie visuel d'un hôte connu), une adresse IP, un point final. `what` nomme la
 * page dans le message, en français. Pur.
 */
export function urlSafetyProblems(url: string, what: string): string[] {
  const raw = url.trim();
  if (raw === '') return [`${what} : URL vide, son hôte ne peut pas être vérifié`];
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return [`${what} : URL illisible (« ${raw} »)`];
  }
  if (parsed.protocol !== 'https:') return [`${what} n'est pas en https (« ${raw} ») : jamais de saisie ni de clic hors https`];
  const problems: string[] = [];
  const host = parsed.hostname;
  if (parsed.username !== '' || parsed.password !== '') problems.push(`${what} porte des identifiants avant l'hôte (« …@${host} ») : leurre classique, refusé`);
  if (parsed.port !== '') problems.push(`${what} : port explicite (${parsed.port}), refusé`);
  if (host.split('.').some((label) => label.startsWith('xn--'))) problems.push(`${what} : hôte en punycode (« ${host} », nom internationalisé), sosie possible d'un hôte connu, refusé`);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) problems.push(`${what} : l'hôte est une adresse IP, refusé`);
  if (host.endsWith('.')) problems.push(`${what} : hôte terminé par un point (« ${host} »), refusé`);
  return problems;
}

/**
 * La page où l'agent saisit ou clique est-elle sur un hôte autorisé ? Les problèmes, en
 * français (vide : elle l'est). Pur.
 */
export function pageHostProblems(pageUrl: string, policy: HostPolicy, what: string): string[] {
  const unsafe = urlSafetyProblems(pageUrl, what);
  if (unsafe.length > 0) return unsafe;
  const host = new URL(pageUrl.trim()).hostname;
  if (hostAllowed(host, policy.hosts)) return [];
  const shown = policy.hosts.slice(0, 6).join(', ') + (policy.hosts.length > 6 ? `… (+${policy.hosts.length - 6})` : '');
  const target = policy.platform === 'unknown' ? "ce site d'employeur" : policy.platform;
  return [
    `${what} est sur « ${host} », hors des hôtes autorisés pour ${target} (${shown || 'aucun'}) : ni saisie ni clic ailleurs ; un sosie (greenhouse.io.evil.com, greenhouse-io.com…) ne passe jamais`,
  ];
}

/** La plateforme d'une page qui exige de passer la main (Workday) : sa raison, sinon null. */
export function handoverFor(pageUrl: string): string | null {
  return platformFor(pageUrl.trim())?.handover ?? null;
}
