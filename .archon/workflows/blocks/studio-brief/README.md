# Bloc `studio-brief`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la porte 0 d'un projet du Studio. Produit `BRIEF.md` : Problème, Cible, Contexte
d'usage, Hors-champ, Appétit, Plateforme, Critères de réussite. Lit le type dans
`calibrage.json` quand `type` est vide.

## Ce que le code vérifie (`.shared/studio-checks.ts`, testé)

Titre ; les sept sections ; 600 à 6 000 caractères (lu en deux minutes) ; au moins trois
éléments hors champ et deux critères de réussite en liste ; une plateforme du type calibré
nommée dans « Plateforme » ; aucun marqueur de brouillon.

## Ce que le juge tranche

Le problème est-il celui du demandeur ? Rien d'inventé (cible, délai, budget) ? Les coupes
sont-elles de vrais choix ? Chaque critère se vérifie-t-il par oui ou non ? Le brief
contredit-il le cadrage ?

## Entrées / sortie

`request` (obligatoire), `context`, `type`, `out` → verdict typé.

## Vérifier

`scripts/verify-block.sh studio-brief`.
