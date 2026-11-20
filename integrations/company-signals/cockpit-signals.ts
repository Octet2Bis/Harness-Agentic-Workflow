/**
 * L'onglet « Signaux » du cockpit : la vue des entreprises à signal (company_signals.json, rapatrié de
 * la VM), ses avis (« bonne piste » / « pas pour moi », dans signals_feedback.json, renvoyé à la VM où
 * ils font les directions) et la file « À prospecter » (a_prospecter/<entreprise>.json) : Claude ne la
 * lit que quand Antoine le demande (company-outreach) ; rien ne part vers une entreprise sans son go.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompanyEntry, type Directions, LABEL, NO_DIRECTIONS, type Verdict, fmtEur } from './lib.ts';

export const SIGNALS_FILE = 'company_signals.json';
export const STATUS_FILE = 'signals_status.json';
export const FEEDBACK_FILE = 'signals_feedback.json';
export const PROSPECT_DIR = 'a_prospecter';
const NORM = /^[a-z0-9]{1,80}$/;

export interface SignalRow {
  type: string;
  label: string;
  date: string;
  source: string;
  url: string;
  evidence: string;
  amount: string;
  detail: string;
  negative: boolean;
}

export interface SignalCompany {
  norm: string;
  name: string;
  country: string;
  remote_kind: string;
  remote_key: string;
  careers: string;
  facts: CompanyEntry['facts'];
  score: number;
  why: string[];
  verdict: Verdict | null;
  prospect: boolean;
  remote_jobs: number;
  signals: SignalRow[];
}

export interface SignalsView {
  at: string | null;
  rule: string;
  directions: Directions;
  status: { at: string; ran: string[]; failed: { source: string; status: number }[]; new_signals: number; notes: string[] } | null;
  sources: { id: string; ok: number; fail: number; last_status: number; last_at: string; last_signals: number }[];
  companies: SignalCompany[];
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const https = (v: unknown): string => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : '');

export function readVerdicts(career: string): Record<string, Verdict> {
  const v = rec(rec(readJson(join(career, FEEDBACK_FILE))).verdicts);
  const out: Record<string, Verdict> = {};
  for (const [k, x] of Object.entries(v)) if (NORM.test(k) && (x === 'bon' || x === 'non')) out[k] = x;
  return out;
}

/** La vue de l'onglet : les entreprises les mieux notées d'abord, avec leurs signaux (lien, preuve) et tes avis. */
export function signalsView(career: string): SignalsView {
  const doc = rec(readJson(join(career, SIGNALS_FILE)));
  const meta = rec(doc._meta);
  const status = readJson(join(career, STATUS_FILE)) as SignalsView['status'];
  const verdicts = readVerdicts(career);
  const jobs = rec(rec(readJson(join(career, 'remote_company_jobs.json'))).companies);
  const companies: SignalCompany[] = [];
  for (const [norm, raw] of Object.entries(rec(doc.companies))) {
    if (!NORM.test(norm)) continue;
    const c = rec(raw);
    const sigs = (Array.isArray(c.signals) ? c.signals : []).map(rec).filter((s) => https(s.url) !== '' || String(s.url ?? '').startsWith('http://'));
    companies.push({
      norm,
      name: String(c.name ?? norm),
      country: String(c.country ?? ''),
      remote_kind: String(c.remote_kind ?? ''),
      remote_key: String(c.remote_key ?? ''),
      careers: https(c.careers),
      facts: rec(c.facts) as CompanyEntry['facts'],
      score: typeof c.score === 'number' ? c.score : 0,
      why: (Array.isArray(c.why) ? c.why : []).map(String).slice(0, 6),
      verdict: verdicts[norm] ?? null,
      prospect: existsSync(join(career, PROSPECT_DIR, `${norm}.json`)),
      remote_jobs: Array.isArray(rec(jobs[String(c.remote_key ?? '')]).jobs) ? (rec(jobs[String(c.remote_key ?? '')]).jobs as unknown[]).length : 0,
      signals: sigs.map((s) => {
        const type = String(s.type ?? '');
        return {
          type,
          label: LABEL[type as keyof typeof LABEL] ?? type,
          date: String(s.date ?? ''),
          source: String(s.source ?? ''),
          url: String(s.url ?? ''),
          evidence: String(s.evidence ?? '').slice(0, 300),
          amount: typeof s.amount_eur === 'number' ? fmtEur(s.amount_eur) : '',
          detail: String(s.detail ?? '').slice(0, 200),
          negative: type === 'licenciements' || type === 'procedure',
        };
      }),
    });
  }
  companies.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'));
  const sources = Object.entries(rec(meta.sources)).map(([id, h]) => ({ id, ...(rec(h) as { ok: number; fail: number; last_status: number; last_at: string; last_signals: number }) }));
  return { at: typeof meta.at === 'string' ? meta.at : null, rule: String(meta.rule ?? ''), directions: (rec(meta.directions) as unknown as Directions) ?? NO_DIRECTIONS, status: status && typeof status === 'object' ? status : null, sources, companies };
}

/** Ton avis sur une entreprise (null l'efface) ; renvoyé à la VM au prochain rafraîchissement. */
export function setVerdict(career: string, norm: string, verdict: Verdict | null, now = new Date()): { ok: boolean; note: string } {
  if (!NORM.test(norm)) return { ok: false, note: 'entreprise invalide' };
  const path = join(career, FEEDBACK_FILE);
  const doc = rec(readJson(path));
  const verdicts = { ...readVerdicts(career) };
  if (verdict === null) delete verdicts[norm];
  else verdicts[norm] = verdict;
  const out = { _note: 'Avis d’Antoine sur les entreprises à signal (onglet Signaux du cockpit) : « bon » / « non ». La VM en tire les directions.', ...doc, at: now.toISOString(), verdicts };
  writeFileSync(`${path}.tmp`, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
  return { ok: true, note: verdict === null ? 'avis effacé' : verdict === 'bon' ? 'noté : bonne piste' : 'noté : pas pour toi' };
}

/** Met l'entreprise dans la file « À prospecter » : un fichier que Claude lit quand tu le demandes. Rien n'est envoyé. */
export function queueProspect(career: string, norm: string, now = new Date()): { ok: boolean; note: string } {
  if (!NORM.test(norm)) return { ok: false, note: 'entreprise invalide' };
  const c = signalsView(career).companies.find((x) => x.norm === norm);
  if (!c) return { ok: false, note: 'entreprise introuvable : rafraîchis' };
  mkdirSync(join(career, PROSPECT_DIR), { recursive: true });
  const path = join(career, PROSPECT_DIR, `${norm}.json`);
  const body = {
    entreprise: c.name,
    pays: c.country,
    demande_le: now.toISOString(),
    remote: c.remote_kind,
    page_carrieres: c.careers,
    site: c.facts.website ?? '',
    siren: c.facts.siren ?? '',
    signaux: c.signals.slice(0, 8).map((s) => ({ type: s.label, date: s.date, source: s.source, lien: s.url, preuve: s.evidence })),
    consigne: 'Préparer avec company-outreach (dossier, angle, message) quand Antoine le demande. Rien ne part sans son go.',
  };
  writeFileSync(`${path}.tmp`, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
  return { ok: true, note: 'dans la file « À prospecter » : demande à Claude de préparer le message quand tu veux' };
}
