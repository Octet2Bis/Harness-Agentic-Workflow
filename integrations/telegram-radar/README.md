# Bot Telegram du radar

Ce bot est **à part**. Le bot de production de Master Plan (pm2 `telegram-bots`) n'est ni lu ni modifié.

| Où | Quoi |
|---|---|
| VM, `alert-vm.ts` | Il tourne après chaque cycle de `cycle.sh`, avec son propre verrou `alerts.lock`. Il envoie une alerte par offre que le tri local vient de **retenir**. Le plafond est de 20 par jour (heure de Paris), réglable avec `alertes_max_jour` dans `radar_bot.json`. Aucune offre n'est envoyée deux fois. |
| PC, cockpit (`pc-bot.ts`) | Il écoute `getUpdates`. Le premier `/start` réserve le bot à ce compte, et tout autre compte reçoit « Bot privé. ». Le bouton « CV sur mesure » lance career-apply en `mode=cv-only`, puis renvoie le PDF dans Telegram. |

Le mode `cv-only` produit un CV vérifié (Opus) et son PDF vérifié, sans lettre, sans recherche de page de candidature et **sans envoi**. Il consomme des crédits Claude, mais l'appui sur le bouton vaut demande explicite. Si le PC est éteint, Telegram garde l'appui 24 h et le cockpit le traite au rallumage.

## Mise en route

1. Dans Telegram, ouvre @BotFather, envoie `/newbot`, puis copie le jeton.
2. Crée le fichier `Harness-Agentic-Workflow\.local\secrets.env` (jamais versionné) avec une ligne `RADAR_BOT_TOKEN=<jeton>`. Il n'est lu que par son nom. Le cockpit le lit en premier, et `Installer-radar-VM` le copie sur la VM dans `~/radar-unifie/secrets.env`. Rien ne va dans Master Plan.
3. Relance le cockpit avec son icône (son dossier de données est `Harness-Agentic-Workflow\.local\career`). Le cockpit écrit « bot radar : à l'écoute ».
4. Envoie `/start` au nouveau bot. Le cockpit écrit alors `.local/career/radar_bot.json`, qui contient le compte et l'adresse Tailscale du cockpit. Ce fichier part vers la VM à la relève suivante (5 min).
5. Relance `Installer-radar-VM` pour que la VM reçoive le jeton (`secrets.env`) et ce code.

Au premier passage sur la VM, l'heure de départ est enregistrée : l'arriéré n'est jamais envoyé. Pour couper les alertes, mets `"alertes": false` dans `radar_bot.json`. Le bouton CV continue de marcher.

## Fichiers

- `career/radar_bot.json` : `chat_id`, `cockpit_url`, `claimed_at`, et en option `alertes_max_jour` et `alertes`. Il est poussé vers la VM par `pull_radar_vm.ps1`.
- `career/radar_alerts.json` (VM) : `since`, les clés déjà envoyées (30 jours) et le compte du jour.
- `.local/cockpit/radar-bot-<port>.json` (PC) : `offset` de Telegram et demandes de CV en cours (`pending`).
