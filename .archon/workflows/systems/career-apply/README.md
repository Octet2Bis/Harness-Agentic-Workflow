# Système `career-apply`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Le cas d'usage que Master Plan laissait à la main : **une offre validée → un CV sur mesure →
une candidature déposée sur la bonne plateforme**, sans autre intervention que le « go »
avant le premier envoi sur une plateforme pas encore vérifiée.

```
pending_gold_jobs.json (status VALIDATED, /valider sur Telegram)
        │
        ▼
 load ──▶ tailor (bloc cv-tailor) ──▶ cv ──▶ letter ──▶ letter_pick ──▶ render (PDF vérifié) ──▶ route ──▶ resolve? ──▶ confirm_route
              │ refus du Reviewer      ▲         │ refus     ▲                                                     │
              └─▶ revise_brief ──▶ tailor2       └─▶ revise_letter_brief ──▶ letter2 (rejoués une fois)        │
                                                                                   ▼
                                                            submit (bloc apply-submit : prefill → go? → clic → reçu → juge)
                                                                                   │
                                                                                   ▼
                       record : applications/<slug>/ (noms que le bot lit), statut, applications_log.csv

 annonce expirée (garde d'annonce de load)        ──▶ ni CV, ni PDF, ni apply-submit       ──▶ record : APPLY_FAILED
 tailor pas convergé (contrôles rouges au 3e tour) ──▶ ni PDF, ni route, ni apply-submit ──▶ record : APPLY_FAILED
 Reviewer refuse deux fois (tailor puis tailor2)   ──▶ ni PDF, ni route, ni apply-submit ──▶ record : VALIDATED (3e passage : APPLY_FAILED)
 PDF refusé par ses contrôles (render)             ──▶ ni route, ni apply-submit          ──▶ record : TAILORED
 formulaire pas convergé (rouge au 2e tour)        ──▶ ni go, ni clic, ni juge            ──▶ record : TAILORED
 refus au go                                       ──▶ ni clic, ni reçu, ni juge          ──▶ record : TAILORED
 offre perdue juste avant le clic (garde own)      ──▶ ni clic, ni reçu, ni juge          ──▶ record : TAILORED, rien écrit
 erreur dans apply-submit (verdict null)           ──▶ record lit submission/            ──▶ APPLY_UNPROVEN | TAILORED
 erreur hors bloc (resolve, load, render…)         ──▶ record ne tourne pas (run failed) ──▶ settle : APPLY_FAILED | APPLY_UNPROVEN
```

| Étape | Qui | Ce qui est vérifié |
|---|---|---|
| `load` | script | l'offre est à ce run : prise par lui (lancé à la main) ou par le listener qui le lance ; l'offre existe, le profil existe ; l'annonce est lue si le lien répond, puis passée à la garde d'annonce (`systems/.shared/posting-guard.ts`) : expirée → arrêt, suspecte → signalée sans rien bloquer (voir « La garde d'annonce ») |
| `tailor` | bloc `cv-tailor` | mots-clés, chiffres et portée (B2B/B2C, P&L, management, clients nommés) du profil seulement, pas de clichés ni de tirets en excès, une page, pitch (3 tours au plus) ; Reviewer ≥ A- |
| `revise_brief` + `tailor2` + `cv` | script + bloc `cv-tailor` + script | la ronde de révision (voir ci-dessous) : après un refus du Reviewer, ses constats deviennent les remarques d'un second passage du bloc, jugé par un Reviewer neuf ; `cv` retient le verdict qui compte (`revised`) |
| `revise_letter_brief` + `letter2` + `letter_pick` | script + bloc `cover-letter` + script | la même ronde pour la lettre (voir ci-dessous) ; `letter_pick` retient la lettre qui compte, que `render` et `record` lisent |
| `letter` | bloc `cover-letter` | lettre d'une page dans la langue de l'annonce, 250–300 mots, entreprise et poste nommés, deux preuves tracées au profil, aucun chiffre inventé, pas de clichés (3 tours au plus) ; Reviewer ≥ A-. Jamais bloquante : refusée, l'envoi part sans lettre |
| `render` | script | `CV.pdf` produit par Edge/Chrome headless (ou `pdf_cmd`), puis vérifié par du code (`pdf-checks.ts`) : structure, 2 pages au plus, texte extractible, aucune page sans texte, e-mail et téléphone du profil, aucun reste de gabarit, chiffres lisibles, polices embarquées ; `letter.html` → `letter.pdf` d'une page s'il existe (voir « Le PDF ») |
| `route` + `resolve` + `confirm_route` | script + agent + script | l'URL finale est https, chez l'employeur (jamais un agrégateur), méthode connue |
| `submit` | bloc `apply-submit` | page de formulaire connue par plateforme (Greenhouse, Lever, Ashby, SmartRecruiters, Workable ; Workday → passage de main, jamais de compte créé), hôte de la page dans la liste autorisée (sosies refusés), formulaire rempli avec `candidate.json`, CV joint, lettre jointe quand le formulaire en prend une, réponses libres tirées du profil ou de `<career>/reponses_formulaires.md` seulement (le reste est laissé vide et listé au go), un seul clic, confirmation reconnue, juge sur captures |
| `record` | script | statut écrit (`outcome()` et `recordStatus()` dans `systems/.shared/career.ts`) : `APPLIED`, `APPLY_UNPROVEN` (clic sans preuve, ou trace d'un clic possible : vérifier la boîte mail), `APPLY_FAILED`, `TAILORED` (dossier prêt, envoi non fait), `VALIDATED` (dossier refusé par le Reviewer, offre non lue, ou cv-tailor sans verdict : repris au prochain passage, 3 passages au plus ; un run lancé à la main sur une offre prise hors de `VALIDATED` réécrit à la place son statut d'avant, `applying.from`) |

## La ronde de révision du CV

Le bloc `cv-tailor` rend `rejected` quand ses contrôles passent mais que son Reviewer (Sonnet depuis le 2026-11-07, Opus rédigeant le CV ;
contexte vierge) refuse, avec des constats précis et actionnables (premier run réel,
2026-10-22 : note B, un constat bloquant, une affirmation recopiée de l'annonce que le profil
ne porte pas, et des constats mineurs ; le run finissait `cv-rejected` et le dossier était
abandonné). Le système, sans toucher au bloc, accorde alors **une** ronde de révision :
`revise_brief` (script pur, `revisionBrief` dans `systems/.shared/career.ts`, testé) ne tourne
que sur `status: rejected` (jamais après `unconverged`, dont les tours sont épuisés) et compose
les remarques du second passage, les remarques du candidat d'abord, puis « Reviewer findings
on the previous version (fix every blocking one, honour the minor ones; never invent facts the
profile does not state): » et les constats numérotés avec leur gravité, bloquants d'abord,
bornés à 4 000 caractères ; `tailor2` rejoue `cv-tailor` tel quel avec ces remarques, mêmes
entrées sinon, même dossier `application/` (le Drafter y retrouve sa première version et
réécrit les trois fichiers ; la première version est copiée dans `application-v1/`), et un
Reviewer neuf (`tailor2__judge`, contexte vierge) juge la seconde version. `cv` (`pickCv`,
pur, testé) retient le verdict de `tailor2` s'il a tourné, sinon celui de `tailor`, et porte
`revised` ; `letter`, `render` et `record` lisent `$cv.output`. Un second refus est
`cv-rejected` (VALIDATED, borné à trois passages), une seconde ronde pas convergée
`cv-unconverged` (APPLY_FAILED), et le résumé écrit dit « après révision ».

La lettre a la même ronde, câblée de la même façon (premier run réel, 2026-10-23 : lettre
refusée B deux fois, constats précis que rien ne renvoyait au rédacteur) : quand le Reviewer
de `cover-letter` refuse (`$letter.output.status == 'rejected'`), `revise_letter_brief` (le
même script `revise-brief`, `block: cover-letter` : `revisionBrief` avec `LETTER_REVISION`)
fait de ses constats les remarques de `letter2`, qui rejoue le bloc avec les mêmes entrées
dans `application/` (la première lettre, letter.md et letter.html, copiée dans
`application-v1/`), jugé par un Reviewer neuf (`letter2__judge`) ; `letter_pick` (script
`pick`, partagé avec `cv` : `pickVerdict`, pur, testé) retient la lettre qui compte, et
`render` (letter.pdf seulement si elle est `ok`) et `record` la lisent. Une lettre encore
refusée n'arrête rien : le CV part seul, la lettre n'est ni imprimée, ni jointe, ni recopiée
dans `applications/<slug>/`, et le résumé dit « Letter rejected après révision (not attached) ».

## Statuts dans `pending_gold_jobs.json`

`PENDING_VALIDATION` (jury) → **`VALIDATED`** (le candidat, `/valider`) → `APPLYING` (pris par le
listener, ou par `load` d'un run lancé à la main) → `APPLIED` | `APPLY_UNPROVEN` | `APPLY_FAILED`
| `TAILORED` (ou `VALIDATED`, retour en file borné à trois passages). Une prise dont le run a
échoué sans rien écrire (`settle`) devient le statut que `record` avait calculé
(`record.json`, `close.json`), sinon `APPLY_UNPROVEN` si `submission/` montre un clic
possible, sinon `APPLY_FAILED`. Une prise `APPLYING` de plus de deux heures (règle du
listener) devient `APPLY_UNPROVEN` ou `APPLY_FAILED` selon `submission/`, et son run, même
approuvé ensuite, ne clique plus : **un go se donne dans les deux heures**, sinon on revalide
avec `/valider`. Jamais `VALIDATED`. Une seule candidature en vol à la fois : le profil du
navigateur est partagé.
Toute écriture du tableau passe par son verrou (`pending_gold_jobs.json.lock`, voir
`integrations/master-plan/README.md`). Le bot Telegram lit
toujours `applications/<slug>/CV_*.md`, `Message_Accroche_*.md`, `interlocuteur_cible.json`,
`submission_receipt.json` : rien ne change pour `/cv` et `/postuler`.

Chaque bloc rend un verdict typé, ou `null` quand un de ses nœuds a échoué ; `record` en
dérive le statut. `record` ne tourne que si les étapes qu'il lit (`load`, `render`,
`confirm_route`) n'ont pas échoué : voir « Quand `record` ne tourne pas » plus bas.

| Ce qui s'est passé | `stage` | Statut écrit |
|---|---|---|
| annonce **expirée** selon la garde de `load` (`posting: expirée`) : 404 ou 410, redirection vers une liste, « offre expirée », date limite passée… ; ni CV, ni envoi ; résumé « Posting expired (posting guard): <raisons> » | `load` | `APPLY_FAILED` |
| `cv-tailor` **pas convergé** : contrôles encore rouges à son 3e et dernier tour (compteur `tries`), Reviewer sauté | `tailor` | `APPLY_FAILED` |
| `cv-tailor` refusé par le Reviewer (contrôles verts, note sous A-), puis refusé encore après la ronde de révision (`tailor2`) ; résumé « CV rejected après révision: … » | `tailor` | `VALIDATED` (3e passage : `APPLY_FAILED`) |
| `cv-tailor` sans verdict : un de ses nœuds a échoué (erreur du modèle ou d'un script) ; le run finit `failed` | `tailor` | `VALIDATED` (3e passage : `APPLY_FAILED`) |
| `render` : PDF refusé par ses contrôles (ou aucun navigateur) ; ni route, ni envoi ; résumé « PDF not rendered: » suivi des problèmes | `render` | `TAILORED` |
| `apply-submit` **pas convergé** : formulaire encore rouge à son 2e et dernier tour (CAPTCHA, mur de connexion, question sans réponse) ; ni go, ni clic, ni juge ; `submitted: false` | `submit` | `TAILORED` |
| `apply-submit` **refusé au go** (`status: refused`) : ni clic, ni reçu, ni juge ; résumé « Refused at the go: nothing was sent. <réponse> » | `submit` | `TAILORED` |
| `apply-submit` sans verdict (un de ses nœuds a échoué ; le run finit `failed`) **et** trace d'un clic possible dans `submission/` : `decision.json` avec `proceed: true` (écrit par `decide` avant le clic), `armed.json` (écrit par `arm` quand `submit` démarre), `click.json` (écrit par l'agent juste avant le clic), `receipt.json` qui ne dit pas `submitted: false`, `receipt.png`, ou `prefill.json` avec `submitted: true` | `submit` | `APPLY_UNPROVEN` |
| `apply-submit` sans verdict, sans aucune de ces traces (l'erreur est arrivée avant le go) ; le résumé dit de vérifier `submission/` et la boîte mail | `submit` | `TAILORED` |
| `apply-submit` `submitted: true` et `ok: true` / `submitted: true` sans preuve, refusé par le juge, ou envoi signalé par `prefill` | `done` / `submit` | `APPLIED` / `APPLY_UNPROVEN` |
| `apply-submit` `superseded` : juste avant le clic, la garde `own` a relu le tableau et l'offre n'est plus à cette prise (remise en file par `/valider`, prise par un autre run) ; ni clic, ni reçu, ni juge ; résumé « Not sent: … » | `submit` | `TAILORED` calculé, **rien écrit** (`mayRecord` : l'offre est à son nouveau propriétaire) |
| `apply-submit` `submitted: false` pour une autre raison | `submit` | `APPLY_FAILED` |

`VALIDATED` remet l'offre dans la file du `career-listener`, borné : chaque passage de
`record` incrémente `harness.attempts` (attaché au `validated_at` qu'il compte, donc remis à
zéro par un nouveau `/valider`, sans toucher aux champs du bot) ; le listener prend d'abord
l'offre la moins tentée, puis la plus ancienne ; une issue qui remettrait l'offre en file au
3e passage la clôt en `APPLY_FAILED` (« Stopped after 3 attempts… »). Un bloc pas convergé
a déjà épuisé ses tours : il clôt l'offre (`APPLY_FAILED`, que `/valider` remet en file après
une `/remarque` ou une retouche du profil ; `TAILORED`, où l'humain reprend la main). Un
refus au go donne `TAILORED` : le listener ne reprend jamais une offre `TAILORED`, rien ne
part sans un nouveau go. Aucune candidature n'est dite `APPLIED` sans `submitted: true`
d'`apply-submit`. Pour un bloc pas convergé, le résumé (`harness.summary` dans
`pending_gold_jobs.json`, `applications_log.csv`) commence par « CV / Form did not
converge: » suivi du résumé du bloc et de ses derniers problèmes.

`record` écrit **d'abord** le statut, puis recopie le dossier dans `applications/<slug>/` et
le journal : un fichier verrouillé (un PDF ouvert sous Windows) ou un journal illisible est
cité dans le résumé (« Not done: … »), jamais une exception qui laisserait l'offre `APPLYING`.

`record` sauve d'abord son issue dans `$ARTIFACTS_DIR/record.json` (relue par `settle` si
l'écriture du tableau échoue), puis n'écrit que sur l'offre de **sa** prise (`mayRecord`,
`systems/.shared/career.ts`) : `load` lui passe `claim_run`, la prise du listener (son run,
noté dans `applying.run`) ou ce run quand `load` a pris l'offre lui-même. Une issue « pas
envoyé » (`TAILORED`, `APPLY_FAILED`, `VALIDATED`) ne remplace que l'offre `APPLYING` par
cette prise, ou ce que ce même run a déjà écrit (`record` rejoué ; pas ce que le filet du
listener a écrit pour lui) ; jamais une prise close par le listener (prise périmée, `settle`),
jamais `APPLIED` ni `APPLY_UNPROVEN` (un refus d'un run plus ancien ne rétrograde pas un envoi
plus récent), jamais une offre remise en file par un `/valider` plus récent, jamais une offre
prise par un autre run. Une issue « envoyé » (`APPLIED`, `APPLY_UNPROVEN`) s'écrit aussi sur
une offre remise en file pendant l'attente du go, sinon le listener postulerait une seconde
fois ; un envoi fait par un run dont la prise a été close en `APPLY_FAILED` s'écrit donc
quand même par-dessus. Un run lancé à la main sur une offre qu'il n'a pas prise `VALIDATED`
n'écrit jamais `VALIDATED` : `record` (et `settle` depuis `record.json`) réécrit à la place
le statut d'avant la prise (`applying.from`). Sans prise (`load` a refusé l'offre,
`claim_run` vide), `record` n'écrit rien. Quand il n'écrit pas, `status_written: false` et le
résumé dit pourquoi ; si l'offre est encore `APPLYING` par la prise (fichier illisible ou
verrouillé à cet instant), `close` du listener écrit le statut à sa place, ou `settle` d'ici
pour un run lancé à la main (depuis `record.json`).

### La garde d'annonce

Après la prise, `load` lit la page de l'annonce (même en-tête, même délai de 15 s qu'avant) et
la passe à `guardPosting` (`systems/.shared/posting-guard.ts`, pure, testée règle par règle
dans `posting-guard.test.ts`), avec son statut HTTP, l'URL après redirections, le titre et le
texte visible. Le verdict sort dans `posting` (et ses raisons, en français, dans
`posting_reasons`), et dans `offer.json` (`posting_guard`) :

- **`expirée`** : la page répond 404 ou 410 ; elle redirige vers une page de liste ou de
  recherche, la page parente (la liste des offres de l'entreprise) ou l'accueil du site (un mur
  de connexion n'en est pas une) ; elle dit « cette offre n'est plus disponible », « offre
  expirée », « poste pourvu », « no longer accepting applications », « this job has
  expired »… ; son titre dit « page introuvable » ; sa date limite de candidature est passée.
  `load` rend `ok: false`, la prise reste, et `record` clôt l'offre `APPLY_FAILED` au stage
  `load` au lieu de la remettre en file : un nouveau passage relirait la même page morte. Une
  expiration à tort (une 404 peut être un lien cassé) se répare par `/valider`.
- **`suspecte`** : de l'argent demandé au candidat (frais de dossier, caution, kit à acheter) ;
  un contact par WhatsApp ou Telegram ; une adresse de recruteur sur une messagerie
  personnelle ; crypto-actifs avec promesse de gains, vente en réseau ; une paie irréaliste pour
  un poste sans expérience ; et, adapté de `posting_guard.py` (ai-job-search, MIT), une ligne
  écrite pour un agent (« ignore all previous instructions »), des caractères invisibles qui
  coupent des mots ou cachent du texte, des mots à alphabets mêlés. Un signal, jamais un
  blocage : le run continue, le résumé de `load` le dit (« Posting flagged as suspicious »),
  et l'humain juge (au go, ou dans le cockpit). L'offre passée à `cv-tailor` ne porte pas le
  verdict (une raison cite la ligne suspecte), et le texte de l'annonce qu'il lit est nettoyé
  de ses caractères invisibles (`cleanPostingText`).
- **`ok`**, ou **`non lue`** quand la page n'a pas répondu, ou pas en 2xx sans rien prouver
  (403, mur) : le run continue comme avant, sur les champs du tableau.

### Quand `record` ne tourne pas

Archon ne laisse jamais une liaison lire un nœud en échec, même avec `if_skipped`. Si `load`,
`render` ou `confirm_route` échoue (erreur d'un script, ou de l'agent `resolve`, qui fait
échouer `confirm_route`), `record` échoue avec eux et n'écrit rien ; le run finit `failed`.
Lancé par le listener, c'est le `settle` du listener qui clôt l'offre ; lancé à la main, le
nœud `settle` d'ici (`all_done`, seulement quand `load` a pris l'offre pour ce run,
`self_claimed`). Les deux appliquent `settleClaim` (`systems/.shared/pending.ts`) si l'offre
est encore `APPLYING` par cette prise : le statut sauvé par `record` (`record.json`) ou
`close` (`close.json`), sinon `APPLY_UNPROVEN` si `submission/` montre un clic possible, sinon
`APPLY_FAILED`. Les erreurs dans un bloc, elles, arrivent à `record` en verdict `null`
(tableau ci-dessus).

## Lancer

```bash
archon workflow run career-apply \
  --input slug=station_f \
  --input career_dir='C:\chemin\vers\career' \
  --input mode=verified-only --input verified_platforms=lever
```

Lancé à la main, le run **prend l'offre** (`load` : `APPLYING`, `applying.run` = ce run, sous
le verrou du tableau) : sûr timer en marche, le listener ne prend rien tant qu'elle est en vol.
`load` refuse, sans rien écrire (`ok: false`, « Not claimed: … »), une offre `APPLYING` par un
autre run, `APPLIED`, `APPLY_UNPROVEN`, ou toute offre tant qu'une autre candidature est en
vol. Il note le statut d'avant la prise (`applying.from`) : sur une offre `TAILORED`,
`PENDING_VALIDATION` ou `APPLY_FAILED`, une issue « à reprendre » (Reviewer sous A-, offre non
lue, cv-tailor sans verdict) lui rend ce statut, jamais `VALIDATED` : seul `/valider` met une
offre en file. Lancé par le listener (`claim_run`), il vérifie seulement que l'offre est
encore à cette prise et y note son dossier d'artefacts (`applying.artifacts`, lu par les
filets).

Pas de verrou de dossier (`mutates_checkout: false`) : aucun nœud n'écrit dans le checkout ;
avec le verrou, le sous-run du listener serait annulé (« This worktree is in use ») dès qu'un
autre run plus ancien est actif dans le dossier, un board-listener en pause par exemple. Le
profil du navigateur n'est partagé par deux runs que si deux candidatures sont en vol, ce
que le tableau interdit.

Le navigateur des agents (`prefill`, `submit`, `resolve`) vient de `.archon/mcp/browser.json`
(Playwright MCP, profil persistant `.local/browser-profile/`, jamais versionné) : se connecter
une fois à LinkedIn / Welcome to the Jungle dans ce profil suffit pour les formulaires à compte.

## Politique d'envoi (`mode`)

- `verified-only` (défaut) : le premier envoi sur une plateforme attend un « go »
  (`archon workflow approve <run>`) ; une fois confirmé, ajouter la plateforme à
  `verified_platforms` et les suivants partent seuls.
- `auto` : jamais de go. `confirm` : toujours un go.
- Un mur de connexion ou un CAPTCHA n'est jamais contourné : l'agent s'arrête, le formulaire
  reste rouge et, au plafond, `apply-submit` rend `unconverged` sans go ni clic ; le run se
  termine `completed` (`ok: false`), le dossier reste `TAILORED`, et le résumé dit pourquoi.
- Un refus (`archon workflow reject <run>`) n'annule plus le run : `apply-submit` rend
  `refused`, `record` écrit `TAILORED`, le run finit `completed`. C'est la façon d'arrêter un
  go en attente : Archon refuse `cancel` sur un run en pause. Un run abandonné
  (`archon workflow abandon`) ou annulé n'écrit rien ni ne passe par `settle` : lancé par le
  listener, celui-ci reste en pause ; `archon workflow resume <run du listener>` le fait finir
  et son `settle` clôt l'offre. Lancé à la main, l'offre reste `APPLYING` jusqu'à la règle des
  prises périmées du listener, deux heures plus tard (`APPLY_UNPROVEN` s'il y a trace d'un
  clic, sinon `APPLY_FAILED`) : d'ici là, le listener ne prend aucune autre offre.
- Un go se donne dans les deux heures : au-delà, la règle des prises périmées clôt la prise et
  le run, approuvé ensuite, ne clique plus (`superseded`) ; revalider avec `/valider`.

## Le PDF (`render`)

`render` imprime `CV.md` (→ `CV.html`, `cvDocument`) en `CV.pdf` avec Edge ou Chrome headless
(ou `pdf_cmd`), puis le vérifie **par du code** avant que quiconque le voie (`verifyPdf`,
`systems/.shared/pdf-checks.ts`, qui lit le PDF lui-même : ni dépendance, ni navigateur) :

| Règle | Échoue quand |
|---|---|
| structure | l'en-tête `%PDF-`, le `%%EOF` final, `startxref` ou le catalogue manquent (fichier tronqué ou abîmé), ou le PDF est chiffré |
| pages | le CV dépasse `cv_max_pages` (2, liaison du nœud) ; une lettre n'a pas exactement une page |
| couche texte | moins de 200 caractères extraits (PDF image), ou une page sans texte (page blanche, image seule) |
| contact | l'e-mail ou le téléphone du profil maître (`load.output.profile`, à défaut `candidate.json`) manque dans le texte ; le téléphone se compare chiffre à chiffre (`06.12.34.56.78` = `+33 6 12 34 56 78`) |
| gabarit | `{{…}}`, `TODO`, `lorem ipsum`, `[à compléter]` |
| glyphes | un glyphe sans Unicode (police sans ToUnicode : un ATS lirait des carrés), la zone privée, un caractère de contrôle, de l'UTF-8 lu comme du latin1 (`Ã©`), ou un nombre de la source (dates, chiffres clés) introuvable dans le texte |
| polices | une police utilisée n'est pas embarquée |

Le texte est extrait comme un ATS le lit : flux de contenu décompressés (FlateDecode), CMap
ToUnicode de Chromium et Edge (polices Type0 en chaînes hexadécimales de glyphes, Type3,
`/ActualText`), espaces et lignes déduits de la position des glyphes ; il est déposé à côté du
PDF (`CV.txt`).

`render` rend `{ ok, pdf, engine, pages, problems, summary, letter, letter_pages }`. Un contrôle
rouge rend `ok: false` et ses problèmes en français, préfixés du fichier (« CV.pdf : 3 pages,
2 au plus ») : ni route ni envoi, `record` écrit `TAILORED` et cite les problèmes dans le résumé
(« PDF not rendered: … »). Le PDF refusé est renommé `CV.rejected.pdf` : `record` ne le recopie
pas dans `applications/<slug>/` comme le CV de la candidature. Sans navigateur, `ok: false`
aussi, et `CV.html` reste prêt à imprimer à la main.

Une lettre de motivation `letter.html` posée dans `application/` est imprimée en `letter.pdf` et
passe les mêmes contrôles, à une page exactement ; refusée, elle arrête la candidature comme un
CV refusé, et `letter` reste vide. Aucun nœud n'en écrit encore : `renderChecked`, exporté par
`render.ts`, est la porte qu'un rendu de lettre réutilisera.

`systems/.shared/pdf-checks.test.ts` éprouve chaque règle contre un cas qui passe et un cas qui
doit échouer, sur des PDF imprimés une fois par Chromium (`systems/.shared/fixtures/pdf/`,
versionnés avec leur HTML) et des PDF écrits à la main : aucun navigateur n'est lancé. Idées
reprises de `ai-job-search/tools/verify_pdf.py` et `verify_layout.py` (MIT © 2026 Mads
Lorentzen).

## Vérifier

`scripts/verify-block.sh career-apply` — 14 fixtures : `applied` (lien ATS direct, plateforme
vérifiée), `aggregator-resolved` (LinkedIn → page Greenhouse, go humain), `cv-rejected`,
`cv-rejected-twice`, `cv-unconverged`, `letter-revised` (lettre refusée puis approuvée par
`letter2__judge` : imprimée, APPLIED), `letter-rejected-twice` (deux refus : CV seul, APPLIED),
`submit-unconverged`, `submit-refused`,
`submit-no-verdict`, `submit-crashed-after-go`, `submit-superseded`, `manual-run-failed`,
`posting-expired`.
Les scripts purs (`route`, `confirm-route`, `revise-brief`, `pick`, verdicts, cran de sécurité)
s'y exécutent pour de vrai ; `load`, `render` (E/S) sont stubbés et leurs règles testées à
l'unité (`systems/.shared/career.test.ts`, `markdown.test.ts`, `posting-guard.test.ts`,
`pdf-checks.test.ts`). `record` est stubbé dans les deux premières ; il tourne pour de vrai dans
les autres (sauf `manual-run-failed`, où il ne tourne pas), sur un dossier carrière qui
n'existe pas (`/stub/career` : il n'écrit rien, `status_written: false`) :

- `cv-rejected` : le Reviewer refuse (B, un constat bloquant), `revise_brief` (réel) rend
  `ok: true`, `tailor2` rejoue le bloc (les stubs `work` et `check`, nus, servent aux deux
  passages : Archon ne préfixe pas un corps de boucle) et `tailor2__judge` approuve ;
  `cv` rend `verified`, `revised: true`, et la suite est celle d'`applied` jusqu'à `record`
  (réel) : `APPLIED`, stage `done`.
- `cv-rejected-twice` : même début, mais `tailor2__judge` refuse encore ; `cv` rend `rejected`,
  `revised: true`, rien n'est rendu ni envoyé (aucun stub pour `write_letter`, `resolve`,
  `prefill`, `submit__go`, `submit__submit`, `submit__judge`), `record` rend `VALIDATED`, stage
  `tailor`, « CV rejected après révision ».
- `cv-unconverged` : la ronde de révision ne tourne pas (`revise_brief`, `tailor2` sautés) ;
  le stub `check` porte l'état du 3e et dernier tour (`ok: false`,
  `tries: 3`) ; `tailor__verdict` rend `unconverged`, `cv` le retient (`revised: false`),
  `record` rend `APPLY_FAILED`, stage
  `tailor`. Aucun stub pour `tailor__judge`, `tailor2__judge`, `resolve`, `prefill`, `submit__go`,
  `submit__submit` ni `submit__judge` : un agent atteint sans stub fait échouer le dry-run
  (« Missing reachable stub »), une approbation le met en pause, et `prefill` ouvre
  `apply-submit` ; la fixture, qui attend `completed`, prouve donc qu'`apply-submit` n'est
  pas atteint.
- `submit-unconverged` : le stub `check_prefill` porte l'état du 2e et dernier tour
  (CAPTCHA, `tries: 2`), plateforme non vérifiée en `verified-only` ; `submit__decide` dit
  `unconverged`, `submit__verdict` rend `submitted: false`, `record` rend `TAILORED`. Aucun
  stub pour `submit__go`, `submit__submit` ni `submit__judge` : la fixture finit `completed`,
  donc personne n'est sollicité et rien n'est cliqué.
- `submit-refused` : go refusé ; `submit__verdict` rend `refused`, `record` rend `TAILORED`,
  le run finit `completed`. Aucun stub pour `submit__submit` ni `submit__judge` : rien n'est
  cliqué après un refus.
- `submit-no-verdict` : clic autorisé (`auto`), puis le juge tombe en erreur (pas de stub
  `submit__judge`) : le verdict est sauté, `record` le lit `null`, trouve `decision.json`
  (`proceed: true`, écrit pour de vrai par `submit__decide`) et rend `APPLY_UNPROVEN` ; le run
  finit `failed`. Les autres traces (`receipt.json`, `receipt.png`, `prefill.json`) et le cas
  sans trace sont testés dans `career.test.ts` (`clickEvidence`), le compteur de passages et
  l'écriture par-dessus une prise périmée aussi (`recordStatus`, `pending.test.ts`).
- `submit-crashed-after-go` : le double clic, première moitié. Go automatique, `submit__arm`
  (réel) écrit `armed.json`, puis l'agent `submit__submit` tombe en erreur (pas de stub),
  peut-être après le clic : reçu, juge et verdict sautés, `record` trouve `decision.json` et
  `armed.json` et rend `APPLY_UNPROVEN` ; le run finit `failed`. La seconde moitié (la reprise
  par le listener, où `arm` ferme la porte) est la fixture `resumed-after-click`
  d'apply-submit ; `click.json` seul suffit aussi (`career.test.ts`).
- `submit-superseded` : go donné, puis la garde `submit__own` (stub : ce qu'elle a lu) dit
  que l'offre n'est plus à cette prise ; `submit__verdict` rend `superseded`, `record` rend
  `TAILORED` sans rien écrire. Aucun stub pour `submit__submit` ni `submit__judge` : la
  fixture finit `completed`, donc rien n'est cliqué.
- `posting-expired` : la garde de `load` a lu une annonce close (stub : `posting: expirée`,
  `ok: false`, prise du listener gardée) ; ni `cv-tailor`, ni `render`, ni `apply-submit` (aucun
  stub : un agent atteint ferait échouer le dry-run) ; `record` rend `APPLY_FAILED` au stage
  `load`, jamais `VALIDATED`.
- `manual-run-failed` : run lancé à la main (`self_claimed: true`), l'agent `resolve` tombe en
  erreur, `record` ne tourne pas, le run finit `failed` ; `settle` (réel) tourne quand même
  (sur `/stub/career` il n'écrit rien, `settled: false`).

Les fixtures qui atteignent `arm` stubbent `submit__own` (`held: true`) : sans vrai tableau, la
garde dirait « pas tenue ».

`scripts/record.test.ts` lance `record` pour de vrai sur un dossier carrière temporaire : un
PDF verrouillé (simulé) n'empêche pas l'écriture d'`APPLIED`, un journal illisible non plus,
une offre `APPLIED` par un autre run n'est pas rétrogradée, un fichier illisible rend
`status_written: false`, `record.json` est sauvé avant le tableau, sans prise rien ne
s'écrit. `scripts/load.test.ts` lance `load` et `settle` pour de vrai : prise à la main,
refus (offre tenue par le listener, déjà envoyée, autre candidature en vol), prise du
listener vérifiée, `settle` qui écrit `APPLY_FAILED`, `APPLY_UNPROVEN` (`armed.json`) ou
`APPLIED` (`record.json`), et une offre `TAILORED` prise à la main que `record` et `settle`
laissent `TAILORED` après un refus du Reviewer ; et la garde d'annonce sur des pages servies en
local (aucun site réel) : 410, redirection vers la liste, « no longer accepting
applications » → `ok: false`, puis `record` écrit `APPLY_FAILED` sur le tableau ; une page
suspecte → `ok: true`, signalée dans le résumé et `offer.json`, absente de l'offre que lit
l'agent ; une page en 403 ou sans lien → `non lue`. `mayRecord` est testé règle par règle dans
`career.test.ts`.

Le dry-run n'exécute pas `until_bash` (il suppose la boucle finie après un tour) : l'arrêt au
plafond lui-même est contrôlé par `scripts/gates/validate.ts` (R1) sur les blocs.

## Limites connues

- `own` lit le tableau sans son verrou : un changement dans les secondes qui précèdent le clic n'est pas vu.
- Après deux heures au go, tant que la règle des prises périmées n'a pas clos la prise, un vieux run approuvé tard et un nouveau run peuvent utiliser le profil du navigateur en même temps (l'un échoue sur le verrou du profil ; pas de second clic).
- La règle des prises périmées ne lit que `submission/`, pas `record.json` ni `close.json`.
- Un détenteur du verrou du tableau bloqué plus de 15 s perd le verrou.
- Timer arrêté, un run lancé à la main puis annulé reste `APPLYING` (Archon ne reprend qu'un run `failed` ou en pause ; remède : la règle des prises périmées, deux heures, timer en marche).
- Un tableau illisible au moment de `own` change un go approuvé en `TAILORED`.
- `prefill`, dans un vieux run repris, n'est pas gardé par `own`.
- La copie de la VM n'a pas de verrou entre son téléchargement et son `scp`.
