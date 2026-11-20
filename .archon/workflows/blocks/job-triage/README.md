# Bloc `job-triage`

Statut : voir `blocks/REGISTRY.md`.

Trie une offre captée par le radar contre les critères du candidat, avant qu'il ne la voie :
une offre rédigée dans une langue qu'il ne parle pas, qui exige une langue qu'il ne parle pas
(l'italien chez Smartness), dont le salaire annuel maximal est sous son seuil (35 000 €), ou
qui n'est pas en télétravail complet (hybride, sur site : le poste de Neo Psychiko chez Push
Greece), ou, quand `experience_max_annees` est donné, qui exige plus d'années d'expérience que
le candidat n'en a (« Minimum 7 ans d'expérience » chez Inqom pour un profil de 1 à 3 ans) ou
porte un intitulé senior, ou qui a été publiée il y a plus de `offre_age_max_jours` jours
(7 par défaut : une semaine au plus, règle d'Antoine du 2026-10-23), ou dont le cœur du poste
n'est pas dans le profil du candidat (deux des trois exigences centrales absentes de
`master_profile.md` : l'achat média payant à gros volume et SQL / Python chez Melotech), est
écartée, avec la raison et la citation de l'annonce ; une offre
sans salaire, sans mode de travail précisé, « profil senior » dans le corps seulement, ou lue
en partie reste « à vérifier », jamais écartée en silence ni retenue sans preuve.

```
offer + criteres.json + posting.txt (+ profile.md, facultatif)
   │
   ▼
produce (2 tours max) : work (Sonnet, extrait avec citations) ──▶ triage.json ──▶ check (code)
   │   check : citations mot pour mot dans l'annonce (et dans le profil) ; balayage des langues
   │   nommées près d'un mot d'exigence, des montants avec devise, des mots « hybrid » /
   │   « on-site » / « présentiel » et des mois au bureau à l'intégration (detectWorkMode,
   │   officePeriodMarkers) et des « N ans d'expérience » (scanExperienceYears) ; labels senior
   │   dans l'intitulé de l'offre (seniorityLabelsIn) ; cœur du poste (checkCoreFit) ; puis
   │   décision par la règle (decision.json)
   ▼
judge (Sonnet, contexte vierge, lecture seule) : la lecture de l'annonce et du profil est-elle juste ?
   ▼
verdict { ok, status, decision, reasons, notes } — décision rendue seulement si verified
```

| Acteur du reel | Ici |
|---|---|
| L'agent | `work` (model `medium` : Sonnet) : langues exigées / souhaitées / hors sujet, salaire tel qu'écrit, mode de travail, expérience exigée (années, label), critères libres, les trois exigences centrales et leur appui dans le profil, chacun avec sa citation |
| Le code | `check` + `.shared/triage-checks.ts` : citations (annonce et profil), balayage, langue de l'annonce par ses mots-outils (`detectLanguage`), marqueurs hybride / sur site / télétravail et présence au bureau pour une période (`detectWorkMode`, `officePeriodMarkers`), années d'expérience FR / EN (`scanExperienceYears`), labels senior de l'intitulé (`seniorityLabelsIn`), cœur du poste (`checkCoreFit`), conversion (période × taux), décision |
| Le juge | `judge` (model `medium` : Sonnet) : exigence manquée, « a plus » lu comme exigé, mensuel lu comme annuel, bureau lu comme télétravail, sept ans lus comme deux, exigence secondaire prise pour le cœur du poste, appui du profil inventé ou ignoré… ; il vérifie la lecture, pas l'issue |
| Le badge | `verdict` : la décision n'existe que si le juge approuve |

## Contrat

- Entrées : `offer` (JSON ; `date_published` et `radar_at` portent la date de la ligne du
  tableau et le moment où le radar l'a lue, pour la règle d'âge), `criteria` (contenu de `criteres.json`), `posting` (fichier des
  artefacts, défaut `posting.txt`), `posting_full` (`"false"` : seul le résumé du radar a été
  lu ; l'offre peut être écartée sur ce qui a été lu, jamais retenue), `profile` (fichier des
  artefacts : le profil maître du candidat, `master_profile.md` en texte ; défaut vide : le cœur
  du poste n'est pas évalué, une note le dit), `out` (défaut `triage.json`).
- Sortie : `{ ok, status: verified|rejected|unconverged, decision: ecartee|a_verifier|retenue|"",
  reasons, notes, summary, problems, findings, deliverable }`, et `decision.json` (décision,
  salaire annuel en euros, langues exigées) dans les artefacts.

## criteres.json (dans le dossier carrière du candidat)

```json
{
  "langues": ["fr", "en"],
  "salaire_min_annuel": 35000,
  "salaire_inconnu": "a_verifier",
  "taux_eur": { "USD": 0.92 },
  "remote": "full",
  "experience_max_annees": 3,
  "experience_labels_exclus": ["senior", "lead", "head of", "director", "directeur", "directrice", "principal", "staff", "vp", "chief"],
  "offre_age_max_jours": 7,
  "zone_embauche": "europe",
  "exclure": ["call center"]
}
```

`zone_embauche` (facultatif ; `monde` par défaut, règle coupée) : `europe` (règle d'Antoine du
2026-10-25, Royaume-Uni et Irlande compris) oblige l'agent à relever `hiring_zone` (`open`,
`closed` ou `not_stated`, avec la phrase de l'annonce) ; `closed` (« US only », « must reside in
the United States », « LATAM ») écarte l'offre, `not_stated` ne fait qu'une note. Le siège de
l'employeur ou une ville des champs du radar ne disent pas où il embauche ; le juge vérifie la
lecture. Le radar écartait déjà, sans modèle, une localisation qui ne nomme que des pays hors
Europe (`remote_auditor.evaluateTerritory`) ; cette règle attrape les « Remote » sans pays.

`langues` : codes ISO 639-1 parlés ; une annonce rédigée dans une autre langue est écartée
(langue déclarée par l'agent avec une phrase citée, recoupée par le code quand le texte est
assez long pour trancher, puis par le juge). `salaire_min_annuel` : brut annuel en euros (0 coupe la
règle) ; c'est le haut de la fourchette qui compte (30–40 k€ reste). Conversion : mois ×12,
semaine ×52, jour ×218, heure ×1 607, devise par `taux_eur` (taux par défaut dans
`DEFAULT_RATES`). `salaire_inconnu` : `a_verifier` (défaut), `garder` ou `ecarter`. `remote` :
`full` (défaut quand la clé manque : le radar part d'un candidat 100 % télétravail), `hybride_ok`
ou `indifferent` ; l'agent déclare le mode de travail de l'annonce (`work_mode` :
`full_remote`, `hybrid`, `on_site`, `not_stated`) avec la phrase citée, le code vérifie la
citation et balaie l'annonce (un mot « hybrid », « on-site », « présentiel », « relocation »…
sans phrase explicite de télétravail complet interdit `full_remote` ; tout marqueur interdit
`not_stated`), puis la règle tranche : avec `full`, hybride ou sur site écarte (« Poste non
100 % télétravail (hybride) : « … » ») et non précisé laisse « à vérifier » (« Mode de travail
non précisé dans l'annonce ») ; avec `hybride_ok`, seul le sur site écarte ; avec `indifferent`,
aucune règle. Exception au « non précisé » (2026-10-23) : une offre venue d'une plateforme qui
ne publie que du télétravail complet (`REMOTE_ONLY_SOURCES` : Himalayas, Jobicy,
WeWorkRemotely, RemoteOK, Remotive, Working Nomads, Jobspresso, EU Remote Jobs, la page
télétravail de Welcome to the Jungle ; `source` du JSON de l'offre, sinon la ligne « Source : »
des champs du radar) dont l'annonce ne contient aucun marqueur hybride ou sur site compte pour
du télétravail complet, et la raison le dit (« Télétravail d'après la source Himalayas
(plateforme 100 % télétravail ; … ) ») ; une mention hybride ou de jours au bureau écarte
toujours. Quand l'agent écrit `not_stated` (ou `full_remote`) contre un marqueur, le problème lui
rend la phrase qui le porte (`markerSentence`, texte normalisé, citable tel quel) : « work_mode
is "not_stated" but the posting says "full remote" in "we are a full remote company…" ».
`experience_max_annees` (entier, facultatif ; absent ou 0 : règle coupée, rien ne
change) : les années d'expérience qu'une annonce peut exiger au plus (1 à 3 ans d'expérience :
3). L'agent déclare `experience` (`years_min`, `years_max`, `seniority_label`, `quote`, et
`ignored` pour les années qui ne sont pas une exigence : « nous avons 10 ans d'expérience du
marché ») ; le code vérifie la citation, qu'elle porte les nombres et le label, balaie
l'annonce (`scanExperienceYears` : « 7 ans d'expérience », « minimum 5 years », « 5+ years
in », « 3 à 5 ans », « at least 4 years' experience », nombres en lettres ; pas « 7 ans
d'existence », « 2024 », « +33 6 … », « depuis 10 ans », « CDD de 2 ans ») et renvoie l'agent
sur une exigence oubliée ; puis la règle tranche sur la borne basse : `years_min` >
`experience_max_annees` écarte (« Exige 7 ans d'expérience (max 3) : « … » »), dans la limite
une note, non précisé aucun effet. `experience_labels_exclus` (facultatif ; par défaut
`DEFAULT_SENIORITY_LABELS` — senior, lead, head of, director, directeur, directrice, principal,
staff, vp, chief — quand `experience_max_annees` est donné, sinon vide) : un de ces mots, entier,
dans l'**intitulé** de l'offre (`title` du JSON de l'offre, sinon la ligne « Poste : » des champs
du radar) écarte (« Intitulé de poste senior (« senior », max 3 ans d'expérience) : « … » ») ;
« lead generation » et « staff accountant » ne comptent pas ; le même mot dans le **corps**
(« profil senior », relevé par l'agent en `seniority_label`) ne fait qu'un « à vérifier »
(« reporting to a senior manager » n'est pas un label du poste : l'agent laisse null, le juge
vérifie). `offre_age_max_jours` (entier, facultatif ; **7 quand la clé manque**, 0 coupe la
règle) : une offre dont la date de publication (`date_published` de la ligne du tableau, passée
dans le JSON de l'offre) a plus de N jours de calendrier est écartée par le code seul, sans
citation à vérifier (« offre trop ancienne (publiée le 2026-10-12, > 7 jours) ») ; publiée le 16
pour un tri le 23 : 7 jours, gardée. Formes lues (`.shared/offer-date.ts`, `parseOfferDate`) :
ISO, epoch en secondes ou millisecondes, RFC 2822 des flux RSS, « 3 days ago », « il y a 3
jours », « hier »… ; une date relative se compte depuis la lecture du radar (`radar_at`). Date
absente ou illisible : aucun effet (rien d'inventé) ; date lisible dans la limite : une note
(« Publiée le 2026-10-20 (3 jours, max 7) »). Le radar du PC (`career-radar`) applique la même
règle, avec la même clé, avant d'ajouter une offre au tableau. `exclure` est lu par l'agent et vérifié par le juge ; non rempli, il laisse l'offre
« à vérifier », il ne l'écarte pas.

## Cœur du poste contre le profil (2026-10-24)

Un CV Melotech « Founding Growth Manager » a été refusé deux fois par le juge Opus de
`cv-tailor` : le cœur du poste (2 à 7 ans d'achat média payant à gros volume sur Meta / TikTok /
Snapchat, SQL / Python) n'est pas dans le profil, et le tri l'avait « retenue » parce qu'il ne
lisait que langues, télétravail, salaire et années. Quand `profile` est donné, l'agent relève
`core_requirements` : exactement **trois** exigences centrales (pas une langue, le salaire, le
mode de travail ni un savoir-être), chacune `{ requirement, quote, backing, profile_quote }` :

- `quote` : mot pour mot dans l'annonce, hors champs du radar ; trois citations distinctes ;
- `backing` : `backed` (le profil l'établit au niveau demandé), `partial` (proche mais plus
  léger), `missing` (rien) ;
- `profile_quote` : mot pour mot dans le profil pour `backed` et `partial` (casse, espaces et
  marques Markdown `**`, `` ` ``, titres, puces mis à part : `normalizeProfile`), vide pour `missing`.

Le code vérifie tout cela (`checkCoreFit`) ; la règle tranche : **deux `missing` ou plus →
écartée** « Cœur du poste hors profil : <req1> ; <req2> » ; **un seul → note** « À renforcer :
<req> », décision inchangée ; toujours une note « Cœur du poste : N exigences étayées, N en
partie, N absentes du profil, sur 3 ». Sans profil : rien n'est demandé ni vérifié, note
« Adéquation au cœur du poste non évaluée : profil du candidat non fourni ». Le juge vérifie
que les trois exigences sont bien le cœur de l'annonce et que chaque `backing` est fidèle au
profil (un `missing` que le profil étaye ferait perdre une bonne offre) ; il ne décide pas l'issue.

## Présence au bureau pour une période (2026-10-24)

Bending Spoons était passée en « Mode de travail non précisé » alors que « for the first few
months, new hires spend most days at the Milan office ». `officePeriodMarkers` (dans
`detectWorkMode`, compris dans les marqueurs sur site) lit ces formes : « most days / N days
at the <ville> office », « first (few) weeks / months … office / on-site / in person »,
« onboarding … office », « in-person onboarding », « les premiers mois … au bureau », « période
d'intégration … sur site » ; une phrase qui dit la présence facultative (« optional »,
« if you wish », « remote onboarding », « no office ») ne compte pas. Un tel passage interdit
`not_stated` et `full_remote`, **même à côté d'un « fully remote » ailleurs dans l'annonce** :
l'agent doit écrire `hybrid` (ou `on_site`), donc écartée avec `remote: full`, et une
plateforme 100 % télétravail ne le couvre pas.

## Coût (mode économe, 2026-10-24)

Aucun appel Opus : `work` et `judge` au palier `medium` (Sonnet ; Haiku recollait des citations du profil lors du premier essai réel),
2 tours au plus (`max_iterations: 2`). Par offre triée : **2 appels de modèle** (un tour
d'extraction, un juge) quand la première extraction passe les contrôles ; **3 au plus** (un
second tour, puis le juge) ; **2** aussi quand la boucle ne converge pas (deux tours, juge
sauté, `unconverged`). Avant : jusqu'à 4 appels Opus (3 tours + juge). Les offres trop
anciennes et les annonces illisibles n'arrivent pas ici (`career-triage` les tranche sans
modèle). Le palier se change par run :
`archon workflow run career-triage --model medium=claude/haiku …`.

## Limites

- Une annonce sans texte (page fermée, radar sans description) n'arrive pas ici : l'appelant
  (`career-triage`) la classe « Annonce illisible » sans lancer le bloc, qui exige une phrase
  de 60 caractères pour la langue de l'annonce et resterait `unconverged`.
- Le seuil de salaire et les langues sont tranchés par du code ; la lecture de l'annonce
  (exigé ou souhaité, salaire de base ou variable) reste celle de deux modèles, d'où le juge.
- Le cœur du poste : le code prouve que les citations existent, pas que les trois exigences
  sont les bonnes ni qu'un `partial` n'est pas un `missing` ; c'est la part du juge.
- Le balayage connaît une trentaine de langues, nommées en anglais, français, italien,
  espagnol, allemand, portugais, néerlandais et polonais ; une langue nommée autrement passe
  par le seul juge.
- Le balayage du mode de travail ne lit que des mots (`ON_SITE_MARKERS`, `REMOTE_MARKERS`) : une
  annonce qui ne donne qu'une ville (Neo Psychiko) sans mot de bureau passe par l'agent, qui
  doit alors écrire `not_stated` (« à vérifier »), et par le juge ; « office » seul ne compte
  pas, pour ne pas renvoyer « remote-first, office optional ».
- Le balayage de l'expérience lit des nombres suivis d'« ans » / « years » près d'un mot
  d'expérience, d'un seuil (« minimum », « at least ») ou d'un « + » ; « with over 15 years of
  experience in the industry, Acme… » passe le filet et c'est à l'agent de le mettre dans
  `ignored` (le juge vérifie). Une exigence écrite autrement (« expérience confirmée »,
  « seasoned ») ne compte que par le label que l'agent relève, donc « à vérifier », pas écartée.
