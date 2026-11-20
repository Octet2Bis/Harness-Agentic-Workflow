import { describe, expect, test } from 'bun:test';
import {
  ALL_LETTER_SLOP,
  DEFAULT_LETTER_RULES,
  LETTER_LAYOUT,
  type LetterRules,
  candidateName,
  checkLetter,
  contactProblems,
  dashCount,
  dashProblems,
  detectLanguage,
  durations,
  estimateLines,
  evidenceProblems,
  expectedLanguage,
  languageProblems,
  letterBlocks,
  letterWords,
  mentionProblems,
  nameInHeading,
  normalize,
  onePageProblems,
  parseEvidence,
  parseLetter,
  placeholderProblems,
  placeholders,
  plainNumbers,
  readOffer,
  roleName,
  signatureProblems,
  slopProblems,
  structureProblems,
  unsupportedDurations,
  unsupportedNumbers,
  wordBudgetProblems,
} from './letter-checks.ts';

// Un profil et une lettre fictifs (Jane Doe, Acme) : aucun fait d'une personne réelle.
const profile = `# Jane Doe

Contact : jane@example.org — https://www.linkedin.com/in/jane-doe/

## Expériences
* Way2Tech (2022-2024), Growth Ops : campagnes outbound à ~50% de taux d'ouverture sur 1 200 prospects.
* Automatisation n8n de la qualification des leads entrants, 6 heures gagnées par semaine.
* Refonte du tracking GTM / GA4 de 3 sites e-commerce.
* 2 ans d'expérience en growth B2B.`;

const posting =
  "Acme recrute un Growth Ops Manager (H/F) pour structurer le pipeline de l'équipe commerciale. Vous piloterez la prospection, le CRM et le tracking. Chez nous, on mesure avant de dépenser et nous cherchons une personne qui aime les processus simples.";

const letter = `# Jane Doe
jane@example.org · https://www.linkedin.com/in/jane-doe/

Paris, le 22 octobre 2026

**Objet :** candidature au poste de Growth Ops Manager chez Acme

Madame, Monsieur,

Acme cherche un Growth Ops Manager capable de faire tourner la prospection sans multiplier les outils. C'est le travail que j'ai mené chez Way2Tech pendant 2 ans, et je voudrais le poursuivre avec votre équipe commerciale.

Chez Way2Tech, j'ai conduit des campagnes outbound à ~50% de taux d'ouverture sur 1 200 prospects. J'y ai appris à écrire peu, à tester souvent et à couper vite ce qui ne répond pas. Votre annonce parle d'un pipeline à structurer : je commencerais par là, avec les commerciaux, en partant des séquences qui marchent déjà.

J'ai aussi automatisé avec n8n la qualification des leads entrants, ce qui a rendu 6 heures par semaine à l'équipe. Le même principe servirait vos commerciaux : moins de saisie, des fiches à jour, des relances qui partent à l'heure.

Enfin, j'ai repris le tracking GTM / GA4 de 3 sites e-commerce. Chaque campagne avait ensuite un coût par lead lisible, et les arbitrages budgétaires se faisaient sur des chiffres partagés plutôt que sur des impressions.

Ce qui m'attire chez Acme, c'est la place donnée aux opérations dans la croissance : l'annonce décrit une équipe qui mesure avant de dépenser. C'est ma façon de travailler, et je peux l'appliquer dès les premières semaines, à commencer par un audit des séquences en place et du CRM. Je connais aussi les limites de l'exercice : un outil de plus ne règle rien si personne ne s'en sert, et je préfère livrer peu mais utilisé.

Je serais heureuse d'en parler avec vous lors d'un entretien.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

Jane Doe
`;

const evidence = [
  { letter: "j'ai conduit des campagnes outbound à ~50% de taux d'ouverture sur 1 200 prospects", profile: "campagnes outbound à ~50% de taux d'ouverture sur 1 200 prospects" },
  { letter: "J'ai aussi automatisé avec n8n la qualification des leads entrants", profile: 'Automatisation n8n de la qualification des leads entrants' },
];

const rules: LetterRules = {
  ...DEFAULT_LETTER_RULES,
  company: 'Acme',
  title: 'Growth Ops Manager (H/F)',
  profile,
  posting,
  name: 'Jane Doe',
  language: 'fr',
};

const parts = parseLetter(letter);

describe('lecture', () => {
  test("normalise l'emphase, les apostrophes, les espaces et la casse", () => {
    expect(normalize("**N’hésitez**  pas : [site](https://x.y) « oui »")).toBe('n\'hésitez pas : site " oui "');
  });
  test("lit l'offre (entités décodées), l'annonce complète d'abord, sinon description et compétences", () => {
    expect(readOffer('{"company":"Acme &amp; Co","title":"Growth","description_full":"Annonce","description":"court"}')).toEqual({ company: 'Acme & Co', title: 'Growth', posting: 'Annonce' });
    expect(readOffer('{"company":"Acme","description":"court","skills_required":"n8n"}').posting).toBe('court\nn8n');
    expect(readOffer('pas du json')).toEqual({ company: '', title: '', posting: '' });
  });
  test("retire la mention de genre de l'intitulé, et seulement elle", () => {
    expect(roleName('Growth Ops Manager (H/F)')).toBe('Growth Ops Manager');
    expect(roleName('Chef de projet F/H')).toBe('Chef de projet');
    expect(roleName('Data Analyst (m/f/d)')).toBe('Data Analyst');
    expect(roleName('Head of Growth')).toBe('Head of Growth');
  });
});

describe('forme de la lettre', () => {
  test('découpe en-tête, objet, corps et signature', () => {
    expect(parts.name).toBe('Jane Doe');
    expect(parts.header).toEqual(['jane@example.org · https://www.linkedin.com/in/jane-doe/', 'Paris, le 22 octobre 2026']);
    expect(parts.subject).toBe('candidature au poste de Growth Ops Manager chez Acme');
    expect(parts.body.startsWith('Madame, Monsieur,')).toBe(true);
    expect(parts.body.endsWith('salutations distinguées.')).toBe(true);
    expect(parts.signature).toBe('Jane Doe');
    expect(structureProblems(parts)).toEqual([]);
    expect(parseLetter('# J D\n\n**Subject:** Application for X at Y\n\nDear team,\n\nBody.\n\nJ D').subject).toBe('Application for X at Y');
  });
  test("signale l'en-tête et l'objet manquants", () => {
    const bad = structureProblems(parseLetter('Madame, Monsieur,\n\nUn texte.\n\nJane Doe'));
    expect(bad.some((p) => p.startsWith('en-tête absent'))).toBe(true);
    expect(bad.some((p) => p.startsWith("pas de ligne d'objet"))).toBe(true);
  });
});

describe('longueur et page', () => {
  test('compte les mots du corps, pas la ponctuation isolée', () => {
    expect(letterWords('Bonjour : 50 % de « gains » — oui')).toBe(5);
    expect(letterWords(parts.body)).toBeGreaterThanOrEqual(250);
    expect(letterWords(parts.body)).toBeLessThanOrEqual(300);
    expect(wordBudgetProblems(parts.body)).toEqual([]);
  });
  test('refuse un corps trop court ou trop long', () => {
    expect(wordBudgetProblems('Madame, Monsieur, merci.')[0]).toStartWith('lettre trop courte : 3 mots');
    expect(wordBudgetProblems('mot '.repeat(320))[0]).toStartWith('lettre trop longue : 320 mots');
  });
  test('tient sur une page A4', () => {
    const lines = estimateLines(letterBlocks(parts));
    expect(lines).toBeLessThanOrEqual(LETTER_LAYOUT.linesPerPage);
    expect(onePageProblems(letterBlocks(parts))).toEqual([]);
  });
  test('refuse ce qui déborde, même à 300 mots (trop de blocs courts)', () => {
    const list = Array.from({ length: 40 }, (_, i) => `- point ${i + 1} sur une ligne`).join('\n');
    const long = parseLetter(`# Jane Doe\n\n**Objet :** x\n\nMadame,\n\n${list}\n\nJane Doe`);
    expect(onePageProblems(letterBlocks(long))[0]).toContain('ne tient pas sur une page A4');
  });
});

describe('ce que la lettre nomme', () => {
  test("nomme l'entreprise et le poste (sans « (H/F) »), porte l'e-mail du profil", () => {
    expect(mentionProblems(letter, 'Acme', 'Growth Ops Manager (H/F)')).toEqual([]);
    expect(contactProblems(letter, profile)).toEqual([]);
    // Un téléphone au profil doit aussi figurer sur la ligne de contact (le PDF l'exige).
    expect(contactProblems('# Jane\njane@example.org', 'jane@example.org · Tél : 06 12 34 56 78')[0]).toContain('téléphone du profil');
    expect(contactProblems('# Jane\njane@example.org · 06.12.34.56.78', 'jane@example.org · Tél : 06 12 34 56 78')).toEqual([]);
  });
  test("refuse une lettre qui ne nomme ni l'entreprise ni le poste, sans e-mail", () => {
    const bad = mentionProblems(letter, 'Globex', 'Head of Growth');
    expect(bad).toContain("la lettre ne nomme pas l'entreprise (Globex) : elle n'est pas écrite pour elle");
    expect(bad.some((p) => p.includes('(Head of Growth)'))).toBe(true);
    expect(contactProblems(letter.replace('jane@example.org', 'jd'), profile)[0]).toContain('jane@example.org');
  });
});

describe('langue', () => {
  test("détecte le français et l'anglais, et attend la langue de l'annonce (français par défaut)", () => {
    expect(detectLanguage(parts.body)).toBe('fr');
    expect(detectLanguage('We are looking for a person who will own the pipeline and the CRM with our team.')).toBe('en');
    expect(detectLanguage('Growth Ops')).toBe('unknown');
    expect(expectedLanguage('', posting)).toBe('fr');
    expect(expectedLanguage('', 'We are hiring a Growth Ops Manager to own the pipeline. You will work with the sales team and the founders.')).toBe('en');
    expect(expectedLanguage('', 'Growth Ops Manager')).toBe('fr');
    expect(expectedLanguage('en', posting)).toBe('en');
    expect(languageProblems(parts.body, 'fr')).toEqual([]);
  });
  test("refuse une lettre qui n'est pas dans la langue de l'annonce", () => {
    const english = 'Dear team, I ran outbound campaigns for Way2Tech and I would like to do the same for you, with the sales team and the founders of the company.';
    expect(languageProblems(english, 'fr')[0]).toContain('en français');
  });
});

describe('preuves tracées vers le profil', () => {
  test('accepte deux preuves citées mot pour mot (à la casse, l’emphase et la ponctuation près)', () => {
    expect(parseEvidence(JSON.stringify(evidence))).toEqual(evidence);
    expect(parseEvidence('pas du json')).toEqual([]);
    expect(parseEvidence([{ letter: 'x' }, 'y'])).toEqual([]);
    expect(evidenceProblems(evidence, letter, profile)).toEqual({ problems: [], traced: 2 });
  });
  test('refuse une citation absente, trop courte, en double, ou une seule preuve', () => {
    const result = evidenceProblems(
      [
        evidence[0]!,
        { letter: evidence[0]!.letter, profile: evidence[0]!.profile },
        { letter: "J'ai aussi automatisé avec n8n la qualification des leads entrants", profile: 'Automatisation Zapier de toute la qualification des leads' },
        { letter: 'Chez Way2Tech', profile: 'Way2Tech' },
        { letter: 'une phrase que la lettre ne contient pas du tout', profile: '2 ans d’expérience en growth B2B' },
      ],
      letter,
      profile
    );
    expect(result.traced).toBe(1);
    expect(result.problems).toContain("preuve n°3 : « Automatisation Zapier de toute la qualification des leads » n'est pas dans le profil maître : le citer mot pour mot, ou retirer l'affirmation");
    expect(result.problems.some((p) => p.startsWith('preuve n°4 : passage de la lettre trop court'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('preuve n°5 : « une phrase que la lettre'))).toBe(true);
    expect(result.problems.at(-1)).toStartWith('1 preuve(s) tracée(s) vers le profil, au moins 2 attendues');
  });
});

describe('chiffres, durées et nombres', () => {
  test('normalise les durées, d’une langue à l’autre', () => {
    expect(durations('pendant 2 ans, 18 mois puis 3+ years, 6 weeks, 3 analyses')).toEqual(['2y', '18mo', '3y', '6w']);
    expect(unsupportedDurations('pendant 2 years', profile)).toEqual([]);
  });
  test("refuse une durée que le profil ne porte pas (l'annonce n'en est pas la source)", () => {
    expect(unsupportedDurations("fort de 5 ans d'expérience", profile)).toEqual(['5y']);
    expect(unsupportedDurations('pendant 3 ans', profile)).toEqual(['3y']);
  });
  test('lit les nombres, hors années, 0 et 1, ordinaux et noms d’outils', () => {
    expect(plainNumbers('En 2024, 1 200 prospects, 12 campagnes, 1,5 jour, 1er essai, GA4, n8n, ~50%, x3, 98/100')).toEqual(['1200', '12', '1.5', '50', '98', '100']);
    expect(unsupportedNumbers(parts.body, `${profile}\n${posting}`)).toEqual([]);
  });
  test('refuse un nombre sans source', () => {
    expect(unsupportedNumbers("j'ai mené 12 campagnes", profile)).toEqual(['12']);
  });
});

describe('style', () => {
  test('aucune formule creuse dans la lettre de référence', () => {
    expect(slopProblems(letter)).toEqual([]);
    expect(ALL_LETTER_SLOP).toContain('passionné par');
  });
  test('repère les clichés de lettre (apostrophes courbes comprises), une fois chacun', () => {
    const bad = slopProblems("C’est avec un grand intérêt que je me permets de vous écrire. Passionné par la data, je suis un team player.");
    // L'ordre suit celui des listes (DEFAULT_SLOP puis LETTER_SLOP), qui bougent : on compare triés.
    expect([...bad].sort()).toEqual([
      'formule creuse « passionné par » : la remplacer par un fait du profil',
      'formule creuse « je me permets de » : la remplacer par un fait du profil',
      "formule creuse « c'est avec un grand intérêt » : la remplacer par un fait du profil",
      'formule creuse « team player » : la remplacer par un fait du profil',
    ].sort());
  });
  test('guide de voix : la formule d’appel et l’ouverture de gabarit refusées (EN), « Hello <équipe> team, » acceptée', () => {
    const bad = slopProblems('Dear Hiring Manager,\n\nI am writing to apply for the role. I’m thrilled, and I would welcome the opportunity to discuss.');
    expect([...bad].sort()).toEqual([
      'formule creuse « dear hiring manager » : la remplacer par un fait du profil',
      'formule creuse « i am writing to » : la remplacer par un fait du profil',
      "formule creuse « i'm thrilled » : la remplacer par un fait du profil",
      'formule creuse « i would welcome the opportunity » : la remplacer par un fait du profil',
    ].sort());
    expect(slopProblems('Hello Acme team,\n\nYour posting describes a sales team that measures before it spends.')).toEqual([]);
    expect(slopProblems('Bonjour,\n\nVotre annonce parle d’un pipeline à structurer.')).toEqual([]);
  });
  test('tolère un tiret d’incise, pas leur série', () => {
    expect(dashCount('a — b, c – d, e -- f, Jean-Pierre, 2022-2024')).toBe(3);
    expect(dashProblems('Une phrase — une seule incise.')).toEqual([]);
    expect(dashProblems('a — b — c — d')[0]).toStartWith("3 tirets d'incise");
  });
  test('repère les marqueurs à compléter, pas les liens ni les adresses', () => {
    expect(placeholders('Voir [mon site](https://x.y) ou <https://x.y> et <jane@example.org>.')).toEqual([]);
    expect(placeholderProblems(letter)).toEqual([]);
    expect(placeholders('Madame [Nom du recruteur], chez <entreprise> {{poste}} TODO lorem ipsum')).toEqual(['[Nom du recruteur]', '<entreprise>', '{{poste}}', 'TODO', 'lorem ipsum']);
  });
});

describe('signature', () => {
  test('trouve le nom du candidat : entrée, titre du CV, ligne « Nom : », titre du profil', () => {
    expect(nameInHeading('CV — Jane Doe')).toBe('Jane Doe');
    expect(nameInHeading('Antoine Exemple · Profil maître')).toBe('Antoine Exemple');
    expect(nameInHeading('Marie de La Tour')).toBe('Marie de La Tour');
    expect(nameInHeading('Profil maître')).toBe('');
    expect(nameInHeading('Master Profile')).toBe('');
    expect(candidateName('Jane Q. Doe', '# CV — Jane Doe', profile)).toBe('Jane Q. Doe');
    expect(candidateName('', '# CV — Jane Doe\n', '')).toBe('Jane Doe');
    expect(candidateName('', '', '# Profil maître\n\n**Nom :** Jean-Pierre Martin\n')).toBe('Jean-Pierre Martin');
    expect(candidateName('', '', profile)).toBe('Jane Doe');
    expect(candidateName('', '', '# Profil\n\nrien')).toBe('');
  });
  test('accepte la lettre signée du nom, seul sur la dernière ligne', () => {
    expect(signatureProblems(parts, 'Jane Doe')).toEqual([]);
    expect(signatureProblems(parts, '')).toEqual([]);
  });
  test('refuse une signature absente, mêlée à la formule, ou un autre nom', () => {
    expect(signatureProblems(parseLetter(letter.replace(/Jane Doe\n$/, 'Cordialement, Jane Doe\n')), 'Jane Doe')[0]).toContain('lu « Cordialement, Jane Doe »');
    const other = signatureProblems(parseLetter(letter.replace(/^# Jane Doe/, '# John Roe').replace(/Jane Doe\n$/, 'John Roe\n')), 'Jane Doe');
    expect(other).toHaveLength(2);
    expect(signatureProblems(parseLetter('# Jane Doe\n\n**Objet :** x'), 'Jane Doe')).toEqual(['la lettre ne finit pas par une signature : dernière ligne, le nom du candidat seul']);
  });
});

describe('checkLetter', () => {
  test('accepte une lettre complète', () => {
    const result = checkLetter({ letter, evidence }, rules);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.traced).toBe(2);
    expect(result.words).toBeGreaterThanOrEqual(250);
    expect(result.lines).toBeLessThanOrEqual(LETTER_LAYOUT.linesPerPage);
  });
  test('nomme chaque problème : chiffre, nombre, durée inventés, cliché, tirets, marqueur, preuves', () => {
    const bad = letter
      .replace('~50% de taux', '+72 % de taux')
      .replace('pendant 2 ans', 'pendant 5 ans')
      .replace('rendu 6 heures', 'rendu 14 heures')
      .replace('Madame, Monsieur,', 'Madame [Nom],')
      .replace('Enfin,', "C'est avec un grand intérêt — et une motivation sans faille — que")
      .replace('Acme cherche', 'Acme — vraiment — cherche');
    // L'annonce exige 5 ans : elle n'est pas une source pour une durée d'expérience du candidat.
    const result = checkLetter({ letter: bad, evidence: evidence.slice(0, 1) }, { ...rules, posting: `${posting} 5 ans d'expérience exigés.` });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("chiffre « 72% » absent du profil maître et de l'annonce : affirmation sans source");
    expect(result.problems.some((p) => p.startsWith('durée « 5 an(s) »'))).toBe(true);
    expect(result.problems).toContain("nombre « 14 » absent du profil maître et de l'annonce : affirmation sans source");
    expect(result.problems.some((p) => p.includes('« 72 »') || p.includes('« 5 »'))).toBe(false);
    expect(result.problems).toContain("formule creuse « c'est avec un grand intérêt » : la remplacer par un fait du profil");
    expect(result.problems).toContain("4 tirets d'incise (—, –), au plus 1 : les remplacer par une virgule, deux-points ou un point");
    expect(result.problems).toContain('marqueur à compléter « [Nom] » : écrire le texte ou retirer la phrase');
    expect(result.problems.some((p) => p.startsWith("preuve n°1 : « j'ai conduit"))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('0 preuve(s) tracée(s)'))).toBe(true);
  });
  test("accepte une lettre en anglais pour une annonce en anglais (preuves citées du profil en français)", () => {
    const english = `# Jane Doe
jane@example.org · https://www.linkedin.com/in/jane-doe/

Paris, 22 October 2026

**Subject:** Application for Growth Ops Manager at Acme

Hello Acme team,

Acme is looking for a Growth Ops Manager who can make prospecting run without adding tools. That is the work I did at Way2Tech for 2 years, and I would like to continue it with your sales team.

At Way2Tech, I ran outbound campaigns with a ~50% open rate on 1 200 prospects. I learned to write short messages, test often and drop what does not get answers. Your posting mentions a pipeline to structure, so that is where I would start, with the sales reps and the sequences that already work.

I also automated the qualification of inbound leads with n8n, which gave the team back 6 hours per week. The same approach would help your reps: less data entry, records that stay current, and follow-ups that go out on time.

Finally, I rebuilt the GTM / GA4 tracking of 3 e-commerce sites. Every campaign then had a readable cost per lead, and budget decisions were made on shared numbers rather than impressions.

What draws me to Acme is the place given to operations in growth: the posting describes a team that measures before it spends. That is how I work, and I can apply it from the first weeks, starting with an audit of the current sequences and of the CRM. I also know the limits of the exercise: one more tool fixes nothing if nobody uses it, so I prefer to ship less but ship what gets used.

I would be glad to discuss this with you in an interview.

Kind regards,

Jane Doe
`;
    const englishPosting = 'Acme is hiring a Growth Ops Manager to structure the pipeline of the sales team. You will own prospecting, the CRM and the tracking, and we measure before we spend.';
    const result = checkLetter(
      {
        letter: english,
        evidence: [
          { letter: 'I ran outbound campaigns with a ~50% open rate on 1 200 prospects', profile: evidence[0]!.profile },
          { letter: 'I also automated the qualification of inbound leads with n8n', profile: evidence[1]!.profile },
        ],
      },
      { ...rules, title: 'Growth Ops Manager', posting: englishPosting, language: expectedLanguage('', englishPosting) }
    );
    expect(result.problems).toEqual([]);
    expect(result.words).toBeGreaterThanOrEqual(250);
  });
  test('une lettre absente arrête là', () => {
    expect(checkLetter({ letter: null, evidence }, rules)).toEqual({ ok: false, problems: ['letter.md absent ou vide'], words: 0, lines: 0, traced: 0 });
  });
});
