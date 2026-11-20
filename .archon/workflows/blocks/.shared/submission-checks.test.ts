import { describe, expect, test } from 'bun:test';
import { hostPolicy } from './platforms.ts';
import {
  type AnswerSources,
  evaluatePrefill,
  evaluateReceipt,
  fileName,
  findAnswer,
  freeTextProblems,
  isOpenQuestion,
  letterProblems,
  letterTextPath,
  parseAnswers,
  parseJsonObject,
  prefillRecap,
} from './submission-checks.ts';

const prefill = {
  apply_url: 'https://jobs.lever.co/acme/1',
  final_url: 'https://jobs.lever.co/acme/1/apply',
  platform: 'lever',
  fields: [
    { label: 'Full name', value: 'Jane Doe', source: 'candidate.name', status: 'filled' },
    { label: 'Email', value: 'jane@example.org', source: 'candidate.email', status: 'filled' },
  ],
  attachments: [{ field: 'Resume/CV', file: '/x/CV.pdf', status: 'attached' }],
  unanswered: [],
  submit_control: { label: 'Submit application', visible: true, enabled: true },
  screenshot: 'prefill.png',
  blocked: false,
  blocker: '',
  submitted: false,
};
const context = { email: 'jane@example.org', requireCv: true, screenshotExists: true };

describe('evaluatePrefill', () => {
  test('accepte un formulaire prêt', () => {
    expect(evaluatePrefill(prefill, context)).toEqual({ ok: true, problems: [], filled: 2, attached: true, recap: 'Réponses libres : aucune.\nÀ remplir par Antoine : rien.' });
  });
  test('refuse un envoi prématuré, un blocage, un CV manquant, des champs sans réponse', () => {
    const result = evaluatePrefill(
      { ...prefill, submitted: true, blocked: true, blocker: 'CAPTCHA', attachments: [], unanswered: [{ label: 'Visa', reason: 'not in sheet' }] },
      { ...context, screenshotExists: false }
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('prefill must not submit the form: submitted is true');
    expect(result.problems).toContain('blocked before the form could be filled: CAPTCHA');
    expect(result.problems).toContain('the CV is not attached (no attachment with status "attached")');
    expect(result.problems.some((p) => p.startsWith('champs sans réponse : "Visa"'))).toBe(true);
    expect(result.problems.some((p) => p.includes('prefill.png'))).toBe(true);
  });
  test('exige l’e-mail du profil dans un champ rempli', () => {
    expect(evaluatePrefill(prefill, { ...context, email: 'other@example.org' }).problems).toEqual(['no filled field carries the candidate e-mail (other@example.org)']);
  });
  test('parseJsonObject tolère le JSON invalide', () => {
    expect(parseJsonObject('nope')).toBeNull();
    expect(parseJsonObject('[1]')).toBeNull();
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('evaluatePrefill : l’hôte de la page remplie', () => {
  const lever = hostPolicy('https://jobs.lever.co/acme/1', 'lever');
  test('le formulaire sur l’hôte de la plateforme passe', () => {
    expect(evaluatePrefill(prefill, { ...context, hosts: lever }).ok).toBe(true);
  });
  test('un sosie, http, un final_url absent : refusés, en français', () => {
    for (const final_url of ['https://jobs.lever.co.evil.com/acme/1/apply', 'https://jobs-lever.co/acme/1/apply', 'http://jobs.lever.co/acme/1/apply']) {
      const result = evaluatePrefill({ ...prefill, final_url }, { ...context, hosts: lever });
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toStartWith('Le formulaire rempli (final_url de prefill.json)');
    }
    expect(evaluatePrefill({ ...prefill, final_url: '' }, { ...context, hosts: lever }).problems[0]).toContain('URL vide');
  });
  test('un agent arrêté avant toute page (blocage) n’a pas d’hôte à vérifier : seul le blocage est dit', () => {
    const result = evaluatePrefill({ ...prefill, final_url: '', blocked: true, blocker: 'login wall' }, { ...context, hosts: lever });
    expect(result.problems.some((p) => p.includes('URL vide'))).toBe(false);
    expect(result.problems).toContain('blocked before the form could be filled: login wall');
  });
  test('un passage de main donné par target reste rouge ; Workday atteint n’en est plus un (session d’Antoine, 2026-10-24)', () => {
    const handover = 'Passer la main : Antoine postule';
    expect(evaluatePrefill(prefill, { ...context, handover }).problems).toEqual([handover]);
    const reached = evaluatePrefill({ ...prefill, final_url: 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/X_R1/apply' }, context);
    expect(reached.problems.some((p) => p.startsWith('Workday :'))).toBe(false);
  });
});

describe('evaluatePrefill : une question sans réponse reste à Antoine, seulement si un go suit', () => {
  const pending = { ...prefill, unanswered: [{ label: 'Visa sponsorship?', reason: 'not in the profile', required: true }] };
  test('avec un go : vert, et listée « à remplir par Antoine » dans le récapitulatif', () => {
    const result = evaluatePrefill(pending, { ...context, humanGo: true });
    expect(result.ok).toBe(true);
    expect(result.recap).toContain('À remplir par Antoine : « Visa sponsorship? » (obligatoire).');
  });
  test('sans go (auto, plateforme vérifiée), ou go inconnu : rouge, comme avant', () => {
    expect(evaluatePrefill(pending, { ...context, humanGo: false }).ok).toBe(false);
    expect(evaluatePrefill(pending, context).ok).toBe(false);
  });
});

const ANSWERS = `# Réponses aux formulaires

Notes d'Antoine, ignorées.
<!-- ## Pas une entrée -->

## Prétentions salariales
Variantes : Salary expectations | Rémunération souhaitée
45 000 à 50 000 € bruts annuels, selon le périmètre.

## Visa sponsorship
Choix : No | Non

Je suis citoyen français :
aucun visa n'est nécessaire dans l'UE.

## Years of Salesforce
`;

describe('parseAnswers / findAnswer', () => {
  const entries = parseAnswers(ANSWERS);
  test('une entrée par titre ##, variantes et choix sous le titre, réponse jusqu’au titre suivant', () => {
    expect(entries).toEqual([
      { question: 'Prétentions salariales', variants: ['Salary expectations', 'Rémunération souhaitée'], choices: [], answer: '45 000 à 50 000 € bruts annuels, selon le périmètre.' },
      { question: 'Visa sponsorship', variants: [], choices: ['No', 'Non'], answer: "Je suis citoyen français :\naucun visa n'est nécessaire dans l'UE." },
      { question: 'Years of Salesforce', variants: [], choices: [], answer: '' },
    ]);
  });
  test('le libellé se compare sans accents, casse ni ponctuation, question ou variante', () => {
    expect(findAnswer(entries, 'SALARY EXPECTATIONS?')?.question).toBe('Prétentions salariales');
    expect(findAnswer(entries, 'pretentions salariales')?.question).toBe('Prétentions salariales');
    expect(findAnswer(entries, 'Salary')).toBeNull();
    expect(findAnswer(entries, '')).toBeNull();
  });
});

describe('freeTextProblems : une réponse libre vient mot pour mot d’une source permise', () => {
  const sources: AnswerSources = {
    candidate: { availability: 'Un mois de préavis', salary_expectation: '', languages: ['Français', 'Anglais'], answers: { 'Why us?': 'Because.' } },
    answers: parseAnswers(ANSWERS),
    profile: '## Mobilité\n- **Mobilité** : prêt à déménager à Lyon ou à Bordeaux.',
    pitch: '# Pitch\nBonjour, chez Acme j’ai monté le CRM de 0 à 40 000 contacts. Un appel cette semaine ?',
    letterText: null,
  };
  const field = (label: string, value: string, source: string, kind?: 'free_text' | 'choice') => ({ label, value, source, status: 'filled' as const, ...(kind ? { kind } : {}) });

  test('passent : le fichier validé, un extrait du profil, un fait de la fiche, le pitch pour une motivation', () => {
    expect(
      freeTextProblems(
        [
          field('Salary expectations', '45 000 à 50 000 €   bruts annuels, selon le périmètre.', 'reponses_formulaires:Prétentions salariales'),
          field('Are you willing to relocate?', 'prêt à déménager à Lyon ou à Bordeaux.', 'profil'),
          field('Notice period', 'un mois de préavis', 'candidate.availability'),
          field('Languages', 'Anglais, Français', 'candidate.languages', 'free_text'),
          field('Why Acme?', 'chez Acme j’ai monté le CRM de 0 à 40 000 contacts.', 'pitch'),
          field('Visa sponsorship', 'No', 'reponses_formulaires:Visa sponsorship', 'choice'),
          field('Full name', 'Jane Doe', 'candidate.name'),
        ],
        sources
      )
    ).toEqual([]);
  });

  test('échouent : une réponse composée, une réponse retouchée, answers de la fiche, un fait vide, un faux extrait', () => {
    const problems = freeTextProblems(
      [
        field('Why do you want to join?', 'I love your mission.', 'composed'),
        field('Salary expectations', '50 000 €', 'reponses_formulaires:Prétentions salariales'),
        field('Why us?', 'Because.', 'answers.Why us?'),
        field('Expected salary', '60k', 'candidate.salary_expectation'),
        field('Are you willing to relocate?', 'prêt à déménager à Paris demain.', 'profil'),
        field('Years with Salesforce (free text)', 'five years', 'reponses_formulaires:Years of Salesforce', 'free_text'),
        field('Notice period', 'Disponible immédiatement', 'candidate.availability'),
      ],
      sources
    );
    expect(problems).toHaveLength(7);
    expect(problems[0]).toContain('jamais une réponse composée');
    expect(problems[1]).toContain('diffère de la réponse validée « Prétentions salariales »');
    expect(problems[2]).toContain('les réponses composées de candidate.json (answers) ne valent pas');
    expect(problems[3]).toContain('candidate.salary_expectation est vide');
    expect(problems[4]).toContain("n'est pas un extrait mot pour mot du profil maître");
    expect(problems[5]).toContain('aucune réponse validée « Years of Salesforce »');
    expect(problems[6]).toContain('diffère de candidate.availability');
    for (const problem of problems) expect(problem).toContain('à remplir par Antoine');
  });

  test('le pitch ne répond pas à une question factuelle ; un extrait de profil trop court ne compte pas ; sans fichier, rien n’en vient', () => {
    expect(freeTextProblems([field('Salary expectations', 'chez Acme j’ai monté le CRM', 'pitch')], sources)[0]).toContain('question factuelle');
    expect(freeTextProblems([field('Relocation', 'Lyon', 'profil')], sources)[0]).toContain('au moins trois mots');
    expect(freeTextProblems([field('Salary', 'x', 'reponses_formulaires:Prétentions salariales')], { ...sources, answers: [] })[0]).toContain('absent ou vide');
    expect(freeTextProblems([field('Cover letter', 'Madame, Monsieur', 'lettre')], sources)[0]).toContain("pas de version texte");
  });

  test('une question ouverte : déclarée free_text, ou un champ de saisie au libellé de motivation ou de fait ; jamais une liste', () => {
    expect(isOpenQuestion({ label: 'Pourquoi nous rejoindre ?' })).toBe(true);
    expect(isOpenQuestion({ label: 'Do you require visa sponsorship?', kind: 'text' })).toBe(true);
    expect(isOpenQuestion({ label: 'Do you require visa sponsorship?', kind: 'choice' })).toBe(false);
    expect(isOpenQuestion({ label: 'Anything you want to add', kind: 'free_text' })).toBe(true);
    expect(isOpenQuestion({ label: 'LinkedIn Profile' })).toBe(false);
    expect(isOpenQuestion({ label: 'Email' })).toBe(false);
  });

  test('evaluatePrefill branche la règle quand les sources sont données', () => {
    const composed = { ...prefill, fields: [...prefill.fields, field('Why Acme?', 'I love your mission.', 'composed')] };
    expect(evaluatePrefill(composed, context).ok).toBe(true);
    expect(evaluatePrefill(composed, { ...context, sources }).ok).toBe(false);
  });
});

describe('la lettre de motivation (entrée letter)', () => {
  const letter = 'C:\\run\\application\\lettre.pdf';
  const cv = 'C:\\run\\application\\CV.pdf';
  const withLetter = (patch: Record<string, unknown>) => ({ ...prefill, attachments: [{ field: 'Resume/CV', file: cv, status: 'attached' }], ...patch });

  test('sans lettre : rien ne change (aucun problème, aucune ligne Lettre au récapitulatif)', () => {
    expect(letterProblems(prefill, '', '/x/CV.pdf')).toEqual([]);
    expect(evaluatePrefill(prefill, { ...context, letter: '', cv: '/x/CV.pdf' }).recap).not.toContain('Lettre');
  });

  test('champ de téléversement : la lettre jointe, le CV aussi, chacun à sa place', () => {
    const ok = withLetter({ cover_letter_field: 'upload', attachments: [{ field: 'Resume/CV', file: cv, status: 'attached' }, { field: 'Cover Letter', file: letter, status: 'attached' }] });
    expect(letterProblems(ok, letter, cv)).toEqual([]);
    expect(prefillRecap(ok, { letter })).toContain('Lettre (lettre.pdf) : jointe.');
    expect(letterProblems(withLetter({ cover_letter_field: 'upload' }), letter, cv)).toEqual(["la lettre (lettre.pdf) n'est pas jointe au champ de lettre de motivation"]);
    const swapped = withLetter({ cover_letter_field: 'upload', attachments: [{ field: 'Resume/CV', file: letter, status: 'attached' }] });
    expect(letterProblems(swapped, letter, cv)).toEqual(["le CV (CV.pdf) n'est pas joint : la lettre ne le remplace pas", 'la lettre est jointe au champ « Resume/CV », qui attend le CV']);
  });

  test('champ texte : la lettre (version texte) ou le pitch y est collé ; pas de champ : rien à joindre', () => {
    const pasted = withLetter({ cover_letter_field: 'text', fields: [...prefill.fields, { label: 'Cover letter', value: 'Madame…', source: 'lettre', status: 'filled' }] });
    expect(letterProblems(pasted, letter, cv)).toEqual([]);
    expect(prefillRecap(pasted, { letter })).toContain('collée dans « Cover letter »');
    expect(letterProblems(withLetter({ cover_letter_field: 'text' }), letter, cv)[0]).toContain('champ texte de lettre de motivation est vide');
    expect(letterProblems(withLetter({ cover_letter_field: 'none' }), letter, cv)).toEqual([]);
    expect(letterProblems(withLetter({}), letter, cv)[0]).toContain('cover_letter_field');
  });

  test('chemins Windows ou POSIX ; version texte = même nom en .md', () => {
    expect(fileName(letter)).toBe('lettre.pdf');
    expect(fileName('/a/b/CV.pdf')).toBe('CV.pdf');
    expect(letterTextPath('/run/application/lettre.pdf')).toBe('/run/application/lettre.md');
    expect(letterTextPath('')).toBe('');
  });
});

describe('prefillRecap', () => {
  test('dit la source de chaque réponse libre, et la réponse validée qui existe sous un autre libellé', () => {
    const recap = prefillRecap(
      {
        fields: [{ label: 'Salary', value: 'x', source: 'reponses_formulaires:Prétentions salariales', status: 'filled' }, { label: 'Why us?', value: 'x', source: 'pitch', status: 'filled' }],
        unanswered: [{ label: 'Rémunération souhaitée', reason: 'choice list', required: false }],
      },
      { answers: parseAnswers(ANSWERS) }
    );
    expect(recap).toBe(
      'Réponses libres : « Salary » ← reponses_formulaires.md « Prétentions salariales » ; « Why us? » ← pitch.\n' +
        'À remplir par Antoine : « Rémunération souhaitée » (réponse validée possible : reponses_formulaires.md « Prétentions salariales »).'
    );
  });
});

describe('evaluateReceipt', () => {
  const receipt = { submitted: true, clicked_at: '2026-10-18T14:00:00Z', final_url: 'https://jobs.lever.co/acme/1/thanks', confirmation_text: 'Thank you for applying!', page_excerpt: '…', screenshot: 'receipt.png', error: '' };
  test('prouve un envoi confirmé', () => {
    expect(evaluateReceipt(receipt, 'lever', true)).toEqual({ ok: true, problems: [], submitted: true, proven: true, confirmation: 'thank you for applying' });
  });
  test('un clic sans confirmation reconnue est envoyé mais non prouvé', () => {
    const result = evaluateReceipt({ ...receipt, confirmation_text: '', page_excerpt: 'Loading…' }, 'lever', true);
    expect(result).toMatchObject({ ok: false, submitted: true, proven: false, confirmation: '' });
    expect(result.problems).toEqual(['no recognised confirmation in confirmation_text or page_excerpt']);
  });
  test('une erreur de page ou un formulaire perdu ne prouvent rien', () => {
    expect(evaluateReceipt({ ...receipt, error: 'Email is required' }, 'lever', true).ok).toBe(false);
    expect(evaluateReceipt({ ...receipt, submitted: false, error: 'form lost before submit' }, 'lever', true).problems[0]).toBe('the form was not submitted: form lost before submit');
  });
  test('le clic sur un hôte autorisé est prouvé ; ailleurs, ou sans URL de clic, il ne l’est pas', () => {
    const hosts = hostPolicy('https://jobs.lever.co/acme/1', 'lever');
    expect(evaluateReceipt({ ...receipt, clicked_url: 'https://jobs.lever.co/acme/1/apply' }, 'lever', true, { hosts }).ok).toBe(true);
    expect(evaluateReceipt(receipt, 'lever', true, { hosts, clickUrl: 'https://jobs.lever.co/acme/1/apply' }).ok).toBe(true);
    const foreign = evaluateReceipt({ ...receipt, clicked_url: 'https://jobs.lever.co.evil.com/acme/1/apply' }, 'lever', true, { hosts });
    expect(foreign).toMatchObject({ ok: false, submitted: true, proven: false });
    expect(foreign.problems[0]).toStartWith("Le clic d'envoi (clicked_url de receipt.json) est sur « jobs.lever.co.evil.com »");
    expect(evaluateReceipt(receipt, 'lever', true, { hosts }).problems[0]).toStartWith('URL du clic inconnue');
  });
});
