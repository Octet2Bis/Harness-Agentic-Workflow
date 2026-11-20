/**
 * wttj_parser.js — Analyse des cartes d'offres de la page « emploi télétravail » de WTTJ
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Ordre de préférence : JSON-LD (JobPosting / ItemList) si la page en sert, sinon les cartes HTML
 * découpées autour des liens /fr/companies/{org}/jobs/{slug}. Le balisage exact de WTTJ n'ayant pas
 * pu être relu depuis le conteneur, l'analyse HTML ne dépend d'aucun nom de classe : seulement des
 * liens, du titre (h2-h4 ou texte du lien), de l'alt du logo, et de libellés stables (CDI, villes,
 * « Télétravail total », « Salaire : », « il y a … », <time datetime>).
 */

const { hashStr, isFreshUnder48h, stripHtml, toIsoDay, ENTREPRISE_INCONNUE } = require('./common');

const LINK_RE = /href="(\/fr\/companies\/[^/"]+\/jobs\/[^"?#]+)"/g;
const CONTRACT_RE = /^(CDI|CDD|Stage|Alternance|Freelance|Intérim|Interim|VIE|Temps partiel|Autre|Autres|Indépendant)$/i;
const RELATIVE_DATE_RE = /^(il y a .+|aujourd'hui|hier|avant-hier|à l'instant)$/i;
const SKIP_RE = /^(Télétravail .*|Salaire : .*|\d[\d\s]* collaborateurs)$/i;

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function textTokens(html) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '\n')).split('\n').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// « il y a 1 heure » / « hier » sont frais ; sinon la date ISO de <time datetime> ou les règles communes.
function isFreshWttj(dateText, isoDay) {
  if (isoDay) return isFreshUnder48h(isoDay);
  return /\b(heure|minute|instant)s?\b/i.test(dateText) || isFreshUnder48h(dateText);
}

function job(fields, base, basis) {
  const link = fields.href.startsWith('http') ? fields.href : `${base}${fields.href}`;
  return {
    id: `WTTJ-${hashStr(link)}`,
    company: fields.company || ENTREPRISE_INCONNUE,
    title: fields.title || '',
    location: fields.city || '',
    remote_declared: true,
    remote_basis: basis,
    company_hq: '',
    skills_required: '',
    description: [fields.tagline, fields.contract, fields.remoteLabel].filter(Boolean).join(' · ').slice(0, 400),
    salary_range: fields.salary || null,
    link,
    date_published: fields.isoDay || fields.dateText || '',
    source: 'Welcome to the Jungle (télétravail)'
  };
}

function fromJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const nodes = [].concat(data).flatMap(d => (d && d.itemListElement ? d.itemListElement.map(e => e.item || e) : [d]));
    for (const n of nodes) {
      if (!n || n['@type'] !== 'JobPosting' || !n.url) continue;
      out.push({ href: n.url, title: n.title, company: n.hiringOrganization?.name, city: n.jobLocation?.address?.addressLocality,
        contract: n.employmentType, isoDay: toIsoDay(n.datePosted), dateText: '', tagline: stripHtml(n.description || '').slice(0, 200) });
    }
  }
  return out;
}

function fromCards(html) {
  const hrefs = [...new Set([...html.matchAll(LINK_RE)].map(m => m[1]))];
  return hrefs.map((href, idx) => {
    const start = html.indexOf(`href="${href}"`);
    const next = hrefs[idx + 1] ? html.indexOf(`href="${hrefs[idx + 1]}"`) : -1;
    const chunk = html.slice(start, next > start ? next : start + 8000);
    const heading = chunk.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const alt = chunk.match(/<img[^>]*alt="([^"]*)"/i);
    const time = chunk.match(/<time[^>]*datetime="([^"]*)"/i);
    const tokens = textTokens(chunk);
    const title = heading ? stripHtml(decode(heading[1])) : (tokens[0] || '');
    const titleIdx = tokens.indexOf(title);
    const contractIdx = tokens.findIndex(t => CONTRACT_RE.test(t));
    const after = tokens.slice(titleIdx + 1);
    const company = (alt && alt[1].trim()) || after.find(t => !SKIP_RE.test(t) && !CONTRACT_RE.test(t)) || '';
    const tagline = after.find(t => t !== company && t.length > 25 && !SKIP_RE.test(t) && !RELATIVE_DATE_RE.test(t) && (contractIdx < 0 || tokens.indexOf(t) < contractIdx)) || '';
    return {
      href, title, company, tagline,
      contract: contractIdx >= 0 ? tokens[contractIdx] : '',
      city: contractIdx >= 0 ? (tokens[contractIdx + 1] || '') : '',
      remoteLabel: tokens.find(t => /^Télétravail/i.test(t)) || '',
      salary: (tokens.find(t => /^Salaire\s*:/i.test(t)) || '').replace(/^Salaire\s*:\s*/i, ''),
      dateText: tokens.find(t => RELATIVE_DATE_RE.test(t)) || '',
      isoDay: time ? toIsoDay(time[1]) : ''
    };
  });
}

function parseWttjCards(html, { base, basis }) {
  const fields = fromJsonLd(html);
  const list = fields.length > 0 ? fields : fromCards(html);
  return list.filter(f => f.href && f.title && isFreshWttj(f.dateText, f.isoDay)).map(f => job(f, base, basis));
}

module.exports = { parseWttjCards };
