/**
 * Contrôles déterministes d'une landing page (pôle 03 Expérimentation & CRO de Master Plan) :
 * un seul fichier HTML autonome, DataLayer et événement `click_cta` présents (règle du pôle),
 * un seul CTA primaire, tokens CSS, pas de flou décoratif (règle anti-slop visuel), méta de
 * base, un H1, pas de lorem ipsum, taille bornée. Purs, testés.
 *
 * Les trois contrôles du bloc `design` du harness v0 y sont : `html` (doctype), `autonome`
 * (aucun `http://` ; ici, en plus, aucune ressource externe chargée hors GTM : script, style,
 * image, cadre, média, police, `@import`, `url(…)`), `poids` (60 000 caractères au plus,
 * « une page lisible par un agent »). Les liens de navigation (`<a href>`, `<form action>`,
 * `<link rel=canonical|alternate>`) ne chargent rien et restent permis.
 */

export interface LandingRules {
  maxChars: number;
  allowedScriptHosts: string[];
}

export const DEFAULT_LANDING_RULES: LandingRules = { maxChars: 60_000, allowedScriptHosts: ['www.googletagmanager.com', 'googletagmanager.com'] };

const EXTERNAL = /^\s*(https?:)?\/\//i;

function hostOf(url: string): string {
  try {
    return new URL(url.trim(), 'https://local.invalid').host;
  } catch {
    return '';
  }
}

/** Les ressources externes que la page chargerait (hors scripts GTM permis). */
export function externalResources(html: string, rules: LandingRules = DEFAULT_LANDING_RULES): string[] {
  const found: string[] = [];
  for (const tag of html.matchAll(/<(script|img|iframe|source|video|audio|embed|track|input)\b[^>]*>/gi)) {
    for (const attr of tag[0].matchAll(/\s(src|poster)\s*=\s*["']?([^"'\s>]+)/gi)) {
      const url = attr[2]!;
      if (!EXTERNAL.test(url)) continue;
      if (tag[1]!.toLowerCase() === 'script' && rules.allowedScriptHosts.includes(hostOf(url))) continue;
      found.push(`<${tag[1]!.toLowerCase()} ${attr[1]!.toLowerCase()}="${url}">`);
    }
    for (const attr of tag[0].matchAll(/\ssrcset\s*=\s*["']([^"']+)["']/gi)) {
      for (const candidate of attr[1]!.split(',').map((c) => c.trim().split(/\s+/)[0] ?? '')) {
        if (EXTERNAL.test(candidate)) found.push(`<${tag[1]!.toLowerCase()} srcset="${candidate}">`);
      }
    }
  }
  for (const tag of html.matchAll(/<object\b[^>]*>/gi)) {
    const data = /\sdata\s*=\s*["']?([^"'\s>]+)/i.exec(tag[0])?.[1];
    if (data && EXTERNAL.test(data)) found.push(`<object data="${data}">`);
  }
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*["']?([^"'\s>]+)/i.exec(tag[0])?.[1];
    const rel = (/\srel\s*=\s*["']?([^"'>]+)/i.exec(tag[0])?.[1] ?? '').toLowerCase().trim();
    if (href && EXTERNAL.test(href) && !/^(canonical|alternate)$/.test(rel)) found.push(`<link rel="${rel}" href="${href}">`);
  }
  for (const m of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) {
    if (EXTERNAL.test(m[1]!)) found.push(`@import ${m[1]}`);
  }
  for (const m of html.matchAll(/url\(\s*["']?([^"')\s]+)/gi)) {
    if (EXTERNAL.test(m[1]!)) found.push(`url(${m[1]})`);
  }
  return [...new Set(found)];
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

export function checkLanding(html: string | null, rules: LandingRules = DEFAULT_LANDING_RULES): { ok: boolean; problems: string[] } {
  if (html === null || html.trim() === '') return { ok: false, problems: ['index.html is missing or empty'] };
  const problems: string[] = [];
  if (!/^\s*<!doctype html>/i.test(html)) problems.push('file must start with <!doctype html>');
  if (!/<html[^>]*\blang=/i.test(html)) problems.push('<html> needs a lang attribute');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) problems.push('missing <meta name="viewport">');
  if (!/<title>\s*\S[^<]*<\/title>/i.test(html)) problems.push('missing <title>');
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html)) problems.push('missing <meta name="description"> (20+ chars)');
  const h1 = count(html, /<h1[\s>]/gi);
  if (h1 !== 1) problems.push(`exactly one <h1> expected (got ${h1})`);
  if (!/window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\]/i.test(html)) problems.push('DataLayer container missing: window.dataLayer = window.dataLayer || []');
  if (!/click_cta/.test(html)) problems.push('no click_cta event pushed to the dataLayer');
  const primary = count(html, /data-cta=["']primary["']/gi);
  if (primary !== 1) problems.push(`exactly one primary CTA (data-cta="primary") expected (got ${primary})`);
  if (!/:root\s*\{[^}]*--[a-z0-9-]+\s*:/i.test(html)) problems.push('no CSS tokens on :root (--color-…, --space-…)');
  if (/backdrop-filter\s*:\s*blur|filter\s*:\s*blur/i.test(html)) problems.push('decorative blur found (backdrop-filter/filter: blur): forbidden by the visual anti-slop rule');
  if (/http:\/\//i.test(html)) problems.push('unencrypted http:// URL found: use https:// (v0 rule « autonome »)');
  for (const resource of externalResources(html, rules)) {
    problems.push(`external resource not allowed: ${resource} (the page must be self-contained; only GTM may load)`);
  }
  if (/lorem ipsum|\{\{|\bTODO\b|\bTBD\b/i.test(html)) problems.push('draft marker found (lorem ipsum, {{…}}, TODO or TBD)');
  if (html.length > rules.maxChars) problems.push(`file is ${html.length} characters, at most ${rules.maxChars}`);
  if (!/<(form|a)[^>]+data-cta=["']primary["']/i.test(html) && !/<(button)[^>]+data-cta=["']primary["']/i.test(html)) problems.push('the primary CTA must be an <a>, <button> or <form>');
  return { ok: problems.length === 0, problems };
}
