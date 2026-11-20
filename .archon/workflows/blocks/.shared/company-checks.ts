/**
 * Contrôles déterministes de la prospection : le dossier d'une entreprise validée full remote
 * (`checkDossier`) et la proposition qui en découle (`checkProposal`). Pures, testées.
 *
 * Ce que le code établit : la forme, que chaque affirmation cite une source web listée, au
 * moins trois concurrents, des signaux datés de moins de douze mois, le pays de l'entreprise
 * et un canal compatible avec lui (pas d'e-mail froid là où la loi l'interdit en pratique),
 * des besoins et des preuves cités mot pour mot. Ce que le code ne peut pas trancher (la
 * source dit-elle vraiment cela ? le besoin est-il plausible ?) va au juge.
 */

import { DEFAULT_RULES, evaluateDeliverable } from './deliverable-checks.ts';

export const DOSSIER_SECTIONS = ['Activité', 'Concurrents', 'Signaux récents', 'Recrutement', 'Besoins probables', 'Contact', 'Sources'];
export const PROPOSAL_SECTIONS = ['Axes', 'Mini-diagnostic', 'Accroche'];
export const CHANNELS = ['email', 'linkedin', 'formulaire'];
export const FORMULAS = ['CDI', 'freelance', 'portage'];
/**
 * Pays où l'e-mail froid B2B demande en pratique un consentement préalable : le canal
 * `email` y est refusé (LinkedIn ou le formulaire de contact à la place).
 */
export const NO_COLD_EMAIL = ['DE', 'AT'];
export const MIN_SOURCES = 4;
export const MIN_COMPETITORS = 3;
export const SIGNAL_MAX_AGE_DAYS = 366;
/** L'accroche sert aussi de note de connexion LinkedIn (300 caractères au plus). */
export const HOOK_MAX_CHARS = 280;

const SOURCE_LINE = /^\s*-\s*\[(S\d+)\]\s*(.*)$/;
const ITEM = /^\s*(?:\d+[.)]|[-*+])\s+\S/;

/** Corps de la section `## <title>`, ou null si elle manque. */
export function section(content: string, title: string): string | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = content.split(new RegExp(`^## ${escaped}\\s*$`, 'm'))[1];
  return after === undefined ? null : after.split(/^## /m)[0];
}

/** Les puces (ou lignes numérotées) d'une section, sans le marqueur de liste. */
export function items(body: string | null): string[] {
  if (body === null) return [];
  return body.split('\n').filter((line) => ITEM.test(line)).map((line) => line.replace(/^\s*(?:\d+[.)]|[-*+])\s+/, '').trim());
}

/** Sources `- [S<n>] <quoi> — <url>` : identifiant → URL (dernier segment après « — »). */
export function listSources(content: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const line of (section(content, 'Sources') ?? '').split('\n')) {
    const match = SOURCE_LINE.exec(line);
    if (!match) continue;
    const rest = match[2].trim();
    const cut = rest.lastIndexOf('—');
    sources.set(match[1], (cut >= 0 ? rest.slice(cut + 1) : rest).trim());
  }
  return sources;
}

function cited(line: string): string[] {
  return [...line.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
}

/** Valeur d'une ligne d'en-tête `Clé : valeur` placée avant la première section. */
export function header(content: string, key: string): string | null {
  const head = content.split(/^## /m)[0];
  const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi').exec(head);
  return match ? match[1].trim() : null;
}

function days(iso: string): number {
  return Date.parse(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`) / 864e5;
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** La citation figure-t-elle mot pour mot (espaces, casse et apostrophes mis à part) ? */
export function quoted(quote: string, source: string): boolean {
  const q = normalize(quote);
  return q.length >= 12 && normalize(source).includes(q);
}

export function checkDossier(content: string | null, company: string, today: string): { ok: boolean; problems: string[]; country: string; channel: string } {
  const base = evaluateDeliverable(content, { ...DEFAULT_RULES, requiredSections: DOSSIER_SECTIONS, minChars: 900 });
  if (content === null || content.trim() === '') return { ...base, country: '', channel: '' };
  const problems = [...base.problems];
  const listed = listSources(content);

  if (!/^# Dossier : \S/m.test(content)) problems.push('no "# Dossier : <company>" title line');
  const order = DOSSIER_SECTIONS.map((title) => content.search(new RegExp(`^## ${title}\\s*$`, 'm')));
  if (order.every((at) => at >= 0) && order.some((at, i) => i > 0 && at < order[i - 1])) {
    problems.push(`sections out of order; expected ${DOSSIER_SECTIONS.map((s) => `"## ${s}"`).join(', ')}`);
  }

  const country = (header(content, 'Pays') ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) problems.push('header line "Pays : <ISO code, two letters>" missing or not an ISO code (FR, DE, ES…)');
  const site = header(content, 'Site') ?? '';
  if (!/^https?:\/\/\S+$/.test(site)) problems.push('header line "Site : <https URL>" missing');
  const remote = header(content, 'Full remote') ?? '';
  if (remote === '') problems.push('header line "Full remote : <what proves it> [S<n>]" missing');

  const web = new Set([...listed.values()].filter((url) => /^https?:\/\/\S+$/.test(url)).map((url) => url.toLowerCase().replace(/\/$/, '')));
  if (web.size < MIN_SOURCES) {
    problems.push(`only ${web.size} distinct web source(s) listed as "- [S<n>] <what> — <https URL>" under "## Sources"; at least ${MIN_SOURCES} expected`);
  }
  for (const [id, url] of listed) {
    if (!/^https?:\/\/\S+$/.test(url)) problems.push(`source [${id}] does not end with an http(s) URL after "—"`);
  }

  const citing = (title: string, lines: string[], skip: (line: string) => boolean = () => false) => {
    lines.forEach((line, index) => {
      if (skip(line)) return;
      const ids = cited(line);
      if (ids.length === 0) problems.push(`"## ${title}" item ${index + 1} cites no source [S<n>]`);
      for (const id of ids) if (!listed.has(id)) problems.push(`"## ${title}" item ${index + 1} cites [${id}], which is not listed under "## Sources"`);
    });
  };
  for (const title of ['Activité', 'Signaux récents', 'Recrutement', 'Besoins probables']) {
    const lines = items(section(content, title));
    if (lines.length === 0 && section(content, title) !== null) problems.push(`"## ${title}" lists nothing (bullets expected)`);
    citing(title, lines);
  }
  if (remote !== '') citing('Full remote', [remote]);

  const competitors = items(section(content, 'Concurrents'));
  citing('Concurrents', competitors);
  const names = competitors.map((line) => /^\*\*(.+?)\*\*/.exec(line)?.[1]?.trim().toLowerCase() ?? '');
  if (names.some((name) => name === '')) problems.push('every "## Concurrents" item starts with the competitor name in bold: "- **Name** : how they differ [S<n>]"');
  const distinct = new Set(names.filter((name) => name !== '' && name !== company.trim().toLowerCase()));
  if (distinct.size < MIN_COMPETITORS) problems.push(`only ${distinct.size} distinct competitor(s) under "## Concurrents" (the company itself does not count); at least ${MIN_COMPETITORS} expected`);

  const now = /^\d{4}-\d{2}-\d{2}$/.test(today) ? days(today) : Date.now() / 864e5;
  items(section(content, 'Signaux récents')).forEach((line, index) => {
    const date = /^(\d{4}-\d{2}(?:-\d{2})?)\b/.exec(line)?.[1];
    if (date === undefined || Number.isNaN(days(date))) {
      problems.push(`"## Signaux récents" item ${index + 1} does not start with its date (YYYY-MM or YYYY-MM-DD)`);
      return;
    }
    if (days(date) > now + 1) problems.push(`"## Signaux récents" item ${index + 1} is dated ${date}, after today (${today || 'today'})`);
    else if (now - days(date) > SIGNAL_MAX_AGE_DAYS) problems.push(`"## Signaux récents" item ${index + 1} is dated ${date}, more than 12 months ago: drop it or replace it with a recent signal`);
  });

  const needs = items(section(content, 'Besoins probables'));
  if (section(content, 'Besoins probables') !== null && (needs.length < 2 || needs.length > 4)) problems.push(`"## Besoins probables" lists ${needs.length} need(s); 2 to 4 expected`);

  const contact = items(section(content, 'Contact'));
  const channelLine = contact.find((line) => /^canal\s*:/i.test(line)) ?? '';
  const channel = channelLine.replace(/^canal\s*:\s*/i, '').trim().toLowerCase();
  citing('Contact', contact, (line) => /^canal\s*:/i.test(line));
  if (!CHANNELS.includes(channel)) problems.push(`"## Contact" has no "- Canal : ${CHANNELS.join(' | ')}" line`);
  if (channel === 'email' && NO_COLD_EMAIL.includes(country)) problems.push(`channel "email" is not allowed for a company in ${country} (cold B2B e-mail needs prior consent there): use linkedin or formulaire`);
  const emails = (section(content, 'Contact') ?? '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
  if (channel === 'email' && emails.length === 0) problems.push('channel "email" but no published address under "## Contact" (never guess one: use linkedin or formulaire instead)');

  return { ok: problems.length === 0, problems, country, channel };
}

export interface ProposalContext {
  /** Le dossier vérifié (texte) : chaque besoin cité doit y figurer mot pour mot. */
  dossier: string;
  /** Le profil du candidat (texte) : chaque preuve citée doit y figurer mot pour mot. */
  profile: string;
  /** Formules que le candidat accepte (CDI, freelance, portage). */
  formulas: string[];
}

export function checkProposal(content: string | null, context: ProposalContext): { ok: boolean; problems: string[]; axes: number } {
  const base = evaluateDeliverable(content, { ...DEFAULT_RULES, requiredSections: PROPOSAL_SECTIONS, minChars: 600 });
  if (content === null || content.trim() === '') return { ...base, axes: 0 };
  const problems = [...base.problems];
  if (!/^# Proposition : \S/m.test(content)) problems.push('no "# Proposition : <company>" title line');

  const axes = (section(content, 'Axes') ?? '').split(/^### /m).slice(1);
  if (axes.length < 1 || axes.length > 2) problems.push(`"## Axes" holds ${axes.length} axis(es) as "### <title>"; 1 or 2 expected`);
  axes.forEach((axis, index) => {
    const n = index + 1;
    const field = (key: string) => new RegExp(`^-\\s*${key}\\s*:\\s*(.+)$`, 'mi').exec(axis)?.[1]?.trim() ?? '';
    const need = /«\s*(.+?)\s*»/.exec(field('Besoin'))?.[1] ?? '';
    const proof = /«\s*(.+?)\s*»/.exec(field('Preuve'))?.[1] ?? '';
    const formula = field('Formule');
    if (need === '') problems.push(`axis ${n}: no "- Besoin : « <words quoted from the dossier> »" line`);
    else if (!quoted(need, section(context.dossier, 'Besoins probables') ?? '')) problems.push(`axis ${n}: the need « ${need} » is not quoted word for word from "## Besoins probables" of the dossier (at least 12 characters)`);
    if (proof === '') problems.push(`axis ${n}: no "- Preuve : « <words quoted from the profile> »" line`);
    else if (!quoted(proof, context.profile)) problems.push(`axis ${n}: the proof « ${proof} » is not quoted word for word from the candidate's profile (at least 12 characters)`);
    const named = formula.split(/[,/]| ou | et /).map((word) => word.trim()).filter(Boolean);
    const allowed = context.formulas.map((f) => f.toLowerCase());
    if (named.length === 0) problems.push(`axis ${n}: no "- Formule : ${FORMULAS.join(' | ')}" line`);
    for (const word of named) if (!allowed.includes(word.toLowerCase())) problems.push(`axis ${n}: formula "${word}" is not one the candidate accepts (${context.formulas.join(', ')})`);
  });

  const words = (section(content, 'Mini-diagnostic') ?? '').split(/\s+/).filter(Boolean).length;
  if (section(content, 'Mini-diagnostic') !== null && (words < 150 || words > 350)) problems.push(`"## Mini-diagnostic" is ${words} words; 150 to 350 expected (one page)`);
  const hook = (section(content, 'Accroche') ?? '').trim();
  const hookWords = hook.split(/\s+/).filter(Boolean).length;
  if (section(content, 'Accroche') !== null && hookWords < 15) problems.push(`"## Accroche" is ${hookWords} words; at least 15 expected`);
  if (hook.length > HOOK_MAX_CHARS) problems.push(`"## Accroche" is ${hook.length} characters; at most ${HOOK_MAX_CHARS}, so it also fits a LinkedIn connection note (300)`);
  if (hook !== '' && (hook.match(/\?/g) ?? []).length !== 1) problems.push('"## Accroche" ends the opening with exactly one question');
  return { ok: problems.length === 0, problems, axes: axes.length };
}
