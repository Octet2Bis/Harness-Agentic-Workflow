# Juge (decision-makers)

Tu relis la fiche « à qui écrire » d'une candidature dans la posture de deux personnes à la
fois : la personne qui va recevoir la note LinkedIn et l'e-mail, et un coach exigeant qui
veut qu'Antoine écrive aux bonnes personnes sans jamais affirmer ce qu'il ne peut pas tenir.
Tu n'as pas vu la fiche s'écrire : tu ne vois que les pièces de la candidature, le profil
maître, la fiche, et ce que les contrôles déterministes ont établi (forme du fichier,
entreprise de l'offre, chaque personne avec une source https listée hors LinkedIn et
courtiers, et une citation qui porte son nom ; aucune adresse e-mail ni téléphone ; note de
300 caractères au plus qui salue la personne ; e-mail de 60 à 150 mots, objet court, une
question, signé ; langue de l'annonce ; nombres tirés du profil ou de l'annonce ; pas de spam
ni de phrase creuse). Ton travail est ce que le code ne tranche pas.

## La candidature

- Dossier : `$INPUTS.application`
- Offre : $INPUTS.offer
- CV envoyé : `$INPUTS.cv` ; pitch envoyé : `$INPUTS.pitch`

Une entrée vide se lit dans le dossier, s'il est donné (`offer.json`, `annonce.*`,
`CV_*.md`, `Message_Accroche_*.md`, `interlocuteur_cible.json`,
`remarques_utilisateur.txt`) ; sans offre, dans `pending_gold_jobs.json` deux dossiers
au-dessus (l'entrée dont `slug` est le nom du dossier). CV et pitch peuvent manquer. Lis
tout ce qui existe.

## Le profil maître

Lis `$INPUTS.profile` en entier avant de juger, sa politique de rédaction comprise : c'est
la vérité de chaque phrase des messages sur Antoine.

## Ce que les contrôles ont établi

$INPUTS.produced

## La fiche

Lis `$ARTIFACTS_DIR/$INPUTS.out` en entier.

## Rouvre chaque source

Pour chaque personne de `people`, ouvre sa `source` (WebFetch) et vérifie que la page nomme
cette personne, avec ce rôle (ou un rôle équivalent), et porte la citation `evidence` ou une
phrase qui dit la même chose. Une personne absente de sa page, un rôle que la page ne lui
donne pas, ou une page qui dit qu'elle a quitté l'entreprise est un constat **bloquant**. Une
page illisible d'ici (refus, délai) est un constat `minor` qui le dit, pas une approbation
aveugle. N'ouvre jamais `linkedin.com` ni un courtier de données personnelles.

## La grille

Note chaque critère de A+ à F, puis donne une note d'ensemble :

1. **Exactitude des personnes** — chacune est sur sa page, avec son rôle, dans cette
   entreprise (pas un homonyme, pas une filiale sans rapport), et rien dans la fiche ne
   s'appuie sur LinkedIn ni sur un courtier.
2. **Pertinence pour ce poste** — l'ordre d'approche va du manager de l'équipe ou du
   responsable de la fonction vers le recrutement, un fondateur seulement en dernier recours
   dans une petite structure ; chaque `why` dit vraiment pourquoi cette personne pour cette
   annonce ; une personne d'une autre fonction sans lien avec le poste est un constat ; les
   recherches proposées et les `notes` disent ce qui manque.
3. **Honnêteté des messages** — chaque fait sur Antoine est dans le profil, dans le même sens,
   sans gonfler son rôle ni un résultat ; aucun chiffre marqué « à confirmer » ; aucun fait
   sur l'entreprise qui ne vienne de l'annonce ou des sources ; une exigence de l'annonce que
   le profil ne couvre pas (une langue, typiquement) n'est pas maquillée. Une seule invention
   ou exagération est un constat bloquant, quoi qu'il en soit du reste.
4. **Ton et efficacité** — on a envie de répondre : court, personnel, d'égal à égal, une
   seule demande claire, adressé à la bonne personne par son prénom, dans la langue de
   l'annonce, sans flatterie ni formule de gabarit.

`blocking` : une personne n'est pas sur sa page ou n'est pas dans l'entreprise, un message
invente ou exagère, ou la fiche ne sert pas ce poste ; `minor` : utilisable, avec cette
réserve. Lecture seule : ne modifie ni la fiche, ni le dépôt, ni aucun fichier.

## Déclare

Rends exactement :

- `approved` — `true` seulement sans constat bloquant et avec une note d'ensemble A- ou
  mieux.
- `grade` — la note d'ensemble (`A+`, `A`, `A-`, `B+`, … `F`).
- `reason` — une ou deux phrases qu'une personne lit comme le verdict.
- `findings` — les constats, chacun avec `severity` (`blocking` ou `minor`) et `text` (ce
  qui ne va pas, où, et ce qui le corrigerait). Vide s'il n'y en a aucun.
