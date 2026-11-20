# Système `feature-build`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Porté du workflow `feature-build` du harness v0 d'Antoine
(`archive/harness-v0/workflows/feature-build.json`) : demande → plan → implémentation en
boucle jusqu'aux tests verts → lint → relecture jugée → validation humaine → PR brouillon.

```
request ──▶ plan (agent) ──▶ implement (bloc, ⟲ tests) ──ok──▶ lint ──ok──▶ review (bloc, jugé)
                                                                                │ ok
                                                              approve (humain : diff + review.json)
                                                                   │ approve            │ reject
                                                              ship (brouillon de PR)   drop (annulé)
                                                                   │
                                                              done { ok, stage, pr_url }
```

| Étape | Qui | Ce qui est vérifié |
|---|---|---|
| `plan` | agent | sortie typée : résumé, nombre de tâches (≥ 1 ; `plan.md` en demande 3 à 6), `plan.md` dans les artefacts |
| `implement` | bloc | la commande de tests du projet, le journal, une tâche par tour, contexte vierge |
| `lint` | bash | `lint_cmd` du projet (`npm run lint --if-present` par défaut) ; sort toujours 0 et rend `{ ok, exit_code, log }`, sortie complète dans `lint.log` ; `review` ne tourne que si `ok` |
| `review` | bloc | `review.json` bien formé, constats dans le diff, juge en contexte vierge |
| `approve` | humain | lit le diff relu (`diff.patch`) et `review.json` ; seul « go » de la chaîne |
| `ship` | agent | commit, push, `gh pr create --draft` ; jamais de fusion ; `pr_url: null` si rien n'est publié |

`done` (`trigger_rule: all_done`) rend l'issue typée et nomme l'étape où la chaîne s'est
arrêtée : `plan` (le plan a échoué), `implement` (tests encore rouges ou tâches restantes au
plafond, ou bloc en erreur), `lint` (le lint n'a pas passé, ou a dépassé ses 10 min),
`review` (relecture récusée par le juge, sans `review.json` valide au plafond, ou bloc en
erreur), `ship` (pas de PR, ou ship en erreur après le « go »), ou `done`. Il la rend sur
tous ces chemins, erreurs de `plan` et de `ship` comprises (voir plus bas). Restent sans
issue typée : un refus humain (`drop` annule le run, `done` ne tourne pas : l'humain n'est
jamais l'étape de `done`), et une erreur d'un nœud que `done` lit directement — le script
`verdict` d'un bloc, le nœud `lint` lui-même (pas un lint rouge, qui sort 0), un relais —
ou de `done` : une liaison Archon ne lit jamais un nœud en échec, alors `done` échoue avec
lui et le run finit `failed` sans issue. `done` n'a qu'un garde-fou : une relecture `ok`
suivie d'autre chose qu'un « go » n'a aucun chemin dans ce YAML ; si elle arrivait (YAML
changé sans `done.ts`), le nœud échouerait (« done: unexpected state … ») au lieu
d'inventer une issue.

## L'arbre de travail est relu, pas des commits

`implement` ne commite jamais ; seul `ship` commite, après le « go ». La relecture prend
donc les commits depuis la merge-base avec `base`, plus les modifications non commitées et
les fichiers non suivis (`review/commands/work.md`), sans toucher à l'index : un
`git diff <base>...HEAD` serait vide ici. Le v0 faisait un commit par tâche ; ce portage
garde `implement` sans commit et relit l'arbre de travail.

## Quand les tests ne passent jamais

La boucle d'`implement` a 8 tours. Si les tests ne passent jamais, ou qu'il reste des tâches
au 8e tour, elle rend quand même la main : son contrôle compte les tours (`tries`) et s'arrête
au plafond, avant l'épuisement de `max_iterations` (une `loop_group` épuisée finirait
`failed`, sans verdict typé). Le verdict du bloc rend alors `ok: false, status: unconverged` ; le lint, la
relecture, l'approbation et ship sont sautés, et `done` clôt `ok: false, stage: implement`
(« Implementation did not converge (tests never went green or tasks were left): », suivi du
résumé du bloc, « Checks still failing after 8 round(s). Tests: red; remaining tasks: … »). Le run
finit `completed` : l'échec est dit par l'issue typée, pas par l'état du run.

De même pour `review` : si ses 3 tours ne produisent jamais un `review.json` qui passe ses
contrôles, son juge est sauté et son verdict rend `ok: false, status: unconverged,
code_verdict: unknown` ; l'humain n'est pas sollicité, et `done` clôt `ok: false, stage:
review` (« Review did not converge (no valid review.json, so nothing reliable is said about
the code): », suivi du résumé du bloc). Un juge qui récuse une relecture bien formée donne
`status: rejected`, même étape, autre message.

## Quand une étape échoue

Seule une erreur (modèle, script, juge compris) fait encore échouer le run. Dans les cas
suivants, `done` rend quand même son issue typée (les exceptions sont plus haut : un nœud
que `done` lit directement, ou `done` lui-même) :

- dans un bloc : le verdict du bloc est sauté, `done` le reçoit à `null` (`if_skipped:
  null`) et clôt `stage: implement` ou `stage: review` avec « returned no verdict: one of
  its nodes failed ». `null` ne veut jamais dire « pas convergé » ;
- `plan` ou `ship` (nœuds agents hors bloc) : une liaison Archon ne lit jamais un nœud en
  échec, même avec `if_skipped`, et lier `$ship.output` ferait échouer `done` avec lui.
  `done` les lit donc par deux relais, `plan_result` et `ship_result`, qui recopient leur
  sortie quand ils ont réussi ; un producteur en échec fait sauter son relais (cause : amont
  en échec), et un relais sauté se lit `null`. `done` clôt alors `stage: plan` (« No plan:
  the plan step failed… », rien n'a tourné en aval) ou `stage: ship` (« Ship failed after
  the go… », pas d'URL de PR ; un commit ou un push a pu avoir lieu, à vérifier avant de
  relancer).

Le run finit `failed` dans ces cas. À la reprise (`archon workflow resume`), Archon rejoue le
nœud en échec et ce qu'il avait fait sauter (le verdict du bloc, ou le relais de `plan` /
`ship`) ; si cela réussit, `done` rejoue aussi, sa dépendance ayant changé. Pour `ship`,
c'est un second passage de ses étapes (voir « Limites connues ») : vérifier la branche avant
de reprendre.

Le dry-run ne joue qu'un tour de boucle (il tient `until_bash` pour satisfait) : les fixtures
`tests-never-green` et `review-unconverged` stubbent donc `check` dans l'état du dernier tour
(`ok: false`, `tries` au plafond) et prouvent, verdicts et `done` réels, l'issue typée et que
rien d'aval n'est atteint. L'arrêt au plafond lui-même (`until_bash` lit `tries`) est
contrôlé par `scripts/gates/validate.ts` (R1) dans chaque bloc.

## Écarts avec le v0

- Les juges étaient consultatifs dans le v0 (un nœud prompt dont rien ne lisait la
  sortie) ; ici un FAIL du juge (`review__verdict` à `ok: false`) arrête la chaîne avant
  l'humain, et `done` rend `ok: false`.
- `implement` passe de 6 tours (v0 : `max_retries: 5`) à 8 ; `plan.md` demande 3 à 6
  tâches (et non plus 3 à 8), pour qu'une boucle de 8 tours garde de la place pour un tour
  raté.
- La commande de tests passe de la variable d'environnement `TEST_CMD` à l'entrée
  `test_cmd` (de même `LINT_CMD` → `lint_cmd`).
- Le v0 faisait un commit par tâche ; ici `implement` ne commite pas et `review` relit
  l'arbre de travail (voir plus haut).

## Lancer

```bash
archon workflow run feature-build --input request="Ajouter l'export CSV des rapports" \
  --input test_cmd="bun test" --input lint_cmd="bun run lint" --input base=main
archon workflow approve <run-id>     # après lecture du diff dans le worktree du run
```

Le run tourne dans un worktree (défaut) : le dépôt courant n'est pas touché tant que la PR
n'est pas fusionnée par un humain. `--no-worktree` pour travailler sur la branche courante.

## Par rapport au pack `sdlc` d'Archon

`archon-plan`, `archon-implement`, `archon-review` et `archon-ship` couvrent les mêmes
métiers avec la file d'issues GitHub en amont. Ce système est la version courte, à un seul
« go », fidèle au v0 ; `use-cases/README.md` (UC-12) décrit la composition avec le pack sdlc
et `gatekeeper.js` pour le pilier 03 de Master Plan.

## Vérifier

`scripts/verify-block.sh feature-build` — fixtures `shipped` (lint réel), `lint-failed`
(lint réel en échec), `review-refused` (juge qui récuse, verdict réel), `review-unconverged`
(relecture sans `review.json` valide au plafond, verdict réel), `tests-never-green` (tests
encore rouges au 8e tour, verdict réel), `rejected-by-human`, `ship-failed` (`ship` échoue
après le « go », faute de stub : run `failed` sur `ship` seul, `done` réel rend `stage:
ship`) et `plan-failed` (`plan` échoue : run `failed` sur `plan` seul, `done` réel rend
`stage: plan`). Les messages de `done` sont testés à l'unité (`bun test
./scripts/done.test.ts` depuis ce dossier), chacun sur un chemin réel (sa fixture, ou la
raison qui le rend possible : verdict sauté sur erreur, lint en dépassement, `pr_url: null`),
et le garde-fou une fois, script lancé pour de vrai (code 1, rien sur stdout).

Retirer un seul `when:` de `feature-build.yaml` fait échouer au moins une fixture. Pour celui
de `ship` (« go » exigé), `drop` est déclaré après `ship` : les deux partagent une couche,
que le dry-run joue dans l'ordre du YAML en s'arrêtant au `cancel` ; `rejected-by-human`
atteindrait donc `ship`, sans stub, avant l'annulation. Le moteur réel lance la couche en
parallèle : seul ce `when` empêche une PR après un refus.

## Limites connues

- Avec `--no-worktree`, ce run prend le verrou du dossier : un run plus ancien en cours ou en pause dans ce dossier, même d'un système sans verrou (`pipeline` en pause à sa revue…), le fait annuler (« This worktree is in use »).
- Le dry-run ne joue jamais `until_bash` (il tient chaque boucle pour finie après un tour) : seul `scripts/gates/validate.ts` (R1) vérifie qu'une boucle s'arrête à son plafond.
- Si le script `verdict` d'`implement` ou de `review` échoue lui-même (de même `lint` ou un relais), il n'y a pas d'issue typée : `done` échoue avec lui.
- Une étape de boucle en échec fait échouer la boucle de son bloc ; à la reprise, elle repart au tour 1, compteur `tries` compris (les modifications d'`implement` restent dans l'arbre de travail).
- Si le push réussit et que `gh pr create` échoue, `ship` rend `pr_url: null` (consigne de `ship.md`) : la branche est poussée sans PR, et `done` finit `stage: ship`, `pr_url: null`.
- À la reprise après une erreur de `ship`, Archon le rejoue en entier, mais `ship.md` ne refait commit, push et PR que si l'arbre a encore des changements : si le premier essai avait commité, `ship` s'arrête sans pousser et rend la PR ouverte de la branche, sinon `pr_url: null` (`done` : `stage: ship`).
