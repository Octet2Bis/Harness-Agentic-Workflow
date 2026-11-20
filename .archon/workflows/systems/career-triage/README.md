# Système `career-triage`

Statut : voir `blocks/REGISTRY.md`.

Trie, une par run, les offres que le radar a captées et que le candidat n'a pas encore
traitées (`PENDING_VALIDATION`, `VALIDATED`), contre ses critères (`criteres.json` de son
dossier carrière), et écrit la décision là où le cockpit la lit.

```
load ──▶ job-triage (bloc : Sonnet cite, le code vérifie et décide, juge Sonnet) ──▶ classify ──▶ record
 │   └ sauté : offre trop ancienne (pre_screened) ou annonce illisible ─────────────▶ │            │
 └ criteres.json, pending_gold_jobs.json, master_profile.md, triage/*.json,                       └ triage/<clé>.json
   annonce en ligne → posting.txt, profil → profile.md
```

- **Moteur** (`engine`, 2026-10-30) : `rules` par défaut, **aucun appel de modèle** : le bloc
  job-triage est sauté et le script `rules` (`systems/.shared/triage-rules.ts`) fait tenir aux
  balayages du code le rôle de l'extraction, puis applique la même règle (`decideTriage`) :
  langue de rédaction, hybride / sur site / bureau pendant l'intégration, télétravail complet
  écrit, années d'expérience, intitulé senior, salaire écrit une seule fois avec sa devise, âge.
  Ce qu'il ne sait pas lire reste « à vérifier » (langue étrangère nommée : exigée ou souhaitée ?
  plusieurs montants ; marqueurs contradictoires) ; zone d'embauche et cœur du poste ne sont pas
  lus (note). `block_status: rules`, définitif sous `rules`, refait sous `engine=llm` (le bloc).
  Raison : le cockpit trie seul chaque offre relevée toutes les 15 min, et le bloc (2 à 3 appels
  Sonnet par offre) vidait le forfait Claude d'Antoine sans qu'il s'en serve.
- **Quelle offre** : `key` (id ou slug), sinon la plus récente qui attend son tri : sans tri,
  triée avec d'autres critères (empreinte `criteria_hash`), ou tri non vérifié encore
  retentable (2 passages au plus). `systems/.shared/triage.ts`.
- **Son âge, tranché par le code avant tout** (mode économe, 2026-10-24) : `load` lit la date de
  la ligne du tableau (`date_published`, une date relative comptée depuis `radar.at`) contre
  `offre_age_max_jours` (7 par défaut) ; au-delà (`preScreen`, `systems/.shared/triage.ts`, même
  règle et même raison que le bloc, `blocks/.shared/offer-date.ts`), ni la page n'est lue ni le
  bloc ne tourne (`pre_screened: true`, `when: … && $load.output.pre_screened == false`) :
  `classify` écrit « écartée », « offre trop ancienne (publiée le 2026-10-12, > 7 jours) »,
  `block_status: pre_screened`, tri définitif (pas retenté, comme `verified`). Dans la limite, la
  date passe encore au bloc (`date_published`, `radar_at`) ; sans date lisible, aucun effet.
- **Une entreprise que le lien contredit** (2026-10-24), même chemin : une ligne dont le lien
  LinkedIn nomme un autre employeur (`…/jobs/view/<intitulé>-at-<entreprise>-<id>`,
  `companyLinkConflict` de `systems/.shared/company-link.ts`) vient de deux annonces (ancien
  connecteur LinkedIn, qui appariait les cartes par rang) : « écartée », « entreprise incohérente
  avec le lien : « Bizneo HR » ne correspond pas à l'employeur « everai » du lien (LinkedIn
  link) », `block_status: pre_screened`. Un simple identifiant d'ATS ne suffit pas à écarter.
- **Un métier hors périmètre** (Antoine, 2026-10-25 : « data analyst ne rentre pas dans le
  périmètre »), même chemin : `intitules_exclus` de `criteres.json`, des mots ou expressions
  d'intitulé cherchés en mots entiers, sans casse ni accents (`titleOutOfScope`) : « écartée »,
  « métier hors périmètre (« data analyst ») : Data Analyst », `block_status: pre_screened`.
  La clé n'entre pas dans l'empreinte (`CODE_ONLY_CRITERIA_KEYS`) : la changer ne relance pas le
  tri de toutes les offres. Le cockpit l'applique aussi aux tris déjà écrits (`scopeOverride`),
  avec une seconde règle du même jour : quand `remote` = full, un tri « à vérifier » pour « Mode de
  travail non précisé » sur une annonce lue en entier s'affiche « écartée » (« Télétravail
  complet non écrit dans l'annonce (règle : full remote) ») ; lue en partie, elle reste à vérifier.
- **Le profil** : `<career_dir>/master_profile.md`, quand il existe et n'est pas vide, est copié
  dans `profile.md` des artefacts et passé au bloc (`profile`) : le cœur du poste (trois
  exigences centrales de l'annonce, chacune étayée ou non par le profil) écarte une offre dont
  deux exigences manquent au profil (Melotech, `blocks/job-triage/README.md`). Sans fichier :
  `profile_file` vide, adéquation non évaluée, une note le dit ; rien d'autre ne change.
- **L'annonce** : relue en ligne avec les en-têtes d'un navigateur (User-Agent Chrome,
  Accept, Accept-Language fr-FR : ceux du radar, `systems/.shared/radar/fetchers/common.js`,
  qui lit WTTJ depuis le PC ; l'ancien `Mozilla/5.0 (harness career-triage)` ramenait d'une
  page WTTJ publique un texte sans annonce), redirections suivies. Quand la page porte un
  JSON-LD `JobPosting` (WTTJ, la plupart des ATS), sa `description` (HTML retiré), son titre,
  sa date limite, son salaire (`baseSalary`) et son expérience requise servent de texte : c'est
  l'annonce telle que l'éditeur la publie, sans habillage ; sinon le texte visible de la page.
  Complète (`postingIsFull`) si elle vient d'un JobPosting, si la page reprend la description du
  radar, ou si elle porte l'intitulé du poste dans plus de 1 500 caractères (avant le
  2026-10-23, une description du radar réécrite suffisait à dire « non lue ») ; sinon le résumé
  du radar sert de texte et l'offre ne peut pas être retenue (« annonce complète non lue »).
  Depuis le 2026-10-23 : la page de l'annonce (`posting_url`, quand l'ATS la distingue du
  formulaire de candidature : Workday via Apify) est lue avant `link` ; si aucune page ne
  contient l'annonce, la description complète que l'API source a donnée au radar
  (`description_full` : Himalayas, Jobicy, Remotive, RemoteOK, Arbeitnow, Working Nomads, flux
  RSS, JSearch, Apify) sert de texte, annonce complète (`choosePosting`). Le
  salaire « 38k€ - 50k€ (1-3 ans) » du radar est une estimation par séniorité, pas l'annonce :
  il n'est pas donné au bloc. `scripts/load.test.ts` le prouve sur un serveur local et une page
  faite à la main (`scripts/samples/jobposting.sample.html`), jamais sur un site réel.
- **Illisible** : quand il reste moins de 200 caractères à lire (`postingReadable` : page
  fermée et radar sans texte, le cas de Jobdatalake, de Jobgether et d'Apify sur un formulaire
  Workday), `load` rend `readable: false` et `unreadable_reason` ; le bloc est sauté
  (`when: … && $load.output.readable == true`) et l'offre est « à vérifier », « Annonce
  illisible : la page de l'offre n'a pas pu être lue (HTTP 403) et le radar n'en donne que
  21 caractères (source Jobgether) ; à ouvrir à la main », `block_status: unreadable`. Avant,
  Opus tournait trois fois sur un texte vide et le tri finissait `unconverged` sur
  « posting_language » (9 tris sur 79 le 2026-10-23).
- **L'issue** (`classify`, pur) : seul un bloc `verified` écarte ou retient, ou le pré-tri du
  code écarte (`pre_screened`) ; juge défavorable, boucle non convergée, annonce illisible :
  « à vérifier », avec la raison.
- **L'écriture** : `<career_dir>/triage/<clé>.json` (clé = `id` de l'offre), jamais le
  tableau `pending_gold_jobs.json` (partagé avec la VM : radar et bot).

```json
{
  "key": "LI-1642423340", "id": "LI-1642423340", "slug": "smartness",
  "company": "Smartness", "title": "Sales Operations & Enablement Specialist", "link": "https://…",
  "decision": "ecartee",
  "reasons": ["Exige l'italien : « Fluent in English and Italian »"],
  "notes": ["Salaire : 38 000 € à 45 000 € brut par an"],
  "salary_annual_eur": { "min": 38000, "max": 45000 },
  "languages_required": ["en", "it"],
  "posting_full": true, "block_status": "verified", "attempts": 1,
  "run_id": "…", "at": "2026-10-22T18:00:00.000Z", "criteria_hash": "…"
}
```

## Lancer

```bash
archon workflow run career-triage --cwd C:\chemin\vers\Harness-Agentic-Workflow --folder \
  --input career_dir='C:\chemin\vers\career'
```

Une offre par run. Coût en appels de modèle (aucun Opus depuis le 2026-10-24) :

| Cas | Appels |
|---|---|
| Rien à trier (`idle`) | 0 |
| Offre trop ancienne (`pre_screened`) | 0 (ni page lue, ni modèle) |
| Annonce illisible (`unreadable`) | 0 |
| Tri ordinaire, extraction juste au premier tour | 2 (Sonnet + juge Sonnet) |
| Une citation à corriger | 3 au plus (2 tours Sonnet + juge Sonnet) |
| Boucle non convergée | 2 (2 tours Sonnet, juge sauté) |

Avant : 2 à 4 appels Opus par offre, offres trop anciennes comprises. Le cockpit en lance un à
la fois tant qu'une offre attend son tri (`triageRunArgs`).
