# Système `career-listener`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

L'écouteur du cas d'usage carrière, sur le modèle du `board-listener` : le tableau de tâches
est ici `pending_gold_jobs.json` lui-même (NEW = `VALIDATED`, PICKED UP = `APPLYING`,
DONE = `APPLIED` / `APPLY_UNPROVEN` / `APPLY_FAILED` / `TAILORED`).

```
timer ──▶ claim (VALIDATED → APPLYING) ──▶ run (workflow: career-apply) ──▶ close ──▶ settle (all_done)
```

- Une offre par réveil ; `overlap: skip` dans le trigger évite deux listeners en même temps.
- Une seule candidature en vol à la fois (les agents partagent un profil de navigateur) :
  tant qu'une offre est `APPLYING` depuis moins de deux heures, prise par un listener ou par
  un career-apply lancé à la main, `claim` ne prend rien (`path: idle`, la raison dans
  `summary`).
- `claim` prend l'offre `VALIDATED` la moins tentée (`harness.attempts`, compté par
  `record` pour la validation en cours), puis la plus ancienne (`validated_at`), et note son
  run dans `applying.run`. Une offre qui revient en file passe donc derrière les autres, et
  au 3e passage `record` la clôt en `APPLY_FAILED` : une offre ne bloque pas la file.
- Une prise `APPLYING` de plus de deux heures est close en `APPLY_FAILED`, ou
  `APPLY_UNPROVEN` si le `submission/` de son run (`applying.artifacts`, noté par `load`)
  montre un clic possible ; **jamais** remise en `VALIDATED` : elle peut être un run en pause
  au go pendant l'absence de l'humain, ou un run tombé après un clic ; la remettre en file
  pourrait envoyer deux fois, ou envoyer ce que l'humain a refusé. Close, la prise n'est plus
  tenue : si ce run est approuvé plus tard, la garde `own` d'apply-submit ne le laisse plus
  cliquer (`superseded`, rien d'envoyé) et son `record` n'écrit rien (un envoi déjà fait,
  lui, s'écrit). **Un go se donne dans les deux heures** ; sinon, revalider avec `/valider`.
  La note (`harness.note`) le dit, et dit de vérifier `submission/` et la boîte mail avant.
- **Un listener en pause bloque la file.** Le listener en pause tient son checkout jusqu'à
  sa fin : l'admission de la liaison saute chaque réveil du timer (`skipped`, Archon
  `resource-start-store.ts` `heldCheckouts`, `admission.ts`). Tant que le go attend, aucun
  tour ne tourne : ni prise, ni règle des prises périmées (elle ne joue qu'au premier réveil
  après la fin du listener). La file attend l'humain : répondre au go libère le tour
  suivant. Pour arrêter un go en attente : `archon workflow reject <run career-apply>` (rien
  n'est envoyé, `TAILORED`). Archon refuse `cancel` sur un run en pause, et abandonner ou
  annuler le sous-run laisse le listener en pause : après un abandon, lancer
  `archon workflow resume <run du listener>` (le sous-run annulé fait échouer `run`, puis
  `close`, et `settle` clôt l'offre).
- Un bloc de `career-apply` qui ne converge pas (contrôles encore rouges au plafond de sa
  boucle) ne fait pas échouer le sous-run : il finit `completed`, `ok: false`, avec un statut
  final déjà écrit par `record` (`APPLY_FAILED` quand le CV n'a pas convergé, `TAILORED`
  quand le formulaire n'a pas convergé, rien envoyé). `close` relaie ce statut sans écrire
  (`path: failed`) et l'offre ne revient pas dans la file. Un refus au go arrive de même en
  `TAILORED`, que le listener ne reprend jamais. Seul `VALIDATED` (offre non lue, dossier
  refusé par le Reviewer, cv-tailor sans verdict) la remet en file, trois passages au plus.
- Un sous-run en pause au go met le listener en pause avec lui (« blocked on sub-run ») ; il
  reprend quand l'humain répond sur le run de career-apply. `run` passe `claim_run` (le run du
  listener, noté dans `applying.run`) : `record` n'écrit que sur l'offre de cette prise
  (`mayRecord`).
- **Jamais deux clics à la reprise.** Si le sous-run échoue après le go (erreur du modèle
  `submit` après le clic, sortie hors `output_format`, juge en erreur…), le listener qui
  reprend relance une fois l'enfant en échec (Archon, nœud `workflow:`), et Archon y rejoue
  les nœuds en échec, `submit` compris. Aucune option d'Archon ne l'empêche. C'est le verrou
  `arm` d'apply-submit (`always_run: true`, `armed.json`) qui ferme alors la porte : le
  sous-run rend `unproven`, `record` écrit `APPLY_UNPROVEN`, rien n'est recliqué. Ce qui
  reste dépendant du modèle (un nouvel essai de `submit` dans le même passage, après une
  erreur passagère) est décrit dans `blocks/apply-submit/README.md`, « Jamais deux clics ».
- Quand `record` rend une issue sans pouvoir l'écrire (`status_written: false` : fichier
  illisible ou verrouillé à cet instant), `close` l'écrit à sa place si l'offre est encore
  `APPLYING` par cette prise (`recordUnwritten`, même garde que `settleClaim`). `close` sauve
  d'abord l'issue dans `$ARTIFACTS_DIR/close.json`, **avant** toute écriture du tableau : si
  son écriture échoue aussi, `settle` relit `close.json` et écrit le statut calculé
  (`APPLIED` reste `APPLIED`). Les écritures du tableau sont refaites sur `EPERM` / `EBUSY`.
- Un sous-run en échec ou annulé (erreur d'un modèle ou d'un script hors bloc, comme
  `resolve`, qui fait échouer `confirm_route` puis `record` ; ou un abandon, suivi de
  `archon workflow resume <run du listener>`) :
  Archon ne laisse jamais une liaison lire un nœud en échec, même avec `if_skipped`, donc
  `close` échoue à son tour et le tour du listener finit `failed`. Le dernier nœud, `settle`
  (`trigger_rule: all_done`), ne lie que `claim` : si l'offre est encore `APPLYING` par CE
  run (`applying.run` = `claim.run`), personne n'a écrit son statut, et `settle`
  (`settleClaim`, `.shared/pending.ts`) écrit, dans l'ordre : le statut sauvé dans
  `close.json` ; sinon `APPLY_UNPROVEN` si le `submission/` du sous-run (`applying.artifacts`)
  montre un clic possible (`decision.json` avec `proceed: true`, `armed.json`, `click.json`,
  un reçu : un cancel pendant `submit`) ; sinon `APPLY_FAILED` avec la raison. Une offre que
  `record` a écrite (une erreur dans un bloc fait aussi finir le sous-run `failed`, après
  `record`) n'est pas touchée.
- **Le verrou du tableau.** `claim`, `close`, `settle` et la règle des prises périmées, comme
  `load` et `record` de career-apply et la fusion PC ⇄ VM (`merge_pending.ts`), relisent et
  réécrivent `pending_gold_jobs.json` sous `pending_gold_jobs.json.lock` (création exclusive,
  verrou de plus de 15 s cassé) : `push` tourne pendant le tour (`archon trigger fire` rend la
  main dès le run lancé), aucune écriture n'est perdue.
- **Pas de verrou de dossier** (`mutates_checkout: false`, comme career-apply) : aucun nœud
  n'écrit dans le checkout. Avec lui, chaque réveil serait annulé (« This worktree is in
  use ») tant qu'un run plus ancien est actif dans le dossier (un board-listener en pause à
  une validation, par exemple). `overlap: skip` suffit contre deux listeners, en pause
  compris (voir plus haut) ; le profil du navigateur est protégé par la règle d'une
  candidature en vol.

## Brancher

1. Le bot Telegram : `/valider <id>` doit écrire `status: "VALIDATED"` et `validated_at`
   au lieu de lancer `cv_tailor_engine.py` (voir `integrations/master-plan/README.md`, ~10
   lignes dans `career_bot_engine.js`). Tout le reste du bot (`/cv`, `/postuler`, `/remarque`)
   continue de lire `applications/<slug>/`.
2. Le timer : `triggers/career-listener.schedule.json` (toutes les 10 min), enregistré avec
   `archon trigger fire --config` depuis le Planificateur de tâches Windows.
3. Les offres vivent sur la VM Oracle (le bot y tourne) : `integrations/master-plan/sync_pending.ps1`
   rapatrie `Workspace/career` avant le tour et le renvoie après, avec les mêmes `scp` que
   `pull_from_vm.ps1` / `sync_to_vm.ps1` (le `push` tourne pendant le tour, sous le verrou du
   tableau). `pending_gold_jobs.json` n'y est jamais écrasé : les
   deux copies sont fusionnées offre par offre (`mergeBoards`, `.shared/pending.ts`, via
   `merge_pending.ts`), pour qu'un statut écrit sur le PC après un go donné entre deux tours ne
   redevienne pas `APPLYING` (puis `APPLY_FAILED` deux heures plus tard), et qu'un `/valider`
   fait sur la VM pendant le tour ne soit pas perdu (voir `integrations/master-plan/README.md`).

## Vérifier

`scripts/verify-block.sh career-listener` — fixtures `idle`, `applied`, `apply-failed`,
`submit-unconverged` (le sous-run rend `ok: false` avec `TAILORED` : `close` le relaie tel
quel, sans le réécrire en `APPLY_FAILED`), `run-failed` (pas de stub `run` : le dry-run fait
échouer le sous-run, `close` échoue sur sa liaison, `settle` tourne quand même ; le run finit
`failed`). Dans les fixtures, `settle` tourne pour de vrai sur un dossier carrière absent et
n'écrit rien ; sa décision (`settleClaim` : seulement une offre encore `APPLYING` par ce run),
`pickValidated`, le compteur, la clôture des prises périmées, l'écriture de `record`
par-dessus (`mayRecord`), celle de `close` à la place de `record` (`recordUnwritten`), la
prise (`claimForRun`, une candidature à la fois), le verrou du tableau (deux processus qui
écrivent en même temps) et la fusion PC ⇄ VM (`mergeBoards`, course entre deux tours
comprise) sont testés dans `systems/.shared/pending.test.ts` et `career.test.ts` ;
`scripts/close.test.ts` lance `close`, `settle` et `claim` pour de vrai sur un dossier
carrière temporaire : écriture de `close` bloquée puis `settle` qui écrit `APPLIED` depuis
`close.json`, sous-run annulé pendant `submit` (`APPLY_UNPROVEN`), sans trace
(`APPLY_FAILED`), `claim` qui ne prend rien pendant qu'une autre candidature est en vol.
