# Bloc `interview-prep`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : une candidature décroche un entretien ; le bloc écrit la **préparation d'une étape**
(`rh`, `manager`, `technique` ou `final`) dans `interview-prep.md`, en français : les
questions probables, des histoires STAR tirées du profil seul, ce que le CV et le pitch
envoyés affirment déjà (pour rester cohérent dans la salle), les questions à poser, un script
de simulation (questions seulement, Antoine répète seul) et les points à clarifier. Il ne
navigue pas, n'envoie rien, n'écrit que dans les artefacts du run.

```
offre / annonce + profil + CV + pitch + notes + étape
        │
        ▼
 work (agent, sans réseau) ─▶ interview-prep.md ─▶ check (code) ─┐
        ▲                                                         │ non → problems
        └──────────────────── (3 tours au plus) ──────────────────┘
                                                            oui ▼
              judge (contexte vierge, lecture seule : pertinence, honnêteté, utilité ; A+…F)
                                                                ▼
                               verdict ──▶ { ok, status, summary, problems, findings, deliverable }
           (encore non au 3e tour : judge sauté, verdict ──▶ status: unconverged)
```

## Contrat

- Entrées :
  - `profile` (obligatoire) : chemin absolu du profil maître, seule source des histoires ;
  - `application` : chemin absolu du dossier `<career_dir>/applications/<slug>/` ; y sont lus,
    s'ils existent, `offer.json` (l'offre, `description_full` = l'annonce lue),
    `annonce.md|txt`, `CV_*.md` et `Message_Accroche_*.md` (les noms que `career-apply`
    écrit pour le bot), `interlocuteur_cible.json` (entreprise et poste quand aucune offre
    n'est trouvée), `remarques_utilisateur.txt` ; sans `offer.json`, l'offre `<slug>` de
    `<career_dir>/pending_gold_jobs.json`, deux dossiers plus haut (lue, jamais écrite) ;
  - `offer` (JSON texte), `posting`, `cv`, `pitch` (chemins) : priment sur le dossier ;
  - `stage` : `rh` (défaut) | `manager` | `technique` | `final` ;
  - `research` : notes de recherche, en texte ou en chemin (le bloc n'a pas de réseau : ce qui
    n'est pas là n'est pas connu) ;
  - `min_stories` (`3`), `min_coverage` (`0.5`), `out` (`interview-prep.md`).
- Sortie : `{ ok, status: verified|rejected|unconverged, summary, problems, findings, deliverable }`,
  `deliverable.path` = `interview-prep.md` dans les artefacts du run.
- Issue autorisée : `ok`.
- Contrôles encore rouges au plafond (trois tours) : la boucle rend la main (compteur `tries`
  du contrôle), le juge est sauté et le verdict rend `ok: false, status: unconverged` avec les
  derniers `problems`. Le run n'échoue que sur une erreur (modèle, script) ; un verdict absent
  se lit alors `null` chez l'appelant (`if_skipped: null`).
- Pas de verrou de dossier (`mutates_checkout: false`) : le bloc tourne à côté d'un
  `career-apply` en attente de go.

## Le document

```
# Préparation d'entretien — <Entreprise>, <Poste> (étape : <étape>)

## Questions probables          ≥ 6 puces avec « ? » ; « Piste : » en sous-puce, réponse-pont pour un manque
## Histoires STAR               ≥ 3 « ### », chacune : Situation, Tâche, Action, Résultat, Source (profil), Pour
## Cohérence avec le CV et le pitch   extraits « … » du CV / pitch, mot pour mot, et quoi avoir en tête
## Questions à poser            ≥ 3 puces avec « ? », adaptées à l'étape
## Simulation d'entretien       ≥ 6 questions, rien d'autre : échauffement → métier → comportemental → piège
## Points à clarifier           ≥ 1 puce : ce que les pièces ne disent pas, manques, signaux d'alerte
```

Une histoire cite d'où elle vient : `- **Source (profil) :** § Expériences > Way2Tech —
« <extrait recopié du profil> »` — la section (les titres du profil, séparés par `>`), la
ligne (un extrait d'au moins douze caractères entre « »), ou les deux. Le code les cherche
dans le profil.

## Ce que le code vérifie (`.shared/interview-checks.ts`, 27 tests ; `scripts/check.test.ts`, 5 tests)

| Règle | Pourquoi |
|---|---|
| les six sections, dans l'ordre ; titre « (étape : `<étape>`) » ; l'entreprise nommée | un document qu'on retrouve et qu'on relit vite |
| ≥ 6 questions probables, ≥ 3 questions à poser, ≥ 1 point à clarifier | la préparation a de la matière |
| ≥ `min_stories` histoires, chacune avec ses quatre parties non vides | STAR complet, ou l'histoire ne se raconte pas |
| chaque histoire cite le profil, et chaque citation (extrait mot pour mot, ou chemin de titres) existe dans le profil | une histoire sans source est une invention |
| la note de cohérence cite au moins un extrait du CV ou du pitch, et chaque extrait s'y trouve | rien dans la salle qui ne soit sur le papier |
| simulation : chaque élément est une question, aucune « Réponse : » | Antoine répète ses propres réponses |
| chiffres à unité (50 %, 38k€, x3, 98/100) : dans les histoires, du profil seul ; ailleurs, d'une pièce fournie (profil, annonce, CV, pitch, notes, remarques) — `unsupportedFigures` de `cv-checks.ts` | un chiffre sans source est une invention |
| pas de phrase creuse (`DEFAULT_SLOP` de `cv-checks.ts`, plus « je suis perfectionniste », « team player »…), ni marqueur de brouillon, ni blanc de gabarit (`[PROJECT_NAME]`) | `no-ai-slop` |
| 1 500 à 20 000 caractères ; mots-clés de l'offre cités à ≥ `min_coverage` (`keywordCoverage`) | lisible la veille, et ancré dans l'annonce |
| étape connue ; profil lisible | sinon rien n'est vérifiable |

Ce que le code ne tranche pas va au juge, qui n'approuve qu'à partir de **A-** sans constat
bloquant : **pertinence** pour l'annonce et l'étape, **honnêteté** (une histoire qui gonfle le
rôle ou le résultat est bloquante, même citée), **utilité** (histoires distinctes, note de
cohérence qui pointe ce qu'on va creuser, simulation complète, points à clarifier qui
comptent).

## Lancer, pour une candidature

Sur le PC d'Antoine (PowerShell, même forme que `career-apply` dans
`integrations/master-plan/README.md` § 6 ; `--folder` parce que la copie du Bureau n'est pas un
dépôt git) :

```powershell
archon workflow run interview-prep --cwd C:\chemin\vers\Harness-Agentic-Workflow --folder `
  --input application='C:\chemin\vers\career\applications\<slug>' `
  --input profile='C:\chemin\vers\career\master_profile.md' `
  --input stage=rh
```

Avec ce seul dossier, l'offre vient du tableau (`pending_gold_jobs.json`), qui ne porte que
le résumé du radar : `career-apply` garde l'annonce lue (`offer.json`, `description_full`)
dans les artefacts de son run, pas dans `applications/<slug>/`. Pour préparer sur l'annonce
complète : `--input posting='<chemin du texte de l’annonce>'`, ou `--input offer='<JSON>'`
(l'`offer.json` du run `career-apply`), ou déposer `offer.json` / `annonce.md` dans le
dossier. Facultatif : `--input research='<notes, ou chemin d'un fichier de notes>'`.

Un bouton du cockpit pourra lancer la même commande (avec `--detach`, comme pour
`career-apply`). Le document est dans les artefacts du run (`archon workflow get <run>
--json`) ; le recopier dans `applications/<slug>/` est le rôle de l'appelant, pas du bloc.

## Vérifier

`scripts/verify-block.sh interview-prep` — tests unitaires, `archon validate`, 4 fixtures
(`verified`, `rejected`, `unconverged`, `outcome-contract`), et ce que rend chacune comparé à sa
ligne `# attendu:`. `unconverged` stubbe `check` dans l'état du dernier tour (`ok: false`,
`tries: 3`) et n'a pas de stub `judge` : la fixture finit quand même, le juge n'a donc pas été
atteint. L'arrêt au plafond lui-même (`until_bash` lit `tries`) est contrôlé par
`scripts/gates/validate.ts` (R1).

## Emprunts

Adapté de [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search)
(commit `e16acee`, MIT © 2026 Mads Lorentzen) : `.claude/commands/interview.md` (sources des
questions probables et leur ordre, réponse-pont aux manques, note de cohérence et sa règle,
questions à poser selon l'étape) et `.claude/skills/job-application-assistant/07-interview-prep.md`
(format STAR, questions types à poser, déroulé de la simulation). Traduit et réduit ; les
sections fixes, la citation du profil vérifiée par le code et l'absence de réseau sont propres
à ce dépôt.

## Limites connues

- Une citation par section n'est vérifiée que par ses titres (chaque composant est contenu
  dans un titre du profil) : elle prouve d'où vient l'histoire, pas ce qu'elle en dit ; c'est
  l'extrait entre « » qui est mot pour mot, et le juge qui lit le sens.
- Seuls les chiffres à unité sont contrôlés (`unitFigures` de `cv-checks.ts`) : « 3 segments »
  ou une année ne le sont pas.
- Dans la note de cohérence, tout texte entre guillemets doit venir du CV ou du pitch.
- Les prompts `work.md` et `judge.md` n'ont pas encore tourné sur un vrai modèle ; ils se
  calibrent au passage `VERIFIED → PROUVÉ`, sur deux ou trois entretiens réels.
