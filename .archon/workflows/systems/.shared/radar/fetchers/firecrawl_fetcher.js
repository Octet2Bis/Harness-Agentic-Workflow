/**
 * firecrawl_fetcher.js — Connecteur Firecrawl Search
 * Pilier : 02_Assistant_Personnel / Career Ops
 * Renvoie { status, jobs }.
 */

const https = require('node:https');
const { hashStr, ENTREPRISE_INCONNUE } = require('./common');

async function fetchFirecrawlJobs(searchQuery, apiKey) {
  const key = apiKey || process.env.FIRECRAWL_API_KEY;
  if (!key || key.length < 10) return { status: 'sans clé API', jobs: [] };

  const payload = JSON.stringify({
    query: `${searchQuery || 'growth marketing'} remote jobs europe`,
    pageOptions: { fetchPageContent: false }
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          const data = json.data || [];
          const jobs = data.slice(0, 10).map(item => ({
            id: `FC-${hashStr(item.url)}`,
            company: item.metadata?.title?.split(/[-–|]/)[0]?.trim() || ENTREPRISE_INCONNUE,
            title: item.metadata?.title || '',
            location: '', // un résultat de recherche web ne déclare rien : « remote » est dans notre requête
            company_hq: '',
            skills_required: searchQuery || '',
            description: (item.markdown || item.description || '').slice(0, 400),
            salary_range: null,
            link: item.url,
            date_published: '',
            source: 'Firecrawl Search'
          }));
          resolve({ status: res.statusCode, jobs });
        } catch { resolve({ status: res.statusCode === 200 ? 'réponse illisible' : res.statusCode, jobs: [] }); }
      });
    });
    req.on('error', () => resolve({ status: 'erreur réseau', jobs: [] }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 'timeout', jobs: [] }); });
    req.write(payload);
    req.end();
  });
}

module.exports = { fetchFirecrawlJobs };
