# Bloc `cv-tailor`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : à partir d'une **offre validée** et du **profil maître**, écrire le dossier de
candidature sur mesure — `CV.md` (une page), `pitch.md` (message au décideur),
`candidate.json` (ce que le remplisseur de formulaire tapera). Il remplace le gabarit
figé de `cv_tailor_engine.py` (Master Plan) par la boucle Drafter → contrôles → Reviewer
que décrivait déjà le skill `career-job-hunter`, sans jamais quitter le périmètre du profil.

```
offer + profile ─▶ work (Drafter) ─▶ CV.md, pitch.md, candidate.json ─▶ check (code) ─┐
                      ▲                                                               │ non → problems
                      └──────────────────────────── (3 tours au plus) ────────────────┘
                                                                                oui ▼
                                              judge (Reviewer, contexte vierge, lecture seule, note A+…F)
                                                                                    ▼
                                                   verdict ──▶ { ok, status, summary, deliverable }
                       (encore non au 3e tour : judge sauté, verdict ──▶ status: unconverged)
```

## Contrat

- Entrées : `offer` (JSON texte : company, title, link, slug, skills_required, description,
  et si l'appelant a lu l'annonce : description_full, keywords), `profile` (chemin absolu
  du profil maître), `proofs`, `remarks`, `keywords`, `min_coverage` (0.7), `out_dir`
  (`application`).
- Sortie : `{ ok, status: verified|rejected|unconverged, summary, problems, findings, deliverable }`,
  `deliverable.path` = `<out_dir>/CV.md` dans les artefacts du run (un pointeur Archon nomme un
  fichier régulier, jamais un dossier) ; `pitch.md` et `candidate.json` sont à côté.
- Issue autorisée : `ok`.
- Contrôles encore rouges au plafond (trois tours) : la boucle rend la main (compteur `tries`
  du contrôle), le Reviewer est sauté et le verdict rend `ok: false, status: unconverged`
  avec les derniers `problems` et la couverture des mots-clés dans `summary`. Le run
  n'échoue que sur une erreur (modèle, script) ; un verdict absent se lit alors `null` chez
  l'appelant (`if_skipped: null`).

## Ce que le code vérifie (`.shared/cv-checks.ts`, 21 tests)

| Règle | Pourquoi |
|---|---|
| mots-clés de l'offre couverts à ≥ 70 % (délimités, insensible à la casse) | c'est ce que l'ATS lit |
| aucun chiffre à unité (50 %, 38k€, x3, 98/100) absent du profil maître | un chiffre sans source est une invention |
| aucune portée absente du profil maître : B2B, B2C, SaaS, marketplace, grands comptes, P&L, budget, management, taille d'équipe (le nombre), client ou partenaire nommé ; l'entreprise et l'intitulé de l'offre sont retirés du CV avant la recherche | une portée déduite est une invention, même quand l'offre la demande |
| aucune phrase creuse (liste FR/EN, `DEFAULT_SLOP`, partagée avec `outbound-sequence` et `aeo-asset`) | `no-ai-slop` |
| au plus 3 tirets longs (—, –) hors titres dans le CV, 2 dans le message ; les intervalles de nombres ne comptent pas | un tiret par puce signe un texte généré ; le français garde l'incise |
| ≤ 70 lignes non vides et ≤ 4 500 caractères | une page |
| e-mail du profil présent sur le CV | le recruteur doit pouvoir répondre |
| le CV nomme l'entreprise et le poste | sinon il n'est pas sur mesure |
| pitch ≤ 180 mots, nomme l'entreprise, finit par une question | lisible et actionnable |
| `candidate.json` : clés obligatoires, e-mail = celui du profil | le formulaire sera rempli avec |

Ce que le code ne tranche pas (honnêteté des expériences au-delà des mots : portée gonflée
en d'autres termes, résultat attribué au mauvais employeur, temps des verbes contre les
dates ; pertinence ; densité sans bourrage ; voix qui sonne générée ; respect des remarques)
va au Reviewer, qui n'approuve qu'à partir de **A-**. Les règles d'exactitude et
d'écriture du Drafter (`commands/work.md`) et la grille du Reviewer (`commands/judge.md`)
s'inspirent de `ai-job-search` (Mads Lorentzen) et de `proficiently-claude-skills`, tous
deux sous licence MIT ; chaque emprunt porte sa mention « Adapté de … (MIT) ».

## Lancer

```bash
archon workflow run cv-tailor \
  --input offer='{"company":"…","title":"…","link":"…","slug":"…","skills_required":"…"}' \
  --input profile='C:\chemin\vers\career\master_profile.md' \
  --input proofs='…\Workspace\career\skill_proof_graph.json'
```

Dans le système `career-apply`, c'est `load` qui lit l'offre dans `pending_gold_jobs.json`
et les remarques dans `applications/<slug>/remarques_utilisateur.txt`, puis `record` qui
recopie le dossier vérifié vers `applications/<slug>/` sous les noms que le bot Telegram
attend (`CV_Antoine_Lecerf_<slug>.md`, `Message_Accroche_<slug>.md`).

## Vérifier

`scripts/verify-block.sh cv-tailor` — tests unitaires, `archon validate`, 4 fixtures
(`verified`, `rejected`, `unconverged`, `outcome-contract`). `unconverged` stubbe `check`
dans l'état du dernier tour (`ok: false`, `tries: 3`) : le dry-run ne joue qu'un tour de
boucle. Elle n'a pas de stub `judge` et finit quand même : le Reviewer n'a donc pas été
atteint. L'arrêt au plafond lui-même (`until_bash` lit `tries`) est contrôlé par
`scripts/gates/validate.ts` (R1).
