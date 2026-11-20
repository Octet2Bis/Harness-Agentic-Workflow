# Portes du dépôt

Les règles exécutables de `RULES.md` : `validate.ts` (R1, R2, R3, R5, R6 en lecture statique),
`build-harness.ts --check` (R5), `fixture-outcomes.ts` (ce que rend chaque fixture, R3) et le
méta-test `test-gates-can-fail.ts`, qui rejoue chaque violation connue de `fixtures.ts` sur une
copie du dépôt. `scripts/gates.sh` les enchaîne ; `scripts/verify-block.sh <nom>` vérifie un
workflow, les blocs qu'il inclut (`include:`) et le dépôt.

## Limites connues

- Un juge n'est reconnu que par son nom : une `command:` ou un `id` qui finit par `judge`.
- La règle « le juge porte `when: $<boucle>.output.ok == true` » ne vise que les juges qui dépendent directement de la boucle.
- La règle « fixture `unconverged` au plafond » ne vaut que pour les blocs, et une seule boucle au plafond suffit.
- `checkCounter` lit le texte du contrôle : un `emit` renommé (alias) ou des clés calculées peuvent le tromper.
- Les sous-runs `workflow:` sont hors de `verify-block.sh <nom>` : chacun se vérifie sous son propre nom.
- L'étape 1 de `verify-block.sh` lance tous les tests unitaires du dépôt, pas seulement ceux du workflow.
- Aucune porte ne compare la colonne « Fixtures » de `blocks/REGISTRY.md` aux fichiers `fixtures/*.stubs.yaml`.
