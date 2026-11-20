# Bloc `content-base`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la base de contenu d'un projet du Studio, `content.json` : la voix, puis chaque
texte des pages ou des écrans par clé (`home.hero.title`) et par langue, avec sa longueur
maximale. Les pages, les écrans et les visuels prennent leurs mots ici et nulle part
ailleurs.

## Ce que le code vérifie (`.shared/studio-checks.ts`, testé)

Langues distinctes et exactement celles demandées ; voix décrite ; au moins 5 entrées ; clés
pointées en minuscules, uniques ; chaque langue a chaque texte, dans sa longueur ; aucun
marqueur ni `{{variable}}` ; une phrase identique dans toutes les langues est signalée non
traduite ; **aucun chiffre absent du matériau source** (demande, contexte, `BRIEF.md`).

## Ce que le juge tranche

La voix tient-elle ? Chaque langue se lit-elle comme écrite dans cette langue ? Un texte
promet-il plus que la source ? Chaque page ou écran des livrables est-il couvert ?

## Entrées / sortie

`request` (obligatoire), `context`, `locales` (`fr,en` par défaut), `out` → verdict typé.

## Vérifier

`scripts/verify-block.sh content-base`.
