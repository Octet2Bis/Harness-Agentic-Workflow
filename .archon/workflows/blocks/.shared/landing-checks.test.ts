import { describe, expect, test } from 'bun:test';
import { checkLanding } from './landing-checks.ts';

const page = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Audit tracking GTM en 48 h</title>
<meta name="description" content="Un audit de votre plan de taggage GTM, livré en 48 heures, avec les écarts chiffrés.">
<style>:root{--color-bg:#111;--space-2:8px}body{background:var(--color-bg)}</style>
<script>window.dataLayer = window.dataLayer || [];</script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script>
</head><body>
<h1>Votre tracking GTM, audité en 48 h</h1>
<a href="#form" data-cta="primary" onclick="window.dataLayer.push({event:'click_cta',cta:'hero'})">Demander l'audit</a>
<form id="form"><input name="email"><button type="submit">Envoyer</button></form>
</body></html>`;

describe('landing checks', () => {
  test('accepte une page autonome conforme', () => {
    expect(checkLanding(page)).toEqual({ ok: true, problems: [] });
  });
  test('nomme les manques : dataLayer, click_cta, CTA unique, blur, script externe, H1', () => {
    const bad = page
      .replace('window.dataLayer = window.dataLayer || [];', '')
      .replace("window.dataLayer.push({event:'click_cta',cta:'hero'})", '')
      .replace('<form id="form">', '<a data-cta="primary" href="#">bis</a><form id="form">')
      .replace('body{background:var(--color-bg)}', 'body{backdrop-filter:blur(8px)}')
      .replace('</head>', '<script src="https://cdn.example.com/x.js"></script></head>')
      .replace('<h1>', '<h2>').replace('</h1>', '</h2>');
    const result = checkLanding(bad);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('DataLayer container missing: window.dataLayer = window.dataLayer || []');
    expect(result.problems).toContain('no click_cta event pushed to the dataLayer');
    expect(result.problems).toContain('exactly one primary CTA (data-cta="primary") expected (got 2)');
    expect(result.problems.some((p) => p.startsWith('decorative blur'))).toBe(true);
    expect(result.problems).toContain('external resource not allowed: <script src="https://cdn.example.com/x.js"> (the page must be self-contained; only GTM may load)');
    expect(result.problems).toContain('exactly one <h1> expected (got 0)');
  });
  test('borne la taille et refuse les marqueurs de brouillon', () => {
    const draft = 'draft marker found (lorem ipsum, {{…}}, TODO or TBD)';
    expect(checkLanding(page.replace('</body>', `<p>${'lorem ipsum '.repeat(2)}</p></body>`)).problems).toContain(draft);
    expect(checkLanding(page.replace('</body>', '<p>TODO: chiffres</p></body>')).problems).toContain(draft);
    expect(checkLanding(page, { maxChars: 100, allowedScriptHosts: ['www.googletagmanager.com'] }).problems.some((p) => p.includes('at most 100'))).toBe(true);
    expect(checkLanding(page.replace('</body>', `<p>${'x'.repeat(60_001)}</p></body>`)).problems.some((p) => p.includes('at most 60000'))).toBe(true);
  });
  test('un mot qui contient « todo » n\'est pas un marqueur de brouillon', () => {
    expect(checkLanding(page.replace('</body>', '<p>Suivez-nous sur Mastodon et Todoist.</p></body>'))).toEqual({ ok: true, problems: [] });
  });
  test('autonome : aucun http://, aucune ressource externe hors GTM (règle v0)', () => {
    const external = (extra: string) => checkLanding(page.replace('</body>', `${extra}</body>`)).problems.filter((p) => p.startsWith('external resource'));
    expect(external('<img src="https://cdn.example.com/x.png" alt="">')).toHaveLength(1);
    expect(external('<iframe src="//www.youtube.com/embed/x"></iframe>')).toHaveLength(1);
    expect(external('<img srcset="https://cdn.example.com/x.png 2x" alt="">')).toHaveLength(1);
    expect(external('<style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style>')).toHaveLength(2);
    expect(external('<style>.hero{background:url(https://cdn.example.com/bg.jpg)}</style>')).toHaveLength(1);
    expect(external('<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">')).toHaveLength(1);
    expect(external('<link rel="preload" href="https://cdn.example.com/f.woff2" as="font">')).toHaveLength(1);
    expect(external('<script src="https://cdn.example.com/x.js"></script>')).toHaveLength(1);
    expect(checkLanding(page.replace('</body>', '<img src="http://evil.example/x.png" alt=""></body>')).problems).toContain('unencrypted http:// URL found: use https:// (v0 rule « autonome »)');
  });
  test('les liens de navigation et les images inline restent permis', () => {
    const ok = page.replace('</body>', '<a href="https://example.com/cgv">CGV</a><link rel="canonical" href="https://example.com/"><img src="data:image/png;base64,AAAA" alt=""><img src="hero.png" alt=""></body>');
    expect(checkLanding(ok)).toEqual({ ok: true, problems: [] });
  });
});
