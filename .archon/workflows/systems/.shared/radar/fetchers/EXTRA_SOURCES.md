# Sources de plus (portées de JobCampaign) : verdicts du 2026-10-24

Relu avec WebFetch. Le `curl` du conteneur est refusé par le proxy (CONNECT 403) pour freehire.me et
jobs.workable.com : rien n'a été appelé depuis le conteneur.

## Freehire (freehire.me) : PORTÉ, `fetchFreehireLive`
- Point d'entrée : `GET https://freehire.me/api/v1/agent/jobs/search?q="<terme>"&q_fields=title&work_mode=remote&regions=eu&regions=uk&posted_within_days=3&description_format=text&sort=posted_at&order=desc&limit=100&source_exclude=…`
- robots.txt : `User-agent: *` → `Allow: /`, Disallow seulement `/my/`, `/signin`, `/jobs/*/discussion`, `/companies/*/discussion`, `/companies/*/closed`. `/api/` n'est interdit qu'à Googlebot et Bingbot. Le fichier renvoie vers l'API publique (llms.txt, openapi.yaml, /docs/api).
- CGU (/terms, /docs/api) : sans clé, usage « personnel et non commercial » (sa propre recherche d'emploi) ; « pas de scraping hors de l'API documentée », pas de contournement des limites, pas de redistribution des données brutes. Le radar ne republie rien : conforme.
- Limites : 300 req/min sur /agent/jobs/search (llms.txt) ; Cloudflare a coupé JobCampaign vers 90 req/min : 1 s entre appels, 6 requêtes max par cycle, arrêt au premier 429. User-Agent nommant le projet (demandé) : `FREEHIRE_HEADERS`.
- `posted_within_days` (date donnée par l’ATS) plutôt que `open_within_days` de JobCampaign (date d’entrée au catalogue : relevé le 2026-10-24, une offre de mars sortait encore). Paramètre inconnu = ignoré et listé dans `meta.ignored_params` : traité en échec visible.
- Forme : enveloppe `{ data, meta }` relue sur une vraie réponse (fixture `test/freehire.json`, 1 offre réelle + 2 construites sur le schéma Job d'openapi.yaml).

## Workable (jobs.workable.com) : PORTÉ, `fetchWorkableSearchLive`, à surveiller
- Point d'entrée (celui de workable_search.py) : `GET https://jobs.workable.com/api/v1/jobs?query=<terme>&location=Europe&workplace=remote&limit=20&day_range=3`.
- robots.txt : `Allow: /search/*` ; `Disallow: /search*?*`, `/search`, `*/search/$`, `/profile*`, `/company-login-unauthorized` ; aucune ligne sur `/api`. Le chemin `/api/v1/jobs` est donc permis. Content-Signal `ai-train=no` (sans objet ici).
- CGU : aucune condition « candidat » trouvée ; les T&C Workable (juin 2025) visent les clients (employeurs), sans clause sur le crawl. API non documentée (celle que sert la page de recherche) : usage prudent, 4 requêtes par cycle, page 1 seulement, 1,5 s entre appels, arrêt au premier 429.
- Une offre remote = une annonce par pays (`locations: ["TELECOMMUTE", "<pays>"]`) : le lieu garde le pays.
- Forme relue sur une vraie réponse (fixture `test/workable_search.json`, 1 offre réelle + 2 construites).

## Station F (jobs.stationf.co) : NON PORTÉ
- robots.txt du sous-domaine : `Allow: /`. Mais le site est « Made with ❤ by Welcome to the Jungle » (CDN welcometothejungle.co) et stationf.py lit une clé Algolia dans `input#algolia_api_key` de /search, puis interroge l'index `wk_cms_jobs_production_careers` (application CSEKHVMS53) : l'index Welcome Kit de WTTJ.
- Les CGU de WTTJ (§ 10) interdisent l'extraction et la recherche scriptées ; réutiliser une clé lue dans la page pour interroger l'index d'un tiers est un contournement. Aucune CGU Station F propre n'est liée depuis la page.

## Next40/120 : `../next40_boards.json` (données, pas de connecteur)
- next40_120.json ne contient que des noms (120). Les slugs viennent de l'API freehire.me (champs `source` + `external_id` des offres de chaque entreprise), le 2026-10-24 : 59 entreprises placées, 1 dans `other` (Workday), 7 en Welcome Kit seulement (`_wttj_only`, non balayables), 53 sans tableau trouvé ou homonymes (`_unmapped`).
- Slugs non revérifiés sur chaque ATS (le conteneur ne les joint pas) : un 404 au premier balayage dit lequel retirer. Le balayage revient à `ats_boards.js` (session principale).
- LinkedIn : rien porté.
