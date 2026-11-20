/**
 * Les entreprises full remote que le radar a trouvées (onglet « Entreprises full remote » du cockpit).
 *
 * Le radar (`.shared/radar/fetchers/ats_boards.js`) écrit dans le dossier carrière :
 *   - `remote_companies.json` : `{ _meta: { at, rule }, companies: { "<ats>:<slug>": { name, ats, slug,
 *     careers, kind: full|partiel, total, remote, hybrid, in_field, first_seen, last_read,
 *     source: tableau|manuel|index, board, note } } }` : toute entreprise d'un tableau lu qui a au moins
 *     un poste en full télétravail (« toutes les entreprises avec des jobs en full TT », Antoine,
 *     2026-11-08), plus celles de son index 100 % remote (`index:<id>`, `board: false` quand aucun
 *     tableau d'offres n'a été trouvé) ;
 *   - `remote_company_jobs.json` : `{ _meta, companies: { "<ats>:<slug>": { read_at, others, jobs: [{ id,
 *     title, location, link, posted, remote, target, first_seen }] } } }`, les postes ouverts de la
 *     famille large, à part du tableau, quel que soit le tri (Antoine, 2026-11-08 : l'annonce PostHog
 *     « developer marketer, sales » est de celles à étudier quoi qu'il advienne).
 * Ici : la vue de la page (chaque poste dit s'il est déjà au tableau ; `zoneOk` écarte un poste réservé
 * hors d'Europe, un titre répété par lieu n'est gardé qu'une fois) et la ligne du tableau qu'un
 * poste devient quand Antoine le met au tableau (même id que le radar : pas de doublon ensuite).
 */

import type { PendingJob } from '../../.archon/workflows/systems/.shared/career.ts';
import { slugOf } from '../../.archon/workflows/systems/.shared/radar.ts';

export const REMOTE_COMPANIES_FILE = 'remote_companies.json';
export const REMOTE_JOBS_FILE = 'remote_company_jobs.json';
const LABEL: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };
export const REMOTE_SOURCE_PREFIX = 'Entreprise full remote';

export interface RemoteJob {
  id: string;
  title: string;
  location: string;
  link: string;
  posted: string;
  remote: boolean;
  target: boolean;
  first_seen: string;
  /** Le même titre publié pour d'autres lieux (une seule ligne gardée). */
  more: number;
  /** Le slug de la ligne du tableau qui porte déjà ce poste (lien ou id), sinon null. */
  onBoard: string | null;
}

export interface RemoteCompany {
  key: string;
  name: string;
  ats: string;
  slug: string;
  careers: string;
  /** `full` : presque tous ses postes sont remote (ou listée à la main, ou dans l'index d'Antoine) ; `partiel` : quelques postes remote. */
  kind: 'full' | 'partiel';
  /** false : entreprise de l'index d'Antoine dont aucun tableau Greenhouse, Lever ou Ashby n'a été trouvé (page carrières à lire soi-même). */
  board: boolean;
  /** Avec `board: false` : true quand le radar a déjà cherché son tableau (introuvable), false quand il ne l'a pas encore fait. */
  probed: boolean;
  /** Ce que l'index dit de son télétravail (« 100% Full Remote (Vérifié…) »). */
  note: string;
  total: number;
  remote: number;
  hybrid: number;
  source: string;
  first_seen: string;
  last_read: string;
  others: number;
  /** Postes de la famille large réservés à une zone hors Europe, écartés. */
  outsideEurope: number;
  jobs: RemoteJob[];
}

export interface RemoteView {
  at: string | null;
  rule: string;
  companies: RemoteCompany[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const safeLink = (v: unknown): string => (/^https:\/\//i.test(str(v)) ? str(v) : '');

/** La vue de la page : les entreprises (celles qui ont le plus de postes dans le champ d'abord), leurs postes, ce qui est déjà au tableau. */
export function remoteView(companiesDoc: unknown, jobsDoc: unknown, board: readonly PendingJob[], zoneOk: (where: string) => boolean = () => true): RemoteView {
  const meta = rec(rec(companiesDoc)._meta);
  const companies = rec(rec(companiesDoc).companies);
  const jobs = rec(rec(jobsDoc).companies);
  const byLink = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const row of board) {
    if (row === null || typeof row !== 'object' || typeof row.slug !== 'string') continue;
    if (typeof row.link === 'string' && row.link !== '') byLink.set(row.link.toLowerCase(), row.slug);
    if (typeof row.id === 'string' && row.id !== '') byId.set(row.id, row.slug);
  }
  const out: RemoteCompany[] = [];
  for (const [key, entry] of Object.entries(companies)) {
    const c = rec(entry);
    const j = rec(jobs[key]);
    // Les fichiers écrits avant la règle de zone et le dédoublonnage du radar (2026-11-08 soir) : la vue les applique aussi.
    const all = (Array.isArray(j.jobs) ? j.jobs : []).map(rec).filter((x) => str(x.title) !== '' && safeLink(x.link) !== '');
    const inZone = all.filter((x) => zoneOk(`${str(x.location)} ${str(x.title)}`));
    const byTitle = new Map<string, Record<string, unknown>>();
    for (const x of inZone) {
      const k = str(x.title).toLowerCase().replace(/\s+/g, ' ').trim();
      const first = byTitle.get(k);
      if (first) first.more = num(first.more) + 1 + num(x.more);
      else byTitle.set(k, { ...x });
    }
    const list = [...byTitle.values()].map((x): RemoteJob => ({
      id: str(x.id),
      title: str(x.title),
      location: str(x.location),
      link: safeLink(x.link),
      posted: str(x.posted),
      remote: x.remote === true,
      target: x.target === true,
      first_seen: str(x.first_seen),
      more: num(x.more),
      onBoard: byId.get(str(x.id)) ?? byLink.get(safeLink(x.link).toLowerCase()) ?? null,
    }));
    out.push({
      key,
      name: str(c.name) || key,
      ats: str(c.ats),
      slug: str(c.slug),
      careers: safeLink(c.careers),
      kind: c.kind === 'partiel' ? 'partiel' : 'full',
      board: c.board !== false,
      probed: c.probed !== false,
      note: str(c.note).slice(0, 200),
      total: num(c.total),
      remote: num(c.remote),
      hybrid: num(c.hybrid),
      source: str(c.source),
      first_seen: str(c.first_seen),
      last_read: str(c.last_read),
      others: num(j.others),
      outsideEurope: num(j.outside_europe) + all.length - inZone.length,
      jobs: list,
    });
  }
  const targets = (c: RemoteCompany): number => c.jobs.filter((j) => j.target).length;
  out.sort((a, b) => Number(b.source === 'manuel') - Number(a.source === 'manuel') || Number(a.kind === 'partiel') - Number(b.kind === 'partiel') || Number(b.board) - Number(a.board) || targets(b) - targets(a) || b.jobs.length - a.jobs.length || a.name.localeCompare(b.name, 'fr'));
  return { at: str(meta.at) || null, rule: str(meta.rule), companies: out };
}

/** La ligne du tableau d'un poste d'entreprise full remote (statut posé par `appendNew`). */
export function remoteJobToPending(company: RemoteCompany, job: RemoteJob): PendingJob {
  const label = LABEL[company.ats] ?? company.ats;
  return {
    id: job.id,
    slug: slugOf(company.name),
    company: company.name,
    title: job.title,
    link: job.link,
    location: job.location,
    remote_declared: true,
    remote_basis: company.kind === 'full' ? `entreprise full remote (${company.remote} postes remote sur ${company.total} sur son tableau ${label})` : `poste remote sur le tableau ${label} de l'employeur (${company.remote} postes remote sur ${company.total})`,
    company_hq: '',
    skills_required: '',
    description: '',
    salary_range: null,
    date_published: job.posted,
    source: `${REMOTE_SOURCE_PREFIX} (${label})`,
    ajoutee_par: 'Antoine',
    status: 'PENDING_VALIDATION',
  };
}
