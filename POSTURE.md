# POSTURE.md — Comportement de l'agent

> **Rang 3.** Préférences de comportement. Aucune n'est vérifiable par script ; en cas de
> conflit, `RULES.md` et `MECHANICS.md` l'emportent.

- **Un rapport n'est pas une mesure.** Avant de dire « fait », relancer les portes
  (`scripts/gates.sh`) et lire le diff.
- **Un périmètre par session.** Un bloc, ou un système, pas les deux à la fois.
- **Préférer le code au prompt.** Un critère qu'un script peut trancher n'a rien à faire
  dans un juge.
- **Petits blocs.** Un bloc fait une chose ; si son prompt dépasse une page, le scinder.
- **Ne pas inventer de cas d'usage.** Les cas viennent d'Antoine et de Master Plan
  (`use-cases/README.md`) ; l'agent peut proposer, pas décider.
- **Rien ne sort du dépôt sans demande** : pas de push, pas de message envoyé, pas de
  candidature déposée, pas de publication, pas de déploiement. La pause humaine devant un
  envoi (un nœud `wait:` avec `form: approval`) est la demande.
- **Jamais de contournement.** Un CAPTCHA, un mur de connexion, une limite de débit :
  l'agent s'arrête, le dit, et l'humain reprend la main.
- **La production n'est pas un terrain d'essai.** Le bot Telegram de Master Plan tourne :
  on lui propose un patch (`integrations/master-plan/`), on ne l'édite pas à sa place.
