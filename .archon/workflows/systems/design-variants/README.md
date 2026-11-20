# Système `design-variants`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Porté du workflow `design-variants` du harness v0 d'Antoine
(`archive/harness-v0/workflows/design-variants.json`) : un brief → trois variantes de page en
parallèle → choix humain. La brique `design` du v0 (« page HTML autonome d'après un brief »)
est ici le bloc `landing-page`. Ses contrôles reprennent les trois du v0 — `html` (un
document complet, `<!doctype html>`), `autonome` (aucun `http://` dans la page, et aucune
ressource externe hors le script GTM), `poids` (60 000 caractères au plus) — et y ajoutent
le DataLayer, le CTA unique et les tokens CSS ; son juge applique la grille CRO.

```
brief ──┬─▶ a : landing-page (angle sobre)      ──▶ verdict ? ─┐
        ├─▶ b : landing-page (angle preuve)     ──▶ verdict ? ─┼─▶ collect ──▶ choose (humain : une survivante, ou none) ──▶ done
        └─▶ c : landing-page (angle narration)  ──▶ verdict ? ─┘      │                 └─ none ──▶ drop (annulé)
                                                                      └─ aucune survivante : choose sauté ──▶ done ok:false
```

| Nœud | Type | Rôle |
|---|---|---|
| `a`, `b`, `c` | `include: landing-page` | une variante chacun, contrôles et juge compris |
| `collect` | `script:` (`trigger_rule: all_done`) | lit les trois verdicts (`if_skipped: null`), écrit une ligne par variante (proposée, refusée par son juge, non convergée, sans verdict) et les options du choix : les survivantes, puis `none` |
| `choose` | `wait: { attention, form: select }` | l'humain choisit l'id d'une survivante (`a`, `b`, `c`) ou `none` ; sauté s'il n'y a aucune survivante |
| `drop` | `cancel:` | annule le run quand l'humain choisit `none` |
| `done` | `script:` | issue typée `{ ok, chosen, variants, statuses, summary }` : une survivante choisie (`ok: true`), ou aucune survivante (`ok: false`) ; sans issue si l'humain choisit `none` (`drop` annule le run) ou si `collect` échoue (limite plus bas). Tout autre état n'a pas de chemin (un select n'accepte qu'une option proposée) : `done` échoue alors (« done: unexpected state … ») au lieu d'inventer une issue |

Seule une variante `verified` (contrôles verts, juge favorable) est proposée. Les autres
sont nommées dans le message, chacune avec ses mots, et `done` les reprend dans `statuses`
(`variants` ne garde que le booléen `ok`) :

| Issue de la variante | Ce qui s'est passé | Mots de `collect` / `done` |
|---|---|---|
| `rejected` | contrôles verts, juge défavorable | « rejected by its judge » |
| `unconverged` | contrôles encore rouges au dernier tour permis ; juge sauté, verdict `ok: false` | « did not converge: » suivi du résumé du bloc, qui le dit déjà (« Checks still failing after 3 round(s)… ») ; `done`, sans résumé : « did not converge » |
| `null` | pas de verdict : un nœud du bloc a échoué (le juge, sur une erreur du modèle, ou une étape de la boucle) | « no verdict (a node of the block failed…) » |

Une boucle épuisée n'existe plus : la boucle de `landing-page` s'arrête à son plafond par le
compteur `tries` du contrôle (`until_bash`, `max_iterations` ne sert que de garde-fou), le
juge est sauté et le verdict rend quand même `ok: false, status: unconverged`. Aucun nœud de
la variante n'échoue : après la réponse humaine, Archon n'a aucune variante en échec à
rejouer, et si les trois restent rouges (`choose` sauté), le run finit `completed` avec
`ok: false`.

Une erreur du juge d'une variante (ou d'une étape de sa boucle) est le cas qui reste : son
verdict est sauté (`trigger_rule: none_failed_min_one_success`), `collect` la nomme « sans
verdict », l'humain compare les autres, `done` rend son issue (`variants.<x>: null`) ; mais
c'est le seul cas où le run peut finir `failed` après la réponse. Archon rejoue à la reprise
les nœuds en échec avant la pause : à la reprise qui suit la réponse, ce juge (ou la boucle,
reprise au tour 1) tourne une seconde fois ; s'il réussit, son verdict, `collect` et `done`
rejouent : le choix enregistré ne change pas, mais `done` peut dire la variante `verified`
sans qu'elle ait été proposée ; s'il échoue encore, le run finit `failed`. Le choix
enregistré ne tient que pour cette reprise-là. Deux cas ouvrent un nouveau choix :
- un juge échoue et aucune autre variante ne survit : `choose` est sauté (pas de réponse) et
  le run finit `failed` ; une reprise où ce juge approuve sa variante ouvre un choix ;
- le juge échoue encore à la reprise qui suit la réponse : une seconde reprise où il réussit
  relance `collect`, dont la sortie change, donc `choose` (son cache est invalidé) : l'humain
  choisit de nouveau.

Limite Archon : si le script `verdict` d'une variante échoue lui-même, la liaison de
`collect` échoue aussi (`if_skipped` ne couvre que le producteur sauté).

Le choix est un `select` et non plus une approbation avec une lettre en texte libre : la
réponse est l'id d'une option proposée, jamais une lettre devinée dans une phrase
(« C'est la B » rendait la C). Le texte qui l'accompagne n'est qu'un commentaire.

## Une variante par modèle ?

Le v0 lançait opus / sonnet / haiku et l'humain comparait les trois modèles côte à côte.
Archon fixe le modèle par nœud dans le YAML, pas par entrée : les trois variantes diffèrent
donc par l'**angle** (le brief est complété). `--model medium=<fournisseur/modèle>` ne
change que les agents qui écrivent (le juge de `landing-page` reste en `model: large`).
Trois runs avec trois `--model` donnent trois jeux de trois angles et trois choix humains
séparés, pas le choix unique entre modèles du v0.

## Lancer

```bash
archon workflow run design-variants --input brief="…" --input intent="…"
archon workflow respond <run-id> b                    # l'id de la variante retenue (a, b ou c)
archon workflow respond <run-id> none "pourquoi"      # aucune : le run est annulé
```

Les fichiers sont `variant-a.html`, `variant-b.html`, `variant-c.html` dans les artefacts du
run ; le message d'attention donne leur chemin complet.

## Vérifier

`scripts/verify-block.sh design-variants` — tests `scripts/collect.test.ts` (les quatre
issues d'une variante et leurs mots) et `scripts/done.test.ts` (les deux issues de `done`, et
son garde-fou une fois, script lancé pour de vrai : code 1, rien sur stdout), fixtures
`chosen`, `none-kept`, `one-variant-rejected`, `no-survivor`, `all-unconverged` (les trois
restent rouges au plafond : verdicts réels `unconverged`, aucun juge ni `choose` atteint,
issue `ok: false`) et `variant-without-verdict` (le juge de la B échoue, faute de stub : son
verdict est sauté, le run finit `failed`). Les stubs `work`/`check` servent aux trois
variantes : une seule variante non convergée ne se simule pas ; les tests de `collect` et de
`done` la couvrent.

## Limites connues

- Sans verrou de dossier, ce run n'est jamais annulé par le verrou, c'est tout : en cours ou en pause à `choose`, il compte encore comme actif dans son dossier, et un run plus récent qui y prend le verrou (un bloc lancé seul, `feature-build --no-worktree`) est annulé (« This worktree is in use »).
- Les agents `work` de `landing-page` ne restent hors du checkout que parce que leur consigne le dit : aucun `mutates_checkout: false` de nœud ne le fait respecter (seul le juge en a un).
- Le dry-run ne joue jamais `until_bash` (il tient chaque boucle pour finie après un tour) : seul `scripts/gates/validate.ts` (R1) vérifie qu'une boucle s'arrête à son plafond.
- Si le script `verdict` d'une variante échoue lui-même, il n'y a pas d'issue typée : `collect` échoue, et `done` avec lui.
- Le choix enregistré ne vaut que pour la reprise qui suit la réponse : si un juge échoue sans autre survivante (`choose` sauté), ou échoue encore à cette reprise, une reprise où il réussit pose la question à l'humain (de nouveau, dans le second cas).
- Une étape de boucle en échec (`work` ou `check`) fait échouer la boucle de sa variante ; à la reprise, la boucle repart au tour 1, compteur `tries` compris.
