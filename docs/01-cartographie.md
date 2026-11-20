# 01 — Cartographie : le reel ↔ Archon

Le reel décrit une méthode ; Archon fournit un moteur de workflows (YAML + commandes +
scripts, runs durables, fixtures). Ce document dit, concept par concept, quelle brique
d'Archon porte l'idée, où elle est utilisée dans ce dépôt, et ce qui manque.

Légende : **natif** = Archon le fait tel quel · **assemblé** = construit ici avec des
briques Archon · **trou** = rien dans Archon, à faire ailleurs.

| # | Concept du reel | Brique Archon | Dans ce dépôt | Verdict |
|---|---|---|---|---|
| A | L'agent travaille, le **code vérifie** et renvoie les erreurs en boucle | `loop_group` + `until_bash` + `$LOOP_PREV` ; nœud `script:` (bun) | `blocks/template` : `produce` = `work` → `check`, 3 tours max | natif |
| B | Le **juge en contexte vierge** tranche ce que le code ne peut pas | nœud `command:` avec `context: fresh`, `mutates_checkout: false`, `model: large` | `judge` dans chaque bloc, lecture seule, ne voit que le livrable | natif |
| C | Le **bloc** : une brique Lego réutilisable, avec un contrat | workflow empaqueté (`<pack>/<nom>/<nom>.yaml` + `commands/` + `scripts/` + `fixtures/`), `inputs:` / `returns:` / `outcome_field:` | `blocks/<nom>/`, contrat `{ ok, status, summary, problems, findings, deliverable }` | natif |
| D | Un bloc n'est fini que **vérifié** ; ses contrôles sont **testés** | `archon validate workflows`, `archon workflow test` (fixtures stubbées, `exec-code`) ; `bun test` pour les scripts | `scripts/verify-block.sh`, `REGISTRY.md` (DRAFT → VERIFIED) ; 20 tests, 17 fixtures | assemblé |
| E | Un bloc **par métier** (recherche, design, tests, tri, rapport), emboîtables | `include:` (aplati dans un run) et `workflow:` (sous-run gouverné) avec `with:` | `research`, `design`, `report` ; `systems/pipeline` les enchaîne par `include:` | natif |
| F | **Parallèle**, un sandbox et un modèle par bloc | `isolation: worktree` sur `workflow:`, `fan_out`, `model:` par nœud, `mutates_checkout: false` | les blocs ne touchent pas au dépôt ; le pipeline peut passer en `workflow:` + `isolation` bloc par bloc | natif |
| G | **Déclencheur → tableau de tâches → écouteur** | `archon trigger` (liaisons timer / GitHub / webhook signé, file d'admission `resource` + `overlap`), `archon state` (documents durables, `--if-revision`) ; le pack sdlc a déjà `archon-intake` + `archon-build-queue` pour les issues GitHub | `systems/board-listener` + `triggers/board-listener.schedule.json` ; tableau générique = `board/<id>` | assemblé |
| H | L'**humain vérifie à la fin** seulement | `wait: { attention, form: approval }`, `archon workflow approve / respond` | `review` à la fin du pipeline ; `cancel:` si refus | natif |
| I | **Coût borné** par bloc | `max_iterations`, `timeout`, paliers `small / medium / large` ; `budget:` (run) et `maxBudgetUsd` (nœud) existent mais `budget:` refuse encore les `loop_group` | 3 tours, un seul passage de juge `large`, le reste `medium` | partiel |
| J | Livrer un bloc comme **skill** (il préfère le code) | pas de notion de skill dans Archon | un bloc est du YAML + du code ; `description:` « Use when / NOT for » pour le choisir | natif (par choix) |

## Les trous, et ce qui les comble ici

| Trou | Ce qui est fait | Ce qui reste |
|---|---|---|
| Pas de **tableau de tâches** générique NEW / PICKED UP / DONE (le pack sdlc en a un, mais pour les issues GitHub : `archon-intake` → `archon-build-queue`) | documents `board/<id>` dans `archon state`, prise par `patch --if-revision` (jamais deux runs sur la même tâche), `board.ts` pour l'humain | l'entrée « téléphone » : les adaptateurs chat d'Archon (Telegram, Slack, Discord → `/workflow run`) ou une source Standard Webhooks → `board.ts add` |
| Une boucle **épuisée** (`max_iterations` sans `ok`) finit `failed`, sans verdict, et Archon la rejoue quand le run reprend après une pause humaine | chaque bloc s'arrête au plafond par le compteur `tries` de son contrôle, saute son juge et rend `unconverged` (R1, R3) ; la fixture `unconverged` stubbe le dernier tour | observer un vrai plafond sur un run réel |
| Pas de **registre** de blocs vérifiés | `blocks/REGISTRY.md` tenu à la main avec la date | automatiser (le script écrit la ligne) |
| Le **déclencheur natif** (`trigger schedule install`) n'existe que sur macOS | liaison JSON prête ; Windows via Planificateur de tâches → `archon trigger fire --config …` | l'enregistrer sur le PC (`archon trigger whoami`) |
| Le **juge** est un seul avis | enveloppe en lecture seule (`context: fresh`, `allowed_tools: [Read, Glob, Grep]`, `mutates_checkout: false`) | panel de juges (`fan_out` + script de réduction) si un métier l'exige |

## Comment lire Archon avec les yeux du reel

- « Le YAML coordonne, le code calcule, l'agent juge » (constitution du langage) est
  exactement la hiérarchie humain → code → agent du reel, le code au milieu.
- Une fixture Archon = la preuve qu'un bloc est câblé, **sans dépenser un jeton** ; c'est
  ce qui rend le badge VERIFIED reproductible.
- Un run Archon est durable (pause, reprise, artefacts, coût) : c'est le « listener »
  du reel sans serveur à écrire.

## Ce que la lecture détaillée ajoute

Dix lecteurs ont parcouru la documentation d'Archon, un concept chacun (161 correspondances,
1 063 citations `fichier:lignes`, toutes contrôlées mécaniquement ; le détail est dans
[`annexe-cartographie-detaillee.md`](annexe-cartographie-detaillee.md)). Les points qui
changent la façon de lire ce dépôt :

- **Le pack `sdlc` livré avec Archon est déjà « un bloc par métier » pour le code** :
  `archon-triage`, `archon-investigate` (recherche), `archon-plan` (conception),
  `archon-validate` (tests, déterministe), `archon-review` (juge en contexte vierge),
  `archon-ship` (la chaîne). Nos blocs couvrent l'autre moitié du reel : les livrables qui
  ne sont pas du code (recherche, conception, rapport). Pour un métier « code », on part du
  pack sdlc plutôt que du gabarit.
- **Archon n'a pas de nœud « juge »** (sa doc le dit) : le juge est une convention, un nœud
  `command:` en contexte vierge avec une enveloppe réduite (`allowed_tools`, `settingSources: []`,
  `skills: []`, `mutates_checkout: false`) et un `output_format`. C'est ce que fait le gabarit.
- **Le coût se borne à trois niveaux**, mais pas encore ensemble : la boucle
  (`max_iterations`), le run (`budget.max_work_units` / `max_spend_usd`) et le nœud
  (`maxBudgetUsd`, `timeout`). Vérifié : `archon validate` refuse `budget:` dès qu'un
  workflow contient une `loop_group` (« not supported under a run budget yet »), donc nos
  blocs s'en tiennent à `max_iterations: 3` et un seul passage de juge. À réessayer à la
  prochaine version d'Archon.
- **L'entrée « téléphone / Slack / client » existe** : adaptateurs chat (Telegram, Slack,
  Discord, commentaires GitHub → `/workflow run`), source Standard Webhooks, `POST
  /api/workflows/<nom>/run`. Le tableau générique de ce dépôt se nourrit de n'importe lequel
  via `board.ts add`.
- **La pause humaine se voit** : file d'attention (`archon workflow attention`), bannière
  « Needs your input », notifications push, réponse par CLI, chat ou HTTP ; `archon serve`
  reprend le run sans personne au terminal.
- **Entre les runs**, deux mémoires : `$STATE_DIR` (fichiers) et `archon state`
  (documents versionnés) ; dans un run, `$ARTIFACTS_DIR` + `output_type` + `$TYPED_ARTIFACTS_FILE`.
- **Parallèle et isolation** : `fan_out` sur `workflow:` (N sous-runs, `max_parallel`),
  `isolation: worktree`, et, partiellement, un sandbox conteneur ou un `sandbox:` par nœud
  (restrictions fichiers / réseau côté Claude). Le « sandbox = VM dédiée » du reel reste
  hors d'Archon.

