# Harness Agentic Workflow

Une structure pour des workflows agentiques « à la reel » (*agentic engineering*,
@kem_glitch), construite sur [Archon](https://github.com/coleam00/Archon), qui recrée les cas
d'usage de **Master Plan** en blocs vérifiés :

> L'agent travaille → le code vérifie (déterministe, en boucle) → un juge LLM en contexte
> vierge tranche → le bloc est **VERIFIED**. Les blocs se composent, tournent en parallèle,
> partent d'un déclencheur et d'un tableau de tâches. L'humain ne vérifie qu'à la fin — et
> rien ne sort du dépôt (candidature, email, publication) sans son « go ».

```
déclencheur → tableau (NEW) → écouteur → système ─┬─ bloc : agent ⇄ contrôles en code → juge
                                                   ├─ bloc en parallèle (variantes, offres)
                                                   └─ validation humaine, en bout de chaîne
```

Lire d'abord [`AGENTS.md`](AGENTS.md) (ordre d'autorité : [`RULES.md`](RULES.md) rang 1,
[`MECHANICS.md`](MECHANICS.md) rang 2, [`POSTURE.md`](POSTURE.md) rang 3), puis
`MECHANICS.md` pour créer un bloc. Les règles sont des portes : `scripts/gates.sh`.

## Arborescence

```
AGENTS.md RULES.md MECHANICS.md POSTURE.md   l'ordre d'autorité ; harness.json = contrat machine (généré)
.archon/workflows/
  blocks/                 un bloc = un métier, vérifié sans appel de modèle
    .shared/              règles pures + tests : deliverable, cv, platforms, submission, email, contact, veille, aeo, landing, implement, review
    template/             le gabarit — à copier, jamais lancé, vérifié comme un bloc (README : anatomie d'un bloc)
    research/ design/ report/                 blocs génériques (documents)
    cv-tailor/ cover-letter/ apply-submit/    carrière : CV sur mesure, lettre d'une page, dépôt de candidature
    interview-prep/                           carrière : préparation d'un entretien (lancée depuis le cockpit)
    decision-makers/                          carrière : à qui écrire (sources publiques) et quoi écrire, rien d'envoyé (cockpit)
    job-triage/                               carrière : langues et salaire extraits avec citations, décision par le code, juge
    outbound-sequence/ aeo-asset/ landing-page/   GTM : séquence email, actif AEO + JSON-LD, landing
    veille-fiche/                             veille : fiche Problème / Impact / Recommandation
    implement/ review/                        code : réaliser un plan (⟲ tests), relire un diff (harness v0)
    proofs/               preuves des blocs PROUVÉ (R3)
    REGISTRY.md           statut de chaque bloc et système (DRAFT / VERIFIED / PROUVÉ + date)
  systems/                ce qui assemble les blocs
    .shared/              board, career, pending, markdown, radar, radar-env (purs + tests) ; state (accès `archon state`), io, platforms (réexport de blocks/.shared) ; radar/ (connecteurs et jury de Master Plan, CommonJS)
    pipeline/             research → design → report → vérification humaine
    research-report/      research → report → vérification humaine (workflow v0)
    feature-build/        plan → implement → lint → review → go humain → PR brouillon (workflow v0)
    design-variants/      3 variantes landing-page en parallèle → choix humain (workflow v0)
    board-listener/       tableau de tâches durable + écouteur : chaque carte part vers pipeline,
                          research-report, feature-build ou design-variants
    career-apply/         offre validée → garde d'annonce → cv-tailor → cover-letter → PDF vérifié → route → apply-submit → statut
    career-listener/      pending_gold_jobs.json comme tableau (VALIDATED → APPLYING → APPLIED…)
    career-triage/        offre captée → annonce → job-triage → triage/<clé>.json (écartée / à vérifier / retenue), lu par le cockpit
    studio/               cadrage (graphique, site ou app) → brief → design system → base de contenu → vérification humaine → route de la ligne suivante
    career-radar/         radar côté PC, sans modèle : sources → crible (doublons, jury langue / remote / séniorité) → pending_gold_jobs.json + last_radar_report.json
.archon/mcp/browser.json  Playwright MCP pour les nœuds « navigateur » (profil .local/, non versionné)
use-cases/README.md       le gabarit de cas d'usage et l'inventaire : 13 cas de Master Plan → bloc / système, statut
integrations/master-plan/ patch /valider du bot Telegram (proposé), sync VM, timer, navigateur, propositions radar / go
integrations/cockpit/     le cockpit local (page sur le PC : offres, tri, runs, go, lettre, entretien ; plusieurs candidats ; depuis le téléphone par Tailscale)
THIRD_PARTY.md            ce qui est adapté de dépôts MIT (ai-job-search, proficiently-claude-skills)
scripts/
  gates.sh                toutes les portes (méta-test → validate → build-harness → tests → verify-block --all)
  gates/                  validate.ts (R1 R2 R3 R5 R6), build-harness.ts (R5), test-gates-can-fail.ts + fixtures.ts
  new-block.sh <nom>      copie le gabarit en blocks/<nom>/
  verify-block.sh <nom>|--all   tests des règles + archon validate (R4) + fixtures + issues asserties → ✅ VERIFIED
  check.ts                contrôles génériques pour prototyper une boucle (porté de toolbox/check.js)
triggers/                 liaisons timer : board-listener (5 min), career-listener (10 min)
docs/                     01-cartographie (reel ↔ Archon), 02-gabarit-de-bloc, annexe, résumé du reel
archive/harness-v0/       le harness v0 d'Antoine (JSON → build.js), tel quel
```

## Démarrer

Prérequis : [bun](https://bun.sh) ≥ 1.2.21 et le CLI Archon (`archon` sur le PATH — sous
Windows : `irm https://archon.diy/install.ps1 | iex` dans PowerShell —, ou un checkout du dépôt
après `bun install` : `export ARCHON_SRC=/chemin/vers/Archon`). Les scripts `.sh` tournent dans
Git Bash.

```bash
scripts/gates.sh                               # toutes les portes, sans dépenser un jeton
scripts/verify-block.sh --all                  # ou seulement les blocs et systèmes
archon workflow run research --input task="Comparer A et B"
archon workflow run research-report --input task="<question>"   # le workflow v0, un go humain à la fin
archon workflow run outbound-sequence --input brief="…" --input icp="…"
archon workflow run career-apply --cwd <dossier> --folder --input slug=<slug> --input career_dir='…\Workspace\career' --input mode=confirm   # --folder : copie sans git
archon workflow approve <run-id>               # la pause humaine : fin de pipeline, ou « go » avant un envoi
```

## La chaîne carrière (le cas d'usage prioritaire)

```
/valider <id>  ──▶  pending_gold_jobs.json : VALIDATED
                          │  timer 10 min
                          ▼
                   career-listener : claim (→ APPLYING) ──▶ career-apply ──▶ close
                                                              │
   load (garde d'annonce) ──▶ cv-tailor ──▶ cover-letter ──▶ PDF vérifié ──▶ route/resolve ──▶ apply-submit
                 (agent ⟲ code, juge A–F, pour chaque bloc)
                                                              (prefill ⟲ code → go humain ? → clic → reçu → juge)
                                                              │
                   applications/<slug>/ (noms que le bot lit) + statut APPLIED | APPLY_UNPROVEN | APPLY_FAILED | TAILORED
```

Branchement sur Master Plan : `integrations/master-plan/README.md`.

## Ce qui est vérifié (2026-10-22)

`scripts/gates.sh` : 51 violations connues attrapées par les portes (méta-test), 674 tests
unitaires (cockpit compris), 22 workflows validés (+ le gabarit), 122 fixtures (une par issue
possible), dont 103 issues assertées contre la sortie réelle des scripts, zéro appel de modèle.
Aucun bloc n'est encore `PROUVÉ`. Le premier run réel (2026-10-22, `career-apply` en
`mode=confirm` sur le PC d'Antoine) a atteint le modèle et révélé deux défauts de contrat
invisibles hors ligne, corrigés le jour même et désormais attrapés par une porte (R4 : un
pointeur d'artefact nomme un fichier, jamais un dossier ; le statut rendu par `record` n'est
plus une énumération). Détail dans `blocks/REGISTRY.md` ; contrat machine dans `harness.json` ;
limites connues des portes dans `scripts/gates/README.md`.

## Les étapes

| Étape | Où | État |
|---|---|---|
| 1. Cartographier le reel sur Archon | `docs/01-cartographie.md` | fait |
| 2. Définir le gabarit de bloc | `docs/02-gabarit-de-bloc.md`, `blocks/template/` | fait, vérifié |
| 3. Blocs pilotes + orchestrateur | `blocks/{research,design,report}`, `systems/{pipeline,board-listener}` | faits, vérifiés |
| 4. Recréer les cas d'usage de Master Plan | `use-cases/README.md`, 6 blocs métier, 2 systèmes | 8 construits ; `veille-listener`, `gtm-campaign`, `tracking-plan`, `app-feature` à créer |
| 5. Brancher et calibrer | `integrations/master-plan/`, `integrations/cockpit/` | patch proposé, premier run réel fait (deux défauts corrigés), cockpit local écrit |
| 6. Fusionner le harness v0 d'Antoine | `AGENTS.md`, `RULES.md`, `MECHANICS.md`, `POSTURE.md`, `scripts/gates/`, blocs `implement` `review`, systèmes `research-report` `feature-build` `design-variants` | fait, vérifié (2026-10-18) |

## À savoir

Le pack `sdlc` livré avec Archon est « un bloc par métier » pour le **code** piloté par les
issues GitHub (`archon-triage`, `archon-investigate`, `archon-plan`, `archon-validate`,
`archon-review`, `archon-ship`). Ce dépôt a aussi ses blocs de code, venus du harness v0 :
`implement` et `review`, assemblés par `feature-build` (une demande → une PR brouillon, un seul
go humain). Le pack sdlc reste la voie complète, file d'issues comprise, pour le pilier 03 de
Master Plan, composé avec `gatekeeper.js` (UC-12).

## Garde-fous

- Un agent **propose**, le code et le juge **vérifient**, l'humain **décide** de ce qui sort :
  une pause humaine (`wait:` avec `form: approval`) avant toute candidature sur une plateforme
  pas encore vérifiée (`mode: verified-only`, le défaut ; `confirm` demande partout, `auto`
  jamais et ne se choisit qu'explicitement) et avant tout brouillon de PR, jamais
  de CAPTCHA ni de mur de connexion contourné, jamais de modification du bot de production
  (patch proposé à part).
- Une candidature refusée au go ne revient jamais seule : le refus est écrit (`TAILORED`,
  rien d'envoyé), et une offre restée `APPLYING` plus de deux heures, ou dont le run est
  tombé, est close en `APPLY_FAILED`, jamais remise en file ; seul `/valider` la relance.
- Les nœuds juges sont en lecture seule (`allowed_tools`), en contexte vierge
  (`context: fresh`, `mutates_checkout: false`, vérifié par le moteur) ; les blocs écrivent
  dans leurs artefacts, pas dans le dépôt, sauf `implement`, dont c'est le métier, dans le
  worktree du run.
- `.local/` (profil navigateur) et tout secret restent hors du dépôt.
