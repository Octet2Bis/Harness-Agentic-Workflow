# Alertes mail d'un autre candidat (radar de la VM)

Pour un candidat qui veut seulement **recevoir par mail toutes les offres qui lui correspondent** : pas de tri par modèle, pas de CV, pas de message, pas de décideurs. Zéro Claude, 0 €. Premier candidat : Camille (2026-11-20).

| Où | Quoi |
|---|---|
| PC, `Harness-Agentic-Workflow\.local\career-<id>\` | Ses réglages : `candidat.json` (`"vm": true`), `career_taxonomy.json` (intitulés, domaines, niveau), `criteres.json`, `job_sources.json`, `alertes_mail.json`. Jamais versionné. |
| `Installer-radar-VM` | Envoie chaque `.local\career-*` dont `candidat.json` dit `"vm": true` vers `~/radar-unifie/candidats/<id>/`. Première fois : le dossier entier. Ensuite : seulement les réglages, son tableau et ses envois restent ceux de la VM. |
| VM, `cycle.sh` (toutes les 15 min) | Après le radar d'Antoine, pour chaque candidat : `radar-vm.ts --no-triage` sur son dossier (sources, crible par règles, tableau à part), puis `mail-vm.ts`. Un verrou et un journal (`~/radar-unifie/logs/<id>.log`) par candidat. |
| `mail-vm.ts` | Aux heures de `alertes_mail.json` (heure de Paris), un mail récapitulatif des offres entrées depuis le dernier envoi : Paris / IDF, puis le reste de la France, puis l'étranger. Rien de nouveau : pas de mail. Jamais deux fois la même offre (`mail_alerts.json`). Un envoi raté est retenté au cycle suivant. |

## Ce que le crible garde (Camille)

- **Sources** : LinkedIn France (tout contrat, sur site compris, « (H/F) » gardé) et Europe en contrat / temporaire ; Adzuna France (tout contrat) et Belgique, Suisse, Royaume-Uni, Allemagne, Espagne, Italie, Pays-Bas en CDD (`contract=1`), environ 96 appels par jour sur les 250 partagés avec Antoine.
- **Intitulés** : 97, en français et en anglais (événementiel, bénévoles / volontaires, workforce, sport, hospitalités, associatif).
- **Écarté par l'intitulé** : stage, alternance, vente pure, hôtellerie / restauration, centres d'appels. Directeur / Head of ne sont **pas** bloqués.
- **Écarté par le texte** : 8 ans d'expérience demandés ou plus.
- Mode de travail indifférent. Pas de plancher de salaire.

## Clés d'envoi (gratuites), dans `.local\secrets.env`

Lues par nom, jamais affichées. Une seule des trois suffit :

1. **Gmail** (le plus simple). Sur le compte qui envoie, activer la validation en deux étapes, puis créer un mot de passe d'application sur https://myaccount.google.com/apppasswords.
   ```
   MAIL_SMTP_USER=adresse.d.envoi@gmail.com
   MAIL_SMTP_PASS=abcd efgh ijkl mnop
   ```
   Autre serveur : `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT` (465 en TLS, 587 en STARTTLS), `MAIL_FROM`.
2. **Brevo** (300 mails par jour gratuits, une adresse d'envoi vérifiée suffit) : `BREVO_API_KEY=…` et `MAIL_FROM=adresse.verifiee@…`.
3. **Resend** (gratuit, mais l'adresse d'envoi doit être sur un domaine vérifié) : `RESEND_API_KEY=…` et `MAIL_FROM=radar@ton-domaine`.

Puis relancer `Installer-radar-VM` : il copie `.local\secrets.env` sur la VM.

## `alertes_mail.json`

```json
{ "to": "…", "nom": "Camille", "heures": [8, 18], "max_par_mail": 80,
  "from_name": "Radar emploi de Camille", "transport": "auto", "actif": true,
  "priorite_lieux": ["paris", "ile-de-france", "92", "…"], "exclure_titre": [] }
```

`actif: false` coupe les mails. `transport` impose `smtp`, `brevo` ou `resend`.

## Essais

```
bun integrations/mail-radar/mail-vm.ts --career <dossier> --dry-run --out apercu.html   # rien envoyé
bun integrations/mail-radar/mail-vm.ts --career <dossier> --env-file <secrets> --force    # envoi tout de suite, hors créneau
bun test ./integrations/mail-radar
```
