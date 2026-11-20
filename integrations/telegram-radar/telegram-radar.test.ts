import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AlertState, STATE_FILE, pickAlerts, runAlerts } from './alert-vm.ts';
import { type BotState, handleUpdate, settlePending } from './pc-bot.ts';
import { alertKeyboard, alertText, cockpitUrlFrom, parseBotLink, readEnvKey, tg } from './telegram.ts';

const TOKEN = '123456:SECRET-token';

describe('jeton et réglages', () => {
  test('le jeton se lit par son nom, env d’abord, guillemets et BOM ôtés', () => {
    const files: Record<string, string> = { a: '﻿OTHER=x\nRADAR_BOT_TOKEN="abc:1"\n', b: 'RADAR_BOT_TOKEN=zzz' };
    expect(readEnvKey(['a', 'b'], 'RADAR_BOT_TOKEN', {}, (p) => files[p]!)).toBe('abc:1');
    expect(readEnvKey(['a'], 'RADAR_BOT_TOKEN', { RADAR_BOT_TOKEN: 'env' }, (p) => files[p]!)).toBe('env');
    expect(readEnvKey(['absent'], 'RADAR_BOT_TOKEN', {}, () => { throw new Error('x'); })).toBe('');
    // TELEGRAM_BOT_TOKEN (le bot de production) n'est jamais pris pour celui du radar.
    expect(readEnvKey(['c'], 'RADAR_BOT_TOKEN', {}, () => 'TELEGRAM_BOT_TOKEN=prod')).toBe('');
  });
  test('radar_bot.json : compte, adresse https seulement, plafond', () => {
    expect(parseBotLink({ chat_id: 42, cockpit_url: 'https://pc.tail1.ts.net' })).toMatchObject({ chat_id: 42, cockpit_url: 'https://pc.tail1.ts.net/', alertes_max_jour: 20, alertes: true });
    expect(parseBotLink({ cockpit_url: 'http://evil/', alertes_max_jour: 5, alertes: false })).toMatchObject({ chat_id: null, cockpit_url: '', alertes_max_jour: 5, alertes: false });
    expect(cockpitUrlFrom(['127.0.0.1:8766', 'pc.tail1.ts.net'])).toBe('https://pc.tail1.ts.net/');
    expect(cockpitUrlFrom([])).toBe('');
  });
  test('une erreur de l’API ne montre jamais le jeton', async () => {
    const fail = async (): Promise<Response> => { throw new Error(`connect https://api.telegram.org/bot${TOKEN}/sendMessage`); };
    const err = await tg(TOKEN, 'sendMessage', {}, fail).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('SECRET');
  });
});

describe('alerte', () => {
  const offer = { slug: 'acme', title: 'Growth <Manager>', company: 'Acme & Co', link: 'https://jobs.example/1', salary: { min: 40000, max: 50000 }, notes: ['Télétravail complet : « remote »', 'Salaire : x', 'Outils demandés (à ton appréciation) : Klaviyo'] };
  test('texte : HTML échappé, salaire, notes utiles seulement', () => {
    const t = alertText(offer);
    expect(t).toContain('Growth &lt;Manager&gt;');
    expect(t).toContain('Acme &amp; Co');
    expect(t).toContain('40 k€ – 50 k€');
    expect(t).toContain('Outils demandés');
    expect(t).not.toContain('Salaire : x');
  });
  test('boutons : cockpit (lien vers l’offre), annonce, CV sur mesure', () => {
    const k = alertKeyboard(offer, 'https://pc.tail1.ts.net/');
    expect(k.inline_keyboard[0]![0]!.url).toBe('https://pc.tail1.ts.net/#acme');
    expect(k.inline_keyboard[0]![1]!.url).toBe('https://jobs.example/1');
    expect(k.inline_keyboard[1]![0]!.callback_data).toBe('cv:acme');
    // Sans adresse du cockpit, pas de bouton cockpit ; un slug trop long pour Telegram : pas de bouton CV.
    expect(alertKeyboard({ slug: 'x'.repeat(70), link: '' }, '').inline_keyboard).toEqual([]);
  });
});

describe('alertes de la VM', () => {
  const rec = (key: string, at: string, decision = 'retenue', link = `https://j/${key}`): Record<string, unknown> => ({ key, slug: key.toLowerCase(), title: `T ${key}`, company: 'C', link, decision, at, notes: [], reasons: [] });
  const state: AlertState = { since: '2026-11-13T10:00:00.000Z', sent: { B: 'x' }, days: {} };
  test('retenues, après le départ, pas déjà envoyées, une par lien, des plus anciennes aux plus récentes', () => {
    const picked = pickAlerts([rec('D', '2026-11-13T12:00:00Z'), rec('A', '2026-11-13T11:00:00Z'), rec('B', '2026-11-13T11:00:00Z'), rec('C', '2026-11-13T09:00:00Z'), rec('E', '2026-11-13T12:00:00Z', 'ecartee'), rec('F', '2026-11-13T13:00:00Z', 'retenue', 'https://j/D')], state);
    expect(picked.map((p) => p.key)).toEqual(['A', 'D']);
  });

  function career(link: unknown, alertState?: unknown, records: Record<string, unknown>[] = []): string {
    const dir = mkdtempSync(join(tmpdir(), 'radar-alerts-'));
    if (link !== undefined) writeFileSync(join(dir, 'radar_bot.json'), JSON.stringify(link));
    if (alertState !== undefined) writeFileSync(join(dir, STATE_FILE), JSON.stringify(alertState));
    mkdirSync(join(dir, 'triage_local'));
    for (const r of records) writeFileSync(join(dir, 'triage_local', `${r.key as string}.json`), JSON.stringify(r));
    return dir;
  }
  const now = new Date('2026-11-13T15:00:00Z');

  test('coupées sans jeton, sans /start ; premier passage : départ marqué, rien envoyé', async () => {
    const calls: string[] = [];
    const f = async (url: string): Promise<Response> => { calls.push(url); return Response.json({ ok: true, result: {} }); };
    expect((await runAlerts({ career: career({ chat_id: 1 }), envFiles: [], env: {}, now, fetchFn: f })).skipped).toContain('RADAR_BOT_TOKEN absent');
    expect((await runAlerts({ career: career({}), envFiles: [], env: { RADAR_BOT_TOKEN: TOKEN }, now, fetchFn: f })).skipped).toContain('pas encore réservé');
    const dir = career({ chat_id: 1 }, undefined, [rec('A', '2026-11-13T11:00:00Z')]);
    expect((await runAlerts({ career: dir, envFiles: [], env: { RADAR_BOT_TOKEN: TOKEN }, now, fetchFn: f })).skipped).toContain('premier passage');
    expect(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')).since).toBe(now.toISOString());
    expect(calls).toEqual([]);
  });

  test('envoi : plafond du jour, le reste marqué « plafond », rien en double au cycle suivant', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = async (_url: string, init?: RequestInit): Promise<Response> => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, result: {} }); };
    const dir = career({ chat_id: 7, cockpit_url: 'https://pc.tail1.ts.net/', alertes_max_jour: 2 }, { since: '2026-11-13T10:00:00Z', sent: {}, days: {} }, [rec('A', '2026-11-13T11:00:00Z'), rec('B', '2026-11-13T11:30:00Z'), rec('C', '2026-11-13T12:00:00Z')]);
    const r = await runAlerts({ career: dir, envFiles: [], env: { RADAR_BOT_TOKEN: TOKEN }, now, fetchFn: f });
    expect(r.sent).toBe(2);
    expect(r.skipped).toContain('1 offre(s) au-delà du plafond');
    expect(bodies.map((b) => b.chat_id)).toEqual([7, 7]);
    const again = await runAlerts({ career: dir, envFiles: [], env: { RADAR_BOT_TOKEN: TOKEN }, now, fetchFn: f });
    expect(again.sent).toBe(0);
    expect(bodies).toHaveLength(2);
  });

  test('Telegram en refus (429) : on s’arrête, l’offre repartira au cycle suivant', async () => {
    const f = async (): Promise<Response> => Response.json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 30 } }, { status: 429 });
    const dir = career({ chat_id: 7 }, { since: '2026-11-13T10:00:00Z', sent: {}, days: {} }, [rec('A', '2026-11-13T11:00:00Z'), rec('B', '2026-11-13T11:30:00Z')]);
    const r = await runAlerts({ career: dir, envFiles: [], env: { RADAR_BOT_TOKEN: TOKEN }, now, fetchFn: f });
    expect(r.sent).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')).sent).toEqual({});
  });
});

describe('bot du PC', () => {
  const fresh = (): BotState => ({ offset: 0, pending: {} });
  const now = new Date('2026-11-13T15:00:00Z');
  const deps = (chatId: number | null, queued: string[] = []) => ({
    chatId,
    canQueue: (slug: string) => (slug === 'ok' ? { ok: true, reason: '', title: 'Growth — Acme' } : { ok: false, reason: 'statut APPLIED', title: slug }),
    queue: (slug: string) => void queued.push(slug),
    now,
  });
  const start = (chat: number, type = 'private') => ({ update_id: 10, message: { text: '/start', chat: { id: chat, type } } });
  const press = (chat: number, data: string) => ({ update_id: 11, callback_query: { id: 'q', data, from: { id: chat }, message: { chat: { id: chat } } } });

  test('/start réserve le bot au premier compte ; un autre compte n’obtient rien ; les groupes sont ignorés', () => {
    const s = fresh();
    const r = handleUpdate(start(5), s, deps(null));
    expect(r.claim).toBe(5);
    expect(s.offset).toBe(11);
    expect(handleUpdate(start(9), s, deps(5)).claim).toBeUndefined();
    expect(handleUpdate(start(9), s, deps(5)).calls[0]!.payload.text).toBe('Bot privé.');
    expect(handleUpdate(start(5, 'group'), s, deps(null)).calls).toEqual([]);
  });

  test('« CV sur mesure » : mis en file une fois, refus expliqué, autre compte refusé', () => {
    const s = fresh();
    const q: string[] = [];
    const r = handleUpdate(press(5, 'cv:ok'), s, deps(5, q));
    expect(q).toEqual(['ok']);
    expect(s.pending.ok).toMatchObject({ chat: 5, run: '', title: 'Growth — Acme' });
    expect(r.calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'sendMessage']);
    expect(handleUpdate(press(5, 'cv:ok'), s, deps(5, q)).calls[0]!.payload.text).toContain('déjà en préparation');
    expect(q).toEqual(['ok']);
    expect(handleUpdate(press(5, 'cv:non'), s, deps(5, q)).calls[0]!.payload.text).toContain('statut APPLIED');
    expect(handleUpdate(press(6, 'cv:ok'), fresh(), deps(5, q)).calls[0]!.payload.text).toBe('Bot privé.');
    expect(handleUpdate(press(5, 'cv:ok'), fresh(), deps(null, q)).calls[0]!.payload.text).toBe('Bot privé.');
  });

  test('fin du run : le PDF part ; sans PDF, la raison ; run encore en cours : on attend', () => {
    const s: BotState = { offset: 0, pending: { a: { chat: 5, at: now.toISOString(), title: 'A', run: 'r1' }, b: { chat: 5, at: now.toISOString(), title: 'B', run: 'r2' }, c: { chat: 5, at: now.toISOString(), title: 'C', run: 'r3' } } };
    const status: Record<string, string> = { r1: 'completed', r2: 'failed', r3: 'running' };
    const calls = settlePending(s, {
      queued: () => false,
      runStatus: (id) => status[id] ?? null,
      cvPdf: (slug) => (slug === 'a' ? '/tmp/CV.pdf' : null),
      summary: () => 'CV rejected: B-',
      isLive: (st) => st === 'running',
      cockpitUrl: 'https://pc.tail1.ts.net/',
      now,
    });
    expect(calls[0]).toMatchObject({ method: 'sendDocument', file: '/tmp/CV.pdf' });
    expect(String(calls[0]!.payload.caption)).toContain('https://pc.tail1.ts.net/#a');
    expect(calls[1]!.method).toBe('sendMessage');
    expect(String(calls[1]!.payload.text)).toContain('CV rejected: B-');
    expect(Object.keys(s.pending)).toEqual(['c']);
  });

  test('jamais lancée : abandonnée au bout de 2 h, prévenue', () => {
    const s: BotState = { offset: 0, pending: { a: { chat: 5, at: '2026-11-13T12:00:00Z', title: 'A', run: '' }, b: { chat: 5, at: '2026-11-13T14:30:00Z', title: 'B', run: '' } } };
    const calls = settlePending(s, { queued: () => false, runStatus: () => null, cvPdf: () => null, summary: () => '', isLive: () => false, cockpitUrl: '', now });
    expect(calls).toHaveLength(1);
    expect(Object.keys(s.pending)).toEqual(['b']);
  });
});
