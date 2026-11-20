/**
 * Les sources des signaux, toutes gratuites et sans Claude. Chaque lecteur prend un `Fetch` injecté
 * (le vrai réseau sur la VM, de faux fichiers en test) et rend des signaux contrôlés en code : nom
 * d'entreprise lisible, date lisible, preuve (titre, lien) présente.
 *
 * Vérifiées le 2026-11-14 par lecture web (le conteneur et le PC n'ont pas ce réseau ; la VM, oui) :
 *   - flux RSS : Maddyness, Tech.eu, Sifted, Tech Funding News, Silicon Canals (réponse 200, format RSS 2.0) ;
 *     EU-Startups et FinSMEs n'ont pas répondu à la lecture web : gardés, l'essai de la VM tranche
 *     (`--probe`) ; FrenchWeb et Deutsche Startups écartés (leur robots.txt refuse les robots) ;
 *   - YC (yc-oss.github.io, données publiques de l'annuaire YC) : `isHiring`, `regions`, `website`… ;
 *   - API Recherche d'entreprises (data.gouv) : `siren`, `activite_principale`, `tranche_effectif_salarie`… ;
 *   - GLEIF (LEI) : `attributes.entity.legalName.name`, `legalAddress.country`, `registeredAs` ;
 *   - BODACC (Opendatasoft, licence ouverte) et Brønnøysund : API officielles de données ouvertes, la
 *     lecture web a été refusée par leur robots.txt (qui vise les robots d'indexation) : champs à
 *     confirmer par l'essai de la VM ;
 *   - Companies House : clé gratuite à créer (COMPANIES_HOUSE_API_KEY dans secrets.env), sinon sautée.
 * Écartées : CVR danois (conditions non lisibles), BORME espagnol (PDF), bibliothèque publicitaire de
 * Meta (jeton et vérification d'identité), Google Ads Transparency (pas d'API), G2/Trustpilot et
 * LinkedIn (lecture automatisée interdite).
 */

import { type CompanyFacts, type Signal, type SignalType, isoDay, normName, readHeadline, sectorsOf, signalId, validCompanyName } from './lib.ts';

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string }>;

export const UA = 'Mozilla/5.0 (compatible; radar-signaux/1.0; usage personnel)';

/** Le vrai réseau : 15 s au plus, jamais d'exception (statut 0 en cas d'échec). */
export const netFetch: Fetch = async (url, init) => {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
    const text = await r.text();
    return { status: r.status, text: text.slice(0, 2_000_000) };
  } catch {
    return { status: 0, text: '' };
  }
};

// ── Flux d'actualité ─────────────────────────────────────────────────────────

export interface Feed {
  id: string;
  name: string;
  url: string;
  /** Le pays par défaut des entreprises du flux (Maddyness : la France), sinon '' (lu dans le texte). */
  country: string;
}

export const FEEDS: Feed[] = [
  { id: 'maddyness', name: 'Maddyness', url: 'https://www.maddyness.com/feed/', country: 'FR' },
  { id: 'techeu', name: 'Tech.eu', url: 'https://tech.eu/feed/', country: '' },
  { id: 'sifted', name: 'Sifted', url: 'https://sifted.eu/feed', country: '' },
  { id: 'techfundingnews', name: 'Tech Funding News', url: 'https://techfundingnews.com/feed/', country: '' },
  { id: 'siliconcanals', name: 'Silicon Canals', url: 'https://siliconcanals.com/feed/', country: '' },
  { id: 'eustartups', name: 'EU-Startups', url: 'https://www.eu-startups.com/feed/', country: '' },
  { id: 'finsmes', name: 'FinSMEs', url: 'https://www.finsmes.com/feed', country: '' },
];

export interface FeedItem {
  title: string;
  link: string;
  date: string;
  categories: string[];
  summary: string;
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#822[01];|&[lr]dquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block: string, name: string): string => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? decode(m[1]) : '';
};

/** Les articles d'un flux RSS 2.0 ou Atom. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = tag(b, 'title');
    let link = tag(b, 'link');
    if (!/^https?:\/\//.test(link)) link = /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? '';
    const date = isoDay(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const categories = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => decode(m[1])).filter(Boolean);
    const summary = (tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 600);
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, date, categories, summary });
  }
  return out;
}

// La table des pays de l'ancien radar (inspectors/geo.js) : pays et régions cités dans un texte.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geo = require('../../.archon/workflows/systems/.shared/radar/inspectors/geo.js') as { zonesIn: (t: string) => { codes: Set<string>; anywhere: boolean }; EUROPE: Set<string> };

/** Le pays d'un article : le pays par défaut du flux, sinon celui que le texte cite (un seul pays hors d'Europe → ce pays). */
export function countryOf(text: string, fallback: string): string {
  if (fallback) return fallback;
  const { codes } = geo.zonesIn(text);
  const list = [...codes];
  const eu = list.filter((c) => geo.EUROPE.has(c));
  if (eu.length === 1) return eu[0];
  if (eu.length === 0 && list.length >= 1 && list.length <= 2) return list[0];
  return '';
}

/** Les signaux d'un flux d'actualité : un par article lisible (le titre dit le signal et l'entreprise). */
export function newsSignals(feed: Feed, xml: string, now: Date): { signals: Signal[]; items: number; skipped: number } {
  const items = parseFeed(xml);
  const signals: Signal[] = [];
  let skipped = 0;
  for (const it of items) {
    const h = readHeadline(it.title, it.summary);
    if (h === null || it.date === '' || Date.parse(it.date) > now.getTime() + 86_400_000) {
      skipped++;
      continue;
    }
    // La preuve : le nom lu doit figurer tel quel dans le titre (contrôle contre une extraction fautive).
    if (!it.title.includes(h.company)) {
      skipped++;
      continue;
    }
    const country = countryOf(`${it.title} ${it.categories.join(' ')} ${it.summary.slice(0, 300)}`, feed.country);
    signals.push({
      id: signalId(feed.id, it.link),
      type: h.type,
      company: h.company,
      date: it.date,
      source: feed.name,
      url: it.link,
      evidence: it.title.slice(0, 240),
      ...(h.amount_eur ? { amount_eur: h.amount_eur } : {}),
      ...(country ? { country } : {}),
      ...(h.detail || it.categories.length ? { detail: [h.detail, sectorsOf(`${it.title} ${it.categories.join(' ')} ${it.summary}`).join(', ')].filter(Boolean).join(' · ') } : {}),
      found_at: now.toISOString(),
    });
  }
  return { signals, items: items.length, skipped };
}

// ── YC : les entreprises européennes qui recrutent ──────────────────────────

const YC_URL = 'https://yc-oss.github.io/api/companies/hiring.json';
export { YC_URL };

/** Les entreprises YC qui recrutent, basées en Europe ou qui recrutent en Europe, actives, lancées depuis moins de 6 ans. */
export function ycSignals(json: string, now: Date): { signals: Signal[]; sites: Record<string, string>; read: number } {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return { signals: [], sites: {}, read: 0 };
  }
  if (!Array.isArray(rows)) return { signals: [], sites: {}, read: 0 };
  const signals: Signal[] = [];
  const sites: Record<string, string> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const name = String(r.name ?? '');
    const regions = Array.isArray(r.regions) ? r.regions.map(String) : [];
    const where = `${String(r.all_locations ?? '')} ${regions.join(' ')}`;
    const europe = regions.includes('Europe') || [...geo.zonesIn(where).codes].some((c) => geo.EUROPE.has(c));
    if (!validCompanyName(name) || r.isHiring !== true || String(r.status ?? '') !== 'Active' || !europe) continue;
    const launched = Number(r.launched_at);
    if (Number.isFinite(launched) && now.getTime() / 1000 - launched > 6 * 365 * 86_400) continue;
    const country = countryOf(String(r.all_locations ?? ''), '');
    const url = String(r.url ?? '');
    signals.push({
      id: signalId('yc', String(r.slug ?? name)),
      type: 'accelerateur',
      company: name,
      date: isoDay(now),
      source: 'Y Combinator',
      url: /^https:\/\//.test(url) ? url : `https://www.ycombinator.com/companies/${encodeURIComponent(String(r.slug ?? ''))}`,
      evidence: `${name} (YC ${String(r.batch ?? '')}, ${Number(r.team_size) || '?'} pers.) recrute : ${String(r.one_liner ?? '').slice(0, 160)}`,
      ...(country ? { country } : {}),
      detail: sectorsOf(`${String(r.one_liner ?? '')} ${String(r.industry ?? '')} ${(Array.isArray(r.tags) ? r.tags : []).join(' ')}`).join(', '),
      found_at: now.toISOString(),
    });
    if (/^https?:\/\//.test(String(r.website ?? ''))) sites[normName(name)] = String(r.website);
  }
  return { signals, sites, read: rows.length };
}

// ── Le registre du radar : recrutement ──────────────────────────────────────

const LEADER_TITLE =
  /\b(?:head of (?:marketing|growth|sales|revenue|demand|brand|partnerships|content|product marketing)|vp(?: of)? (?:marketing|growth|sales|revenue)|vice president|cmo|chief (?:marketing|revenue|growth|commercial)|director(?: of)? (?:marketing|growth|sales)|marketing director|sales director|directeur|directrice|responsable (?:marketing|growth|commercial|des ventes))\b/i;
const MARKETING_TITLE = /\b(?:marketing|growth|demand gen|brand|content|seo|sem|acquisition|lifecycle|crm|community|communication|social media|partnership|go-to-market|gtm)\b/i;

export interface RegistryHistory {
  /** clé du registre → [jour, total des postes, postes de la famille remote] par relevé (un tous les 3 jours au plus, 60 jours gardés). */
  totals: Record<string, [string, number, number][]>;
  /** clé du registre → titres de poste déjà vus (pour « nouveau poste », « premier poste marketing »). */
  titles: Record<string, string[]>;
  /** clé du registre → jour du premier relevé. */
  since: Record<string, string>;
}

export const EMPTY_HISTORY: RegistryHistory = { totals: {}, titles: {}, since: {} };

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Les signaux de recrutement tirés du registre « Entreprises full remote » (déjà lu par le radar :
 * aucun appel réseau) : un poste de responsable marketing/growth/ventes nouveau, un premier poste
 * marketing, une vague (le nombre de postes ouverts monte vite). L'historique est mis à jour ici.
 */
export function registrySignals(companiesDoc: unknown, jobsDoc: unknown, history: RegistryHistory, now: Date): { signals: Signal[]; history: RegistryHistory; companies: number } {
  const today = isoDay(now);
  const companies = rec(rec(companiesDoc).companies);
  const jobs = rec(rec(jobsDoc).companies);
  const h: RegistryHistory = { totals: { ...history.totals }, titles: { ...history.titles }, since: { ...history.since } };
  const signals: Signal[] = [];
  const mk = (key: string, name: string, type: SignalType, url: string, evidence: string, idKey: string, detail?: string): Signal => ({
    id: signalId('registre', `${key}|${type}|${idKey}`),
    type,
    company: name,
    date: today,
    source: 'Registre du radar',
    url,
    evidence,
    ...(detail ? { detail } : {}),
    found_at: now.toISOString(),
  });
  for (const [key, raw] of Object.entries(companies)) {
    const c = rec(raw);
    const name = String(c.name ?? '');
    if (!validCompanyName(name) || c.board === false) continue;
    const list = (Array.isArray(rec(jobs[key]).jobs) ? (rec(jobs[key]).jobs as unknown[]) : []).map(rec);
    const titles = [...new Set(list.map((j) => String(j.title ?? '').trim()).filter(Boolean))];
    const known = h.since[key] !== undefined;
    const before = new Set(h.titles[key] ?? []);
    const careers = /^https:\/\//.test(String(c.careers ?? '')) ? String(c.careers) : '';
    if (known) {
      // L'entreprise est suivie depuis au moins 7 jours : un poste nouveau est vraiment nouveau.
      const old = Date.parse(h.since[key]) <= now.getTime() - 7 * 86_400_000;
      const fresh = titles.filter((t) => !before.has(t));
      if (old) {
        for (const t of fresh.filter((x) => (LEADER_TITLE.test(x) && MARKETING_TITLE.test(x)) || /\b(?:vp|head of|director|directeur|directrice|chief|cmo)\b.*\b(?:sales|revenue|vente|commercial)\b/i.test(x))) {
          const job = list.find((j) => String(j.title) === t);
          signals.push(mk(key, name, 'recrute_leader', String(job?.link ?? careers), `Nouveau poste sur son tableau : « ${t} »`, t, 'un responsable arrive : il montera son équipe dans les mois qui suivent'));
        }
        const hadMarketing = [...before].some((t) => MARKETING_TITLE.test(t));
        const firstMk = fresh.find((t) => MARKETING_TITLE.test(t));
        if (!hadMarketing && firstMk && before.size > 0) {
          const job = list.find((j) => String(j.title) === firstMk);
          signals.push(mk(key, name, 'premier_marketing', String(job?.link ?? careers), `Premier poste marketing/growth vu sur son tableau : « ${firstMk} »`, firstMk));
        }
        if (fresh.length >= 3) signals.push(mk(key, name, 'vague_recrutement', careers, `${fresh.length} nouveaux postes de ton champ en full remote depuis le dernier relevé : ${fresh.slice(0, 3).join(' ; ')}`, `${today}-champ`));
      }
      const series = h.totals[key] ?? [];
      const total = Number(c.total) || 0;
      const ref = series.find(([d]) => Date.parse(d) >= now.getTime() - 35 * 86_400_000 && Date.parse(d) <= now.getTime() - 14 * 86_400_000);
      if (ref && total >= ref[1] + 5 && total >= ref[1] * 1.3) {
        signals.push(mk(key, name, 'vague_recrutement', careers, `${total} postes ouverts sur son tableau, contre ${ref[1]} le ${ref[0]}`, `${today.slice(0, 7)}-total`));
      }
    } else h.since[key] = today;
    h.titles[key] = [...new Set([...(h.titles[key] ?? []), ...titles])].slice(-200);
    const series = (h.totals[key] ?? []).filter(([d]) => Date.parse(d) >= now.getTime() - 60 * 86_400_000);
    if (series.length === 0 || Date.parse(series[series.length - 1][0]) <= now.getTime() - 3 * 86_400_000) series.push([today, Number(c.total) || 0, titles.length]);
    h.totals[key] = series;
  }
  return { signals, history: h, companies: Object.keys(companies).length };
}

// ── Le site de l'entreprise : outils, langues, blog ─────────────────────────

/** Les outils marketing et vente reconnaissables dans le code d'une page d'accueil. */
export const TOOLS: [string, RegExp][] = [
  ['HubSpot', /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|hubspot/i],
  ['Salesforce Pardot', /pi\.pardot\.com|pardot/i],
  ['Marketo', /munchkin|mktoweb|marketo/i],
  ['Segment', /cdn\.segment\.com|segment\.io\/analytics/i],
  ['Klaviyo', /static\.klaviyo\.com|klaviyo/i],
  ['Intercom', /widget\.intercom\.io|intercomcdn/i],
  ['Drift', /js\.driftt\.com|drift\.com\/include/i],
  ['Customer.io', /customer\.io|customerioforms/i],
  ['Braze', /braze\.com|appboy/i],
  ['Brevo', /sibforms|sendinblue|brevo\.com/i],
  ['Mailchimp', /chimpstatic|list-manage\.com/i],
  ['Mixpanel', /cdn\.mxpnl\.com|mixpanel/i],
  ['Amplitude', /cdn\.amplitude\.com|amplitude\.com\/libs/i],
  ['PostHog', /posthog\.com\/static|i\.posthog\.com|posthog-js/i],
  ['Heap', /heap-\d+\.js|heapanalytics/i],
  ['Hotjar', /static\.hotjar\.com/i],
  ['Google Tag Manager', /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/],
  ['LinkedIn Insight', /snap\.licdn\.com/i],
  ['Meta Pixel', /connect\.facebook\.net\/[^"']*fbevents/i],
  ['TikTok Pixel', /analytics\.tiktok\.com/i],
  ['Clearbit', /tag\.clearbitscripts\.com|clearbit/i],
  ['6sense', /j\.6sc\.co|6sense/i],
  ['Leadfeeder', /lftracker|leadfeeder/i],
  ['Apollo', /assets\.apollo\.io/i],
  ['Chili Piper', /chilipiper/i],
  ['Calendly', /assets\.calendly\.com/i],
  ['Crisp', /client\.crisp\.chat/i],
  ['Zendesk', /static\.zdassets\.com/i],
  ['Optimizely', /cdn\.optimizely\.com/i],
  ['AB Tasty', /abtasty/i],
  ['VWO', /dev\.visualwebsiteoptimizer\.com/i],
  ['Webflow', /data-wf-site|webflow\.com/i],
  ['Shopify', /cdn\.shopify\.com/i],
  ['WordPress', /wp-content\//i],
  ['Framer', /framerusercontent\.com/i],
];

export interface SiteSnapshot {
  at: string;
  url: string;
  tools: string[];
  languages: string[];
  feed: boolean;
  title: string;
}

/** Ce qu'une page d'accueil montre : outils, langues proposées (hreflang), flux de blog. */
export function readSite(url: string, html: string, now: Date): SiteSnapshot {
  const tools = TOOLS.filter(([, rx]) => rx.test(html)).map(([n]) => n);
  const languages = [...new Set([...html.matchAll(/hreflang=["']([a-zA-Z]{2})(?:[-_][a-zA-Z]{2})?["']/g)].map((m) => m[1].toLowerCase()))].filter((l) => l !== 'x-').sort();
  const feed = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["']/i.test(html);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 120);
  return { at: isoDay(now), url, tools, languages, feed, title };
}

/** La page lue est-elle bien celle de l'entreprise ? (son nom dans le titre, la description ou le nom du site) */
export function siteMatches(name: string, html: string): boolean {
  const n = normName(name);
  if (n.length < 3) return false;
  const head = html.slice(0, 20_000);
  const bits = [/<title[^>]*>([\s\S]*?)<\/title>/i, /property=["']og:site_name["'][^>]*content=["']([^"']+)/i, /name=["']application-name["'][^>]*content=["']([^"']+)/i].map((rx) => rx.exec(head)?.[1] ?? '');
  return bits.some((b) => normName(decode(b)).includes(n));
}

/** Les signaux d'un changement de site entre deux relevés (le premier relevé ne donne aucun signal). */
export function siteSignals(name: string, prev: SiteSnapshot | null, cur: SiteSnapshot, now: Date): Signal[] {
  if (prev === null) return [];
  const out: Signal[] = [];
  const mk = (type: SignalType, evidence: string, k: string, detail?: string): Signal => ({
    id: signalId('site', `${normName(name)}|${type}|${k}`),
    type,
    company: name,
    date: cur.at,
    source: 'Site de l’entreprise',
    url: cur.url,
    evidence,
    ...(detail ? { detail } : {}),
    found_at: now.toISOString(),
  });
  const MARKETING_TOOLS = new Set(['HubSpot', 'Salesforce Pardot', 'Marketo', 'Segment', 'Klaviyo', 'Intercom', 'Drift', 'Customer.io', 'Braze', 'Brevo', 'Mailchimp', 'Mixpanel', 'Amplitude', 'PostHog', 'Heap', 'LinkedIn Insight', 'Meta Pixel', 'TikTok Pixel', 'Clearbit', '6sense', 'Leadfeeder', 'Apollo', 'Chili Piper', 'Optimizely', 'AB Tasty', 'VWO']);
  const added = cur.tools.filter((t) => !prev.tools.includes(t) && MARKETING_TOOLS.has(t));
  // Une page vide ou bloquée la fois précédente ferait croire à cinq nouveaux outils : au-delà de 3 d'un coup, on ne conclut pas.
  if (added.length > 0 && added.length <= 3 && prev.tools.length > 0) out.push(mk('stack', `Nouvel outil sur son site depuis le ${prev.at} : ${added.join(', ')}`, added.join('+'), `outils vus : ${cur.tools.join(', ')}`));
  const langs = cur.languages.filter((l) => !prev.languages.includes(l));
  if (langs.length > 0 && langs.length <= 3 && prev.languages.length > 0) out.push(mk('nouvelle_langue', `Son site existe maintenant en ${langs.join(', ')} (avant : ${prev.languages.join(', ')})`, langs.join('+')));
  if (cur.feed && !prev.feed) out.push(mk('blog', 'Un flux de blog ou de newsletter est apparu sur son site', cur.at.slice(0, 7)));
  return out;
}

// ── Registres d'entreprises ─────────────────────────────────────────────────

/** France, API Recherche d'entreprises (data.gouv, sans clé, 7 requêtes/s au plus) : la fiche dont le nom correspond exactement. */
export async function lookupFrance(name: string, f: Fetch): Promise<{ facts: CompanyFacts | null; status: number }> {
  const r = await f(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(name)}&per_page=5&etat_administratif=A`);
  if (r.status !== 200) return { facts: null, status: r.status };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(r.text);
  } catch {
    return { facts: null, status: -1 };
  }
  const n = normName(name);
  const rows = (Array.isArray(doc.results) ? doc.results : []).map(rec);
  // Contrôle : le nom (ou le sigle, ou une enseigne du siège) doit correspondre exactement, sinon rien.
  const hit = rows.find((x) => [x.nom_complet, x.nom_raison_sociale, x.sigle, ...(Array.isArray(rec(x.siege).liste_enseignes) ? (rec(x.siege).liste_enseignes as unknown[]) : []), rec(x.siege).nom_commercial].some((v) => typeof v === 'string' && normName(v.replace(/\s*\(.*\)\s*$/, '')) === n));
  if (!hit) return { facts: null, status: 200 };
  const siege = rec(hit.siege);
  return {
    facts: {
      siren: String(hit.siren ?? ''),
      naf: String(hit.activite_principale ?? ''),
      effectif: EFFECTIF[String(hit.tranche_effectif_salarie ?? '')] ?? '',
      ville: String(siege.libelle_commune ?? ''),
      date_creation: String(hit.date_creation ?? ''),
      categorie: String(hit.categorie_entreprise ?? ''),
      dirigeants: Array.isArray(hit.dirigeants) ? hit.dirigeants.length : undefined,
      registry_country: 'FR',
    },
    status: 200,
  };
}

/** Les tranches d'effectif de l'INSEE. */
export const EFFECTIF: Record<string, string> = {
  NN: 'non employeuse', '00': '0 salarié', '01': '1-2', '02': '3-5', '03': '6-9', '11': '10-19', '12': '20-49', '21': '50-99', '22': '100-199', '31': '200-249', '32': '250-499', '41': '500-999', '42': '1000-1999', '51': '2000-4999', '52': '5000-9999', '53': '10000+',
};

/** Le texte d'un champ du BODACC (souvent du JSON dans une chaîne) : les valeurs, sans les clés ni la ponctuation JSON. */
export function plainText(v: unknown): string {
  let x: unknown = v;
  if (typeof x === 'string' && /^\s*[{[]/.test(x)) {
    try {
      x = JSON.parse(x);
    } catch {
      // texte brut
    }
  }
  const out: string[] = [];
  const walk = (y: unknown) => {
    if (typeof y === 'string' || typeof y === 'number') out.push(String(y));
    else if (Array.isArray(y)) y.forEach(walk);
    else if (y !== null && typeof y === 'object') Object.values(y).forEach(walk);
  };
  walk(x);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** BODACC (annonces légales, Opendatasoft) d'un SIREN sur 12 mois : capital, dirigeants, cession, procédures. */
export async function bodaccSignals(siren: string, name: string, f: Fetch, now: Date): Promise<{ signals: Signal[]; status: number }> {
  if (!/^\d{9}$/.test(siren)) return { signals: [], status: 0 };
  const since = isoDay(new Date(now.getTime() - 365 * 86_400_000));
  const base = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records';
  const q = (where: string) => `${base}?limit=50&order_by=dateparution%20desc&where=${encodeURIComponent(where)}`;
  let r = await f(q(`registre="${siren}" and dateparution>="${since}"`));
  // Repli : recherche plein texte du SIREN (le champ `registre` porte « 810 409 330 » et « 810409330 »).
  if (r.status === 400) r = await f(q(`"${siren}" and dateparution>="${since}"`));
  if (r.status !== 200) return { signals: [], status: r.status };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(r.text);
  } catch {
    return { signals: [], status: -1 };
  }
  const out: Signal[] = [];
  for (const row of (Array.isArray(doc.results) ? doc.results : []).map(rec)) {
    const fam = String(row.familleavis ?? '').toLowerCase();
    const text = [row.modificationsgenerales, row.jugement, row.acte, row.listepersonnes].map(plainText).filter(Boolean).join(' ; ');
    const reg = Array.isArray(row.registre) ? row.registre.map(String) : [String(row.registre ?? '')];
    // Contrôle : l'annonce porte bien ce SIREN.
    if (!reg.some((x) => x.replace(/\s/g, '') === siren) && !text.replace(/\s/g, '').includes(siren)) continue;
    let type: SignalType | null = null;
    if (fam === 'collective' || /redressement|liquidation|sauvegarde/i.test(text)) type = 'procedure';
    else if (fam === 'vente' || /cession|fonds de commerce/i.test(String(row.familleavis_lib ?? ''))) type = 'rachat';
    else if (/augmentation (?:du|de) capital|capital social (?:porté|augmenté)|modification du capital/i.test(text)) type = 'capital';
    else if (/(?:président|directeur général|gérant|administrateur)[^.]{0,80}(?:nomination|modification|départ|remplac)|(?:nomination|modification)[^.]{0,80}(?:président|directeur général|gérant)/i.test(text)) type = 'dirigeant_registre';
    if (type === null) continue;
    const date = isoDay(row.dateparution);
    const url = /^https:\/\//.test(String(row.url_complete ?? '')) ? String(row.url_complete) : `https://www.bodacc.fr/pages/annonces-commerciales/?q.registre=${siren}`;
    out.push({ id: signalId('bodacc', String(row.id ?? `${siren}-${date}-${type}`)), type, company: name, date, source: 'BODACC', url, evidence: `${String(row.familleavis_lib ?? fam)} : ${decode(text).slice(0, 200)}`, country: 'FR', found_at: now.toISOString() });
  }
  return { signals: out, status: 200 };
}

/** GLEIF (LEI, sans clé) : le pays et le numéro d'immatriculation d'une entreprise au nom exact (fonds écartés). */
export async function lookupGleif(name: string, f: Fetch): Promise<{ facts: CompanyFacts | null; status: number }> {
  const r = await f(`https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(name)}&page[size]=5`);
  if (r.status !== 200) return { facts: null, status: r.status };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(r.text);
  } catch {
    return { facts: null, status: -1 };
  }
  const n = normName(name);
  for (const d of (Array.isArray(doc.data) ? doc.data : []).map(rec)) {
    const e = rec(rec(d.attributes).entity);
    if (String(e.category ?? '') === 'FUND' || String(e.status ?? '') !== 'ACTIVE') continue;
    if (normName(String(rec(e.legalName).name ?? '')) !== n) continue;
    const country = String(rec(e.legalAddress).country ?? '');
    return { facts: { lei: String(d.id ?? ''), registry_country: country, ...(country === 'FR' && /^\d{9}$/.test(String(e.registeredAs ?? '')) ? { siren: String(e.registeredAs) } : {}) }, status: 200 };
  }
  return { facts: null, status: 200 };
}

/** Norvège, Brønnøysund (sans clé) : effectif et secteur d'une entreprise au nom exact. */
export async function lookupNorway(name: string, f: Fetch): Promise<{ facts: CompanyFacts | null; status: number }> {
  const r = await f(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(name)}&size=5`);
  if (r.status !== 200) return { facts: null, status: r.status };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(r.text);
  } catch {
    return { facts: null, status: -1 };
  }
  const n = normName(name);
  const hit = (Array.isArray(rec(doc._embedded).enheter) ? (rec(doc._embedded).enheter as unknown[]) : []).map(rec).find((x) => normName(String(x.navn ?? '')) === n);
  if (!hit) return { facts: null, status: 200 };
  return { facts: { org_no: String(hit.organisasjonsnummer ?? ''), effectif: hit.antallAnsatte !== undefined ? String(hit.antallAnsatte) : '', naf_label: String(rec(hit.naeringskode1).beskrivelse ?? ''), registry_country: 'NO', ...(typeof hit.hjemmeside === 'string' ? { website: `https://${String(hit.hjemmeside).replace(/^https?:\/\//, '')}` } : {}) }, status: 200 };
}

/** Royaume-Uni, Companies House (clé gratuite, 600 requêtes / 5 min) : nouvelles actions émises (SH01 = levée) et nouveaux dirigeants sur 6 mois. */
export async function companiesHouseSignals(name: string, key: string, f: Fetch, now: Date): Promise<{ facts: CompanyFacts | null; signals: Signal[]; status: number }> {
  if (key === '') return { facts: null, signals: [], status: 0 };
  const auth = { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` };
  const base = 'https://api.company-information.service.gov.uk';
  const s = await f(`${base}/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`, { headers: auth });
  if (s.status !== 200) return { facts: null, signals: [], status: s.status };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(s.text);
  } catch {
    return { facts: null, signals: [], status: -1 };
  }
  const n = normName(name);
  const hit = (Array.isArray(doc.items) ? doc.items : []).map(rec).find((x) => String(x.company_status ?? '') === 'active' && normName(String(x.title ?? '')) === n);
  if (!hit) return { facts: null, signals: [], status: 200 };
  const num = String(hit.company_number ?? '');
  const since = now.getTime() - 183 * 86_400_000;
  const out: Signal[] = [];
  const fh = await f(`${base}/company/${num}/filing-history?category=capital&items_per_page=25`, { headers: auth });
  if (fh.status === 200) {
    try {
      for (const it of (Array.isArray(JSON.parse(fh.text).items) ? JSON.parse(fh.text).items : []).map(rec)) {
        if (String(it.type ?? '') !== 'SH01' || Date.parse(String(it.date ?? '')) < since) continue;
        out.push({ id: signalId('companieshouse', `${num}-${String(it.transaction_id ?? it.date)}`), type: 'capital', company: name, date: isoDay(it.date), source: 'Companies House', url: `https://find-and-update.company-information.service.gov.uk/company/${num}/filing-history`, evidence: `SH01 (allotment of shares) déposé le ${isoDay(it.date)}`, country: 'GB', found_at: now.toISOString() });
      }
    } catch {
      // réponse illisible : pas de signal
    }
  }
  const of = await f(`${base}/company/${num}/officers?items_per_page=35&order_by=appointed_on`, { headers: auth });
  if (of.status === 200) {
    try {
      for (const it of (Array.isArray(JSON.parse(of.text).items) ? JSON.parse(of.text).items : []).map(rec)) {
        if (Date.parse(String(it.appointed_on ?? '')) < since || it.resigned_on) continue;
        out.push({ id: signalId('companieshouse', `${num}-officer-${String(it.name)}-${String(it.appointed_on)}`), type: 'dirigeant_registre', company: name, date: isoDay(it.appointed_on), source: 'Companies House', url: `https://find-and-update.company-information.service.gov.uk/company/${num}/officers`, evidence: `Nouveau ${String(it.officer_role ?? 'dirigeant')} nommé le ${isoDay(it.appointed_on)}${it.occupation ? ` (${String(it.occupation)})` : ''}`, country: 'GB', found_at: now.toISOString() });
      }
    } catch {
      // réponse illisible : pas de signal
    }
  }
  return { facts: { uk_number: num, registry_country: 'GB', date_creation: String(hit.date_of_creation ?? '') }, signals: out, status: 200 };
}
