# Les cas d'usage de Master Plan, recréés en ingénierie agentique

Inventaire du 2026-10-18. Pour chaque cas d'usage : ce qui existe déjà dans Master Plan, puis sa
recréation « à la reel » dans la grille de ce dépôt — **Déclencheur, Entrée, Livrable, Critères
code, Critères juge, Vérification humaine, Workflow** — et son statut ici.

Règle de lecture : ce qui était déjà déterministe dans Master Plan (scrapers, linters,
pipelines Python, validateurs) **n'est pas réécrit**. Il devient soit l'amont d'un bloc (il
produit l'entrée), soit le contrôle de la boucle (le code qui vérifie). Ce qui reposait sur une
génération LLM sans vérification (CV, fiches de veille, emails, pages, contenus) devient un bloc
: agent → code → juge en contexte vierge → VERIFIED. Les 33 skills de `.agents/skills/`
deviennent les prompts `commands/work.md` et `commands/judge.md` des blocs (ex. la grille
Drafter-Reviewer A–F de `career-job-hunter` est le juge de `cv-tailor`).

## Le gabarit d'un cas d'usage (harness v0)

À remplir par Antoine ; l'agent propose, il ne décide pas (`POSTURE.md`). Un cas qui dépasse
quelques lignes a son propre fichier `use-cases/<id>.md`, dans ce gabarit :

```markdown
# <nom du cas>

- Déclencheur : d'où vient la demande (téléphone, Slack, Telegram, client, planification)
- Entrée : ce que reçoit le workflow
- Livrable : ce qui doit exister à la fin, et où
- Critères vérifiables par code : …
- Critères qui demandent un juge : …
- Vérification humaine finale : ce qu'Antoine regarde
- Workflow : existant (`systems/…`, `blocks/…`) ou à créer
```

| Statut | Sens |
|---|---|
| **construit** | bloc / système présent dans ce dépôt, `verify-block.sh` vert |
| **à créer** | cas d'usage cadré ici, à produire avec `scripts/new-block.sh` |
| **déterministe** | déjà du code vérifiable dans Master Plan, reste tel quel |
| **hors périmètre** | pas un métier agentique (infrastructure, règles fixes) |

---

## Pilier 02 — Assistant personnel

### UC-1 · Carrière : offre validée → CV sur mesure → candidature déposée — **construit**

- **Existant** : `career_ops/` (`live_job_scraper` → jury `inspectors/` langue, remote,
  séniorité → `decision_maker_scout` → `pending_gold_jobs.json` en `PENDING_VALIDATION`), bot
  Telegram PRO (`/jobs`, `/valider`, `/cv`, `/remarque`, `/postuler`), `cv_tailor_engine.py`
  (template → `applications/<slug>/`), `ats_application_submitter.py` (Lever en dry-run seul,
  autres plateformes « semi_automated »), `career_proof_engine.js`, `skill_proof_graph.json`,
  `master_profile.md`, skill `career-job-hunter`.
- **Ce qui manquait** : après `/valider`, tout était manuel (relecture du CV, envoi).
- **Déclencheur** : `/valider <id>` écrit `status: VALIDATED` ; le timer réveille
  `career-listener` toutes les 10 min.
- **Entrée** : l'offre (`pending_gold_jobs.json` + annonce relue), `master_profile.md`,
  `skill_proof_graph.json`, `remarques_utilisateur.txt`.
- **Livrable** : `CV_Antoine_Lecerf_<slug>.md` + `.pdf`, `Lettre_Antoine_Lecerf_<slug>.md` + `.pdf`,
  `Message_Accroche_<slug>.md`, `interlocuteur_cible.json`, `submission_receipt.json`, captures ;
  statut dans le tableau ; `Entretien_<étape>.md` à la demande (bloc `interview-prep`, cockpit).
- **Critères code** : annonce ni expirée ni suspecte (garde d'annonce) ; couverture des
  mots-clés de l'offre ≥ 70 %, tout chiffre et toute portée (B2B/B2C, P&L, budget, management,
  taille d'équipe, clients nommés) du CV existent dans le profil, pas de clichés FR/EN, au plus
  3 tirets longs, une page, sections, pitch ≤ 180 mots nommant l'entreprise, `candidate.json`
  complet et cohérent avec le profil ; lettre de 250–300 mots, une page, deux preuves tracées ;
  PDF vérifié (pages, texte extractible, e-mail et téléphone, polices) ; URL de candidature
  https chez l'employeur (jamais un agrégateur), hôte de la page dans la liste des ATS ;
  formulaire pré-rempli, CV et lettre joints, réponses libres sourcées, aucun blocage ; reçu
  avec confirmation.
- **Critères juge** : grille Drafter-Reviewer (honnêteté, adéquation, preuves, densité ATS,
  clarté, remarques, fiche candidat) ≥ A- ; réponses saisies fidèles au candidat ; preuve
  d'envoi réelle.
- **Vérification humaine** : le « go » avant le premier envoi sur chaque plateforme
  (`mode: verified-only`), puis relecture des reçus (`/cv`, `applications_log.csv`).
- **Workflow** : `career-listener` → `career-apply` → blocs `cv-tailor` et `apply-submit`.
  Branchement : `integrations/master-plan/README.md`.
- **Amont conservé** : scraper + jury + scout restent dans Master Plan (déterministes).
- **Tri avant validation** (2026-10-22, demande d'Antoine : écarter les offres qui exigent une
  langue qu'il ne parle pas, comme l'italien chez Smartness, et celles sous 35 k€/an) —
  **construit** : système `career-triage` → bloc `job-triage`. Opus lit l'annonce complète et
  cite chaque exigence de langue et le salaire ; le code vérifie les citations, rattrape une
  langue ou un montant oubliés et décide par la règle de `criteres.json` (dossier carrière) ;
  un juge Opus en contexte vierge relit. Décision `ecartee` / `a_verifier` / `retenue` dans
  `triage/<id>.json`, affichée par le cockpit ; salaire absent ou annonce illisible : « à
  vérifier », jamais écartée en silence. Le tableau partagé avec la VM n'est pas modifié.
- **Décideurs à contacter** (2026-10-24, demande d'Antoine : « les noms des personnes à qui
  envoyer un message sur LinkedIn, […] et puis quel message envoyer ») — **bloc construit** :
  `decision-makers`. Un agent cherche sur des pages publiques (site, presse, conférences),
  jamais sur LinkedIn ni chez un courtier ; le code exige pour chaque personne une source et
  une citation qui porte son nom, refuse toute adresse e-mail ou tout téléphone, et contrôle
  la note de connexion (≤ 300 caractères) et l'e-mail (60–150 mots, langue de l'annonce,
  faits du profil) ; un juge rouvre les sources. `decideurs.json` dans les artefacts, montré
  par le cockpit ; Antoine cherche l'adresse et envoie lui-même.
- **Radar côté PC** (2026-10-23, décision d'Antoine) — **construit** : système `career-radar`,
  scripts seulement (pas de modèle) : les connecteurs et le jury de Master Plan (vendus dans
  `systems/.shared/radar/`) lisent les sources du candidat (`job_sources.json`, sinon la 2.1.0
  du système), criblent (doublons, déjà au tableau, langue, télétravail, séniorité, score ≥ 75)
  et ajoutent les nouvelles offres au tableau sous son verrou, sans toucher aux lignes
  existantes ; `last_radar_report.json` pour le cockpit. Le radar de la VM continue en
  parallèle (Telegram, fusion PC ⇄ VM) ; LinkedIn reste désactivé sur le PC.

### UC-2 · Veille : lien (reel Instagram, article) → fiche de recherche — **bloc construit, système à créer**

- **Existant** : bot Telegram RESEARCH (`telegram_client.js` type `instagram_reel`,
  `research_bot_engine.js` avec Qwen2.5:3b sur Ollama + Firecrawl Dev Index, `link_enricher`),
  `research_graph.json`, `REPORT_*_sur_instagram_*.md`, pôle 03 Recherche & veille (fiche
  Problème / Impact / Recommandation, sources datées).
- **Ce qui manquait** : les rapports sortaient en phrases-gabarit (« il s'agit d'un reel
  Instagram… ») sans contenu réel ; aucune vérification.
- **Déclencheur** : un lien reçu par le bot RESEARCH (ou déposé dans `research_inbox/`).
- **Entrée** : la source, le contenu extrait (transcription via agent-reach sur le PC, texte
  via Firecrawl), la question éventuelle.
- **Livrable** : `fiche.md` (De quoi s'agit-il, Problème, Impact, Recommandation immédiate,
  Sources, Limites) + sa catégorie ; à indexer dans `research_graph.json`.
- **Critères code** : sections présentes, métadonnées (date, source, catégorie connue),
  sources au format `[S1] … — URL (date)` valides, aucune phrase-gabarit de l'ancien bot,
  longueur minimale selon que le contenu a pu être lu ou non.
- **Critères juge** : la fiche apprend quelque chose que le titre ne disait pas ; la
  recommandation est actionnable cette semaine ; l'honnêteté quand la source n'a pas pu être lue.
- **Vérification humaine** : lecture hebdomadaire des fiches ; aucune avant publication interne.
- **Workflow** : bloc `veille-fiche` (**construit**) ; système `veille-listener` (**à créer**) :
  `research_inbox/` comme tableau → extraction (agent-reach / Firecrawl) → `veille-fiche` →
  écriture `REPORT_<date>_<slug>.md` + nœud dans `research_graph.json`. Le bot RESEARCH
  garde l'ingestion ; sa génération Qwen est remplacée par le sous-run.

### UC-3 · Gestion de fichiers, inbox pro / perso — **déterministe**

`01_Gestion_fichiers` (dry-run, magic bytes, tri `inbox_pro` / `inbox_perso`) est déjà du code
vérifiable : il reste. Option : un bloc `inbox-triage` pour les seuls fichiers ambigus (juge :
« ce document est-il pro ou perso, et pourquoi ») — *à créer, faible priorité*.

### UC-4 · Réunions : enregistrement → compte rendu, décisions, actions — **à créer**

- **Existant** : `meeting_ingestor` (transcription), dossier `Workspace/Meetings`.
- **Déclencheur** : un fichier déposé dans `Meetings/`. **Entrée** : la transcription.
- **Livrable** : `compte-rendu.md` (Contexte, Décisions, Actions, Questions ouvertes).
- **Critères code** : chaque action a un porteur et une échéance ; chaque décision cite un
  passage ; pas de marqueur de brouillon. **Juge** : rien d'inventé par rapport à la transcription.
- **Humain** : relecture avant envoi aux participants. **Workflow** : bloc `meeting-notes`.

### UC-5 · Coach, journal, sécurité, adaptateur Hermes — **hors périmètre**

`coach_engine` (règles), `security_guard`, `hermes_adapter` sont de l'infrastructure ou des
règles fixes ; pas de boucle agent → code → juge à y mettre.

---

## Pilier 01 — GTM & Growth

### UC-6 · Outbound : segment ICP → séquence email — **bloc construit, système à créer**

- **Existant** : pôle 04 Outbound & CRM, `email_linter.py`, `ai_slop_linter.py`, skill
  `gtm-outbound`, pipelines `uc_b2b_enrichment` / `uc_crm_hygiene` + `cascade_config.yaml`,
  `Workspace/campaigns/`.
- **Déclencheur** : un segment enrichi prêt (sortie de `uc_b2b_enrichment`) ou une campagne
  créée dans `Workspace/campaigns/<campagne>/`.
- **Entrée** : brief, ICP, preuves (chiffres, logos, cas).
- **Livrable** : `sequence.md` — 4 touches, angle par touche, objet, notes de personnalisation.
- **Critères code** : ≤ 120 mots par touche, objet ≤ 60 caractères, angles distincts
  (similarité < 0,5), dernière touche de rupture, 1–2 questions, pas de spam words ni de slop,
  pas de `{{variable}}` non résolue — ce que `email_linter.py` exigeait, dans la boucle.
- **Critères juge** : la promesse est tenable avec les preuves ; le lecteur ICP comprend en
  une ligne pourquoi lui ; rien de générique.
- **Vérification humaine** : validation avant chargement dans l'outil d'envoi. **L'agent
  n'envoie jamais** (règle « rien ne sort du dépôt sans demande »).
- **Workflow** : bloc `outbound-sequence` (**construit**) ; système `gtm-campaign` (**à créer**) :
  brief de campagne → en parallèle `outbound-sequence`, `landing-page`, `aeo-asset` →
  approbation humaine → dépôt sous `Workspace/campaigns/<campagne>/{outbound,landing_pages,acquisition}/`.

### UC-6b · Prospection d'une entreprise full remote → dossier, offre, séquence — **système construit**

- **Demande** (Antoine, 2026-10-22/23) : pour une entreprise validée full remote, rechercher
  son activité, ses concurrents et ses besoins, lui proposer ses services (CDI, freelance,
  portage) sur un axe qui répond à un besoin, et ouvrir la discussion par e-mail et LinkedIn.
- **Workflow** : système `company-outreach` = blocs `company-dossier` → `offer-angle` →
  `outbound-sequence` (`notice: "true"`) → go humain. Rien n'est envoyé ; LinkedIn reste manuel.
- **Critères code** : `company-checks.ts` (sources web, concurrents, signaux < 12 mois, pays
  et canal, citations mot pour mot du dossier et du profil) ; `email-checks.ts` (`stop` dans
  chaque touche, source de l'adresse dans la première).
- **Reste** : onglet « prospection » du cockpit, registre local des contacts et liste
  d'opposition, entrée depuis le radar (entreprises validées full remote).

### UC-7 · Acquisition & AEO : intention de recherche → actif citable + JSON-LD — **bloc construit**

- **Existant** : pôle 02, `schema_validator.py`, grappes d'intentions, skill `gtm-aeo`, règle
  « tout actif inclut son JSON-LD validé ».
- **Déclencheur** : une intention retenue dans le plan de contenu. **Entrée** : brief,
  intention, positionnement (`01_Strategy/output/positioning.md`), type Schema.org.
- **Livrable** : `asset.md` + bloc JSON-LD (type principal + FAQPage).
- **Critères code** : JSON-LD valide (contexte, champs obligatoires par type, FAQPage ≥ 3 Q/R),
  un H1 et ≥ 2 H2 sans saut, intention restituée en tête, ≥ 1 500 caractères, pas de slop.
- **Critères juge** : réponse d'abord, affirmations produit issues du positionnement
  seulement, entités précises, FAQ réelle.
- **Humain** : relecture avant publication. **Workflow** : bloc `aeo-asset` (**construit**),
  dans `gtm-campaign`.

### UC-8 · Expérimentation & CRO : landing page + plan de tracking — **bloc construit, `tracking-plan` à créer**

- **Existant** : pôle 03, `templates/landing_page_template.html`, `tracking_validator.py`,
  `ab_test_calculator.py`, `landing_pages/`.
- **Déclencheur** : une intention ou une annonce qui a besoin de sa page. **Entrée** : brief,
  promesse, plan de tracking, gabarit.
- **Livrable** : `index.html` autonome.
- **Critères code** : doctype, `lang`, viewport, titre, description, un H1, DataLayer,
  `click_cta`, un seul CTA primaire, tokens CSS, pas de flou décoratif, pas de script externe
  hors GTM, pas de feuille externe, pas de lorem ipsum, ≤ 200 Ko.
- **Critères juge** : grille CRO (clarté, friction, anxiété, motivation), mesure complète,
  checklist visuelle anti-slop.
- **Humain** : validation avant mise en ligne ; l'A/B test est dimensionné par
  `ab_test_calculator.py`. **Workflow** : bloc `landing-page` (**construit**). Bloc
  `tracking-plan` (**à créer**) : événements snake_case + propriétés, vérifiés par
  `tracking_validator.py` dans la boucle, livré avant la page.

### UC-9 · Stratégie, ICP, positionnement — **couvert par `research` + `design`**

Le pôle 01 produit des documents d'analyse : `research` (étude sourcée) puis `design`
(options → décision → plan) les couvrent tels quels ; `report` restitue. Un bloc `positioning`
dédié ne se justifie que si le format ICM du pôle exige des sections précises (alors : copier le
gabarit, remplacer les sections requises dans `check.ts`).

### UC-10 · Enrichissement B2B, investigation B2C, hygiène CRM, DNS — **déterministe**

`pipelines/uc_b2b_enrichment`, `uc_b2c_investigation`, `uc_crm_hygiene`, `dns_check.py` et la
cascade de finders / verifiers / investigators sont déjà des chaînes vérifiables. Elles restent
dans Master Plan et **alimentent** les blocs (le segment ICP de UC-6). Pas de juge à ajouter : le
code vérifie déjà.

### UC-11 · Activation : séquences d'onboarding — **réutilise `outbound-sequence`**

Même bloc, autres règles (nombre de touches, angles « premier succès », pas de rupture) : passer
`touches`, `max_words` et un brief d'activation. Si les critères divergent durablement, dériver
un bloc `activation-sequence` depuis `email-checks.ts`.

---

## Pilier 03 — Développement App & Design

### UC-12 · Pipeline brief → contenu avec les 4 Portes — **à composer avec le pack `sdlc`**

- **Existant** : `pipeline/` 00 brief → 06 contenu, `gatekeeper.js --check` (4 Portes),
  `dag_validator.js`, `test_gates_can_fail.js`, `.github/workflows/quality_gates.yml`,
  `MECHANICS.md`, `lab/`, cockpit.
- **Recréation** : pas de nouveau bloc à écrire. Le pack `sdlc` livré avec Archon est déjà « un
  bloc par métier » pour le code (`archon-triage`, `archon-investigate`, `archon-plan`,
  `archon-validate`, `archon-review`, `archon-ship`) avec sa file de construction depuis les
  issues GitHub (intake → build-queue). Le système `app-feature` (**à créer**) compose :
  `research` (cadrage) → `design` (décision) → `archon-plan` → `archon-validate` avec
  `gatekeeper.js --check` comme `until_bash` de la boucle → `archon-review` → approbation →
  `archon-ship`.
- **Déclencheur** : une issue GitHub étiquetée. **Humain** : la revue finale avant `ship`.

### UC-13 · Écrans et composants (anti-slop visuel) — **à créer**

Le bloc `landing-page` applique déjà la checklist visuelle au HTML. Un bloc `ui-screen`
(**à créer**) l'étendrait aux écrans d'application : tokens, grille 8 px, 60-30-10, états
(vide, chargement, erreur), accessibilité — contrôles par code sur le fichier, juge sur capture.

---

### UC-14 · Studio : cadrage → design system → contenu → ligne graphique, site ou app — **tronc commun VERIFIED (2026-11-20), lignes à créer**

- **Demande** (Antoine, 2026-11-20) : étoffer le pilier avec plus d'étapes, dont un cadrage qui
  dit s'il s'agit d'un projet purement graphique, d'un site ou d'une app, la création de design
  systems et d'une base de contenu. Premier projet à y passer : Aevum (`showcase/aevum`).
- **Tronc commun** : bloc `calibrate` (type `graphique | site | app`, livrables, plateformes ;
  le code vérifie l'énumération et que la route choisie correspond au type ; le juge vérifie que
  le type colle au brief) → `brief` (cible, problème, hors-champ, appétit : le `BRIEF.md` de
  Master Plan) → `design-system` (tokens clair / sombre, échelle typo, espacements, composants ;
  code : contrastes WCAG AA, tokens complets, aucune valeur en dur ; les kits
  `chamfer-*` de Master Plan servent de départ) → `content-base` (`data/*.json` versionnés,
  textes FR / EN ; code : schéma, parité des langues, pas de lorem, longueurs).
- **Construit** (2026-11-20) : blocs `studio-calibrate`, `studio-brief`, `design-system`,
  `content-base` et système `studio` (`systems/studio/README.md`), contrôles purs dans
  `blocks/.shared/studio-checks.ts` (contraste WCAG calculé, échelle typographique, grille,
  jetons référencés, parité des langues, aucun chiffre absent de la demande). Le run s'arrête
  après le tronc commun et rend la route de la ligne suivante (`next`).
- **Ligne graphique** : direction artistique (2 à 3 pistes, choix humain, comme
  `design-variants`) → déclinaisons (logo, réseaux, print ; code : formats et palette du design
  system) → kit de marque. Référence : un site vitrine de marque (chaîne de retouche Python, scripts d'audit).
- **Ligne site** : arborescence + maquettes → pages (`landing-page`, construit) → SEO / AEO
  (`aeo-asset`, construit) + `tracking-plan` (à créer).
- **Ligne app** : PRD (parcours, machine à états, modèle de données) → `ui-screen` (UC-13) →
  fonctionnalités (`feature-build`, construit ; plus tard `app-feature`, UC-12).
- **Fin commune** : contrôle qualité final (tests, accessibilité, budget de performance,
  captures Playwright comparées) → go d'Antoine → diffusion (kit de lancement, étape 06 de
  Master Plan).
- **Carte** : tableau « Cas d'usage Harness », section Studio
  (https://claude.ai/artifact/KbJ6PMcCwuBp1M4H2jxfbx).

## Priorités proposées

| Ordre | Quoi | Pourquoi |
|---|---|---|
| 1 | Brancher UC-1 (patch `/valider`, timer, sync VM, premier run réel) | la chaîne est construite et vérifiée ; il manque le branchement et le calibrage des prompts |
| 2 | `veille-listener` (UC-2) | le bot RESEARCH produit des fiches vides aujourd'hui ; le bloc existe |
| 3 | `gtm-campaign` + `tracking-plan` (UC-6/7/8) | les trois blocs existent ; le système les assemble en une campagne |
| 4 | `app-feature` (UC-12) | composition du pack `sdlc`, peu de code à écrire |
| 5 | `meeting-notes`, `ui-screen` | nouveaux blocs, à cadrer avec un premier cas réel |

## Comment un cas d'usage devient un bloc

1. Remplir la grille : une entrée par cas d'usage dans ce fichier, et un fichier
   `use-cases/<id>.md` dans le gabarit ci-dessus si le cas dépasse quelques lignes.
2. `scripts/new-block.sh <nom>` ; écrire les contrôles **purs** dans `blocks/.shared/<nom>-checks.ts`
   avec leurs tests ; `check.ts` les appelle ; `work.md` dit à l'agent ce que le code va exiger ;
   `judge.md` ne lui donne que ce que le code ne sait pas décider.
3. Une fixture par issue (verified, rejected, unconverged, outcome-contract), chacune avec sa
   ligne `# attendu:` ; `scripts/verify-block.sh <nom>` vert ; ligne dans `blocks/REGISTRY.md`.
4. Le système qui l'appelle décide où le livrable est rangé dans Master Plan, et où se place
   la vérification humaine (toujours avant toute sortie du dépôt).
