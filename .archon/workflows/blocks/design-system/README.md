# Bloc `design-system`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : le design system d'un projet du Studio, en deux fichiers : `tokens.json` (couleurs
par rôle en clair et en sombre, polices, échelle typographique, espacements, rayons,
composants avec leurs jetons et leurs états) et `design-system.md` (Intention, Couleurs,
Typographie, Espacements, Composants, Règles d'usage). Part de l'existant que liste le
cadrage (un `Theme.swift`, une CSS, un contrat de design).

## Ce que le code vérifie (`.shared/studio-checks.ts`, testé)

- **Accessibilité mesurée** : contrastes WCAG dans chaque thème, `fg` sur `bg` et `surface`
  et `muted` sur `bg` ≥ 4,5:1, `accent` sur `bg` ≥ 3:1.
- Les deux thèmes ont les mêmes rôles, en `#rrggbb`.
- Échelle typographique d'au moins 5 tailles, croissante, chaque pas entre ×1,05 et ×1,7,
  une taille de corps entre 14 et 18 px ; espacements sur une grille de 2, 4 ou 8 px.
- Chaque composant n'utilise que des jetons définis, a un état `default`, et un `focus`
  dès qu'il est interactif ; au moins 3 composants pour un site ou une app.
- La doc décrit chaque composant par ses jetons, jamais par une couleur brute.

## Ce que le juge tranche

La direction sert-elle le brief et l'existant, ou est-ce un look générique ? Les composants
couvrent-ils les livrables ? Les règles d'usage permettent-elles de refuser un écran ?

## Entrées / sortie

`request` (obligatoire), `context`, `type`, `tokens_out`, `out` → verdict typé.

## Vérifier

`scripts/verify-block.sh design-system`.
