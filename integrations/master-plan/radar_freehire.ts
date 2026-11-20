#!/usr/bin/env bun
/**
 * Proposition (voir `radar_freehire.proposal.md`) : Free-Hire (freehire.me) comme source de
 * plus pour le radar de la VM. Ce script ne fait AUCUN appel réseau et n'écrit rien : il lit
 * une réponse déjà sauvegardée de l'API de recherche, la met aux champs d'une offre du tableau
 * (`pending_gold_jobs.json`), écarte ce que le tableau a déjà, et imprime le résultat. Le
 * radar de production n'est pas modifié ; la requête qu'il ferait est décrite par
 * `searchPath()` (une chaîne, testée), pas exécutée.
 *
 *   bun radar_freehire.ts <réponse.json> [--board <pending_gold_jobs.json>] [--now <date ISO>]
 *     → stdout : { "fresh": [offres à passer au jury], "duplicates": [{ slug, reason }], "skipped": [...] }
 *
 * La forme de l'API (enveloppe `{ data, meta }`, objet job, `public_slug`, `enrichment`) et la
 * forme de sortie de sa CLI (`{ meta, results }`) viennent de
 * MadsLorentzen/ai-job-search/.agents/skills/freehire-search/ (url-reference.md,
 * cli/src/helpers.ts, cli/src/commands/search.ts ; MIT, © 2026 Mads Lorentzen) : les deux
 * formes sont acceptées. Rien n'est copié de sa CLI, qui n'est ni installée ni lancée.
 */

import { existsSync, readFileSync } from 'node:fs';

/** Un job tel que l'API Free-Hire le rend (les champs lus ici ; le reste est ignoré). */
export interface FreehireJob {
  public_slug: string;
  source?: string;
  external_id?: string;
  url: string;
  title: string;
  company?: string | null;
  company_slug?: string | null;
  location?: string | null;
  description?: string | null;
  skills?: string[];
  work_mode?: string | null;
  regions?: string[];
  countries?: string[];
  cities?: string[];
  posted_at?: string | null;
  closed_at?: string | null;
  enrichment?: {
    seniority?: string;
    category?: string;
    employment_type?: string;
    salary_min?: number;
    salary_max?: number;
    salary_currency?: string;
    salary_period?: string;
  };
}

/** Une offre aux champs du tableau, avant le jury (qui ajoute score, tier, verdict, accroche, statut). */
export interface BoardCandidate {
  id: string;
  slug: string;
  company: string;
  title: string;
  link: string;
  source: string;
  location: string;
  description: string;
  skills_required: string;
  salary_range: string;
  date_published: string;
  found_at: string;
  freehire: {
    public_slug: string;
    ats: string;
    external_id: string;
    company_slug: string;
    work_mode: string;
    seniority: string;
    category: string;
    employment_type: string;
    countries: string[];
    regions: string[];
  };
}

export const DESCRIPTION_MAX = 4000;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []);

export function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Les jobs d'une réponse sauvegardée : l'enveloppe de l'API (`{ data: [...] }`), la sortie de
 * la CLI d'ai-job-search (`{ results: [...] }`, où `id` est le `public_slug` et `date` la date
 * de publication), ou un tableau nu. Un job sans `public_slug`/`id`, sans titre ou sans URL
 * http(s) est écarté avec sa raison.
 */
export function parseFreehireResponse(raw: unknown): { jobs: FreehireJob[]; skipped: string[] } {
  const envelope = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray(envelope?.data) ? (envelope.data as unknown[]) : Array.isArray(envelope?.results) ? (envelope.results as unknown[]) : [];
  const jobs: FreehireJob[] = [];
  const skipped: string[] = [];
  rows.forEach((row, i) => {
    if (row === null || typeof row !== 'object') {
      skipped.push(`#${i}: not an object`);
      return;
    }
    const r = row as Record<string, unknown>;
    const slug = str(r.public_slug) || str(r.id);
    const url = str(r.url);
    const title = decodeEntities(str(r.title)).trim();
    if (slug === '' || title === '' || !/^https?:\/\//i.test(url)) {
      skipped.push(`#${i} (${slug || 'no slug'}): missing ${slug === '' ? 'public_slug' : title === '' ? 'title' : 'http(s) url'}`);
      return;
    }
    if (str(r.closed_at) !== '') {
      skipped.push(`#${i} (${slug}): closed_at ${str(r.closed_at)}`);
      return;
    }
    jobs.push({
      ...(r as unknown as FreehireJob),
      public_slug: slug,
      url,
      title,
      posted_at: str(r.posted_at) || str(r.date) || null,
      enrichment: r.enrichment !== null && typeof r.enrichment === 'object' ? (r.enrichment as FreehireJob['enrichment']) : {},
    });
  });
  return { jobs, skipped };
}

/** « 45000–55000 EUR/year » ; vide sans montant. La période est gardée : un annuel n'est pas un mensuel. */
export function salaryRange(enrichment: FreehireJob['enrichment']): string {
  const e = enrichment ?? {};
  const min = typeof e.salary_min === 'number' ? e.salary_min : null;
  const max = typeof e.salary_max === 'number' ? e.salary_max : null;
  if (min === null && max === null) return '';
  const amount = min !== null && max !== null && min !== max ? `${min}–${max}` : String(min ?? max);
  return `${amount}${e.salary_currency ? ` ${e.salary_currency}` : ''}${e.salary_period ? `/${e.salary_period}` : ''}`;
}

/** Minuscules, sans accents, mots séparés par `_` : la forme des slugs du tableau (`station_f`). */
export function slugPart(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Le slug du tableau : l'entreprise, puis le suffixe stable du `public_slug` Free-Hire (son
 * dernier segment, `2bxu6dxm` dans `golang-zensar-2bxu6dxm`), court à taper dans `/valider`,
 * stable d'un passage du radar à l'autre, unique tant que Free-Hire l'est.
 */
export function boardSlug(job: FreehireJob): string {
  const company = slugPart(str(job.company_slug) || str(job.company)) || 'freehire';
  const suffix = slugPart(job.public_slug.split('-').pop() ?? job.public_slug) || slugPart(job.public_slug);
  return `${company}_${suffix}`;
}

/** Un job Free-Hire aux champs d'une offre du tableau. */
export function toBoardCandidate(job: FreehireJob, now: Date): BoardCandidate {
  const e = job.enrichment ?? {};
  const location = str(job.location).trim() || [...list(job.cities), ...list(job.countries).map((c) => c.toUpperCase())].join(', ');
  const description = decodeEntities(str(job.description)).replace(/\r\n?/g, '\n').trim();
  return {
    id: `FH-${job.public_slug}`,
    slug: boardSlug(job),
    company: decodeEntities(str(job.company)).trim(),
    title: job.title,
    link: job.url,
    source: 'freehire',
    location,
    description: description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX)}…` : description,
    skills_required: list(job.skills).join(', '),
    salary_range: salaryRange(e),
    date_published: /^\d{4}-\d{2}-\d{2}/.exec(str(job.posted_at))?.[0] ?? '',
    found_at: now.toISOString(),
    freehire: {
      public_slug: job.public_slug,
      ats: str(job.source),
      external_id: str(job.external_id),
      company_slug: str(job.company_slug),
      work_mode: str(job.work_mode),
      seniority: str(e.seniority),
      category: str(e.category),
      employment_type: str(e.employment_type),
      countries: list(job.countries),
      regions: list(job.regions),
    },
  };
}

/** Le lien d'une annonce, comparable : sans schéma, `www.`, requête de suivi, ancre ni `/` final. */
export function linkKey(link: string): string {
  try {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_\w+|gh_src|source|src|ref|refid|trk|trackingid|lever-source|lever-origin|from)$/i.test(key)) url.searchParams.delete(key);
    }
    const query = url.searchParams.toString();
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '').toLowerCase()}${query ? `?${query}` : ''}`;
  } catch {
    return link.trim().toLowerCase();
  }
}

/** Entreprise + intitulé, repliés : la même offre vue par une autre source (LinkedIn pointe ailleurs que l'ATS). */
export function titleKey(company: string, title: string): string {
  return `${slugPart(decodeEntities(company))}|${slugPart(decodeEntities(title))}`;
}

/**
 * Ce que le tableau a déjà, quel que soit le statut (une offre APPLIED, refusée ou retirée ne
 * revient pas) : même lien d'annonce, même `public_slug` Free-Hire, même slug, ou même
 * entreprise + intitulé. Le premier critère qui joue est la raison. Les doublons d'une même
 * réponse sont aussi écartés (le premier gagne).
 */
export function dedupe(candidates: BoardCandidate[], board: unknown): { fresh: BoardCandidate[]; duplicates: { slug: string; reason: string }[] } {
  const rows = (Array.isArray(board) ? board : []).filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object');
  const links = new Map<string, string>();
  const publicSlugs = new Map<string, string>();
  const slugs = new Set<string>();
  const titles = new Map<string, string>();
  const remember = (row: Record<string, unknown>): void => {
    const slug = str(row.slug);
    if (str(row.link) !== '') links.set(linkKey(str(row.link)), slug);
    const fh = row.freehire as { public_slug?: unknown } | undefined;
    if (typeof fh?.public_slug === 'string') publicSlugs.set(fh.public_slug, slug);
    if (slug !== '') slugs.add(slug);
    if (str(row.company) !== '' && str(row.title) !== '') titles.set(titleKey(str(row.company), str(row.title)), slug);
  };
  rows.forEach(remember);
  const fresh: BoardCandidate[] = [];
  const duplicates: { slug: string; reason: string }[] = [];
  for (const candidate of candidates) {
    const byLink = links.get(linkKey(candidate.link));
    const byPublic = publicSlugs.get(candidate.freehire.public_slug);
    const byTitle = titles.get(titleKey(candidate.company, candidate.title));
    const reason =
      byLink !== undefined
        ? `same posting link as ${byLink || 'an offer on the board'}`
        : byPublic !== undefined
          ? `same Free-Hire posting as ${byPublic}`
          : slugs.has(candidate.slug)
            ? `slug ${candidate.slug} already on the board`
            : byTitle !== undefined
              ? `same company and title as ${byTitle}`
              : null;
    if (reason !== null) {
      duplicates.push({ slug: candidate.slug, reason });
      continue;
    }
    fresh.push(candidate);
    remember(candidate as unknown as Record<string, unknown>);
  }
  return { fresh, duplicates };
}

/** Les paramètres de la recherche que ferait le radar (voir la proposition). */
export interface SearchOptions {
  /** Jusqu'à 5 alternatives séparées par `OR` (en majuscules) ; `title:` restreint à l'intitulé. */
  query: string;
  countries?: string[];
  regions?: string[];
  workModes?: string[];
  postedWithinDays?: number;
  limit?: number;
}

/**
 * Le chemin et la requête de `GET /api/v1/agent/jobs/search` (descriptions complètes en texte),
 * sans hôte : le radar préfixe l'URL de base. Refuse plus de 5 alternatives (l'API répond 400).
 */
export function searchPath(options: SearchOptions): string {
  const alternatives = options.query.split(/\s+OR\s+/).filter((part) => part.trim() !== '');
  if (alternatives.length > 5) throw new Error(`Free-Hire accepts at most 5 OR alternatives, got ${alternatives.length}`);
  const params = new URLSearchParams();
  params.set('q', options.query);
  params.set('limit', String(options.limit ?? 50));
  params.set('offset', '0');
  params.set('description_format', 'text');
  if (options.postedWithinDays !== undefined) params.set('posted_within_days', String(options.postedWithinDays));
  for (const country of options.countries ?? []) params.append('countries', country.toLowerCase());
  for (const region of options.regions ?? []) params.append('regions', region);
  // `work_mode` est un seul paramètre, valeurs séparées par des virgules (comme la CLI d'ai-job-search l'envoie).
  if ((options.workModes ?? []).length > 0) params.set('work_mode', options.workModes!.join(','));
  return `/api/v1/agent/jobs/search?${params.toString()}`;
}

/** Tout le chemin d'une réponse sauvegardée aux offres à passer au jury. */
export function mapSavedResponse(raw: unknown, board: unknown, now: Date): { fresh: BoardCandidate[]; duplicates: { slug: string; reason: string }[]; skipped: string[] } {
  const { jobs, skipped } = parseFreehireResponse(raw);
  const { fresh, duplicates } = dedupe(
    jobs.map((job) => toBoardCandidate(job, now)),
    board
  );
  return { fresh, duplicates, skipped };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const input = args.find((arg, i) => !arg.startsWith('--') && !['--board', '--now'].includes(args[i - 1] ?? ''));
  if (input === undefined) {
    process.stderr.write('usage: bun radar_freehire.ts <saved-response.json> [--board <pending_gold_jobs.json>] [--now <ISO date>]\n');
    process.exitCode = 2;
  } else {
    try {
      const parse = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as unknown;
      const boardPath = option('--board');
      const board = boardPath !== undefined && existsSync(boardPath) ? parse(boardPath) : [];
      const now = new Date(option('--now') ?? Date.now());
      process.stdout.write(`${JSON.stringify(mapSavedResponse(parse(input), board, now), null, 2)}\n`);
    } catch (err) {
      process.stderr.write(`radar_freehire: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  }
}
