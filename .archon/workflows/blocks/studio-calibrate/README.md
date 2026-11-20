# Bloc `studio-calibrate`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la porte d'entrée du Studio (UC-14, pilier dev & design). Avant tout design, le
projet est calibré : **purement graphique**, **site** ou **app**. Le type fixe la route
(tronc commun brief → design system → base de contenu, puis la ligne du type, puis QA
finale → go → diffusion). Produit `calibrage.json`.

## Ce que le code vérifie (`.shared/studio-checks.ts`, testé)

Type parmi les trois ; au moins une citation, chacune mot pour mot dans la demande ou le
contexte (8 caractères au moins) ; livrables nommés ; plateformes compatibles avec le type
(un site vit sur le web, une app nomme iOS, Android, web ou desktop) ; fichiers existants
trouvés dans `project_dir` ; route identique à celle du type (`routeFor`).

## Ce que le juge tranche

Le type est-il le bon (une landing d'app est un site) ? Les citations décident-elles
vraiment ? Manque-t-il un livrable majeur ? L'ambiguïté est-elle dite ?

## Entrées / sortie

`request` (obligatoire), `context`, `project_dir`, `out` → verdict typé. Le système
`studio` l'enchaîne avec `studio-brief`, `design-system` et `content-base`.

## Vérifier

`scripts/verify-block.sh studio-calibrate`.
