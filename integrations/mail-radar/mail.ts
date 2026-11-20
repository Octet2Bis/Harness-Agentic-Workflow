/**
 * Les alertes mail d'un candidat du radar (2026-11-20, Camille) : choix des offres à envoyer,
 * mise en forme du mail récapitulatif (texte + HTML) et envoi gratuit, sans Claude.
 *
 * Trois transports, choisis par les clés présentes (lues par NOM dans les fichiers d'env, jamais
 * affichées) :
 *   - SMTP (Gmail et son « mot de passe d'application », ou tout autre serveur) :
 *     MAIL_SMTP_USER, MAIL_SMTP_PASS, et au choix MAIL_SMTP_HOST (smtp.gmail.com),
 *     MAIL_SMTP_PORT (465 : TLS direct ; 587 : STARTTLS), MAIL_FROM (l'utilisateur SMTP) ;
 *   - Brevo (300 mails / jour gratuits, une adresse d'envoi vérifiée suffit) : BREVO_API_KEY, MAIL_FROM ;
 *   - Resend (gratuit, mais l'adresse d'envoi doit être sur un domaine vérifié) : RESEND_API_KEY, MAIL_FROM.
 * Ordre : SMTP, puis Brevo, puis Resend ; `transport` dans alertes_mail.json l'impose.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export const CONFIG_FILE = 'alertes_mail.json';
export const STATE_FILE = 'mail_alerts.json';

export interface MailConfig {
  to: string;
  nom: string;
  heures: number[];
  max_par_mail: number;
  priorite_lieux: string[];
  exclure_titre: string[];
  transport: 'auto' | 'smtp' | 'brevo' | 'resend';
  from_name: string;
  actif: boolean;
}

const DEFAULTS: MailConfig = {
  to: '',
  nom: '',
  heures: [8, 18],
  max_par_mail: 80,
  priorite_lieux: [],
  exclure_titre: [],
  transport: 'auto',
  from_name: 'Radar emploi',
  actif: true,
};

export function parseConfig(raw: string): MailConfig {
  const o = JSON.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  const c: MailConfig = { ...DEFAULTS };
  if (typeof o.to === 'string') c.to = o.to.trim();
  if (typeof o.nom === 'string') c.nom = o.nom.trim();
  if (Array.isArray(o.heures)) c.heures = o.heures.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b);
  if (typeof o.max_par_mail === 'number' && o.max_par_mail > 0) c.max_par_mail = Math.floor(o.max_par_mail);
  c.priorite_lieux = strs(o.priorite_lieux).map(fold);
  c.exclure_titre = strs(o.exclure_titre).map(fold);
  if (o.transport === 'smtp' || o.transport === 'brevo' || o.transport === 'resend') c.transport = o.transport;
  if (typeof o.from_name === 'string' && o.from_name.trim()) c.from_name = o.from_name.trim();
  if (o.actif === false) c.actif = false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.to)) throw new Error(`${CONFIG_FILE} : adresse « to » invalide`);
  if (c.heures.length === 0) throw new Error(`${CONFIG_FILE} : « heures » vide`);
  return c;
}

export interface MailState {
  sent: Record<string, string>;
  last_slot: string;
  last_sent_at: string;
  last_error: string;
}

export function parseState(raw: string | null): MailState {
  const s: MailState = { sent: {}, last_slot: '', last_sent_at: '', last_error: '' };
  if (raw === null) return s;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.sent && typeof o.sent === 'object' && !Array.isArray(o.sent)) for (const [k, v] of Object.entries(o.sent)) if (typeof v === 'string') s.sent[k] = v;
    if (typeof o.last_slot === 'string') s.last_slot = o.last_slot;
    if (typeof o.last_sent_at === 'string') s.last_sent_at = o.last_sent_at;
    if (typeof o.last_error === 'string') s.last_error = o.last_error;
  } catch {
    // état illisible : on repart de zéro (au pire, un mail en double)
  }
  return s;
}

export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Heure et jour de Paris (`AAAA-MM-JJ`, 0-23). */
export function parisClock(d: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** Le créneau d'envoi en cours (`AAAA-MM-JJTHH`), ou '' avant le premier créneau du jour. */
export function currentSlot(now: Date, heures: number[]): string {
  const { day, hour } = parisClock(now);
  const passed = heures.filter((h) => h <= hour);
  if (passed.length === 0) return '';
  return `${day}T${String(passed[passed.length - 1]).padStart(2, '0')}`;
}

export interface Offer {
  key: string;
  title: string;
  company: string;
  location: string;
  link: string;
  source: string;
  published: string;
  found: string;
  snippet: string;
  zone: 'idf' | 'france' | 'etranger' | 'inconnu';
}

const FR_HINTS = ['france', 'auvergne', 'bretagne', 'normandie', 'occitanie', 'provence', 'grand est', 'hauts-de-france', 'nouvelle-aquitaine', 'pays de la loire', 'bourgogne', 'centre-val', 'corse', 'lyon', 'marseille', 'lille', 'toulouse', 'bordeaux', 'nantes', 'nice', 'strasbourg', 'montpellier', 'rennes'];

export function zoneOf(location: string, link: string, priority: string[]): Offer['zone'] {
  const l = fold(location);
  if (l.trim() !== '' && priority.some((p) => p !== '' && new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(l))) return 'idf';
  if (FR_HINTS.some((h) => l.includes(h)) || /adzuna\.fr\b|\/\/fr\.linkedin\.com/.test(link)) return 'france';
  if (l.trim() === '') return 'inconnu';
  return 'etranger';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Les offres du tableau pas encore envoyées, hors titres exclus ; Paris d'abord, puis le reste de la France, puis l'étranger, les plus récentes d'abord. */
export function pickOffers(board: unknown[], state: MailState, cfg: MailConfig, minFound = ''): Offer[] {
  const out: Offer[] = [];
  for (const r of board) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const link = str(o.link).trim();
    const key = link !== '' ? link : str(o.id);
    if (key === '' || state.sent[key] !== undefined) continue;
    const title = str(o.title).trim();
    const ft = fold(title);
    if (title === '' || cfg.exclure_titre.some((x) => ft.includes(x))) continue;
    const location = str(o.location).trim();
    const radar = o.radar && typeof o.radar === 'object' ? (o.radar as Record<string, unknown>) : {};
    // Trouvée avant la fenêtre gardée dans `sent` : déjà envoyée (ou trop vieille), jamais renvoyée.
    if (minFound !== '' && str(radar.at) !== '' && str(radar.at) < minFound) continue;
    out.push({
      key,
      title,
      company: str(o.company).trim(),
      location,
      link,
      source: str(o.source).trim(),
      published: str(o.date_published).trim(),
      found: str(radar.at),
      snippet: str(o.description).replace(/\s+/g, ' ').trim().slice(0, 220),
      zone: zoneOf(location, link, cfg.priorite_lieux),
    });
  }
  const rank = { idf: 0, france: 1, inconnu: 2, etranger: 3 } as const;
  out.sort((a, b) => rank[a.zone] - rank[b.zone] || (b.found || b.published).localeCompare(a.found || a.published));
  return out;
}

export const ZONE_LABEL: Record<Offer['zone'], string> = {
  idf: 'Paris et Île-de-France',
  france: 'Reste de la France',
  inconnu: 'Lieu non précisé',
  etranger: 'À l\'étranger (vérifier que c\'est un CDD ou une mission)',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

export function buildMail(offers: Offer[], cfg: MailConfig, now: Date): Mail {
  const idf = offers.filter((o) => o.zone === 'idf').length;
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const subject = `${offers.length} nouvelle${offers.length > 1 ? 's' : ''} offre${offers.length > 1 ? 's' : ''}${idf > 0 ? ` (${idf} à Paris / IDF)` : ''} · ${day}`;
  const zones = (['idf', 'france', 'inconnu', 'etranger'] as const).map((z) => ({ z, list: offers.filter((o) => o.zone === z) })).filter((g) => g.list.length > 0);
  const meta = (o: Offer): string => [o.company, o.location, o.published ? `publiée ${o.published}` : '', o.source].filter(Boolean).join(' · ');
  const hello = cfg.nom ? `Bonjour ${cfg.nom},` : 'Bonjour,';
  const text = [
    hello,
    '',
    `${offers.length} nouvelle(s) offre(s) trouvée(s) par le radar.`,
    ...zones.flatMap((g) => ['', `== ${ZONE_LABEL[g.z]} (${g.list.length})`, ...g.list.flatMap((o) => ['', `- ${o.title}`, `  ${meta(o)}`, `  ${o.link}`])]),
    '',
    '-- Envoyé automatiquement par le radar (aucune réponse attendue).',
  ].join('\n');
  const item = (o: Offer): string =>
    `<tr><td style="padding:12px 0;border-bottom:1px solid #e6dfd3">` +
    `<a href="${esc(o.link)}" style="font-size:16px;font-weight:600;color:#7a2f42;text-decoration:none">${esc(o.title)}</a>` +
    `<div style="font-size:13px;color:#5b5348;margin-top:3px">${esc(meta(o))}</div>` +
    (o.snippet ? `<div style="font-size:13px;color:#7a7266;margin-top:5px">${esc(o.snippet)}…</div>` : '') +
    `</td></tr>`;
  const html =
    `<!doctype html><html><body style="margin:0;background:#f7f3ec;font-family:Helvetica,Arial,sans-serif;color:#2b2620">` +
    `<div style="max-width:640px;margin:0 auto;padding:24px 16px">` +
    `<p style="font-size:15px">${esc(hello)}</p>` +
    `<p style="font-size:15px">${offers.length} nouvelle(s) offre(s) trouvée(s) par le radar.</p>` +
    zones.map((g) => `<h2 style="font-size:15px;margin:26px 0 4px;color:#2b2620;text-transform:uppercase;letter-spacing:.04em">${esc(ZONE_LABEL[g.z])} · ${g.list.length}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${g.list.map(item).join('')}</table>`).join('') +
    `<p style="font-size:12px;color:#8a8276;margin-top:28px">Envoyé automatiquement par le radar. Aucune réponse attendue.</p>` +
    `</div></body></html>`;
  return { subject, text, html };
}

// ── Envoi ────────────────────────────────────────────────────────────────

export type Env = Record<string, string>;

/** Les fichiers d'env (KEY=VALUE), lus par nom ; process.env en dernier recours. Rien n'est affiché. */
export function readEnv(files: string[], base: Record<string, string | undefined> = process.env): Env {
  const env: Env = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && /^(MAIL_|BREVO_|RESEND_)/.test(k)) env[k] = v;
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || !/^(MAIL_|BREVO_|RESEND_)/.test(m[1]!)) continue;
      env[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return env;
}

export function chooseTransport(env: Env, wanted: MailConfig['transport']): 'smtp' | 'brevo' | 'resend' | null {
  const has = { smtp: Boolean(env.MAIL_SMTP_USER && env.MAIL_SMTP_PASS), brevo: Boolean(env.BREVO_API_KEY), resend: Boolean(env.RESEND_API_KEY) };
  if (wanted !== 'auto') return has[wanted] ? wanted : null;
  return has.smtp ? 'smtp' : has.brevo ? 'brevo' : has.resend ? 'resend' : null;
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s: string): string => s.replace(/.{1,76}/g, '$&\r\n');
const encodeHeader = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export function mimeMessage(from: string, fromName: string, to: string, mail: Mail, now: Date): string {
  const boundary = `radar-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const domain = from.split('@')[1] ?? 'radar.local';
  return [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${boundary}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(mail.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

type Sock = Socket | TLSSocket;

/** Un client SMTP minimal : TLS direct (465), STARTTLS (587) ou en clair (`MAIL_SMTP_TLS=none`, tests seulement). */
export async function smtpSend(env: Env, to: string, message: string, timeoutMs = 30_000): Promise<void> {
  const host = env.MAIL_SMTP_HOST || 'smtp.gmail.com';
  const port = Number(env.MAIL_SMTP_PORT || 465);
  const mode = env.MAIL_SMTP_TLS === 'none' ? 'none' : port === 465 ? 'tls' : 'starttls';
  const user = env.MAIL_SMTP_USER ?? '';
  // Un mot de passe d'application Google se copie en quatre groupes (« abcd efgh ijkl mnop ») : sans les espaces.
  const rawPass = env.MAIL_SMTP_PASS ?? '';
  const pass = /^[a-z]{4}( [a-z]{4}){3}$/.test(rawPass) ? rawPass.replace(/ /g, '') : rawPass;
  const from = env.MAIL_FROM || user;
  let sock: Sock = await new Promise<Sock>((ok, ko) => {
    const s: Sock = mode === 'tls' ? tlsConnect({ host, port, servername: host }, () => ok(s)) : netConnect({ host, port }, () => ok(s));
    s.once('error', ko);
  });
  let buf = '';
  let waiting: ((line: string) => void) | null = null;
  const replies: string[] = [];
  const onData = (d: Buffer): void => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      // Fin de réponse : « 250 texte » (la ligne « 250-texte » continue).
      if (/^\d{3}(?: |$)/.test(line)) {
        if (waiting) {
          const w = waiting;
          waiting = null;
          w(line);
        } else replies.push(line);
      }
    }
  };
  const attach = (s: Sock): void => {
    s.on('data', onData);
  };
  attach(sock);
  const timer = setTimeout(() => sock.destroy(new Error('SMTP : délai dépassé')), timeoutMs);
  const read = (): Promise<string> =>
    new Promise((ok, ko) => {
      const r = replies.shift();
      if (r !== undefined) return ok(r);
      waiting = ok;
      sock.once('error', ko);
      sock.once('close', () => ko(new Error('SMTP : connexion fermée')));
    });
  const expect = async (code: string, what: string): Promise<void> => {
    const line = await read();
    if (!line.startsWith(code)) throw new Error(`SMTP ${what} : ${line.slice(0, 160)}`);
  };
  const cmd = async (line: string, code: string, what: string): Promise<void> => {
    sock.write(`${line}\r\n`);
    await expect(code, what);
  };
  try {
    await expect('220', 'accueil');
    await cmd('EHLO radar.local', '250', 'EHLO');
    if (mode === 'starttls') {
      await cmd('STARTTLS', '220', 'STARTTLS');
      sock.removeListener('data', onData);
      sock = await new Promise<Sock>((ok, ko) => {
        const t = tlsConnect({ socket: sock as Socket, servername: host }, () => ok(t));
        t.once('error', ko);
      });
      attach(sock);
      await cmd('EHLO radar.local', '250', 'EHLO (TLS)');
    }
    if (user !== '') {
      await cmd('AUTH LOGIN', '334', 'AUTH');
      await cmd(b64(user), '334', 'AUTH (utilisateur)');
      await cmd(b64(pass), '235', 'AUTH (mot de passe refusé ?)');
    }
    await cmd(`MAIL FROM:<${from}>`, '250', 'MAIL FROM');
    await cmd(`RCPT TO:<${to}>`, '250', 'RCPT TO');
    await cmd('DATA', '354', 'DATA');
    const body = message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    await cmd(`${body}\r\n.`, '250', 'envoi');
    sock.write('QUIT\r\n');
  } finally {
    clearTimeout(timer);
    sock.end();
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function apiSend(kind: 'brevo' | 'resend', env: Env, to: string, fromName: string, mail: Mail, fetchFn: Fetch = fetch): Promise<void> {
  const from = env.MAIL_FROM ?? '';
  if (from === '') throw new Error(`${kind} : MAIL_FROM manquant (l'adresse d'envoi vérifiée)`);
  const res =
    kind === 'brevo'
      ? await fetchFn('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY ?? '', 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { email: from, name: fromName }, to: [{ email: to }], subject: mail.subject, htmlContent: mail.html, textContent: mail.text }),
        })
      : await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${env.RESEND_API_KEY ?? ''}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
        });
  if (!res.ok) throw new Error(`${kind} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
