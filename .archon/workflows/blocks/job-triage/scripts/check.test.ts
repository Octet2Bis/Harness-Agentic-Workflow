import { describe, expect, test } from 'bun:test';
import { evaluate } from './check.ts';

const criteria = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000 });
const posting = 'We are hiring a Sales Ops lead to run our go-to-market machine with the team. Fluent in English and Italian (written and spoken). Salary: 40.000€ gross per year.';
const extraction = JSON.stringify({
  languages: [
    { code: 'en', requirement: 'required', quote: 'Fluent in English' },
    { code: 'it', requirement: 'required', quote: 'Fluent in English and Italian' },
  ],
  not_required: [],
  salary: { min: 40000, max: 40000, currency: 'EUR', period: 'year', quote: 'Salary: 40.000€ gross per year' },
  salary_ignored: [],
  other_criteria: [],
  posting_language: { code: 'en', quote: 'We are hiring a Sales Ops lead to run our go-to-market machine with the team.' },
  work_mode: { value: 'not_stated', quote: '' },
  summary: 'Italien exigé.',
});

describe('job-triage check', () => {
  test('une extraction fidèle donne la décision de la règle', () => {
    const r = evaluate({ criteria, posting, extraction, out: 'triage.json', postingFull: true });
    expect(r.problems).toEqual([]);
    expect(r.decision?.decision).toBe('ecartee');
  });
  test('fichiers manquants ou illisibles', () => {
    expect(evaluate({ criteria, posting, extraction: null, out: 'triage.json', postingFull: true }).problems[0]).toContain('was not written');
    expect(evaluate({ criteria, posting, extraction: '{', out: 'triage.json', postingFull: true }).problems[0]).toContain('not valid JSON');
    expect(evaluate({ criteria, posting: '', extraction, out: 'triage.json', postingFull: true }).problems[0]).toContain('posting file');
    expect(evaluate({ criteria: '{}', posting, extraction, out: 'triage.json', postingFull: true }).problems[0]).toContain('criteres.json');
  });
  test('un poste hybride est écarté par la règle, même en anglais au bon salaire', () => {
    const hybridPosting = `${posting} Hybrid: 2 days per week in our Athens office.`;
    const hybrid = extraction.replace('{"value":"not_stated","quote":""}', '{"value":"hybrid","quote":"Hybrid: 2 days per week in our Athens office."}');
    const r = evaluate({ criteria, posting: hybridPosting, extraction: hybrid, out: 'triage.json', postingFull: true });
    expect(r.problems).toEqual([]);
    expect(r.decision?.reasons.join()).toContain('Poste non 100 % télétravail (hybride)');
    const claimed = evaluate({ criteria, posting: hybridPosting, extraction: extraction.replace('{"value":"not_stated","quote":""}', '{"value":"full_remote","quote":"Fluent in English"}'), out: 'triage.json', postingFull: true });
    expect(claimed.decision).toBeNull();
    expect(claimed.problems.join()).toContain('the posting says "hybrid"');
  });
  test('pas de décision tant qu’un problème reste', () => {
    const r = evaluate({ criteria, posting, extraction: extraction.replace('"it"', '"de"'), out: 'triage.json', postingFull: true });
    expect(r.decision).toBeNull();
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe('job-triage check : expérience', () => {
  const juniorCriteria = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, experience_max_annees: 3 });
  const seniorPosting = `${posting} Minimum 7 years of experience in Sales Operations.`;
  const withExperience = (exp: unknown): string => JSON.stringify({ ...JSON.parse(extraction), languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }], not_required: [{ code: 'it', quote: 'Fluent in English and Italian', why: 'test' }], experience: exp });
  test('7 ans exigés contre 3 au plus : écartée par la règle, avec la citation', () => {
    const r = evaluate({ criteria: juniorCriteria, posting: seniorPosting, extraction: withExperience({ years_min: 7, years_max: null, seniority_label: null, quote: 'Minimum 7 years of experience' }), out: 'triage.json', postingFull: true });
    expect(r.problems).toEqual([]);
    expect(r.decision?.reasons).toEqual(["Exige 7 ans d'expérience (max 3) : « Minimum 7 years of experience »"]);
  });
  test('l’agent qui n’a pas vu les 7 ans est renvoyé au travail', () => {
    const r = evaluate({ criteria: juniorCriteria, posting: seniorPosting, extraction: withExperience('not_stated'), out: 'triage.json', postingFull: true });
    expect(r.decision).toBeNull();
    expect(r.problems.join()).toContain('asks for years of experience');
  });
  test('l’intitulé de l’offre (INPUTS_OFFER) porte la règle des intitulés senior', () => {
    const r = evaluate({ criteria: juniorCriteria, posting, extraction: withExperience('not_stated'), out: 'triage.json', postingFull: true, offer: '{"company":"Acme","title":"Senior Sales Ops Lead"}' });
    expect(r.decision?.decision).toBe('ecartee');
    expect(r.decision?.reasons[0]).toContain('Intitulé de poste senior (« senior »');
    const old = evaluate({ criteria, posting, extraction, out: 'triage.json', postingFull: true, offer: '{"title":"Senior Sales Ops Lead"}' });
    expect(old.decision?.reasons).toEqual(["Exige l'italien : « Fluent in English and Italian »"]);
  });
});

describe('job-triage check : plateformes 100 % télétravail (INPUTS_OFFER.source)', () => {
  const english = JSON.stringify({ ...JSON.parse(extraction), languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }], not_required: [{ code: 'it', quote: 'Fluent in English and Italian', why: 'test' }] });
  test('Himalayas, annonce muette sur le lieu : retenue, « télétravail d’après la source » dans les raisons', () => {
    const r = evaluate({ criteria, posting, extraction: english, out: 'triage.json', postingFull: true, offer: '{"title":"Growth Marketing Manager","source":"Himalayas"}' });
    expect(r.problems).toEqual([]);
    expect(r.decision?.decision).toBe('retenue');
    expect(r.decision?.reasons.join(' ')).toContain("Télétravail d'après la source Himalayas");
  });
  test('la même offre venue d’Adzuna (pas une plateforme 100 % télétravail) reste à vérifier', () => {
    const r = evaluate({ criteria, posting, extraction: english, out: 'triage.json', postingFull: true, offer: '{"title":"Growth Marketing Manager","source":"Adzuna"}' });
    expect(r.decision?.decision).toBe('a_verifier');
    expect(r.decision?.reasons).toEqual(["Mode de travail non précisé dans l'annonce"]);
  });
  test('Jobicy et une mention hybride : l’agent doit la lire, et la règle écarte (le télétravail complet reste une règle dure)', () => {
    const hybridPosting = `${posting} Hybrid: 2 days per week in our Athens office.`;
    const silent = evaluate({ criteria, posting: hybridPosting, extraction: english, out: 'triage.json', postingFull: true, offer: '{"title":"CRM Manager","source":"Jobicy (jobicy.com)"}' });
    expect(silent.decision).toBeNull();
    expect(silent.problems.join()).toContain('in "hybrid: 2 days per week in our athens office."');
    const read = english.replace('{"value":"not_stated","quote":""}', '{"value":"hybrid","quote":"Hybrid: 2 days per week in our Athens office."}');
    const r = evaluate({ criteria, posting: hybridPosting, extraction: read, out: 'triage.json', postingFull: true, offer: '{"title":"CRM Manager","source":"Jobicy (jobicy.com)"}' });
    expect(r.decision?.decision).toBe('ecartee');
  });
});

describe('job-triage check : âge de l’offre (offre_age_max_jours, 7 jours par défaut)', () => {
  const english = JSON.stringify({ ...JSON.parse(extraction), languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }], not_required: [{ code: 'it', quote: 'Fluent in English and Italian', why: 'test' }] });
  const now = new Date('2026-10-23T20:00:00Z');
  const run = (offer: Record<string, unknown>, crit = criteria) => evaluate({ criteria: crit, posting, extraction: english, out: 'triage.json', postingFull: true, offer: JSON.stringify({ title: 'Sales Ops', ...offer }), now });
  test('publiée il y a plus de 7 jours (ligne du tableau) : écartée, la raison dit la date et N', () => {
    const r = run({ date_published: '2026-10-12' });
    expect(r.problems).toEqual([]);
    expect(r.decision?.decision).toBe('ecartee');
    expect(r.decision?.reasons).toEqual(['offre trop ancienne (publiée le 2026-10-12, > 7 jours)']);
  });
  test('dans la limite : la règle ne change rien, la date passe en note ; sans date lisible : aucun effet', () => {
    const fresh = run({ date_published: '2026-10-20' });
    const none = run({});
    const unreadable = run({ date_published: 'récent' });
    expect(fresh.decision?.decision).toBe(none.decision?.decision as string);
    expect(fresh.decision?.notes).toContain('Publiée le 2026-10-20 (3 jours, max 7)');
    expect(none.decision?.reasons).toEqual(unreadable.decision?.reasons as string[]);
    expect(none.decision?.notes.join()).not.toContain('Publiée');
  });
  test('N de criteres.json ; 0 coupe la règle ; date relative comptée depuis la lecture du radar', () => {
    const strict = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, offre_age_max_jours: 2 });
    expect(run({ date_published: '2026-10-20' }, strict).decision?.reasons).toEqual(['offre trop ancienne (publiée le 2026-10-20, > 2 jours)']);
    const off = JSON.stringify({ langues: ['fr', 'en'], salaire_min_annuel: 35000, offre_age_max_jours: 0 });
    expect(run({ date_published: '2020-01-01' }, off).decision?.reasons.join()).not.toContain('trop ancienne');
    expect(run({ date_published: 'il y a 3 jours', radar_at: '2026-10-12T08:00:00Z' }).decision?.reasons).toEqual(['offre trop ancienne (publiée le 2026-10-09, > 7 jours)']);
    expect(run({ date_published: 'il y a 3 jours' }).decision?.reasons.join()).not.toContain('trop ancienne');
  });
});

describe('job-triage check : cœur du poste contre le profil (INPUTS_PROFILE)', () => {
  const growthPosting = `${posting} You will run high-volume paid acquisition on Meta, TikTok and Snapchat. Strong SQL and Python skills. You will own our lifecycle emails.`;
  const profile = '## Expériences\n- **CRM** : refonte des emails de lifecycle pour 120 000 clients.\n- Réseaux sociaux organiques.';
  const english = (core: unknown): string => JSON.stringify({ ...JSON.parse(extraction), languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }], not_required: [{ code: 'it', quote: 'Fluent in English and Italian', why: 'test' }], core_requirements: core });
  const misfit = [
    { requirement: 'Achat média payant à gros volume', quote: 'You will run high-volume paid acquisition on Meta, TikTok and Snapchat.', backing: 'missing', profile_quote: '' },
    { requirement: 'SQL et Python', quote: 'Strong SQL and Python skills.', backing: 'missing', profile_quote: '' },
    { requirement: 'Emails de lifecycle', quote: 'You will own our lifecycle emails.', backing: 'backed', profile_quote: 'CRM : refonte des emails de lifecycle' },
  ];
  test('deux exigences centrales absentes du profil : écartée avant toute rédaction de CV', () => {
    const r = evaluate({ criteria, posting: growthPosting, extraction: english(misfit), out: 'triage.json', postingFull: true, profile });
    expect(r.problems).toEqual([]);
    expect(r.decision?.decision).toBe('ecartee');
    expect(r.decision?.reasons).toEqual(['Cœur du poste hors profil : Achat média payant à gros volume ; SQL et Python']);
  });
  test('un appui que le profil ne porte pas renvoie l’agent au travail', () => {
    const invented = misfit.map((c, i) => (i === 0 ? { ...c, backing: 'backed', profile_quote: 'Achat média TikTok à grande échelle' } : c));
    const r = evaluate({ criteria, posting: growthPosting, extraction: english(invented), out: 'triage.json', postingFull: true, profile });
    expect(r.decision).toBeNull();
    expect(r.problems.join()).toContain('not in the candidate profile verbatim');
  });
  test('profil donné mais clé absente : renvoyé ; sans profil : non évalué, la note le dit', () => {
    expect(evaluate({ criteria, posting: growthPosting, extraction: english(undefined), out: 'triage.json', postingFull: true, profile }).problems.join()).toContain('"core_requirements" is missing');
    const none = evaluate({ criteria, posting: growthPosting, extraction: english([]), out: 'triage.json', postingFull: true });
    expect(none.problems).toEqual([]);
    expect(none.decision?.notes).toContain('Adéquation au cœur du poste non évaluée : profil du candidat non fourni');
  });
});
