# Système `studio` — la porte d'entrée des projets de design et de dev (UC-14)

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Une demande (« je veux refaire Aevum », « il me faut un site pour… ») entre par le cadrage,
qui décide si c'est un projet graphique, un site ou une app. Le tronc commun suit dans le
même run : brief, design system, base de contenu. Chaque bloc garde sa boucle
agent → contrôles → juge, et l'humain ne voit le projet qu'à la fin, avec la route de la
ligne qui suit.

```
request ──▶ calibrate ──ok──▶ brief ──ok──▶ design ──ok──▶ content ──ok──▶ review (humain) ──approve──▶ done { ok: true, type, next }
               │                │              │              │                 │
         pas convergé     pas convergé   pas convergé   pas convergé         reject ──▶ drop (run annulé)
           ou rejeté        ou rejeté      ou rejeté      ou rejeté
       ou sans verdict  ou sans verdict ou sans verdict ou sans verdict
               └────────────────┴──────────────┴──────────────┴──────▶ done { ok: false, stage: <bloc> }
```

| Nœud | Type | Rôle |
|---|---|---|
| `calibrate` | `include: studio-calibrate` | `calibrage.json` : type (graphique, site, app), citations mot pour mot de la demande, livrables, plateformes, fichiers existants, route |
| `brief` | `include: studio-brief` | `BRIEF.md`, sept sections ; la plateforme doit être celle du type calibré (lu dans `calibrage.json`) |
| `design` | `include: design-system` | `tokens.json` + `design-system.md` : contrastes WCAG AA clair et sombre, échelle typographique, grille d'espacement, composants faits de jetons |
| `content` | `include: content-base` | `content.json` : voix, chaque texte par clé et par langue (`locales`), longueur max, aucun chiffre inventé |
| `review` | `wait: { attention, form: approval }` | la seule pause humaine |
| `drop` | `cancel:` | annule le run quand l'humain refuse |
| `done` | `script:` | issue typée (`trigger_rule: all_done`, `if_skipped: null`) ; après un « go », `type` et `next` disent quelle ligne suit |

## Contrat

- Entrées : `request` (obligatoire), `context`, `project_dir` (dossier existant, ses fichiers
  sont le point de départ), `locales` (défaut `fr,en`).
- Sortie : `{ ok, stage: calibrate|brief|design-system|content-base|done, summary, type,
  next, deliverables: { calibrage, brief, design_system, content } }`.
- Livrables : `$ARTIFACTS_DIR/calibrage.json`, `BRIEF.md`, `tokens.json`, `design-system.md`,
  `content.json`. Rien n'est écrit dans le projet (`mutates_checkout: false`).
- `next` : la ligne du type après le tronc commun, puis la fin commune (`routeFor(type)` de
  `studio-checks.ts`). Graphique : direction artistique, déclinaisons, kit de marque. Site :
  arborescence, pages, SEO et tracking. App : PRD, écrans, fonctionnalités. Puis, pour
  tous : QA finale, go, diffusion.
  Ces lignes sont les prochains blocs à écrire ; `landing-page`, `design-variants` et
  `feature-build` en couvrent déjà une partie.
- Un bloc qui ne rend pas `ok: true` arrête la chaîne, comme dans `pipeline` : pas
  convergé (`unconverged`), rejeté (`rejected`) ou sans verdict (un nœud a échoué, run
  `failed`, `done` rend quand même son issue typée).
- L'humain n'est jamais l'étape de `done` : après quatre blocs `ok`, `review` tourne
  toujours ; tout autre état fait échouer `done` (« done: unexpected state ») au lieu
  d'inventer une issue.

## Lancer

```bash
archon workflow run studio --input request="Refaire l'app Aevum, iOS d'abord" \
  [--input project_dir=/chemin/vers/aevum] [--input locales=fr,en]
archon workflow approve <run-id>
archon workflow respond <run-id> reject "la palette est trop froide pour le brief"
```

## Ce que les fixtures prouvent

- `approved` : quatre verdicts ok, l'humain approuve, `done.ts` (réel) rend `ok: true`,
  `stage: done`. Sans `calibrage.json` dans les artefacts du dry-run, `type` vaut null et
  `next` est vide ; `done.test.ts` couvre le cas où le fichier existe (route app et site).
- `rejected-by-human` : refus à `review` → `drop`, run `cancelled`, `done` jamais atteint.
- `calibrate-unconverged` : contrôles du cadrage encore rouges au plafond → verdict réel
  `unconverged`, tout le reste sauté ; le stub piège `brief__verdict` prouve le `when` de
  `brief`.
- `calibrate-no-verdict` : le juge du cadrage échoue → verdict sauté, run `failed`, `done`
  rend `ok: false`, `stage: calibrate`.
- `brief-rejected`, `design-rejected` : le juge refuse (verdict réel `rejected`) ; le stub
  piège du juge suivant (`design__judge`, `content__judge`) prouve le `when` du bloc suivant.
- `content-rejected` : le juge de la base de contenu refuse ; `review` n'est pas atteint
  (sans son `when`, un nœud `wait:` sans stub mettrait le dry-run en pause : `paused` au
  lieu de `completed`).

Les nœuds de boucle (`work`, `check`) gardent leur id nu dans un include : un seul stub sert
aux quatre blocs. Les autres nœuds inclus se stubbent sous `<include>__<nœud>`.

## Limites connues

- Les lignes graphique, site et app ne sont pas encore des blocs : le run s'arrête après le
  tronc commun et dit lesquelles ouvrir.
- Comme `pipeline`, sans verrou de dossier : les agents `work` restent hors du projet parce
  que leur consigne le dit, seuls les juges sont en lecture seule par le moteur.
