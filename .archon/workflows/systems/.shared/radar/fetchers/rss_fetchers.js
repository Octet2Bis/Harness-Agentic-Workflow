/**
 * rss_fetchers.js — Connecteurs RSS XML Légers (Jobspresso, WeWorkRemotely)
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Chaque connecteur renvoie { status, jobs }.
 */

const common = require('./common');
const { hashStr, isFreshUnder48h, stripHtml, toIsoDay, ENTREPRISE_INCONNUE } = common;
const { fullDescriptionField } = require('./full_description');

function cleanCdata(text = '') {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function parseRssItems(xmlText) {
  const items = [];
  const itemMatches = [...xmlText.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  for (const match of itemMatches) {
    const raw = match[1];
    const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = raw.match(/<link>([\s\S]*?)<\/link>/i);
    const dateMatch = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const descMatch = raw.match(/<description>([\s\S]*?)<\/description>/i);
    const contentMatch = raw.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i);

    const title = cleanCdata(titleMatch ? titleMatch[1] : '');
    const link = cleanCdata(linkMatch ? linkMatch[1] : '');
    const pubDate = cleanCdata(dateMatch ? dateMatch[1] : '');
    const desc = stripHtml(cleanCdata(descMatch ? descMatch[1] : '')).slice(0, 400);
    // Le texte entier de l'annonce : <content:encoded> quand le flux le donne, sinon <description>.
    const descHtml = cleanCdata(contentMatch ? contentMatch[1] : (descMatch ? descMatch[1] : ''));

    if (title && link) {
      items.push({ title, link, pubDate, desc, descHtml });
    }
  }
  return items;
}

// La fraîcheur se lit sur la date du flux ramenée à AAAA-MM-JJ : `isFreshUnder48h` ne reconnaît pas
// le RFC 2822 brut (« Sat, 24 Oct 2026 … »), qui écartait jusqu'ici toutes les offres des deux flux.
// Jobspresso et WeWorkRemotely ne publient que des offres en télétravail : remote_declared vient
// de la plateforme. Les deux flux donnent une zone (<region> chez WWR, <job_listing:location> chez
// Jobspresso), non lue ici : location reste vide.
function rssJob(prefix, source, item, company, title) {
  return {
    id: `${prefix}-${hashStr(item.link)}`,
    company: company || ENTREPRISE_INCONNUE,
    title,
    location: '',
    remote_declared: true,
    company_hq: '',
    skills_required: '',
    description: item.desc,
    ...fullDescriptionField(item.descHtml),
    salary_range: null,
    link: item.link,
    // RFC 2822 (« Fri, 2 Oct 2026 10:00:00 +0000 ») → AAAA-MM-JJ ; illisible : le texte du flux, tel quel.
    date_published: toIsoDay(item.pubDate) || item.pubDate.slice(0, 16),
    source
  };
}

async function fetchJobspressoLive(endpoint, get = common.fetchUrl) {
  const res = await get(endpoint || 'https://jobspresso.co/feed/');
  if (res.status !== 200 || !res.data) return { status: res.status, jobs: [] };
  const jobs = parseRssItems(res.data).filter(i => isFreshUnder48h(toIsoDay(i.pubDate))).map(i => {
    const parts = i.title.split(/\sat\s|@|–|-/i);
    return rssJob('JBP', 'Jobspresso', i, parts.length > 1 ? parts[1].trim() : '', (parts[0] || i.title).trim());
  });
  return { status: res.status, jobs };
}

async function fetchWeWorkRemotelyLive(endpoint, get = common.fetchUrl) {
  const res = await get(endpoint || 'https://weworkremotely.com/categories/remote-marketing-jobs.rss');
  if (res.status !== 200 || !res.data) return { status: res.status, jobs: [] };
  const jobs = parseRssItems(res.data).filter(i => isFreshUnder48h(toIsoDay(i.pubDate))).map(i => {
    const parts = i.title.includes(':') ? i.title.split(':') : ['', i.title];
    return rssJob('WWR', 'WeWorkRemotely', i, parts[0].trim(), (parts[1] || parts[0]).trim());
  });
  return { status: res.status, jobs };
}

module.exports = {
  fetchJobspressoLive,
  fetchWeWorkRemotelyLive,
  parseRssItems
};
