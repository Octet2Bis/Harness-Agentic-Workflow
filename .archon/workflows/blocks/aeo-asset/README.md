# Bloc `aeo-asset`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : l'actif de contenu du pôle **02 Acquisition & AEO** de Master Plan — une page ou un
article qui répond à une intention de recherche, citable par les moteurs de réponse, avec
son bloc JSON-LD Schema.org. Produit `asset.md` (Markdown + ```json JSON-LD en fin de fichier).

## Ce que le code vérifie (`.shared/aeo-checks.ts`, 4 tests)

Ce que `schema_validator.py` et la règle du pôle (« tout actif inclut son JSON-LD validé »)
exigeaient, dans la boucle : JSON-LD qui parse, `@context` schema.org, `@type` connu, champs
obligatoires par type, `FAQPage` avec ≥ 3 Question/Answer, un seul H1, ≥ 2 H2, pas de saut de
niveau, intention restituée dans les 1 200 premiers caractères, ≥ 1 500 caractères de corps,
pas de phrase creuse ni de marqueur de brouillon.

## Ce que le juge tranche

La page répond-elle à l'intention en premier ? Les affirmations produit viennent-elles du
positionnement ? Les entités sont-elles précises, la FAQ réelle, la densité sans bourrage ?

## Entrées / sortie

`brief` (obligatoire), `intent`, `positioning`, `type` (Article), `out` → verdict typé. Si les contrôles sont encore rouges au dernier tour, le juge est sauté et le verdict
rend `ok: false, status: unconverged` avec les derniers problèmes. Le
système appelant enregistre l'actif vérifié sous `Workspace/campaigns/<campagne>/acquisition/`
après la vérification humaine ; la mesure (`gtm-tracking-plan`) se pose à la publication.

## Vérifier

`scripts/verify-block.sh aeo-asset`.
