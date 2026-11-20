# 02 — Le gabarit de bloc

Un **bloc** est l'unité de travail du reel : un métier, une boucle, un badge. Il est
implémenté comme un workflow Archon empaqueté (`blocks/<nom>/<nom>.yaml` + `commands/` +
`scripts/` + `fixtures/`), copié depuis `blocks/template/`.

## La boucle

```
task ─▶ ┌ produce (loop_group, 3 tours max, contexte vierge à chaque tour) ┐
        │  work (agent) ─▶ <out>.md ─▶ check (script) ─ ok ? ─non─▶ problems ┐│
        │     ▲                                  (ou tries = 3 : sortie)     ││
        │     └──────────────────────────────────────────────────────────────┘│
        └─────────────── oui ─────────────────────── plafond ─────────────────┘
                          ▼                              │
     judge (agent, context: fresh, lecture seule,        │ (juge sauté)
            modèle large ; when: ok == true)             │
                          ▼                              ▼
                 verdict (script) ─▶ { ok, status: verified | rejected | unconverged, … }
```

| Rôle du reel | Nœud | Ce qui le rend déterministe ou vérifiable |
|---|---|---|
| L'agent, brillant mais probabiliste | `work` | `output_format` typé ; reçoit les `problems` du tour précédent (`$LOOP_PREV`) |
| Le code, même résultat à chaque fois | `check` | script pur, **testé à l'unité** ; `until_bash` relance tant que `ok` est faux et que `tries` n'a pas atteint le plafond |
| Le juge, en contexte vierge | `judge` | `context: fresh`, `allowed_tools: [Read, Glob, Grep]`, `mutates_checkout: false`, `model: large` ; ne voit que le livrable |
| Le badge VERIFIED | `verdict` | `ok = check.ok && judge.approved` ; `unconverged` si les contrôles sont rouges au plafond ; `trigger_rule: none_failed_min_one_success` ; `returns: verdict`, `outcome_field: ok` |

## Le contrat

| | |
|---|---|
| Entrées | `task` (obligatoire), `context` (facultatif), `out` (nom du livrable, défaut `deliverable.md`) |
| Livrable | `$ARTIFACTS_DIR/<out>`, pointé par `deliverable: { type: archon_artifact, run_id, path }` |
| Sortie | `{ ok, status, summary, problems[], findings[{severity, text}], deliverable }` |
| Issue du run | `succeeded` / `failed` selon `ok`, indépendante du statut d'exécution |
| Coût borné | 3 tours (compteur `tries` + `max_iterations: 3` en garde-fou), un seul passage de juge, modèle par nœud (`small` / `medium` / `large`) |
| Rien ne finit muet | contrôles rouges au plafond → `unconverged` ; le run n'échoue que sur une erreur (modèle, script), et l'appelant lit alors `null` (`if_skipped: null`) |

Un bloc ne modifie pas le dépôt : il écrit son livrable dans ses artefacts
(`$ARTIFACTS_DIR`), et son juge déclare `mutates_checkout: false`, que le moteur vérifie
(`git status` avant et après le nœud). Seule exception, `implement`, dont c'est le métier :
il édite le code dans le worktree du run. C'est ce qui permet d'en lancer plusieurs en parallèle dans
un même run (`include:`) ou chacun dans son sous-run isolé (`workflow:` + `isolation: worktree`).

## Le cycle de vie

```
new-block.sh <nom> ──▶ DRAFT ──▶ verify-block.sh <nom> tout vert ──▶ VERIFIED (REGISTRY.md, date)
                                        │                                      │
                           bloc modifié ┘ (repasse en DRAFT)     run réel + juge éprouvé + proofs/<nom>.md
                                                                                │
                                                                                ▼
                                                                             PROUVÉ (R3)
```

`verify-block.sh` ne dépense aucun jeton :

1. `bun test` sur les contrôles (`.shared/*.test.ts`, `scripts/*.test.ts`) : le code qui
   juge le livrable est lui-même testé, exigence explicite du reel ;
2. `archon validate workflows <nom>` : le YAML, les liaisons, les contrats de sortie (R4) ;
3. `archon workflow test <nom>` : les fixtures, **une par issue** (`verified`, `rejected`,
   `unconverged`, `outcome-contract`), qui exécutent les vrais scripts (`exec-code`) avec des
   agents stubbés ;
4. `scripts/gates/fixture-outcomes.ts <nom>` : ce que rend chaque fixture comparé à sa ligne
   `# attendu:`.

`PROUVÉ` demande ce que le code ne peut pas simuler : une exécution complète sur un cas réel
et un juge qui a refusé un cas mauvais connu, consignés dans `blocks/proofs/<nom>.md`
(`RULES.md` R3, `MECHANICS.md` § 2). Les règles R1 et R2 (`scripts/gates/validate.ts`)
garantissent la forme de la boucle et du juge pour tout bloc, quel que soit son statut.

## Les règles d'écriture (héritées d'Archon)

- Le YAML coordonne, le code calcule, l'agent juge.
- Sorties petites et typées ; chaque run finit sur une issue lisible.
- Un script lit ses liaisons sous la forme littérale `process.env.INPUTS_<NOM>` ; jamais de `process.exit()`.
- Les contrôles communs vivent dans `blocks/.shared/`, les contrôles métier dans `scripts/check.ts`.
- `description:` en français, avec « Use when / NOT for », pour que l'orchestrateur (ou un
  humain) sache quand choisir ce bloc.

## Ce que le gabarit ne couvre pas (encore)

- Les tours successifs ne sont pas simulables (`until_bash` n'est pas exécuté en dry-run) :
  la fixture `unconverged` stubbe `check` dans l'état du dernier tour, et la forme de
  l'`until_bash` (arrêt au plafond par `tries`) est contrôlée par `validate.ts` (R1).
- Pourquoi un compteur plutôt que `max_iterations` seul : une boucle épuisée finit `failed`,
  et quand un run reprend après une pause humaine (go, choix), Archon réexécute tout nœud en
  échec (`continuation-resume.ts` → `executor.ts`, liste des nœuds terminés seulement). Vérifié
  par un test sur le moteur le 2026-10-20.
- Le juge n'a pas de deuxième avis ; un panel (`fan_out`) est possible si un métier l'exige.
- Les prompts `work.md` / `judge.md` des pilotes n'ont pas encore tourné sur un vrai modèle.
