# Bloc `veille-fiche`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Métier : la fiche de veille du pôle **03 Recherche & veille** de Master Plan, et le vrai
travail que le bot Telegram « research » (reels Instagram, liens, notes) ne faisait pas : lire
le contenu, pas le titre. Produit `fiche.md` (Date, Source, Catégorie ; De quoi s'agit-il,
Problème, Impact, Recommandation immédiate, Sources, Limites).

## Ce que le code vérifie (`.shared/veille-checks.ts`, 4 tests)

Sections ; `Date` ISO valide et pas future ; `Source` = la ressource d'entrée ; `Catégorie`
dans la liste de `research_graph.json` ; chaque source avec URL et date ; recommandation qui
nomme un pilier (`01_GTM_Growth`, `02_Assistant_Personnel`, `03_Developpement_App_and_Design`)
ou dit « Aucune action » ; aucune phrase du gabarit automatique de `research_bot_engine.js` ;
longueur minimale (900 caractères quand le contenu a été lu, 300 sinon : une fiche honnête
« non lisible » reste courte).

## Ce que le juge tranche

La fiche repose-t-elle sur le contenu (transcription, page) et non sur la légende ? Les
affirmations de l'auteur sont-elles rapportées comme telles ? La recommandation vaut-elle
dix minutes ?

## Entrées / sortie

`source` (obligatoire), `content` (texte ou chemin extrait en amont : pour un reel, la
transcription produite par agent-reach / yt-dlp + whisper sur le PC), `question`,
`categories`, `out` → verdict typé. Si les contrôles sont encore rouges au dernier tour, le juge est sauté et le verdict
rend `ok: false, status: unconverged` avec les derniers problèmes.

Système à écrire autour (voir `use-cases/`) : `veille` = extraction (script sur le PC) →
`veille-fiche` → ajout à `Workspace/research_graph.json` et `research_reports/`, déclenché
par le même lien Telegram qu'aujourd'hui.

## Vérifier

`scripts/verify-block.sh veille-fiche`.
