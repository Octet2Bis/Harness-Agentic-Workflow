/**
 * Le bot Telegram du radar unifié : un bot À PART (jeton `RADAR_BOT_TOKEN`), jamais le bot de
 * production de Master Plan (pm2 `telegram-bots`), qui n'est ni lu ni touché.
 *
 * Deux moitiés, qui ne se marchent pas dessus :
 *   - la VM ENVOIE les alertes (`alert-vm.ts`, après chaque cycle du radar) : `sendMessage` seulement ;
 *   - le cockpit du PC ÉCOUTE (`getUpdates`, `pc-bot.ts`) : `/start` réserve le bot à un compte,
 *     le bouton « CV sur mesure » lance career-apply en mode `cv-only`, puis le PDF repart.
 * Telegram garde les appuis 24 h : PC éteint, la demande attend et part au rallumage.
 *
 * Le jeton n'est lu que par son NOM dans les fichiers d'env (jamais écrit, jamais affiché ; les
 * erreurs le masquent). `radar_bot.json` (dossier carrière, poussé vers la VM par
 * pull_radar_vm.ps1) : le compte réservé (`chat_id`) et l'adresse du cockpit au téléphone.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_NAME = 'RADAR_BOT_TOKEN';
export const LINK_FILE = 'radar_bot.json';
/** Plafond d'alertes par jour (heure de Paris), réglable dans radar_bot.json (`alertes_max_jour`). */
export const DEFAULT_DAILY_CAP = 20;

/** La valeur d'une variable par son nom : `env` d'abord, puis les fichiers dans l'ordre ; '' sinon. */
export function readEnvKey(files: string[], name: string, env: Record<string, string | undefined> = process.env, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): string {
  const direct = env[name];
  if (direct !== undefined && direct.trim() !== '') return direct.trim();
  for (const f of files) {
    let text = '';
    try {
      text = read(f);
    } catch {
      continue;
    }
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || m[1] !== name) continue;
      const v = m[2]!.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
      if (v !== '') return v;
    }
  }
  return '';
}

export interface BotLink {
  chat_id: number | null;
  cockpit_url: string;
  claimed_at: string;
  alertes_max_jour: number;
  /** false : la VM n'envoie plus d'alertes (le bouton du CV reste servi par le PC). */
  alertes: boolean;
}

export function parseBotLink(value: unknown): BotLink {
  const o = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const chat = typeof o.chat_id === 'number' && Number.isFinite(o.chat_id) ? o.chat_id : null;
  const url = typeof o.cockpit_url === 'string' && /^https:\/\/[\w.-]+(:\d+)?\/?$/.test(o.cockpit_url.trim()) ? o.cockpit_url.trim().replace(/\/?$/, '/') : '';
  const cap = typeof o.alertes_max_jour === 'number' && o.alertes_max_jour >= 0 ? Math.floor(o.alertes_max_jour) : DEFAULT_DAILY_CAP;
  return { chat_id: chat, cockpit_url: url, claimed_at: typeof o.claimed_at === 'string' ? o.claimed_at : '', alertes_max_jour: cap, alertes: o.alertes !== false };
}

export function readBotLink(careerDir: string): BotLink {
  const p = join(careerDir, LINK_FILE);
  if (!existsSync(p)) return parseBotLink(null);
  try {
    return parseBotLink(JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')));
  } catch {
    return parseBotLink(null);
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** L'adresse du cockpit au téléphone, depuis `.local/cockpit/remote-<port>.json` (tailscale-phone.ps1). */
export function cockpitUrlFrom(hosts: readonly string[]): string {
  const h = hosts.find((x) => /\.ts\.net(:\d+)?$/i.test(x)) ?? hosts[0] ?? '';
  return h === '' ? '' : `https://${h.replace(/:443$/, '')}/`;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}

/** Un appel de l'API Bot. Le jeton n'apparaît jamais dans une erreur. */
export async function tg<T = unknown>(token: string, method: string, payload: Record<string, unknown> | FormData, fetchFn: Fetch = fetch, timeoutMs = 40_000): Promise<T> {
  const init: RequestInit = payload instanceof FormData ? { method: 'POST', body: payload } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
  init.signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, init);
  } catch (err) {
    throw new TelegramError(`${method} : réseau (${String((err as Error).message ?? err).split(token).join('***')})`, 0);
  }
  let body: { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* réponse illisible : traitée plus bas */
  }
  if (!res.ok || body.ok !== true) throw new TelegramError(`${method} : ${body.description ?? `HTTP ${res.status}`}`.split(token).join('***'), body.error_code ?? res.status, body.parameters?.retry_after ?? 0);
  return body.result as T;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface AlertOffer {
  slug: string;
  title: string;
  company: string;
  link: string;
  source?: string;
  salary?: { min: number | null; max: number | null } | null;
  reasons?: string[];
  notes?: string[];
}

const euros = (n: number): string => `${Math.round(n / 1000)} k€`;

/** Le texte d'une alerte (HTML Telegram) : poste, entreprise, salaire, et ce que le tri a noté. */
export function alertText(o: AlertOffer): string {
  const lines = [`🎯 <b>${escapeHtml(o.title || 'Offre')}</b>`, `🏢 ${escapeHtml(o.company || 'Entreprise non communiquée')}${o.source ? ` · ${escapeHtml(o.source)}` : ''}`];
  const s = o.salary ?? null;
  if (s && (s.min !== null || s.max !== null)) lines.push(`💶 ${s.min !== null && s.max !== null && s.min !== s.max ? `${euros(s.min)} – ${euros(s.max)}` : euros((s.max ?? s.min) as number)} brut/an`);
  const keep = (o.notes ?? []).filter((n) => /^(Cœur du poste|Télétravail|À renforcer|Outils demandés|Expérience demandée)/.test(n)).slice(0, 4);
  for (const n of keep) lines.push(`• ${escapeHtml(n.length > 220 ? `${n.slice(0, 217)}…` : n)}`);
  return lines.join('\n');
}

export const CV_PREFIX = 'cv:';

/** Les boutons d'une alerte : l'offre dans le cockpit, l'annonce, et « CV sur mesure » (si le slug tient dans les 64 octets de Telegram). */
export function alertKeyboard(o: Pick<AlertOffer, 'slug' | 'link'>, cockpitUrl: string): { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] } {
  const row1: { text: string; url?: string; callback_data?: string }[] = [];
  if (cockpitUrl !== '') row1.push({ text: '📋 Ouvrir dans le cockpit', url: `${cockpitUrl}#${encodeURIComponent(o.slug)}` });
  if (/^https?:\/\//.test(o.link)) row1.push({ text: '🔗 Annonce', url: o.link });
  const rows = row1.length > 0 ? [row1] : [];
  const data = `${CV_PREFIX}${o.slug}`;
  if (Buffer.byteLength(data, 'utf8') <= 64) rows.push([{ text: '✍️ CV sur mesure (crédits Claude)', callback_data: data }]);
  return { inline_keyboard: rows };
}

/** La date du jour à Paris (AAAA-MM-JJ), pour le plafond quotidien. */
export function parisDay(d: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
