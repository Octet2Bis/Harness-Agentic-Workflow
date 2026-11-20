# Système `career-radar`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Le radar d'offres côté PC : trois scripts, aucun modèle. Il interroge les sources d'offres du
candidat, crible les offres brutes de façon déterministe et ajoute les nouvelles au tableau
`pending_gold_jobs.json` en `PENDING_VALIDATION`, que le cockpit affiche et que
`career-triage` trie ensuite. Le radar de la VM (`live_job_scraper.js`, Telegram) continue en
parallèle : rien n'y change, ses offres arrivent par la fusion PC ⇄ VM existante
(`merge_pending.ts`).

```
collect ──▶ screen (when go) ──▶ record (all_done)
 │            │                    │
 │            │                    └ pending_gold_jobs.json (sous verrou, ajout seul), last_radar_report.json, radar_log.jsonl
 │            └ radar/qualified.json, radar/rejected.json (artefacts du run)
 └ job_sources.json (ou le défaut du système), career_taxonomy.json, tableau (liens connus) → radar/raw.json
```

- **`collect`** : lit `<career_dir>/job_sources.json` (sinon `job_sources.default.json` du
  système, la 2.1.0 de Master Plan, et le dit), `career_taxonomy.json` (obligatoire : requêtes
  cibles, étiquettes de séniorité) et le tableau (liens connus, pour que LinkedIn ne relise pas
  des annonces vues) ; appelle les connecteurs de Master Plan (`fetchAllActiveSources`,
  `systems/.shared/radar/fetchers/`) ; écrit `radar/raw.json` dans les artefacts du run. Une
  source absente de `job_sources.json` ne tourne pas (sur la VM elle tournerait avec son adresse
  par défaut). `offre_age_max_jours` de `<career_dir>/criteres.json` (7 par défaut) va aux
  filtres de fraîcheur des sources qui en ont un, qu'il ne fait que resserrer, sans changer le
  nombre d'appels : Adzuna `max_days_old` (1 par défaut), Apify `postedWithinDays` (2),
  Jobdatalake `{since_ms}` (48 h). LinkedIn (`f_TPR` 24 h), JSearch (`date_posted=3days`) et les
  sources filtrées à 48 h côté client (Himalayas, Jobicy, Remotive, RSS…) restent plus strictes ;
  Himalayas et Jobicy n'ont pas de paramètre de date.
- **`screen`** (pur, `.shared/radar.ts` `screenJobs`) : d'abord l'entreprise contre le lien
  (`.shared/company-link.ts`) : un lien LinkedIn `…-at-<entreprise>-<id>` qui nomme un autre
  employeur fait refuser l'offre (« entreprise incohérente avec le lien : … ») ; un identifiant
  d'ATS qui ne se concilie pas (souvent une abréviation) la laisse passer, la raison dans
  `company_link_check`. Puis doublons entre offres brutes (lien en
  minuscules, puis entreprise|titre), offres déjà au tableau (lien ou id), offres publiées il y
  a plus de `offre_age_max_jours` jours (`criteres.json` du dossier carrière, **7 par défaut**,
  0 coupe la règle ; raison « offre trop ancienne (publiée le 2026-10-12, > 7 jours) » ; date
  lue par `blocks/.shared/offer-date.ts` : ISO, epoch s / ms, RFC 2822, « 3 days ago », « il y a
  3 jours »… ; sans date lisible, l'offre est gardée), jury des trois
  inspecteurs de Master Plan (`systems/.shared/radar/inspectors/` : langue FR/EN, télétravail,
  séniorité 1–3 ans et domaine) avec la taxonomie du candidat, score ≥ 75 — le seuil de la VM.
  Chaque refus garde sa raison (`radar/rejected.json`). L'objet retenu a la forme de la VM
  (`slug`, `match_score`, `tier`, `is_startup`, `jury_verdict`, `status: PENDING_VALIDATION`) ;
  `enrichDecisionMaker` (décideur cible) n'est pas repris : pas de `target_role`. Une date
  lisible mais pas en `AAAA-MM-JJ` (relative, RFC 2822, epoch) part au tableau en `AAAA-MM-JJ`
  (une date relative y vieillirait), la forme de la source dans `date_published_raw`.
- **`record`** : sous le verrou du tableau (`pending_gold_jobs.json.lock`, le même que
  `claim`, `close`, `settle`, `record` de career-apply et `merge_pending.ts`), ajoute les offres
  qualifiées qui n'y sont pas (lien ou id). **Les lignes existantes ne sont ni réécrites ni
  réordonnées** ; `index` continue après le plus grand existant (la VM, elle, ré-indexe tout le
  tableau par score et coupe à 25 offres fraîches : pas ici). Un tableau absent est créé. Écrit
  `<career_dir>/last_radar_report.json` et ajoute une ligne à `<career_dir>/radar_log.jsonl`,
  même quand rien n'a qualifié. `ok` ne tombe que sur une vraie panne : collecte en échec,
  tableau illisible, verrou qui ne se libère pas (40 s) ; rien n'est alors écrit au tableau.

```json
{
  "at": "2026-10-23T20:00:00.000Z", "run_id": "…", "ok": true,
  "sources": [{ "name": "Jobicy (jobicy.com)", "status": 200, "count": 4, "duration_ms": 120 }],
  "sources_ok": 1, "sources_failed": 0, "sources_waiting": 0,
  "raw_count": 4, "qualified_count": 2, "added": 1, "added_slugs": ["acme_sas"], "skipped": 1,
  "rejected_count": 2, "summary": "1 offer(s) added to the board (12 row(s) now), 1 already there : …"
}
```

## Les sources : `job_sources.json`

Par candidat : `<career_dir>/job_sources.json` (même forme que sur la VM : `{ version, sources:
[{ name, type, endpoint | url_template, enabled, min_interval_min, key, … }] }`). Sans lui, le
système lit `career-radar/job_sources.default.json` (2.2.0 : Himalayas, Working Nomads,
RemoteOK, Remotive, Arbeitnow, Jobspresso, WeWorkRemotely, Jobgether, Growth.Talent, Jobicy,
EU Remote Jobs, WTTJ télétravail, Jobdatalake, Apify ATS, Adzuna, Freehire, Workable search, Tableaux employeurs ; Firecrawl et JSearch
`enabled: false`). Pour le surcharger : copier le fichier par défaut dans le dossier carrière et
l'éditer. L'entrée `sources` du système (noms séparés par des virgules, inclusion insensible à la
casse : `adzuna,jobicy`) ne fait tourner que celles-là pour ce run.

**Cadence** : une source dotée de `min_interval_min` n'est rappelée qu'une fois l'intervalle
écoulé ; l'horodatage vit dans `<career_dir>/source_state.json` (jamais de secret dedans) et
est posé même si l'appel échoue. Un run toutes les 15 min peut donc rendre « attente (prochain
appel dans N min) » pour la plupart des sources : c'est normal, `sources_waiting` les compte.

**Tableaux employeurs** (`fetchers/ats_boards.js`) lit directement les tableaux publics
Greenhouse, Lever et Ashby des entreprises, sans clé. La liste des tableaux (Feashliaa/job-board-aggregator,
CC BY-NC 4.0, usage personnel) est téléchargée dans `<career_dir>/radar_universe.json` et rafraîchie
tous les 7 jours (`refresh_days`). Chaque passage lit `boards_per_cycle` (240) tableaux de l'univers
(curseur `ats_universe_cursor` de `source_state.json`), plus jusqu'à `learned_max` (80) tableaux où
un poste du métier est déjà apparu (`radar_boards_learned.json`) et les tableaux épinglés (`boards`
de l'entrée, ou `<career_dir>/next40_boards.json`, sinon la liste Next40/120 du système `.shared/radar/next40_boards.json`, même forme `{ greenhouse: [], lever: [], ashby: [] }`).
Gardés : postes remote (drapeau de l'ATS, ou « remote » dans la localisation Greenhouse), titre du
métier, publiés depuis 7 jours au plus (`offre_age_max_jours`). `concurrency` (6) requêtes à la fois.

**Freehire** et **Workable search** (`fetchers/extra_fetchers.js`) : verdicts, conditions d'usage
et sources écartées (Station F) dans `.shared/radar/fetchers/EXTRA_SOURCES.md`.

**Adzuna** lit ses options dans son entrée (défauts entre parenthèses) :
`countries` (`["fr","gb","de","nl","es","it"]`), `queries_max` (1 : ≈ 72 appels / jour ; le
quota de 250 / jour est partagé entre candidats), `match` (`what` ; `what_phrase` = expression
exacte), `where` ('' = tout le pays ; une chaîne ou une liste de lieux en clair, un appel par
lieu), `remote_suffix` (true : ajoute « remote » à la requête ; false pour un candidat sur
site), `max_days_old` (1), `sort_by` (`date`), `exclude_titles`
(`alternance, apprenti, stage, stagiaire, service civique, internship`, sur le titre, casse
ignorée), `results_per_page` (50). Les balises `<strong>` des titres sont retirées, une
`redirect_url` non https est ignorée, `salary_range` porte « (estimé par Adzuna) » quand
`salary_is_predicted` vaut `"1"`, et `remote_declared` reste false (l'auditeur cherche le mot).
Plafond : 12 appels par cycle.

**Requêtes des sources par mot-clé** (Adzuna, Jobgether, JSearch, et Jobdatalake quand son
adresse porte `{keyword}`) : `source_queries` de la taxonomie (liste par priorité, en anglais
de préférence) ; sans elle, pour Antoine (taxonomie sans `core_domains`), ses intitulés cœur
en anglais (`DEFAULT_SOURCE_QUERIES` de `radar/fetchers/query_picker.js` : growth marketing
manager, product operations, crm manager, marketing automation, email marketing, lifecycle
marketing, revops) ; pour un autre candidat, ses `search_queries`. Chaque source avance son
curseur (`query_cursor` de `source_state.json`) du nombre de requêtes qu'elle consomme : une
requête différente à chaque cycle, même nombre d'appels (Adzuna : 6 pays × `queries_max` 1,
toutes les 120 min, ≈ 72 appels / jour, plafond testé à 100). Avant le 2026-10-23, ces sources
prenaient toujours les premières `search_queries`, souvent en français (« chargé de revops ») :
Adzuna rendait 0 offre. Le filtre de pertinence (`matchesAnyTargetQuery`) accepte les deux
listes ; ses mots cœur par défaut comprennent `product ops`, `email`, `retention`, `hubspot`,
`martech`, et une requête aux mots courts (« crm manager », « chargé de revops ») correspond
enfin (avant, tout mot de 3 lettres ou moins la rendait impossible).

**Description complète** : les connecteurs qui reçoivent le texte entier de l'annonce
(Himalayas, Working Nomads, RemoteOK, Remotive, Arbeitnow, Jobicy, flux RSS, JSearch, Apify)
le gardent dans `description_full` (HTML retiré, 15 000 caractères au plus), à côté du résumé
`description` (400 caractères, seul lu par le jury : parité VM) ; Apify garde aussi la page de
l'annonce (`posting_url`) quand elle diffère du lien de candidature. `career-triage` les lit
quand la page de l'offre ne se laisse pas lire. L'état d'Apify ne réécrit plus que ses propres
clés de `source_state.json` (avant, son instantané effaçait les horodatages posés pendant le
cycle, et Adzuna était rappelé à chaque run).

**LinkedIn** : désactivé sur le PC. L'entrée reste dans la 2.1.0 mais le connecteur n'est
appelé que si la variable d'environnement `CAREER_LINKEDIN=on` est posée en plus (décision
d'Antoine du 29/09 : l'endpoint invité sous User-Agent de navigateur est contraire aux CGU).
Le radar de la VM, lui, le lit. Jusqu'au 2026-10-24, `parseCards` appariait par rang cinq listes
extraites séparément (titres, entreprises, liens, dates, lieux) : une carte sans l'un des éléments
décalait les suivantes, et des offres sont arrivées au tableau avec l'entreprise d'une annonce et
le lien d'une autre. Chaque champ se lit maintenant dans sa carte (`linkedin_fetcher.test.ts`) ; la
copie de Master Plan sur la VM (`career_ops/fetchers/linkedin_fetcher.js`) attend le même correctif.

## Un autre candidat : `career_taxonomy.json`

Le jury est celui d'Antoine (télétravail exigé, domaine growth / marketing, 1–3 ans) tant que la
taxonomie du candidat ne dit pas autre chose. Deux clés la font changer, sans rien changer pour
Antoine quand elles sont absentes :

- `core_domains` : les mots de domaine du candidat, cherchés dans le titre (par exemple
  `["bénévole", "événementiel", "sport"]`). Ils remplacent ceux d'Antoine dans le filtre de
  pertinence des connecteurs (`matchesAnyTargetQuery`) et dans le calibreur de séniorité.
- `source_queries` : les requêtes des sources par mot-clé (voir plus haut) ; sans elle, ses
  `search_queries` (un candidat avec `core_domains`) ou les intitulés cœur d'Antoine.
- `remote_policy` : `full` (défaut : l'auditeur télétravail écarte le présentiel et l'hybride) ou
  `indifferent` (l'auditeur ne juge pas ; le verdict le dit). Le mode de travail se règle ensuite
  au tri Opus (`remote` de `criteres.json`).

Pour un candidat sur site, mettre aussi `remote_suffix: false` et `match: "what_phrase"` dans son
entrée Adzuna de `job_sources.json`. `country_params` ajoute des paramètres Adzuna à un pays
seulement : `{"gb": {"contract": "1"}}` ne garde que les contrats à durée déterminée au Royaume-Uni
(2e candidate : à l'étranger, missions en CDD seulement), les autres pays inchangés.

## Les clés : la chaîne d'environnement

Les clés d'API (`JOBDATALAKE_API_KEY`, `APIFY_TOKEN`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
`JSEARCH_API_KEY`, `FIRECRAWL_API_KEY`) sont lues **par nom de variable**, dans l'ordre
(`.shared/radar-env.ts`, `resolveKeys` de `radar/fetchers/index.js`) :

1. `process.env` ;
2. l'entrée `env_file` quand elle est donnée (elle remplace la chaîne ci-dessous) ;
3. `<dépôt>/.local/secrets.env` (`.local/` n'est jamais versionné) ;
4. `<career_dir>/../../.secrets/.env` — la disposition de Master Plan
   (`02_Assistant_Personnel/Workspace/career` → `02_Assistant_Personnel/.secrets/.env`),
   celle d'Antoine seulement.

Une clé absente donne à sa source le statut « clé absente (NOM) », visible dans le rapport.
Aucune valeur de clé, aucun chemin de fichier d'env ne sort dans les sorties des nœuds, les
artefacts ni le rapport (seul le nombre de fichiers lus est dit).

## Lancer

```bash
archon workflow run career-radar --cwd C:\chemin\vers\Harness-Agentic-Workflow --folder \
  --input career_dir='C:\chemin\vers\career'
# une ou deux sources seulement :      --input sources=adzuna,jobicy
# un fichier de clés particulier :     --input env_file='C:\…\secrets.env'
```

Entrées : `career_dir` (obligatoire), `sources` (défaut `""` = toutes les sources actives),
`env_file` (défaut `""` = la chaîne ci-dessus) ; `fetch_module` ne sert qu'aux tests (faux
réseau), à laisser vide. Issue : `record` (`ok`, `summary`, `added`, `skipped`,
`report_path`). Le cockpit lance ce run (une collecte dure de quelques secondes à une minute,
selon les sources) et lit `<career_dir>/last_radar_report.json` ; `mutates_checkout: false` :
il peut tourner pendant un tri ou une candidature, le tableau est protégé par son propre verrou.

## Ce qui n'est pas fait

- Pas d'alerte Telegram (le radar de la VM les envoie), pas de `processed_jobs.json`, pas de
  `decision_maker_scout` ni de `remote_company_indexer`.
- Pas de LinkedIn par défaut (`CAREER_LINKEDIN=on` pour l'activer), pas de Firecrawl ni de
  JSearch tant que leur entrée est `enabled: false`.
- La VM n'est pas touchée : ni son code, ni son `job_sources.json`, ni sa cadence. Une offre
  trouvée des deux côtés n'entre qu'une fois (lien ou id ; la fusion PC ⇄ VM, elle, raisonne par
  slug : une même entreprise peut avoir deux offres).
- Les 15 requêtes supplémentaires de la taxonomie restent une donnée du candidat
  (`career_taxonomy.json`), pas du système.

## Vérifier

`scripts/verify-block.sh career-radar` — fixtures `idle`, `added`, `all-rejected`
(les trois nœuds lisent le réseau ou le disque : stubbés, `# sans-attendu`), `collect-failed`
(`record` tourne pour de vrai sur un dossier carrière absent : `ok=false added=0 skipped=0`,
rapport non écrit). Le crible, l'ajout sans réécriture, le bilan des sources et le rapport sont
testés dans `systems/.shared/radar.test.ts` ; la chaîne d'env dans `radar-env.test.ts` ; les
connecteurs, le jury, les options Adzuna, la lecture des clés par nom et la cadence dans
`systems/.shared/radar/fetchers/*.test.js` (les tests `node:test` de Master Plan, que `bun test`
exécute tels quels) ; `scripts/{collect,screen,record}.test.ts` lancent les trois scripts pour
de vrai sur un dossier carrière temporaire avec un faux réseau (jamais le réseau).
