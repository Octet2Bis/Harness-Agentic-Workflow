import { describe, expect, test } from 'bun:test';
import {
  DASH_BUDGET,
  answerProblems,
  checkApplication,
  contactProblems,
  dashProblems,
  keywordCoverage,
  longDashes,
  namedParties,
  pageBudgetProblems,
  pitchProblems,
  readContact,
  slopPhrases,
  teamSizes,
  unitFigures,
  unsupportedClaims,
  unsupportedFigures,
  withoutLiterals,
} from './cv-checks.ts';

const profile = `# Profil\n\nContact : jane@example.org — https://www.linkedin.com/in/jane-doe/\n\n* Campagnes outbound à ~50% de taux d'ouverture\n* Salaire 38k€ - 50k€\n* Score délivrabilité 98/100, ROAS x3`;

const cv = `# CV — Jane Doe
**Candidature :** Acme — Growth Ops Manager
Contact : jane@example.org

## Profil
Growth et automatisation n8n pour Acme.

## Expériences
### Way2Tech — Growth
* Outbound (Apollo, Lemlist) à ~50 % d'ouverture.
* Tracking GTM / GA4, A/B Testing.

## Compétences
n8n, HubSpot, GTM, A/B Testing, SQL`;

const pitch = `Bonjour,\n\nLe poste Growth Ops chez Acme rejoint ce que j'ai fait : séquences à ~50% d'ouverture et automatisations n8n.\n\nSeriez-vous ouvert à un échange de 10 minutes cette semaine ?\n\nJane`;

const candidate = {
  name: 'Jane Doe',
  email: 'jane@example.org',
  linkedin: 'https://www.linkedin.com/in/jane-doe/',
  portfolio: 'https://jane.example',
  location: 'Paris, France (full remote)',
  availability: 'immédiate',
  answers: { 'Pourquoi Acme ?': 'Parce que …' },
};

const rules = {
  company: 'Acme',
  title: 'Growth Ops Manager',
  keywords: ['n8n', 'GTM', 'A/B Testing', 'HubSpot'],
  minCoverage: 0.75,
  requiredSections: ['Profil', 'Expériences', 'Compétences'],
  profile,
  pageBudget: { lines: 70, chars: 4500 },
  maxPitchWords: 180,
  slop: undefined as unknown as string[],
};
// DEFAULT_SLOP s'applique quand `slop` est omis dans les helpers ; pour checkApplication on le passe explicitement.
import { DEFAULT_SLOP } from './cv-checks.ts';
rules.slop = DEFAULT_SLOP;

describe('keywordCoverage', () => {
  test('délimite les mots-clés et ignore la casse', () => {
    const result = keywordCoverage('Maîtrise de n8n, GTM et du A/B Testing.', ['n8n', 'gtm', 'A/B Testing', 'SQL']);
    expect(result.covered).toEqual(['n8n', 'gtm', 'A/B Testing']);
    expect(result.missing).toEqual(['SQL']);
    expect(result.ratio).toBeCloseTo(0.75);
  });
  test('ne compte pas un mot-clé au milieu d’un mot', () => {
    expect(keywordCoverage('postgresql', ['SQL']).missing).toEqual(['SQL']);
  });
  test('une expression est couverte par ses mots séparés, pas par un seul d’entre eux', () => {
    const cv = 'Lifecycle e-mail at Be Mate; marketing automation; a specialist in Klaviyo flows.';
    expect(keywordCoverage(cv, ['lifecycle marketing specialist']).covered).toEqual(['lifecycle marketing specialist']);
    expect(keywordCoverage('Lifecycle flows only.', ['lifecycle marketing specialist']).missing).toEqual(['lifecycle marketing specialist']);
    expect(keywordCoverage('Suivi des campagnes et génération de leads', ['génération de leads']).covered).toEqual(['génération de leads']);
    expect(keywordCoverage('Suivi des campagnes', ['génération de leads']).missing).toEqual(['génération de leads']);
  });
});

describe('figures', () => {
  test('extrait et normalise les chiffres à unité', () => {
    expect(unitFigures('~50 % d’ouverture, 38k€ - 50k€, score 98/100, ROAS x3, en 2024 avec 3 équipes')).toEqual([
      '50%',
      '38k€',
      '50k€',
      '98/100',
      'x3',
    ]);
  });
  test('signale un chiffre que le profil ne porte pas', () => {
    expect(unsupportedFigures('Taux d’ouverture 50% et +35% de conversion', profile)).toEqual(['35%']);
    expect(unsupportedFigures(cv, profile)).toEqual([]);
  });
});

describe('slop, budget, contact, pitch', () => {
  test('repère les phrases creuses', () => {
    expect(slopPhrases('Passionné par le growth, force de proposition.')).toEqual(['passionné par', 'force de proposition']);
  });
  test('repère les clichés ajoutés (FR et EN), et laisse passer un texte sobre', () => {
    expect(slopPhrases(cv)).toEqual([]);
    expect(slopPhrases(pitch)).toEqual([]);
    expect(
      slopPhrases("Orientée résultats et dotée d'un esprit d'équipe, je suis la candidate idéale. Leveraging my skills, I would be a great fit and a team player.")
    ).toEqual(['would be a great fit', 'team player', 'leveraging', 'orientée résultat', "esprit d'équipe", 'candidate idéale']);
  });
  test('guide de voix : ouvertures et clôtures de gabarit refusées (EN et FR), apostrophe courbe comprise', () => {
    expect(slopPhrases('Dear Hiring Manager, I am applying for the Growth Ops role. I’m thrilled by your synergy.')).toEqual(['i am applying for', "i'm thrilled", 'dear hiring manager', 'synergy']);
    expect(slopPhrases('Revenue operations at scale. That is the space I work in. I would welcome the opportunity to talk.')).toEqual(['i would welcome the opportunity', 'that is the space i work in']);
    expect(slopPhrases('We leverage data in a fast-paced, dynamic environment.')).toEqual(['fast-paced', 'leverage', 'dynamic environment']);
    expect(slopPhrases("Je me permets de vous écrire : c'est avec un grand intérêt que j'ai lu l'offre de votre start-up dynamique.")).toEqual(['je me permets de', "c'est avec un grand intérêt", 'start-up dynamique']);
    // « dynamique » seul n'est pas refusé : un vrai savoir-faire (tarification dynamique, Microsoft Dynamics) passe.
    expect(slopPhrases('Tarification dynamique, Microsoft Dynamics 365, pricing dynamique.')).toEqual([]);
  });
  test('les réponses de candidate.json : mêmes phrases creuses refusées que dans le pitch', () => {
    const answers = { 'Why this company?': "I'm thrilled to apply: I am passionate about your product.", 'Remote work': 'Two days a week on site suit me.', Count: 3 };
    expect(answerProblems({ answers }, DEFAULT_SLOP)).toEqual([
      'candidate.json: answer to "Why this company?": hollow phrase "passionate about"',
      'candidate.json: answer to "Why this company?": hollow phrase "i\'m thrilled"',
    ]);
    expect(answerProblems({ answers: { 'Pourquoi Acme ?': 'Votre outil de planification, que j’utilise déjà côté client.' } }, DEFAULT_SLOP)).toEqual([]);
    expect(answerProblems(null, DEFAULT_SLOP)).toEqual([]);
    expect(answerProblems({ answers: [] }, DEFAULT_SLOP)).toEqual([]);
    const result = checkApplication({ cv, pitch, candidate: { ...candidate, answers: { 'Pourquoi Acme ?': "C'est avec un grand intérêt que…" } } }, rules);
    expect(result.problems).toContain('candidate.json: answer to "Pourquoi Acme ?": hollow phrase "c\'est avec un grand intérêt"');
  });
  test('aucune entrée de DEFAULT_SLOP n’en contient une autre : un cliché est signalé une fois', () => {
    const overlaps = DEFAULT_SLOP.flatMap((a) => DEFAULT_SLOP.filter((b) => a !== b && a.toLowerCase().includes(b.toLowerCase())).map((b) => `${a} ⊃ ${b}`));
    expect(overlaps).toEqual([]);
    expect(new Set(DEFAULT_SLOP).size).toBe(DEFAULT_SLOP.length);
  });
  test('tient le budget d’une page', () => {
    expect(pageBudgetProblems(cv)).toEqual([]);
    expect(pageBudgetProblems('x\n'.repeat(80))[0]).toContain('80 non-empty lines');
  });
  test('lit le contact du profil et l’exige sur le CV', () => {
    expect(readContact(profile)).toEqual({ email: 'jane@example.org', linkedin: 'https://www.linkedin.com/in/jane-doe/', phone: '' });
    expect(contactProblems('# CV sans contact', readContact(profile))[0]).toContain('jane@example.org');
  });
  test('exige le téléphone du profil sur le CV (le PDF l’exige aussi)', () => {
    const withPhone = 'Contact : jane@example.org · Tél : +33 6 12 34 56 78';
    const contact = readContact(withPhone);
    expect(contact.phone).toBe('+33 6 12 34 56 78');
    expect(contactProblems('jane@example.org · 06.12.34.56.78', contact)).toEqual([]);
    expect(contactProblems('jane@example.org · +33 (0)6 12 34 56 78', contact)).toEqual([]);
    expect(contactProblems('jane@example.org', contact)[0]).toContain('profile phone');
    // Pas de téléphone au profil : rien d'exigé ; une année ou un budget n'est pas un téléphone.
    expect(readContact('jane@example.org, 2019 – 2023, 120 000 €').phone).toBe('');
  });
  test('exige un message court qui nomme l’entreprise et finit par une demande', () => {
    expect(pitchProblems(pitch, { company: 'Acme', maxWords: 180, slop: DEFAULT_SLOP })).toEqual([]);
    const bad = pitchProblems('Bonjour. Passionné par le growth. Cordialement.', { company: 'Acme', maxWords: 180, slop: DEFAULT_SLOP });
    expect(bad).toContain('pitch does not name the company (Acme)');
    expect(bad).toContain('pitch ends without a concrete ask (no question)');
    expect(bad).toContain('pitch: hollow phrase "passionné par"');
  });
});

describe('tirets longs', () => {
  test('compte hors titres, sans les intervalles de nombres', () => {
    expect(longDashes('# CV — Jane\n### Way2Tech — Growth\n* 2019–2024, puis 2024 – 2025')).toBe(0);
    expect(longDashes('* a — b -- c – d\n* e―f')).toBe(4);
  });
  test('tolère la ligne « entreprise — poste » et une incise, refuse un tiret par puce', () => {
    expect(dashProblems('CV', cv, DASH_BUDGET.cv)).toEqual([]);
    const dashy = ['* Outbound — 50 % d’ouverture', '* Tracking GTM — GA4', '* n8n — 12 workflows', '* HubSpot — CRM'].join('\n');
    expect(dashProblems('CV', dashy, DASH_BUDGET.cv)).toEqual([
      'CV: 4 long dashes (—, –) outside headings, at most 3: use a comma, a colon, parentheses or a full stop',
    ]);
  });
});

describe('portées que le profil ne porte pas', () => {
  const rich = `${profile}\n* Clients : Decathlon, Back Market\n* Budget média B2B, équipe de 5 personnes managée`;
  const scoped = [
    '## Expériences',
    '* Growth B2B : budget média et P&L du canal.',
    '* Managé une équipe de 5 personnes.',
    '* Clients : Decathlon et Back Market.',
  ].join('\n');
  test('lit les effectifs et les clients nommés', () => {
    expect(teamSizes('une équipe de huit, team of five, 3 stagiaires, 12 people, 5 ans')).toEqual([
      { size: '8', text: 'équipe de huit' },
      { size: '5', text: 'team of five' },
      { size: '3', text: '3 stagiaires' },
      { size: '12', text: '12 people' },
    ]);
    expect(namedParties("**Clients :** Decathlon, Leroy Merlin et Back Market. Partenariat avec Shopify, pour le compte d'Orange.")).toEqual([
      'Decathlon',
      'Leroy Merlin',
      'Back Market',
      'Shopify',
      'Orange',
    ]);
  });
  test('accepte une portée que le profil porte, sous une autre forme', () => {
    expect(unsupportedClaims(scoped.replace(' et P&L du canal', ''), rich)).toEqual([]);
    expect(unsupportedClaims(cv, profile)).toEqual([]);
  });
  test('ne prend pas pour du management ce qui n’en est pas', () => {
    const neutral = 'Management de projet. Product Manager. Lead generation. Travail en équipe. Encadré par le CTO. Managed reports in Looker. Collaboration avec l’équipe produit.';
    expect(unsupportedClaims(neutral, '')).toEqual([]);
  });
  test('signale chaque portée déduite : modèle, P&L, budget, management, effectif, client', () => {
    expect(unsupportedClaims(scoped, profile)).toEqual([
      { kind: 'B2B', text: 'B2B' },
      { kind: 'P&L', text: 'P&L' },
      { kind: 'budget', text: 'budget' },
      { kind: 'people management', text: 'Managé une équipe' },
      { kind: 'team size', text: 'équipe de 5' },
      { kind: 'client or partner', text: 'Decathlon' },
      { kind: 'client or partner', text: 'Back Market' },
    ]);
    expect(unsupportedClaims('* Encadrement de 8 stagiaires', rich)).toEqual([{ kind: 'team size', text: '8 stagiaires' }]);
  });
  test('retire l’entreprise et l’intitulé de l’offre avant de chercher', () => {
    expect(withoutLiterals('Acme — Growth Manager B2B', ['acme', 'Growth Manager B2B', ''])).toBe('  —  ');
  });
});

describe('checkApplication', () => {
  test('accepte un dossier complet', () => {
    const result = checkApplication({ cv, pitch, candidate }, rules);
    expect(result).toEqual({ ok: true, problems: [], coverage: { covered: ['n8n', 'GTM', 'A/B Testing', 'HubSpot'], missing: [], ratio: 1 } });
  });
  test('nomme chaque problème : couverture, chiffre inventé, entreprise absente, fiche incomplète', () => {
    const weakCv = cv.replace('n8n, HubSpot, GTM, A/B Testing, SQL', 'SQL').replace(/n8n/g, 'no-code').replace(/Acme/g, 'Globex').replace(/~50 %/, '+72 %');
    const result = checkApplication({ cv: weakCv, pitch, candidate: { ...candidate, email: 'other@example.org', answers: undefined } }, rules);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.startsWith('CV covers'))).toBe(true);
    expect(result.problems).toContain('CV: figure "72%" does not appear in the master profile (unsupported claim)');
    expect(result.problems).toContain('candidate.json: missing "answers"');
    expect(result.problems).toContain('candidate.json: e-mail "other@example.org" differs from the master profile (jane@example.org)');
    expect(result.problems.some((p) => p.includes('does not name the company (Acme)') && p.startsWith('CV'))).toBe(true);
  });
  test('intitulé recopié dans l’en-tête : pas une portée ; puces et message chargés : refusés', () => {
    const b2bRules = { ...rules, title: 'Growth Ops Manager B2B' };
    const header = cv.replace('Acme — Growth Ops Manager', 'Acme — Growth Ops Manager B2B');
    expect(checkApplication({ cv: header, pitch, candidate }, b2bRules).problems).toEqual([]);
    const inflated = header.replace('* Tracking GTM / GA4, A/B Testing.', '* Tracking GTM / GA4 — A/B Testing — clients B2B — budget — n8n.');
    const dashyPitch = pitch.replace("séquences à ~50% d'ouverture", "séquences — ~50% d'ouverture — et n8n —");
    const result = checkApplication({ cv: inflated, pitch: dashyPitch, candidate }, b2bRules);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      `CV: B2B claim "B2B" does not appear in the master profile (inferred scope: remove it or use the profile's own words)`,
      `CV: budget claim "budget" does not appear in the master profile (inferred scope: remove it or use the profile's own words)`,
      'CV: 5 long dashes (—, –) outside headings, at most 3: use a comma, a colon, parentheses or a full stop',
      'pitch: 3 long dashes (—, –) outside headings, at most 2: use a comma, a colon, parentheses or a full stop',
    ]);
  });
  test('un CV manquant arrête là, avec la fiche quand même contrôlée', () => {
    const result = checkApplication({ cv: null, pitch: null, candidate: null }, rules);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['CV file is missing or empty', 'pitch file is missing or empty', 'candidate.json is missing or is not a JSON object']);
  });
});

import { profileSection, profileSectionProblems } from './cv-checks.ts';

describe('profileSectionProblems', () => {
  const wrap = (body: string) => `# CV — Jane Doe\n\n## Profile\n${body}\n\n## Experience\n### Acme — Growth`;
  const keywords = ['SEO', 'SEA', 'Google Ads', 'GA4', 'GTM', 'n8n', 'Zapier', 'CRM', 'AEO'];
  test('lit l’encart jusqu’au titre suivant', () => {
    expect(profileSection(wrap('Two lines.\nOn the path.'))).toBe('Two lines.\nOn the path.');
    expect(profileSection('# CV\n\n## Skills\nx')).toBe('');
  });
  test('un parcours en trois phrases passe', () => {
    const body = 'Started in customer support and QA, then UX design and web development; today Growth Marketing at Acme. My thread: connecting data, tools and teams, with clean CRM bases and automations. At ease in start-ups, with method.';
    expect(profileSectionProblems(wrap(body), 'Digital Marketing Specialist', keywords)).toEqual([]);
  });
  test('un amas de mots-clés de l’offre est refusé (CV Dana, 2026-10-24)', () => {
    const body = 'SEO/SEA and AI search visibility: on-page and semantic SEO, Google Ads, AEO/GEO.\nAt Be Mate, the GA4, GTM and Meta Conversion API tracking plan made ROAS figures reliable.\nAt Way2Tech.ai, n8n and Zapier flows automated lead enrichment and CRM sync.';
    const problems = profileSectionProblems(wrap(body), 'Digital Marketing Specialist', keywords);
    expect(problems.some((p) => p.includes('pile of the posting'))).toBe(true);
  });
  test('liste, longueur, nombre de phrases et ouverture sur l’intitulé visé', () => {
    expect(profileSectionProblems(wrap('- Growth\n- CRM'), '', [])[0]).toContain('a list');
    expect(profileSectionProblems(wrap('A. B. C. D.'), '', []).some((p) => p.includes('4 sentences'))).toBe(true);
    expect(profileSectionProblems(wrap(`${'word '.repeat(130)}.`), '', []).some((p) => p.includes('too long'))).toBe(true);
    expect(profileSectionProblems(wrap('Digital Marketing Specialist with a growth background.'), 'Digital Marketing Specialist', [])[0]).toContain('opens with the posting title');
  });
});
