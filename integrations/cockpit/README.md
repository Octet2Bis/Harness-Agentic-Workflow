# Cockpit local du plan carrière

Une page sur ton PC, servie par `bun` depuis ce dépôt, pour piloter les candidatures sans
taper de commande : voir les offres du tableau du bot, lire l'annonce, laisser des remarques,
en cocher, lancer l'adaptation du CV et la préparation de la candidature, suivre le run, relire
le CV et la lettre (aussi en PDF, tels qu'ils seront joints), la fiche candidat et le
préremplissage, puis donner le go ou refuser ; voir les décideurs à qui écrire, avec la note
LinkedIn et l'e-mail prêts à copier ; être prévenu quand une offre attend ton geste.

## Lancer

- **L'icône « Cockpit » du Bureau** (`Cockpit.lnk`) : un double-clic démarre le cockpit s'il ne
  tourne pas (sans fenêtre, sortie dans `.local\cockpit\cockpit.log`) et ouvre la page dans une
  fenêtre d'application à elle (Chrome `--app` dans son propre dossier `.local\cockpit\app-window-<port>`,
  sinon Edge, sinon le navigateur par défaut ; un second double-clic remet cette fenêtre devant au lieu d'en
  ouvrir une autre). Elle n'utilise jamais le profil Chrome d'Antoine : `--app` dans un profil fermé rouvrait
  aussi ses onglets, d'où une fenêtre Chrome à côté (2026-11-18). La fenêtre et l'icône « Cockpit » (Bureau et
  épingle de la barre des tâches) portent le même `System.AppUserModel.ID` (`Harness.Cockpit.<port>`) : la fenêtre
  s'ouvre sous l'icône épinglée, et une épingle faite sur la fenêtre Chrome est redirigée vers l'icône. Les liens
  d'annonce cliqués dans cette fenêtre s'ouvrent dans Chrome, sinon le navigateur par défaut du PC
  (`POST /api/open`, accepté depuis le PC seulement). Pour qu'elles s'ouvrent dans un profil Chrome
  précis (celui qui porte l'extension Claude, pas un profil de travail), écrire
  `.local\cockpit\chrome.json` = `{"profil": "Antoine Bis"}` : le dossier du profil (le plus sûr : c'est celui
  que porte le raccourci Chrome du profil, `--profile-directory="Profile 1"`), ou son nom, ou le compte Google ou son
  début avant @, cherché dans `Local State` de Chrome à chaque ouverture (`--profile-directory`) ; un nom qui ne
  correspond à rien est signalé dans `cockpit.log` avec la liste des profils ; la
  fenêtre du cockpit s'ouvre dans le même profil au prochain clic sur l'icône (un chrome.json plus récent que le
  démarrage du cockpit le fait redémarrer, comme un changement de code ; une fenêtre déjà ouverte garde son profil :
  la fermer d'abord). La fenêtre prend l'icône du bureau (`/favicon.ico`), dans la barre des tâches aussi ;
  épingler le raccourci du bureau, pas la fenêtre Chrome, qui ne relancerait pas le cockpit. Sans ce fichier, ou si
  aucun profil ne correspond (ou plusieurs), Chrome prend le dernier profil utilisé. Le robot aussi passe par Chrome (Playwright
  MCP `--browser chrome`, PDF imprimés par Chrome headless). C'est
  `cockpit-launch.ps1`, lancé par un PowerShell caché ; l'icône est `cockpit-v2.ico` (feuille crème cochée sur fond lie-de-vin, 2026-10-25 ; un nouveau nom force Windows à relire l'icône au lieu de son cache). Le cockpit reste
  ensuite en marche jusqu'à la fin de la session, et la page se met à jour seule (état toutes les
  5 s, tableau de la VM toutes les 5 min). Si le cockpit ne répond pas en 30 s, une boîte dit où
  lire l'erreur. Après une mise à jour des fichiers du cockpit, le clic suivant sur l'icône
  arrête l'ancien cockpit et relance le nouveau (`.local\cockpit\running-<port>.json` note le
  pid et l'heure de départ) : les runs Archon, processus à part, ne sont pas touchés ; seule la
  file d'attente de la page est perdue.
- **Démarrage avec Windows (facultatif)** : une fois, dans PowerShell depuis le dossier du
  harness, `integrations\cockpit\install-cockpit.ps1`. Il enregistre une tâche planifiée
  « Cockpit candidatures » qui démarre le cockpit à l'ouverture de session (l'icône n'attend
  plus) et le relance s'il tombe, et refait l'icône avec Windows lui-même. `-Uninstall` retire
  la tâche et l'icône. Rien d'autre n'est touché : pas de service, pas de registre.
- Windows, à la main : double-clic sur `cockpit.cmd`. Si le cockpit tourne déjà il ouvre juste
  la page ; sinon il le lance (`bun integrations\cockpit\cockpit.ts --career-dir
  "C:\chemin\vers\career"`). `bun` et
  `archon` doivent être sur le PATH, comme pour le §6 de `integrations/master-plan/README.md`.
- Ailleurs : `bun integrations/cockpit/cockpit.ts --career-dir <Workspace/career>`.
- Options : `--harness <dossier>` (défaut : ce dépôt), `--port 8766`, `--mode confirm|auto|verified-only`
  (défaut `confirm`), `--verified-platforms lever,…`, `--archon "<commande>"`, `--no-open`,
  `--pull-every <minutes>` (défaut 5 ; 0 : jamais tout seul), `--pull "<commande>"` (défaut :
  `sync_pending.ps1 -Direction pull`, voir ci-dessous), `--no-triage` (plus de tri des offres),
  `--triage-engine rules|llm` (défaut `rules` depuis le 2026-10-30 : le tri automatique n'appelle
  aucun modèle, règles du code seules ; `llm` : le bloc job-triage, 2 à 3 appels Sonnet par offre ;
  sans changer ce réglage, le bouton « Trier avec Claude » de la fiche d'une offre lance ce tri pour
  elle seule, `POST /api/triage-llm {slug}`),
  `--no-radar` (plus de relève des sources : ni bouton ni horloge), `--radar-every <minutes>`
  (défaut 15 ; 0 : relève sur le bouton seulement), `--contacts` (les décideurs sont
  cherchés tout seuls dès qu'un CV est prêt, appels de modèle ; coupé par défaut depuis le
  2026-10-30, le bouton de l'onglet reste), `--no-toast` (plus de notification Windows).

## Plusieurs candidats

Le même cockpit sert à plusieurs personnes, chacune avec son dossier carrière, sans fork du code :

- **Ajouter un candidat** : une fois, dans PowerShell depuis le dossier du harness,
  `integrations\cockpit\new-candidate.ps1 -Id camille -Name Camille` (port 8767 par défaut,
  `-CareerDir` pour un autre dossier que `Bureau\Carriere-<Name>`). Le script crée, sans jamais
  écraser un fichier existant : `candidat.json`, `criteres.json` (critères du tri des offres),
  `master_profile.md` à remplir (CV complet, e-mail, LinkedIn, ville, disponibilité),
  `pending_gold_jobs.json` vide, `applications\`, et l'icône « Cockpit <Name> » du Bureau.
- **`<career_dir>/candidat.json`** : `id` (minuscules), `nom` (affiché), `port`, et en option
  `profil_navigateur`, `tableau_depuis_vm: true` (seul le tableau d'origine vient de la VM : sans
  ce champ, le bouton de rafraîchissement disparaît), `acces_telephone` (logins autorisés depuis un
  téléphone, lus par l'accès distant) et `radar_auto: false` (plus de relève automatique des sources
  toutes les 15 min ; le bouton « Relever les sources » reste). Sans ce fichier, c'est le candidat
  d'origine, comme avant.
- **Un profil de navigateur par candidat.** `.archon/mcp/browser.json` lance
  `.archon/mcp/browser-mcp.ts`, qui ouvre Playwright MCP sur `HARNESS_BROWSER_PROFILE`, sinon sur
  `.local/browser-profile` (Antoine, runs à la main et career-listener). Le cockpit d'un candidat le
  pose à `.local/browser-profile-<id>` : ses candidatures partent avec ses connexions à elle ou
  lui, jamais celles d'un autre. Se connecter une fois à ses sites dans ce profil :
  `chrome.exe --user-data-dir="<harness>\.local\browser-profile-<id>" https://www.linkedin.com/login`.
- **Runs séparés.** Chaque cockpit ne montre et n'attend que les runs dont `career_dir` est le sien
  (plus ceux qu'il a lancés, notés dans `.local/cockpit/<id>/launches.json`) : deux candidats
  peuvent avoir une candidature en vol en même temps, chacun dans son navigateur. La règle « une à
  la fois » reste celle de chaque tableau.
- Le radar de la VM ne remplit que le tableau d'origine ; le tableau d'un autre candidat se
  remplit par sa propre source d'offres (à brancher selon son métier).

## La page

Deux volets : à gauche les offres (filtre texte, « À traiter » / « En tri » / « Toutes », cases pour en
préparer plusieurs, flèches ↑ ↓), à droite la fiche de l'offre choisie : en-tête, actions
(« Ouvrir l'annonce », « Postuler à cette offre » ou « Postuler à nouveau », « Retirer de la file »), le
bandeau du go quand le run attend, la bande « en cours » (étape, barre, depuis quand) quand il
travaille, « CV en PDF » et « Lettre en PDF » dès qu'ils existent, puis les onglets contacts,
annonce (texte de la page et verdict de la garde d'annonce : expirée, suspecte ou ok, celle que
`load` applique), remarques, suivi, CV, lettre, candidat, envoi, dossier, journal (Antoine,
2026-10-24 : pitch et entretien retirés de la page ; `/api/interview` reste). Le CV et la lettre
(Markdown) sont rendus comme un document, le JSON est mis en forme, le journal reste brut. La page ne se redessine que quand
son contenu change : la saisie, le défilement et le focus survivent au rafraîchissement (5 s).
Thème unique, clair, même quand Windows est en mode sombre : papier crème et encre brune (neutres
teintés chaud, jamais de gris ni de blanc purs), un seul accent lie-de-vin, titres en Fraunces,
texte en Instrument Sans, données en IBM Plex Mono (replis Georgia / Segoe UI hors ligne). Contrastes
AA vérifiés (texte secondaire ≥ 4,5:1), pas de cartes imbriquées, pas d'ombre ni de flou : les règles
d'« impeccable » (pbakaus) et de `.agents/rules/ui_editorial_eye_on_design_craft.md` (accord « crème
papier ») de Master Plan.

La page s'affiche sans attendre Archon : l'état renvoie la dernière liste de runs connue et demande la
suivante en fond (un seul `archon workflow runs` à la fois) ; la première se charge dès le démarrage.

**Tri des offres.** Quand `<career_dir>/criteres.json` existe (langues, salaire minimum ; voir
`blocks/job-triage/README.md`), le cockpit lance un run `career-triage` à la fois sur l'offre à
traiter la plus récente (`PENDING_VALIDATION`, `VALIDATED`) qui n'a pas encore son tri avec ces
critères, et lit `<career_dir>/triage/<clé>.json` : badge « tri : écartée / à vérifier / retenue »
dans la liste (raisons en survol) et bandeau dans la fiche (raisons, notes, comment la lecture a
été vérifiée). Les écartées sont masquées par défaut (case « masquer les écartées ») mais jamais
retirées du tableau ni rendues non lançables : l'agent propose, tu décides. Au plus deux
lancements par offre et par session ; `--no-triage` arrête tout tri. L'en-tête dit « n offres à
trier » ou « tri de <offre> ». Le code écarte seul, sans run ni modèle, l'offre pas encore touchée que
`load` écarterait d'avance (`preScreen` : publiée depuis plus de `offre_age_max_jours` jours, entreprise
qui contredit le lien, métier de `intitules_exclus`) ; une offre préparée ou envoyée n'est jamais cachée
pour son âge.

« À traiter » ne montre que les offres triées (retenues, à vérifier) et celles où une candidature est en
route ; celles que le tri n'a pas encore lues sont sous « En tri ». Ordre : ce qui est en route, puis
les retenues avant les « à vérifier », la meilleure adéquation devant, la plus récente à égalité. La
colonne de droite donne l'**adéquation au cœur du poste** notée par le tri (`coreFit`, note « Cœur du
poste : x exigences étayées, y en partie, z absentes, sur 3 ») : forte (au moins deux étayées, aucune
absente), faible (aucune étayée, au moins une absente), moyenne entre les deux. Le score et le palier
du radar (75 à 95, Silver / Gold : ils ne départageaient rien), l'angle, le verdict du jury, le rôle
visé, le salaire estimé et les compétences devinés par le radar ne sont plus montrés (Antoine,
2026-10-25 : « le score ne me semble pas cohérent ») ; l'annonce et le tri font foi.

**Relève des sources.** Le bouton « Relever les sources » de la barre (à côté de « Rafraîchir »)
lance le système `career-radar` (scripts seulement, aucun modèle : lecture des sources d'offres,
contrôles, fusion des nouvelles offres dans le tableau), exactement `archon workflow run
career-radar --cwd <dépôt> --folder --input career_dir=<dossier carrière> --detach`. Le serveur
la lance aussi tout seul, 60 s après son démarrage puis toutes les 15 minutes (`--radar-every`,
`radar_auto: false` dans `candidat.json` pour la couper, `--no-radar` pour tout arrêter) : c'est
le serveur qui décide, la page ne fait que demander. Une relève à la fois par dossier carrière :
tant qu'un run `career-radar` de ce dossier est vivant, le bouton est grisé (« relève en cours »)
et l'horloge attend ; la relève est indépendante des candidatures et des tris (aucun verrou, le
système ne touche pas au dépôt). Le panneau sous les outils de la liste lit
`<dossier carrière>/last_radar_report.json` : « Dernière relève : il y a N min · X sources OK, Y en
échec · Z offres brutes, Q retenues, A ajoutées », et, déplié, chaque source avec son statut tel
que le radar l'écrit (`200`, `attente (prochain appel dans N min)`, `clé absente (NOM)`, `erreur
réseau`…), sa pastille (ok, à surveiller, échec), son nombre d'offres et sa durée. Les statuts ne
nomment que des variables ; ce qui ressemblerait à une valeur de clé est masqué. Sans rapport :
« aucune relève encore ». Pendant une relève : « Relève en cours… » et l'étape (lecture des
sources, contrôles, fusion dans le tableau). Les offres ajoutées apparaissent dans la liste au
rafraîchissement suivant (5 s). La dernière relève est notée sous la clé `#radar` de
`launches.json` (un slug d'offre ne commence jamais par `#`), jamais prise pour une candidature.

Seule la page du cockpit agit sur lui : une requête dont l'en-tête Host n'est pas le cockpit
(127.0.0.1 ou localhost sur son port, plus `--allow-host <hôte>` et les noms Tailscale de `remote-<port>.json`, voir « Depuis le téléphone »), ou un
POST sans `application/json` ou venu d'une autre page (Origin / Referer), est refusée (403) :
un site ouvert dans le même navigateur ne peut ni lancer un run ni donner le go.

**À toi.** En tête de la liste (donc en premier sur le téléphone), ce qui attend ton geste,
calculé par `attentionItems` (lib.ts) : go attendu, compte à ouvrir sur le site de candidature,
candidature à finir à la main (pas de page trouvée, formulaire incomplet), envoi à vérifier
(`APPLY_UNPROVEN`), étape en échec. Un refus au go n'en est pas une. Un clic ouvre la fiche ;
« vu » range l'alerte jusqu'à ce que la situation change (autre run, autre passage). Le titre de
la fenêtre porte le nombre, et sous Windows une notification part une fois par situation, même
après un redémarrage (`.local/cockpit/alertes.json`) ; un clic dessus ouvre la fiche.

**Contacts.** Les décideurs à qui écrire pour l'offre (bloc `decision-makers`) : noms et rôles
trouvés sur des pages publiques de l'entreprise (site, presse), jamais sur LinkedIn ni chez un
courtier de données, chacun avec sa source, une recherche LinkedIn que tu ouvres toi-même
(connecté), et Hunter sur le domaine de l'entreprise pour l'e-mail (gratuit, 25 recherches par
mois) ; puis la note LinkedIn (300 caractères au plus) et l'e-mail, à copier ou à ouvrir dans ta
messagerie. Aucune adresse n'est écrite par le robot, rien n'est envoyé. Le cockpit lance la
recherche tout seul, une à la fois et une fois par offre, dès qu'un CV est prêt (copié dans
`applications/<slug>/`, ou dans un run qui attend le go) sur une offre de moins de 7 jours ; le
bouton de l'onglet la (re)lance à la demande. Le run fini, `decideurs.json` et
`decideurs.verdict.json` sont recopiés dans `applications/<slug>/` ; un verdict autre que
`verified` s'affiche en « à relire ».

**PDF.** `GET /api/pdf/<slug>/cv|lettre` sert le PDF tel qu'il sera joint : celui du run
(`application/CV.pdf`, `application/letter.pdf`, rendus et contrôlés par `render`), sinon celui
du dossier (`CV_*.pdf`, `Lettre_*.pdf`), jamais un `*.rejected.pdf`. Il s'ouvre aussi depuis le
téléphone (mêmes contrôles d'accès que le reste).

## Ce qu'il fait, et ne fait pas

- **Le tableau vient de la VM.** Le radar et le bot tournent sur la VM Oracle et y remplissent
  `pending_gold_jobs.json` ; la copie du PC, que le cockpit et `career-apply` lisent, n'est
  rafraîchie par aucun des scripts de Master Plan (`pull_from_vm.ps1` ne ramène pas
  `Workspace\career`). Le cockpit lance donc lui-même
  `integrations\master-plan\sync_pending.ps1 -Direction pull` (PowerShell, même clé SSH, même
  VM que tes scripts) au démarrage, puis toutes les 5 minutes, et sur « Rafraîchir depuis la
  VM » : la copie de la VM est fusionnée offre par offre dans celle du PC, sous le verrou du
  tableau, et rien ne part vers la VM. La ligne sous le bouton dit quand la dernière fusion a eu
  lieu, ou pourquoi elle a échoué (clé SSH, VM injoignable, `bun` absent). Les offres sont
  listées de la plus récente à la plus ancienne. Les statuts écrits par le harness
  (`APPLIED`, …) restent sur le PC jusqu'à un `sync_pending.ps1 -Direction push`, que le
  cockpit ne lance jamais seul.
- Il lit `pending_gold_jobs.json` et montre chaque offre avec son statut. Une offre se lance
  depuis les mêmes statuts que la prise à la main (`PENDING_VALIDATION`, `VALIDATED`, `TAILORED`,
  `APPLY_FAILED`) ; `APPLIED` et `APPLY_UNPROVEN` ne se relancent jamais d'ici.
- Onglet **annonce** : le lien « Ouvrir l'annonce » (la page du tableau, dans ton navigateur),
  les champs du tableau (rôle visé, siège, date, salaire, compétences, résumé) et un aperçu du
  texte de la page, lu par le cockpit exactement comme `load` le lit (même en-tête, même délai de
  15 s, même `visibleText`), gardé 10 min, « Relire la page » pour le rafraîchir. Quand un run
  existe, le texte que ce run a lu (`offer.json`) s'affiche aussi. Une page rendue par script ou
  derrière une connexion donne un aperçu vide : le lien reste là pour l'ouvrir toi-même, le
  cockpit ne contourne aucune connexion.
- Onglet **remarques** : les remarques déjà laissées sur l'offre et une zone pour en ajouter.
  Elles vont dans `applications/<slug>/remarques_utilisateur.txt`, dans la forme exacte de
  `/remarque` du bot (`[<date ISO>] <texte>`), et `load` les lit au prochain run sur l'offre :
  elles orientent le CV et le pitch (ce que l'agent reçoit), jamais l'envoi.
- **Postuler.** Sous l'en-tête, une zone « Consigne pour cette candidature » et le bouton « Postuler à cette
  offre ». La consigne (facultative) est écrite dans `applications/<slug>/remarques_utilisateur.txt`
  (`[<ISO>] Consigne de candidature : …`) avant le lancement : `load` la lit et la passe au CV et à la lettre.
  L'ordre reçu (heure, consigne) s'affiche sur la fiche, puis le parcours : ordre reçu → CV, lettre,
  formulaire → ton go → envoi → envoyée. Les issues viennent du statut écrit par `record` : `APPLIED`
  (envoyée, reçu prouvé), `APPLY_UNPROVEN` (clic fait, reçu non vu), `APPLY_FAILED` (avec le motif), `TAILORED`
  après un run (« à envoyer toi-même » : lien `harness.apply_url`, motif, PDF en haut de la fiche, message aux
  décideurs). Plusieurs offres cochées : « Postuler à N offres », sans consigne.
- « Postuler » lance exactement la commande du §6 :
  `archon workflow run career-apply --cwd <dépôt> --folder --input slug=… --input career_dir=…
  --input mode=confirm --detach`. Une candidature en vol à la fois : les autres attendent en file
  (c'est la règle de prise du tableau, pas une limite du cockpit). Après un run terminé ou en
  échec, le même bouton relance l'offre si son statut le permet encore (`APPLY_FAILED` ou
  `PENDING_VALIDATION`, par exemple).
- Pendant le run : l'avancement nœud par nœud (`archon workflow runs --json --verbose`), dans la
  liste (étape en cours et depuis quand), dans la fiche et dans l'onglet suivi ; « lecture des
  runs… » tant que la première liste n'est pas arrivée. Le CV, la lettre et `candidate.json` lus dans les artefacts du run (`archon workflow get`), le journal
  (`archon workflow logs`). Quand le run s'arrête au go, un bandeau le dit.
- « Go » = `archon workflow approve <run>` ; « Refuser » = `archon workflow reject <run>` (avec
  la raison, `respond … reject <raison>`). Le cockpit n'appelle aucun modèle et n'envoie rien
  lui-même : c'est le bloc `apply-submit`, après ton go, qui clique.
- Après le run, le dossier final `applications/<slug>/` copié par `record` s'affiche (CV, lettre,
  `interlocuteur_cible.json`, reçu, décideurs).
- Il écoute `127.0.0.1` seulement (le téléphone passe par Tailscale, voir plus haut). Les runs qu'il a lancés sont notés dans
  `.local/cockpit/launches.json` (slug → run, plus `#radar` → dernière relève des sources ; `.local/` n'est jamais versionné).

## La sélection du jour (2 offres, ton oui depuis le téléphone)

Active seulement quand `<dossier carrière>\selection.json` existe (absent : aucun appel de modèle) :

```json
{ "par_jour": 2, "heure": "08:00", "liste_courte": 6, "mode_envoi": "verified-only", "plateformes_verifiees": [], "decideurs": true }
```

- À `heure` (heure du PC ; PC éteint à cette heure : dès qu'il s'allume), le code prend la **liste
  courte** : les offres `PENDING_VALIDATION` retenues sous les critères actuels (tri du radar
  unifié de la VM, des règles, ou déjà de Claude), jamais proposées un autre jour, publiées depuis
  7 jours au plus, dans ta zone ; hors Royaume-Uni d'abord (candidature compliquée depuis le
  Brexit, 2026-11-09 : pénalisé, pas exclu), puis celles que Claude a déjà jugées (rien à payer),
  celles du modèle local, des règles ; salaire connu et annonce complète avant.
- Claude (career-triage moteur `llm` : bloc job-triage, Sonnet) les juge **une à la fois**, avec
  l'annonce complète gardée par la VM quand la page a expiré, jusqu'à en avoir `par_jour` retenues
  (2 ; 3 au plus) ou la liste épuisée. Le tri par règles attend pendant ce temps.
- Les meilleures (cœur du poste étayé par ton profil, une exigence étayée de moins pour une offre
  réservée au Royaume-Uni, puis salaire, puis fraîcheur) vont dans `selection\<date>.json`. Une
  offre dont **aucune** exigence du cœur du poste n'est étayée n'est jamais proposée (Forestry
  England et PLOS, 0 sur 3, refusées le 2026-11-09). Claude les lit et pose une carte par offre dans le projet.
- Ton **oui** devient `inbox\<clé>.json` (`{"key", "date", "decision": "go"}`, écrit par Claude) :
  le cockpit met l'offre en file `career-apply` avec `mode_envoi` (`verified-only` : la première
  candidature sur une plateforme absente de `plateformes_verifiees` s'arrête au dernier clic pour
  ton go, dans le cockpit ou depuis ton téléphone ; `auto` : jamais). Ses décideurs et messages se
  préparent dès le CV prêt (`decideurs`), rien n'est envoyé. Un **non** est seulement noté. Le
  fichier lu part dans `inbox\lus\` (ou `inbox\refuses\` s'il ne correspond à rien).
- Modèles (2026-11-07) : Opus rédige le CV, Sonnet fait tout le reste (tri, juges, lettre,
  formulaire, décideurs).
- L'onglet **Sélectionnées** de la liste garde toutes les offres choisies (60 derniers jours), la
  plus récente devant, avec ta réponse et où en est la candidature ; filtres « À répondre », « Oui »,
  « Non », « Toutes », et la recherche.

## Les entreprises full remote (onglet de la liste)

Demandé par Antoine le 2026-11-08 après une annonce PostHog (« Developer Marketer, Sales ») que le
radar n'avait jamais captée : le titre ne passait pas les requêtes du métier.

- Le radar (`.shared/radar/fetchers/ats_boards.js`, sur la VM) note chaque entreprise dont le
  tableau d'offres public (Greenhouse, Lever, Ashby) a au moins un poste en full remote (jamais
  hybride) : `100 % remote` quand au moins 3 postes dont 90 % remote, ou listée à la main
  (`<dossier carrière>\entreprises_full_remote.json`, mêmes clés que `next40_boards.json` ; PostHog
  est dans la liste du système `.shared/radar/entreprises_full_remote.json`), sinon `quelques postes
  remote`. Ses postes de la famille large (marketing, growth, vente, produit, design, QA, ops…) vont
  dans `remote_company_jobs.json`, **à part du tableau, quel que soit le tri**. Les 100 % remote
  sont relues toutes les 6 h ; les autres quand le bloc tournant de l'univers repasse ; une
  entreprise non relue depuis 21 jours sort de la liste.
- Ton index des entreprises 100 % remote (`verified_remote_companies.json` de l'ancien radar, 1 326
  entreprises le 2026-10-25, recopié à chaque cycle de la VM quand il change) entre aussi : le
  radar cherche leur tableau (lien de la page carrières, sinon l'identifiant et le nom essayés sur
  Ashby, Lever, Greenhouse ; 25 entreprises par cycle, résultat dans `remote_index_ats.json`).
  Trouvé : lu comme une entreprise listée à la main. Introuvable : l'entreprise reste dans l'onglet
  avec sa page carrières, sans postes ; nouvel essai un mois plus tard.
- Les deux fichiers (`remote_companies.json`, `remote_company_jobs.json`) arrivent sur le PC avec
  le reste du radar unifié (`pull_radar_vm.ps1`).
- L'onglet **Entreprises full remote** : filtres « Avec postes » (au moins un poste pour toi),
  « 100 % remote », « Toutes » ; la recherche porte sur l'entreprise et sur les postes. La fiche de
  l'entreprise donne sa page carrières et ses postes ; **Mettre au tableau** fait d'un poste une
  offre comme les autres (`source` « Entreprise full remote (…) », même id que le radar : pas de
  doublon) : fiche, tri, Postuler. Une offre mise au tableau ainsi reste dans « À traiter » même
  écartée par le tri.

## Depuis le téléphone (Tailscale)

Lire les annonces, les CV, donner le go depuis ton téléphone, chez toi ou dehors, tant que le PC
est allumé. Rien n'est ouvert sur Internet : le cockpit reste sur `127.0.0.1`, et Tailscale le
relaie en HTTPS seulement vers tes appareils.

1. Tailscale installé et connecté sur le PC et le téléphone, même compte ; dans la console
   (<https://login.tailscale.com/admin/dns>) « MagicDNS » et « HTTPS Certificates » activés.
2. Le cockpit lancé et qui le reste : `install-cockpit.ps1` (démarrage avec Windows). Le PC ne
   doit pas se mettre en veille (Paramètres > Système > Alimentation : « Jamais » sur secteur).
3. Une fois, dans PowerShell depuis le dossier du harness : `integrations\cockpit\tailscale-phone.ps1`.
   Il lance `tailscale serve --bg --https=443 http://127.0.0.1:8766`, écrit
   `.local\cockpit\remote-8766.json` (nom Tailscale du PC, comptes autorisés : par défaut celui du
   PC) et affiche l'adresse à ouvrir sur le téléphone, `https://<pc>.<réseau>.ts.net/`. Ajoute-la à
   l'écran d'accueil.

Le cockpit (`remote.ts`) refuse en 403 toute requête relayée par Tailscale dont le compte
(`Tailscale-User-Login`, posé par Tailscale, impossible à forger depuis le téléphone) n'est pas
dans `remote-<port>.json`, et toute requête relayée sans identité ; sans ce fichier, rien ne passe
de l'extérieur. Le fichier est relu à chaque changement, sans redémarrer.

Deuxième cockpit sur le même PC (ta compagne, port 8767) : elle rejoint ton réseau Tailscale avec
son compte (invitation depuis la console), puis
`tailscale-phone.ps1 -Port 8767 -HttpsPort 8443 -AllowUser <son login>`. Son téléphone ouvre
`https://<pc>.<réseau>.ts.net:8443/` et n'a pas accès au tien, et inversement. Pour la fermer au
niveau du réseau aussi, une règle ACL dans la console peut limiter son compte au port 8443.

Tout couper : `tailscale-phone.ps1 -Off` (et `-Port 8767 -HttpsPort 8443 -Off` pour l'autre).
Ne jamais utiliser `tailscale funnel`, qui publierait le cockpit sur Internet : le script prévient
s'il le voit actif.

## Vérifié

`lib.ts` (tableau, commandes, état des runs) est testé dans `lib.test.ts` ; `cockpit.test.ts`
lance le cockpit pour de vrai contre un faux Archon (`test/fake-archon.ts`), un faux pull
(`test/fake-pull.ts`) et une fausse annonce en ligne, et vérifie la commande envoyée, la file,
le rafraîchissement depuis la VM (offres nouvelles en tête, échec dit sans toucher au
tableau), l'aperçu de l'annonce (menu et scripts retirés, page manquante dite), la remarque
écrite dans le fichier du bot, la lecture du CV avant le go, l'alerte du go et « vu », la
recherche des décideurs partie toute seule une fois sur le CV prêt puis recopiée, le PDF du run
servi en `application/pdf`, le go et le refus, et que rien d'autre n'est demandé à Archon. Un second cockpit, à cadence courte, vérifie la relève des sources :
première relève toute seule après le délai avec la commande du système, une relève à la fois
(bouton refusé pendant une relève, horloge en attente), rapport lu et offre ajoutée visible, et
`--no-radar` sur le premier. `scripts/gates.sh` les lance (`bun test integrations`).
