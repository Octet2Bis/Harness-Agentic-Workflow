# Patch proposé : le go en deux temps depuis Telegram

Fichier : `02_Assistant_Personnel/02_Automatisation/core/career_bot_engine.js` (bot PRO de
Master Plan, sur la VM). **Non appliqué** (bot de production) : à coller à la main, puis
`sync_to_vm.ps1` comme d'habitude. Le côté PC (le relais du § 4) est **décrit, pas construit**.

Idée : quand une candidature attend son go, Antoine reçoit sur Telegram un récapitulatif, et
ne donne le go que par une confirmation explicite, liée à ce récapitulatif par un code à usage
unique ; ce go voyage de la VM au PC par la synchronisation du tableau, et seul le PC envoie,
après ses propres gardes. Adapté, pour le principe, de proficiently-claude-skills,
`skills/jobsearch-telegram/SKILL.md` (MIT) : confirmation en deux phases (« field-approval »
puis « submit-approval »), jamais d'envoi sans la seconde, demandes en attente gardées d'un
passage à l'autre. Rien n'est repris de sa mécanique (ni `curl`, ni état en Markdown, ni mots
de confirmation isolés : ici un « go » nu ne vaut rien).

## 0. Ce qui existe déjà : deux temps, sur le PC

`apply-submit` sépare déjà le remplissage de l'envoi :

1. **Premier temps, rien ne part** : `prefill` remplit le formulaire, joint le CV, prend
   `prefill.png` et `prefill.json` ; `check_prefill` vérifie (deux tours au plus) ; `gate` dit si
   un go est demandé (`mode`, `verified_platforms`).
2. **Second temps, le go** : le nœud `submit__go` (`wait`, `form: approval`) met le run en pause
   jusqu'à `archon workflow approve <run>` (ou `reject`), que le cockpit relaie depuis sa page.
   Puis `decide`, la garde `own` (l'offre est-elle encore à cette prise ?), `arm`, le clic, le
   reçu, le juge.

Ce qui manque : donner ce go loin du PC. Telegram ne remplace aucune garde : il ajoute un
chemin vers le même `approve`, et le PC refait toutes ses vérifications.

## 1. Le parcours

```
PC   career-apply en pause à submit__go
      └─ relais (§ 4) : harness.go_request = { id, run, code, expires_at, récap }   ── push ──▶ VM
VM   bot : voit la demande, envoie le récapitulatif (1er temps), note telegram_go.request
      Antoine : « GO acme_7k2p9qxa K7Q4ZT »  (ou « NON acme_7k2p9qxa K7Q4ZT trop junior »)
      bot : vérifie (offre, demande ouverte, code, délai, pas déjà répondu), écrit telegram_go.answer
                                                                                ◀── pull ── PC
PC   relais : vérifie à nouveau (même demande, run encore en pause, prise tenue, délai)
      └─ archon workflow approve <run>   (ou reject <run> avec la raison)
      └─ harness.go_request.relayed = { answer, at }                              ── push ──▶ VM
     apply-submit : decide → own → arm → clic → reçu → juge → record (APPLIED…)
VM   bot : « transmis au PC », puis /jobs montre le statut final
```

Le récapitulatif (premier temps) dit :

- l'entreprise, l'intitulé, la plateforme et l'URL de candidature ;
- ce que le formulaire a reçu (le résumé de `prepare`, celui que montre déjà le go Archon) et
  le nom du CV joint ; la capture `prefill.png` en pièce jointe si le relais l'a recopiée dans
  `applications/<slug>/` (poussé avec le tableau) ;
- les signaux de la garde d'annonce, s'il y en a (`posting: suspecte`, `posting_reasons` de
  `load`) : « ⚠ Annonce suspecte : … » ;
- l'heure limite (la prise a deux heures ; au-delà, le run ne clique plus) ;
- les deux réponses possibles, avec le slug et le code.

La confirmation (second temps) est **explicite** : `GO <slug> <code>` tapé, ou un bouton
« Envoyer » qui porte le code, suivi d'un second bouton « Confirmer l'envoi » (un appui
malheureux sur un téléphone ne doit pas suffire). Un « go », « oui », 👍 nus sont refusés avec
la forme attendue ; deux demandes ouvertes ne se confondent pas (le slug et le code les
séparent).

## 2. Le canal VM ↔ PC : le tableau, rien d'autre

Pas de nouveau canal : le go voyage dans `pending_gold_jobs.json`, par `sync_pending.ps1` (§ 3
de `README.md`), que la tâche du Planificateur lance toutes les dix minutes autour du `fire`, et
dont le cockpit lance le `pull` toutes les cinq minutes. Pendant la pause au go, le `fire` est
sauté ; le README prévient qu'un statut écrit alors peut partir « plus tard si le listener est
en pause ». Pour ne pas dépendre de cet enchaînement, le relais du § 4 lance lui-même
`sync_pending.ps1 -Direction push` juste après avoir posé une demande ou relayé une réponse
(et un `pull` avant de lire les réponses). La règle de fusion `mergeBoards`
(`.archon/workflows/systems/.shared/pending.ts`) décide déjà qui écrit quoi :

- **PC → VM : `harness.go_request`**. Pendant la pause, l'offre est `APPLYING` côté PC ;
  `status`, `harness` et `applying` y viennent toujours du PC (règle 1). La demande posée par
  le relais part donc au `push` suivant. `record` réécrit `harness` en entier à la fin du run :
  la demande disparaît d'elle-même.
- **VM → PC : `telegram_go`**. Tout champ hors `status`, `harness`, `applying` est un champ du
  bot et vient de la VM : la réponse arrive au `pull` suivant. Le harness ne l'écrit jamais.

Forme proposée :

```jsonc
"harness": {
  "go_request": {
    "id": "2026-10-22T09:40:00Z/<run>",   // une demande = un run + un instant
    "run": "<run career-apply en pause>",  // celui qu'approuver (pas le run du listener)
    "code": "K7Q4ZT",                      // 6 caractères sans 0/O/1/I, tiré au hasard par le relais
    "expires_at": "2026-10-22T11:35:00Z",  // applying.at + 2 h : la règle des prises périmées
    "platform": "greenhouse", "apply_url": "https://…",
    "prefill_summary": "…", "posting": "ok", "posting_reasons": [],
    "relayed": { "answer": "go", "at": "…" } // posé par le relais une fois transmis
  }
},
"telegram_go": { "request": "<go_request.id>", "recap_sent_at": "…", "answer": "go", "reason": "", "at": "…" }
```

Latence : un passage du relais pour que le récapitulatif parte, un autre pour que la réponse
arrive, soit vingt minutes au pire au rythme de dix minutes, plus le temps d'Antoine, dans une
fenêtre de deux heures.

## 3. Patch proposé côté bot (`career_bot_engine.js`)

Trois méthodes ajoutées au moteur ; le client Telegram les branche comme les autres commandes
(`GO`, `NON`, les boutons) et appelle `pendingGoRecaps()` à son rythme (une fois par minute
suffit). Lecture et écriture du tableau comme dans le patch de `/valider` (tmp → rename).

```js
// ── Go en deux temps ─────────────────────────────────────────────────────────────
const GO_CODE = /^[A-HJ-NP-Z2-9]{6}$/;          // sans 0/O ni 1/I : se recopie sans erreur

readBoard() {
  const boardPath = path.join(this.careerDir, 'pending_gold_jobs.json');
  return { boardPath, jobs: JSON.parse(fs.readFileSync(boardPath, 'utf8').replace(/^﻿/, '')) };
}

writeBoard(boardPath, jobs) {
  const tmp = `${boardPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, boardPath);                 // écriture atomique, comme /valider
}

/** Premier temps : les récapitulatifs à envoyer (demande du PC pas encore reçue sur Telegram). */
pendingGoRecaps() {
  const { boardPath, jobs } = this.readBoard();
  const out = [];
  for (const job of jobs) {
    const r = job.harness && job.harness.go_request;
    if (job.status !== 'APPLYING' || !r || r.relayed) continue;
    if (job.telegram_go && job.telegram_go.request === r.id) continue;   // déjà envoyé
    if (Date.parse(r.expires_at) <= Date.now()) continue;                 // trop tard : rien à demander
    const until = new Date(r.expires_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    const flags = r.posting === 'suspecte' ? `\n⚠️ *Annonce suspecte :* ${(r.posting_reasons || []).join(' ; ')}\n` : '';
    out.push({
      slug: job.slug,
      text: `🟠 *GO DEMANDÉ — ${job.company} · ${job.title}*\n\n` +
            `Plateforme : ${r.platform} — ${r.apply_url}\n` +
            `Formulaire : ${r.prefill_summary}\n${flags}\n` +
            `Rien n'est parti. Réponse avant *${until}* (au-delà, le run ne clique plus) :\n` +
            `✅ \`GO ${job.slug} ${r.code}\`\n` +
            `❌ \`NON ${job.slug} ${r.code} <raison>\``,
      // Boutons facultatifs : « Envoyer » ouvre un second bouton « Confirmer l'envoi » (deux appuis).
      buttons: [[{ text: 'Envoyer…', data: `go?:${job.slug}:${r.code}` }, { text: 'Ne pas envoyer', data: `non:${job.slug}:${r.code}` }]],
    });
    job.telegram_go = { request: r.id, recap_sent_at: new Date().toISOString() };
  }
  if (out.length > 0) this.writeBoard(boardPath, jobs);
  return out;
}

/** Second temps : `GO <slug> <code>` ou `NON <slug> <code> [raison]`. Rien n'est envoyé d'ici. */
answerGo(input, answer) {
  const [slug, code, ...rest] = String(input || '').trim().split(/\s+/);
  const usage = `Forme attendue : \`${answer === 'go' ? 'GO' : 'NON'} <slug> <code>\` (le code est dans le récapitulatif).`;
  if (!slug || !code || !GO_CODE.test(code.toUpperCase())) return `ℹ️ ${usage}`;
  try {
    const { boardPath, jobs } = this.readBoard();
    const job = jobs.find(j => j.slug === slug);
    const r = job && job.harness && job.harness.go_request;
    if (!job) return `❌ *Offre introuvable :* \`${slug}\`.`;
    if (job.status !== 'APPLYING' || !r || r.relayed) return `ℹ️ *${job.company || slug}* n'attend pas de go (statut \`${job.status}\`).`;
    if (r.code !== code.toUpperCase()) return `❌ Code incorrect pour *${job.company || slug}* : rien n'est enregistré. ${usage}`;
    if (Date.parse(r.expires_at) <= Date.now()) return `⌛ Trop tard pour *${job.company || slug}* : la prise a expiré, le run ne cliquera plus. Revalider avec \`/valider ${slug}\`.`;
    if (job.telegram_go && job.telegram_go.request === r.id && job.telegram_go.answer) {
      return `ℹ️ Déjà répondu (${job.telegram_go.answer.toUpperCase()}) pour *${job.company || slug}* : un code ne sert qu'une fois.`;
    }
    job.telegram_go = { request: r.id, recap_sent_at: (job.telegram_go || {}).recap_sent_at || null, answer, reason: rest.join(' '), at: new Date().toISOString() };
    this.writeBoard(boardPath, jobs);
    return answer === 'go'
      ? `✅ *Go enregistré — ${job.company || slug}.*\nTransmis au PC au prochain passage (10 min au plus) ; le PC revérifie tout avant de cliquer. \`/jobs\` dira APPLIED ou APPLY_UNPROVEN.`
      : `🛑 *Refus enregistré — ${job.company || slug}.* Rien ne sera envoyé ; le dossier restera TAILORED.`;
  } catch (err) {
    return `❌ *Erreur lors de l'enregistrement :* ${err.message}`;
  }
}
```

Dans le client : `GO …` → `answerGo(args, 'go')` ; `NON …` → `answerGo(args, 'non')` ; bouton
`go?:<slug>:<code>` → répondre par un bouton `go:<slug>:<code>` « Confirmer l'envoi à <entreprise> » ;
bouton `go:…` → `answerGo('<slug> <code>', 'go')` ; bouton `non:…` → `answerGo('<slug> <code>', 'non')`.
Seul le chat d'Antoine est écouté, comme pour les autres commandes. `/jobs` : ajouter un libellé
« 🟠 GO ATTENDU » pour une offre `APPLYING` qui porte une demande ouverte.

## 4. Côté PC : le relais (à construire, pas construit)

Un script (par exemple `integrations/master-plan/go_relay.ts`), lancé par la tâche du
Planificateur entre le `pull` et le `push`, ou par le cockpit à chaque `pull`. Sous le verrou
du tableau (`updateBoard`), pour chaque offre :

1. **Poser la demande** : un run `career-apply` en pause sur `submit__go` (lu dans
   `archon workflow runs --json --verbose`, comme le cockpit), dont l'offre est encore
   `APPLYING` par la prise que ce run tient (`claim_run` de son `load` : le run du listener, ou
   lui-même lancé à la main ; `holdsClaim`) et sans `harness.go_request` ouvert : écrire
   `go_request` (code tiré
   au hasard, `expires_at = applying.at + 2 h`, récapitulatif tiré du run), et recopier
   `prefill.png` dans `applications/<slug>/` pour que le bot puisse la joindre.
2. **Relayer la réponse** : `telegram_go.request === go_request.id`, `answer` posé, pas encore
   `relayed`, et à cet instant encore : run en pause sur `submit__go`, offre `APPLYING` par la
   même prise, `expires_at` pas dépassé. Alors `archon workflow approve <run>` (go) ou
   `archon workflow respond <run> reject "<raison>"` (non), comme `respondArgs` du cockpit, puis
   `go_request.relayed = { answer, at }`. Sinon rien, et la raison au journal (« run déjà
   repris », « prise périmée »…).
3. **Jamais deux fois** : `relayed` posé avant de rendre la main ; Archon refuse de toute façon
   `approve` sur un run qui n'est plus en pause.

Les gardes d'après le go ne changent pas : `own` relit le tableau juste avant le clic et rend
`superseded` si l'offre n'est plus à cette prise, `arm` écrit `armed.json`, le juge regarde le
reçu, `record` écrit le statut. Le relais se teste comme le reste : règles pures
(`goRequestFor`, `relayDecision`) dans `systems/.shared/`, avec un cas qui doit échouer par
règle (code d'une autre demande, réponse après `expires_at`, run déjà repris, prise d'un autre
run), et un faux `archon` comme `integrations/cockpit/test/fake-archon.ts`.

## 5. Règles de sûreté

- **Rien ne part de la VM.** Le bot enregistre une réponse ; seul le PC appelle `approve`, et
  seulement après ses propres vérifications.
- **Un code par demande, à usage unique**, lié à un run et à un instant : un vieux « GO »
  recopié de l'historique, ou un go donné pour un run abandonné, ne vaut rien pour le run
  suivant. Le code n'est pas un secret (il est dans le tableau, sur les deux machines) : il lie
  la réponse au bon récapitulatif ; l'authentification reste celle du bot (le chat d'Antoine).
- **Délai** : la demande expire avec la prise (deux heures), des deux côtés.
- **Un refus est un refus** : `NON` donne `reject`, le dossier reste `TAILORED`, rien n'est
  envoyé ; le listener ne reprend jamais une offre `TAILORED`.
- **`mode=verified-only` sur une plateforme éprouvée** ne demande pas de go : rien n'est envoyé
  sur Telegram avant le clic (au plus une notification après coup, hors de ce patch).

## 6. Ce qui ne change pas

- `/valider`, `/jobs`, `/cv`, `/remarque`, `/postuler` ; la règle de fusion `mergeBoards` (le
  nouveau champ du bot passe par la règle générale « champs du bot : la VM ») ; le go depuis
  le cockpit ou `archon workflow approve` sur le PC, qui restent possibles et prennent le pas
  (le relais voit que le run n'est plus en pause et ne fait rien).

## 7. Limites

- **La copie de la VM n'a pas de verrou** : un `GO` écrit par le bot entre la relecture de la
  VM et le `scp` du `push` (quelques secondes) serait écrasé, comme un `/valider`
  (`README.md` § 3). Parade proposée : le bot garde ses réponses dans un journal à part
  (`go_answers.jsonl`) et réécrit `telegram_go` à son passage suivant si la demande est encore
  ouverte et la réponse absente.
- **Latence** de vingt minutes au pire : pour un go immédiat, le cockpit reste le chemin court.
- **Le récapitulatif ne montre que ce que le PC a poussé** : sans `prefill.png` recopiée, pas
  d'image ; ouvrir le cockpit ou les artefacts du run pour voir le formulaire.
