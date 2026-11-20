# Bloc `implement`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Porté de la brique `implement` du harness v0 d'Antoine (`archive/harness-v0/blocks/implement.json`) :
« implémenter un plan tâche par tâche jusqu'à ce que la suite de tests du projet passe ».

## Ce que le code vérifie (`.shared/implement-checks.ts`, règles testées à l'unité)

À chaque tour : la commande de tests du projet (`test_cmd`, défaut `npm test`) — son code de
sortie fait foi, la fin de sa sortie revient à l'agent ; le journal `implement.md` avec ses
sections `## Fait` (au moins une tâche consignée) et `## Reste`. Avant son plafond, la boucle
ne s'arrête que si les tests passent **et** que `## Reste` est vide : une tâche par tour, contexte vierge à
chaque tour, le journal pour seule mémoire (v0 s'arrêtait dès les tests verts, même avec des
tâches restantes).

`check.ts` laisse 20 minutes à la commande de tests ; le nœud `check` déclare donc
`timeout: 1260000` (21 min), sans quoi Archon le tuerait à 2 minutes (défaut des nœuds
`script:`), et la minute de marge laisse au script le temps de rendre son JSON quand ce sont
les tests qui dépassent.

La commande de tests passe par `bash -lc`, et ce bash se trouve comme Archon trouve celui de
ses nœuds `bash:` (`resolveBash` dans `check.ts`, testé par `scripts/check.test.ts`) :
`ARCHON_BASH_PATH` s'il est posé (un chemin absent est une erreur), puis sous Windows le
premier Git Bash installé aux emplacements usuels (Program Files, Program Files (x86),
installation utilisateur, scoop) — jamais le `bash` nu, qui y lancerait le lanceur WSL —,
ailleurs `bash` dans le PATH. Sans bash, `check` échoue (erreur, pas tests rouges) en disant
où il a cherché.

## Quand les tests ne passent jamais

La boucle a 8 tours (`max_iterations: 8`). Si les tests ne passent jamais, ou qu'il reste
des tâches au 8e tour, la boucle rend quand même la main : `check` compte ses tours
(`tries`) et `until_bash` s'arrête à `tries ≥ 8`, avant l'épuisement de `max_iterations`
(une `loop_group` épuisée finirait `failed`, sans verdict, et Archon la rejouerait dès le
premier tour quand un run reprend après une pause humaine). Le `verdict` tourne alors et
rend `ok: false, status: unconverged`, avec l'état du dernier tour (tests rouges ou verts,
tâches restantes) et ses derniers `problems`. Le run n'échoue que sur une erreur (modèle,
script) : le `verdict` est alors sauté (`trigger_rule: none_failed_min_one_success`, il ne
lit jamais une boucle en échec), et un appelant qui le lie avec `if_skipped: null` (comme
`done` dans `feature-build`) reçoit `null`.

Le dry-run ne joue qu'un tour de boucle (il tient `until_bash` pour satisfait) : la fixture
`unconverged` stubbe donc `check` dans l'état du 8e tour (`ok: false`, `tries: 8`) et prouve
que le verdict réel en tire l'issue typée. L'arrêt au plafond lui-même (`until_bash` lit
`tries`, plafond = `max_iterations`) est contrôlé par `scripts/gates/validate.ts` (R1).

## Pourquoi pas de juge

Les tests sont déterministes ; ce que le code ne tranche pas (le diff est-il juste, propre,
complet par rapport au plan) est le métier du bloc `review`, qui suit dans `feature-build`.

## Entrées / sortie

`plan` (chemin ou texte), `test_cmd`, `out` → verdict typé `{ ok, status: verified|unconverged,
summary, problems, findings, deliverable }` (`findings` toujours vide) : `verified` quand les
tests passent et que `## Reste` est vide, `unconverged` quand ce n'est toujours pas le cas au
8e tour.

Seul bloc qui modifie le dépôt : `archon workflow run` l'isole dans un worktree par défaut
(`--no-worktree` pour travailler sur la branche courante). Jamais de commit ni de push.

## Vérifier

`scripts/verify-block.sh implement`.
