# Signaux d'entreprises

Demandé par Antoine le 2026-11-14 : ouvrir le radar à autre chose que les offres d'emploi, « ratisser le
plus large possible afin d'obtenir des directions inspirées des bons éléments ». Une offre arrive tard ;
un signal permet de contacter l'entreprise avant que le poste soit publié.

## Ce qui tourne, où

- **VM** (`signals-vm.ts`), après chaque cycle du radar unifié (`cycle.sh`, verrou `signals.lock` à part),
  **sans Claude**. Chaque source a sa cadence ; un passage dure au plus 6 minutes.
- **PC** : `pull_radar_vm.ps1` rapatrie `company_signals.json` et `signals_status.json` (la VM fait foi)
  et envoie `signals_feedback.json` (tes avis) à la VM.
- **Cockpit**, onglet **Signaux** : les entreprises les mieux notées, chaque signal avec sa preuve et
  son lien, les registres (SIREN, effectif, NAF, LEI…), et trois boutons : *Bonne piste*, *Pas pour moi*,
  *À prospecter* (un fichier `a_prospecter/<entreprise>.json` que Claude prépare avec `company-outreach`
  quand tu le demandes ; rien ne part sans ton go).

## Les signaux

| Signal | Source | Poids |
| --- | --- | ---: |
| Levée de fonds | flux d'actualité | 1 |
| Nouveau CMO, VP ou Head of marketing/growth/ventes | flux d'actualité | 0,9 |
| Augmentation de capital | BODACC (France), Companies House SH01 (R.-U.) | 0,8 |
| Recrute un responsable marketing/growth/ventes | registre du radar (nouveau poste) | 0,8 |
| Premier poste marketing ou growth | registre du radar | 0,8 |
| Nouvel outil marketing ou vente sur son site (HubSpot, Segment, Klaviyo…) | site de l'entreprise | 0,7 |
| Vague de recrutement (≥ 3 postes nouveaux, ou +30 % de postes en un mois) | registre du radar | 0,7 |
| Ouvre un pays ou un marché | flux d'actualité | 0,6 |
| Site dans une nouvelle langue | site de l'entreprise | 0,5 |
| Accélérateur (YC Europe, qui recrute) | annuaire YC | 0,5 |
| Subvention ou programme public | flux d'actualité | 0,5 |
| Lance un produit | flux d'actualité | 0,4 |
| Blog ou newsletter lancé, rachat, nouveau nom, changement de dirigeant au registre | divers | 0,3 |
| Licenciements | flux d'actualité | −1 |
| Procédure collective (redressement, liquidation) | BODACC, actualité | −1,5 |

Score = somme des signaux × fraîcheur (demi-vie 45 jours, rien après 180) × directions ; un même type
compte pleinement une fois (cinq articles sur une levée ≠ cinq levées) ; ×1,4 entreprise 100 % remote,
×1,15 quelques postes remote, ×0,7 Royaume-Uni ; 0 hors d'Europe.

**Directions** : tes avis, plus les « bons éléments » (entreprises suivies à la main, offres « oui » de la
sélection du jour, offres préparées ou envoyées), donnent par type de signal, secteur et pays un
multiplicateur de 0,6 à 1,6 (lissé : il faut deux avis au moins). Le cockpit les écrit en clair.

## Contrôles en code (fiabilité)

- un signal d'actualité n'est gardé que si le titre nomme une entreprise lisible (2 à 40 caractères, pas
  un mot générique) **qui figure telle quelle dans le titre** ; récaps (« les levées de la semaine »),
  tribunes et interviews écartés ;
- registres : correspondance **exacte** du nom (après forme juridique et accents), sinon rien ; une annonce
  BODACC doit porter le SIREN ; GLEIF écarte les fonds ;
- site : un domaine deviné n'est gardé que si la page porte le nom de l'entreprise ; le premier relevé ne
  donne aucun signal ; plus de 3 outils nouveaux d'un coup = page vide la fois d'avant, pas de signal ;
- une source qui échoue 10 fois de suite n'est plus relue qu'une fois par jour ; chaque source a son
  compteur (lectures réussies, échecs, dernier code) dans le cockpit.

## Sources

Vérifiées le 2026-11-14 par lecture web (le conteneur de Claude et le PC n'ont pas ce réseau ; la VM, oui) :

- flux : Maddyness, Tech.eu, Sifted, Tech Funding News, Silicon Canals (OK) ; EU-Startups, FinSMEs (à
  confirmer par l'essai de la VM) ; FrenchWeb et Deutsche Startups **écartés** (robots.txt) ;
- YC (`yc-oss.github.io`, données publiques de l'annuaire YC) ;
- API Recherche d'entreprises (data.gouv), GLEIF : OK ;
- BODACC (Opendatasoft, licence ouverte) et Brønnøysund : API officielles de données ouvertes, champs à
  confirmer par l'essai de la VM ;
- Companies House : **clé gratuite** à créer sur developer.company-information.service.gov.uk et à mettre
  dans `.local\secrets.env` (`COMPANIES_HOUSE_API_KEY=…`), sinon sautée.

Écartées : CVR danois (conditions illisibles), BORME espagnol (PDF), bibliothèque publicitaire de Meta
(jeton + vérification d'identité), Google Ads Transparency (pas d'API), G2/Trustpilot/LinkedIn (lecture
automatisée interdite), agrégateurs payants (budget 0 €).

## Essai réel

`Installer-radar-VM` lance `signals-vm.ts --probe` sur la VM : une ligne par source (OK/ÉCHEC, code,
nombre d'éléments, un exemple) dans `Bureau\rapport-radar-vm.txt`.

```bash
bun signals-vm.ts --career ~/radar-unifie/career --probe          # essai, rien d'écrit
bun signals-vm.ts --career ~/radar-unifie/career [--force]        # un passage
bun test integrations/company-signals                              # tests hors ligne (faux réseau test/)
```
