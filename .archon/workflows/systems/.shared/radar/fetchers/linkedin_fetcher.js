/**
 * linkedin_fetcher.js — Connecteur LinkedIn Guest API avec Rotation Round-Robin
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Renvoie { status, jobs } : status est le premier code non-200 rencontré.
 *
 * Description complète : relue pour CHAQUE annonce dont le lien n'est pas encore connu
 * (options.knownLinks, tous sous-domaines confondus : www, gr, fr, de…), 12 relectures max par
 * cycle avec le jitter habituel. Motif (incident d'octobre 2026) : une annonce grecque en présentiel
 * est arrivée au tableau comme « remote » parce que f_WT=2 ne reflète que la case cochée par
 * l'annonceur, et que la description n'était relue que pour une courte liste de sous-domaines
 * (gr.linkedin.com n'en faisait pas partie) : l'auditeur n'a jamais vu le mot « hybrid ».
 * remote_basis dit donc explicitement que la déclaration vient de l'annonceur, non vérifiée.
 */

const fs = require('node:fs');
const path = require('node:path');
const common = require('./common');
const { hashStr, isFreshUnder48h, sleep, stripHtml, ENTREPRISE_INCONNUE } = common;

const BATCH_SIZE = 7;
const JITTER_MS = 650;
const DESC_FETCH_CAP = 12;
const REMOTE_BASIS = 'filtre « Remote » de LinkedIn (choix de l’annonceur, non vérifié)';
// La recherche filtre déjà sur 24 h (f_TPR=r86400) : c'est la seule date connue sans <time>.
const DATE_PAR_FILTRE = '< 24h (filtre LinkedIn)';

function getCursorState(cursorFile, totalQueries) {
  let index = 0;
  if (fs.existsSync(cursorFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
      if (typeof data.nextIndex === 'number') index = data.nextIndex;
    } catch {}
  }
  return totalQueries > 0 ? index % totalQueries : 0;
}

function saveCursorState(cursorFile, nextIndex) {
  try {
    fs.writeFileSync(cursorFile, JSON.stringify({ nextIndex, updated_at: new Date().toISOString() }), 'utf8');
  } catch {}
}

// Une carte = du début d'un élément de classe `base-card` (div, ou carte entièrement cliquable
// `<a class="base-card …" href>`) au début du suivant ; chaque champ est lu dans SA carte. Avant
// (incident du 2026-10-24), cinq listes extraites séparément (titres, entreprises, liens, dates,
// lieux) étaient appariées par rang : une carte sans `base-card__full-link`, sans entreprise en lien
// ou sans <time> décalait toutes les suivantes, et l'offre partait au tableau avec l'entreprise
// d'une annonce et le lien d'une autre (Bizneo HR sur une annonce EverAI, OnTheGoSystems sur
// Darkroom…), et le slug, tiré de l'entreprise, pouvait être celui d'une autre offre du tableau.
const CARD_START_RE = /<(?:div|a|li)\b[^>]*\bclass="(?:[^"]*\s)?base-card(?=[\s"])[^"]*"[^>]*>/g;

function parseCards(html) {
  const starts = [...html.matchAll(CARD_START_RE)].map(m => m.index);
  return starts.map((start, n) => {
    const card = html.slice(start, n + 1 < starts.length ? starts[n + 1] : html.length);
    const pick = re => { const m = card.match(re); return m ? m[1] : ''; };
    return {
      title: stripHtml(pick(/<h3 class="base-search-card__title">([\s\S]*?)<\/h3>/)),
      // Le nom, qu'il soit dans un lien (page entreprise) ou en texte nu (pas de page) : tout le <h4>.
      company: stripHtml(pick(/<h4 class="base-search-card__subtitle">([\s\S]*?)<\/h4>/)),
      // Le lien de l'annonce (…/jobs/view/…), celui de la carte ou de `base-card__full-link`, jamais celui de l'entreprise.
      link: pick(/href="(https?:\/\/[^"?#]*\/jobs\/view\/[^"?#]*)/).trim(),
      date: pick(/<time[^>]*datetime="([^"]*)"/).trim(),
      loc: stripHtml(pick(/<span class="job-search-card__location">([\s\S]*?)<\/span>/))
    };
  });
}

async function fetchLinkedInLive(queries = [], options = {}) {
  const get = options.fetchUrl || common.fetchUrl;
  const jitter = options.jitterMs ?? JITTER_MS;
  const known = options.knownLinks instanceof Set ? options.knownLinks : new Set(options.knownLinks || []);
  const isKnown = link => known.has(link) || known.has(link.toLowerCase());
  let descFetches = 0;
  const allQueries = Array.isArray(queries) && queries.length > 0 ? queries : ['growth marketing'];
  const careerDir = options.careerDir || path.resolve(__dirname, '../../../Workspace/career');
  const cursorFile = path.join(careerDir, 'linkedin_cursor_state.json');

  const searches = linkedinSearches(options.source);
  const batch = Math.max(1, Number(options.source?.batch_size) || BATCH_SIZE);
  const startIndex = getCursorState(cursorFile, allQueries.length);
  const selectedQueries = [];
  for (let i = 0; i < Math.min(batch, allQueries.length); i++) {
    selectedQueries.push(allQueries[(startIndex + i) % allQueries.length]);
  }
  saveCursorState(cursorFile, (startIndex + selectedQueries.length) % allQueries.length);

  const jobs = [];
  let status = 200;
  let blocked = false;
  const calls = searches.flatMap(search => selectedQueries.map(kw => ({ search, kw })));
  for (const { search, kw } of calls) {
    if (blocked) break;
    const url = linkedinSearchUrl(kw, search);
    const remoteSearch = search.f_WT === '2';
    const res = await get(url, 4500);
    if (res.status !== 200) {
      if (status === 200) status = res.status;
      // 429 / 999 : LinkedIn bloque, insister aggrave le blocage.
      if (res.status === 429 || res.status === 999) { blocked = true; break; }
    }
    if (res.status === 200 && res.data) {
      for (const card of parseCards(res.data)) {
        const dt = card.date || DATE_PAR_FILTRE;
        const loc = card.loc;
        if (!card.link || !card.title || !isFreshUnder48h(dt)) continue;
        // Intitulés allemands genrés (Manager:in, (m/w/d)) : écartés pour Antoine ; une recherche
        // `keep_gendered_titles` (France : « (H/F) » est la norme) les garde.
        if (!search.keep_gendered_titles && /(?:[:*_]in\b|\b[a-z]+:in\b|\b[a-z]+\*in\b|\([a-z]\/[a-z](?:\/[a-z])?\)|\bgn\b)/i.test(card.title)) continue;

        let realDescription = `${card.title} at ${card.company || ENTREPRISE_INCONNUE}${loc ? ` (${loc})` : ''}.`;
        const jId = (card.link.match(/(\d{8,12})/) || [])[1];
        if (jId && !isKnown(card.link) && descFetches < DESC_FETCH_CAP) {
          descFetches++;
          const descRes = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jId}`, 2000);
          if (descRes.status === 200 && descRes.data) {
            const m = descRes.data.match(/<div class="show-more-less-html__markup[^"]*">([\s\S]*?)<\/div>/i);
            const cleaned = stripHtml(m ? m[1] : descRes.data).slice(0, 1500);
            if (cleaned && cleaned.length > 50) realDescription = cleaned;
          }
          if (jitter > 0) await sleep(jitter);
        }

        jobs.push({
          id: `LI-${hashStr(card.link)}`,
          company: card.company || ENTREPRISE_INCONNUE,
          title: card.title,
          location: loc,
          // requête filtrée remote par LinkedIn (f_WT=2) : case cochée par l'annonceur ; sinon rien de déclaré
          remote_declared: remoteSearch,
          remote_basis: remoteSearch ? REMOTE_BASIS : '',
          ...(search.contract_hint ? { contract_hint: search.contract_hint } : {}),
          company_hq: loc,
          skills_required: kw,
          description: realDescription,
          salary_range: null,
          link: card.link,
          date_published: dt,
          source: 'LinkedIn (Live 24h)'
        });
      }
    }
    if (jitter > 0) await sleep(jitter);
  }

  return { status, jobs };
}

// La recherche d'Antoine (par défaut) : « <intitulé> remote », Europe, case Remote cochée.
const DEFAULT_SEARCH = { location: 'Europe', f_WT: '2', suffix: ' remote', f_JT: '', keep_gendered_titles: false, contract_hint: '' };

/**
 * Les recherches de l'entrée LinkedIn de job_sources.json (`searches`, 2026-11-20, Camille) :
 * chacune `{ location, f_WT ('' : tout mode de travail ; '1' sur site ; '2' remote ; '3' hybride),
 * f_JT (types de contrat LinkedIn, ex. 'C,T' : contrat, temporaire), suffix, keep_gendered_titles,
 * contract_hint }`, chaque intitulé du cycle étant cherché dans chacune. Sans `searches` : celle d'Antoine.
 */
function linkedinSearches(source) {
  const list = Array.isArray(source?.searches) ? source.searches.filter(x => x && typeof x === 'object') : [];
  if (list.length === 0) return [DEFAULT_SEARCH];
  return list.map(x => ({
    location: String(x.location ?? 'Europe'),
    f_WT: /^[123](,[123])*$/.test(String(x.f_WT ?? '')) ? String(x.f_WT) : '',
    f_JT: /^[FPCTVIO](,[FPCTVIO])*$/.test(String(x.f_JT ?? '')) ? String(x.f_JT) : '',
    suffix: typeof x.suffix === 'string' ? x.suffix : '',
    keep_gendered_titles: x.keep_gendered_titles === true,
    contract_hint: typeof x.contract_hint === 'string' ? x.contract_hint : ''
  }));
}

function linkedinSearchUrl(kw, search) {
  const params = [`keywords=${encodeURIComponent(`${kw}${search.suffix}`)}`, `location=${encodeURIComponent(search.location)}`];
  if (search.f_WT) params.push(`f_WT=${encodeURIComponent(search.f_WT)}`);
  if (search.f_JT) params.push(`f_JT=${encodeURIComponent(search.f_JT)}`);
  params.push('f_TPR=r86400', 'sortBy=DD', 'start=0');
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.join('&')}`;
}

module.exports = { fetchLinkedInLive, parseCards, linkedinSearches, linkedinSearchUrl, BATCH_SIZE, DESC_FETCH_CAP };
