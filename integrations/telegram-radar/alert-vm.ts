/**
 * Les alertes du radar unifié, sur la VM, après chaque cycle (cycle.sh, verrou à part) : une
 * alerte Telegram par offre que le tri local vient de RETENIR (`triage_local/<clé>.json`,
 * `decision: retenue`), au plus `alertes_max_jour` par jour (heure de Paris), jamais deux fois.
 *
 *   bun alert-vm.ts --career ~/radar-unifie/career [--env-file <fichier>]… [--dry-run]
 *
 * Coupé sans bruit (code 0) tant qu'il manque le jeton `RADAR_BOT_TOKEN` ou le compte réservé
 * (`radar_bot.json`, écrit par le cockpit du PC au premier /start et poussé ici). Au tout premier
 * passage, `radar_alerts.json` marque l'heure : les offres déjà triées ne sont pas envoyées
 * (pas de rafale d'arriéré). Zéro Claude.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type AlertOffer, type BotLink, type Fetch, TOKEN_NAME, TelegramError, alertKeyboard, alertText, parisDay, readBotLink, readEnvKey, tg, writeJsonAtomic } from './telegram.ts';

export const STATE_FILE = 'radar_alerts.json';
const KEEP_SENT_DAYS = 30;

export interface AlertState {
  since: string;
  sent: Record<string, string>;
  days: Record<string, number>;
}

export function parseState(value: unknown): AlertState | null {
  const o = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (o === null || typeof o.since !== 'string') return null;
  const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const sent: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(o.sent))) if (typeof v === 'string') sent[k] = v;
  const days: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(o.days))) if (typeof v === 'number') days[k] = v;
  return { since: o.since, sent, days };
}

export interface Candidate extends AlertOffer {
  key: string;
  at: string;
}

/** Les offres retenues par le tri local, triées après `since`, pas encore envoyées, des plus anciennes aux plus récentes. */
export function pickAlerts(records: unknown[], state: AlertState): Candidate[] {
  const out: Candidate[] = [];
  for (const r of records) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key : typeof o.id === 'string' ? o.id : '';
    const at = typeof o.at === 'string' ? o.at : '';
    const slug = typeof o.slug === 'string' ? o.slug : '';
    if (key === '' || slug === '' || o.decision !== 'retenue' || at === '' || at <= state.since || state.sent[key] !== undefined) continue;
    const sal = o.salary_annual_eur as { min?: unknown; max?: unknown } | null | undefined;
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    out.push({
      key,
      at,
      slug,
      title: typeof o.title === 'string' ? o.title : '',
      company: typeof o.company === 'string' ? o.company : '',
      link: typeof o.link === 'string' ? o.link : '',
      salary: sal ? { min: num(sal.min), max: num(sal.max) } : null,
      reasons: Array.isArray(o.reasons) ? o.reasons.filter((x): x is string => typeof x === 'string') : [],
      notes: Array.isArray(o.notes) ? o.notes.filter((x): x is string => typeof x === 'string') : [],
    });
  }
  // Une même offre vue sous deux clés (deux sources) : une seule alerte, par lien.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((c) => {
      const id = c.link !== '' ? c.link : c.key;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export function pruneState(state: AlertState, now: Date): AlertState {
  const cut = new Date(now.getTime() - KEEP_SENT_DAYS * 86_400_000).toISOString();
  const sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => at >= cut));
  const today = parisDay(now);
  const days = Object.fromEntries(Object.entries(state.days).filter(([d]) => d >= parisDay(new Date(now.getTime() - 7 * 86_400_000)) || d === today));
  return { since: state.since, sent, days };
}

function readRecords(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch {
      /* fiche en cours d'écriture : au prochain cycle */
    }
  }
  return out;
}

export interface RunResult {
  sent: number;
  skipped: string;
  errors: string[];
}

export async function runAlerts(o: { career: string; envFiles: string[]; now?: Date; fetchFn?: Fetch; dryRun?: boolean; env?: Record<string, string | undefined> }): Promise<RunResult> {
  const now = o.now ?? new Date();
  const token = readEnvKey(o.envFiles, TOKEN_NAME, o.env ?? process.env);
  const link: BotLink = readBotLink(o.career);
  if (token === '') return { sent: 0, skipped: `alertes coupées : ${TOKEN_NAME} absent des secrets`, errors: [] };
  if (link.chat_id === null) return { sent: 0, skipped: 'alertes coupées : bot pas encore réservé (envoie /start au bot, cockpit du PC allumé)', errors: [] };
  if (!link.alertes) return { sent: 0, skipped: 'alertes coupées dans radar_bot.json (alertes: false)', errors: [] };
  const statePath = join(o.career, STATE_FILE);
  let state: AlertState | null = null;
  try {
    state = existsSync(statePath) ? parseState(JSON.parse(readFileSync(statePath, 'utf8'))) : null;
  } catch {
    state = null;
  }
  if (state === null) {
    if (!o.dryRun) writeJsonAtomic(statePath, { since: now.toISOString(), sent: {}, days: {} });
    return { sent: 0, skipped: 'premier passage : départ marqué, les offres déjà triées ne sont pas envoyées', errors: [] };
  }
  state = pruneState(state, now);
  const today = parisDay(now);
  const room = Math.max(0, link.alertes_max_jour - (state.days[today] ?? 0));
  const todo = pickAlerts(readRecords(join(o.career, 'triage_local')), state);
  if (todo.length === 0) return { sent: 0, skipped: 'aucune nouvelle offre retenue', errors: [] };
  const errors: string[] = [];
  let sent = 0;
  for (const c of todo.slice(0, room)) {
    if (o.dryRun) {
      console.log(`[dry-run] ${c.key} : ${c.title} — ${c.company}`);
      sent++;
      continue;
    }
    try {
      await tg(token, 'sendMessage', { chat_id: link.chat_id, text: alertText(c), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: alertKeyboard(c, link.cockpit_url) }, o.fetchFn);
      state.sent[c.key] = now.toISOString();
      state.days[today] = (state.days[today] ?? 0) + 1;
      sent++;
    } catch (err) {
      errors.push(`${c.key} : ${(err as Error).message}`);
      // Trop de requêtes, ou bot bloqué / jeton refusé : on s'arrête là, le cycle suivant reprend.
      if (err instanceof TelegramError && (err.code === 429 || err.code === 401 || err.code === 403)) break;
    }
  }
  // Au-delà du plafond : marquées « vues » pour ne pas tomber en rafale demain ; elles restent dans le cockpit.
  const over = todo.slice(room);
  if (!o.dryRun) {
    for (const c of over) state.sent[c.key] = `${now.toISOString()} (plafond)`;
    writeJsonAtomic(statePath, state);
  }
  return { sent, skipped: over.length > 0 ? `${over.length} offre(s) au-delà du plafond de ${link.alertes_max_jour}/jour : dans le cockpit seulement` : '', errors };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const val = (flag: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : '';
  };
  const career = val('--career');
  if (career === '') {
    console.error('usage : bun alert-vm.ts --career <dossier carrière> [--env-file <fichier>] [--dry-run]');
    process.exit(2);
  }
  // --env-file peut se répéter : la dernière donnée est lue en premier.
  const envFiles = argv.flatMap((a, i) => (a === '--env-file' && argv[i + 1] ? [resolve(argv[i + 1]!)] : [])).reverse();
  const r = await runAlerts({ career: resolve(career), envFiles, dryRun: argv.includes('--dry-run') });
  const stamp = new Date().toISOString();
  console.log(`[alertes ${stamp}] ${r.sent} envoyée(s)${r.skipped ? ` ; ${r.skipped}` : ''}${r.errors.length ? ` ; erreurs : ${r.errors.join(' | ')}` : ''}`);
}
