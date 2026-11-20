# Bloc `outbound-sequence`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la séquence de cold e-mails du pôle **04 Outbound & CRM** de Master Plan (3-4
touches < 120 mots, pair-à-pair, un angle neuf par touche, break-up courtois), pour un
brief + ICP + preuves. Le bloc **n'envoie rien** ; il produit `sequence.md` vérifié.

## Ce que le code vérifie (`.shared/email-checks.ts`, 5 tests)

Les règles que `email_linter.py` et `ai_slop_linter.py` portaient dans Master Plan, ici
dans la boucle : nombre de touches, objet ≤ 60 caractères, corps ≤ 120 mots, aucune variable
`{{…}}`, aucun mot déclencheur de spam (FR/EN), au plus un `!`, pas de majuscules criées,
une question par touche (≤ 2), angles distincts (similarité de vocabulaire ≤ 50 %), dernière
touche = break-up, pas de phrase creuse, section `## Notes` (signal, cadence, cible Gold ≥ 85). Avec `notice: "true"` (prospection à
froid de personnes, France / UE) : chaque touche offre un « stop » simple et la première dit
d'où vient l'adresse (RGPD art. 14).

## Ce que le juge tranche

La vérité de chaque affirmation (preuves seulement), la pertinence du signal, la force de la
preuve, le ton de pair, une demande à laquelle on répond d'un mot.

## Entrées / sortie

`brief` (obligatoire), `icp`, `proofs`, `touches` (4), `max_words` (120), `notice` (`false`), `out` → verdict
typé `{ ok, status, summary, problems, findings, deliverable }`. Si les contrôles sont encore rouges au dernier tour, le juge est sauté et le verdict
rend `ok: false, status: unconverged` avec les derniers problèmes.

Dans Master Plan, le système appelant (à écrire : `gtm-campaign`) enregistre la séquence
vérifiée dans `Workspace/campaigns/<campagne>/outbound/` après la vérification humaine, et
l'envoi reste dans Lemlist/Brevo avec le prévol DNS (`dns_check.py`, verifiers) en amont.

## Vérifier

`scripts/verify-block.sh outbound-sequence`.
