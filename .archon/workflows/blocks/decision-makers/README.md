# Bloc `decision-makers`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : une candidature est prête (ou partie) ; le bloc dit **à qui écrire et quoi écrire**
(demande d'Antoine, 2026-10-24 : « il me faut surtout les noms des personnes à qui envoyer un
message sur LinkedIn, potentiellement une fenêtre ouverte sur dropcontact ou autre outil
d'enrichissement me permettant d'envoyer un mail, et puis quel message envoyer »). Il trouve
une à quatre personnes sur des pages publiques, dit pourquoi chacune, et rédige une note de
connexion LinkedIn et un court e-mail, dans `decideurs.json`. Il n'envoie rien, n'ouvre ni
LinkedIn ni courtier de données, n'écrit aucune adresse ni aucun téléphone : le cockpit montre
la fiche et ouvre l'outil d'enrichissement sur `domain`, Antoine cherche l'adresse et envoie.

```
offre / annonce + profil (+ CV, pitch s'ils existent)
        │
        ▼
 work (agent, web public) ─▶ decideurs.json ─▶ check (code) ─┐
        ▲                                                     │ non → problems
        └────────────────── (3 tours au plus) ────────────────┘
                                                        oui ▼
     judge (contexte vierge, lecture seule + WebFetch : rouvre chaque source ;
            exactitude, pertinence, honnêteté, ton ; A+…F)
                                                            ▼
     verdict ──▶ { ok, status, summary, problems, findings, deliverable }
                 et decideurs.verdict.json dans les artefacts
     (encore non au 3e tour : judge sauté, verdict ──▶ status: unconverged)
```

## Contrat

- Entrées :
  - `profile` (obligatoire) : chemin absolu du profil maître, seule source des faits sur
    Antoine dans les messages (sa politique de rédaction comprise) ;
  - `application` : chemin absolu du dossier `<career_dir>/applications/<slug>/` ; y sont lus,
    s'ils existent, `offer.json`, `annonce.md|txt`, `CV_*.md`, `Message_Accroche_*.md`,
    `interlocuteur_cible.json`, `remarques_utilisateur.txt` (les lecteurs de `interview-prep`,
    importés de `interview-prep/scripts/check.ts`) ; sans `offer.json`, l'offre `<slug>` de
    `<career_dir>/pending_gold_jobs.json`, deux dossiers plus haut (lue, jamais écrite). CV et
    pitch peuvent manquer (un `career-apply` en pause au go n'a pas encore recopié ses
    fichiers) : le nom du candidat vient alors du titre du profil ;
  - `offer` (JSON texte), `cv`, `pitch` (chemins) : facultatifs, priment sur le dossier ;
  - `max_people` (`4`), `out` (`decideurs.json`).
- Sorties :
  - `$ARTIFACTS_DIR/decideurs.json`, la fiche (forme ci-dessous) ;
  - `$ARTIFACTS_DIR/decideurs.verdict.json`, écrit par le verdict dans toutes les issues, juge
    sauté compris : la même chose que sa sortie (`ok`, `status`, `summary`, `problems`,
    `findings`, `deliverable`). Le cockpit ne lit que les fichiers du run et recopie ces deux
    fichiers dans `applications/<slug>/` une fois le run fini ;
  - la sortie du nœud : `{ ok, status: verified|rejected|unconverged, summary, problems,
    findings, deliverable }`, `deliverable.path` = `decideurs.json` (un fichier, R4).
- Issue autorisée : `ok`.
- Contrôles encore rouges au plafond (trois tours) : la boucle rend la main (compteur `tries`
  du contrôle), le juge est sauté et le verdict rend `ok: false, status: unconverged` avec les
  derniers `problems`. Le run n'échoue que sur une erreur (modèle, script).
- Pas de verrou de dossier (`mutates_checkout: false`) : le bloc tourne à côté d'un
  `career-apply` en attente de go.

## La fiche

```json
{
  "company": "Dana Incorporated",
  "job_title": "…",
  "domain": "dana.com",
  "language": "en",
  "people": [
    { "name": "First Last", "role": "VP Sales Operations", "why": "une phrase", "source": "https://…", "evidence": "citation exacte de la page" }
  ],
  "searches": ["Dana \"Sales Operations\""],
  "linkedin_note": { "to": "First Last", "text": "≤ 300 caractères" },
  "email": { "to": "First Last", "subject": "≤ 60 caractères", "body": "60 à 150 mots" },
  "sources": ["https://…"],
  "notes": ["ce qui n'a pas été trouvé"]
}
```

`people` est rangé dans l'ordre d'approche (manager de l'équipe, responsable de la fonction,
recrutement, fondateur en dernier recours dans une petite structure) ; il peut être vide si
`searches` porte au moins deux recherches LinkedIn qu'Antoine lance lui-même, et les `to`
valent alors `""` (messages à l'équipe de recrutement). `domain` est l'hôte nu du site de
l'entreprise ; `to` est le nom exact d'une personne listée.

## Ce que le code vérifie (`.shared/contact-checks.ts`, 29 tests ; `scripts/check.test.ts`, 9 tests)

| Règle | Pourquoi |
|---|---|
| un objet JSON, chaque champ présent et du bon type | le cockpit lit ce fichier tel quel |
| `company` est l'entreprise de l'offre (forme juridique ôtée, l'une contient l'autre : `companyKey`) ; `job_title` non vide ; `domain` hôte nu, sans `www.` | la bonne entreprise, et un domaine que l'outil d'enrichissement accepte |
| 0 à `max_people` personnes, noms de deux à cinq mots (lettres, traits d'union, apostrophes), distincts ; `role` et `why` non vides | un nom complet se cherche ; une initiale non |
| chaque `source` en https, listée dans `sources`, hôte ni LinkedIn ni courtier (`BLOCKED_HOSTS` : RocketReach, ZoomInfo, Lusha, Apollo, ContactOut, SignalHire, LeadIQ, Kaspr, Lemlist, Hunter, Dropcontact…) | sources publiques seulement, conditions d'utilisation respectées |
| `evidence` d'au moins trois mots, qui contient le nom de famille (casse et accents ignorés) | une personne sans trace sur sa page est une invention |
| aucune adresse e-mail (trouvée, devinée « @dana.com », masquée « [at] »), aucun téléphone, aucune mention de LinkedIn ou d'un courtier comme lien, nulle part dans le fichier | Antoine fait la recherche d'adresse lui-même |
| `to` : une personne listée, ou `""` sans personne | le message va à quelqu'un de la fiche |
| note : ≤ 300 caractères, sans lien, salue le prénom, nomme l'entreprise ou le poste | la limite d'une note de connexion, et un message personnel |
| e-mail : objet ≤ 60 caractères, corps 60 à 150 mots, salue le prénom, nomme l'entreprise, une question (deux au plus), finit par le nom du candidat (`candidateName` de `letter-checks.ts`) | court, une demande, signé |
| messages dans la langue de l'annonce (`expectedLanguage`, `detectLanguage` de `letter-checks.ts`) ; `language` la déclare | une annonce anglaise appelle un message anglais |
| pas de mot de spam (`SPAM_TRIGGERS` de `email-checks.ts`, délimités : « free » ne tombe pas sur « freelance »), de phrase creuse (`DEFAULT_SLOP` de `cv-checks.ts`), de série de « ! », de marqueur (`placeholders`) | `no-ai-slop`, et un message qui passe les filtres |
| chaque groupe de chiffres des messages est dans le profil ou l'annonce ; un chiffre à unité, dans le profil seul (`unsupportedFigures` de `cv-checks.ts`) | un nombre sans source est une invention |
| moins de deux personnes : au moins deux recherches, du texte, pas une URL | Antoine a toujours une piste |

Ce que le code ne tranche pas va au juge, qui rouvre chaque source et n'approuve qu'à partir de
**A-** sans constat bloquant : **exactitude** (la personne est sur sa page, avec ce rôle, dans
cette entreprise — sinon bloquant), **pertinence** pour ce poste et ordre d'approche,
**honnêteté** des messages contre le profil (une invention est bloquante), **ton**.

## Lancer, pour une candidature

Depuis le cockpit (même forme que `interview-prep`, avec `--detach`), ou à la main sur le PC
d'Antoine :

```powershell
archon workflow run decision-makers --cwd C:\chemin\vers\Harness-Agentic-Workflow --folder `
  --input application='C:\chemin\vers\career\applications\<slug>' `
  --input profile='C:\chemin\vers\career\master_profile.md' `
  --detach
```

Facultatif : `--input offer='<JSON>'` (l'`offer.json` du run `career-apply`, pour l'annonce
complète), `--input max_people=2`. La fiche et le verdict sont dans les artefacts du run
(`archon workflow get <run> --json`) ; les recopier dans `applications/<slug>/` est le rôle de
l'appelant (le cockpit), pas du bloc.

## Vérifier

`scripts/verify-block.sh decision-makers` — tests unitaires, `archon validate`, 5 fixtures
(`verified` sur un dossier sans CV, `rejected` sur une personne absente de sa page,
`unconverged`, `no-one-found` sans personne et l'offre passée en entrée, `outcome-contract`), et
ce que rend chacune comparé à sa ligne `# attendu:`. `check.test.ts` lance aussi `check.ts` et
`verdict.ts` pour de vrai : un dossier sans CV passe, `decideurs.verdict.json` s'écrit quand le
juge est sauté.

## Limites connues

- Le code ne peut pas ouvrir les sources (il tourne sans réseau) : que la personne soit bien
  sur sa page, c'est le juge qui le vérifie, et une page illisible pour lui reste un constat.
- `evidence` doit contenir le nom de famille : une page qui écrit le nom autrement (initiale,
  translittération) demande de citer une autre phrase.
- La langue des messages se lit par les mots-outils (`detectLanguage`) : une note trop courte
  n'est pas jugée seule, l'e-mail l'est toujours.
- Les prompts `work.md` et `judge.md` n'ont pas encore tourné sur un vrai modèle ; ils se
  calibrent au passage `VERIFIED → PROUVÉ`, sur deux ou trois candidatures réelles (Smartness
  d'abord, fiche faite à la main dans `handoff/smartness-test/`).
