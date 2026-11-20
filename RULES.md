# RULES.md — Contraintes exécutables

> **Rang 1.** Une règle est un exécutable, ou n'est pas une règle. Chaque règle nomme la
> porte qui la tranche et la violation connue (`scripts/gates/fixtures.ts`) que le méta-test
> `bun scripts/gates/test-gates-can-fail.ts` rejoue sur une copie du dépôt pour prouver que
> la porte voit encore.

Les portes, dans l'ordre (`scripts/gates.sh` les enchaîne) :

| # | Porte | Règles |
|---|---|---|
| 1 | `bun scripts/gates/test-gates-can-fail.ts` | le méta-test : chaque porte ci-dessous échoue encore sur sa violation connue, et passe sur le dépôt sain |
| 2 | `bun scripts/gates/validate.ts` | R1, R2, R3, R5, R6 (lecture statique) |
| 3 | `bun scripts/gates/build-harness.ts --check` | R5 |
| 4 | `bun test scripts` | les outils du dépôt (`scripts/check.ts`) |
| 5 | `scripts/verify-block.sh --all` | `validate.ts` (étape 0 ; `verify-block.sh <id>` y retient ce workflow, les blocs qu'il inclut et le dépôt), les tests des règles des blocs et des états (R1, R6), `archon validate` (R4), `archon workflow test` et l'issue de chaque fixture (`scripts/gates/fixture-outcomes.ts`, R3) |

## R1 — Le code vérifie avant le modèle

Tout bloc (`blocks/<id>/<id>.yaml` ; le gabarit est `blocks/template/block-template.yaml`) a
une boucle `loop_group` dont le corps contient un nœud `script:` (le contrôle) et dont
`until_bash` lit la sortie de ce contrôle ; le script existe dans `scripts/` du bloc, et ses
règles ont un test (`scripts/<nom>.test.ts`, ou une règle importée de `.shared/<nom>-checks.ts`
avec son `.test.ts`), qui doit tuer une règle cassée. Un juge seul ne suffit pas : on remplace
le probabiliste par du déterministe partout où c'est possible.

La boucle rend toujours la main : chaque appel `emit({ … })` du contrôle porte exactement
`tries: nextTry(process.env.INPUTS_TRIES)` (`.shared/io.ts`, testé par `io.test.ts`), sans
autre valeur de `tries`, et le contrôle lie exactement `tries: "$LOOP_PREV.<contrôle>.output.tries"`.
`until_bash` finit par
`ok=$<contrôle>.output.ok; t=$<contrôle>.output.tries; [ "$ok" = true ] || [ "$t" -ge N ]`,
N = `max_iterations` : avant les tests, seules des affectations `v=$<nœud>.output.<champ>`,
une par variable ; `||`, jamais `&&` ; un seul `-ge`, sur `$<contrôle>.output.tries` ; un
autre arrêt s'ajoute par `||` et compare à `true` un champ autorisé du contrôle (`EXTRA_STOPS`
de `validate.ts` : `submitted_early`, l'envoi précoce d'`apply-submit`). Une boucle épuisée
finirait `failed` : pas de verdict typé, et Archon rejouerait ce nœud à la reprise après une
pause humaine.

**Portes :** `validate.ts`, `bun test scripts`, `verify-block.sh` (tests des règles) ·
**Fixtures :** `no-check`, `check-untested`, `generic-check-broken`, `block-rule-broken`,
`loop-can-exhaust`, `tries-never-counts`, `tries-hard-coded`, `tries-not-emitted`,
`extra-stop-too-wide`, `extra-stop-unlisted-field`, `until-reassigns`,
`until-and-instead-of-or`, `tries-not-from-loop-prev`, `io-untested`, `emit-without-tries`,
`until-ignores-check`, `untested-shared-import`

## R2 — Un juge travaille en contexte vierge, en lecture seule, et n'est pas l'auteur

Tout nœud juge (`command: judge` ou une commande `…-judge`, ou un id qui finit par `judge`)
a `context: fresh`, `mutates_checkout: false`, et des `allowed_tools` sans outil d'écriture ni
shell (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch` seulement) ; son prompt
`commands/<juge>.md` diffère de tous les autres prompts du workflow. Celui qui écrit ne se
note pas.

**Porte :** `validate.ts` · **Fixtures :** `judge-shared-context`, `judge-can-write`,
`judge-is-author`, `judge-without-tools`, `judge-with-mcp`

## R3 — « Vérifié » et « prouvé » se prouvent

Le statut d'un bloc ou d'un système vit dans `blocks/REGISTRY.md`, jamais dans son YAML :

- `GABARIT` — réservé à `template`, le bloc que `scripts/new-block.sh` copie ; vérifié comme
  un bloc, jamais lancé pour lui-même ;
- `DRAFT` — le dossier existe ;
- `VERIFIED` — `scripts/verify-block.sh <id>` est vert, sans modèle, pour ce workflow, les blocs
  qu'il inclut, et le dépôt (les sous-runs `workflow:` se vérifient sous leur propre nom) :
  `validate.ts` ne signale rien (R1, R2, R3, R5, R6) ; chaque règle de contrôle
  est testée à l'unité contre un cas qui doit échouer ; le YAML est validé par Archon ; chaque
  issue a sa fixture, qui prouve le câblage (nœuds atteints, état final) ; et ce que rend la
  fixture est asserté. Dans une fixture, les agents et les contrôles qui lisent le disque sont
  stubbés ; `verdict.ts`, `done.ts` et les décisions pures (`gate`, `decide`, `route`…)
  s'exécutent pour de vrai, et la ligne `# attendu: ok=false status=rejected` de la fixture
  (ou `# attendu(<nœud>): …`) est comparée à leur sortie réelle. Une fixture qui se termine
  sans rien à asserter le dit : `# sans-attendu: <raison>`. Un bloc rend toujours un verdict
  typé : `verified`, `rejected` (le juge refuse) ou `unconverged` (contrôles encore rouges au
  dernier tour ; le juge, conditionné par `when: "$<boucle>.output.ok == true"`, est sauté) ; son
  verdict tourne donc avec `trigger_rule: none_failed_min_one_success` (et ne tourne pas si le
  juge a échoué : l'appelant lit alors `null`). Une fixture `status=unconverged` ne stubbe aucun
  juge (tout nœud juge au sens de R2, `command: judge` compris quel que soit son id ; un juge
  inclus est `<include>__<juge>`) : un nœud atteint sans stub fait échouer le dry-run, l'absence
  de stub prouve donc que le juge est sauté ; et, le dry-run ne jouant qu'un tour sans exécuter
  `until_bash`, le stub du contrôle de la boucle y est le dernier tour : `ok: false` et `tries`
  égal à `max_iterations`. Un bloc `VERIFIED` (ou `GABARIT`) a au moins
  une fixture qui rend `ok=true`, une dont la ligne `# attendu:` dit `status=unconverged` (sans
  juge, sa seule issue négative), et, s'il a un juge, une qui rend `ok=false` ; un système a
  au moins une fixture assertée ;
- `PROUVÉ` — en plus : une exécution complète sur un cas réel, et le juge a refusé au moins
  un cas mauvais connu. Consigné dans `blocks/proofs/<id>.md` (ou `systems/proofs/<id>.md`),
  d'au moins 200 caractères, avec ces trois faits. Un contrôle écrit par un modèle reste à
  tester : la preuve cite le test.

**Portes :** `validate.ts` (déclarations, preuves, fixtures `unconverged`), `verify-block.sh`
(`validate.ts`, `archon workflow test`, `fixture-outcomes.ts`) · **Fixtures :**
`proven-without-proof`, `fixture-outcome-undeclared`, `verdict-skipped-on-reject`,
`verdict-needs-judge`, `missing-unconverged-fixture`, `judge-runs-on-red-checks`,
`judge-without-when`, `unconverged-stubs-judge`, `unconverged-stubs-renamed-judge`,
`unconverged-below-cap`, `verify-skips-static-rules`, `system-hides-block-violation`,
`unconverged-reported-as-rejected`, `verdict-ignores-judge`, `verified-without-fixture`,
`proof-without-facts`

## R4 — Les références existent et le graphe est acyclique

Chaque `command:` a son `commands/<nom>.md`, chaque `script:` son `scripts/<nom>.ts`, chaque
`include:` ou `workflow:` un workflow existant, chaque `depends_on` un nœud du même workflow,
chaque liaison `with:` une sortie déclarée en amont ; le graphe n'a pas de cycle. C'est
`archon validate workflows`, que `verify-block.sh` lance pour chaque bloc et système.

Un pointeur d'artefact (`{"type": "archon_artifact", "run_id", "path"}`) est aussi une
référence : Archon la vérifie à l'exécution seulement, et refuse le nœud si `path` n'est pas
un fichier régulier non vide des artefacts du run — un dossier ne passe pas (premier run
réel, 2026-10-22). `validate.ts` l'attrape sans modèle : dans un prompt, `path` finit par un
nom de fichier (directement, ou par une entrée dont la valeur par défaut en est un) ; dans un
script, le pointeur vient de `artifactPointer(<fichier>)` (`.shared/io.ts`), qui refuse un
dossier.

**Portes :** `verify-block.sh` (`archon validate`), `validate.ts` (pointeurs) · **Fixtures :**
`missing-command`, `missing-include`, `cycle`, `pointer-names-directory`,
`pointer-built-by-hand`

## R5 — Le généré et le registre ne divergent pas du dépôt

`harness.json` est régénéré depuis les YAML, le registre et l'inventaire des cas d'usage ;
une édition à la main est écrasée et signalée. Le registre nomme chaque bloc et chaque
système du dépôt, et rien d'autre.

**Portes :** `build-harness.ts --check`, `validate.ts` · **Fixtures :** `name-mismatch`,
`stray-workflow`, `registry-duplicate`, `registry-orphan`, `registry-missing-row`,
`harness-edited`

## R6 — Les tableaux et les déclencheurs sont cohérents

Les états d'une tâche forment un ensemble fermé, testé à l'unité :

- le tableau : `new → picked_up → done | failed` (`systems/.shared/board.ts`, testé par
  `board.test.ts` ; `claim`, `hold`, `close`, `settle` lancés contre un faux `archon` par
  `board-listener/scripts/listener.test.ts`) ; une carte reste `new` tant que le verrou du
  dossier est en jeu (`waiting`) ; un sous-run refusé ou en échec laisse la carte `failed`
  (nœud `settle`), qu'une reprise de l'écouteur reprend (`hold`) ; reprises à la main `done`,
  `fail`, `requeue`, refusées tant que le run qui tient la carte n'est pas fini (`--force`) ;
- la carrière : `VALIDATED → APPLYING` (`claim` du listener), ou tout statut sauf `APPLYING`,
  `APPLIED`, `APPLY_UNPROVEN` `→ APPLYING` (`load` d'un run lancé à la main, `claimForRun`, qui
  note `applying.from`), une seule offre `APPLYING` récente à la fois ; juste avant le clic, la
  garde `own` d'`apply-submit` (`always_run`) n'envoie que si l'offre est encore `APPLYING` par
  cette prise (`holdsClaim`), sinon `superseded`, rien d'envoyé ; côté écouteur,
  `APPLYING → APPLY_FAILED | APPLY_UNPROVEN` pour une prise de plus de deux heures (jamais
  remise en `VALIDATED` ; close, elle n'est plus tenue et son run, même approuvé ensuite, ne
  clique plus) ou un sous-run fini sans statut (`settle`, seulement si l'offre est encore
  `APPLYING` par cette prise : le statut sauvé dans `close.json` ou `record.json`, sinon
  `APPLY_UNPROVEN` s'il y a trace d'un clic) (`pending.ts`, testé par `pending.test.ts`) ;
  côté candidature, `APPLYING → TAILORED | APPLIED | APPLY_UNPROVEN | APPLY_FAILED | VALIDATED`
  (`career.ts`, testé par `career.test.ts`), seulement si `mayRecord` le permet : un refus au
  go donne `TAILORED`, un statut envoyé n'est jamais rétrogradé, le retour en `VALIDATED` est
  borné à trois passages par validation (`harness.attempts`), puis `APPLY_FAILED`, et un run
  lancé à la main sur une offre prise hors de `VALIDATED` réécrit son statut d'avant
  (`applying.from`) au lieu de `VALIDATED`. Chaque écrivain de `pending_gold_jobs.json`,
  `merge_pending.ts` compris, écrit sous `pending_gold_jobs.json.lock` ; les copies PC et VM
  sont fusionnées offre par offre, jamais écrasées (`mergeBoards`). `PENDING_VALIDATION →
  VALIDATED` appartient à `/valider` du bot Master Plan, hors de ce dépôt
  (`integrations/master-plan/career_bot_engine.valider.patch.md`).

Chaque liaison `triggers/*.json` lance un workflow qui existe, avec `overlap: skip` ou
`queue` : deux écouteurs ne se doublent pas.

**Portes :** `validate.ts` (présence des tests, déclencheurs), `verify-block.sh` (exécute les
tests) · **Fixtures :** `trigger-overlap`, `trigger-unknown-workflow`

## Ce qui a changé depuis le harness v0

Les six règles viennent de `archive/harness-v0/RULES.md` ; quatre changent de sens, exprès :

- **R3.** En v0, `verified` exigeait un fichier de preuve. Ici la preuve d'une exécution réelle
  marque `PROUVÉ` ; `VERIFIED` est ce qui se prouve sans modèle (tests, validation,
  fixtures et leurs issues). La fixture v0 `verified-without-proof` devient `proven-without-proof`.
- **R4.** En v0, `validate.js` vérifiait les références et les cycles ; ici c'est
  `archon validate`, avec ses propres violations connues (`missing-command`,
  `missing-include` qui remplace `missing-block`, `cycle`).
- **R5.** En v0, `build.js` générait les YAML Archon depuis `blocks/*.json` et
  `workflows/*.json`. Ici les YAML sont les sources, écrites à la main et validées par Archon ;
  seul `harness.json` est généré.
- **R6.** En v0, `board/board.json` avait les colonnes `NEW / PICKED_UP / DONE` et chaque
  carte nommait son workflow. Ici le tableau vit dans l'état Archon (`board/<id>`, voir
  `systems/board-listener/README.md`), ses transitions sont du code testé, et, comme en v0,
  chaque carte nomme son système (`--workflow`, `pipeline` par défaut) dans une liste
  d'autorisation (`BOARD_WORKFLOWS`) ; un nom inconnu est refusé à l'ajout.
