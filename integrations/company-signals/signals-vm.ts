#!/usr/bin/env bun
/**
 * Le collecteur de signaux d'entreprises (Antoine, 2026-11-14 : « ratisser le plus large possible
 * afin d'obtenir des directions inspirées des bons éléments »). Tourne sur la VM, après chaque cycle
 * du radar unifié (`cycle.sh`, verrou à part), sans Claude : règles et contrôles en code.
 *
 * Un passage :
 *   1. actualité (flux RSS, toutes les 2 h) : levées, nouveaux CMO/VP, expansion, rachats, licenciements… ;
 *   2. YC (une fois par jour) : entreprises européennes actives qui recrutent ;
 *   3. le registre « Entreprises full remote » du radar (toutes les 6 h, sans réseau) : poste de
 *      responsable nouveau, premier poste marketing, vague de recrutement ;
 *   4. sites (≤ `--sites` par passage, chacun relu tous les 7 jours) : nouvel outil marketing, nouvelle
 *      langue, blog ;
 *   5. registres (≤ `--enrich` entreprises par passage, les mieux notées d'abord, relues tous les 30 jours) :
 *      France (SIREN, effectif, NAF) + BODACC (capital, dirigeants, procédures), GLEIF (pays), Norvège,
 *      Royaume-Uni (Companies House, avec une clé gratuite) ;
 *   6. score, directions apprises de ses avis (`signals_feedback.json`, écrit par le cockpit) et des
 *      « bons éléments » (entreprises listées à la main, offres sélectionnées « oui »).
 *
 * Écrit dans le dossier carrière : `company_signals.json` (la vue du cockpit), `signals_status.json`
 * (le passage : sources lues, en échec, signaux trouvés), `signals_state.json` (mémoire du collecteur).
 *
 *   bun signals-vm.ts --career ~/radar-unifie/career [--env-file secrets.env] [--probe]
 *     [--sites 30] [--enrich 20] [--budget-min 6] [--fetch-module <faux réseau, tests>] [--force]
 *
 * `--probe` : chaque source une fois, un rapport lisible (statut, nombre d'éléments, un exemple), sans rien écrire.
 */

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CompanyEntry, type CompanyFacts, type Directions, NO_DIRECTIONS, type Signal, type Verdict, MAX_AGE_DAYS, isoDay, learnDirections, normName, scoreCompany, sectorsOf, validCompanyName } from './lib.ts';
import {
  type Fetch,
  type RegistryHistory,
  type SiteSnapshot,
  EMPTY_HISTORY,
  FEEDS,
  YC_URL,
  bodaccSignals,
  companiesHouseSignals,
  lookupFrance,
  lookupGleif,
  lookupNorway,
  netFetch,
  newsSignals,
  readSite,
  registrySignals,
  siteMatches,
  siteSignals,
  ycSignals,
} from './sources.ts';

export const SIGNALS_FILE = 'company_signals.json';
export const STATUS_FILE = 'signals_status.json';
export const STATE_FILE = 'signals_state.json';
export const FEEDBACK_FILE = 'signals_feedback.json';
const MAX_COMPANIES = 4000;

export interface Options {
  career: string;
  envFile: string;
  probe: boolean;
  sites: number;
  enrich: number;
  budgetMin: number;
  fetchModule: string;
  force: boolean;
  harness: string;
}

export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const home = env.HOME ?? homedir();
  const path = (v: string) => resolve(v.replace(/^~(?=$|\/)/, home));
  const o: Options = { career: '', envFile: '', probe: false, sites: 30, enrich: 20, budgetMin: 6, fetchModule: '', force: false, harness: resolve(import.meta.dir, '..', '..') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} : valeur manquante`);
      return v;
    };
    if (a === '--career') o.career = path(next());
    else if (a === '--env-file') o.envFile = path(next());
    else if (a === '--probe') o.probe = true;
    else if (a === '--sites') o.sites = Number(next());
    else if (a === '--enrich') o.enrich = Number(next());
    else if (a === '--budget-min') o.budgetMin = Number(next());
    else if (a === '--fetch-module') o.fetchModule = path(next());
    else if (a === '--force') o.force = true;
    else if (a === '--harness') o.harness = path(next());
    else throw new Error(`option inconnue : ${a}`);
  }
  if (o.career === '') throw new Error('--career est obligatoire');
  for (const [k, v] of [['--sites', o.sites], ['--enrich', o.enrich], ['--budget-min', o.budgetMin]] as const) if (!Number.isFinite(v) || v < 0) throw new Error(`${k} : un nombre ≥ 0`);
  return o;
}

/** Une clé lue par son nom dans le fichier d'environnement (jamais affichée). */
export function envValue(file: string, name: string): string {
  if (file === '' || !existsSync(file)) return process.env[name] ?? '';
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '');
  }
  return process.env[name] ?? '';
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, v: unknown, pretty = 1): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(v, null, pretty)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}

export interface SourceHealth {
  ok: number;
  fail: number;
  last_status: number;
  last_at: string;
  last_items: number;
  last_signals: number;
}

export interface State {
  last: Record<string, string>;
  health: Record<string, SourceHealth>;
  history: RegistryHistory;
  sites: Record<string, SiteSnapshot>;
  websites: Record<string, string>;
  guessed: Record<string, string>;
  enriched: Record<string, string>;
}

const EMPTY_STATE: State = { last: {}, health: {}, history: EMPTY_HISTORY, sites: {}, websites: {}, guessed: {}, enriched: {} };

export interface SignalsDoc {
  _meta: { at: string; version: 1; directions: Directions; sources: Record<string, SourceHealth>; rule: string };
  companies: Record<string, CompanyEntry>;
}

export interface StatusReport {
  at: string;
  ok: boolean;
  seconds: number;
  ran: string[];
  skipped: string[];
  failed: { source: string; status: number }[];
  new_signals: number;
  companies: number;
  strong: number;
  notes: string[];
}

const ATS_HOST = /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|welcometothejungle|recruitee|teamtailor|personio|smartrecruiters|bamboohr|linkedin\.com|indeed\./i;

/** Les « bons éléments » : entreprises listées à la main, offres sélectionnées « oui », offres préparées ou envoyées. */
export function goodSeeds(career: string, systemManual: string): Set<string> {
  const out = new Set<string>();
  for (const f of [join(career, 'entreprises_full_remote.json'), systemManual]) {
    const d = readJson<Record<string, unknown>>(f, {});
    for (const [k, v] of Object.entries(d)) if (!k.startsWith('_') && Array.isArray(v)) for (const slug of v) out.add(normName(String(slug)));
  }
  const selDir = join(career, 'selection');
  if (existsSync(selDir)) {
    for (const f of readdirSync(selDir).filter((n) => n.endsWith('.json'))) {
      const d = readJson<Record<string, unknown>>(join(selDir, f), {});
      const answers = (d.answers ?? {}) as Record<string, { decision?: string }>;
      for (const p of (Array.isArray(d.picks) ? d.picks : []) as { key?: string; company?: string }[]) if (p.key && answers[p.key]?.decision === 'go' && p.company) out.add(normName(p.company));
    }
  }
  const board = readJson<unknown[]>(join(career, 'pending_gold_jobs.json'), []);
  for (const r of Array.isArray(board) ? board : []) {
    const row = r as { status?: string; company?: string };
    if (row && ['TAILORED', 'APPLIED', 'APPLY_UNPROVEN', 'APPLYING'].includes(String(row.status)) && row.company) out.add(normName(row.company));
  }
  out.delete('');
  return out;
}

/** Ajoute des signaux aux fiches (dédoublonnés par id), crée la fiche au besoin. */
export function addSignals(companies: Record<string, CompanyEntry>, signals: Signal[]): number {
  let added = 0;
  for (const s of signals) {
    if (!validCompanyName(s.company) || s.date === '') continue;
    const norm = normName(s.company);
    const c = (companies[norm] ??= { name: s.company, norm, country: '', remote_key: '', remote_kind: '', careers: '', facts: {}, signals: [], score: 0, why: [] });
    if (c.signals.some((x) => x.id === s.id)) continue;
    c.signals.push(s);
    added++;
    if (!c.country && s.country) c.country = s.country;
    if (s.detail) {
      const sec = sectorsOf(s.detail);
      if (sec.length) c.facts.sectors = [...new Set([...(c.facts.sectors ?? []), ...sec])].slice(0, 4);
    }
  }
  return added;
}

/** Le registre du radar rattaché aux fiches (par nom), et les sites connus (index de l'ancien radar, YC). */
export function attachRegistry(companies: Record<string, CompanyEntry>, remoteDoc: unknown, indexDoc: unknown, state: State): void {
  const reg = new Map<string, { key: string; kind: 'full' | 'partiel'; careers: string; name: string }>();
  const rc = ((remoteDoc as { companies?: Record<string, { name?: string; kind?: string; careers?: string }> })?.companies ?? {}) as Record<string, { name?: string; kind?: string; careers?: string }>;
  for (const [key, c] of Object.entries(rc)) {
    const n = normName(String(c.name ?? ''));
    if (n === '') continue;
    const prev = reg.get(n);
    const kind = c.kind === 'partiel' ? 'partiel' : 'full';
    if (!prev || (prev.kind === 'partiel' && kind === 'full')) reg.set(n, { key, kind, careers: String(c.careers ?? ''), name: String(c.name) });
  }
  for (const c of Object.values(companies)) {
    const r = reg.get(c.norm);
    c.remote_key = r?.key ?? '';
    c.remote_kind = r?.kind ?? '';
    c.careers = r?.careers ?? c.careers;
  }
  for (const row of Array.isArray(indexDoc) ? indexDoc : []) {
    const r = row as { name?: string; careers_url?: string; domain?: string };
    const n = normName(String(r.name ?? ''));
    if (n === '') continue;
    const url = String(r.careers_url ?? '');
    if (/^https?:\/\//.test(url) && !ATS_HOST.test(url) && !state.websites[n]) state.websites[n] = new URL(url).origin;
    if (companies[n] && r.domain) companies[n].facts.sectors = [...new Set([...(companies[n].facts.sectors ?? []), ...sectorsOf(String(r.domain))])].slice(0, 4);
  }
}

const due = (state: State, id: string, hours: number, now: Date, force: boolean): boolean => force || !state.last[id] || now.getTime() - Date.parse(state.last[id]) >= hours * 3_600_000;

function health(state: State, id: string, status: number, items: number, signals: number, now: Date): void {
  const h = (state.health[id] ??= { ok: 0, fail: 0, last_status: 0, last_at: '', last_items: 0, last_signals: 0 });
  if (status === 200) h.ok++;
  else h.fail++;
  h.last_status = status;
  h.last_at = now.toISOString();
  h.last_items = items;
  h.last_signals = signals;
}

async function loadFetch(o: Options): Promise<Fetch> {
  if (o.fetchModule === '') return netFetch;
  const m = (await import(o.fetchModule)) as { default: Fetch };
  return m.default;
}

export async function runPass(o: Options, now: () => Date = () => new Date()): Promise<StatusReport> {
  const t0 = Date.now();
  const at = now();
  const f = await loadFetch(o);
  const state: State = { ...EMPTY_STATE, ...readJson<Partial<State>>(join(o.career, STATE_FILE), {}) } as State;
  const doc = readJson<SignalsDoc>(join(o.career, SIGNALS_FILE), { _meta: { at: '', version: 1, directions: NO_DIRECTIONS, sources: {}, rule: '' }, companies: {} });
  const companies = doc.companies ?? {};
  const report: StatusReport = { at: at.toISOString(), ok: true, seconds: 0, ran: [], skipped: [], failed: [], new_signals: 0, companies: 0, strong: 0, notes: [] };
  const overBudget = () => (Date.now() - t0) / 60_000 > o.budgetMin;
  const fail = (source: string, status: number) => report.failed.push({ source, status });

  // 1. Actualité.
  for (const feed of FEEDS) {
    const id = `rss:${feed.id}`;
    // Une source qui échoue 10 fois de suite n'est plus relue qu'une fois par jour.
    const h = state.health[id];
    const every = h && h.fail >= 10 && h.last_status !== 200 ? 24 : 2;
    if (!due(state, id, every, at, o.force)) {
      report.skipped.push(id);
      continue;
    }
    state.last[id] = at.toISOString();
    const r = await f(feed.url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (r.status !== 200) {
      health(state, id, r.status, 0, 0, at);
      fail(feed.name, r.status);
      continue;
    }
    const { signals, items } = newsSignals(feed, r.text, at);
    const fresh = signals.filter((s) => Date.parse(s.date) >= at.getTime() - MAX_AGE_DAYS * 86_400_000);
    report.new_signals += addSignals(companies, fresh);
    health(state, id, items > 0 ? 200 : -1, items, fresh.length, at);
    if (items === 0) fail(`${feed.name} (flux illisible)`, -1);
    report.ran.push(id);
  }

  // 2. YC.
  if (due(state, 'yc', 24, at, o.force)) {
    state.last.yc = at.toISOString();
    const r = await f(YC_URL);
    if (r.status === 200) {
      const { signals, sites, read } = ycSignals(r.text, at);
      // Un signal YC par entreprise et par mois (la liste ne dit pas quand l'entreprise s'est mise à recruter).
      for (const s of signals) s.id = `${s.id}-${isoDay(at).slice(0, 7)}`;
      const keep = signals.filter((s) => !companies[normName(s.company)]?.signals.some((x) => x.source === 'Y Combinator' && Date.parse(x.date) > at.getTime() - 30 * 86_400_000));
      report.new_signals += addSignals(companies, keep);
      for (const [n, url] of Object.entries(sites)) state.websites[n] ??= url;
      health(state, 'yc', read > 0 ? 200 : -1, read, keep.length, at);
      report.ran.push('yc');
    } else {
      health(state, 'yc', r.status, 0, 0, at);
      fail('Y Combinator', r.status);
    }
  } else report.skipped.push('yc');

  // 3. Registre du radar (sans réseau).
  const remoteDoc = readJson<unknown>(join(o.career, 'remote_companies.json'), null);
  const jobsDoc = readJson<unknown>(join(o.career, 'remote_company_jobs.json'), null);
  if (remoteDoc !== null && due(state, 'registre', 6, at, o.force)) {
    state.last.registre = at.toISOString();
    const r = registrySignals(remoteDoc, jobsDoc, state.history, at);
    state.history = r.history;
    report.new_signals += addSignals(companies, r.signals);
    health(state, 'registre', 200, r.companies, r.signals.length, at);
    report.ran.push('registre');
  } else report.skipped.push('registre');

  attachRegistry(companies, remoteDoc, readJson<unknown>(join(o.career, 'verified_remote_companies.json'), []), state);

  // Les avis et les bons éléments, puis un premier score (pour choisir quoi enrichir et quels sites lire).
  const feedback = readJson<{ verdicts?: Record<string, Verdict> }>(join(o.career, FEEDBACK_FILE), {}).verdicts ?? {};
  const seeds = goodSeeds(o.career, join(o.harness, '.archon', 'workflows', 'systems', '.shared', 'radar', 'entreprises_full_remote.json'));
  const verdicts: Record<string, Verdict> = {};
  for (const n of seeds) verdicts[n] = 'bon';
  Object.assign(verdicts, feedback);
  // Les bons éléments ont une fiche même sans signal : ils montrent la direction (secteur, pays) et restent visibles.
  const names = new Map<string, string>();
  for (const c of Object.values(((remoteDoc as { companies?: Record<string, { name?: string; slug?: string }> } | null)?.companies ?? {}) as Record<string, { name?: string; slug?: string }>)) {
    if (c.name) names.set(normName(c.name), c.name);
    if (c.slug && c.name) names.set(normName(c.slug), c.name);
  }
  for (const n of Object.keys(verdicts)) {
    if (companies[n] || !names.has(n)) continue;
    const name = names.get(n) as string;
    companies[normName(name)] ??= { name, norm: normName(name), country: '', remote_key: '', remote_kind: '', careers: '', facts: {}, signals: [], score: 0, why: [] };
    if (normName(name) !== n) verdicts[normName(name)] ??= verdicts[n];
  }
  attachRegistry(companies, remoteDoc, readJson<unknown>(join(o.career, 'verified_remote_companies.json'), []), state);
  const rescore = (d: Directions) => {
    for (const c of Object.values(companies)) Object.assign(c, scoreCompany(c, at, d));
  };
  rescore(doc._meta?.directions ?? NO_DIRECTIONS);
  const ranked = Object.values(companies).sort((a, b) => b.score - a.score);

  // 4. Sites : les mieux notées, puis les entreprises 100 % remote du registre.
  const chKey = envValue(o.envFile, 'COMPANIES_HOUSE_API_KEY');
  const siteQueue: { name: string; norm: string }[] = [];
  for (const c of ranked) if (c.score > 0) siteQueue.push({ name: c.name, norm: c.norm });
  const rc = ((remoteDoc as { companies?: Record<string, { name?: string; kind?: string }> } | null)?.companies ?? {}) as Record<string, { name?: string; kind?: string }>;
  for (const c of Object.values(rc)) if (c.kind === 'full' && c.name) siteQueue.push({ name: c.name, norm: normName(c.name) });
  let siteReads = 0;
  let guesses = 0;
  const seenSite = new Set<string>();
  for (const q of siteQueue) {
    if (siteReads >= o.sites || overBudget()) break;
    if (seenSite.has(q.norm) || q.norm.length < 3) continue;
    seenSite.add(q.norm);
    const prev = state.sites[q.norm] ?? null;
    if (prev && Date.parse(prev.at) > at.getTime() - 7 * 86_400_000) continue;
    let url = state.websites[q.norm] ?? '';
    let html = '';
    if (url === '') {
      // Deviner le domaine (au plus 10 entreprises par passage, une fois par mois) ; gardé seulement si la page porte son nom.
      if (guesses >= 10 || (state.guessed[q.norm] && Date.parse(state.guessed[q.norm]) > at.getTime() - 30 * 86_400_000)) continue;
      guesses++;
      state.guessed[q.norm] = at.toISOString();
      for (const tld of ['com', 'io', 'co', 'fr', 'ai']) {
        const u = `https://${q.norm}.${tld}`;
        const r = await f(u);
        siteReads++;
        if (r.status === 200 && siteMatches(q.name, r.text)) {
          url = u;
          html = r.text;
          state.websites[q.norm] = u;
          break;
        }
        if (siteReads >= o.sites) break;
      }
      if (url === '') continue;
    } else {
      const r = await f(url);
      siteReads++;
      if (r.status !== 200) {
        health(state, 'sites', r.status, 1, 0, at);
        continue;
      }
      html = r.text;
    }
    const cur = readSite(url, html, at);
    const sig = siteSignals(q.name, prev, cur, at);
    report.new_signals += addSignals(companies, sig);
    state.sites[q.norm] = cur;
    const c = companies[q.norm];
    if (c) Object.assign(c.facts, { website: url, stack: cur.tools, languages: cur.languages });
    health(state, 'sites', 200, 1, sig.length, at);
  }
  if (siteReads) report.ran.push(`sites (${siteReads} page${siteReads > 1 ? 's' : ''})`);

  // 5. Registres : les mieux notées d'abord, relues tous les 30 jours.
  let enriched = 0;
  for (const c of ranked) {
    if (enriched >= o.enrich || overBudget()) break;
    if (c.score <= 0) break;
    if (state.enriched[c.norm] && Date.parse(state.enriched[c.norm]) > at.getTime() - 30 * 86_400_000) continue;
    enriched++;
    state.enriched[c.norm] = at.toISOString();
    const facts: CompanyFacts = {};
    if (c.country === '' || c.country === 'FR') {
      const fr = await lookupFrance(c.name, f);
      health(state, 'registre-fr', fr.status, 1, fr.facts ? 1 : 0, at);
      if (fr.status !== 200) fail('API Recherche d’entreprises', fr.status);
      if (fr.facts) Object.assign(facts, fr.facts);
    }
    if (!facts.siren && c.country !== 'GB') {
      const g = await lookupGleif(c.name, f);
      health(state, 'gleif', g.status, 1, g.facts ? 1 : 0, at);
      if (g.facts) Object.assign(facts, g.facts);
    }
    if (facts.siren) {
      const b = await bodaccSignals(facts.siren, c.name, f, at);
      health(state, 'bodacc', b.status, 1, b.signals.length, at);
      if (b.status !== 200) fail('BODACC', b.status);
      report.new_signals += addSignals(companies, b.signals);
    }
    if (c.country === 'NO' || facts.registry_country === 'NO') {
      const n = await lookupNorway(c.name, f);
      health(state, 'brreg', n.status, 1, n.facts ? 1 : 0, at);
      if (n.facts) Object.assign(facts, n.facts);
    }
    if (chKey !== '' && (c.country === 'GB' || facts.registry_country === 'GB')) {
      const ch = await companiesHouseSignals(c.name, chKey, f, at);
      health(state, 'companies-house', ch.status, 1, ch.signals.length, at);
      if (ch.facts) Object.assign(facts, ch.facts);
      report.new_signals += addSignals(companies, ch.signals);
    }
    if (facts.registry_country && !c.country) c.country = facts.registry_country;
    if (facts.naf) facts.sectors = [...new Set([...(c.facts.sectors ?? []), ...nafSectors(facts.naf)])].slice(0, 4);
    Object.assign(c.facts, facts, { checked_at: at.toISOString() });
  }
  if (enriched) report.ran.push(`registres (${enriched} entreprise${enriched > 1 ? 's' : ''})`);
  if (chKey === '') report.notes.push('Companies House sauté : pas de clé COMPANIES_HOUSE_API_KEY (gratuite)');

  // 6. Purge, directions, score final.
  const cutoff = at.getTime() - MAX_AGE_DAYS * 86_400_000;
  for (const [n, c] of Object.entries(companies)) {
    c.signals = c.signals.filter((s) => Date.parse(s.date) >= cutoff).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    if (c.signals.length === 0 && verdicts[n] === undefined) delete companies[n];
  }
  const directions = learnDirections(Object.values(companies), verdicts, at.toISOString());
  rescore(directions);
  const kept = Object.values(companies).sort((a, b) => b.score - a.score).slice(0, MAX_COMPANIES);
  const out: Record<string, CompanyEntry> = {};
  for (const c of kept) out[c.norm] = c;
  report.companies = kept.length;
  report.strong = kept.filter((c) => c.score >= 1).length;
  report.seconds = Math.round((Date.now() - t0) / 100) / 10;
  report.ok = report.failed.length < FEEDS.length;
  if (!o.probe) {
    writeJson(join(o.career, SIGNALS_FILE), { _meta: { at: at.toISOString(), version: 1, directions, sources: state.health, rule: 'score = somme des signaux × fraîcheur (demi-vie 45 j) × directions ; ×1,4 entreprise 100 % remote ; ×0,7 Royaume-Uni ; 0 hors d’Europe' }, companies: out } satisfies SignalsDoc);
    writeJson(join(o.career, STATE_FILE), state, 0);
    writeJson(join(o.career, STATUS_FILE), report, 2);
  }
  return report;
}

/** Les secteurs d'un code NAF (quelques familles utiles, le reste vide). */
export function nafSectors(naf: string): string[] {
  const n = naf.replace(/\./g, '');
  if (/^(5829|6201|6202|6203|6209|6311|6312)/.test(n)) return ['SaaS B2B'];
  if (/^(64|65|66)/.test(n)) return ['Fintech'];
  if (/^(7311|7312|7320)/.test(n)) return ['Martech / ventes'];
  if (/^(4791|4799)/.test(n)) return ['E-commerce'];
  if (/^(85)/.test(n)) return ['Éducation'];
  if (/^(86|21|7211)/.test(n)) return ['Santé'];
  return [];
}

/** `--probe` : chaque source une fois, un rapport lisible, rien d'écrit. */
export async function probe(o: Options, now = new Date()): Promise<string[]> {
  const f = await loadFetch(o);
  const lines: string[] = [];
  const line = (name: string, status: number, what: string) => lines.push(`${status === 200 ? 'OK  ' : 'ÉCHEC'} ${name.padEnd(28)} ${status} ${what}`);
  for (const feed of FEEDS) {
    const r = await f(feed.url);
    if (r.status !== 200) {
      line(feed.name, r.status, '');
      continue;
    }
    const n = newsSignals(feed, r.text, now);
    line(feed.name, n.items > 0 ? 200 : -1, `${n.items} articles, ${n.signals.length} signaux${n.signals[0] ? ` (ex. ${n.signals[0].type} : ${n.signals[0].company})` : ''}`);
  }
  const y = await f(YC_URL);
  const ys = y.status === 200 ? ycSignals(y.text, now) : null;
  line('Y Combinator', y.status, ys ? `${ys.read} entreprises qui recrutent, ${ys.signals.length} en Europe${ys.signals[0] ? ` (ex. ${ys.signals[0].company})` : ''}` : '');
  const fr = await lookupFrance('Qonto', f);
  line('API Recherche d’entreprises', fr.status, fr.facts ? `Qonto → SIREN ${fr.facts.siren}, ${fr.facts.effectif} salariés, NAF ${fr.facts.naf}` : 'Qonto introuvable');
  const b = await bodaccSignals(fr.facts?.siren || '819489626', 'Qonto', f, now);
  line('BODACC', b.status, `${b.signals.length} annonce(s) utile(s) sur 12 mois pour Qonto${b.signals[0] ? ` (ex. ${b.signals[0].type})` : ''}`);
  const g = await lookupGleif('Qonto', f);
  line('GLEIF', g.status, g.facts ? `Qonto → LEI ${g.facts.lei}, pays ${g.facts.registry_country}` : 'Qonto introuvable');
  const n = await lookupNorway('Kahoot! ASA', f);
  line('Brønnøysund (Norvège)', n.status, n.facts ? `Kahoot! → ${n.facts.effectif} salariés` : 'Kahoot! introuvable');
  const key = envValue(o.envFile, 'COMPANIES_HOUSE_API_KEY');
  if (key) {
    const ch = await companiesHouseSignals('Monzo Bank Limited', key, f, now);
    line('Companies House', ch.status, ch.facts ? `Monzo → ${ch.facts.uk_number}, ${ch.signals.length} signal(aux) sur 6 mois` : 'Monzo introuvable');
  } else lines.push('—     Companies House              pas de clé COMPANIES_HOUSE_API_KEY (gratuite, à créer)');
  const s = await f('https://posthog.com');
  line('Site (posthog.com)', s.status, s.status === 200 ? `outils vus : ${readSite('https://posthog.com', s.text, now).tools.join(', ') || 'aucun'}` : '');
  return lines;
}

if (import.meta.main) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.probe) {
      for (const l of await probe(o)) console.log(l);
    } else {
      const r = await runPass(o);
      console.log(`${r.at} signaux : ${r.new_signals} nouveau(x), ${r.companies} entreprise(s) dont ${r.strong} à signal fort | lu : ${r.ran.join(', ') || 'rien (cadences)'}${r.failed.length ? ` | échecs : ${r.failed.map((x) => `${x.source} ${x.status}`).join(', ')}` : ''} | ${r.seconds} s`);
    }
  } catch (err) {
    console.error(`signals-vm : ${(err as Error).message}`);
    process.exitCode = 2;
  }
}
