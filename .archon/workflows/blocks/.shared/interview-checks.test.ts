import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PREP_RULES,
  type PrepRules,
  checkInterviewPrep,
  citationProblems,
  consistencyProblems,
  isStage,
  mockProblems,
  normalizeText,
  parseCitations,
  parseStories,
  questions,
  sectionProblems,
  splitSections,
  storyProblems,
} from './interview-checks.ts';

const profile = `# Profil maître — Jane Doe

Contact : jane@example.org

## Expériences

### Way2Tech — Growth Marketing (2023-2024)
* Séquences outbound (Apollo, Lemlist) à ~50% de taux d'ouverture sur 3 segments.
* Automatisation n8n du routage des leads entrants vers HubSpot.

### Studio Nord — Assistante marketing (2021-2022)
* Refonte du tracking GTM / GA4 du site, score délivrabilité 98/100.

## Compétences
n8n, HubSpot, GTM, SQL`;

const cv = `# CV — Jane Doe
## Expériences
* Séquences outbound à ~50% d'ouverture.
* Routage des leads entrants automatisé avec n8n et HubSpot.`;

const pitch = `Le poste Growth Ops chez Acme rejoint mes automatisations n8n. Seriez-vous ouvert à un échange de 10 minutes cette semaine ?`;

const story = (n: number, source: string, result = "~50% de taux d'ouverture sur 3 segments.") => `### Histoire ${n} — Outbound Way2Tech (prospection)
- **Situation :** Way2Tech devait remplir son agenda commercial sans équipe SDR.
- **Tâche :** concevoir les séquences de prospection pour trois segments.
- **Action :** séquences Apollo et Lemlist, personnalisation par segment, tests d'objets.
- **Résultat :** ${result}
- **Source (profil) :** ${source}
- **Pour :** « Parlez-moi d'une campagne que vous avez menée. »`;

const goodSources = [
  "§ Expériences > Way2Tech — « Séquences outbound (Apollo, Lemlist) à ~50% de taux d'ouverture »",
  '« Automatisation n8n du routage des leads entrants vers HubSpot »',
  '§ Expériences > Studio Nord',
];

const doc = (parts: Partial<Record<'title' | 'likely' | 'star' | 'consistency' | 'ask' | 'mock' | 'clarify', string>> = {}) => `${parts.title ?? "# Préparation d'entretien — Acme, Growth Ops Manager (étape : rh)"}

## Questions probables
${
  parts.likely ??
  `- Pouvez-vous vous présenter en deux minutes ?
- Pourquoi Acme, et pourquoi ce poste de Growth Ops ?
- Qu'avez-vous automatisé avec n8n, concrètement ?
- Comment avez-vous travaillé avec HubSpot ?
- Quel est votre préavis, et quand pouvez-vous commencer ?
- Quelles sont vos attentes de rémunération ?
  - Piste : la fourchette du profil, sans la dépasser.`
}

## Histoires STAR
${parts.star ?? [story(1, goodSources[0]!), story(2, goodSources[1]!), story(3, goodSources[2]!)].join('\n\n')}

## Cohérence avec le CV et le pitch
${
  parts.consistency ??
  `- Le CV affirme « Séquences outbound à ~50% d'ouverture » : avoir les trois segments en tête.
- Le pitch parle de « mes automatisations n8n » : préparer le schéma du routage HubSpot.`
}

## Questions à poser
${
  parts.ask ??
  `- À quoi ressemble une semaine type dans ce rôle ?
- Qu'est-ce qui ferait de ces six premiers mois une réussite ?
- Quelle est la plus grosse difficulté de l'équipe en ce moment ?`
}

## Simulation d'entretien
${
  parts.mock ??
  `1. Présentez-vous.
2. Pourquoi quitter votre poste actuel ?
3. Racontez une séquence outbound qui a marché ?
4. Comment priorisez-vous les leads entrants ?
5. Que feriez-vous de HubSpot le premier mois ?
6. Avez-vous des questions pour nous ?`.replace('1. Présentez-vous.', '1. Pouvez-vous vous présenter ?')
}

## Points à clarifier
${parts.clarify ?? "- L'offre ne dit rien du télétravail : à demander à l'étape RH."}
`;

const rules = (over: Partial<PrepRules> = {}): PrepRules => ({
  ...DEFAULT_PREP_RULES,
  stage: 'rh',
  company: 'Acme',
  profile,
  sources: [],
  cv,
  pitch,
  keywords: ['n8n', 'HubSpot', 'GTM'],
  minChars: 800,
  ...over,
});

describe('interview-checks : forme générale', () => {
  test('accepte une préparation complète', () => {
    expect(checkInterviewPrep(doc(), rules())).toEqual({ ok: true, problems: [], stories: 3, coverage: 2 / 3 });
  });
  test('les étapes sont un ensemble fermé', () => {
    expect(isStage('technique')).toBe(true);
    expect(isStage('entretien')).toBe(false);
    expect(checkInterviewPrep(doc(), rules({ stage: 'entretien' })).problems).toContain('étape « entretien » inconnue : rh | manager | technique | final');
  });
  test('refuse un document absent, et un profil vide', () => {
    const result = checkInterviewPrep(null, rules({ profile: '' }));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['profil maître vide ou introuvable : aucune histoire ne peut être vérifiée', 'interview-prep.md absent ou vide']);
  });
  test('le titre dit l’étape demandée', () => {
    expect(checkInterviewPrep(doc(), rules({ stage: 'technique' })).problems).toContain("le titre ne dit pas l'étape : « (étape : technique) » attendu, lu « rh »");
    expect(checkInterviewPrep(doc({ title: '# Préparation — Acme' }), rules()).problems).toContain("le titre ne dit pas l'étape : « (étape : rh) » attendu");
  });
  test('le document nomme l’entreprise', () => {
    expect(checkInterviewPrep(doc(), rules({ company: 'Globex' })).problems).toContain("le document ne nomme pas l'entreprise (Globex)");
  });
});

describe('sections', () => {
  test('les six sections, dans l’ordre', () => {
    expect(sectionProblems(splitSections(doc()).sections)).toEqual([]);
  });
  test('signale une section manquante et le désordre', () => {
    const missing = doc().replace('## Points à clarifier', '## Divers');
    expect(sectionProblems(splitSections(missing).sections)).toEqual(['section manquante : « ## Points à clarifier »']);
    const swapped = doc().replace('## Questions à poser', '## TMP').replace("## Simulation d'entretien", '## Questions à poser').replace('## TMP', "## Simulation d'entretien");
    expect(sectionProblems(splitSections(swapped).sections)[0]).toStartWith('sections dans le désordre');
  });
});

describe('questions', () => {
  test('compte les puces qui portent un « ? »', () => {
    expect(questions('- Pourquoi ?\n- Piste : non\n1. Quand ?\ntexte ?')).toEqual(['Pourquoi ?', 'Quand ?']);
  });
  test('trop peu de questions probables ou à poser', () => {
    const result = checkInterviewPrep(doc({ likely: '- Pourquoi Acme ?', ask: '- Une semaine type ?' }), rules());
    expect(result.problems).toContain('« Questions probables » : 1 question(s), au moins 6 attendues (une par puce, avec « ? »)');
    expect(result.problems).toContain('« Questions à poser » : 1 question(s), au moins 3 attendues');
  });
  test('points à clarifier : au moins une puce', () => {
    expect(checkInterviewPrep(doc({ clarify: 'Rien.' }), rules()).problems).toContain('« Points à clarifier » : aucun point (une puce par point, ou « - Aucun point ouvert. »)');
  });
});

describe('simulation : des questions seulement', () => {
  test('accepte une liste de questions', () => {
    expect(mockProblems('### Échauffement\n1. Pouvez-vous vous présenter ?\n2. Pourquoi nous ?', 2)).toEqual([]);
  });
  test('refuse une réponse rédigée, un élément sans « ? », trop peu de questions', () => {
    const problems = mockProblems('1. Pouvez-vous vous présenter ?\n   - Réponse : je suis growth marketer.\n2. Parlez de vous.', 3);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe("« Simulation d'entretien » : 1 question(s), au moins 3 attendues");
    expect(problems[1]).toStartWith("« Simulation d'entretien » : questions seulement, sans réponse ; 2 élément(s) sans « ? »");
    expect(problems[2]).toStartWith("« Simulation d'entretien » : réponse rédigée");
  });
});

describe('histoires STAR', () => {
  test('lit les quatre parties et les sources', () => {
    const [s] = parseStories(story(1, goodSources[0]!));
    expect(s!.title).toBe('Histoire 1 — Outbound Way2Tech (prospection)');
    expect(s!.parts.Situation).toStartWith('Way2Tech devait');
    expect(s!.parts.Résultat).toBe("~50% de taux d'ouverture sur 3 segments.");
    expect(s!.sources).toHaveLength(1);
    expect(storyProblems(s!, profile)).toEqual([]);
  });
  test('une partie manquante est signalée', () => {
    const [s] = parseStories(story(1, goodSources[0]!).replace(/- \*\*Action :\*\*.*\n/, ''));
    expect(storyProblems(s!, profile)).toEqual(['histoire « Histoire 1 — Outbound Way2Tech (prospection) » : partie(s) manquante(s) « Action : »']);
  });
  test('au moins N histoires', () => {
    const result = checkInterviewPrep(doc({ star: story(1, goodSources[0]!) }), rules());
    expect(result.problems).toContain('« Histoires STAR » : 1 histoire(s), au moins 3 attendues (une par titre « ### »)');
    expect(result.stories).toBe(1);
  });
});

describe('citations du profil', () => {
  test('lit les extraits et les chemins de sections', () => {
    expect(parseCitations(goodSources[0]!)).toEqual({ quotes: ["Séquences outbound (Apollo, Lemlist) à ~50% de taux d'ouverture"], sections: [['Expériences', 'Way2Tech']] });
    expect(parseCitations('§ Compétences ; § Expériences > Studio Nord')).toEqual({ quotes: [], sections: [['Compétences'], ['Expériences', 'Studio Nord']] });
  });
  test('retrouve un extrait malgré l’emphase, les espaces et les apostrophes typographiques', () => {
    expect(normalizeText('**Séquences**  outbound à ~50%\nde taux d’ouverture')).toBe("séquences outbound à ~50% de taux d'ouverture");
    const [s] = parseStories(story(1, '« séquences outbound (Apollo, Lemlist) à ~50% de taux d’ouverture »'));
    expect(citationProblems(s!, profile)).toEqual([]);
  });
  test('refuse une histoire sans citation', () => {
    const [s] = parseStories(story(1, 'mon expérience chez Way2Tech'));
    expect(citationProblems(s!, profile)).toEqual([
      'histoire « Histoire 1 — Outbound Way2Tech (prospection) » : aucune citation du profil (« Source (profil) : § <titre du profil> » ou « « extrait mot pour mot » »)',
    ]);
  });
  test('refuse un extrait que le profil ne porte pas, un extrait trop court, une section inventée', () => {
    const [s] = parseStories(story(1, '« Séquences outbound à 70% de taux de réponse » ; « n8n » ; § Expériences > Acme Corp'));
    expect(citationProblems(s!, profile)).toEqual([
      "histoire « Histoire 1 — Outbound Way2Tech (prospection) » : l'extrait « Séquences outbound à 70% de taux de réponse » n'est pas dans le profil (citer mot pour mot)",
      'histoire « Histoire 1 — Outbound Way2Tech (prospection) » : extrait trop court pour être une citation (« n8n », 12 caractères au moins)',
      'histoire « Histoire 1 — Outbound Way2Tech (prospection) » : la section « § Expériences > Acme Corp » n\'est pas un titre du profil (« Acme Corp » introuvable)',
    ]);
  });
});

describe('cohérence avec le CV et le pitch', () => {
  test('cite le CV ou le pitch mot pour mot', () => {
    expect(consistencyProblems('- « Séquences outbound à ~50% d’ouverture »', { cv, pitch })).toEqual([]);
    expect(consistencyProblems('- rien à citer', { cv: '', pitch: '' })).toEqual([]);
  });
  test('refuse une note sans extrait, ou un extrait absent des deux', () => {
    expect(consistencyProblems('- Le CV parle d’outbound.', { cv, pitch })).toEqual([
      '« Cohérence avec le CV et le pitch » : aucun extrait du CV ni du pitch cité mot pour mot (« … », 12 caractères au moins)',
    ]);
    expect(consistencyProblems('- « Séquences outbound à 70% de réponse »', { cv, pitch })).toEqual([
      "« Cohérence avec le CV et le pitch » : l'extrait « Séquences outbound à 70% de réponse » n'est ni dans le CV ni dans le pitch",
    ]);
  });
});

describe('chiffres', () => {
  test('un chiffre d’histoire absent du profil est refusé, même s’il est dans l’annonce', () => {
    const star = [story(1, goodSources[0]!, '+40% de rendez-vous.'), story(2, goodSources[1]!), story(3, goodSources[2]!)].join('\n\n');
    const result = checkInterviewPrep(doc({ star }), rules({ sources: ['Objectif : +40% de pipeline'] }));
    expect(result.problems).toContain("« Histoires STAR » : le chiffre « 40% » n'est pas dans le profil (une histoire ne dit que ce que le profil porte)");
  });
  test('hors des histoires, un chiffre de l’annonce passe, un chiffre sans source non', () => {
    const clarify = "- L'annonce dit 45k€ - 55k€ : comparer à la fourchette du profil.";
    expect(checkInterviewPrep(doc({ clarify }), rules({ sources: ['Salaire : 45k€ - 55k€'] })).ok).toBe(true);
    expect(checkInterviewPrep(doc({ clarify }), rules()).problems).toContain(
      'le chiffre « 45k€ » n\'est dans aucune pièce fournie (profil, annonce, CV, pitch, notes) : chiffre sans source'
    );
  });
});

describe('phrases creuses, brouillon, longueur, mots-clés', () => {
  test('refuse une phrase creuse (DEFAULT_SLOP et liste de l’entretien)', () => {
    const clarify = "- Dire que je suis passionné par la growth.\n- Mon plus grand défaut est d'être perfectionniste.";
    const problems = checkInterviewPrep(doc({ clarify }), rules()).problems;
    expect(problems).toContain('phrase creuse : « passionné par »');
    expect(problems).toContain("phrase creuse : « mon plus grand défaut est d'être perfectionniste »");
  });
  test('refuse un marqueur de brouillon et un blanc de gabarit', () => {
    const problems = checkInterviewPrep(doc({ clarify: '- TODO vérifier\n- [PROJECT_NAME] à remplir' }), rules()).problems;
    expect(problems).toContain('marqueur de brouillon : « TODO »');
    expect(problems).toContain('blanc de gabarit non rempli : « [PROJECT_NAME] »');
  });
  test('trop court, trop long', () => {
    expect(checkInterviewPrep(doc(), rules({ minChars: 100000 })).problems.some((p) => p.startsWith('document trop court'))).toBe(true);
    expect(checkInterviewPrep(doc(), rules({ maxChars: 500 })).problems.some((p) => p.startsWith('document trop long'))).toBe(true);
  });
  test('les mots-clés de l’offre sont couverts', () => {
    const problems = checkInterviewPrep(doc(), rules({ keywords: ['Salesforce', 'Python', 'n8n'] })).problems;
    expect(problems).toContain("mots-clés de l'offre couverts : 1/3 (33 %, au moins 50 %) ; manquent : Salesforce, Python");
  });
});
