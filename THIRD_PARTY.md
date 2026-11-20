# Emprunts à des dépôts tiers

Ce dépôt adapte des règles, des listes et des idées de deux dépôts publiés sous licence MIT.
Rien n'y a été exécuté ni installé : les passages repris sont traduits ou réécrits dans nos
blocs, et chaque emplacement porte un commentaire « Adapté de <dépôt>/<chemin> (MIT) ». Les
versions exactes sont celles des commits ci-dessous.

## ai-job-search

- Dépôt : https://github.com/MadsLorentzen/ai-job-search — commit `e16acee3abdaae57f8026789338a3c6eebf4608b` (2026-10-21).
- Licence : MIT — Copyright (c) 2026 Mads Lorentzen.
- Repris : règles d'écriture et clichés (`03-writing-style.md`, `08-application-forms.md`) →
  `blocks/.shared/cv-checks.ts` (`DEFAULT_SLOP`), `blocks/cv-tailor/commands/work.md` et
  `judge.md` ; grille du relecteur et audit d'ancrage factuel (`.claude/commands/apply.md`) →
  juges de cv-tailor et cover-letter ; gabarits et longueur de lettre
  (`06-cover-letter-templates.md`) → `blocks/cover-letter/` et `blocks/.shared/letter-checks.ts` ;
  préparation d'entretien (`.claude/commands/interview.md`, `07-interview-prep.md`) →
  `blocks/interview-prep/` et `blocks/.shared/interview-checks.ts` ; vérification de PDF
  (`tools/verify_pdf.py`, `tools/verify_layout.py`) → `systems/.shared/pdf-checks.ts` ; garde
  d'annonce (`tools/posting_guard.py`, `tests/test_posting_guard.py`, `rank.md`) →
  `systems/.shared/posting-guard.ts` ; source Free-Hire (`.agents/skills/freehire-search/`) →
  `integrations/master-plan/radar_freehire.proposal.md` et `radar_freehire.ts` ; politique
  d'hôtes des ATS (`.claude/commands/apply.md`) → `blocks/.shared/platforms.ts`.

## proficiently-claude-skills

- Dépôt : https://github.com/proficientlyjobs/proficiently-claude-skills — commit `9bc1f6fd7af532fe0cd4a1843e06ab2b474d0d53` (2026-03-12).
- Licence : MIT, déclarée dans `plugin.json` (Proficiently, https://proficiently.com) ; le dépôt ne
  porte pas de fichier LICENSE.
- Repris : règles d'exactitude et d'écriture du CV (`skills/tailor-resume/SKILL.md`) →
  `blocks/.shared/cv-checks.ts` (`SCOPE_TERMS`, `DEFAULT_SLOP`), `blocks/cv-tailor/commands/` ;
  phrases à éviter et contrôle qualité de la lettre (`skills/cover-letter/`) → cover-letter et
  cv-tailor ; modèles des ATS, Greenhouse hors iframe, Lever `/apply`, Workday derrière un compte
  (`shared/references/ats-patterns.md`) → `blocks/.shared/platforms.ts`,
  `blocks/apply-submit/commands/prefill.md` ; réponses standard validées par le candidat
  (`skills/apply/SKILL.md`) → `blocks/.shared/submission-checks.ts`
  (`<career>/reponses_formulaires.md`) ; confirmation en deux temps (`skills/jobsearch-telegram/`)
  → `integrations/master-plan/bot_go_deux_temps.proposal.md`.

Les quatre dépôts examinés et les verdicts (deux repris en partie, deux écartés) sont dans le
document « Quatre dépôts job-search : ce qu'il faut en prendre » (Claude Doc, 2026-10-22).

## JobCampaign (projet d'un ami d'Antoine)

- Source : archive `JobCampaign-20261023.zip` transmise par Antoine le 2026-10-24 (pas de dépôt public,
  pas de licence déclarée), partagée pour qu'on en reprenne ce qui sert ; accord de l'auteur à confirmer avant toute diffusion du dépôt.
- Repris (idées et mesures, code réécrit en JavaScript) : table des pays et régions de `gates.py`
  → `systems/.shared/radar/inspectors/geo.js` (utilisée par le filtre de territoire de
  `remote_auditor.js`) ; lecture « métier d'abord » des tableaux publics (`universe.py`,
  `universe_scan.py`, `discover.py` : slugs Lever sensibles à la casse, slugs Ashby avec espace)
  → `systems/.shared/radar/fetchers/ats_boards.js`.
- Non repris : la candidature automatique (FINISH, `ats_fill/`) et le canal LinkedIn invité,
  contraires à la règle « rien ne part sans le go d'Antoine ».

## Feashliaa/job-board-aggregator (listes de tableaux)

- Dépôt : https://github.com/Feashliaa/job-board-aggregator — fichiers `data/{greenhouse,lever,ashby}_companies.json`.
- Licence : CC BY-NC 4.0 (usage personnel, non commercial, attribution). Les listes ne sont pas
  versionnées ici : le radar les télécharge dans `<career>/radar_universe.json`, qui porte la
  licence dans `_meta`.
