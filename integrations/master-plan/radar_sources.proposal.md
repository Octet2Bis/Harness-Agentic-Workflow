# Proposition : où le radar cherche, et où il devrait chercher

**Proposé, pas branché.** Le radar de la VM (`career_ops/` de Master Plan : `live_job_scraper`
→ jury `inspectors/` → `decision_maker_scout` → `pending_gold_jobs.json` en
`PENDING_VALIDATION`, sous pm2) est en production : rien ici ne le modifie. Ce document part de
ce qu'il fait aujourd'hui, relevé le 22 octobre au soir sur la copie du PC, et dit ce qu'il
faudrait y changer, par ordre de rendement. `radar_ats_boards.ts` (sans réseau, testé dans
`radar_ats_boards.test.ts`) est la spécification exécutable des deux premières pistes.

Question posée dans le fil du 22 octobre : « J'ai l'impression qu'elles viennent toutes de
LinkedIn, alors qu'un grand nombre de plateformes spécialisées en growth et en full remote
existent. » L'impression est juste ; la cause n'est pas celle qu'on croit.

## 1. Ce que le tableau contient (relevé le 22 octobre)

`pending_gold_jobs.json` du PC : **44 lignes, 40 LinkedIn, 2 Arbeitnow, 2 Himalayas.**

Ces 44 lignes sont **32 offres distinctes** : six slugs reviennent plusieurs fois, la même
offre publiée par pays sur LinkedIn (Smartness ×4 : Portugal, Italie, Autriche, Espagne ;
Darkroom ×4 ; Bending Spoons ×3 ; Orange ×3 ; Toptal ×2 ; Bizneo HR ×2). Le slug du radar
est l'entreprise en minuscules, tronquée à 20 caractères (`live_job_scraper.js`, l. 148) :
toutes ces lignes partagent donc le même slug, et `/valider <slug>` ou le cockpit ne savent pas
laquelle on vise. Le cockpit replie ces lignes à l'affichage depuis le 22 octobre (une ligne par
slug, les annonces dans la fiche) ; c'est un pansement, le tableau devrait le faire à la source.

## 2. Ce que le radar interroge (`job_sources.json`, version 2.0.0)

| Source | Comment | Ce qu'on lui demande |
|---|---|---|
| LinkedIn Jobs (guest API) | `jobs-guest/jobs/api/seeMoreJobPostings/search` | **par intitulé** : `keywords={keyword}` × les 87 `search_queries` de `career_taxonomy.json`, `location=Europe`, `f_WT=2` (remote), `f_TPR=r86400` (24 h) |
| Himalayas | `himalayas.app/jobs/api?limit=40` | rien : les 40 dernières offres, tous métiers |
| Working Nomads | `workingnomads.com/api/exposed_jobs/` | rien : le flux entier |
| RemoteOK | `remoteok.com/api?tag=marketing` | l'étiquette `marketing` |
| Remotive | `remotive.com/api/remote-jobs?category=marketing` | la catégorie `marketing` |
| Arbeitnow | `arbeitnow.com/api/job-board-api` | rien : le flux entier (filtre `remote` par offre, côté radar) |
| Jobspresso | flux RSS | rien |
| WeWorkRemotely | RSS de la catégorie marketing | la catégorie |
| Firecrawl Search | `api.firecrawl.dev/v1/search` | désactivé |

Puis `fetchers/index.js` (copie PC, `04_Productivite_Admin/career_ops/fetchers/`) : LinkedIn
passe sans autre filtre (« déjà requêté par intitulé ciblé ») ; les autres sources passent par
`matchesAnyTargetQuery`, qui accepte une offre dès que son **titre contient un mot du domaine**
(growth, marketing, acquisition, gtm, revops, demand generation, lead generation, inbound,
outbound, traffic manager, conversion, crm, lifecycle, product marketing, sales ops, market
analyst, operations), sinon un intitulé des 87 (ou tous ses mots de plus de trois lettres),
sinon l'intitulé exact dans le corps. `matchesTarget` dans `radar_ats_boards.ts` est ce filtre
réécrit à l'identique, et ses tests montrent qu'il laisse passer « VP Marketing », « Operations
Associate (warehouse) » ou « CRM Developer (Dynamics 365) » : **ce filtre n'est pas ce qui
retient les offres**.

Le déséquilibre vient d'avant lui :

- **seul LinkedIn est interrogé par intitulé.** Les autres reçoivent une catégorie générale
  (« marketing », orientée tech et États-Unis chez RemoteOK et Remotive) ou rien du tout ;
- **Himalayas est lu 40 offres à la fois**, sans requête. Son API documente une pagination par
  curseur (« Pass the nextCursor value from each response back as ?cursor= », relevé le 22
  octobre ; `offset` est annoncé déprécié) et aucun paramètre de recherche : le radar ne voit que
  les 40 dernières publications, tous métiers confondus ;
- **Arbeitnow** rend un flux entier (`data[]`, champ `remote` vrai ou faux par offre, `tags`,
  `location`) et sa page ne documente aucun paramètre de requête (relevé le 22 octobre) ; la
  pertinence se joue donc entièrement côté radar, sur un flux surtout allemand ;
- **Remotive** : sa page d'API refuse la lecture automatique (`robots`), ses paramètres n'ont pas
  pu être vérifiés ce soir (la documentation publique mentionne `search` et `limit` : **à
  vérifier**).

Une incohérence à lever avec Antoine, pas une affirmation : la copie PC d'`index.js` dit
« LinkedIn désactivé par décision d'Antoine (29/09) » sauf `CAREER_LINKEDIN=on`, alors que les
offres du tableau datées des 21 et 22 octobre viennent de LinkedIn. La VM tourne donc avec
LinkedIn activé, ou avec une autre version du fichier que celle du PC.

## 3. Ce qu'il faudrait changer, par ordre de rendement

### (a) Une ligne par offre, les pays en liste

Replier, avant écriture du tableau, les annonces d'une même entreprise au même intitulé
(entreprise + intitulé normalisés, `titleKey` de `radar_freehire.ts`) : une ligne, la plus
récente devant, `locations: [...]` et la liste des liens par pays (`groupByCountry`). Le slug
devient unique par offre et non plus par entreprise.

- Coût : une fonction dans `live_job_scraper.js` avant `processed_jobs.json`, et la lecture de
  `locations` par le bot (`/jobs`) : une dizaine de lignes.
- Gain : 44 lignes → 32 ce soir ; plus d'ambiguïté sur `/valider` ; un seul jury par offre au
  lieu d'un par pays (le jury coûte des appels de modèle).

### (b) Interroger les autres sources par intitulé, comme LinkedIn

Là où la source accepte une requête texte, lui passer les mêmes 87 intitulés (ou une liste
courte dédiée : growth, lifecycle, revops, marketing ops, outbound). Là où elle n'en accepte
pas, lire tout le flux par pagination plutôt que les 40 dernières.

- Himalayas : paginer par `nextCursor` jusqu'à la date du dernier passage (documenté) ; pas de
  requête texte (documenté : aucune).
- Arbeitnow : flux entier, déjà le cas ; filtrer `remote: true` puis `tags` (documenté dans la
  réponse, pas de paramètre connu).
- Remotive, Working Nomads, RemoteOK : paramètres **à vérifier** avant de coder (lecture
  refusée ou non faite ce soir).
- Coût : `api_fetchers.js`, une boucle de pagination et un paramètre par source.
- Gain : la seule façon de voir les offres growth et full remote de ces plateformes qui ne
  tombent pas dans leurs 40 dernières publications ni dans la catégorie « marketing ».

### (c) Les pages carrières des 616 entreprises vérifiées

`verified_remote_companies.json` : 616 entreprises, toutes avec `careers_url`. Par ATS reconnu
dans l'URL : LinkedIn 36, Workable 8, Lever 5, Ashby 4, Himalayas 4, Welcome to the Jungle 3,
Greenhouse 3, Recruitee 2, SmartRecruiters 2, Workday 1 ; le reste, des pages carrières maison.

Pour Greenhouse, Lever et Ashby, la page carrières a une **API JSON publique, sans compte ni
clé** :

| ATS | Page | API |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/{token}` | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` |
| Lever | `jobs.lever.co/{company}` | `api.lever.co/v0/postings/{company}?mode=json` |
| Ashby | `jobs.ashbyhq.com/{org}` | `api.ashbyhq.com/posting-api/job-board/{org}` |

`atsEndpoint(careersUrl)` déduit l'URL à appeler ; `parseGreenhouse`, `parseLever`,
`parseAshby` rendent des offres aux champs du tableau (id stable `GH-`/`LEV-`/`ASH-`, texte de
l'annonce à plat, lieu, télétravail déclaré, salaire quand Lever le donne, date, service) ;
`dedupeAgainstBoard` écarte ce que le tableau a déjà (même lien, ou même entreprise + intitulé
vue par LinkedIn). Les réponses de test sont **écrites à la main** dans la forme publique de
chaque API (`test/greenhouse_jobs.sample.json`, `lever_postings.sample.json`,
`ashby_board.sample.json`) : aucune API n'a été appelée ce soir (le conteneur ne les atteint
pas), la forme des champs est celle de leur documentation publique et reste **à confirmer sur
une vraie réponse** avant branchement.

- Coût : une source de plus dans `job_sources.json` (`type: ats_boards`), une boucle sur les
  entrées de `verified_remote_companies.json` dont `atsEndpoint` n'est pas null (12 ce soir),
  un appel par entreprise et par passage.
- Gain : **le lien est celui de l'employeur**, ce que `career-apply` préfère : `route`
  reconnaît ces plateformes sans passer par l'agent `resolve` (`blocks/.shared/platforms.ts`),
  et `apply-submit` sait remplir leurs formulaires. Ce sont aussi des entreprises déjà
  vérifiées full remote par le radar lui-même. La couverture grandit avec le fichier : chaque
  entreprise ajoutée avec une page Greenhouse, Lever ou Ashby devient une source.
- Workable, Recruitee, SmartRecruiters, Teamtailor, Personio ont aussi des flux publics par
  entreprise : **à vérifier** un par un, hors de cette spécification.

### (d) Les plateformes spécialisées growth et full remote

Relevé le 22 octobre au soir, source par source, depuis le conteneur (appel réel ou lecture
de la documentation, des conditions et du `robots.txt`) : voir la section 6 et le fichier
`job_sources.proposed.json`. Six sources se branchent avec le code que le radar a déjà
(`api_json`, `rss_feed`), Welcome to the Jungle attend une décision d'Antoine.

### (e) Free-Hire

Déjà proposé : `radar_freehire.proposal.md` (agrégateur d'une cinquantaine d'ATS, API publique,
liens de l'employeur, descriptions complètes, orienté tech). Il recouvre en partie (c) avec une
couverture plus large, au prix d'une dépendance à un service personnel sans SLA ; (c) ne dépend
que des ATS eux-mêmes.

## 4. Ce que ce dépôt fournit

- `radar_ats_boards.ts` : `atsEndpoint`, `parseGreenhouse`, `parseLever`, `parseAshby`,
  `parseBoard`, `groupByCountry`, `matchesTarget`, `dedupeAgainstBoard`, `stripHtml`, `isoDay`.
  Sans réseau ; réutilise `decodeEntities`, `slugPart`, `linkKey`, `titleKey`,
  `DESCRIPTION_MAX` de `radar_freehire.ts` et `platformFor`/`hostOf` de `platforms.ts`.
- `radar_ats_boards.test.ts` : 12 tests sur les trois réponses écrites à la main.
- `job_sources.proposed.json` : le `job_sources.json` proposé (version 2.1.0), même forme que
  celui de production plus des champs de lecture (`query`, `filter`, `terms`, `verified`,
  `note`) que le radar ignore ; `job_sources.proposed.test.ts` vérifie la forme, que les types
  que le radar ne lit pas encore sont désactivés, et que chaque source nouvelle et activée a
  été vérifiée par un appel.
- Rien dans `career_ops/`, `job_sources.json` ni la VM n'est touché.

## 5. Questions pour Antoine

1. LinkedIn : activé sur la VM malgré la note du 29 septembre, ou version différente du PC ?
2. (a) d'abord ? C'est le changement le moins risqué et il réduit le coût du jury tout de suite.
3. Pour (c), un essai à la main sur une des 12 pages (par exemple une page Lever) pour confirmer
   la forme des réponses avant de brancher.
4. Welcome to the Jungle : demander l'accès à l'API Welcome Kit (recommandé), lire la page
   « emploi télétravail » (page 1 seulement, signal faible), ou renoncer ? Voir 6.4.
5. Jobgether renvoie vers sa propre page, pas vers l'employeur : d'accord pour que `route`
   suive ce lien pour trouver la page de candidature ?

## 6. Catalogue élargi (relevé le 22 octobre)

Légende de la colonne « vérifié » : *appel* = une réponse réelle a été lue ce soir ; *docs* =
documentation, conditions et `robots.txt` lus, pas d'appel ; *page* = page HTML lue.
« Filtrage » dit ce que le radar peut faire côté requête ; le reste se filtre par intitulé
(`matchesAnyTargetQuery`) et par pays, comme pour LinkedIn.

### 6.1 Spécialisées GTM, growth et marketing

| Source | Accès | Filtrage | Europe | Conditions | Vérifié | Verdict |
|---|---|---|---|---|---|---|
| **Growth.Talent** (growthtalent.org) | API JSON `/api/v1/jobs`, OpenAPI publié, Atom `/jobs/feed.xml` | `market=france` ou `usa`, `remote=true`, `q`, `category`, `seniority` | 29 offres France remote, dernière du 20 octobre | `/api/v1/` autorisé par robots, ai-train=no, cache 30 min | appel | **brancher** |
| **Jobicy** | API JSON v2 + RSS | `geo=europe/emea/france`, `industry=marketing`, `tag=` | oui, fenêtre 7 jours | ≤ 1 appel/h, crédit + lien canonique | appel | **brancher** |
| **Exit Five** (marketing B2B) | sitemap jobs (16 offres), liste rendue en JS | aucun | surtout US | Crawl-delay 1, `/api/` interdit | appel | plus tard (volume faible) |
| **MKT1 Job Board** | HTML lisible, ~25 nouvelles/semaine, pas de dates | étiquettes « Europe – Remote » | partiel | pas de flux | page | plus tard (nouveau lecteur HTML) |
| **Dynamite Jobs** | sitemap par catégorie (`category=marketing`, ~65 URLs, lastmod du jour) | catégorie | beaucoup d'US-only | `/api/` interdit | appel | plus tard (lecteur sitemap) |
| **Hey Marketers** | RSS `/jobs.rss` | aucun | 2 offres | — | appel | non (vide) |
| **RevPath** (DealHub) | RSS `/rss/jobs` existe mais interdit par robots | — | — | robots | docs | non |
| **GTMfund / GTMnow** | Consider.com, clé seulement | — | — | — | docs | non |
| **Lenny's Jobs**, **Demand Curve**, **Reforge**, **CXL**, **RevOps Co-op**, **Pavilion**, **MarketerHire** | rendus en JS, réseau membre ou payant | — | — | — | docs | non |
| **Product Marketing Alliance**, **GrowthHackers**, **Swipe Files** (Niceboard) | lecture refusée depuis le conteneur | — | — | — | — | à essayer depuis la VM (`/sitemap-jobs.xml`) |
| **Wellfound** | HTML seulement | — | — | CGU interdisent l'extraction | docs | non |

### 6.2 Spécialisées full remote

| Source | Accès | Filtrage | Europe | Conditions | Vérifié | Verdict |
|---|---|---|---|---|---|---|
| **Jobgether** | API JSON officielle sans clé (`/astroapi/ai/jobs.json`, docs publiées) | `keyword`, `locations=europe`, `remoteType=full-remote`, `sort=date`, 25 par page, 10 pages | oui, offres du jour | chemin autorisé par robots, Crawl-delay 2, ai-train=no ; lien vers Jobgether, pas l'employeur | appel | **brancher** (5-6 mots-clés) |
| **EU Remote Jobs** | RSS `sitemap.rss` (48 dernières) + sitemap avec lastmod | aucun côté flux ; catégorie et région sur la page | oui, par construction | `?search_*` interdit | appel | **brancher** |
| **Himalayas** (déjà branché) | API JSON | `limit=100`, pagination `cursor=` (offset déprécié) | restrictions pays/fuseau dans la réponse | — | appel | **améliorer** (40 → 100 + curseur) |
| **Remotive** (déjà branché) | API JSON | `search=` au lieu de la seule catégorie marketing | `candidate_required_location` | ≤ 4 lectures/jour | docs | **améliorer** |
| **We Work Remotely** (déjà branché) | RSS par catégorie | `remote-sales-and-marketing-jobs.rss` | `<region>` à filtrer | attribution | appel | **améliorer** |
| **Working Nomads**, **RemoteOK**, **Arbeitnow**, **Jobspresso** (déjà branchés) | inchangés | filtres de pays par expression régulière ; `remote` d'Arbeitnow peu fiable | — | lien de retour suivi pour RemoteOK | — | garder |
| **Remote.com** (`/jobs/all`) | HTML, 20 par page, libellés « remote - Europe only » | — | oui | CGU à lire | page | plus tard (lecteur HTML) |
| **NoDesk** (`/remote-jobs/europe/`) | HTML (Algolia derrière, pas de clé publique), sitemap ~1 000 URLs sans lastmod | région | oui | CGU à lire | page | plus tard |
| **The Muse** | API publique (500 req/h), `location=Flexible / Remote` | catégorie à tester | surtout US | — | appel | non (rendement) |
| **Workew** | RSS `?feed=job_feed` | aucun | surtout US | — | appel | non (rendement) |
| **Remote Rocketship** (29 $/mois), **Remote Work Europe** (15 €/mois), **FlexJobs** | payants | — | — | — | docs | non |
| **Remote.co**, **JustRemote**, **Remote.io**, **Remotely.de**, **Remotify Europe**, **Remote in Europe** | HTML sans flux, US ou DE pour la plupart | — | — | — | page | non |
| **Adzuna**, **Jooble** | API avec clé gratuite, par pays, pas de filtre remote | mots-clés | FR/GB | — | docs | possible plus tard |
| **Remote Europe**, **Europe Remotely**, **Pangian**, **Jobbatical**, **Hubstaff**, **Crossover**, **Landing.jobs**, **Ladders**, **YC**, **Remote4Me**, **RemoteWoman**, **EU-Startups**, **startup.jobs**, **Oyster**, **Deel** | morts, sans flux, API interdite ou hors cible | — | — | — | — | non |

### 6.3 Welcome to the Jungle, France et Union européenne

| Source | Accès | Conditions | Vérifié | Verdict |
|---|---|---|---|---|
| **Welcome to the Jungle** | voir 6.4 | CGU du 27 avril 2026 §10 : pas de scripts ni d'extraction ; robots interdit `*/jobs?query=*` et `/*?` | page + docs | **décision d'Antoine** |
| **Station F** (tableau d'offres) | tourne sur WTTJ | idem | docs | suit WTTJ |
| **France Travail** Offres v2 | API réelle (OAuth2, `motsCles`), pas de filtre télétravail | nouvelles clés suspendues depuis au moins le 13 octobre 2026 | docs | non pour l'instant |
| **JobTeaser**, **La French Tech** (sur JobTeaser) | HTML + sitemap | — | docs | non (cible école) |
| **APEC** | DataDome, sitemaps seuls | anti-bot | docs | non |
| **HelloWork** | RSS et API interdits par robots, anti-bot | — | docs | non |
| **Monster** (API partenaire), **InfoJobs** (compte développeur), **StepStone** (écriture seule) | sur demande ou fermé | — | docs | non |
| **Indeed** (API fermée), **Glassdoor** (API coupée), **Xing**, **Cadremploi**, **EURES** | aucune voie lisible | — | docs | non |

### 6.4 Welcome to the Jungle : trois postures possibles

Le site interroge un index de recherche public (Algolia) dont l'identifiant d'application
est visible dans `/api/env` ; des tiers documentent l'index et ses facettes (`remote=fulltime`,
`contract_type`, `offices.country_code`, `published_at_timestamp`). Techniquement, un lecteur
le lirait en une requête. Mais les CGU du 27 avril 2026 (§10) interdisent scripts, robots et
extraction, et le `robots.txt` interdit les URLs de recherche : ce lecteur est **hors
conditions**, et il n'est pas proposé ici (la clé n'est pas dans ce dépôt).

1. **Demander l'accès à l'API Welcome Kit** (`developers.welcomekit.co`, `GET
   /api/v1/external/jobs?status=published`, jeton Bearer). C'est la voie officielle. Elle est
   prévue par organisation, donc l'accès pour un chercheur d'emploi dépend de leur réponse au
   formulaire « expliquez votre cas d'usage ». Recommandé : rien à perdre, et c'est la seule
   voie durable.
2. **Lire la page « emploi télétravail »** (`/fr/pages/emploi-teletravail`), rendue côté
   serveur, 20 offres préfiltrées 100 % télétravail France, sans mot-clé. Page 1 seulement
   (la pagination tombe sous `Disallow: /*?`). Signal faible, mais dans les conditions.
3. **Renoncer** et compter sur les 3 entreprises vérifiées qui y publient (section (c)).

### 6.5 Par où commencer

1. Jobgether (API, 5-6 requêtes par intitulé) et Growth.Talent (API, marché France) : deux
   `api_json` de plus, zéro code nouveau si le lecteur accepte `url_template` pour Jobgether
   comme pour LinkedIn.
2. Jobicy (API, 1 appel/h) et EU Remote Jobs (RSS) : idem.
3. Himalayas à 100 + curseur, Remotive avec `search=`, WWR sur la catégorie Sales & Marketing.
4. Welcome to the Jungle selon la réponse d'Antoine (question 4).
5. Plus tard, un lecteur `sitemap` (Dynamite Jobs, Exit Five) et un lecteur HTML (Remote.com,
   NoDesk, MKT1), chacun un petit module à part, testés sur des réponses enregistrées.

## 7. Se brancher sur le plus grand nombre de sites (relevé le 23 octobre)

Demande d'Antoine du 23 octobre : « se brancher sur plusieurs sites via des connecteurs, skills
ou autre […] sur le plus grand nombre possible ». Trois voies, vérifiées source par source
(tarifs, filtres Europe / télétravail, conditions). Les hôtes des ATS et plusieurs sites de
documentation sont fermés depuis le conteneur : « docs » = lu dans la documentation officielle,
pas appelé.

### 7.1 Ce qui couvre le plus de sites d'un coup : les agrégateurs

Un agrégateur lit à notre place des milliers de pages carrières et de boards ; une seule
requête remplace des dizaines de sources. Le radar les lit comme `api_json`, avec une clé
dans `.secrets/`.

| Agrégateur | Ce qu'il couvre | Gratuit | Payant le moins cher | Filtres Europe / remote | Lien employeur | Conditions | Vérifié |
|---|---|---|---|---|---|---|---|
| **JSearch** (OpenWeb Ninja, clé directe ou RapidAPI) | Google for Jobs : LinkedIn, Indeed, Glassdoor, ZipRecruiter et « de nombreux éditeurs » ; pas les ATS | 200 requêtes/mois, sans carte | 25 $/mois = 10 000 requêtes | `country=fr`, `work_from_home=true`, `date_posted=3days` | `apply_options[].is_direct` (souvent un board) | rien d'interdit sur la page produit ; CGU non lues | fetched (openwebninja.com) |
| **SerpApi Google Jobs** | la page Google Jobs, 10 résultats par recherche | 250 recherches/mois | 25 $/mois = 1 000 | `location`, `gl`, `hl` ; remote et date par chaînes `uds` | `apply_options[]` | page légale : pas d'interdiction d'usage personnel | fetched |
| **Jobdatalake** | 25 000 pages carrières d'entreprises (pas les boards), 1,8 M d'offres, relevé toutes les heures | 1 000 crédits à l'inscription, **1 crédit = 1 requête** (100 offres), sans expiration | 50 $ une fois = 100 000 crédits | `countries=FR,DE,…`, `remote_type=fully_remote`, `q`, `posted_after` | oui (page carrières) | CGU : pas de revente ni d'aspiration complète | fetched |
| **Apify, acteur `greentools/ats-jobs-api`** | 11 ATS (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, Recruitee, BambooHR, Personio, JazzHR, Breezy), mode « nouvelles offres seulement » | 5 $ de crédit/mois sur le plan gratuit ≈ 1 250 offres | 4 $ les 1 000 offres | mots-clés, lieux, remote / hybride, publié depuis N jours | oui (formulaire ATS) | CGU Apify : à nous d'être autorisés ; flux ATS publics, risque faible | fetched |
| **Adzuna** | son propre index par pays (boards + employeurs), 19 pays dont la France | clé gratuite, ~250 appels/jour | — | `where`, `max_days_old`, `title_only` ; **pas de filtre remote** (mot « remote » dans la requête) | non (redirection Adzuna) | CGU : **autorise explicitement la recherche d'emploi personnelle** | CGU fetched |
| **TheirStack** | sites carrières + ATS + boards dédoublonnés, 195 pays | 200 crédits/mois, 1 crédit = 1 offre | 49 $/mois | pays, `workplace_types_or`, intitulé (regex), âge | oui (`final_url`) | CGU non joignables ; cher à l'heure | fetched |
| **JobsPipe** | 30 à 39 sources dont Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Personio, Teamtailor, EURES, Remotive | 1 000 crédits une fois, 1 crédit = 1 offre | 49 $/mois = 25 000 | source, intitulé, date, remote | oui | CGU : garder le lien d'origine, pas de redistribution | fetched |
| **Fantastic.jobs** | 58 ATS + 275 000 sites carrières + LinkedIn, à l'heure | essai 14 jours (500 offres) | 45 $/mois | « 30 filtres », pays et remote non nommés sur les pages lues | oui | CGU non lues | fetched |
| **Loopcv Job Board API** | 30 sources dont LinkedIn et Indeed (aspirés par eux) | clé gratuite, limites non chiffrées | sur devis | mots-clés, lieu, date | pas garanti | docs vides | partiel |
| **Jooble** | méta-moteur mondial | clé gratuite sur formulaire | — | pas de filtre remote | non (pages Jooble) | CGU : robots interdits sur le site, API « pour les portails » : zone grise | docs |
| **Coresignal** | 482 M d'offres, entreprise | essai 7 jours | 49 $/mois = 2 500 crédits | non affichés | non affiché | orienté entreprise, démesuré | fetched |

### 7.2 Les connecteurs Claude et serveurs MCP

Un connecteur ne sert pas au radar de la VM (un script Node) : il sert à une **routine Claude**
de ce projet, qui chercherait chaque jour et déposerait ses trouvailles dans un fichier à part
(`pending_from_claude.json` dans le dossier partagé), que le cockpit fusionnerait à la relève
du tableau comme il fusionne déjà celui de la VM (`merge_pending.ts`). Aucun connecteur
officiel LinkedIn n'expose la recherche d'offres ; aucun serveur MCP natif pour Welcome to the
Jungle, APEC ou JobTeaser (seulement des aspirateurs Apify, contraires à leurs CGU).

| Connecteur / serveur | Ce qu'il lit | Europe / remote | Accès | Verdict | Vérifié |
|---|---|---|---|---|---|
| **Indeed** (annuaire claude.ai, vérifié) | base Indeed : `search_jobs` (intitulé, mots-clés, lieu, type de contrat), `get_job_details` | pays non documentés, pas de filtre remote ni date documenté : lieu en texte libre (« France », « Remote ») à essayer | OAuth avec un compte Indeed, gratuit, bêta, réservé à Claude | **à essayer** : le seul grand board accessible officiellement | docs fetched |
| **ZipRecruiter** (annuaire) | annonces ZipRecruiter, filtre remote et date | US, Canada, Royaume-Uni seulement | OAuth | non (pas la France) | fetched |
| **Dice** (annuaire) | emplois tech, filtres remote et date propres | US, tech seulement | sans compte | non (volume Europe négligeable) | fetched |
| **Crustdata** (annuaire) | base d'offres B2B, crédits | filtres pays non documentés | crédits, recherche live réservée aux plans entreprise | non | docs ; tarifs non joignables |
| **Firecrawl** (annuaire / API) | aspirateur générique (`scrape` 1 crédit la page, `search`) | n'importe quel site, dans le respect de ses CGU | 1 000 crédits/mois gratuits, 19 $/mois ensuite | utile pour **lire une page carrières d'entreprise** sans ATS (les ~548 de la liste), pas pour contourner une CGU | fetched |
| **TinyFish** (annuaire) | recherche et lecture d'URL gratuites ; agent navigateur cloud payant qui passe les protections anti-robot | — | 8 $ offerts | recherche / lecture seulement ; **l'agent navigateur ne doit pas servir** à passer un login ou un CAPTCHA | fetched |
| **open-roles-mcp** (shanto12, MIT) | API publiques Greenhouse, Lever, Ashby, Workable, entreprise par entreprise, `whats_new since 7d`, `remote`, `location: Europe` | oui ; pas les boards Lever / Greenhouse hébergés en UE, ni Workday | sans clé, à déployer soi-même sur Cloudflare Workers (gratuit) ; JSON-RPC, pas de REST | double emploi avec `radar_ats_boards.ts`, qui fait la même chose dans le radar | README fetched |
| **France Travail MCP** (davidrondello, MIT ; aussi une version PyPI) | API officielle Offres d'emploi, ROME, La Bonne Boîte, champs télétravail et salaire | France | identifiants développeur francetravail.io : **la délivrance de nouvelles clés est suspendue** (constat du 22 octobre) | à reprendre quand les clés rouvrent | README fetched |
| **Adzuna MCP** (folathecoder, MIT), **freelance-radar-mcp** (Remotive + Adzuna), **mcp-remoteok**, **job-search-mcp-servers** (Remotive, RemoteOK, Jobicy, The Muse, ATS) | API officielles ou flux publics | partiel | clés gratuites ou sans clé | le radar lit déjà ces API en direct ; un MCP n'ajoute rien côté VM | README fetched |
| **linkedin-jobs-mcp**, **go-job** | l'API invité LinkedIn (celle que le radar utilise déjà), Indeed et Google aspirés | — | — | **non** : même risque CGU que l'API invité, en pire | README fetched |
| **JobGPT** (6figr) | recherche + **candidature automatique** payante + e-mails de relance | US | compte, 35 $ les 100 candidatures | non : la candidature automatique est contraire à la posture (rien ne part sans le go) | fetched |

### 7.3 Les autres ATS des 616 entreprises vérifiées

Relevé des hôtes dans `careers_url` (22 octobre) : LinkedIn 36, Workable 8, Lever 5, Ashby 4,
Himalayas 4, Welcome to the Jungle 3, Greenhouse 3, Recruitee 2, SmartRecruiters 2, Workday 1 ;
les ~548 autres sont des pages carrières maison (dont une partie cache sûrement un ATS sur un
domaine propre : à recompter en suivant les redirections).

| ATS | Point d'accès public sans clé | Pagination | Champ remote | Vérifié |
|---|---|---|---|---|
| **Workable** (8) | `GET https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true` | non (tout le board) | `location.telecommuting`, `workplace_type` | docs |
| **Recruitee** (2) | `GET https://{company}.recruitee.com/api/offers/` | non | `remote`, `hybrid`, `on_site` | docs |
| **SmartRecruiters** (2) | `GET https://api.smartrecruiters.com/v1/companies/{company}/postings` puis `/postings/{id}` pour la description et `applyUrl` | `limit` / `offset`, `totalFound` | `location.remote` | docs |
| **Workday** (1) | `POST https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` `{"limit":20,"offset":0}` puis le détail par `externalPath` | `offset` par 20 | `remoteType` dans le détail seulement | docs (tiers) ; non documenté par Workday |
| Teamtailor | `GET https://{site}/jobs.rss?per_page=200` | `offset` | « remote status » | docs |
| Personio | `GET https://{company}.jobs.personio.com/xml` (si activé) | non | `office` texte seulement | docs |
| Pinpoint, Gem, Polymer, Breezy, BambooHR | `postings.json`, `job_board/v0/{board}/job_posts/`, `api.polymer.co/v1/hire/organizations/{slug}/jobs`, `/json`, `/careers/list` | variable | `workplace_type` / `is_remote` | docs ; 0 hôte aujourd'hui |
| Welcome to the Jungle (3) | aucun point d'accès par organisation ; voir 6.4 | — | — | docs |
| Comeet, HiBob, Homerun, JazzHR, Jobvite, Dover, softgarden, iCIMS, Taleo, SuccessFactors | clé client ou HTML seulement | — | — | docs : rien de public |

Ce que le dépôt fournit : `radar_ats_boards.ts` étendu à Workable, Recruitee et SmartRecruiters
(formes d'après la documentation, à confirmer sur une vraie réponse depuis la VM), avec
réponses d'exemple et tests.

### 7.4 Plan proposé, par rendement et par coût

| Étape | Quoi | Sites couverts en plus | Coût | Code |
|---|---|---|---|---|
| 1 | **Jobdatalake** (`countries=FR,DE,NL,ES,IT,PT,GB&remote_type=fully_remote&q=…`, un relevé par heure) | 25 000 pages carrières d'entreprises | 0 € (1 000 requêtes offertes), puis 50 $ une fois pour des années | `api_json` + clé |
| 2 | **JSearch** gratuit (`country=fr&work_from_home=true&date_posted=3days`, 2 ou 3 relevés par jour, pas à l'heure) | Google for Jobs : LinkedIn, Indeed, Glassdoor, ZipRecruiter… | 0 € (200 requêtes/mois) ; 25 $/mois si on veut l'heure | `api_json` + clé |
| 3 | **Adzuna** (`fr`, `de`, `gb`, `nl`, `es`, `it`, `max_days_old=1`, mot « remote ») | l'index Adzuna par pays | 0 € | `api_json` + clé |
| 4 | **Apify `ats-jobs-api`** en mode nouvelles offres, une fois par jour | 11 ATS d'un coup, sans tenir la liste des entreprises | 0 € dans les 5 $ mensuels offerts | `api_json` + jeton |
| 5 | **Workable, Recruitee, SmartRecruiters** dans `radar_ats_boards.ts` | 12 entreprises de la liste, à la source | 0 € | fourni |
| 6 | **Routine Claude + connecteur Indeed** (à essayer sur « France » + « remote ») | Indeed | 0 € | routine dans ce projet, fichier fusionné par le cockpit |
| 7 | Les sources de la section 6 (Jobgether, Growth.Talent, Jobicy, EU Remote Jobs) | boards growth et full remote | 0 € | `api_json` / `rss_feed` |

Au total, pour 0 € par mois : Google for Jobs 2 à 3 fois par jour, 25 000 pages carrières à
l'heure, 11 ATS par jour, Adzuna par pays, Indeed par la routine, plus les boards spécialisés.
Pour 25 $/mois (JSearch Pro), Google for Jobs passe à l'heure. Les agrégateurs à 45 à 50 $/mois
(TheirStack, JobsPipe, Fantastic.jobs, Coresignal) n'apportent pas assez de plus pour ce
profil ; leurs crédits gratuits (comptés par offre) servent tout au plus à un rattrapage
ponctuel.

Ce qui change dans le radar pour tout cela : un lecteur `api_json` qui accepte une clé lue
dans `.secrets/` (en-tête ou paramètre), le dédoublonnage par lien et par (entreprise,
intitulé) déjà décrit en 3 (a), et le respect des cadences (le lecteur garde la date du
dernier appel par source). Rien n'est touché sur la VM tant qu'Antoine n'a pas choisi.

### 7.5 Questions pour Antoine

6. Budget mensuel pour les sources : 0 € (gratuits seulement), ou 25 $ (Google for Jobs à
   l'heure) ?
7. Connecter ton compte Indeed au projet pour la routine Claude ? (carte « Connecter » dans le
   fil.)
8. Les clés (Jobdatalake, JSearch, Adzuna, Apify) : créées par toi, déposées dans `.secrets/`
   de la VM ; je ne les vois jamais.

