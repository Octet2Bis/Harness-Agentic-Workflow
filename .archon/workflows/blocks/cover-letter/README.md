# Bloc `cover-letter`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : à partir d'une **offre validée**, du **profil maître** et, s'il existe, du **CV sur
mesure** de `cv-tailor`, écrire la **lettre de motivation** : `letter.md` (le texte, écrit par
l'agent) et `letter.html` (sa mise en page A4 d'une page, produite par du code). Le PDF se rend
après le bloc, comme celui du CV.

```
offer + profile (+ CV, pitch, remarques) ─▶ write_letter ─▶ letter.md + evidence ─▶ check_letter (code) ─┐
                    ▲                                              (écrit aussi letter.html)          │ non → problems
                    └──────────────────────────────── (3 tours au plus) ──────────────────────────────┘
                                                                                                oui ▼
                                                judge (Reviewer, contexte vierge, lecture seule, note A+…F)
                                                                                                    ▼
                                                              verdict ──▶ { ok, status, summary, deliverable }
                                    (encore non au 3e tour : judge sauté, verdict ──▶ status: unconverged)
```

## Contrat

- Entrées :
  - `offer` (obligatoire) : l'offre en JSON texte, la même que pour `cv-tailor` (company,
    title, link, slug, skills_required, description, et `description_full` quand l'appelant a
    lu l'annonce) ;
  - `profile` (obligatoire) : chemin absolu du profil maître, seule source des faits ;
  - `cv` : chemin absolu du CV sur mesure (`application/CV.md` de `cv-tailor`) ; la lettre ne
    le contredit pas et son titre (`# CV — <nom>`) donne la signature ;
  - `pitch` : chemin absolu du message d'accroche (`application/pitch.md`) ;
  - `remarks` : les remarques du candidat sur cette candidature ;
  - `name` : le nom qui signe ; vide : le titre du CV, sinon une ligne « Nom : » ou le titre
    du profil, sinon l'en-tête de la lettre ;
  - `language` : `fr` ou `en` ; vide : la langue de l'annonce, le français quand on ne peut
    pas trancher ;
  - `out_dir` : `application` par défaut, le dossier de `cv-tailor` : tout le dossier de
    candidature est au même endroit.
- Sortie : `{ ok, status: verified|rejected|unconverged, summary, problems, findings, deliverable }`,
  le contrat de `cv-tailor`. `deliverable.path` = `<out_dir>/letter.md` dans les artefacts du
  run (un pointeur nomme un fichier, jamais un dossier) ; `letter.html` est à côté. Le résumé
  dit le nombre de mots, la langue, les lignes imprimées estimées et les preuves tracées.
- Issue autorisée : `ok`.
- Contrôles encore rouges au plafond (trois tours) : la boucle rend la main (compteur `tries`
  du contrôle), le Reviewer est sauté et le verdict rend `ok: false, status: unconverged` avec
  les derniers `problems` ; son résumé commence par « Checks still failing after N round(s) »,
  comme celui des autres blocs. Le run n'échoue que sur une erreur (modèle, script) ; un
  verdict absent se lit alors `null` chez l'appelant (`if_skipped: null`).

## Ce que le code vérifie (`.shared/letter-checks.ts`, `.shared/letter-html.ts`, 36 tests)

| Règle | Pourquoi |
|---|---|
| forme : `# <nom>`, contact, lieu et date, `**Objet :**` (ou `**Subject:**`), corps, signature | le code en tire la mise en page et sait où compter |
| 250 à 300 mots de corps (formules d'appel et de politesse comprises, ponctuation isolée exclue) | au-delà, la lettre répète le CV ou déborde |
| une page A4 : au plus 50 lignes imprimées estimées, avec les cotes mêmes de la feuille de style | étalonné sur un rendu Chromium : 53 tiennent, 54 débordent ; 250 à 300 mots en font 37 à 43 |
| l'entreprise et le poste nommés tels que l'offre les écrit (« (H/F) » retiré) | sinon elle n'est pas écrite pour eux |
| la langue de l'annonce (mots-outils français / anglais) ; français par défaut | une lettre se lit dans la langue de l'annonce |
| au moins **deux preuves tracées** : chaque entrée d'`evidence` cite un passage de la lettre et le passage du profil qui le fonde, mot pour mot (≥ 4 mots chacun, à la casse, l'emphase et la ponctuation près) | une réalisation citée vient du profil ; que le second passage soutienne vraiment le premier, le Reviewer le dit |
| aucun chiffre à unité (`unsupportedFigures` de `cv-checks.ts`) ni nombre (« 12 campagnes ») absent du profil et de l'annonce | un chiffre sans source est une invention |
| aucune durée (« 3 ans », « 6 months ») absente du **profil** — l'annonce n'en est pas la source | « 3 ans exigés » ne prouve pas que le candidat les a |
| aucune formule creuse : `DEFAULT_SLOP` de `cv-checks.ts` + `LETTER_SLOP` (FR/EN), comparées au texte normalisé | `no-ai-slop` |
| au plus un tiret d'incise (—, –, --) | leur série est une marque d'écriture générée |
| aucun marqueur à compléter (`[Nom]`, `<entreprise>`, `{{…}}`, TODO, TBD, XXX, lorem ipsum) | rien ne part à moitié écrit |
| l'e-mail du profil sur la lettre | le recruteur doit pouvoir répondre |
| la signature : le nom du candidat, seul sur la dernière ligne, le même qu'en en-tête | la lettre est signée |

`letter.html` est écrit par le contrôle à chaque tour (`renderLetterHtml`) : A4, marges 20 × 22
mm, 11 pt, l'identité du CV (`.shared/print-style.ts`, partagé avec `cvDocument` de
`systems/.shared/markdown.ts` : nom en sérif, ligne de contact rangée à séparateurs d'accent,
filet à amorce d'accent, polices système seulement), espaces insécables à la française ; le
HTML de l'agent est échappé, jamais recopié.

Ce que le code ne tranche pas va au Reviewer (`commands/judge.md`), qui n'approuve qu'à partir
de **A-** et sans constat bloquant : honnêteté (dates, employeurs, temps des verbes, portée),
preuves qui soutiennent vraiment leurs phrases, adéquation aux exigences (écarts reconnus,
jamais cachés), angle entreprise tiré de l'annonce, lettre tournée vers ce que le candidat
fera, ton naturel dans la langue, cohérence avec le CV, le message et les remarques, forme de
`letter.html`.

## Emprunts (MIT)

Adaptés, jamais exécutés, et sans aucun fait sur leurs auteurs :

- [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) @ `e16acee`
  (MIT © 2026 Mads Lorentzen) : `job-application-assistant/06-cover-letter-templates.md` (250 à
  300 mots pour une page, formule d'appel, liste de contrôle), `03-writing-style.md` (pas de
  tiret cadratin, clichés, ton, structure de la lettre, regard vers l'avenir, test du retour en
  arrière), `.claude/commands/apply.md` (frontière de confiance de l'annonce, couverture des
  exigences, grille du reviewer : audit factuel, mots-clés, angle entreprise, reformulation
  active, ton).
- [proficientlyjobs/proficiently-claude-skills](https://github.com/proficientlyjobs/proficiently-claude-skills)
  @ `9bc1f6f` (MIT déclarée dans `plugin.json`) : `skills/cover-letter/SKILL.md` et
  `scripts/write-cover-letter.md` (deux ou trois réalisations reliées aux besoins de
  l'employeur, voix authentique, interdits d'honnêteté, contrôle qualité ligne à ligne, phrases
  artificielles).

Chaque passage adapté porte sa mention `Adapté de … (MIT)` dans `LETTER_SLOP` et dans les
prompts.

## Lancer

```bash
archon workflow run cover-letter \
  --input offer='{"company":"…","title":"…","link":"…","slug":"…","skills_required":"…"}' \
  --input profile='<dossier carrière>/master_profile.md' \
  --input cv='<artefacts du run cv-tailor>/application/CV.md'
```

Dans `career-apply`, il se branche après `tailor` (`include: cover-letter`), avec l'offre, le
profil et les remarques que `load` a lus, et le CV et le message que `tailor` vient d'écrire
dans `application/` ; `letter.html` s'y imprime en PDF comme `CV.html`.

## Vérifier

`scripts/verify-block.sh cover-letter` — tests unitaires, `archon validate`, 4 fixtures
(`verified`, `rejected`, `unconverged`, `outcome-contract`), chacune avec sa ligne
`# attendu:` comparée à ce que rend le vrai `verdict.ts`. `unconverged` stubbe `check_letter`
dans l'état du dernier tour (`ok: false`, `tries: 3`) : le dry-run ne joue qu'un tour de boucle.
Elle n'a pas de stub `judge` et finit quand même : le Reviewer n'a donc pas été atteint.
L'arrêt au plafond lui-même (`until_bash` lit `tries`) est contrôlé par
`scripts/gates/validate.ts` (R1). Le contrôle, lui, est stubbé dans les fixtures (il lit le
disque) ; ses règles et le rendu sont testés à l'unité, dont une lettre française et une
lettre anglaise qui passent tout, et une lettre qui viole chaque règle.
