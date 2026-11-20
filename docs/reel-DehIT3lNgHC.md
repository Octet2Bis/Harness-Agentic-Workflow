# Reel Instagram DehIT3lNgHC — « Agentic engineering »

- URL : https://www.instagram.com/reel/DehIT3lNgHC/
- Auteur : Kem @ GlitchCatClub (@kem_glitch). Publié le 15/10/2026, 2 min 52, 581 j'aime et 96 commentaires.
- Légende : « Agentic engineering! My fav! 🫶 » + #ai #artificialintelligence #openai

## Transcription paraphrasée
- 0:00–0:30 : l'agentic engineering ne se résume ni à un harness ni à la gestion d'agents. Il s'agit de construire des systèmes autonomes qui passent à l'échelle grâce au travail et au calcul en parallèle. L'idée est proche de la « software factory » (un terme qu'il n'aime pas) et de ses « Lego loops ».
- 0:25–0:50 : la boucle la plus simple consiste à prompter, lire la réponse et reprompter. L'humain sert de référence, mais le modèle est probabiliste : il faut beaucoup d'itérations, c'est lent et coûteux, et l'humain doit rester présent. C'est une roulette.
- 0:50–1:10 : seuls trois acteurs peuvent travailler. L'humain est le meilleur vérificateur, mais c'est lui qui bloque. L'agent est brillant mais probabiliste. Le code fait la même chose à chaque fois, vite et pour pas cher. Le but est de passer du probabiliste au déterministe, donc du modèle au code.
- 1:10–1:27 : première boucle. Des contrôles déterministes vérifient le travail de l'agent et le lui renvoient en cas d'échec.
- 1:27–1:48 : on ajoute du déterminisme partout où c'est possible. Ce que le code ne peut pas trancher va à un juge, c'est-à-dire un second agent dans un contexte vierge. Le tout forme un bloc, une brique Lego. Un bloc n'est terminé qu'une fois vérifié et optimisé, et ses propres contrôles doivent être testés. Il devient alors réutilisable.
- 1:48–2:00 : chaque métier peut devenir un bloc : recherche, design, tests, tri, rapport. Les blocs s'emboîtent. On peut les livrer sous forme de skill, mais il préfère le code.
- 2:00–2:22 : les blocs tournent en parallèle, un worktree chacun. Le plafond devient alors le calcul, d'où les sandboxes (des VM dédiées), qui apportent l'échelle, la sécurité et le choix du modèle.
- 2:22–2:42 : le système complet. Un déclencheur (téléphone, Slack ou client) pose une tâche sur un tableau, un listener la prend et tout tourne en autonomie. L'humain n'intervient plus qu'à la fin, pour la vérification finale.
- 2:42–2:52 : on est passé de la roulette au système autonome.

## Schémas à l'écran (9 planches)
Code couleur : jaune = l'humain, rose = l'agent, losange cyan = le code, brique violette = un bloc sauvegardé.
- Fig 02 : la boucle simple. You → PROMPT → Model → ANSWER, avec un compteur « Round 6 ».
- Fig 03 : les trois acteurs. « best verifier, but the bottleneck », « brilliant, but probabilistic », « same, every time ».
- Fig 04 : You → Agent → Code check (un script py), avec renvoi à l'agent en cas d'échec.
- Fig 05 : REPORT BLOCK = Agent → 3 code checks → Judge (« fresh context »), avec un badge VERIFIED.
- Fig 06 : les briques Research, Design, Testing, Triage et Report.
- Fig 07 : SPLIT → 3 blocs Design, chacun dans un sandbox avec son modèle (Opus, Sonnet, GPT) → Page A/B/C.
- Fig 08 : le système complet. Phone/Slack/Client → Task board (NEW / PICKED UP / DONE) → Listener → Report block → Split → 3 sandboxes → You, avec la mention « you only at the end ».

## Le workflow en bref
1. Partir de la boucle naïve entre l'humain et le modèle.
2. Confier la vérification au code, qui renvoie le travail à l'agent en cas d'échec.
3. Faire appel à un juge LLM en contexte vierge seulement pour ce que le code ne peut pas trancher.
4. Encapsuler le tout en bloc réutilisable, terminé seulement une fois vérifié et optimisé, contrôles testés compris.
5. Composer des blocs par métier.
6. Paralléliser avec un worktree puis un sandbox par bloc, chacun avec son modèle.
7. Automatiser l'entrée : déclencheurs → tableau de tâches → listener.
8. Garder l'humain comme vérificateur final.

> Copie du résumé écrit dans `Master Plan/reel-DehIT3lNgHC.md` (extraction locale, transcription paraphrasée).
