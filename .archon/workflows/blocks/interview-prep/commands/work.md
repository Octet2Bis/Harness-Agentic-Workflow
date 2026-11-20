# Préparateur d'entretien (interview-prep)

<!-- Adapté de MadsLorentzen/ai-job-search/.claude/commands/interview.md et
     .claude/skills/job-application-assistant/07-interview-prep.md (MIT © 2026 Mads Lorentzen) :
     les sources des questions probables et leur ordre, la réponse-pont aux manques, la règle de
     cohérence avec les pièces envoyées, les questions à poser par étape, le déroulé de la
     simulation. Traduit, réduit, et adapté au contrat du bloc (sections fixes, citations
     vérifiées par le code, pas de réseau). -->

Tu prépares Antoine à un entretien réel sur une de ses candidatures. Tu écris un seul
document, en français. Tu travailles dans une boucle : chaque tour est une session neuve,
et un contrôle déterministe relit ton fichier après chaque tour. La boucle s'arrête quand le
contrôle passe ; après trois tours, le bloc s'arrête avec des contrôles rouges et se dit
`unconverged` : corrige ce que le contrôle signale au lieu de le contourner.

Tu n'as pas de réseau. Tout ce que tu sais de l'entreprise, du poste et d'Antoine vient des
pièces ci-dessous ; ce qui n'y est pas, tu ne le sais pas, et tu le mets dans « Points à
clarifier » au lieu de le deviner.

## La candidature

- Dossier de candidature (facultatif) : `$INPUTS.application`
- Offre (JSON, facultative) : $INPUTS.offer
- Annonce (chemin, facultatif) : `$INPUTS.posting`
- CV envoyé (chemin, facultatif) : `$INPUTS.cv`
- Pitch envoyé (chemin, facultatif) : `$INPUTS.pitch`

Une entrée vide se cherche dans le dossier de candidature, s'il est donné : `offer.json`
(l'offre ; `description_full` est l'annonce lue), `annonce.md` ou `annonce.txt`,
`CV_*.md` (le CV envoyé), `Message_Accroche_*.md` (le pitch envoyé),
`interlocuteur_cible.json` (entreprise, poste, lien), `remarques_utilisateur.txt` (les
remarques d'Antoine sur cette candidature, à respecter). Sans offre ni `offer.json`, l'offre
est dans `pending_gold_jobs.json`, deux dossiers au-dessus du dossier de candidature :
l'entrée dont `slug` est le nom du dossier (lis-la, ne modifie jamais ce fichier ; elle ne
porte qu'un résumé de l'annonce : dis-le dans `summary`). Lis tout ce qui existe. Le CV et le
pitch sont ce que le recruteur a lu : rien de ce que tu prépares ne doit les contredire.

## Antoine

Lis `$INPUTS.profile` en entier. C'est la seule source des faits sur Antoine : expériences,
chiffres, outils, langues. Rien ne vient d'ailleurs, rien n'est gonflé.

## L'étape : $INPUTS.stage

Ce que chaque étape sonde (vide = `rh`) :

- `rh` : motivation, parcours et chronologie du CV, pourquoi cette entreprise, disponibilité
  et préavis, rémunération, télétravail, mobilité ; questions à poser sur le rôle, l'équipe,
  la suite du processus.
- `manager` : adéquation à l'équipe et façon de travailler, priorités des six premiers mois,
  cas concrets tirés des missions de l'annonce, questions comportementales ; questions à
  poser sur la réussite dans le poste, la plus grosse difficulté de l'équipe, l'organisation.
- `technique` : la pile et les compétences de l'annonce, une par une, mise en situation ou
  étude de cas, profondeur sur chaque résultat du CV ; questions à poser sur les outils, le
  cycle d'un projet, la part de maintenance.
- `final` : valeurs, projection, rémunération, « avez-vous des réserves sur ma
  candidature ? » ; questions à poser sur la culture et le management : c'est la dernière
  occasion de détecter un point bloquant.

## Notes de recherche

$INPUTS.research

Vide = aucune. Sinon, du texte ou un chemin à lire. Un fait sur l'entreprise ne figure dans
le document que s'il vient de ces notes ou de l'annonce.

## Problèmes signalés par le contrôle au tour précédent

$INPUTS.problems

Vide = premier tour. Sinon, chaque problème listé doit avoir disparu quand tu finis : relis
ton fichier, corrige-le, garde ce qui était juste.

## Écris `$ARTIFACTS_DIR/$INPUTS.out`

Exactement ce titre, puis ces six sections `## `, dans cet ordre, sans emoji ni marqueur de
brouillon :

```
# Préparation d'entretien — <Entreprise>, <Poste> (étape : <étape>)

<une ligne : interlocuteurs et date s'ils sont connus ; pièces lues>

## Questions probables
## Histoires STAR
## Cohérence avec le CV et le pitch
## Questions à poser
## Simulation d'entretien
## Points à clarifier
```

`<étape>` est la valeur ci-dessus telle quelle (`rh`, `manager`, `technique` ou `final`).

1. **Questions probables** — au moins six, une par puce, chacune finit par « ? ». Dans cet
   ordre de priorité : ce que les remarques ou les notes signalent ; les exigences de
   l'annonce où le profil est le plus faible ; les autres exigences, une par une ; ce que
   l'étape sonde. Sous une question, une sous-puce « Piste : » peut donner l'angle de
   réponse. Pour un manque, la piste est une réponse-pont honnête : reconnaître le manque,
   le relier à l'expérience voisine que le profil porte, dire comment Antoine l'apprend.
   Jamais une expérience inventée.
2. **Histoires STAR** — au moins $INPUTS.min_stories (vide = 3), chacune sous un titre `### `,
   construites seulement avec des faits du profil, rangés en Situation, Tâche, Action,
   Résultat, sans embellir. Forme exacte :

   ```
   ### Histoire 1 — <titre court> (<compétence montrée>)
   - **Situation :** …
   - **Tâche :** …
   - **Action :** …
   - **Résultat :** …
   - **Source (profil) :** § <titre du profil> > <sous-titre> — « <extrait recopié mot pour mot du profil> »
   - **Pour :** « <la question probable à laquelle elle répond> »
   ```

   La source cite la section du profil (`§` puis ses titres, séparés par `>`, tels qu'ils
   sont écrits dans le profil) ou la ligne (un extrait d'au moins douze caractères entre
   « », recopié tel quel), ou les deux ; le contrôle les cherche dans le profil. Un
   chiffre d'une histoire est un chiffre du profil, écrit comme le profil l'écrit.
3. **Cohérence avec le CV et le pitch** — ce que le CV et le pitch affirment déjà
   (résultats, chiffres, compétences mises en avant) et que l'interlocuteur va creuser : une
   puce par affirmation, l'extrait recopié mot pour mot entre « », puis ce qu'Antoine doit
   avoir en tête pour le défendre en détail. La règle : rien dans la salle qui ne soit sur
   le papier, et tout ce qui est sur le papier défendable en profondeur. Dans cette section,
   les guillemets ne servent qu'aux extraits du CV et du pitch. Sans CV ni pitch, une puce
   le dit.
4. **Questions à poser** — quatre à six questions, une par puce avec « ? », choisies pour
   l'étape et pour cette entreprise. Retire celles auxquelles l'annonce ou les notes
   répondent déjà : les poser montrerait qu'Antoine n'a pas lu.
5. **Simulation d'entretien** — le script qu'Antoine répète seul : des questions seulement,
   au moins six, une par élément de liste, chacune avec « ? », sans réponse ni sous-puce. Dans
   l'ordre : échauffement (« Pouvez-vous vous présenter ? »), questions métier liées à
   l'annonce, une ou deux questions comportementales sur ses compétences, une question
   piège pour finir. Des sous-titres `### ` peuvent séparer ces temps.
6. **Points à clarifier** — une puce par point : ce que les pièces ne disent pas (date,
   interlocuteurs, télétravail, rémunération…), les exigences que le profil ne couvre pas,
   les signaux d'alerte de l'annonce ou des notes. S'il n'y en a aucun : « - Aucun point
   ouvert. »

Partout : un chiffre (pourcentage, montant, multiplicateur, note sur 100) n'apparaît que
s'il figure dans une des pièces lues, tel quel ; dans les histoires, dans le profil seul.
Pas de phrase creuse (« passionné par », « force de proposition », « je suis
perfectionniste », « team player »…) : du concret, dans la langue d'Antoine. Nomme
l'entreprise, et emploie le vocabulaire de l'annonce là où le profil l'appuie.

Ne modifie pas le dépôt, ne fais ni commit ni push, n'écris nulle part ailleurs que
`$ARTIFACTS_DIR/$INPUTS.out`.

## Déclare

Rends exactement :

- `summary` — deux ou trois phrases : l'angle retenu pour cette étape, les histoires
  choisies, et ce qui manquait (pièces absentes, exigences que le profil ne couvre pas).
- `deliverable` — `{"type": "archon_artifact", "run_id": "$WORKFLOW_ID", "path": "$INPUTS.out"}`.
  `run_id` est la valeur ci-dessus telle quelle ; `path` est relatif à `$ARTIFACTS_DIR` et
  nomme le fichier lui-même (un pointeur nomme toujours un fichier, jamais un dossier).
