# Décideurs à contacter (decision-makers)

<!-- Écrit d'après la fiche faite à la main pour Smartness le 2026-10-24
     (handoff/smartness-test/decideurs.md et message-decideurs.md) : ordre d'approche, une
     raison par personne, sources publiques seulement, recherches LinkedIn laissées à
     Antoine, note de connexion courte, e-mail honnête sur une exigence non couverte. -->

Tu prépares la prise de contact d'Antoine avec les bonnes personnes pour **une** de ses
candidatures : qui contacter, pourquoi, et quoi leur écrire. Tu écris un seul fichier JSON.
Tu travailles dans une boucle : chaque tour est une session neuve, et un contrôle
déterministe relit ton fichier après chaque tour. La boucle s'arrête quand le contrôle passe ;
après trois tours, le bloc s'arrête avec des contrôles rouges et se dit `unconverged` :
corrige ce que le contrôle signale au lieu de le contourner.

**Rien n'est envoyé.** Pas de message, pas de demande de connexion, pas de formulaire. Le
cockpit montre ta fiche ; Antoine cherche lui-même l'adresse dans son outil d'enrichissement
et envoie à la main.

## La candidature

- Dossier de candidature : `$INPUTS.application`
- Offre (JSON, facultative) : $INPUTS.offer
- CV envoyé (chemin, facultatif) : `$INPUTS.cv`
- Pitch envoyé (chemin, facultatif) : `$INPUTS.pitch`

Une entrée vide se cherche dans le dossier de candidature : `offer.json` (l'offre ;
`description_full` est l'annonce lue), `annonce.md` ou `annonce.txt`, `CV_*.md` (le CV
envoyé), `Message_Accroche_*.md` (le pitch envoyé), `interlocuteur_cible.json` (entreprise,
poste, lien), `remarques_utilisateur.txt` (les remarques d'Antoine sur cette candidature, à
respecter). Sans offre ni `offer.json`, l'offre est dans `pending_gold_jobs.json`, deux
dossiers au-dessus du dossier de candidature : l'entrée dont `slug` est le nom du dossier
(lis-la, ne modifie jamais ce fichier). Le CV et le pitch peuvent ne pas exister encore :
c'est normal, fais sans. Lis tout ce qui existe.

## Antoine

Lis `$INPUTS.profile` en entier, sa politique de rédaction d'abord. C'est la seule source
des faits sur Antoine : expériences, outils, langues, disponibilité. Rien ne vient d'ailleurs,
rien n'est gonflé ; un chiffre que le profil marque « à confirmer » ne s'écrit pas. Son nom,
pour la signature, est celui du titre du profil.

## Problèmes signalés par le contrôle au tour précédent

$INPUTS.problems

Vide = premier tour. Sinon, chaque problème listé doit avoir disparu quand tu finis : relis
ton fichier, corrige-le, garde ce qui était juste.

## 1. Trouver les personnes (au plus $INPUTS.max_people, vide = 4)

Cherche sur le web **public** seulement (WebSearch, puis WebFetch des pages trouvées) :

- le site de l'entreprise : pages équipe, à propos, direction (*leadership*, *management*),
  carrières (une page « travailler avec nous » nomme souvent les managers) ;
- les communiqués de presse et les articles (une nomination, une levée de fonds qui cite un
  dirigeant) ;
- les pages de conférences, de podcasts, de webinaires où une personne de l'entreprise
  intervient avec son titre ;
- les fiches d'entreprise publiques (type Crunchbase, registres, annuaires de start-up).

**Interdit :** ouvrir ou citer `linkedin.com` (récupérer ses pages automatiquement est
contraire à ses conditions d'utilisation), même quand un résultat de recherche y mène ; ouvrir
ou citer un courtier de données personnelles ou un outil d'enrichissement (RocketReach,
ZoomInfo, Lusha, Apollo, ContactOut, SignalHire, LeadIQ, Kaspr, Lemlist, Hunter, Dropcontact
et leurs semblables). Ignore ces résultats.

Dans l'ordre d'approche, garde les personnes qui comptent pour **ce poste** :

1. le manager de l'équipe que le poste rejoint (celui qui recrute, ou l'utilisateur direct) ;
2. le ou la responsable de la fonction (Head of, VP, directeur) ;
3. la personne du recrutement (Talent, People, RH) ;
4. en dernier recours, et seulement dans une petite structure, un fondateur ou le dirigeant.

Une personne n'entre dans la fiche que si une page publique la nomme avec son rôle, et tu
recopies de cette page, mot pour mot, la phrase ou le fragment qui le dit (son nom de famille
doit y être). Pas de personne déduite, devinée, ni « probablement » en poste : un nom qu'une
page ne porte pas, ou une page ancienne qui dit qu'elle est partie, ne s'écrit pas. Mieux vaut
une seule personne sûre que quatre incertaines. Si tu ne trouves personne, `people` reste vide
et tu donnes au moins deux recherches qu'Antoine tapera lui-même dans LinkedIn, connecté.

## 2. Écrire les messages

Langue : celle de l'annonce (annonce en anglais → messages en anglais ; en français →
français). Ton chaleureux, direct, professionnel, d'égal à égal ; court ; un seul fait
d'Antoine par phrase, tiré du profil et relié à ce que l'annonce demande ; une seule demande.
Si l'annonce exige ce que le profil n'a pas (une langue, typiquement), une phrase honnête le
dit plutôt que de le cacher.

- **Note de connexion LinkedIn** (`linkedin_note`) — à la première personne de la liste :
  au plus 300 caractères, commence par « Hi <Prénom>, » ou « Bonjour <Prénom>, », nomme
  l'entreprise ou le poste, un fait concret du profil, pas de lien, signée du prénom.
- **E-mail** (`email`) — en général à la même personne : objet de 60 caractères au plus ;
  corps de 60 à 150 mots, qui salue la personne par son prénom dès la première ligne, nomme
  l'entreprise, donne deux ou trois faits du profil utiles à ce poste, pose **une** question
  (un échange court, un conseil sur le bon interlocuteur), et finit par le nom complet
  d'Antoine, seul sur la dernière ligne.
- Sans personne trouvée : `to` vaut `""` dans les deux messages, qui s'adressent à l'équipe
  de recrutement (« Hello, », « Bonjour, »).

Pas de formule toute faite : ni « I'm applying for », « I am writing to », « passionate
about », « I'm excited », « leverage », « Dear Hiring Manager », ni « passionné par », « je
me permets de », « n'hésitez pas », ni mot de spam (« free », « urgent », « click here »),
ni plus d'un point d'exclamation, ni marqueur à compléter (`[Prénom]`, `{{…}}`).

**Les nombres.** Chaque nombre d'un message figure dans le profil ou dans l'annonce, tel
quel ; un pourcentage, un montant, un multiplicateur ne vient que du profil. Un chiffre de
presse (levée, nombre de clients) qui n'est pas dans l'annonce ne s'écrit pas ; « un court
échange » plutôt que « 20 minutes ».

**Aucune adresse e-mail, aucun numéro de téléphone, nulle part dans le fichier** : ni trouvé,
ni deviné (pas de « prenom.nom@… », pas de « format probable »), ni ceux d'Antoine, même s'ils
sont dans le profil. Le cockpit ouvre l'outil d'enrichissement avec `domain` ; Antoine fait
le reste.

## 3. Écris `$ARTIFACTS_DIR/$INPUTS.out`

Un seul objet JSON, rien autour (pas de bloc ```), exactement ces champs :

```json
{
  "company": "<l'entreprise, comme l'offre la nomme>",
  "job_title": "<l'intitulé du poste, comme l'annonce l'écrit>",
  "domain": "<le domaine du site de l'entreprise : dana.com, sans https://, www. ni chemin>",
  "language": "<en | fr : la langue de l'annonce, celle des messages>",
  "people": [
    {
      "name": "<Prénom Nom, comme la page l'écrit>",
      "role": "<son titre, comme la page l'écrit>",
      "why": "<une phrase, en français : pourquoi elle, pour ce poste>",
      "source": "<l'URL https exacte de la page qui la nomme>",
      "evidence": "<la phrase de cette page, recopiée mot pour mot, avec son nom>"
    }
  ],
  "searches": ["<Entreprise> \"Sales Operations\"", "<Entreprise> \"Talent\""],
  "linkedin_note": { "to": "<le nom exact d'une personne de people, ou \"\">", "text": "<≤ 300 caractères>" },
  "email": { "to": "<le nom exact d'une personne de people, ou \"\">", "subject": "<≤ 60 caractères>", "body": "<60 à 150 mots>" },
  "sources": ["<chaque page utilisée, dont chaque source de people>"],
  "notes": ["<en français : ce qui n'a pas été trouvé, ce qu'Antoine doit vérifier>"]
}
```

`people` est rangé dans l'ordre d'approche. `searches` : deux à quatre recherches LinkedIn
(texte à taper, jamais une URL), au moins deux si tu as moins de deux personnes. Dans le
corps de l'e-mail, les paragraphes se séparent par `\n\n`.

Ne modifie pas le dépôt ni le dossier de candidature, ne fais ni commit ni push, n'écris
nulle part ailleurs que `$ARTIFACTS_DIR/$INPUTS.out`.

## Déclare

Rends exactement :

- `summary` — deux ou trois phrases : qui tu as retenu et pourquoi dans cet ordre, ce que tu
  n'as pas trouvé, et l'angle des messages.
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
  `run_id` est la valeur ci-dessus telle quelle ; `path` est relatif à `$ARTIFACTS_DIR` et
  nomme le fichier lui-même (un pointeur nomme toujours un fichier, jamais un dossier).
