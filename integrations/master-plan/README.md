# Brancher la chaîne carrière sur Master Plan

Trois pièces, aucune ne touche au reste de Master Plan : un patch de dix lignes dans le bot
Telegram, un timer, un aller-retour des fichiers avec la VM.

## 1. Le bot Telegram : `/valider` valide, le harness fait le reste

Aujourd'hui `validateAndTailorJob()` dans
`02_Assistant_Personnel/02_Automatisation/core/career_bot_engine.js` lance
`cv_tailor_engine.py` en synchrone (25 s) et renvoie un CV généré sans vérification. Le patch
(`career_bot_engine.valider.patch.md`) remplace ce corps par l'écriture du statut
`VALIDATED` + `validated_at` dans `pending_gold_jobs.json` et un message « le harness prend
le relais ». `/cv`, `/remarque`, `/postuler`, `/jobs` ne changent pas : ils lisent toujours
`applications/<slug>/` et le tableau, que `career-apply` remplit avec les mêmes noms de fichiers.

Le patch est **proposé, pas appliqué** : c'est le bot de production. À appliquer à la main,
puis `sync_to_vm.ps1` comme d'habitude.

## 2. Le timer : `career-listener` toutes les 10 minutes

`triggers/career-listener.schedule.json` est la liaison. Sur Windows :

```powershell
archon trigger whoami                     # → runAsUserId, à coller dans le JSON
# Planificateur de tâches : toutes les 10 min, dans C:\chemin\vers\Harness-Agentic-Workflow
archon trigger fire --config triggers\career-listener.schedule.json
```

`overlap: skip` : un tour en cours n'est jamais doublé. Une offre par tour, et une seule
candidature en vol à la fois (les agents partagent un profil de navigateur) : tant qu'une offre
est `APPLYING` depuis moins de deux heures, `claim` ne prend rien.

**Un listener en pause bloque la file.** Quand `career-apply` attend le go (`archon workflow
approve`), le listener attend avec lui, en pause ; il tient son checkout jusqu'à sa fin, et
l'admission de la liaison saute chaque réveil du timer (`skipped`). Pendant ce temps, rien ne
tourne : ni la prise d'une autre offre, ni la règle des prises périmées (deux heures), qui ne
s'applique qu'au réveil suivant. La file attend l'humain : répondre au go libère le tour
suivant. Pour arrêter un go en attente : `archon workflow reject <run career-apply>` (rien
n'est envoyé, l'offre devient `TAILORED`). Archon refuse `cancel` sur un run en pause, et
abandonner ou annuler le sous-run laisse le listener en pause : après un abandon, lancer
`archon workflow resume <run du listener>` (son `settle` clôt alors l'offre).

**Un go se donne dans les deux heures.** Au-delà, la règle des prises périmées clôt la prise
(`APPLY_FAILED`, ou `APPLY_UNPROVEN` s'il y a trace d'un clic) et le run, même approuvé
ensuite, ne clique plus (`superseded`) : revalider avec `/valider` (la note de l'offre le
dit), et refuser le vieux go.

## 3. La VM : rapatrier le tableau avant le tour, le renvoyer après

Le bot tourne sur la VM Oracle ; `pending_gold_jobs.json` y vit. `sync_pending.ps1` fait
l'aller-retour de `Workspace/career` avec les mêmes `scp` que `pull_from_vm.ps1` /
`sync_to_vm.ps1` (même clé `~/.ssh/oracle_arm_key`, même `RemoteDir`), sans rien d'autre
(pas de `.secrets`, pas de `pm2 restart`). Il lit l'adresse de la VM dans la variable
d'environnement `MASTER_PLAN_VM_IP` ou dans `sync_to_vm.ps1` : elle n'est écrite nulle part ici.
Il lui faut `bun` sur le PATH.

```powershell
integrations\master-plan\sync_pending.ps1 -Direction pull    # avant le fire
archon trigger fire --config triggers\career-listener.schedule.json
integrations\master-plan\sync_pending.ps1 -Direction push    # juste après le fire
```

Le Planificateur enchaîne les trois dans une même tâche, mais **ils ne s'exécutent pas en
séquence avec le tour** : `archon trigger fire` rend la main dès que le run du listener est
lancé en arrière-plan. `push` tourne donc pendant le tour, en même temps que `claim`, `load`,
`record`, `close` et `settle` : il envoie les statuts déjà écrits, et un statut écrit après
sa fusion part au `push` du tour suivant (dix minutes plus tard, ou plus tard si le listener
est en pause).

**Le tableau n'est jamais écrasé d'un côté par l'autre.** Deux écrivains le tiennent : le bot
sur la VM (`PENDING_VALIDATION`, `/valider` → `VALIDATED` + `validated_at`, nouvelles offres)
et le harness sur le PC (`APPLYING`, `TAILORED`, `APPLIED`, `APPLY_UNPROVEN`, `APPLY_FAILED`,
`harness`, `applying`). Un go donné entre deux tours fait écrire le statut final par `record`
sur le PC seulement ; une copie VM → PC aveugle le perdait au tour suivant (l'offre redevenait
`APPLYING`, puis `APPLY_FAILED` deux heures plus tard, que `/valider` accepte : une candidature
envoyée ou refusée pouvait repartir). `sync_pending.ps1` télécharge donc la copie de la VM
dans un fichier de travail et la fusionne, offre par offre, avec `merge_pending.ts` (règle
`mergeBoards`, `.archon/workflows/systems/.shared/pending.ts`, testée dans `pending.test.ts`,
course entre deux tours comprise) :

- `pull` : la copie de la VM entre dans celle du PC ;
- `push` : la copie de la VM est **relue juste avant l'envoi**, reçoit les statuts du PC, et
  c'est ce résultat qui part sur la VM (et remplace la copie du PC) : un `/valider` fait sur la
  VM pendant le tour n'est pas perdu.

**Un seul écrivain à la fois sur la copie du PC.** `merge_pending.ts` relit, fusionne et
réécrit la copie du PC sous le verrou du tableau, `pending_gold_jobs.json.lock`, à côté du
fichier ; chaque écrivain du harness le prend aussi (`claim`, `load`, `record`, `close`, les
`settle`, la règle des prises périmées) : création exclusive du fichier de verrou, attente
jusqu'à 40 s, verrou vieux de plus de 15 s (processus mort) cassé ; écriture atomique (fichier
temporaire puis `rename`), refaite sur `EPERM` / `EBUSY` (Windows, antivirus). Une prise ou un
statut écrit pendant la fusion n'est donc jamais écrasé (`pending.test.ts` : deux processus
qui écrivent en même temps).

Pour chaque offre présente des deux côtés, les champs du bot viennent de la VM ; `status`,
`harness` et `applying` :

1. viennent du PC quand il dit `APPLYING`, `APPLIED` ou `APPLY_UNPROVEN` (en cours ou envoyée :
   le bot refuse `/valider` sur ces statuts, un `/valider` fait sur une vue périmée de la VM
   reste sans effet) ;
2. sinon viennent de la VM quand elle porte une nouvelle validation (`validated_at` plus
   récent) ou un statut que seul le bot écrit (`PENDING_VALIDATION`, ou tout statut que le
   harness n'écrit pas) ;
3. sinon viennent du côté dont la dernière écriture du harness (`harness.at`, `applying.at`)
   est la plus récente, le PC à égalité.

Une offre présente d'un seul côté est gardée (le harness ne supprime jamais une offre : une
offre retirée sur la VM revient au `push` suivant, à retirer des deux côtés). Une copie
illisible arrête la synchronisation sans rien écrire. Limite : la copie de la VM n'a pas de
verrou (le bot l'écrit sans lui) ; entre sa relecture et son `scp` (quelques secondes), un
`/valider` serait encore écrasé.

## 4. Le navigateur des agents

```powershell
npx -y @playwright/mcp@0.0.41 --help      # une fois, pour télécharger le paquet
```

`.archon/mcp/browser.json` lance Playwright MCP (Chrome, profil persistant
`.local/browser-profile/`, ignoré par git). Se connecter une fois à LinkedIn et à Welcome to the
Jungle dans ce profil, en ouvrant Chrome dessus (Playwright MCP seul n'ouvre pas de fenêtre) :

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="C:\chemin\vers\Harness-Agentic-Workflow\.local\browser-profile" `
  https://www.linkedin.com/login
```

Se connecter, ouvrir aussi https://www.welcometothejungle.com et s'y connecter, fermer la
fenêtre : les formulaires à compte sont ensuite accessibles aux agents. Le robot est lancé sur
Chrome (`--browser chrome` dans `.archon/mcp/browser-mcp.ts`) : Chrome doit être installé.
Jamais de contournement de CAPTCHA : l'agent s'arrête et le dossier reste `TAILORED`.

## 5. Les plateformes éprouvées

`verified_platforms` (entrée de `career-apply`, vide au départ) se remplit **à la main** :
après un premier envoi confirmé sur une plateforme (reçu `APPLIED`, mail de confirmation reçu),
l'ajouter dans `triggers/career-listener.schedule.json` →
`binding.launch.inputs.verified_platforms`
(`"lever,greenhouse"`). Avant cela, chaque envoi attend `archon workflow approve <run-id>`.

## 6. Premier run réel

```powershell
archon workflow run career-apply --cwd C:\chemin\vers\Harness-Agentic-Workflow --folder `
  --input slug=<slug> `
  --input career_dir='C:\chemin\vers\career' `
  --input mode=confirm
```

`--folder` : la copie du Bureau n'est pas un dépôt git ; le drapeau l'enregistre (première fois)
comme « folder project » et exécute sur place, sans worktree, ce qui garde le profil du
navigateur `.local/` sous la main des agents, comme le timer (`isolation: in-place`). Sans
lui : « Not in a git repository ». `archon validate workflows` et `--dry-run` n'acceptent pas
`--folder` : la validation hors ligne se fait dans le dépôt git (`scripts/gates.sh`). Le run
s'arrête au go (« paused », avec l'identifiant du run) : `archon workflow approve <run-id>`
envoie, `archon workflow reject <run-id>` n'envoie rien et laisse le dossier `TAILORED`.

`mode=confirm` force la pause avant l'envoi, quelle que soit la plateforme : le bon réglage pour
calibrer `work.md` / `judge.md` de `cv-tailor` sur deux ou trois offres réelles.

**Le run lancé à la main prend l'offre, comme le listener** : son `load` la passe `APPLYING`
(`applying.run` = ce run) sous le verrou du tableau, et `record` écrit son statut à la fin.
On peut donc le lancer **timer en marche** : tant que l'offre est `APPLYING`, `claim` ne
prend rien (une candidature à la fois). `load` refuse, sans rien écrire ni rien envoyer, une
offre `APPLYING` par un autre run (le listener la travaille déjà), `APPLIED` ou
`APPLY_UNPROVEN` (déjà envoyée, peut-être), ou toute offre tant qu'une autre candidature est
en vol. Lancé sur une offre qui n'est pas `VALIDATED` (`TAILORED`, `PENDING_VALIDATION`,
`APPLY_FAILED`), il ne la met jamais en file : une issue « à reprendre » (Reviewer sous A-)
lui rend son statut d'avant (`applying.from`) ; seul `/valider` met une offre en file. Juste
avant le clic, la garde `own` d'`apply-submit` relit le tableau : si l'offre n'est plus tenue
par ce run (prise close après deux heures au go, remise en file par `/valider`, prise par un
autre), rien n'est envoyé (`superseded`). Si le run échoue, son nœud `settle` clôt l'offre
(`APPLY_FAILED`, ou `APPLY_UNPROVEN` s'il y a trace d'un clic) ; un run annulé ou abandonné
ne passe pas par `settle` (Archon ne reprend qu'un run `failed` ou en pause) : l'offre reste
`APPLYING` jusqu'à la règle des prises périmées du listener (deux heures, timer en marche).

## 7. Le cockpit local (sans commande à taper)

L'icône « Cockpit » du Bureau (`integrations\cockpit\cockpit-launch.ps1`) lance le cockpit s'il ne tourne
pas et ouvre la page ; `integrations\cockpit\install-cockpit.ps1` (facultatif, une fois) le fait démarrer avec
ta session Windows ; `integrations\cockpit\cockpit.cmd` (ou `bun integrations/cockpit/cockpit.ts --career-dir
"<…>\Workspace\career"`) reste là pour le lancer à la main.
C'est une page sur `http://127.0.0.1:8766/` qui rapatrie le tableau de la VM (le `pull` du §3,
au démarrage, toutes les 5 min et sur un bouton ; jamais le `push`), lance `career-apply` sur les offres
cochées (une à la fois, `mode=confirm`, la commande du §6 exactement), montre l'annonce (lien et
texte de la page), tes remarques (le fichier de `/remarque`, lu au prochain run), l'avancement, le
CV, le pitch, la fiche candidat, le contact, le préremplissage, et relaie ton go (`archon workflow
approve`) ou ton refus. Voir `integrations/cockpit/README.md`.

## 8. Propositions (rien n'est branché)

Trois pistes écrites pour la production, que rien dans ce dépôt n'applique : le radar et le bot
de la VM ne sont pas modifiés.

- [`radar_freehire.proposal.md`](radar_freehire.proposal.md) : Free-Hire (freehire.me, API
  publique d'un agrégateur d'ATS) comme source de plus pour le radar. La requête, les champs
  Free-Hire → offre du tableau, la règle de dédoublonnage ; `radar_freehire.ts` en est la
  référence, sans réseau (il relit une réponse sauvegardée), testée dans `radar_freehire.test.ts`.
- [`radar_sources.proposal.md`](radar_sources.proposal.md) : où le radar cherche (relevé du 22
  octobre : 40 offres sur 44 viennent de LinkedIn, seule source interrogée par intitulé ; 6 offres
  publiées par pays sous un même slug) et ce qu'il faudrait y changer, par ordre de rendement :
  une ligne par offre, les autres sources interrogées par intitulé, les pages carrières Greenhouse
  / Lever / Ashby des entreprises vérifiées lues par leur API publique. `radar_ats_boards.ts` en
  est la référence, sans réseau (réponses écrites à la main), testée dans `radar_ats_boards.test.ts`.
  Sa section 6 est le catalogue élargi (spécialisées growth / GTM, full remote, Welcome to the
  Jungle et boards français), source par source avec accès, conditions et ce qui a été vérifié ;
  [`job_sources.proposed.json`](job_sources.proposed.json) est le `job_sources.json` qui en
  découle (même forme que celui de production), vérifié par `job_sources.proposed.test.ts`.
  Sa section 7 (23 octobre) répond à « se brancher sur le plus grand nombre de sites » : les
  agrégateurs (Google for Jobs, pages carrières, 11 ATS d'un coup) avec leurs tarifs, les
  connecteurs Claude et serveurs MCP, les API publiques des autres ATS de la liste, et un plan
  à 0 € par mois ; `radar_ats_boards.ts` lit en plus Workable, Recruitee et SmartRecruiters.
- [`bot_go_deux_temps.proposal.md`](bot_go_deux_temps.proposal.md) : le go en deux temps depuis
  Telegram. Un récapitulatif, puis `GO <slug> <code>` (code à usage unique) ; la réponse
  voyage de la VM au PC par ce tableau (`telegram_go`, champ du bot), et seul le PC approuve le
  run, après ses propres gardes. Patch du bot proposé, relais côté PC décrit, pas construit.

La garde d'annonce, elle, est branchée : `load` de `career-apply` passe chaque annonce lue à
`.archon/workflows/systems/.shared/posting-guard.ts` (expirée → l'offre est close
`APPLY_FAILED` sans CV ni envoi ; suspecte → signalée, rien n'est bloqué). Voir
`.archon/workflows/systems/career-apply/README.md`, « La garde d'annonce ».

## Couper le scan d'offres de l'ancien radar (2026-11-11)

L'ancien radar n'est pas un service à part : `telegram_bots_service.js` (pm2 `telegram-bots`) lance
`live_job_scraper.autoScanAndNotify` toutes les 15 min (offres + alertes Telegram) et
`daily_remote_company_scanner` une fois par jour. Le radar unifié de la VM (`integrations/vm-radar/`)
fait le premier travail ; Antoine a choisi le 2026-11-11 de **couper le scan d'offres** et de garder le
reste (les trois bots, le scan quotidien qui tient à jour l'index des entreprises remote, la commande
manuelle de scan).

- `ancien-radar-interrupteur.cjs` ajoute au bot une seule condition : le fichier
  `Workspace/career/ancien_radar_coupe` présent ⇒ pas de scan d'offres. Idempotent, ligne introuvable
  ⇒ rien n'est changé, original gardé à côté (`.avant-interrupteur-ancien-radar.bak`).
- `Couper-ancien-radar.cmd` (Bureau) → `couper-ancien-radar.ps1` : modifie la copie de Master Plan du
  PC (pour qu'un `sync_to_vm.ps1` ne remette pas l'ancien fichier) et celle de la VM, vérifie la
  syntaxe (`node --check` ; sinon l'original est remis et rien ne redémarre), pose l'interrupteur,
  redémarre `telegram-bots` une fois. Rapport : `Bureau\rapport-ancien-radar.txt` (sans l'adresse).
- Retour arrière : `couper-ancien-radar.ps1 -Remettre` enlève l'interrupteur ; le scan reprend dans la
  seconde, sans redémarrage.
