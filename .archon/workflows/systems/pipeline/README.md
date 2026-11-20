# Système `pipeline` — enchaîner les blocs, humain à la fin

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Le pipeline enchaîne les trois blocs pilotes dans un seul run : la recherche nourrit la
conception, la conception nourrit le rapport, et l'humain n'intervient qu'à la fin,
comme dans le reel. Chaque bloc garde sa propre boucle agent → contrôle → juge.

```
task ──▶ research ──ok──▶ design ──ok──▶ report ──ok──▶ review (humain) ──approve──▶ done { ok: true }
            │                │               │                 │
      pas convergé     pas convergé    pas convergé         reject ──▶ drop (run annulé)
        ou rejeté        ou rejeté       ou rejeté
    ou sans verdict  ou sans verdict  ou sans verdict
            └────────────────┴───────────────┴──────▶ done { ok: false, stage: <bloc> }
```

| Nœud | Type | Rôle |
|---|---|---|
| `research`, `design`, `report` | `include:` d'un bloc | le bloc entier, aplati dans ce run (un seul run, un seul dossier d'artefacts) |
| `review` | `wait: { attention, form: approval }` | la seule pause humaine : `archon workflow approve <run-id>` ou `respond <run-id> reject "pourquoi"` |
| `drop` | `cancel:` | annule le run quand l'humain refuse |
| `done` | `script:` | clôt sur une issue typée (`trigger_rule: all_done`, `if_skipped: null`), sauf refus humain (run annulé) ou échec du script `verdict` d'un bloc (voir Contrat) ; l'humain n'est jamais son étape (voir Contrat) |

## Contrat

- Entrées : `task` (obligatoire), `context` (facultatif).
- Sortie : `{ ok, stage: research|design|report|done, summary, deliverables: { research, design, report } }`.
- Livrables : `$ARTIFACTS_DIR/research.md`, `design.md`, `report.md` (chaque bloc reçoit son
  nom de fichier via l'entrée `out`).
- Issue autorisée du run : `ok`. Un refus humain annule le run (`cancelled`). Un bloc qui
  ne rend pas `ok: true` arrête la chaîne : `done` rend `ok: false`, `stage` = le bloc, et
  `summary` dit lequel des trois cas s'est produit :
  - **pas convergé** (verdict `status: unconverged`) : au dernier tour permis de sa boucle,
    ses contrôles disent encore non ; la boucle rend la main à son plafond (compteur
    `tries`), son juge est sauté. Le run se termine `completed` : « Research did not
    converge: » suivi du résumé du bloc, qui le dit déjà (« Checks still failing after
    4 round(s); the judge did not run. … ») ;
  - **rejeté** (verdict `status: rejected`) : contrôles verts, son juge refuse. Le run se
    termine `completed` : « Research rejected: … » ;
  - **sans verdict** (verdict null) : un de ses nœuds a échoué (erreur du modèle ou d'un
    script, le juge par exemple), alors son verdict est sauté. Ce n'est jamais un défaut de
    convergence. Le run finit `failed`, et `done` rend quand même son issue typée : « …
    returned no verdict: one of its nodes failed (a model or script error), so its verdict
    was skipped. ».
- Sans issue typée : si le script `verdict` d'un bloc échoue lui-même (et non un nœud avant
  lui), `done` échoue avec lui, car une liaison Archon ne lit jamais un nœud en échec
  (`if_skipped` ne couvre que le producteur sauté) ; le run finit `failed`.
- L'humain n'est jamais l'étape de `done` : après trois blocs `ok`, `review` tourne
  toujours, un « go » donne `stage: done` et un refus annule le run. Tout autre état n'a pas
  de chemin ; si un YAML changé le produisait, `done` échouerait (« done: unexpected
  state … ») au lieu d'inventer une issue.
- Le rapport est `report.md` dans le dossier d'artefacts du run (`context.artifactsDir` de
  l'élément d'attention ; un message d'attention ne substitue pas `$ARTIFACTS_DIR`).

## Lancer

```bash
archon workflow run pipeline --input task="Faire le point sur X" [--input context="…"]
archon workflow status                                   # paused → review
archon workflow approve <run-id>
archon workflow respond <run-id> reject "la reco ignore le budget"
```

## Pourquoi `include:` et pas `workflow:`

`include:` aplatit les blocs dans le run : un seul identifiant, des artefacts côte à côte,
des fixtures qui prouvent tout le câblage d'un coup, aucun coût de sous-run. `workflow:`
(sous-run gouverné, isolation `worktree` possible) est réservé à ce qui doit vivre seul :
c'est ce que fait `board-listener`, qui lance ce pipeline comme enfant.

## Ce que les fixtures prouvent

- `approved` : les trois verdicts ok, l'humain approuve (stub de `review`), `done.ts` tourne
  pour de vrai (`exec-code`) et rend `ok: true`.
- `rejected-by-human` : refus à `review` → `drop` atteint, run `cancelled`, `done` jamais
  atteint : sans l'annulation, `done` tournerait (un nœud `all_done` sans stub reçoit un
  substitut) et le run finirait `completed`.
- `research-rejected` : verdict `ok: false`, `status: rejected` → `design`, `report`,
  `review` sautés, `done.ts` rend `ok: false`, `stage: research`.
- `research-unconverged` : le stub `check` dit `ok: false` au 4e et dernier tour
  (`tries: 4`) → le juge de research est sauté, `research__verdict` (réel) rend
  `status: unconverged`, `design`, `report` et `review` sont sautés, run `completed`,
  `done.ts` rend `ok: false`, `stage: research`. L'absence de stub ne prouverait pas que
  `design` est sauté : atteint, il tournerait sur les stubs nus `work`/`check` partagés,
  son juge serait sauté et son vrai verdict rendrait `unconverged`, sans « Missing reachable
  stub ». Le stub piège `design__verdict` le prouve (une chaîne que son output_format
  refuse : atteint, il échoue, `done` aussi, et le run finit `failed` ; sauté, Archon
  affiche « unused stubs — design__verdict », attendu). La ligne `# attendu`
  `deliverables=…` où `design` vaut `null` ne sert que si ce piège disparaît : tant qu'il
  est là, `done` échoue avant de rendre quoi que ce soit.
- `design-rejected` : research passe, le juge de design refuse (verdicts réels) → `report`
  et `review` sautés, run `completed`, `done.ts` rend `ok: false`, `stage: design`. Prouve
  le `when` de `report` : design a réussi avec un verdict `ok: false`, donc sans ce `when`
  `report` tournerait ; le stub `check` dit `ok: true`, son juge serait atteint, et
  `report__judge` n'a pas de stub : le run finirait `failed` (« Missing reachable stub »).
  C'est la seule preuve : ce juge en échec ferait sauter `report__verdict`, et
  `deliverables` dirait encore `report: null`.
- `report-rejected` : research et design passent, le juge de report refuse (verdicts réels)
  → `review` sauté, run `completed`, `done.ts` rend `ok: false`, `stage: report`. Prouve le
  `when` de `review` : sans lui, l'humain recevrait un rapport refusé ; `review` n'a pas de
  stub, et un nœud `wait:` atteint sans stub met le dry-run en pause : il finirait `paused`
  au lieu de `completed`.
- `research-no-verdict` : le juge de research échoue (erreur du modèle, simulée par
  l'absence de stub) → `research__verdict` sauté, run `failed` sur `research__judge`,
  `done.ts` atteint quand même et rend `ok: false`, `stage: research`.

`scripts/done.test.ts` couvre les mêmes cas pour `design` et `report` (chaque test nomme sa
fixture, ou dit ce qui rend le cas possible), et le garde-fou une fois, script lancé pour
de vrai (code 1, rien sur stdout). Retirer un seul `when:` de `pipeline.yaml` fait échouer au
moins une fixture.

Les nœuds de boucle (`work`, `check`) gardent leur id nu dans un include : un seul stub
sert aux trois blocs. Les autres nœuds inclus se stubbent sous `<include>__<nœud>`
(`research__judge`, `design__verdict`, …).

## Limites connues

- Sans verrou de dossier, ce run n'est jamais annulé par le verrou, c'est tout : en cours ou en pause à `review`, il compte encore comme actif dans son dossier, et un run plus récent qui y prend le verrou (un bloc lancé seul, `feature-build --no-worktree`) est annulé (« This worktree is in use »).
- Les agents `work` des blocs ne restent hors du checkout que parce que leur consigne le dit : aucun `mutates_checkout: false` de nœud ne le fait respecter (seuls les juges en ont un).
- Le dry-run ne joue jamais `until_bash` (il tient chaque boucle pour finie après un tour) : seul `scripts/gates/validate.ts` (R1) vérifie qu'une boucle s'arrête à son plafond.
- Si le script `verdict` d'un bloc échoue lui-même, il n'y a pas d'issue typée : `done` échoue avec lui.
- Une étape de boucle en échec (`work` ou `check`) fait échouer sa boucle ; à la reprise, la boucle repart au tour 1, compteur `tries` compris.
