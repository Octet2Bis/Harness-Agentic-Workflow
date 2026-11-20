# Proposition : Free-Hire, une source de plus pour le radar

**Proposé, pas branché.** Le radar de la VM (`career_ops/` de Master Plan : `live_job_scraper`
→ jury `inspectors/` → `decision_maker_scout` → `pending_gold_jobs.json` en
`PENDING_VALIDATION`, sous pm2) est en production : rien ici ne le modifie. Ce document dit ce
qu'il faudrait y ajouter, et `radar_freehire.ts` (sans réseau, testé) en est la spécification
exécutable.

Source lue : la skill `freehire-search` de
[ai-job-search](https://github.com/MadsLorentzen/ai-job-search) (`.agents/skills/freehire-search/`,
MIT, © 2026 Mads Lorentzen) : `SKILL.md`, `url-reference.md`, `cli/src/`. Sa CLI n'a été ni
installée ni lancée, et l'API n'a pas été appelée.

## 1. La source

[Free-Hire](https://freehire.me) est un agrégateur d'offres open source : il relève les offres
d'environ 50 ATS (Greenhouse, Lever, Ashby, Workable, Workday, SmartRecruiters…) et les remet
dans un seul schéma, avec facettes (pays, région, ville, mode de travail, séniorité, catégorie,
compétences, salaire quand il est connu).

- **API JSON publique en lecture**, sans clé ni compte (seuls le suivi « postulé / sauvé »
  demandent une clé, inutile ici). Enveloppe `{ data, meta }`, erreurs `{ error }` en 4xx/5xx.
- **Descriptions complètes dans la recherche** : `GET /api/v1/agent/jobs/search` rend chaque
  offre avec son texte entier (Markdown, texte ou HTML) ; une requête pour N offres, pas N + 1.
- **Le lien est celui de l'employeur** : le champ `url` mène à la page de l'annonce chez son ATS,
  pas à un agrégateur. Pour `career-apply`, c'est le meilleur cas : `route` reconnaît
  directement Lever, Greenhouse, Ashby, Workable, SmartRecruiters, Teamtailor, Personio,
  Recruitee, Workday (`blocks/.shared/platforms.ts`), sans passer par l'agent `resolve`.
- **Service personnel, « best-effort », sans SLA.** Le backend est MIT
  ([strelov1/freehire](https://github.com/strelov1/freehire), Go + PostgreSQL + Meilisearch) et
  s'auto-héberge ; l'URL de base se change d'une variable.

Limites, à mesurer avant de l'activer :

- **Orienté tech.** Ses facettes (catégories, compétences, séniorité) sont réglées pour le
  logiciel et la donnée ; les postes GTM, RevOps, growth ops ou automatisation existent dans le
  corpus (il relève des pages carrières entières) mais sont moins bien classés. D'où la
  recherche par intitulé (`title:`) plutôt que par catégorie, ci-dessous.
- **Facettes incomplètes** : une offre peut avoir un mode de travail sans région ni pays
  résolus ; filtrer sur `regions=eu` la fait disparaître. `regions=none` attrape ces offres-là.
- **Une offre close** reste lisible par `GET /api/v1/jobs/{slug}` (avec `closed_at`) mais sort
  de la recherche ; la garde d'annonce de `career-apply` (`systems/.shared/posting-guard.ts`)
  attrape de toute façon une annonce expirée avant le CV.

## 2. Comment le radar l'interrogerait

Une ou deux requêtes par passage du radar, pas plus (service gratuit), au même rythme que les
autres sources :

```
GET <base>/api/v1/agent/jobs/search
    ?q=title:growth OR title:revops OR title:gtm OR title:sales operations OR title:automation
    &countries=fr
    &posted_within_days=3
    &description_format=text
    &limit=50&offset=0

GET <base>/api/v1/agent/jobs/search
    ?q=(les mêmes intitulés)
    &regions=eu&regions=none&work_mode=remote
    &posted_within_days=3&description_format=text&limit=50&offset=0
```

- `<base>` : `https://freehire.me` par défaut, dans une variable d'environnement du radar
  (une instance auto-hébergée se branche sans toucher au code).
- `q` : au plus **5 alternatives**, séparées par `OR` **en majuscules** (une sixième rend 400 ;
  `or` en minuscules est un mot comme un autre) ; `title:` en tête d'une alternative la
  restreint à l'intitulé. Les intitulés sont ceux du profil d'Antoine (`master_profile.md`),
  à ajuster par lui. `searchPath()` construit exactement cette chaîne et refuse une sixième
  alternative.
- `countries` en ISO alpha-2 minuscule ; `regions` dans `global, eu, uk, north_america, latam,
  apac, mena, africa, cis, none` (`us` est un pays, pas une région), répétables
  (`regions=eu&regions=none`) ; `work_mode` dans `remote, hybrid, onsite`, un seul paramètre,
  valeurs séparées par des virgules (`work_mode=remote,hybrid`). Les valeurs vivantes :
  `GET /api/v1/jobs/facets?q=<rôle>`.
- `description_format=text` : le jury et le CV lisent du texte ; `limit` ≤ 50, pagination par
  `offset` (borne serveur : `offset + limit ≤ 10000`).
- En-têtes : `Accept: application/json` et un `User-Agent` qui nomme le projet
  (`master-plan-radar/1.0`). Délai 15 s. Sur 429 ou 5xx : nouvel essai avec attente croissante
  (respecter `Retry-After`), 30 s au total ; injoignable ou 404 sur le chemin (instance trop
  vieille) : la source est sautée pour ce passage et le journal du radar le dit, **jamais**
  une erreur qui arrête le radar ni un « zéro offre » silencieux.
- La réponse brute est gardée quelques jours (`Workspace/career/radar_sources/freehire/<date>.json`,
  par exemple) : c'est ce que `radar_freehire.ts` relit, et ce qui permet de rejouer un import.

Deux façons de l'écrire dans le radar, au choix d'Antoine :

1. **Dans le radar lui-même** (Python, comme les autres sources de `career_ops/`) : une
   fonction de collecte qui fait la requête ci-dessus et rend des offres aux champs du § 3,
   dédoublonnées selon le § 4. `radar_freehire.ts` et `radar_freehire.test.ts` en sont la
   référence : mêmes champs, mêmes règles, mêmes cas.
2. **Par ce script** : le radar sauve la réponse, puis lance
   `bun radar_freehire.ts <réponse.json> --board pending_gold_jobs.json` et passe `fresh` au
   jury. Il faut alors `bun` sur la VM (pas supposé aujourd'hui).

Dans les deux cas, les offres nouvelles suivent le chemin des autres : jury, scout, puis
`PENDING_VALIDATION`, et `/valider` sur Telegram. Free-Hire n'écrit jamais un statut.

## 3. Les champs : Free-Hire → offre du tableau

Les champs du tableau sont ceux que le bot écrit et que le harness lit
(`PendingJob`, `systems/.shared/career.ts` ; `readOffers`, `integrations/cockpit/lib.ts`).

| Champ du tableau | Vient de (job Free-Hire) | Règle |
|---|---|---|
| `id` | `public_slug` | `FH-<public_slug>` |
| `slug` | `company_slug` (sinon `company`), `public_slug` | entreprise en `snake_case` sans accents, `_`, dernier segment du `public_slug` : `acme_7k2p9qxa`. Court à taper dans `/valider`, stable d'un passage à l'autre |
| `company` | `company` | entités HTML décodées |
| `title` | `title` | entités décodées, espaces de bord retirés |
| `link` | `url` | tel quel : la page de l'annonce chez l'ATS de l'employeur |
| `source` | — | `freehire` |
| `location` | `location`, sinon `cities` + `countries` | `Paris, France` ; `Lyon, FR` |
| `description` | `description` (texte) | fins de ligne normalisées, 4 000 caractères au plus |
| `skills_required` | `skills` | joints par `, ` |
| `salary_range` | `enrichment.salary_min`, `salary_max`, `salary_currency`, `salary_period` | `48000–55000 EUR/year` ; la période est gardée (un annuel n'est pas un mensuel) ; vide sans montant |
| `date_published` | `posted_at` | `AAAA-MM-JJ` ; vide si absent |
| `found_at` | — | l'heure de l'import (à aligner sur le champ que le radar utilise déjà, s'il en a un) |
| `freehire` | `public_slug`, `source` (l'ATS), `external_id`, `company_slug`, `work_mode`, `enrichment.seniority`, `category`, `employment_type`, `countries`, `regions` | un objet à part, que le bot ignore et que la fusion PC/VM garde (champ du bot) |

Ce que la source **ne remplit pas** (le jury et le scout le font, comme pour les autres sources) :
`match_score` / `final_score`, `tier`, `jury_verdict`, `hook_angle`, `matched_skills`,
`target_role`, `company_hq`, `status` (`PENDING_VALIDATION` si le jury garde l'offre). Et
jamais `validated_at` (le bot, à `/valider`), `harness`, `applying` (le harness).

Écartées avant tout : une offre avec `closed_at`, sans `public_slug`, sans intitulé ou sans URL
http(s) (chacune avec sa raison dans `skipped`).

## 4. Le dédoublonnage

Une offre Free-Hire n'entre pas si le tableau a déjà, **quel que soit son statut** (une offre
`APPLIED`, refusée ou retirée ne revient pas), dans cet ordre :

1. **le même lien d'annonce** : comparé sans schéma, sans `www.`, sans paramètres de suivi
   (`utm_*`, `gh_src`, `lever-source`, `trk`, `ref`, `source`…), sans ancre ni `/` final, mais
   avec l'identifiant de l'annonce (`gh_jid` reste) ;
2. **le même `public_slug` Free-Hire** (`freehire.public_slug`) : le lien de l'ATS a pu changer ;
3. **le même `slug`** ;
4. **la même entreprise et le même intitulé**, repliés (minuscules, sans accents ni
   ponctuation) : la même offre vue par une autre source (LinkedIn donne un lien LinkedIn,
   Free-Hire celui de l'ATS ; seul ce critère les rapproche).

Les doublons d'une même réponse sont écartés aussi (le premier gagne). Chaque doublon sort
avec sa raison (`same posting link as kestrel_auto`…). Limite assumée : une entreprise qui
republie le même intitulé plus tard est vue comme un doublon ; si Antoine y a déjà postulé,
c'est voulu, sinon il la remet à la main.

## 5. Le script de référence

`integrations/master-plan/radar_freehire.ts`, testé par `radar_freehire.test.ts` sur une
réponse écrite à la main dans la forme de l'API (`test/freehire_search.sample.json`) :

```bash
bun integrations/master-plan/radar_freehire.ts <réponse.json> [--board <pending_gold_jobs.json>] [--now <date ISO>]
# → { "fresh": [offres à passer au jury], "duplicates": [{ "slug", "reason" }], "skipped": [...] }
```

Aucun appel réseau (le test le vérifie), aucune écriture : il lit une réponse sauvegardée et
le tableau, et imprime. Il accepte l'enveloppe de l'API (`{ data }`), la sortie de la CLI
d'ai-job-search (`{ results }`, où `id` est le `public_slug`) et un tableau nu.

## 6. Pour l'activer (à la main, plus tard)

1. Antoine lance une fois la requête du § 2 à la main et regarde ce qui revient : combien
   d'offres pertinentes par jour, en France et à distance. Si c'est peu, s'arrêter là.
2. Ajouter la collecte au radar (§ 2, option 1 ou 2) derrière un interrupteur (variable
   d'environnement), éteint par défaut.
3. Rejouer une réponse sauvegardée contre le tableau du moment (`radar_freehire.ts --board`)
   et comparer `fresh` à ce que le radar aurait ajouté.
4. Allumer l'interrupteur, `pm2 restart` du radar par Antoine. Retour arrière : l'éteindre.

## 7. Risques

- **Disponibilité** : service sans SLA ; la source se saute proprement, les autres continuent.
- **Couverture** : orientée tech ; à mesurer (§ 6.1) avant d'y compter.
- **Volume** : une ou deux requêtes par passage ; pas de boucle sur `detail`, les descriptions
  sont déjà dans la recherche.
- **Qualité** : une annonce d'agrégateur peut être close ou douteuse ; la garde d'annonce de
  `career-apply` la relit avant tout CV (expirée → `APPLY_FAILED`, suspecte → signalée).
