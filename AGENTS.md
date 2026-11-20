# AGENTS.md — Point d'entrée

Ce dépôt est un **harness de workflows agentiques** : des blocs vérifiés (agent → contrôles
en code → juge en contexte vierge) qu'on emboîte en systèmes, exécutés par
[Archon](https://github.com/coleam00/Archon), déclenchés par un timer ou un tableau de
tâches, avec l'humain en bout de chaîne. Il recrée les cas d'usage de Master Plan
(`use-cases/README.md`).

Inspirations : le moteur Archon (workflows YAML, worktrees, nœuds déterministes mêlés aux
nœuds IA), le reel « Agentic engineering » de Kem @kem_glitch (boucle → bloc → système), et
le harness de Master Plan (une règle = un script, des portes qui savent échouer). Le harness
v0 d'Antoine (briques JSON → `build.js` → YAML), fusionné ici le 2026-10-18, est conservé tel
quel dans `archive/harness-v0/`.

## Ordre d'autorité

| Rang | Document | Nature | Vérifiable ? |
| :---: | :--- | :--- | :---: |
| 1 | [`RULES.md`](RULES.md) | Contraintes | Oui, une porte et une violation connue par règle |
| 2 | [`MECHANICS.md`](MECHANICS.md) | Procédures | En partie (`verify-block.sh`, `new-block.sh`) |
| 3 | [`POSTURE.md`](POSTURE.md) | Comportement de l'agent | Non |

Le rang le plus élevé l'emporte. Un document de rang 3 n'emploie jamais le mot
« obligatoire ».

## Point d'entrée machine

[`harness.json`](harness.json) : blocs, systèmes, statuts, portes, cas d'usage. Fichier
généré par `bun scripts/gates/build-harness.ts` ; ne pas l'éditer à la main (R5). Par
workflow : `purpose` (premier paragraphe de `description:`), `status` (registre),
`check_scripts` (nœuds script dans un corps de boucle), `judge` et `human_gate` (un juge, une
pause humaine), ces trois-là compositions comprises (`include:`, `workflow:`), `fixtures`, `run`.

## Carte

```
README.md                                     présentation, démarrage, étapes et ce qui est vérifié
AGENTS.md RULES.md MECHANICS.md POSTURE.md   l'ordre d'autorité
harness.json                                  contrat machine — GÉNÉRÉ
.archon/workflows/blocks/<id>/                un bloc : <id>.yaml, commands/ (work, judge), scripts/ (check, verdict), fixtures/ (une par issue, « # attendu: »)
.archon/workflows/blocks/template/            le gabarit que new-block.sh copie (statut GABARIT)
.archon/workflows/blocks/.shared/             règles pures + tests, partagées par les blocs
.archon/workflows/blocks/REGISTRY.md          statut de chaque bloc et système (GABARIT / DRAFT / VERIFIED / PROUVÉ + date)
.archon/workflows/blocks/proofs/              preuves des blocs PROUVÉ (R3)
.archon/workflows/systems/<id>/               un système : composition de blocs, pause humaine, issue typée
.archon/workflows/systems/.shared/            états du tableau et des offres (board, pending, career) + tests
.archon/workflows/systems/proofs/             preuves des systèmes PROUVÉ (R3)
.archon/mcp/                                  serveurs MCP des nœuds agents (navigateur)
use-cases/README.md                           les cas d'usage, selon le gabarit, et leur statut
integrations/master-plan/                     branchement sur Master Plan (patch proposé, sync VM, timer)
triggers/                                     liaisons timer des écouteurs
scripts/gates/                                les portes (validate, build-harness, fixture-outcomes, méta-test, violations connues)
scripts/                                      gates.sh, verify-block.sh, new-block.sh, check.ts — Bun ≥ 1.2, zéro dépendance
docs/                                         cartographie reel ↔ Archon, gabarit de bloc, résumé du reel
archive/harness-v0/                           le harness v0, tel quel
```

Le tableau de tâches n'est pas un fichier : chaque carte est un document d'état Archon
`board/<id>` (`archon state`), qu'on ajoute avec
`bun .archon/workflows/systems/board-listener/scripts/board.ts add "<tâche>"`
(voir `systems/board-listener/README.md`). Les offres de la carrière restent dans
`pending_gold_jobs.json`, côté Master Plan.

## Avant de déclarer une tâche terminée

```bash
scripts/gates.sh
```

soit, dans l'ordre : le méta-test, `validate.ts`, `build-harness.ts --check`, les tests des
outils (`bun test scripts`), `verify-block.sh --all` (tests des règles, `archon validate`,
fixtures et leurs issues). Le méta-test passe en premier : si une porte ne sait plus
attraper une violation connue, ses verdicts verts ne valent rien.

## Pour un agent qui travaille ici

- Un périmètre par session : un bloc, ou un système (`POSTURE.md`).
- Un nouveau métier : `scripts/new-block.sh <nom>`, puis `MECHANICS.md` § 1 et § 2.
- Un cas d'usage : une entrée dans `use-cases/README.md` d'abord, selon le gabarit ; l'agent
  propose, Antoine décide.
- Rien ne sort du dépôt (push, message, candidature, publication) sans demande explicite.
