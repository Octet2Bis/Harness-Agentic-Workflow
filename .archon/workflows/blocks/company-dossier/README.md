# Bloc `company-dossier`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : avant toute prospection d'une entreprise validée full remote, un dossier de deux
pages (Activité, Concurrents, Signaux récents, Recrutement, Besoins probables, Contact,
Sources) qui permet d'écrire un message montrant qu'on a compris leur activité. Le bloc
**n'envoie rien** ; il produit `dossier.md` vérifié.

## Ce que le code vérifie (`.shared/company-checks.ts`, `checkDossier`, testé)

Titre `# Dossier : <entreprise>`, en-têtes `Pays` (code ISO), `Site` (URL) et `Full remote`
sourcé ; sections dans l'ordre ; ≥ 4 sources web distinctes ; chaque puce cite une source
listée ; ≥ 3 concurrents nommés en gras (l'entreprise elle-même ne compte pas) ; signaux datés,
de moins de 12 mois, aucun dans le futur ; 2 à 4 besoins ; ligne `Canal : email | linkedin |
formulaire`, `email` refusé en DE et AT (consentement préalable exigé en pratique) et refusé
sans adresse publiée (jamais d'adresse devinée).

## Ce que le juge tranche

Il rouvre les sources : chaque affirmation est-elle portée par sa source, le full remote
est-il réel, les concurrents sont-ils les bons, les besoins découlent-ils des signaux, le
contact a-t-il été publié par l'entreprise (pas d'adresse devinée, rien tiré de LinkedIn).

## Entrées / sortie

`company` (JSON texte, obligatoire), `today` (AAAA-MM-JJ), `out` (`dossier.md`) → verdict typé
`{ ok, status, summary, problems, findings, deliverable }`.

## Vérifier

`scripts/verify-block.sh company-dossier`.
