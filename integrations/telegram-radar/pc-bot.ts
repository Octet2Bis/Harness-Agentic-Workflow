/**
 * La moitié PC du bot du radar (cockpit) : écoute `getUpdates`, réserve le bot au premier
 * `/start` (compte privé), et sert le bouton « CV sur mesure » d'une alerte : career-apply en
 * mode `cv-only` (CV vérifié + PDF, rien n'est envoyé), puis le PDF repart dans Telegram.
 *
 * Pur autant que possible : `handleUpdate` et `settlePending` rendent les appels à faire, le
 * cockpit les exécute (`tg`). Un autre compte que celui réservé n'obtient rien.
 */

import { CV_PREFIX, escapeHtml } from './telegram.ts';

export interface PendingCv {
  chat: number;
  at: string;
  title: string;
  /** Le run career-apply lancé pour cette demande (posé par le cockpit au lancement). */
  run: string;
}

export interface BotState {
  offset: number;
  pending: Record<string, PendingCv>;
}

export function parseBotState(value: unknown): BotState {
  const o = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const pending: Record<string, PendingCv> = {};
  const p = o.pending !== null && typeof o.pending === 'object' && !Array.isArray(o.pending) ? (o.pending as Record<string, unknown>) : {};
  for (const [slug, v] of Object.entries(p)) {
    const x = v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    if (typeof x.chat === 'number' && typeof x.at === 'string') pending[slug] = { chat: x.chat, at: x.at, title: typeof x.title === 'string' ? x.title : slug, run: typeof x.run === 'string' ? x.run : '' };
  }
  return { offset: typeof o.offset === 'number' ? o.offset : 0, pending };
}

export interface Call {
  method: string;
  payload: Record<string, unknown>;
  /** sendDocument : le fichier à joindre (chemin local). */
  file?: string;
}

export interface UpdateDeps {
  /** Le compte réservé, null tant que personne n'a envoyé /start. */
  chatId: number | null;
  /** L'offre peut-elle partir en CV seul ? `title` pour les messages. */
  canQueue: (slug: string) => { ok: boolean; reason: string; title: string };
  queue: (slug: string) => void;
  now: Date;
}

export interface UpdateResult {
  calls: Call[];
  /** Un /start vient de réserver le bot à ce compte. */
  claim?: number;
}

/** Une mise à jour Telegram → ce qu'il faut répondre (et mettre en file). `state.pending` est modifié. */
export function handleUpdate(u: unknown, state: BotState, d: UpdateDeps): UpdateResult {
  const upd = u !== null && typeof u === 'object' ? (u as Record<string, any>) : {};
  if (typeof upd.update_id === 'number') state.offset = Math.max(state.offset, upd.update_id + 1);
  const msg = upd.message;
  if (msg && typeof msg.text === 'string' && msg.chat && typeof msg.chat.id === 'number') {
    const chat = msg.chat.id as number;
    if (msg.chat.type !== 'private') return { calls: [] };
    if (/^\/start\b/.test(msg.text.trim())) {
      if (d.chatId === null) return { claim: chat, calls: [{ method: 'sendMessage', payload: { chat_id: chat, text: "✅ Bot du radar réservé à ce compte. Tu recevras ici les offres retenues ; le bouton « CV sur mesure » prépare un CV adapté (rien n'est envoyé à l'employeur)." } }] };
      if (d.chatId === chat) return { calls: [{ method: 'sendMessage', payload: { chat_id: chat, text: '👋 Toujours là. Les alertes arrivent ici.' } }] };
      return { calls: [{ method: 'sendMessage', payload: { chat_id: chat, text: 'Bot privé.' } }] };
    }
    return { calls: [] };
  }
  const cb = upd.callback_query;
  if (cb && typeof cb.id === 'string') {
    const chat = typeof cb.message?.chat?.id === 'number' ? (cb.message.chat.id as number) : typeof cb.from?.id === 'number' ? (cb.from.id as number) : null;
    const answer = (text: string): Call => ({ method: 'answerCallbackQuery', payload: { callback_query_id: cb.id, text, show_alert: false } });
    if (chat === null || d.chatId === null || chat !== d.chatId) return { calls: [answer('Bot privé.')] };
    const data = typeof cb.data === 'string' ? cb.data : '';
    if (!data.startsWith(CV_PREFIX)) return { calls: [answer('Bouton inconnu.')] };
    const slug = data.slice(CV_PREFIX.length);
    if (state.pending[slug]) return { calls: [answer('CV déjà en préparation pour cette offre.')] };
    const ok = d.canQueue(slug);
    if (!ok.ok) return { calls: [answer(`Impossible : ${ok.reason}`.slice(0, 190))] };
    d.queue(slug);
    state.pending[slug] = { chat, at: d.now.toISOString(), title: ok.title, run: '' };
    return {
      calls: [
        answer('CV sur mesure demandé.'),
        { method: 'sendMessage', payload: { chat_id: chat, parse_mode: 'HTML', text: `⏳ CV sur mesure lancé pour <b>${escapeHtml(ok.title)}</b>. Compte une dizaine de minutes ; le PDF arrive ici. Rien n'est envoyé à l'employeur.` } },
      ],
    };
  }
  return { calls: [] };
}

export interface SettleDeps {
  /** L'offre est-elle encore en file d'attente du cockpit ? */
  queued: (slug: string) => boolean;
  /** Le run de la demande : son statut Archon (null : pas encore vu). */
  runStatus: (runId: string) => string | null;
  /** Le CV en PDF produit par ce run (chemin local), null s'il n'y en a pas. */
  cvPdf: (slug: string, runId: string) => string | null;
  /** Ce que le tableau dit de l'offre (statut + résumé du dernier passage), pour un échec. */
  summary: (slug: string) => string;
  isLive: (status: string) => boolean;
  cockpitUrl: string;
  now: Date;
}

/** Les demandes terminées → le PDF (ou la raison de l'échec) ; retirées de `state.pending`. */
export function settlePending(state: BotState, d: SettleDeps): Call[] {
  const calls: Call[] = [];
  for (const [slug, p] of Object.entries(state.pending)) {
    const age = d.now.getTime() - Date.parse(p.at);
    if (p.run === '') {
      // Jamais lancé (refus au lancement, cockpit relancé entre-temps) : abandon au bout de 2 h.
      if (!d.queued(slug) && age > 2 * 3_600_000) {
        calls.push({ method: 'sendMessage', payload: { chat_id: p.chat, text: `⚠️ CV sur mesure pour « ${p.title} » pas lancé (le cockpit l'a perdu). Relance-le depuis le cockpit.` } });
        delete state.pending[slug];
      }
      continue;
    }
    const status = d.runStatus(p.run);
    if (status === null || d.isLive(status)) continue;
    const pdf = d.cvPdf(slug, p.run);
    const open = d.cockpitUrl !== '' ? `\n${d.cockpitUrl}#${encodeURIComponent(slug)}` : '';
    if (pdf !== null) calls.push({ method: 'sendDocument', payload: { chat_id: p.chat, caption: `✍️ CV sur mesure — ${p.title}. Vérifié, rien n'a été envoyé.${open}`.slice(0, 1000) }, file: pdf });
    else calls.push({ method: 'sendMessage', payload: { chat_id: p.chat, text: `⚠️ Pas de CV pour « ${p.title} » (run ${status}). ${d.summary(slug)}`.slice(0, 3500) + open } });
    delete state.pending[slug];
  }
  return calls;
}
