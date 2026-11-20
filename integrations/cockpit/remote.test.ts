import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAccess, parseRemoteConfig, remoteConfigLoader } from './remote.ts';

const h = (o: Record<string, string>) => new Headers(o);
const config = { hosts: ['mon-pc.tail1234.ts.net'], allowUsers: ['Antoine@Exemple.fr'] };

describe('checkAccess', () => {
  test('la page ouverte sur le PC passe', () => {
    expect(checkAccess(h({ host: '127.0.0.1:8766' }), config)).toEqual({ ok: true, who: 'local' });
    expect(checkAccess(h({ host: 'localhost:8766' }), { hosts: [], allowUsers: [] })).toEqual({ ok: true, who: 'local' });
  });
  test('le compte autorisé passe par Tailscale, sans la casse', () => {
    expect(checkAccess(h({ host: '127.0.0.1:8766', 'tailscale-user-login': 'antoine@exemple.fr', 'x-forwarded-for': '100.64.0.2' }), config)).toEqual({ ok: true, who: 'antoine@exemple.fr' });
  });
  test('un autre compte du réseau est refusé (le cockpit de la compagne et inversement)', () => {
    const r = checkAccess(h({ host: 'mon-pc.tail1234.ts.net', 'tailscale-user-login': 'elle@exemple.fr' }), config);
    expect(r.ok).toBe(false);
  });
  test('relayé sans identité (appareil étiqueté, autre proxy) : refusé même avec un hôte local', () => {
    expect(checkAccess(h({ host: '127.0.0.1:8766', 'x-forwarded-for': '100.64.0.9' }), config).ok).toBe(false);
    expect(checkAccess(h({ host: 'mon-pc.tail1234.ts.net' }), config).ok).toBe(false);
  });
  test('sans fichier de config, rien ne passe de l’extérieur', () => {
    expect(checkAccess(h({ host: '127.0.0.1:8766', 'tailscale-user-login': 'antoine@exemple.fr' }), { hosts: [], allowUsers: [] }).ok).toBe(false);
  });
  test('un hôte du réseau local (0.0.0.0, 192.168…) n’est pas local', () => {
    expect(checkAccess(h({ host: '192.168.1.20:8766' }), config).ok).toBe(false);
  });
});

describe('config', () => {
  test('lecture tolérante', () => {
    expect(parseRemoteConfig({ hosts: ['a.ts.net', 3, ''], allowUsers: 'x' })).toEqual({ hosts: ['a.ts.net'], allowUsers: [] });
  });
  test('fichier absent, avec BOM, puis modifié', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-'));
    const p = join(dir, 'remote-8766.json');
    const load = remoteConfigLoader(p);
    expect(load()).toEqual({ hosts: [], allowUsers: [] });
    writeFileSync(p, '\uFEFF{"hosts":["a.ts.net"],"allowUsers":["x@y"]}');
    expect(load().allowUsers).toEqual(['x@y']);
    writeFileSync(p, 'pas du json');
    expect(load()).toEqual({ hosts: [], allowUsers: [] });
  });
});
