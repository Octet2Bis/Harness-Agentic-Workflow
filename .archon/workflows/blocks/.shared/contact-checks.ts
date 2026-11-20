/**
 * Contrôles déterministes de la fiche « à qui écrire » d'une candidature (`decideurs.json`,
 * bloc `decision-makers`). Purs : pas d'accès disque, testables à l'unité
 * (`contact-checks.test.ts`, un cas qui passe et un cas qui doit échouer par règle).
 *
 * Ce que le code peut établir : le fichier est un JSON de la forme attendue ; l'entreprise
 * est celle de l'offre ; le domaine est un hôte nu ; 0 à N personnes, aux noms complets et
 * distincts, chacune avec un rôle, une raison, une source publique https listée dans
 * `sources` (jamais LinkedIn ni un courtier de données personnelles) et une citation de cette
 * page qui porte son nom de famille ; aucune adresse e-mail ni aucun numéro de téléphone
 * nulle part (le cockpit ouvre l'outil d'enrichissement, Antoine fait la recherche) ; la note
 * LinkedIn tient en 300 caractères, sans lien, salue la personne par son prénom et nomme
 * l'entreprise ou le poste ; l'e-mail a un objet court, 60 à 150 mots, nomme l'entreprise,
 * pose une question, finit par le nom du candidat, sans mot de spam ni phrase creuse ; les
 * messages sont dans la langue de l'annonce ; chaque nombre des messages vient du profil ou
 * de l'annonce (un chiffre à unité, du profil seul) ; sans au moins deux personnes, au moins
 * deux recherches LinkedIn qu'Antoine lance lui-même. Ce qu'il ne peut pas trancher (la
 * personne est-elle vraiment sur sa page, avec ce rôle ? est-elle la bonne pour ce poste ?
 * le message est-il honnête et donne-t-il envie de répondre ?) va au juge.
 *
 * Réutilise, sans les modifier : `cv-checks.ts` (chiffres à unité, phrases creuses, compte des
 * mots), `email-checks.ts` (mots déclencheurs de spam), `letter-checks.ts` (langue de
 * l'annonce, normalisation, intitulé du poste, marqueurs à compléter).
 */

import { DEFAULT_SLOP, countWords, slopPhrases, unsupportedFigures } from './cv-checks.ts';
import { SPAM_TRIGGERS } from './email-checks.ts';
import { type Language, detectLanguage, normalize, placeholders, roleName } from './letter-checks.ts';

// ── La forme du fichier ────────────────────────────────────────────────────────

export interface Person {
  name: string;
  role: string;
  why: string;
  source: string;
  evidence: string;
}

export interface Decideurs {
  company: string;
  job_title: string;
  domain: string;
  language: string;
  people: Person[];
  searches: string[];
  linkedin_note: { to: string; text: string };
  email: { to: string; subject: string; body: string };
  sources: string[];
  notes: string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Lit `decideurs.json`. Chaque champ absent ou mal typé est un problème, et prend une valeur
 * vide pour que les autres règles tournent quand même (l'agent reçoit tout d'un coup).
 */
export function readDecideurs(raw: string | null): { doc: Decideurs | null; problems: string[] } {
  if (raw === null || raw.trim() === '') return { doc: null, problems: ['decideurs.json absent ou vide : écrire le fichier dans les artefacts du run'] };
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    return { doc: null, problems: [`decideurs.json n'est pas un JSON valide (${(error as Error).message}) : un seul objet, sans texte autour ni bloc \`\`\``] };
  }
  if (!isObject(value)) return { doc: null, problems: ['decideurs.json doit être un objet JSON ({ company, job_title, domain, language, people, … })'] };
  const problems: string[] = [];
  const str = (obj: Json, key: string, where: string): string => {
    if (typeof obj[key] === 'string') return (obj[key] as string).trim();
    problems.push(`champ « ${where}${key} » absent ou non textuel`);
    return '';
  };
  const strings = (obj: Json, key: string): string[] => {
    const list = obj[key];
    if (!Array.isArray(list)) {
      problems.push(`champ « ${key} » absent ou non liste (une liste de textes, vide permise)`);
      return [];
    }
    return list.filter((item, i) => {
      if (typeof item === 'string') return true;
      problems.push(`« ${key}[${i}] » n'est pas un texte`);
      return false;
    }).map((item) => (item as string).trim());
  };
  const people: Person[] = [];
  if (!Array.isArray(value.people)) problems.push('champ « people » absent ou non liste (liste vide permise, avec au moins deux recherches dans « searches »)');
  else {
    value.people.forEach((entry, i) => {
      if (!isObject(entry)) {
        problems.push(`« people[${i}] » n'est pas un objet { name, role, why, source, evidence }`);
        return;
      }
      const where = `people[${i}].`;
      people.push({ name: str(entry, 'name', where), role: str(entry, 'role', where), why: str(entry, 'why', where), source: str(entry, 'source', where), evidence: str(entry, 'evidence', where) });
    });
  }
  const note = isObject(value.linkedin_note) ? value.linkedin_note : null;
  if (note === null) problems.push('champ « linkedin_note » absent : { "to": "<nom d\'une personne listée, ou vide>", "text": "…" }');
  const email = isObject(value.email) ? value.email : null;
  if (email === null) problems.push('champ « email » absent : { "to": "…", "subject": "…", "body": "…" }');
  const doc: Decideurs = {
    company: str(value, 'company', ''),
    job_title: str(value, 'job_title', ''),
    domain: str(value, 'domain', ''),
    language: str(value, 'language', ''),
    people,
    searches: strings(value, 'searches'),
    linkedin_note: note === null ? { to: '', text: '' } : { to: str(note, 'to', 'linkedin_note.'), text: str(note, 'text', 'linkedin_note.') },
    email: email === null ? { to: '', subject: '', body: '' } : { to: str(email, 'to', 'email.'), subject: str(email, 'subject', 'email.'), body: str(email, 'body', 'email.') },
    sources: strings(value, 'sources'),
    notes: strings(value, 'notes'),
  };
  return { doc, problems };
}

// ── Comparer des noms ──────────────────────────────────────────────────────────

/** Texte comparable : `normalize` de la lettre, plus sans accents (« Hélène » = « helene »). */
export function fold(text: string): string {
  return normalize(text).normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `needle` figure dans `hay`, délimité (pas au milieu d'un mot), casse et accents ignorés. */
export function mentions(hay: string, needle: string): boolean {
  const n = fold(needle);
  if (n === '') return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(fold(hay));
}

/** Formes juridiques qu'une offre ajoute au nom (« Dana Incorporated », « Smartness S.r.l. »), ôtées en fin de nom. */
const LEGAL_SUFFIXES = new Set(['inc', 'incorporated', 'corp', 'corporation', 'ltd', 'limited', 'llc', 'llp', 'plc', 'sa', 'sas', 'sasu', 'sarl', 'spa', 'srl', 'gmbh', 'ag', 'kg', 'bv', 'nv', 'co', 'company', 'group', 'groupe', 'holding', 'ab', 'oy', 'aps', 'sl', 'se']);

/** Le nom d'une entreprise sans forme juridique ni ponctuation : « Dana Incorporated » → « dana ». */
export function companyKey(company: string): string {
  const tokens = fold(company)
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, '')
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .split(' ')
    .filter((t) => t !== '');
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

/** L'entreprise déclarée est celle de l'offre : l'une contient l'autre, une fois normalisées. */
export function companyMatches(declared: string, offer: string): boolean {
  const a = companyKey(declared);
  const b = companyKey(offer);
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

/** Deux à cinq mots de lettres, traits d'union et apostrophes : un nom complet, pas une initiale ni un titre. */
export function nameProblems(name: string): string[] {
  const words = name.split(/\s+/).filter((w) => w !== '');
  if (words.length < 2 || words.length > 5) return [`nom « ${name} » : prénom et nom complets attendus (deux à cinq mots)`];
  const bad = words.filter((w) => !/^\p{L}[\p{L}'’-]*$/u.test(w) || /[-'’]$/.test(w));
  return bad.length === 0 ? [] : [`nom « ${name} » : seulement des lettres, traits d'union et apostrophes (pas d'initiale « J. », de titre ni de chiffre) — lu « ${bad.join(' ')} »`];
}

export function firstName(name: string): string {
  return name.split(/\s+/).filter((w) => w !== '')[0] ?? '';
}

export function lastName(name: string): string {
  const words = name.split(/\s+/).filter((w) => w !== '');
  return words[words.length - 1] ?? '';
}

// ── Les sources ────────────────────────────────────────────────────────────────

/**
 * Hôtes jamais ouverts ni cités : LinkedIn (le scraper est contraire à ses conditions
 * d'utilisation) et les courtiers de données personnelles (bases d'e-mails et de téléphones,
 * outils d'enrichissement : ce sont des outils qu'Antoine ouvre lui-même, pas des sources de
 * noms). Un sous-domaine compte (`fr.linkedin.com`).
 */
export const BLOCKED_HOSTS: string[] = [
  'linkedin.com',
  'lnkd.in',
  'licdn.com',
  'rocketreach.co',
  'zoominfo.com',
  'lusha.com',
  'apollo.io',
  'contactout.com',
  'signalhire.com',
  'leadiq.com',
  'kaspr.io',
  'lemlist.com',
  'hunter.io',
  'dropcontact.com',
  'snov.io',
  'seamless.ai',
  'uplead.com',
  'clearbit.com',
  'cognism.com',
  'adapt.io',
  'getprospect.com',
  'skrapp.io',
  'voilanorbert.com',
  'findthatlead.com',
  'swordfish.ai',
  'peopledatalabs.com',
];

/** L'hôte d'une URL, en minuscules, sans `www.` ; vide quand l'URL est illisible. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isBlockedHost(host: string, blocked: string[] = BLOCKED_HOSTS): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return blocked.some((b) => h === b || h.endsWith(`.${b}`));
}

/** Une URL comparable : sans fragment ni barre finale, hôte en minuscules. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim();
  }
}

/** Un problème si l'URL n'est pas une page https publique qu'on a le droit de citer. */
export function sourceProblems(url: string, label: string): string[] {
  if (!/^https:\/\//i.test(url)) return [`${label} « ${url} » : une URL https complète attendue`];
  const host = hostOf(url);
  if (host === '') return [`${label} « ${url} » : URL illisible`];
  if (isBlockedHost(host)) return [`${label} « ${url} » : ${host} n'est pas une source permise (ni LinkedIn, ni courtier de données personnelles) ; citer le site de l'entreprise, un communiqué, un article, une page de conférence`];
  return [];
}

/** Le domaine du site de l'entreprise : un hôte nu (`dana.com`), sans schéma, chemin, port ni `www.`. */
export function domainProblems(domain: string): string[] {
  if (domain === '') return ['« domain » vide : le domaine du site de l\'entreprise (« dana.com »), que le cockpit passe à l\'outil d\'enrichissement'];
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return [`« domain » « ${domain} » : un hôte nu en minuscules (« dana.com »), sans https://, chemin ni port`];
  if (domain.startsWith('www.')) return [`« domain » « ${domain} » : sans « www. » (« ${domain.slice(4)} »)`];
  if (isBlockedHost(domain)) return [`« domain » « ${domain} » : c'est le domaine d'un réseau ou d'un courtier, pas celui de l'entreprise`];
  return [];
}

// ── Ni e-mail, ni téléphone, ni LinkedIn ───────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;

/** Adresses e-mail, domaines d'adresse (« @dana.com », un motif deviné) et formes masquées (« [at] »). */
export function emailAddresses(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) found.add(m[0]);
  for (const m of text.replace(URL_PATTERN, ' ').matchAll(/@[\w-]+\.[a-z]{2,}\b/gi)) if (![...found].some((f) => f.includes(m[0]))) found.add(m[0]);
  for (const m of text.matchAll(/[\w.-]+\s*[[(]\s*(?:at|arobase)\s*[\])]\s*[\w.-]+/gi)) found.add(m[0]);
  return [...found];
}

/** Numéros de téléphone : 9 à 15 chiffres, séparés au plus par des espaces, points, tirets, parenthèses ; liens ôtés (un identifiant d'article n'en est pas un). */
export function phoneNumbers(text: string): string[] {
  const found: string[] = [];
  for (const m of text.replace(URL_PATTERN, ' ').matchAll(/(?<![\p{L}\p{N}])\+?\(?\d[\d \t.() -]{6,}\d(?![\p{L}\p{N}])/gu)) {
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 9 && digits <= 15) found.push(m[0].trim());
  }
  return found;
}

/** Les hôtes interdits cités n'importe où (une URL dans une note, un `linkedin.com/in/…` sans schéma). */
export function blockedMentions(text: string, blocked: string[] = BLOCKED_HOSTS): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_PATTERN)) {
    const host = hostOf(m[0]);
    if (host !== '' && isBlockedHost(host, blocked)) found.add(host);
  }
  for (const b of blocked) if (new RegExp(`(?<![\\w-])${escapeRegExp(b)}(?![\\w-])`, 'i').test(text)) found.add(b);
  return [...found];
}

// ── Les messages ───────────────────────────────────────────────────────────────

/** Les groupes de chiffres d'un texte (« 5,000 » → 5 et 000). */
export function digitGroups(text: string): string[] {
  return [...new Set(text.match(/\d+/g) ?? [])];
}

/** Groupes de chiffres des messages qu'aucune source (profil, annonce) ne porte : un nombre sans source est une invention. */
export function unsupportedDigits(text: string, sources: string): string[] {
  const known = new Set(digitGroups(sources));
  return digitGroups(text).filter((d) => !known.has(d));
}

export const NOTE_MAX_CHARS = 300;
export const SUBJECT_MAX_CHARS = 60;
export const BODY_WORDS = { min: 60, max: 150 } as const;

/** La personne est saluée par son prénom au début du message (« Hi Marco, », « Bonjour Eléna, »). */
export function greets(text: string, name: string): boolean {
  const first = firstName(name);
  if (first === '') return true;
  const opening = text.trim().split(/[\n,.!?:;]/)[0]!.slice(0, 40);
  return mentions(opening, first);
}

/** Le message nomme l'entreprise (sans sa forme juridique) ou le poste tel que l'annonce l'écrit. */
export function namesCompanyOrRole(text: string, company: string, title: string): boolean {
  const key = companyKey(company);
  const role = roleName(title);
  return (key !== '' && mentions(text, key)) || (role !== '' && mentions(text, role));
}

const LANGUAGE_NAME: Record<Language, string> = { fr: 'français', en: 'anglais' };

function styleProblems(label: string, text: string, spam: string[], slop: string[]): string[] {
  const problems: string[] = [];
  // Délimité : « free » ne doit pas tomber sur « freelance », une expérience du profil.
  for (const trigger of spam) if (mentions(text, trigger)) problems.push(`${label} : mot déclencheur de spam « ${trigger} »`);
  for (const phrase of slopPhrases(normalize(text), slop.map((p) => normalize(p)))) problems.push(`${label} : formule creuse « ${phrase} » : la remplacer par un fait du profil`);
  if ((text.match(/!/g) ?? []).length > 1) problems.push(`${label} : plus d'un point d'exclamation`);
  for (const marker of placeholders(text)) problems.push(`${label} : marqueur à compléter « ${marker} » : écrire le texte ou retirer la phrase`);
  return problems;
}

// ── Le contrôle complet ────────────────────────────────────────────────────────

export interface ContactRules {
  /** L'entreprise de l'offre (offer.json, le tableau, ou interlocuteur_cible.json). */
  company: string;
  /** L'intitulé du poste de l'offre (vide : celui que le fichier déclare). */
  title: string;
  /** La langue de l'annonce (`expectedLanguage` de `letter-checks.ts`). */
  language: Language;
  /** Le profil maître : seule source des faits sur le candidat, et des chiffres à unité. */
  profile: string;
  /** Le texte de l'annonce et les champs de l'offre : un nombre peut aussi en venir. */
  posting: string;
  /** Le nom du candidat (`candidateName`), qui signe l'e-mail. */
  candidate: string;
  maxPeople: number;
  spam: string[];
  slop: string[];
}

export const DEFAULT_CONTACT_RULES: Pick<ContactRules, 'maxPeople' | 'spam' | 'slop'> = {
  maxPeople: 4,
  spam: SPAM_TRIGGERS,
  slop: DEFAULT_SLOP,
};

export interface ContactOutcome {
  ok: boolean;
  problems: string[];
  people: number;
}

/** Le contrôle complet de `decideurs.json`. Chaque problème dit quoi corriger ; l'agent les reçoit au tour suivant. */
export function checkDecideurs(raw: string | null, rules: ContactRules): ContactOutcome {
  const { doc, problems } = readDecideurs(raw);
  if (doc === null) return { ok: false, problems, people: 0 };
  const serialized = raw ?? '';

  // L'offre et l'entreprise.
  if (rules.company.trim() === '') problems.push("entreprise de l'offre introuvable (ni l'entrée « offer », ni offer.json, ni le tableau, ni interlocuteur_cible.json) : rien à quoi comparer « company »");
  else if (!companyMatches(doc.company, rules.company)) problems.push(`« company » « ${doc.company} » n'est pas l'entreprise de l'offre (« ${rules.company} »)`);
  if (doc.job_title === '') problems.push('« job_title » vide : l\'intitulé du poste, tel que l\'annonce l\'écrit');
  problems.push(...domainProblems(doc.domain));
  if (doc.language !== rules.language) problems.push(`« language » « ${doc.language} » : la langue de l'annonce est « ${rules.language} » (${LANGUAGE_NAME[rules.language]}), et les messages s'écrivent dans cette langue`);
  if (rules.profile.trim() === '') problems.push('profil maître vide ou illisible : rien à quoi comparer les messages');
  if (rules.candidate.trim() === '') problems.push('nom du candidat introuvable (ni le titre du CV, ni le profil) : rien à quoi comparer la signature');

  // Les sources.
  const listed = new Set(doc.sources.map(canonicalUrl));
  doc.sources.forEach((url, i) => problems.push(...sourceProblems(url, `sources[${i}]`)));
  if (doc.people.length > 0 && doc.sources.length === 0) problems.push('« sources » vide : chaque personne vient d\'une page publique, listée ici');

  // Les personnes.
  if (doc.people.length > rules.maxPeople) problems.push(`${doc.people.length} personnes, au plus ${rules.maxPeople} : garder les plus utiles pour ce poste, dans l'ordre d'approche`);
  const seen = new Set<string>();
  doc.people.forEach((person, i) => {
    const tag = `people[${i}] (${person.name || 'sans nom'})`;
    problems.push(...nameProblems(person.name).map((p) => `${tag} : ${p}`));
    const key = fold(person.name);
    if (key !== '' && seen.has(key)) problems.push(`${tag} : nom en double`);
    seen.add(key);
    if (person.role === '') problems.push(`${tag} : « role » vide (le titre tel que la source l'écrit)`);
    if (person.why === '') problems.push(`${tag} : « why » vide (une phrase : pourquoi cette personne pour ce poste)`);
    if (person.source === '') problems.push(`${tag} : « source » vide (la page publique qui nomme la personne)`);
    else {
      problems.push(...sourceProblems(person.source, `${tag} : source`));
      if (!listed.has(canonicalUrl(person.source))) problems.push(`${tag} : la source « ${person.source} » n'est pas dans « sources »`);
    }
    const last = lastName(person.name);
    if (person.evidence === '') problems.push(`${tag} : « evidence » vide (la phrase de la page, recopiée mot pour mot, qui nomme la personne)`);
    else if (countWords(person.evidence) < 3) problems.push(`${tag} : « evidence » trop courte (au moins trois mots de la page : le nom et ce qui dit son rôle)`);
    else if (last !== '' && !mentions(person.evidence, last)) problems.push(`${tag} : « evidence » ne contient pas le nom « ${last} » : recopier la phrase de la page qui le nomme`);
  });
  if (doc.people.length < 2 && doc.searches.filter((s) => s !== '').length < 2) problems.push(`${doc.people.length} personne(s) trouvée(s) : au moins deux recherches LinkedIn dans « searches » (« Entreprise "Sales Operations" »), qu'Antoine lance lui-même`);
  doc.searches.forEach((s, i) => {
    if (s === '') problems.push(`searches[${i}] vide`);
    else if (/https?:\/\/|www\./i.test(s)) problems.push(`searches[${i}] « ${s} » : une recherche à taper dans LinkedIn, pas une URL`);
  });

  // Pas d'e-mail, pas de téléphone, pas de LinkedIn, nulle part.
  for (const address of emailAddresses(serialized)) problems.push(`adresse e-mail « ${address} » : aucune adresse dans le fichier, ni trouvée ni devinée (le cockpit ouvre l'outil d'enrichissement, Antoine cherche lui-même)`);
  for (const phone of phoneNumbers(serialized)) problems.push(`numéro de téléphone « ${phone} » : aucun téléphone dans le fichier`);
  for (const host of blockedMentions(serialized)) problems.push(`« ${host} » cité dans le fichier : ni LinkedIn ni courtier de données comme source ou lien`);

  // À qui vont les messages.
  const names = new Set(doc.people.map((p) => p.name));
  for (const [label, to] of [['linkedin_note', doc.linkedin_note.to], ['email', doc.email.to]] as const) {
    if (doc.people.length === 0 && to !== '') problems.push(`${label}.to « ${to} » : aucune personne listée, « to » reste vide et le message s'adresse à l'équipe de recrutement`);
    if (doc.people.length > 0 && !names.has(to)) problems.push(`${label}.to « ${to} » : le nom exact d'une personne de « people » (${[...names].join(', ')})`);
  }

  // La note LinkedIn.
  const note = doc.linkedin_note.text;
  const company = rules.company.trim() !== '' ? rules.company : doc.company;
  const title = rules.title.trim() !== '' ? rules.title : doc.job_title;
  if (note === '') problems.push('linkedin_note.text vide');
  else {
    if ([...note].length > NOTE_MAX_CHARS) problems.push(`linkedin_note.text : ${[...note].length} caractères, au plus ${NOTE_MAX_CHARS} (limite d'une note de connexion)`);
    if (/https?:\/\/|www\./i.test(note)) problems.push('linkedin_note.text : pas de lien dans une note de connexion');
    if (doc.linkedin_note.to !== '' && !greets(note, doc.linkedin_note.to)) problems.push(`linkedin_note.text : saluer ${firstName(doc.linkedin_note.to)} par son prénom dès la première phrase`);
    if (!namesCompanyOrRole(note, company, title)) problems.push(`linkedin_note.text : nommer l'entreprise (${companyKey(company) || company}) ou le poste`);
    problems.push(...styleProblems('linkedin_note.text', note, rules.spam, rules.slop));
    const lang = detectLanguage(note);
    if (lang !== 'unknown' && lang !== rules.language) problems.push(`linkedin_note.text : écrite en ${LANGUAGE_NAME[lang]}, la langue de l'annonce est le ${LANGUAGE_NAME[rules.language]}`);
  }

  // L'e-mail.
  const { subject, body } = doc.email;
  if (subject === '') problems.push('email.subject vide');
  else if ([...subject].length > SUBJECT_MAX_CHARS) problems.push(`email.subject : ${[...subject].length} caractères, au plus ${SUBJECT_MAX_CHARS}`);
  const words = countWords(body);
  if (body === '') problems.push('email.body vide');
  else {
    if (words < BODY_WORDS.min || words > BODY_WORDS.max) problems.push(`email.body : ${words} mots, entre ${BODY_WORDS.min} et ${BODY_WORDS.max} attendus`);
    if (doc.email.to !== '' && !greets(body, doc.email.to)) problems.push(`email.body : saluer ${firstName(doc.email.to)} par son prénom dès la première ligne`);
    if (company.trim() !== '' && !mentions(`${subject}\n${body}`, companyKey(company))) problems.push(`email : nommer l'entreprise (${companyKey(company)}) dans l'objet ou le corps`);
    const questions = (body.match(/\?/g) ?? []).length;
    if (questions === 0) problems.push('email.body : aucune question (une demande claire, une seule)');
    if (questions > 2) problems.push(`email.body : ${questions} questions, une seule demande attendue`);
    if (rules.candidate.trim() !== '' && !fold(body).endsWith(fold(rules.candidate))) problems.push(`email.body : finir par le nom du candidat (« ${rules.candidate} »), seul sur la dernière ligne, sans adresse ni téléphone`);
    const lang = detectLanguage(body);
    if (lang !== rules.language) problems.push(`email.body : à écrire en ${LANGUAGE_NAME[rules.language]}, la langue de l'annonce : lu ${lang === 'unknown' ? 'une langue indéterminée ou mêlée' : LANGUAGE_NAME[lang]}`);
  }
  problems.push(...styleProblems('email', `${subject}\n${body}`, rules.spam, rules.slop));

  // Les nombres des messages.
  const messages = `${note}\n${subject}\n${body}`;
  const figures = unsupportedFigures(messages, rules.profile);
  for (const figure of figures) problems.push(`messages : chiffre « ${figure} » absent du profil maître : un chiffre sur le candidat vient du profil, tel quel`);
  const reported = new Set(figures.flatMap(digitGroups));
  for (const digits of unsupportedDigits(messages, `${rules.profile}\n${rules.posting}`)) {
    if (!reported.has(digits)) problems.push(`messages : nombre « ${digits} » absent du profil maître et de l'annonce : affirmation sans source (retirer, ou dire sans chiffre)`);
  }

  return { ok: problems.length === 0, problems, people: doc.people.length };
}
