/**
 * `job_sources.proposed.json` garde la forme que le radar lit (`name`, `type`, `speed`,
 * `endpoint` ou `url_template`, `enabled`) : le jour où Antoine le copie à la place de
 * `job_sources.json`, rien ne casse. Les champs ajoutés (query, filter, terms, verified, note)
 * sont des commentaires que le radar ignore. Aucun appel réseau.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Source {
  key?: string;
  name: string;
  type: string;
  speed: string;
  endpoint?: string;
  url_template?: string;
  enabled: boolean;
  verified?: string;
  terms?: string;
}

const file = JSON.parse(readFileSync(join(import.meta.dir, 'job_sources.proposed.json'), 'utf8')) as { version: string; sources: Source[]; écartées: string[] };
const KNOWN_TYPES = new Set(['api_guest', 'api_json', 'rss_feed', 'api_cloud', 'sitemap', 'html_page', 'api_key']);

describe('job_sources.proposed.json', () => {
  test('chaque source a la forme du fichier de production', () => {
    expect(file.sources.length).toBeGreaterThan(10);
    for (const s of file.sources) {
      expect(typeof s.name).toBe('string');
      expect(KNOWN_TYPES.has(s.type)).toBe(true);
      expect(s.speed).toMatch(/^H\+\d+$/);
      expect(typeof s.enabled).toBe('boolean');
      const url = s.endpoint ?? s.url_template ?? '';
      expect(url.startsWith('https://')).toBe(true);
      if (s.url_template !== undefined) expect(s.url_template).toContain('{keyword}');
      // Une clé est un NOM de variable, jamais une valeur : rien qui ressemble à un secret.
      expect(url).not.toMatch(/(key|token|app_id)=[A-Za-z0-9]{12,}/i);
    }
  });

  test('les types que le radar ne lit pas encore (sitemap, html_page, api_key) sont désactivés', () => {
    for (const s of file.sources) {
      if (s.type === 'sitemap' || s.type === 'html_page' || s.type === 'api_key') expect(s.enabled).toBe(false);
    }
  });

  test('une source nouvelle et activée a été vérifiée par un appel, et dit ses conditions', () => {
    const production = new Set(['LinkedIn Jobs (Live 24h)', 'Himalayas Remote', 'Working Nomads', 'RemoteOK', 'Remotive', 'Arbeitnow Remote', 'Jobspresso Remote', 'Firecrawl Search (Cloud)']);
    for (const s of file.sources) {
      if (!s.enabled || production.has(s.name)) continue;
      expect(s.verified ?? '').toMatch(/^verified by fetch 2026-10-22/);
      expect((s.terms ?? '').length).toBeGreaterThan(10);
    }
  });

  test('Welcome to the Jungle reste désactivé tant que la voie officielle n’est pas ouverte', () => {
    const wttj = file.sources.find((s) => s.name.startsWith('Welcome to the Jungle'));
    expect(wttj?.enabled).toBe(false);
    expect(wttj?.terms).toContain('Welcome Kit');
  });

  test('une source à clé nomme sa variable, sans valeur', () => {
    for (const s of file.sources) {
      if (s.type !== 'api_key') continue;
      expect(s.key ?? '').toMatch(/^[A-Z_]+(, [A-Z_]+)*$/);
    }
  });

  test('les noms sont uniques', () => {
    const names = file.sources.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(file.écartées.length).toBeGreaterThan(5);
  });
});
