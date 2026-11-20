# Bloc `design`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

## Ce qu'est un bloc

Un bloc est un workflow Archon empaqueté (`<pack>/<workflow>/<workflow>.yaml` avec ses
`commands/`, `scripts/` et `fixtures/`) qui suit la boucle du reel « agentic engineering » :

```
            ┌───────────────────────── produce (loop_group, 3 tours max) ─────────────────────────┐
  task ───▶ │  work (agent) ──▶ deliverable.md ──▶ check (script) ──▶ ok ? ──non──▶ problems ──┐  │
            │       ▲                                                                            │  │
            │       └────────────────────────────────────────────────────────────────────────────┘  │
            └──────────────────────────────────────────────────────────────────────────────┬────────┘
                                                                                      oui  │
                                                                                           ▼
                                                        judge (agent, contexte vierge, lecture seule)
                                                                                           │
                                                                                           ▼
                                                           verdict (script) ──▶ { ok, status, deliverable }
```

| Acteur du reel | Dans le bloc | Champ Archon |
|---|---|---|
| L'agent (brillant, probabiliste) | `work` | `command:` + `output_format` |
| Le code (même résultat à chaque fois) | `check` | `script:` + `until_bash` de la `loop_group` |
| Le juge en contexte vierge | `judge` | `command:` + `context: fresh` + `mutates_checkout: false` + `model: large` |
| Le badge VERIFIED | `verdict` | `returns: { node: verdict, outcome: ok }` |

## Contrat

- Entrées : `task` (obligatoire), `context` (facultatif).
- Sortie (`$<id>.output` chez l'appelant) : `{ ok, status: verified|rejected|unconverged, summary, problems, findings, deliverable }`.
- Livrable : `$ARTIFACTS_DIR/deliverable.md`, pointé par `deliverable`.
- Issue autorisée du run : `ok` (`succeeded` / `failed`), indépendante du statut d'exécution.
- Contrôles encore rouges au plafond (trois tours) : la boucle rend la main (compteur `tries`
  du contrôle), le juge est sauté et le verdict rend `ok: false, status: unconverged` avec
  les derniers `problems`. Le run n'échoue que sur une erreur (modèle, script) ; un verdict
  absent se lit alors `null` chez l'appelant (`if_skipped: null`).

## Créer un bloc à partir du gabarit

```bash
scripts/new-block.sh recherche        # copie template/ → blocks/recherche/, renomme le workflow
```

Puis :

1. `commands/work.md` : décris le métier (ce que l'agent produit, dans quel format).
2. `scripts/check.ts` : adapte `RULES` (sections attendues, longueur minimale), ajoute des
   contrôles propres au métier dans `.shared/` s'ils resservent.
3. `commands/judge.md` : dis au juge ce qui compte pour ce métier.
4. `fixtures/` : une fixture par issue (`verified`, `rejected`, `unconverged`, …), jamais une par chemin.
5. `scripts/verify-block.sh <nom>` : tests unitaires des contrôles, `archon validate`,
   `archon workflow test`, puis les sorties rendues comparées aux lignes `# attendu:`
   des fixtures. Tout vert = le bloc peut passer de DRAFT à **VERIFIED** dans `blocks/REGISTRY.md`.

## Ce que les fixtures prouvent, et ce qu'elles ne prouvent pas

- `verified`, `rejected` et `unconverged` exécutent le vrai `verdict.ts` (`exec-code: true`) : le câblage
  `work → check → judge → verdict` et la dérivation de `ok` sont prouvés sans modèle.
- `outcome-contract` stubbe aussi `verdict` : la simulation lit alors l'issue autorisée et
  doit rapporter `succeeded`.
- La boucle `until_bash` n'est pas exécutée en simulation (Archon suppose la boucle finie
  au premier tour) : `unconverged` stubbe donc `check` dans l'état du dernier tour (`ok:
  false`, `tries` au plafond) et prouve que le juge est sauté et que le verdict le dit.
  L'arrêt au plafond lui-même (`until_bash` lit `tries`, plafond = `max_iterations`) est
  contrôlé par `scripts/gates/validate.ts` (R1). Une boucle épuisée finirait `failed`, sans
  verdict, et Archon la rejouerait quand un run reprend après une pause humaine. Les contrôles eux-mêmes
  sont testés à l'unité (`.shared/deliverable-checks.test.ts`).

## Conventions (héritées d'Archon)

- Le YAML coordonne, le code calcule, l'agent juge (`workflow-language-constitution.md`).
- Sorties typées, petites ; chaque run finit sur une issue lisible (`CONSTITUTION.md` du pack sdlc).
- Un script lit ses liaisons sous la forme littérale `process.env.INPUTS_<NOM>`.
- Jamais de `process.exit()` dans un script.
