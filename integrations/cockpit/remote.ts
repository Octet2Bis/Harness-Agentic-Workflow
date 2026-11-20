/**
 * Accès depuis le téléphone : le cockpit n'écoute que 127.0.0.1, et `tailscale serve` (lancé par
 * tailscale-phone.ps1) le republie en HTTPS sur le réseau Tailscale privé, jamais sur Internet.
 * Tailscale ajoute à chaque requête qu'il relaie l'identité de qui l'envoie (`Tailscale-User-Login`,
 * qu'un client ne peut pas forger : serve écrase ces en-têtes) et un `X-Forwarded-For`.
 *
 * Règle, fermée par défaut : une requête est locale seulement si elle vise 127.0.0.1 ou localhost
 * et ne porte aucune trace de relais ; tout le reste doit venir d'un compte listé dans
 * `.local/cockpit/remote-<port>.json` (`allowUsers`). Sans ce fichier, rien ne passe de l'extérieur.
 * Chaque cockpit (Antoine, sa compagne) a son port et son fichier : chacun n'ouvre que le sien.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';

export interface RemoteConfig {
  /** Noms Tailscale du PC (ex. mon-pc.tail1234.ts.net, ou …:8443), ajoutés aux hôtes acceptés (`allowedHosts`). */
  hosts: string[];
  /** Logins Tailscale autorisés (ex. antoine@exemple.fr), comparés sans la casse. */
  allowUsers: string[];
}

export type Access = { ok: true; who: 'local' | string } | { ok: false; status: 403; reason: string };

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function parseRemoteConfig(raw: unknown): RemoteConfig {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()) : []);
  return { hosts: strings(o.hosts), allowUsers: strings(o.allowUsers) };
}

/** Qui a le droit de faire cette requête. `headers.get` suffit (Request.headers ou Headers). */
export function checkAccess(headers: { get(name: string): string | null }, config: RemoteConfig): Access {
  const login = headers.get('tailscale-user-login');
  const relayed = login !== null || headers.get('x-forwarded-for') !== null || headers.get('tailscale-user-name') !== null;
  const host = headers.get('host') ?? '';
  if (!relayed && LOCAL_HOST.test(host)) return { ok: true, who: 'local' };
  if (login === null) return { ok: false, status: 403, reason: 'accès distant sans identité Tailscale : refusé' };
  const wanted = login.trim().toLowerCase();
  if (config.allowUsers.some((u) => u.toLowerCase() === wanted)) return { ok: true, who: login };
  return { ok: false, status: 403, reason: `compte Tailscale ${login} non autorisé sur ce cockpit` };
}

/**
 * Lit le fichier de config, relu seulement quand il change : pas besoin de redémarrer le cockpit.
 * Le chemin peut être une fonction (le port réel n'est connu qu'une fois le serveur lancé, `--port 0`).
 */
export function remoteConfigLoader(pathOf: string | (() => string)): () => RemoteConfig {
  let cache: { mtime: number; config: RemoteConfig } | null = null;
  const empty: RemoteConfig = { hosts: [], allowUsers: [] };
  return () => {
    const path = typeof pathOf === 'string' ? pathOf : pathOf();
    if (!existsSync(path)) return empty;
    const mtime = statSync(path).mtimeMs;
    if (cache && cache.mtime === mtime) return cache.config;
    try {
      // Les .json écrits par PowerShell 5 commencent par un BOM.
      const config = parseRemoteConfig(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
      cache = { mtime, config };
      return config;
    } catch {
      return empty;
    }
  };
}
