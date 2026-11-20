# Bloc `landing-page`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la page de conversion du pôle **03 Expérimentation & CRO** de Master Plan — un
fichier `index.html` autonome, une promesse, un CTA, le DataLayer posé avant la mise en ligne.

## Ce que le code vérifie (`.shared/landing-checks.ts`, 6 tests)

La règle du pôle (« isolation : un `index.html` autonome ; conformité analytics : conteneur
DataLayer et événement `click_cta` ») et la règle anti-slop visuel, dans la boucle :
`<!doctype html>`, `lang`, viewport, `<title>`, `<meta description>`, un seul `<h1>`,
`window.dataLayer = window.dataLayer || []`, `click_cta` poussé, exactement un
`data-cta="primary"` (lien, bouton ou formulaire), tokens CSS sur `:root`, aucun
`backdrop-filter`/`filter: blur`, aucune ressource chargée d'un autre hôte hors le script
GTM (script, feuille de style, police, `@import`, `url(…)`, image, cadre, média), aucun
`http://`, pas de lorem ipsum ni de TODO, 60 000 caractères au plus. Ce sont les trois
contrôles du bloc `design` du harness v0 (`html`, `autonome`, `poids`), plus ceux du pôle.

## Ce que le juge tranche

La grille CRO (clarté, friction, anxiété, motivation), la mesure (chaque événement du plan
poussé au bon moment, en snake_case) et la checklist visuelle (tokens, grille 8 px, 60-30-10).

## Entrées / sortie

`brief` (obligatoire), `intent`, `tracking_plan`, `template` (le gabarit Swiss Craft de
Master Plan), `out` → verdict typé. Si les contrôles sont encore rouges au dernier tour, le juge est sauté et le verdict
rend `ok: false, status: unconverged` avec les derniers problèmes. Le système appelant enregistre la page vérifiée sous
`Workspace/campaigns/<campagne>/landing_pages/` après la vérification humaine ; l'A/B test
(`ab_test_calculator.py`) vient ensuite, avec sa taille d'échantillon calculée.

## Vérifier

`scripts/verify-block.sh landing-page`.
