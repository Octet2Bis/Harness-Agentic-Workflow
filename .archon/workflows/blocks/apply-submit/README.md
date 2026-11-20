# Bloc `apply-submit`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la **candidature** elle-même, ce que `/postuler` → `ats_application_submitter.py`
faisait en « semi_automated » dans Master Plan (seul Lever en dry-run, `LEVER_LIVE_VERIFIE =
False`). Ici la voie générale est le **formulaire** : un agent remplit la page de candidature
dans un navigateur (Playwright MCP, profil persistant `.local/browser-profile`), sans jamais
cliquer « Envoyer » ; le code vérifie le pré-remplissage ; la pause humaine se place **avant
l'envoi** tant que la plateforme n'est pas éprouvée ; un second agent envoie et rapporte la
preuve ; le code vérifie le reçu ; un juge en contexte vierge tranche. Avant tout navigateur,
un script dit où s'ouvre le formulaire et sur quels hôtes l'agent a le droit d'agir.

```
target (script : formulaire, compte, passage de main, hôtes, lettre)
   │
prepare (boucle ≤ 2) : prefill ──▶ check_prefill        ← s'arrête aussi si prefill dit avoir envoyé
   │
gate (needs_go ?) ──▶ go (wait: approval)  ou  auto        ← seulement si check_prefill est vert
   │
decide (écrit decision.json) ──▶ own (relit la prise) ──▶ arm (écrit armed.json) ──▶ submit ──▶ check_receipt ──▶ judge ──▶ verdict
   ├─ refus au go : ni clic, ni reçu, ni juge ─────────────────────────▶ verdict (refused)
   ├─ offre plus tenue par la prise juste avant le clic : ni clic ──────▶ verdict (superseded, submitted: false)
   ├─ formulaire rouge au plafond (Workday compris) : ni go, ni clic ──▶ verdict (unconverged)
   ├─ prefill dit avoir envoyé : ni go, ni second clic, ni juge ───────▶ verdict (unproven, submitted: true)
   └─ reprise après un submit démarré : arm fermé, ni second clic ─────▶ verdict (unproven, submitted: true)
```

## Entrées

| Entrée | Rôle |
|---|---|
| `apply_url`, `platform`, `method` | la route résolue par le système appelant (`.shared/platforms.ts`) |
| `candidate` | `candidate.json` du bloc `cv-tailor` (nom, email, LinkedIn, disponibilité, prétentions…) ; ses `answers`, composées par un modèle, ne servent plus aux questions ouvertes |
| `cv`, `pitch` | le PDF du CV et le message d'accroche |
| `letter` | facultatif : la lettre de motivation en PDF, produite en amont ; vide (défaut) = pas de lettre, le formulaire est rempli exactement comme avant (voir « Lettre de motivation ») |
| `profile` | facultatif : `master_profile.md` ; une réponse libre peut en être un extrait mot pour mot |
| `answers_file` | facultatif : `<career_dir>/reponses_formulaires.md`, les réponses validées par Antoine (voir « Réponses aux formulaires ») ; vide ou absent = aucune |
| `mode` | `verified-only` (défaut : pause humaine sauf plateforme déjà éprouvée), `confirm` (toujours une pause), `auto` |
| `verified_platforms` | plateformes où une candidature a déjà été prouvée (liste tenue à la main) |
| `claim_board`, `claim_slug`, `claim_run` | la prise de l'appelant (chez career-apply : `pending_gold_jobs.json`, le slug, la prise notée par `load`) ; vides par défaut : rien à vérifier |

## Ce que le code vérifie

- `target.ts` (`applicationForm`, `hostPolicy` de `.shared/platforms.ts`, testés ;
  `target.test.ts` le lance pour de vrai) : avant tout navigateur, d'après l'URL seule, la
  page du formulaire (`form_url`, `how`), s'il est derrière un compte (`needs_login`), s'il
  faut passer la main (`handover`), les hôtes autorisés (`hosts`), la lettre et sa
  version texte. `prefill` et `submit` suivent ce résultat au lieu de deviner. Voir « Le
  formulaire, plateforme par plateforme ».
- `check-prefill.ts` (`.shared/submission-checks.ts`) : `submitted` est faux, pas de blocage
  (CAPTCHA, connexion), l'email du profil figure dans un champ rempli, le CV est attaché, le
  bouton d'envoi est visible, la capture d'écran existe ; et :
  - **l'hôte** de `final_url` est autorisé (`pageHostProblems`) : l'hôte exact ou un vrai
    sous-domaine, en https, sans identifiants avant l'hôte, sans port, sans punycode ni
    adresse IP ; `greenhouse.io.evil.com`, `greenhouse-io.com`, `http://` sont refusés avec un
    problème en français. Les hôtes : ceux de la plateforme ; pour le site d'un employeur, son
    hôte et ceux des ATS connus (son bouton « Postuler » y mène souvent) ; jamais un
    agrégateur (sauf LinkedIn « Candidature simplifiée ») ;
  - **Workday, SuccessFactors, Taleo** (un compte candidat par employeur) : l'agent remplit
    avec la session qu'Antoine a ouverte lui-même dans le navigateur du robot (choix du
    2026-10-24) ; sans session, il s'arrête bloqué en disant quel compte créer ou ouvrir, le
    contrôle reste rouge ; au plafond, `unconverged`, sans go ni clic, l'appelant écrit
    `TAILORED`. Le robot ne crée jamais de compte et ne tape jamais de mot de passe ;
  - **chaque réponse libre** (déclarée `free_text`, ou un champ de saisie dont le libellé est
    une question de motivation ou de fait : salaire, préavis, date de début, autorisation de
    travail, visa, mobilité…) vient mot pour mot d'une source permise (`freeTextProblems`) :
    une réponse de `reponses_formulaires.md`, un extrait d'au moins trois mots du profil
    maître, un fait de `candidate.json` (`name`, `email`, `phone`, `linkedin`, `portfolio`,
    `location`, `work_format`, `availability`, `salary_expectation`, `languages`), et pour une
    question de motivation ou un champ de lettre, le pitch ou la lettre. Une réponse
    composée, retouchée, ou tirée des `answers` de `candidate.json` est refusée ;
  - **une question sans réponse** reste vide et part dans le récapitulatif du go, « à remplir
    par Antoine », **seulement si un go suit** (`needsHumanGo`, le calcul de `gate` sur les
    mêmes liaisons) ; sans go (`auto`, ou plateforme déjà vérifiée en `verified-only`),
    personne ne la remplirait : le formulaire reste rouge, comme avant ;
  - **la lettre**, quand `letter` est donnée (`letterProblems`) : voir « Lettre de motivation ».

  Son `summary` est celui de l'agent suivi du récapitulatif du code (`prefillRecap`) : la
  source de chaque réponse libre, ce qui reste « à remplir par Antoine » (avec la réponse
  validée qui existe peut-être sous un autre libellé), ce qu'est devenue la lettre. Le go le
  montre tel quel (un champ de sortie à part casserait les appelants qui stubbent ce
  contrôle : une sortie de boucle n'a pas de schéma déclaré). `check-prefill.test.ts` le lance
  pour de vrai sur des artefacts temporaires.
- `gate.ts` / `decide.ts` : la règle « l'agent peut proposer, pas décider » — en
  `verified-only`, l'envoi attend un **go** humain (`archon workflow approve <run-id>`) tant
  que la plateforme n'est pas dans `verified_platforms`. Un refus (`archon workflow reject`)
  n'annule pas le run : `submit` est sauté et le verdict rend `refused` (rien d'envoyé, la
  réponse de l'humain dans le résumé). `gate` ne tourne que sur un formulaire vert ; sauté,
  `decide` refuse d'envoyer (`path: unconverged`) : seul un `needs_go: false` explicite
  dispense du go, et un envoi signalé par `prefill` interdit tout clic (`path:
  submitted_early`) (`decide.test.ts`). `decide` écrit sa décision dans
  `submission/decision.json` : si le bloc ne rend pas de verdict après le go, l'appelant
  sait que le clic était autorisé.
- `own.ts` (testé par `own.test.ts`) : la garde de propriété, `always_run: true`, juste
  avant `arm`, donc juste avant le clic, rejouée à chaque reprise. Elle relit `claim_board`
  et ne laisse passer que si l'offre est **encore** tenue par `claim_run` : `APPLYING` avec
  `applying.run` = la prise, rien d'autre. Sinon (prise close par le filet du listener,
  périmée après deux heures au go ; remise en file par `/valider`, prise par un autre run,
  déjà envoyée, tableau illisible ou introuvable : dans le doute, pas tenue), `arm` et
  `submit` sont sautés et le verdict rend `superseded`. C'est le cas d'un run lancé à la main
  pendant que le listener tenait l'offre, ou d'un vieux run approuvé après que le filet a clos
  sa prise : **un go se donne dans les deux heures**, sinon on revalide avec `/valider`. Sa règle `holds` est `holdsClaim` de `systems/.shared/career.ts`, recopiée (un bloc
  n'importe pas un système) ; `career.test.ts` vérifie que les deux disent la même chose.
- `arm.ts` (`click-trace.ts`, testé par `click-trace.test.ts`) : le verrou du clic, voir
  « Jamais deux clics » plus bas.
- `check-receipt.ts` : `submitted` vrai, message de confirmation reconnu pour la plateforme
  (ou générique FR/EN), capture d'écran après envoi, et le clic sur un hôte autorisé
  (`clicked_url` du reçu, à défaut `url` de click.json ; absente après un envoi : non prouvé).
  Sans preuve, le statut est `unproven`, jamais `verified`. `click.json` présent compte comme un envoi possible (`submitted: true`),
  même si l'agent rend `clicked: false` et aucun reçu.
- `workflow.test.ts` lit `apply-submit.yaml` (Bun.YAML) : l'arrêt de la boucle sur l'envoi
  précoce (`|| [ "$e" = true ]`), le plafond (`[ "$t" -ge 2 ]`, `max_iterations: 2`),
  `always_run` d'`own` et d'`arm`, `arm` derrière `own`, la porte de `submit` et son `retry`,
  le verdict qui lit `own`. Aucune autre porte ne casse si on les retire.

## Ce que le juge tranche

La page est-elle le formulaire de cet employeur pour cette offre (l'hôte, le code l'a déjà
vérifié) ? Les réponses saisies correspondent-elles à leur source ? Rien d'inventé, listes et
boutons radio compris (que le code ne relit pas : un « No » à « visa sponsorship » doit venir
du `Choix :` d'une réponse validée, du profil ou de la fiche) ? La lettre est-elle à sa place,
et le CV à la sienne ? La preuve d'envoi est-elle réelle ? Les champs « à remplir par
Antoine », qu'il a pu remplir lui-même au go, ne sont pas un défaut.

## Le formulaire, plateforme par plateforme

`applicationForm` (`.shared/platforms.ts`) ; `target` le rend, `prefill` l'ouvre.

| Plateforme | Formulaire ouvert | Compte | Ce que fait le harness |
|---|---|---|---|
| Greenhouse | `https://job-boards.greenhouse.io/embed/job_app?for=<board>&token=<id>` (l'UE garde `job-boards.eu.greenhouse.io`), depuis `…/<board>/jobs/<id>`, `…/<board>?gh_jid=<id>` ou l'embed : le formulaire vit souvent dans un iframe qu'un navigateur piloté ne lit pas | non | remplit la page embed, au premier plan |
| Page carrière qui embarque Greenhouse (`gh_jid`) | la page ; l'agent lit `src` de l'iframe `grnhse_iframe` et ouvre la page embed avec ses `for` et `token` | non | idem |
| Lever | l'annonce + `/apply` (pas d'iframe) | non | remplit |
| Ashby | l'annonce + `/application` | non | remplit |
| Workable | `apply.workable.com/<société>/j/<code>/apply/` | non | remplit |
| SmartRecruiters | l'annonce ; « I'm interested » ouvre le formulaire sur `jobs.smartrecruiters.com` | non | remplit |
| Workday, SuccessFactors, Taleo | Workday : l'annonce + `/apply` ; les autres : l'URL donnée | **un compte propre à chaque employeur** (Workday : un assistant en plusieurs pages) | la session qu'Antoine a ouverte dans le navigateur du robot ; sans elle, bloqué (`unconverged`, `TAILORED`) ; jamais de compte créé |
| Welcome to the Jungle, LinkedIn « Candidature simplifiée » | l'annonce | la session déjà ouverte dans le profil du navigateur | remplit ; une demande de connexion ou de création de compte l'arrête (`blocked`) |
| Indeed, Glassdoor, Himalayas… (agrégateurs) | rien | — | n'y postule pas : l'appelant résout d'abord la page de l'employeur |
| Teamtailor, Personio, Recruitee, Jobvite, BambooHR, iCIMS | l'annonce, son bouton de candidature | non | remplit |
| Site de l'employeur | l'URL ; s'il renvoie vers un ATS connu, le formulaire de celui-ci | — | remplit, sur son hôte (ou ses sous-domaines) et ceux des ATS connus seulement |

Un CAPTCHA, un mur de connexion, une demande de création de compte, une page hors des hôtes
autorisés : l'agent s'arrête (`blocked`), le contrôle reste rouge, rien n'est contourné.

## Réponses aux formulaires : `reponses_formulaires.md`

Les questions ouvertes (motivation, prétentions salariales, préavis, autorisation de travail,
mobilité…) ne se répondent que depuis le profil maître ou des réponses **validées par
Antoine**, tenues dans `<career_dir>/reponses_formulaires.md` (entrée `answers_file`). Le
fichier est écrit à la main par Antoine ; les agents le lisent, ne l'écrivent jamais. Format :

```markdown
# Réponses aux formulaires de candidature

Tout ce qui précède le premier titre `##` est ignoré, comme les commentaires HTML.

## Prétentions salariales
Variantes : Salary expectations | Expected salary | Rémunération souhaitée
45 000 à 50 000 € bruts annuels, selon le périmètre du poste.

## Avez-vous besoin d'un visa ?
Variantes : Do you require visa sponsorship? | Work authorisation in the EU
Choix : Non | No
Citoyen français : aucun visa n'est nécessaire pour travailler dans l'UE.

## Préavis
Variantes : Notice period | When can you start?
```

- une entrée par titre `## <question>`, le libellé le plus fréquent ;
- juste sous le titre, facultatives : `Variantes :` (autres libellés de la même question,
  séparés par `|`) et `Choix :` (les options à choisir dans une liste ou un bouton radio) ;
- la réponse : tout le texte jusqu'au titre suivant, tapée **telle quelle** ; une entrée sans
  réponse (`## Préavis` ci-dessus) est une question notée, jamais tapée ;
- les libellés se comparent sans accents, casse ni ponctuation (`findAnswer`) ; dans
  `prefill.json`, la source s'écrit `reponses_formulaires:<le titre ##>`, et le contrôle
  vérifie que la valeur tapée est la réponse, au blanc près.

Une question qu'aucune source ne couvre reste vide, listée dans `unanswered` (avec
`required`), et le go la montre « à remplir par Antoine » : il la remplit dans l'onglet resté
ouvert avant d'approuver. Le récapitulatif signale aussi une réponse validée qui existe sous
un autre libellé : il suffit alors d'ajouter ce libellé aux `Variantes :`.

### Proposition : enrichir le fichier après un envoi (pas faite)

L'idée : après un envoi approuvé et confirmé, `record` (career-apply) ajouterait au fichier
les réponses qu'Antoine a validées. Le flux de données ne le permet pas honnêtement : les
réponses qui viennent déjà du fichier ou du profil y sont, et celles qu'Antoine a tapées
lui-même au go ne passent jamais par le code (le navigateur ne les rapporte pas ; seule la
capture `receipt.png` les montre). Recopier quoi que ce soit d'autre écrirait des réponses
que personne n'a validées. Deux voies possibles, à décider :

1. au go, Antoine écrit ses réponses dans le texte de l'approbation, sous une forme fixe
   (`réponse : <question> = <texte>`, une par ligne) ; `decide` les reçoit déjà (`go.text`),
   `record` les ajoute au fichier, une entrée `##` chacune, sous un titre daté
   « À relire » ;
2. plus simple : `record` ajoute seulement les **questions** restées « à remplir par Antoine »,
   comme entrées sans réponse (jamais tapées), pour qu'Antoine les remplisse une fois pour
   toutes.

## Lettre de motivation (`letter`)

Contrat : `letter` est le chemin absolu de la lettre en PDF, produite en amont (comme
`CV.pdf`) ; sa version texte, si elle existe, est **le même chemin en `.md`**
(`application/lettre.pdf` → `application/lettre.md`, `letterTextPath`). Vide (défaut) : pas
de lettre, et le formulaire est rempli exactement comme avant (le pitch dans un champ texte de
lettre, rien dans un champ de téléversement).

Avec une lettre, `prefill` dit dans `prefill.json` ce que le formulaire offre
(`cover_letter_field` : `upload`, `text`, `both` ou `none`), et le contrôle exige
(`letterProblems`) :

- `upload` ou `both` : la lettre jointe (même nom de fichier) ;
- `text` : un champ rempli avec la lettre (sa version texte, source `lettre`, vérifiée mot
  pour mot) ou, à défaut de version texte, le pitch ;
- toujours : le CV joint, et la lettre jamais dans le champ CV ;
- `none` : rien de plus.

Le récapitulatif du go dit « Lettre (lettre.pdf) : jointe / collée dans … / pas de champ ».

## Sortie

`{ ok, status: verified | rejected | unproven | unconverged | refused | superseded, submitted, summary,
problems, findings, deliverable → submission/verdict.json }` : le verdict écrit avec l'inventaire du
dossier `submission/` (prefill.json, decision.json, receipt.json, captures, selon l'issue). Un
pointeur Archon nomme un fichier régulier, jamais un dossier, et seul verdict.json est là dans
toutes les issues.

- Formulaire encore rouge au plafond (deux tours) : la boucle rend la main (compteur `tries`
  du contrôle), aucun go n'est demandé, rien n'est cliqué, le juge ne tourne pas ; le verdict
  rend `ok: false, status: unconverged, submitted: false` avec les derniers `problems` du
  formulaire.
- Refus au go : `ok: false, status: refused, submitted: false`, résumé « Refused at the go:
  nothing was sent. <réponse> » ; le run finit `completed`.
- Offre perdue juste avant le clic (`own`) : `ok: false, status: superseded, submitted:
  false`, résumé « Not sent: … » ; le run finit `completed`. Si `submission/` porte déjà la
  trace d'un `submit` démarré (`armed.json`, `click.json`, un reçu), le verdict ne dit jamais
  « pas envoyé » : `unproven`, `submitted: true`.
- Envoi précoce : si `prefill` écrit `submitted: true` dans prefill.json (il a cliqué, ou un
  contrôle a envoyé le formulaire), la boucle s'arrête à ce tour, rien d'autre n'est cliqué,
  et le verdict rend `ok: false, status: unproven, submitted: true`. Si l'agent `submit`
  trouve déjà une page de confirmation, il ne clique pas et écrit `submitted: true` dans
  receipt.json (verdict `unproven`). **Limite :** le code ne voit que ce que les agents
  écrivent ; un envoi par `prefill` qu'il tait et que `submit` ne remarque pas reste
  indétectable par le code (seule la capture prefill.png, montrée au go, le trahirait).
- Le run n'échoue que sur une erreur (modèle, script) : le verdict ne tourne pas, et un
  verdict absent se lit `null` chez l'appelant (`if_skipped: null`), qui cherche alors les
  traces d'un clic dans `submission/` (decision.json, armed.json, click.json, receipt.json,
  receipt.png).
- Reprise après une erreur survenue une fois `submit` démarré : `arm` ferme la porte, `submit`
  est sauté, le verdict rend `ok: false, status: unproven, submitted: true`.

## Jamais deux clics

Archon rejoue un nœud agent de deux façons, et aucune option ne l'empêche
(dépôt Archon, `packages/workflows/src/dag-executor.ts`) :

1. **À la reprise d'un run en échec.** Si `submit` échoue après le clic (erreur du modèle,
   sortie hors `output_format`), le run finit `failed`. Le listener (career-listener) attend
   ce sous-run ; quand il reprend, son nœud `workflow:` relance une fois l'enfant en échec,
   qui rejoue ses nœuds en échec, donc `submit`. **Déterministe** : `arm`, juste avant
   `submit`, porte `always_run: true` (Archon le rejoue à chaque reprise, même réussi). Au
   premier passage il écrit `armed.json` et ouvre la porte ; à tout passage suivant, il
   trouve `armed.json` (ou `click.json`, `receipt.json`, `receipt.png`) et la ferme pour de
   bon : `submit` est sauté (`when: $arm.output.clear == true`). Cela vaut que l'agent ait
   suivi son prompt ou non. Prix de la prudence : une erreur après `submit` (reçu, juge)
   rend aussi `unproven` à la reprise, jamais `verified`.
2. **Dans le même passage.** Un nœud agent est rejoué après une erreur passagère du
   fournisseur (coupure, délai) : `retry: { max_attempts: 1 }` est le minimum accepté (le
   schéma refuse 0 ; Archon en fait jusqu'à 5 sur une surcharge ou une limite de débit, quoi
   qu'on écrive), et un fournisseur « best-effort » relance tout le prompt quand la sortie ne
   respecte pas le schéma. **Dépend du modèle** : le prompt `submit.md` lit d'abord
   `click.json` et `receipt.json` et ne clique pas s'ils existent ; il écrit `click.json`
   juste avant de cliquer. Un agent qui clique sans l'avoir écrit, puis tombe en erreur
   passagère, peut recliquer au nouvel essai : le code ne le voit pas. Ce que le code
   garantit alors : `click.json` présent rend `submitted: true` (`check-receipt.ts`, et
   `clickEvidence` chez career-apply), donc jamais « pas envoyé ».
3. **Hors d'Archon.** Un clic que l'agent `prefill` tait et que `submit` ne remarque pas reste
   invisible au code (voir « Envoi précoce »).

## Garde-fous

Jamais de contournement de CAPTCHA ou de mur de connexion, jamais de compte créé : l'agent
s'arrête, `blocked` est vrai, le contrôle reste rouge ; au plafond, le bloc rend
`unconverged` (`submitted: false`) avec le motif dans `problems`, sans go ni clic, et
l'humain reprend la main. Le profil de navigateur (`.local/`) n'est jamais versionné.

Limites :

- Sans session, un site à compte fait deux tours de boucle avant `unconverged` (la boucle
  ne s'arrête au premier tour que sur `submitted_early`, seul arrêt en plus admis par
  `validate.ts`, `EXTRA_STOPS`).
- Un employeur qui renvoie de `careers.acme.com` vers `jobs.acme.com` est refusé (seuls
  l'hôte donné et ses sous-domaines valent) ; un nom de domaine accentué (punycode) aussi.
  Échec fermé : `unconverged`, Antoine postule.
- Le code ne voit que ce que les agents écrivent : un hôte que `prefill` tait, ou une page
  visitée avant `final_url`, échappe au contrôle (la capture et le juge restent).
- `reponses_formulaires.md` est en lecture seule par consigne (l'agent a l'outil Write pour
  ses propres fichiers) ; rien ne le protège d'une écriture en code.

Sources adaptées (MIT) : `proficiently-claude-skills` @ 9bc1f6f
(`shared/references/ats-patterns.md` : iframe Greenhouse et sa page embed, `/apply` de Lever,
compte et assistant Workday ; `skills/apply/SKILL.md` : réponses standard tenues dans un
fichier validé par le candidat, jamais de compte créé), et `ai-job-search` @ e16acee,
© 2026 Mads Lorentzen (`.claude/commands/apply.md` : apex ATS, l'hôte exact ou un
sous-domaine, les sosies échouent fermés ; `.claude/skills/job-application-assistant/08-application-forms.md` :
toute réponse de formulaire défendable depuis les mêmes sources que le CV).

## Vérifier

`scripts/verify-block.sh apply-submit` — fixtures `auto-submitted`, `approved-submitted`,
`refused`, `unproven`, `unconverged`, `early-submitted`, `resumed-after-click`, `superseded`,
`superseded-after-click`, `letter-attached`, `no-session`. `target` y tourne pour de vrai :
`letter-attached` (Greenhouse, mode `confirm`, une lettre) asserte la page embed/job_app, la
lettre et sa version texte, puis le go, le clic et `verified` ; `auto-submitted` asserte le
chemin sans lettre (`letter: ""`, hôtes Lever seulement) ; `no-session` (Workday sans session
dans le navigateur du robot) asserte `needs_login`, puis `unconverged` sans stub pour `go`, `submit` ni `judge` : personne n'est
sollicité, rien n'est cliqué. Les règles du contrôle (hôtes, sosies, réponses libres, lettre,
champs « à remplir par Antoine » selon le go) sont testées dans
`.shared/platforms.test.ts`, `.shared/submission-checks.test.ts` et `check-prefill.test.ts`,
avec un cas qui doit échouer pour chacune. `superseded` (go donné) et `superseded-after-click` (`auto`, trace
d'un `submit` démarré) stubbent `own` à `held: false` : sans stub pour `submit`,
`check_receipt` ni `judge`, elles finissent `completed` avec `superseded`, `submitted:
false`, puis `unproven`, `submitted: true` : rien n'est cliqué sur une offre qui n'est plus
tenue. Les fixtures qui atteignent `arm` stubbent `own` à `held: true` ; la règle elle-même
est testée dans `own.test.ts` (scénarios du run lancé à la main et du vieux run repris, dans
le doute pas tenue, script lancé pour de vrai sur un tableau temporaire). `arm` y tourne
pour de vrai et ouvre la porte, sauf dans `resumed-after-click`, où son stub porte l'état lu à
une reprise (porte fermée) : sans stub pour `submit`, `check_receipt` ni `judge`, la fixture
finit `completed` avec `unproven`, `submitted: true`, donc rien n'est recliqué. `refused` finit
`completed` sans stub pour `submit` ni `judge` : rien n'est cliqué après un refus. `unconverged` et
`early-submitted` tournent en mode `auto` sans stub pour `go`, `submit` ni `judge` : les
atteindre ferait échouer le dry-run, elles prouvent donc qu'un formulaire rouge au plafond,
ou déjà envoyé, ne sollicite personne et ne déclenche aucun clic. La boucle
`until_bash` n'est pas exécutée en simulation : le stub `check_prefill` porte l'état du
dernier tour ; l'arrêt au plafond lui-même est contrôlé par `scripts/gates/validate.ts` (R1).
