# Système `research-report`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Porté du workflow `research-report` du harness v0 d'Antoine
(`archive/harness-v0/workflows/research-report.json`) : question → recherche sourcée et
jugée → rapport court et jugé → validation humaine. C'est `pipeline` sans l'étape de
décision (`design`).

```
task ──▶ research (bloc) ──ok──▶ report (bloc) ──ok──▶ review (humain) ──approve──▶ done ok
                 └─ pas convergé, rejeté ou sans verdict ───────────────────────▶ done ok:false, stage
                                                              └─ reject ──▶ drop (annulé)
```

Un bloc qui ne rend pas `ok: true` arrête la chaîne : `done` rend `ok: false` avec
`stage` = le bloc, et `summary` dit lequel des trois cas s'est produit.

- **Pas convergé** (verdict `status: unconverged`) : au dernier tour permis de sa boucle,
  ses contrôles disent encore non ; la boucle rend la main à son plafond (compteur `tries`)
  et son juge est sauté. Le run se termine `completed` : « Research did not converge: »
  suivi du résumé du bloc, qui le dit déjà (« Checks still failing after 4 round(s); the
  judge did not run. … »).
- **Rejeté** (verdict `status: rejected`, son juge dit FAIL) : le run se termine
  `completed` : « Research rejected: … ».
- **Sans verdict** (verdict null) : un de ses nœuds a échoué (erreur du modèle ou d'un
  script, le juge par exemple), alors son verdict est sauté. Ce n'est jamais un défaut de
  convergence. Le run finit `failed`, et `done` rend quand même son issue typée : « …
  returned no verdict: one of its nodes failed (a model or script error), so its verdict was
  skipped. ».

Sans issue typée : un refus humain (`drop` annule le run), et l'échec du script `verdict`
d'un bloc lui-même (et non d'un nœud avant lui) : une liaison Archon ne lit jamais un nœud
en échec (`if_skipped` ne couvre que le producteur sauté), `done` échoue avec lui et le run
finit `failed`.

L'humain n'est jamais l'étape de `done` (`stage: research|report|done`) : après deux blocs
`ok`, `review` tourne toujours, un « go » donne `stage: done` et un refus annule le run.
Tout autre état n'a pas de chemin ; si un YAML changé le produisait, `done` échouerait
(« done: unexpected state … ») au lieu d'inventer une issue.

## Écarts avec le v0

- **Juges.** Dans le v0 le juge était consultatif ; ici un FAIL arrête la chaîne avant
  l'humain : le rapport ne part que si la recherche a rendu `ok: true`, la revue humaine
  n'a lieu que si le rapport a rendu `ok: true`, sinon `done` clôt `ok: false` avec
  `stage: research` ou `stage: report`.
- **Sections de la recherche.** `Résumé`, `Constats`, `Sources`, `Limites`, et la question
  reformulée dans le titre `# ` (v0 : `Question`, `Sources`, `Synthèse`, `Limites`).
- **Sources.** Une source peut être une URL, un chemin de fichier ou une commande (v0 : des
  URL seulement).
- **Sections du rapport.** `Synthèse`, `Résultats`, `Recommandations`, `Prochaines étapes`,
  `Sources` (v0 : `En bref`, `Recommandations`, `Sources`).

Gardé du v0 : pour la recherche, 800 caractères au moins, au moins trois sources
distinctes (un identifiant ou un emplacement répété ne compte qu'une fois) et quatre tours
de boucle au plus ; pour le rapport, 6 000 caractères au plus et une section `Sources` avec
au moins une référence.

## Lancer

```bash
archon workflow run research-report --input task="Qu'est-ce qu'on sait de X ?"
archon workflow approve <run-id>        # ou reject, avec ce qu'il faut changer
```

Le rapport est `report.md` dans le dossier d'artefacts du run (`context.artifactsDir` de
l'élément d'attention ; un message d'attention ne substitue pas `$ARTIFACTS_DIR`).

## Vérifier

`scripts/verify-block.sh research-report` — fixtures :

- `approved` : les deux verdicts ok, l'humain approuve, `done` (réel) rend `ok: true`.
- `rejected-by-human` : refus à `review` → `drop` atteint, run `cancelled`.
- `research-rejected` : le juge de research refuse → `report` et `review` sautés, `done`
  rend `ok: false`, `stage: research`.
- `research-unconverged` : le stub `check` dit `ok: false` au 4e et dernier tour
  (`tries: 4`) → le juge de research est sauté, `research__verdict` (réel) rend
  `status: unconverged`, `report` et `review` sont sautés, run `completed`, `done` rend
  `ok: false`, `stage: research`. L'absence de stub ne prouverait pas que `report` est
  sauté : atteint, il tournerait sur les stubs nus `work`/`check` partagés, son juge serait
  sauté et son vrai verdict rendrait `unconverged`, sans « Missing reachable stub ». Le
  stub piège `report__verdict` le prouve (une chaîne que son output_format refuse :
  atteint, il échoue, `done` aussi, et le run finit `failed` ; sauté, Archon affiche
  « unused stubs — report__verdict », attendu). La ligne `# attendu` `deliverables=…` où
  `report` vaut `null` ne sert que si ce piège disparaît : tant qu'il est là, `done` échoue
  avant de rendre quoi que ce soit.
- `research-no-verdict` : le juge de research échoue (erreur du modèle, simulée par
  l'absence de stub) → `research__verdict` sauté, run `failed` sur `research__judge`, `done`
  rend quand même `ok: false`, `stage: research`.
- `report-rejected` : research passe, le juge de report refuse (verdicts réels) → `review`
  sauté, run `completed`, `done` rend `ok: false`, `stage: report`. Prouve le `when` de
  `review` : report a réussi avec un verdict `ok: false`, donc sans ce `when` l'humain
  recevrait un rapport refusé ; `review` n'a pas de stub, et un nœud `wait:` atteint sans
  stub met le dry-run en pause : il finirait `paused` au lieu de `completed`.

`scripts/done.test.ts` couvre les mêmes cas pour le bloc `report` (chaque test nomme sa
fixture, ou dit ce qui rend le cas possible), et le garde-fou une fois, script lancé pour
de vrai (code 1, rien sur stdout). Retirer un seul `when:` de `research-report.yaml` fait
échouer au moins une fixture.

## Limites connues

- Sans verrou de dossier, ce run n'est jamais annulé par le verrou, c'est tout : en cours ou en pause à `review`, il compte encore comme actif dans son dossier, et un run plus récent qui y prend le verrou (un bloc lancé seul, `feature-build --no-worktree`) est annulé (« This worktree is in use »).
- Les agents `work` des blocs ne restent hors du checkout que parce que leur consigne le dit : aucun `mutates_checkout: false` de nœud ne le fait respecter (seuls les juges en ont un).
- Le dry-run ne joue jamais `until_bash` (il tient chaque boucle pour finie après un tour) : seul `scripts/gates/validate.ts` (R1) vérifie qu'une boucle s'arrête à son plafond.
- Si le script `verdict` d'un bloc échoue lui-même, il n'y a pas d'issue typée : `done` échoue avec lui.
- Une étape de boucle en échec (`work` ou `check`) fait échouer sa boucle ; à la reprise, la boucle repart au tour 1, compteur `tries` compris.
