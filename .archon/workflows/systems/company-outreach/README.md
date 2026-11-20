# Système `company-outreach`

Statut : voir `blocks/REGISTRY.md`, seule source des statuts (`RULES.md` R3).

Prospection d'une entreprise validée full remote, pour ouvrir une discussion sur les services
du candidat (CDI, freelance, portage) :

```
entreprise ─▶ company-dossier ─▶ offer-angle ─▶ outbound-sequence ─▶ go humain ─▶ done
              (sourcé, canal)    (axes, mini-     (3 e-mails, notice   (rien n'est
                                  diagnostic,      « stop » + source     envoyé)
                                  accroche)        de l'adresse)
```

Un bloc qui ne rend pas `ok` arrête la chaîne (`done` nomme l'étape et la raison :
unconverged, rejected, ou verdict absent). Un refus humain annule le run.

**Rien n'est envoyé.** Après le go : l'e-mail part de la boîte du candidat ; LinkedIn
(l'accroche de `proposal.md`, ≤ 280 caractères, sert de note de connexion) s'envoie à la main.
Aucune automatisation LinkedIn, aucune adresse devinée, pas d'e-mail froid en DE / AT
(`company-dossier`). Livrables dans les artefacts du run : `dossier.md`, `proposal.md`,
`sequence.md`.

## Lancer

```
archon workflow run company-outreach \
  --input company='{"name":"Acme","website":"https://acme.example","country":"FR"}' \
  --input profile="C:\chemin\vers\career\master_profile.md"
```

## Vérifier

`scripts/verify-block.sh company-outreach`.
