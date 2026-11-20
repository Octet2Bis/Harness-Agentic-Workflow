# Système `board-listener` — le tableau de tâches et son écouteur

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Le tableau du reel : des tâches arrivent de n'importe où (téléphone, chat, script), un
écouteur les prend une à une, lance le système demandé par la carte, et marque le résultat.
Personne ne lance de run à la main.

```
board.ts add "…" [--workflow=<système>] [--source=<origine>] ──▶ board/<id> { status: new }
                              │
   déclencheur (toutes les 5 min) ──▶ board-listener
                              │
            claim ──▶ verrou du dossier en jeu ? ──▶ cartes laissées NEW (run « waiting »)
                  └──▶ patch --if-revision ──▶ { status: picked_up, picked: { run } }
                              │
   hold (rejouée à chaque reprise) ──▶ ce run tient-il encore la carte ? sinon « released »
                              │
   run_<système> (sous-run, un seul tourne) ──▶ … pause humaine du système …
                              │
          outcome ──▶ close ──▶ { status: done | failed, result, summary, finished }
                              │
   settle (toujours) ──▶ encore picked_up par CE run ? ──▶ l'issue du sous-run, sinon failed + cause
```

## Le tableau

Un item = un document d'état Archon `board/<id>` (`archon state`), durable, versionné,
partagé entre les runs du projet :

```json
{ "id": "20261016150000-ab3k", "task": "…", "context": "", "workflow": "pipeline",
  "source": "manuel", "status": "new", "created": "…", "picked": null, "result": null,
  "summary": null, "finished": null }
```

Statuts : `new` → `picked_up` → `done` | `failed`. Un item écrit avant le routage (sans
`workflow`) va au `pipeline`. Côté humain, hors run :

```bash
B=.archon/workflows/systems/board-listener/scripts/board.ts
bun $B add "Faire le point sur X" --context "…"                     # pipeline, source « manuel »
bun $B add "Que sait-on de Y ?" --workflow=research-report --source=telegram
bun $B list                                                          # statut, id, système, tâche (+ run si pris)
bun $B show <id>
bun $B done <id> [--force]           # new | picked_up | failed → done
bun $B fail <id> [raison] [--force]  # new | picked_up → failed
bun $B requeue <id> [--force]        # picked_up | failed → new (garde sa place : même `created`)
```

(`ARCHON_CMD="bun /chemin/Archon/packages/cli/src/cli.ts"` si `archon` n'est pas sur le PATH.)
Sorties : 0 ; 1 refus motivé (système inconnu ou impossible ici, transition interdite, run
encore vivant, item absent ou modifié entre la lecture et l'écriture) ; 2 usage (commande ou
arguments manquants : usage imprimé, pas de trace de pile).

### Le routage

`--workflow` vaut `pipeline` par défaut ; `BOARD_WORKFLOWS` dans `.shared/board.ts` est la
seule liste d'autorisation, avec ce que la carte remplit :

| Système | Tâche → | Contexte → | Le reste |
|---|---|---|---|
| `pipeline` | `task` | `context` | — |
| `research-report` | `task` | `context` | — |
| `feature-build` | `request` | ajouté à la fin de `request` | fixés par le tableau : `test_cmd` `bash scripts/gates.sh`, `lint_cmd` `bun scripts/gates/validate.ts`, `base` `master` ; sous-run dans son propre worktree |
| `design-variants` | `brief` | ajouté à la fin de `brief` | défauts : `intent`, `tracking_plan`, `template` vides |

`add` refuse un nom hors liste (la liste est dans le message), et relit les `inputs:` du YAML
du système : une entrée `required: true` autre que celles de la tâche, du contexte ou des
entrées fixées rend la carte impossible à remplir, elle est refusée (« run it by hand »).
Une carte hors liste écrite à la main (`archon state put`) est prise puis close `failed` par
`outcome` (« not on the board's allow-list; nothing ran »).

Une carte ne choisit pas son projet : une carte `feature-build` vise toujours CE dépôt. Son
sous-run travaille dans un worktree qu'Archon coupe de `origin/<branche par défaut>` (il ne
voit ni le travail non poussé ni le non commité du dossier) ; sans remote `origin`, Archon ne
peut pas le créer, et `add` refuse la carte. Ses tests sont les portes du dépôt
(`scripts/gates.sh`, qui appelle `archon` : il doit être sur le PATH du run) et sa base
`master` (les défauts `npm test` / `main` du système n'ont pas de sens ici). Pour un autre
projet, lancer `feature-build` à la main avec `--input test_cmd=…`.

`--source` (défaut `manuel`) dit d'où vient la carte ; il est stocké, rien ne le lit encore.

## L'écouteur

| Nœud | Rôle |
|---|---|
| `claim` | lit `board/*`, prend le plus ancien `new` par `patch --if-revision` (deux runs ne prennent jamais la même tâche ; exit 3 = quelqu'un d'autre l'a prise, on passe à la suivante) ; laisse `new` les cartes quand le verrou du dossier est en jeu (voir « Le dossier partagé ») ; rend le système, la tâche et le contexte à transmettre, l'id du run, la révision écrite et une `note` ; rien → `idle`, seulement des cartes qui attendent → `waiting` |
| `hold` | la garde, `always_run: true` (rejouée à chaque reprise du run, contrairement à `claim`) : la carte est-elle encore prise par CE run ? Close en échec par le `settle` de CE run (run repris après échec) : il la reprend (`resume` dans l'historique). Sinon `held: false` et aucun `run_*` ne part |
| `run_pipeline`, `run_research_report`, `run_feature_build`, `run_design_variants` | `workflow: <système>`, gardé par `when: "$hold.output.held == true && $claim.output.workflow == '<système>'"` : un seul tourne, sous-run gouverné avec ses artefacts et SA pause humaine |
| `outcome` | pur : lit celui qui a tourné (`trigger_rule: all_done`, les autres en `if_skipped: null`) et rend `{ ok, path, id, workflow, summary, result }` |
| `outcome_result` | relais d'`outcome` pour `settle` : sauté (donc lu `null`) quand `outcome` a échoué |
| `close` | relit la carte et écrit l'issue (`done` si `ok`, sinon `failed`) tant qu'elle est prise par CE run, par `patch --if-revision` sur la révision lue : une reprise à la main faite entre-temps n'est pas recouverte (le nœud échoue en le disant) ; en `idle`, `waiting`, `released`, ne touche pas l'état |
| `settle` | le filet, `trigger_rule: all_done`, ne lie que `claim` et `outcome_result` : si la tâche est encore `picked_up` par CE run, y écrit l'issue du sous-run quand il en a rendu une (`close` a échoué après), sinon `failed` avec la première cause d'échec lue dans le run (`archon workflow get <run> --verbose`) ; sinon ne touche à rien |

Sortie (`close`) : `{ ok, path: idle|waiting|released|done|failed, id, workflow, summary }`.
`idle` (rien à prendre), `waiting` (des cartes attendent le dossier) et `released` (la carte
n'était plus à ce run) sont des succès qui n'écrivent rien.

### Le dossier partagé

L'écouteur tourne en place, dans le dossier du projet, comme `career-listener`. Il déclare
`mutates_checkout: false` : ses nœuds n'écrivent que dans l'état d'Archon (`archon state`),
jamais dans le dossier (`git status` reste vide après prise, pause, approbation, échec et
reprise, dans un vrai run), et `run_feature_build` a son propre worktree. Archon ne l'annule
donc jamais parce que le dossier est tenu.

Un run qui ne déclare pas `mutates_checkout: false` prend le verrou du dossier : Archon
l'annule (« This worktree is in use ») si un autre run actif plus ancien (en cours ou en pause,
même un `mutates_checkout: false`) travaille dans ce dossier. Il le vérifie au départ ET à
chaque reprise : reprendre un run (après un go humain, ou quand ses sous-runs finissent) remet
son heure de départ à maintenant. Un run ainsi annulé ne se reprend plus (« Only failed or
paused runs can be resumed ») : le go déjà donné est perdu. `claim` lit donc les runs actifs
(`archon workflow status`) et le YAML de leur workflow, et laisse des cartes `new` ; le run
finit `waiting` et sa `note` nomme le run en cause (`folderWait`) :

- un run actif de ce dossier prend le verrou (son YAML ne déclare pas `mutates_checkout:
  false`, ou il est introuvable) : TOUTES les cartes attendent. Le sous-run d'une carte peut
  attendre son humain des heures, et ce run serait annulé à sa reprise ;
- une carte dont le sous-run prendrait le verrou attend tant qu'un autre run est actif ici.
  Aucun ne le prend aujourd'hui : `pipeline`, `research-report` et `design-variants` déclarent
  `mutates_checkout: false`, `feature-build` a son worktree, et `board.test.ts` l'exige de tout
  système du tableau. Ce cas reste un filet.

L'inverse vaut aussi : tant qu'une carte attend son humain, l'écouteur et son sous-run en
pause sont des runs actifs de ce dossier, et Archon annule au départ tout run qui y prend le
verrou (`career-apply` sans `mutates_checkout: false`, `career-listener` s'il le garde). Un
tel run déjà actif avant la prise n'est pas exposé à l'annulation à sa reprise : `claim`
attend alors qu'il finisse.

### Pauses humaines, échecs, refus

Les quatre systèmes s'arrêtent pour un humain (`pipeline`, `research-report` : vérification
finale ; `feature-build` : « go » sur le diff avant la PR ; `design-variants` : choix d'une
variante, seulement s'il en reste une). C'est le même comportement pour les quatre :

- **Pause** : le sous-run se met en pause ; le run de l'écouteur se met en pause « blocked on
  sub-run » et donne la commande. On répond sur le run de l'ENFANT
  (`archon workflow approve <id-du-sous-run>`, ou `archon workflow respond <id> b` pour
  `design-variants`). La tâche reste `picked_up` pendant l'attente, et `board.ts requeue |
  fail | done` la refusent (sans `--force`) : l'approbation serait perdue.
- **Refuser, c'est `reject`** (ou `none` pour `design-variants`), **jamais `abandon`** : un
  enfant abandonné laisse l'écouteur en pause, la carte `picked_up`, et `overlap: skip` saute
  tous les runs suivants de l'écouteur, donc tout le tableau. Si c'est fait :
  `archon workflow resume <id-de-l'écouteur>` lit l'enfant annulé, et `settle` clôt la carte.
- **Approbation** (ou sous-run qui finit seul, même `ok: false`) : l'enfant se termine,
  l'écouteur reprend tout seul, `outcome` lit l'issue typée, `close` écrit `done` ou `failed`.
- **Refus humain, ou échec** (un juge en erreur, un nœud qui casse, Archon qui annule l'enfant
  au départ ou ne crée pas son worktree) : l'enfant est annulé ou échoue, donc son nœud
  `run_<système>` échoue. Archon ne laisse aucune liaison lire un nœud en échec, même avec
  `if_skipped` : `outcome` échoue, `close` est sauté, et c'est `settle` qui marque la tâche
  `failed` (« no result from the … sub-run (run_pipeline: …) »). Le run de l'écouteur finit
  `failed` ; la tâche, elle, est close. Après un échec, `archon workflow resume
  <id-de-l'écouteur>` reprend le même sous-run (plus bas) ; après un refus, `requeue <id>`.
- **`close` en échec après une issue** (l'état a refusé l'écriture) : `settle` écrit cette
  issue, `done` ou `failed`, avec « recorded by settle » ; rien n'est à relancer.

### Reprendre un écouteur en échec

`archon workflow resume <id-de-l'écouteur>` rejoue les nœuds en échec (le `run_*`) et `hold`,
jamais `claim`. Le `run_*` reprend le MÊME sous-run : là où il a échoué (ce qui suit le « go »
se rejoue sans nouveau « go »), ou relu s'il a été annulé (la carte reste `failed`). Pour
recommencer : `requeue`. Si la carte est encore celle que le `settle` de ce run a close en
échec, `hold` la reprend (`picked_up`, entrée `resume`) et `close` écrira l'issue du sous-run
repris. Remise en file, close à la main ou prise par un autre run entre-temps : rien ne
tourne, le run finit `released`. Un sous-run déjà terminé n'est pas relancé (la sortie de
`hold` ne change pas d'une reprise à l'autre).

### Reprise à la main

Si un run meurt entre la prise et la clôture (machine éteinte, run abandonné) sans que
`settle` tourne, la tâche reste `picked_up` : `list` montre le run qui la tient.
`done`, `fail`, `requeue` la reprennent, par écriture conditionnelle ; chaque reprise ajoute à
`history` ce que l'item était avant (statut, run, issue). Elles demandent d'abord à Archon
l'état du run qui a pris la carte (`archon workflow get <run>`) et refusent tant qu'il n'est
pas `completed`, `failed` ou `cancelled` (ou qu'Archon ne répond pas) : ce run peut encore
finir la carte, son `close` refuserait d'écrire, et un `requeue` la ferait tourner deux fois.
`--force` passe outre, en le disant ; un run vivant qui reprend ensuite trouve la carte à
quelqu'un d'autre (`hold`) et ne la touche plus.

## Le déclencheur

`triggers/board-listener.schedule.json` est une liaison « timer » d'Archon : toutes les
300 s, lancer `board-listener` dans le dossier du projet, sans chevauchement (`overlap: skip`),
en place (`isolation: in-place`) — d'où le worktree propre de `run_feature_build`.

1. `archon trigger whoami` → coller la valeur dans `runAsUserId`.
2. macOS : `archon trigger schedule install --config triggers/board-listener.schedule.json`.
3. Windows : le Planificateur de tâches exécute
   `archon trigger fire --config C:\chemin\vers\Harness-Agentic-Workflow\triggers\board-listener.schedule.json`
   à l'intervalle voulu (`fire` enregistre le départ et draine l'hôte `pc-hp`).

## Ce que les fixtures prouvent

`outcome` et son relais sont purs et tournent pour de vrai (exec-code) ; chaque fixture
asserte leur sortie (`# attendu(outcome): …`). `claim`, `hold`, `close` et `settle` lisent ou
écrivent l'état durable, qui n'existe pas en simulation : stubbés (sauf `hold` et `close` hors
travail, qui ne le lisent pas). Ces quatre scripts sont lancés pour de vrai par
`scripts/listener.test.ts`, contre un faux `archon` (`scripts/fake-archon.ts`, état dans un
dossier temporaire, appelé par `ARCHON_CLI_COMMAND` comme dans un run) : dossier tenu →
`waiting` sans écriture ; carte remise en file ou prise par un autre run → `held: false`, et
`close` / `settle` ne l'écrivent pas ; reprise à la main entre la lecture et l'écriture →
écriture conditionnelle refusée ; `settle` puis reprise du run → `hold` reprend la carte et
`close` écrit.

- `idle` : rien sur le tableau, `hold` réel rend `held: false`, aucun `run_*`, `outcome` et
  `close` réels rendent `ok: true`.
- `waiting` : des cartes attendent le dossier ; rien ne tourne, rien n'est écrit, `settle`
  sauté : `ok: true`, `path: waiting`.
- `released` : écouteur repris dont la carte est à un autre run ; `hold` rend
  `held: false`, aucun `run_*` (la carte ne tourne pas deux fois), `released`.
- `done` : carte `pipeline`, sous-run stubbé approuvé → `done`.
- `research-report`, `feature-build` : le bon `run_*` tourne, seul, `outcome` lit sa sortie → `done`.
- `design-variants-none` : aucune variante survivante, `ok: false` → `failed`.
- `unknown-workflow` : carte hors liste, aucun `run_*` → `failed`, « nothing ran ».
- `subrun-failed` : `run_pipeline` non stubbé, le dry-run le fait échouer comme un enfant
  annulé ; `outcome` échoue (liaison vers un nœud en échec), `close` et `outcome_result` sont
  sautés, `settle` est atteint. Le run finit `failed`.

Les décisions (liste d'autorisation et refus, entrées fixées, arguments de `add` et des
reprises, ce que `claim` transmet, dossier tenu, garde et reprise d'un run, issue, clôture,
filet de `settle` et sa cause, reprises à la main et `--force`) sont dans `.shared/board.ts`,
pur, testé à l'unité (`board.test.ts`), qui vérifie aussi `board-listener.yaml` (nœuds,
entrées, isolation, `always_run`, liaisons de `settle`) et les `inputs:` des quatre systèmes
contre la liste d'autorisation, ainsi qu'aucun ne prend le verrou du dossier. Les appels à Archon hors état (`workflow status | get`, YAML
des systèmes, remote `origin`) sont dans `scripts/archon.ts`.

## Limites connues

- `claim` ne voit pas les runs `pending` (au démarrage), qu'Archon compte pendant 5 minutes :
  dans cette course rare, la garde du dossier ne joue pas ; une carte qui en pâtit finit
  `failed` avec la cause.
- Un sous-run qui prendrait le verrou (aucun aujourd'hui) est annulé si un run démarre dans le
  dossier entre `claim` et son départ (carte `failed`, rien de perdu), ou entre sa pause et sa
  reprise (le go est perdu, l'écouteur reste « blocked on sub-run » jusqu'à
  `archon workflow resume <id-de-l'écouteur>`, puis carte `failed`).
- Un run à verrou repris par un humain pendant les quelques secondes d'un tour de l'écouteur
  (même `idle` ou `waiting`) est annulé : l'écouteur est alors un run actif plus ancien du
  dossier.
- Une carte à la fois : tant qu'une carte attend son humain, le déclencheur saute
  (`overlap: skip`) et le reste du tableau attend.
- `--force` pendant que le sous-run est en pause : une approbation donnée ensuite est perdue,
  et la carte tourne une seconde fois.
- Si `hold` échoue après un sous-run approuvé, la carte dit « no result » : reprendre
  l'écouteur lit le résultat, `requeue` refait le travail.
- Archon relance une fois un sous-run en échec quand le parent reprend : ce qui suit le go
  tourne deux fois. `ship` de `feature-build` ne fait que signaler la PR existante la seconde
  fois ; les autres systèmes n'ont pas d'effet extérieur.
- Un `feature-build` en échec peut avoir déjà poussé une PR brouillon ; `requeue` en ouvre une
  seconde après un nouveau go.
