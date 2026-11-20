# Bloc `review`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Porté de la brique `review` du harness v0 d'Antoine (`archive/harness-v0/blocks/review.json`) :
« relire un diff contre le plan et lister les défauts bloquants, sans corriger ». Le verdict
est lu par du code (`review.json`), pas par un humain.

## Ce que le code vérifie (`.shared/review-checks.ts`, 6 tests)

`diff.patch` présent et non vide ; `review.json` : JSON valide, `verdict` ∈ pass | fail,
`summary` lisible, `findings[]` avec `file` présent dans le diff, `severity` ∈ blocking |
minor, `text` qui dit quoi et comment corriger ; un « fail » a au moins un constat bloquant,
un « pass » n'en a aucun. Les fichiers du diff se lisent sur les en-têtes `+++` / `---` et
`rename to` / `copy to` de git, guillemets et échappements compris (chemins avec espaces ou
accents, fichiers supprimés, binaires, renommés).

## Écarts avec la brique v0

Le contrat de `review.json` a été renommé ; un consommateur écrit pour v0 doit suivre :

| v0 (`archive/harness-v0/.archon/commands/review-agent.md`) | ici |
|---|---|
| `verdict: "approve"` | `verdict: "pass"` |
| `verdict: "changes"` | `verdict: "fail"` |
| constat `issue` | constat `text` |
| constat `blocking: true / false` | constat `severity: "blocking" / "minor"` |
| — | `summary` (obligatoire), lu par l'humain avant l'expédition |

v0 ne contrôlait que le JSON et la présence de `verdict` et `findings` ; ici le code vérifie
aussi la cohérence verdict ↔ constats et que chaque constat vise un fichier du diff.

## Ce que le juge tranche

Les constats bloquants sont-ils réels dans le diff ? Un défaut évident a-t-il été omis
(chemin d'erreur, test vide, tâche du plan sautée, secret, hors périmètre) ?

## Sortie

`{ ok, status: verified|rejected|unconverged, code_verdict: pass|fail|unknown, summary,
problems, findings, deliverable }` : `ok` dit si la relecture est fiable ; `code_verdict` ce
qu'elle conclut du code. Le système `feature-build` montre les deux à l'humain avant
d'expédier.

- `verified` : contrôles verts, juge favorable ; `code_verdict` est celui de `review.json`.
- `rejected` : contrôles verts, juge défavorable (`ok: false`) ; `code_verdict` est celui de
  `review.json`, que le juge a récusé.
- `unconverged` : `review.json` ne passe toujours pas ses contrôles au plafond (trois tours) ;
  la boucle rend la main (compteur `tries` du contrôle), le juge est sauté et le verdict rend
  `ok: false`, `findings: []`, les derniers `problems` et `code_verdict: unknown` — la valeur
  « inconnu » que le contrat donnait déjà à un `review.json` illisible
  (`.shared/review-checks.ts`) : même si le fichier refusé dit « pass » ou « fail », rien
  de fiable n'est dit du code.
- Le run n'échoue que sur une erreur (modèle, script) : le verdict est alors sauté et se lit
  `null` chez l'appelant (`if_skipped: null`).

## Ce que les fixtures prouvent

`verified`, `rejected` et `unconverged` exécutent le vrai `verdict.ts` (`exec-code: true`) ;
`outcome-contract` stubbe aussi `verdict` et prouve la déclaration `returns: { …, outcome: ok }`. Le
dry-run ne joue qu'un tour de boucle : `unconverged` stubbe donc `check` dans l'état du
dernier tour (`ok: false`, `tries: 3`) et, sans stub `judge`, prouve que le juge n'est pas
atteint. L'arrêt au plafond lui-même (`until_bash` lit `tries`, plafond = `max_iterations`)
est contrôlé par `scripts/gates/validate.ts` (R1).

## Vérifier

`scripts/verify-block.sh review`.
