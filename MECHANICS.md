# MECHANICS.md — Procédures

> **Rang 2.** Comment un bloc naît, se vérifie, se prouve et entre dans un système.

## Les trois acteurs

| Acteur | Force | Limite | Place |
| :--- | :--- | :--- | :--- |
| Humain | meilleur vérificateur | goulot d'étranglement | en bout de chaîne, et avant tout ce qui sort du dépôt |
| Agent | brillant | probabiliste | là où il apporte de la valeur |
| Code | identique à chaque fois, rapide, bon marché | ne juge pas le flou | partout où c'est possible |

Direction constante : du modèle vers le code.

## 1. De la boucle au bloc

1. **Boucle naïve.** `scripts/new-block.sh <nom>` copie le gabarit ; écrire le prompt de
   l'agent dans `commands/work.md` et l'exécuter à la main (`archon workflow run <nom>
   --input task="…"`) jusqu'à un résultat acceptable. Pour contrôler vite, sans écrire de
   règle : `bun scripts/check.ts has-sections|min-links|min-chars|… <fichier> [arg]`,
   enchaînés par `&&` dans l'`until_bash` de la boucle.
2. **Contrôles.** Chaque critère d'acceptation qu'un script peut trancher devient une règle
   **pure** dans `blocks/.shared/<nom>-checks.ts`, avec son test (un cas qui passe, un cas
   qui doit échouer). Le `scripts/check.ts` du bloc l'appelle et émet `{ ok, problems, … }` ;
   tant que `ok` est faux, l'agent repart avec `problems`. Le script émet aussi `tries`, et
   l'`until_bash` s'arrête au plafond (`[ "$ok" = true ] || [ "$t" -ge N ]`, N =
   `max_iterations`) : la boucle rend toujours la main, le juge est alors sauté et le verdict
   dit `unconverged` (R1, R3).
3. **Juge.** Ce que le code ne tranche pas va à `commands/judge.md` : nœud `context: fresh`,
   lecture seule, modèle `large` par défaut, verdict `approved` + `findings`. Le juge ne voit que le
   livrable, le brief et ce que les contrôles ont établi. Exception décidée par Antoine le
   2026-11-07 (forfait Pro) : les blocs de la candidature (cv-tailor, cover-letter, apply-submit,
   decision-makers, job-triage) jugent en `medium` (Sonnet) ; seul l'agent de cv-tailor rédige en
   `large` (Opus).
4. **Bloc.** `scripts/verdict.ts` dérive `ok` des deux faits certifiés ; `description:` dit
   *Use when / NOT for* ; une fixture par issue dans `fixtures/`, chacune avec sa ligne
   `# attendu: ok=… status=…` ; une ligne `DRAFT` dans `blocks/REGISTRY.md`, puis
   `bun scripts/gates/build-harness.ts` (R5). Le contrat détaillé est dans
   `docs/02-gabarit-de-bloc.md`.

## 2. Vérifier, puis prouver un bloc

| Statut | Ce qu'il faut | Qui le constate |
| :--- | :--- | :--- |
| `DRAFT` | le dossier existe | — |
| `VERIFIED` | `scripts/verify-block.sh <nom>` vert : chaque règle testée à l'unité contre un cas qui doit échouer ; YAML validé par Archon ; une fixture par issue (`verified`, `rejected`, `unconverged`, `outcome-contract`) qui prouve le câblage, agents et lectures disque stubbés ; ce que rend chaque fixture (le vrai `verdict.ts`) comparé à sa ligne `# attendu:` | le code, sans modèle |
| `PROUVÉ` | en plus : une exécution complète sur un cas réel ; le juge a refusé au moins un cas mauvais connu ; les trois faits consignés dans `blocks/proofs/<nom>.md` (un système : `systems/proofs/<nom>.md`) | l'humain, et R3 |

Un bloc modifié repasse en `DRAFT` jusqu'à la vérification suivante ; la date du registre est
celle de la dernière vérification. Les prompts se calibrent au passage `VERIFIED → PROUVÉ`,
sur deux ou trois cas réels, sans rien laisser sortir sans l'humain : `mode=confirm` pour
les candidatures (`apply-submit`, `career-apply`, `career-listener`), et la pause `wait` déjà
en place devant tout autre envoi (le brouillon de PR de `feature-build`).

## 3. Composer un système

Un système (`systems/<nom>/<nom>.yaml`) enchaîne des nœuds :

- `include: <bloc>` — le bloc déplié dans le run (ses nœuds deviennent `<include>__<nœud>`),
  ses entrées via `with:` ;
- `workflow: <nom>` — un sous-run gouverné (un écouteur → sa chaîne), `fan_out:` pour N
  items ;
- `script:` / `bash:` — une étape déterministe ;
- `command:` / `prompt:` — un agent ponctuel (plan, resolve, ship) ;
- `wait: { attention, form: approval }` — la pause humaine. Sur un refus, `cancel:` annule
  le run et le nœud final ne tourne pas (`pipeline`, `research-report`, `feature-build`) ;
  quand un état durable doit garder la trace du refus, le refus devient une issue typée
  (`apply-submit` rend `refused`, que `career-apply` écrit dans `pending_gold_jobs.json`).

`when: "$x.output.ok == true"` enchaîne sur le verdict ; un nœud final `trigger_rule:
all_done` avec `if_skipped: null` rend l'issue typée (`returns: { node: …, outcome: ok }`) quand
ses producteurs ont réussi ou ont été sautés. Archon ne laisse jamais une liaison lire un
nœud en échec : un nœud hors bloc en échec (`plan`, `ship`, `resolve`, un script) fait
échouer aussi le nœud final, et le run finit `failed`. Un bloc, lui, ne finit en échec que
sur une erreur de modèle ou de script : sa boucle s'arrête au plafond et rend `unconverged`. Variantes en parallèle : plusieurs `include:` sans dépendance entre eux
(`design-variants`). Le modèle se fixe par nœud (`model: small | medium | large`) ou par run
(`archon workflow run … --model medium=<fournisseur/modèle>`), pas par entrée. Le run tourne
dans un worktree Archon par défaut ; seuls `implement` et `feature-build` modifient le dépôt.

Puis, comme pour un bloc : une fixture par issue avec sa ligne `# attendu:`, une ligne dans
`blocks/REGISTRY.md`, `bun scripts/gates/build-harness.ts`, et `scripts/gates.sh` vert.

## 4. Brancher un déclencheur

Un message (Telegram, Slack, un script) devient une carte `NEW`
(`bun .archon/workflows/systems/board-listener/scripts/board.ts add "<tâche>"
[--workflow=pipeline|research-report|feature-build|design-variants] [--source=<origine>]`) ou un statut
`VALIDATED` dans `pending_gold_jobs.json`. Un écouteur (`board-listener`, `career-listener`)
la prend, lance en sous-run le système demandé par la carte (un nœud `workflow:` par système,
gardé par `when:`), puis la marque `done` / `failed` (ou relaie le statut
écrit par `career-apply`). Un sous-run refusé ou en échec ne laisse jamais une carte prise :
le dernier nœud de `board-listener` (`settle`, `all_done`, qui ne lit que la prise) la marque
`failed` ; `archon workflow resume <écouteur>` reprend le même sous-run là où il a échoué, et
`board.ts done | fail | requeue <id>` la reprend à la main. `board-listener` et ses quatre
systèmes ne prennent pas le verrou du dossier (`mutates_checkout: false`, ou leur worktree) ;
Archon annule au départ et à chaque reprise un run qui le prend si un run plus ancien est actif
dans ce dossier, donc `claim` laisse les cartes NEW (`waiting`) tant qu'un tel run y est actif.

Deux runs ne prennent jamais la même : `board-listener` écrit par `patch --if-revision` (une
écriture conditionnelle) ; `career-listener` et `career-apply` réécrivent
`pending_gold_jobs.json` sous son verrou (`pending_gold_jobs.json.lock`), une candidature en
vol à la fois, et `overlap: skip` empêche deux tours, en pause compris. Un `career-apply` lancé
à la main prend lui-même l'offre (`APPLYING`), donc il est sûr même timer en marche.
`archon trigger fire` rend la main dès le run lancé : le `push` de `sync_pending.ps1` tourne
pendant le tour, sous le même verrou, et fusionne les copies PC et VM offre par offre ; un
statut écrit après part au tour suivant. Un go se donne dans les deux heures ; au-delà, le run
ne clique plus et l'offre se revalide par `/valider`. La liaison timer est un JSON
dans `triggers/` (`archon trigger fire --config`, Planificateur de tâches Windows ;
`archon trigger whoami` donne `runAsUserId`). L'humain ne vérifie qu'à la fin — et avant tout
ce qui sort du dépôt.

## 5. Mise à l'échelle

| Palier | Isolation | Quand |
| :--- | :--- | :--- |
| Séquentiel | aucune (`--no-worktree`) | prototype, un bloc à la main |
| Parallèle | un worktree par run (Archon), un `include:` par variante | plusieurs variantes d'un même livrable, plusieurs offres |
| Sandboxes | une VM ou un conteneur par run ; un profil de navigateur isolé (`.local/`) pour les formulaires | actions risquées, calcul saturé |
