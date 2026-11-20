# Bloc `offer-angle`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : à partir d'un dossier d'entreprise vérifié (`company-dossier`) et du profil du
candidat, ce qu'il peut leur proposer : 1 ou 2 axes d'intervention, un mini-diagnostic d'une
page (le document vers lequel pointent les messages) et l'accroche du premier message. Le
bloc **n'envoie rien** ; il produit `proposal.md` vérifié.

## Ce que le code vérifie (`.shared/company-checks.ts`, `checkProposal`, testé)

Titre `# Proposition : <entreprise>` ; 1 ou 2 axes `### …` ; pour chacun un besoin cité mot
pour mot de `## Besoins probables` du dossier, une preuve citée mot pour mot du profil (≥ 12
caractères), une formule acceptée par le candidat (`formulas`, par défaut CDI, freelance,
portage) ; mini-diagnostic de 150 à 350 mots ; accroche d'au moins 15 mots et 280 caractères au plus (elle sert aussi de note de connexion LinkedIn), avec une seule question.

## Ce que le juge tranche

La preuve répond-elle au besoin, rien n'est-il promis que le profil ne dit pas, le
mini-diagnostic est-il propre à cette entreprise, l'accroche est-elle celle d'un pair.

## Entrées / sortie

`company` (JSON texte), `dossier` (`dossier.md` dans les artefacts), `profile` (chemin absolu),
`formulas`, `out` (`proposal.md`) → verdict typé `{ ok, status, summary, problems, findings, deliverable }`.

## Vérifier

`scripts/verify-block.sh offer-angle`.
