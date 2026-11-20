import { describe, expect, test } from 'bun:test';
import {
  type CoreRequirement,
  type Criteria,
  DEFAULT_SENIORITY_LABELS,
  EXPERIENCE_NOT_STATED,
  type Extraction,
  checkCoreFit,
  checkExtraction,
  decideTriage,
  detectLanguage,
  detectWorkMode,
  markerSentence,
  normalize,
  normalizeProfile,
  officePeriodMarkers,
  offerPublished,
  offerSource,
  offerTitle,
  postingBody,
  quoteNumbers,
  quoteYears,
  readCriteria,
  readExtraction,
  remoteOnlySource,
  scanExperienceYears,
  scanLanguageMentions,
  scanSalaryAmounts,
  seniorityLabelsIn,
} from './triage-checks.ts';

const SMARTNESS = `About The Company At Smartness, we are building the future of hospitality tech. Backed by top international investors and named one of Italy's Top 10 LinkedIn Startups.
What We Are Looking For
2+ years of experience in Sales Operations or Revenue Operations.
Fluent in English and Italian (written and spoken).
Experience with HubSpot is a plus.
What We Offer
Remote-friendly culture and a gross annual salary between 38.000€ and 45.000€.
This role is fully remote: work from anywhere in Europe.`;

const criteria: Criteria = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000 }).criteria as Criteria;

function extraction(over: Partial<Extraction> = {}): Extraction {
  return {
    languages: [
      { code: 'en', requirement: 'required', quote: 'Fluent in English and Italian' },
      { code: 'it', requirement: 'required', quote: 'Fluent in English and Italian (written and spoken)' },
    ],
    not_required: [],
    salary: { min: 38000, max: 45000, currency: 'EUR', period: 'year', quote: 'a gross annual salary between 38.000€ and 45.000€' },
    salary_ignored: [],
    other_criteria: [],
    posting_language: { code: 'en', quote: 'Remote-friendly culture and a gross annual salary between 38.000€ and 45.000€.' },
    work_mode: { value: 'full_remote', quote: 'This role is fully remote: work from anywhere in Europe.' },
    experience: { years_min: 2, years_max: null, seniority_label: null, quote: '2+ years of experience in Sales Operations', ignored: [] },
    summary: 'Sales Ops chez Smartness, anglais et italien courants exigés.',
    ...over,
  };
}

describe('criteres.json', () => {
  test('lit les langues, le seuil et la politique du salaire inconnu', () => {
    expect(criteria.langues).toEqual(['fr', 'en']);
    expect(criteria.salaire_min_annuel).toBe(35000);
    expect(criteria.salaire_inconnu).toBe('a_verifier');
    expect(criteria.taux_eur.USD).toBeGreaterThan(0);
  });
  test('refuse des critères incomplets ou mal formés', () => {
    expect(readCriteria({ langues: ['français'], salaire_min_annuel: 35000 }).criteria).toBeNull();
    expect(readCriteria({ langues: ['fr'] }).problems.join()).toContain('salaire_min_annuel');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 1, salaire_inconnu: 'peut-être' }).criteria).toBeNull();
    expect(readCriteria([]).criteria).toBeNull();
  });
  test('taux, remote et exclusions', () => {
    const c = readCriteria({ langues: ['fr'], salaire_min_annuel: 0, taux_eur: { usd: 0.9 }, remote: 'hybride_ok', exclure: ['call center'] }).criteria as Criteria;
    expect(c.taux_eur.USD).toBe(0.9);
    expect(c.remote).toBe('hybride_ok');
    expect(c.autres).toEqual(['exclure: call center']);
  });
  test('remote : full par défaut, trois valeurs admises', () => {
    expect(criteria.remote).toBe('full');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, remote: 'indifferent' }).criteria?.remote).toBe('indifferent');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, remote: 'oui' }).problems.join()).toContain('"remote" must be');
  });
});

describe('balayage de l’annonce', () => {
  test('trouve l’italien exigé, pas « Italy » seul', () => {
    const codes = scanLanguageMentions(SMARTNESS).map((m) => m.code).sort();
    expect(codes).toEqual(['en', 'it']);
    expect(scanLanguageMentions("named one of Italy's Top 10 startups")).toEqual([]);
  });
  test('reconnaît les langues écrites dans d’autres langues et les niveaux', () => {
    expect(scanLanguageMentions('Richiesta conoscenza ottima della lingua tedesca e inglese madrelingua').map((m) => m.code).sort()).toEqual(['de', 'en']);
    expect(scanLanguageMentions('Allemand courant exigé').map((m) => m.code)).toEqual(['de']);
    expect(scanLanguageMentions('Spanish (C1)').map((m) => m.code)).toEqual(['es']);
  });
  test('« polish » verbe n’est pas le polonais', () => {
    expect(scanLanguageMentions('You must polish our onboarding docs')).toEqual([]);
    expect(scanLanguageMentions('Fluent Polish is required').map((m) => m.code)).toEqual(['pl']);
  });
  test('repère les montants avec devise', () => {
    expect(scanSalaryAmounts(SMARTNESS).length).toBe(1);
    expect(scanSalaryAmounts('Salary: $30,000 - $35,000 per year')[0]).toContain('30,000');
    expect(scanSalaryAmounts('boost revenues by 30%+ and billions of euros in bookings')).toEqual([]);
  });
  test('lit les nombres d’une citation de salaire', () => {
    expect(quoteNumbers('38.000€ and 45.000€')).toEqual([38000, 45000]);
    expect(quoteNumbers('38 - 50k€')).toEqual(expect.arrayContaining([38000, 50000]));
    expect(quoteNumbers('£42,500 per annum')).toEqual([42500]);
    expect(quoteNumbers('2 800,50 € par mois')).toEqual([2800.5]);
  });
  test('normalise accents, guillemets et espaces', () => {
    expect(normalize('Maîtrise  de l’anglais')).toBe("maitrise de l'anglais");
  });
});

describe('extraction', () => {
  test('lit une extraction complète', () => {
    const { extraction: e, problems } = readExtraction(JSON.parse(JSON.stringify(extraction())));
    expect(problems).toEqual([]);
    expect(e?.salary?.period).toBe('year');
  });
  test('signale les champs manquants ou faux', () => {
    const { problems } = readExtraction({ languages: [{ code: 'italian', requirement: 'must' }], not_required: [], salary_ignored: [], other_criteria: [], summary: '' });
    expect(problems.join('\n')).toContain('ISO 639-1');
    expect(problems.join('\n')).toContain('"required" or "preferred"');
    expect(problems.join('\n')).toContain('"salary" is missing');
    expect(problems.join('\n')).toContain('"summary" is empty');
    expect(readExtraction({ ...extraction(), salary: { min: 5, max: 3, currency: 'EUR', period: 'year', quote: 'x' } }).problems.join()).toContain('greater');
  });
  test('l’extraction fidèle passe', () => {
    expect(checkExtraction(extraction(), SMARTNESS, criteria)).toEqual([]);
  });
  test('une langue oubliée est rattrapée par le balayage', () => {
    const problems = checkExtraction(extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }] }), SMARTNESS, criteria);
    expect(problems.join('\n')).toContain('mentions Italian');
  });
  test('une langue écartée avec sa raison est acceptée', () => {
    const e = extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English' }], not_required: [{ code: 'it', quote: 'Fluent in English and Italian', why: 'test' }] });
    expect(checkExtraction(e, SMARTNESS, criteria)).toEqual([]);
  });
  test('une citation inventée est refusée', () => {
    const e = extraction({ languages: [{ code: 'it', requirement: 'required', quote: 'Italian native speaker mandatory' }] });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('not in the posting verbatim');
  });
  test('une citation qui ne nomme pas la langue est refusée', () => {
    const e = extraction({ languages: [...extraction().languages, { code: 'de', requirement: 'required', quote: 'written and spoken' }] });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('does not name de');
  });
  test('un montant absent de la citation est refusé', () => {
    const e = extraction({ salary: { min: 48000, max: 45000, currency: 'EUR', period: 'year', quote: 'between 38.000€ and 45.000€' } });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('salary.min = 48000');
  });
  test('un salaire dit absent alors que l’annonce chiffre est refusé, sauf montant écarté', () => {
    expect(checkExtraction(extraction({ salary: null }), SMARTNESS, criteria).join('\n')).toContain('"salary" is null');
    const ignored = extraction({ salary: null, salary_ignored: [{ quote: 'between 38.000€ and 45.000€', why: 'test' }] });
    expect(checkExtraction(ignored, SMARTNESS, criteria)).toEqual([]);
  });
  test('une devise sans taux est signalée', () => {
    const posting = 'Pay: 9000 XYZ per month, fluent English';
    const e = extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'fluent English' }], salary: { min: 9000, max: 9000, currency: 'XYZ', period: 'month', quote: '9000 XYZ per month' } });
    expect(checkExtraction(e, posting, criteria).join('\n')).toContain('no conversion rate');
  });
  test('un critère libre tranché sans citation est refusé', () => {
    const e = extraction({ other_criteria: [{ criterion: 'remote: full', met: false, quote: '', note: 'bureau' }] });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('without a quote');
  });
});

describe('décision', () => {
  test('Smartness : l’italien exigé écarte l’offre', () => {
    const d = decideTriage(extraction(), criteria, true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain("Exige l'italien");
    expect(d.languages_required).toEqual(['en', 'it']);
  });
  test('l’italien en plus ne fait qu’une note', () => {
    const d = decideTriage(extraction({ languages: [{ code: 'it', requirement: 'preferred', quote: 'Italian is a plus' }] }), criteria, true);
    expect(d.decision).toBe('retenue');
    expect(d.notes.join()).toContain('un plus');
  });
  test('salaire sous le seuil : écartée ; converti du mensuel et du dollar', () => {
    const low = decideTriage(extraction({ languages: [], salary: { min: 30000, max: 35000, currency: 'USD', period: 'year', quote: 'q' } }), criteria, true);
    expect(low.decision).toBe('ecartee');
    expect(low.salary_annual_eur?.max).toBe(32200);
    const monthly = decideTriage(extraction({ languages: [], salary: { min: 3000, max: 3200, currency: 'EUR', period: 'month', quote: 'q' } }), criteria, true);
    expect(monthly.decision).toBe('retenue');
    expect(monthly.salary_annual_eur).toEqual({ min: 36000, max: 38400 });
    const hourly = decideTriage(extraction({ languages: [], salary: { min: 7, max: 7, currency: 'USD', period: 'hour', quote: 'q' } }), criteria, true);
    expect(hourly.decision).toBe('ecartee');
  });
  test('le haut de la fourchette décide : 30–40 k€ reste', () => {
    expect(decideTriage(extraction({ languages: [], salary: { min: 30000, max: 40000, currency: 'EUR', period: 'year', quote: 'q' } }), criteria, true).decision).toBe('retenue');
  });
  test('« à partir de » sous le seuil : à vérifier', () => {
    expect(decideTriage(extraction({ languages: [], salary: { min: 30000, max: null, currency: 'EUR', period: 'year', quote: 'q' } }), criteria, true).decision).toBe('a_verifier');
  });
  test('salaire absent : selon salaire_inconnu', () => {
    const e = extraction({ languages: [], salary: null });
    expect(decideTriage(e, criteria, true).decision).toBe('a_verifier');
    expect(decideTriage(e, { ...criteria, salaire_inconnu: 'garder' }, true).decision).toBe('retenue');
    expect(decideTriage(e, { ...criteria, salaire_inconnu: 'ecarter' }, true).decision).toBe('ecartee');
  });
  test('annonce lue en partie : jamais retenue, mais une exigence lue écarte quand même', () => {
    expect(decideTriage(extraction({ languages: [] }), criteria, false).decision).toBe('a_verifier');
    expect(decideTriage(extraction(), criteria, false).decision).toBe('ecartee');
  });
  test('un critère libre non rempli laisse à vérifier', () => {
    const d = decideTriage(extraction({ languages: [], other_criteria: [{ criterion: 'remote: full', met: false, quote: 'Hybrid, 3 days in Lisbon', note: 'hybride' }] }), criteria, true);
    expect(d.decision).toBe('a_verifier');
    expect(d.reasons[0]).toContain('hybride');
  });
  test('seuil 0 : la règle du salaire est désactivée', () => {
    expect(decideTriage(extraction({ languages: [], salary: { min: 10, max: 10, currency: 'EUR', period: 'year', quote: 'q' } }), { ...criteria, salaire_min_annuel: 0 }, true).decision).toBe('retenue');
  });
});

const ITALIAN = `Chi siamo: siamo una startup che aiuta gli hotel e le strutture ricettive a crescere. Il nostro team è giovane e lavora con passione per i clienti.
Cosa farai: gestirai il processo di vendita con il team commerciale e con il team marketing, per una crescita che sia sostenibile.
Requisiti: almeno due anni di esperienza nel ruolo, ottima conoscenza della lingua inglese; sono richieste capacità di analisi e anche di organizzazione.
Cosa offriamo: una retribuzione competitiva, il lavoro da remoto per tutta la settimana, e un ambiente dove le idee del team sono ascoltate. Ti aspettiamo nel nostro team per una nuova avventura che sia per te una crescita, con il supporto della direzione e degli altri colleghi della sede, che sono con te per ogni domanda e anche per la formazione nel primo mese.`;

const ENGLISH = Array.from({ length: 6 }, () => 'You will own the sales process with our team and you will work with the founders. This role is for you if you have experience with HubSpot and you want to grow with us.').join(' ');

describe('langue de l’annonce', () => {
  test('reconnaît une annonce en italien, en anglais, et refuse de trancher sur un texte court', () => {
    expect(detectLanguage(ITALIAN)?.code).toBe('it');
    expect(detectLanguage(ENGLISH)?.code).toBe('en');
    expect(detectLanguage('Fluent in English and Italian')).toBeNull();
  });
  test('l’habillage de la page (menus en portugais) ne l’emporte pas sur une description en anglais', () => {
    expect(detectLanguage(`Candidatar-se Entrar Vagas semelhantes Pesquisar empregos ${ENGLISH} Mostrar mais Ver mais vagas`)?.code).toBe('en');
  });
  test('les champs du radar ne comptent pas', () => {
    expect(postingBody('texte\n\n--- Champs du radar (pas l’annonce) ---\nLieu : Italie')).toBe('texte\n\n');
  });
  test('une annonce en italien est écartée, même sans langue exigée', () => {
    const e = extraction({ languages: [], posting_language: { code: 'it', quote: 'Il nostro team è giovane e lavora con passione per i clienti.' } });
    expect(checkExtraction(e, ITALIAN, criteria).filter((p) => p.includes('posting_language'))).toEqual([]);
    const d = decideTriage(e, criteria, true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain('Annonce rédigée en italien');
  });
  test('l’agent qui dit « anglais » pour une annonce italienne est renvoyé au travail', () => {
    const e = extraction({ posting_language: { code: 'en', quote: 'Il nostro team è giovane e lavora con passione per i clienti.' } });
    expect(checkExtraction(e, ITALIAN, criteria).join('\n')).toContain('reads as it');
  });
  test('la langue de l’annonce est obligatoire, avec une vraie phrase', () => {
    const raw = JSON.parse(JSON.stringify(extraction())) as Record<string, unknown>;
    delete raw.posting_language;
    expect(readExtraction(raw).problems.join()).toContain('posting_language');
    const short = extraction({ posting_language: { code: 'en', quote: 'Fluent in English' } });
    expect(checkExtraction(short, SMARTNESS, criteria).join('\n')).toContain('60 characters');
  });
});

const HYBRID = `Join our growth team in Athens. You will run paid campaigns across Meta and Google with the marketing team.
Hybrid: 3 days per week in our Athens office, the rest from home.
Fluent English is required. Salary between 28.000€ and 32.000€ gross per year.`;

describe('mode de travail', () => {
  test('le balayage trouve hybride et sur site, en anglais et en français, accents mis à part', () => {
    expect(detectWorkMode(HYBRID).on_site[0]).toBe('hybrid');
    expect(detectWorkMode(HYBRID).remote).toEqual([]);
    expect(detectWorkMode('Poste en présentiel à Neo Psychiko, 2 jours par semaine au bureau.').on_site).toEqual(['présentiel', 'jours par semaine', 'au bureau']);
    expect(detectWorkMode('Ce poste est 100 % télétravail.').remote).toEqual(['100 % télétravail']);
  });
  test('« remote-first, office optional » reste du télétravail : « office » seul ne compte pas', () => {
    const m = detectWorkMode('We are remote-first, office optional: come to the Lisbon office when you like.');
    expect(m.on_site).toEqual([]);
    expect(m.remote).toEqual(['remote-first']);
    expect(detectWorkMode('Our hybrids love the monsite platform').on_site).toEqual([]);
  });
  test('les champs du radar ne comptent pas', () => {
    expect(detectWorkMode('A role for you.\n\n--- Champs du radar (pas l’annonce) ---\nMode : hybrid').on_site).toEqual([]);
  });
  test('la citation du mode de travail doit être dans l’annonce', () => {
    const e = extraction({ work_mode: { value: 'full_remote', quote: 'This role is 100% remote forever' } });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('work_mode: the quote');
    const stated = extraction({ work_mode: { value: 'not_stated', quote: '' } });
    expect(checkExtraction(stated, 'Fluent in English and Italian (written and spoken). Salary between 38.000€ and 45.000€. ' + SMARTNESS.split('\n').slice(0, 1).join(''), criteria).filter((p) => p.includes('work_mode'))).toEqual([]);
  });
  test('« full_remote » contre un marqueur hybride est renvoyé au travail, en nommant le marqueur', () => {
    const e = extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'Fluent English is required' }], salary: { min: 28000, max: 32000, currency: 'EUR', period: 'year', quote: 'between 28.000€ and 32.000€' }, posting_language: { code: 'en', quote: 'You will run paid campaigns across Meta and Google with the marketing team.' }, work_mode: { value: 'full_remote', quote: 'the rest from home' }, experience: { ...EXPERIENCE_NOT_STATED } });
    expect(checkExtraction(e, HYBRID, criteria).join('\n')).toContain('the posting says "hybrid"');
    const honest = { ...e, work_mode: { value: 'hybrid' as const, quote: 'Hybrid: 3 days per week in our Athens office' } };
    expect(checkExtraction(honest, HYBRID, criteria)).toEqual([]);
  });
  test('« not_stated » alors que l’annonce en parle est refusé', () => {
    const e = extraction({ work_mode: { value: 'not_stated', quote: '' } });
    expect(checkExtraction(e, SMARTNESS, criteria).join('\n')).toContain('work_mode is "not_stated" but the posting says "fully remote"');
  });
  test('faux positif évité : remote-first avec un bureau optionnel reste full_remote', () => {
    const posting = 'We are remote-first, office optional. Fluent in English and Italian (written and spoken). Remote-friendly culture and a gross annual salary between 38.000€ and 45.000€.';
    const e = extraction({ work_mode: { value: 'full_remote', quote: 'We are remote-first, office optional.' } });
    expect(checkExtraction(e, posting, criteria).filter((p) => p.includes('work_mode'))).toEqual([]);
  });
  test('work_mode est obligatoire, avec une citation sauf not_stated', () => {
    const raw = JSON.parse(JSON.stringify(extraction())) as Record<string, unknown>;
    delete raw.work_mode;
    expect(readExtraction(raw).problems.join()).toContain('"work_mode" must be');
    expect(readExtraction({ ...raw, work_mode: { value: 'remote', quote: 'x' } }).problems.join()).toContain('"work_mode" must be');
    expect(readExtraction({ ...raw, work_mode: { value: 'hybrid', quote: '' } }).problems.join()).toContain('work_mode is "hybrid" without a quote');
    expect(readExtraction({ ...raw, work_mode: { value: 'not_stated', quote: '' } }).problems).toEqual([]);
  });
  test('critère full (défaut) : hybride et sur site écartent, non précisé laisse à vérifier, télétravail complet retient', () => {
    const base = { languages: [] as Extraction['languages'] };
    const hybrid = decideTriage(extraction({ ...base, work_mode: { value: 'hybrid', quote: 'Hybrid: 3 days per week in our Athens office' } }), criteria, true);
    expect(hybrid.decision).toBe('ecartee');
    expect(hybrid.reasons[0]).toBe('Poste non 100 % télétravail (hybride) : « Hybrid: 3 days per week in our Athens office »');
    const onSite = decideTriage(extraction({ ...base, work_mode: { value: 'on_site', quote: 'Location: Neo Psychiko, on site' } }), criteria, true);
    expect(onSite.decision).toBe('ecartee');
    expect(onSite.reasons[0]).toContain('(sur site)');
    const notStated = decideTriage(extraction({ ...base, work_mode: { value: 'not_stated', quote: '' } }), criteria, true);
    expect(notStated.decision).toBe('a_verifier');
    expect(notStated.reasons).toEqual(["Mode de travail non précisé dans l'annonce"]);
    const remote = decideTriage(extraction(base), criteria, true);
    expect(remote.decision).toBe('retenue');
    expect(remote.notes.join()).toContain('Télétravail complet');
  });
  test('hybride_ok : seul le sur site écarte ; indifferent : aucune règle', () => {
    const hybrid = extraction({ languages: [], work_mode: { value: 'hybrid', quote: 'q' } });
    const onSite = extraction({ languages: [], work_mode: { value: 'on_site', quote: 'q' } });
    const notStated = extraction({ languages: [], work_mode: { value: 'not_stated', quote: '' } });
    expect(decideTriage(hybrid, { ...criteria, remote: 'hybride_ok' }, true).decision).toBe('retenue');
    expect(decideTriage(onSite, { ...criteria, remote: 'hybride_ok' }, true).decision).toBe('ecartee');
    expect(decideTriage(notStated, { ...criteria, remote: 'hybride_ok' }, true).decision).toBe('a_verifier');
    expect(decideTriage(onSite, { ...criteria, remote: 'indifferent' }, true).decision).toBe('retenue');
    expect(decideTriage(notStated, { ...criteria, remote: 'indifferent' }, true).decision).toBe('retenue');
  });
  test('la règle du télétravail s’ajoute aux autres : italien exigé et hybride donnent deux raisons', () => {
    const d = decideTriage(extraction({ work_mode: { value: 'hybrid', quote: 'q' } }), criteria, true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.length).toBe(2);
    expect(d.reasons[1]).toContain('Poste non 100 % télétravail');
  });
});

const INQOM = `Inqom est une fintech qui automatise la comptabilité des cabinets. Fondée en 2024, l'équipe compte 80 personnes et 7 ans d'existence de la marque.
Nous recherchons un Product Marketing Manager pour nos outils du cabinet. Vous reportez à une senior manager de l'équipe produit.
Profil recherché : profil senior. Minimum 7 ans d'expérience en Product Marketing, idéalement en SaaS B2B.
Nous avons 10 ans d'expérience du marché expert-comptable. Contact : +33 6 12 34 56 78.
Rémunération : 60 000 € à 68 000 € brut par an. Poste en 100 % télétravail. Anglais courant exigé.`;

const junior: Criteria = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, experience_max_annees: 3 }).criteria as Criteria;

function inqom(over: Partial<Extraction> = {}): Extraction {
  return extraction({
    languages: [{ code: 'en', requirement: 'required', quote: 'Anglais courant exigé' }],
    salary: { min: 60000, max: 68000, currency: 'EUR', period: 'year', quote: '60 000 € à 68 000 € brut par an' },
    posting_language: { code: 'fr', quote: 'Nous recherchons un Product Marketing Manager pour nos outils du cabinet.' },
    work_mode: { value: 'full_remote', quote: 'Poste en 100 % télétravail' },
    experience: { years_min: 7, years_max: null, seniority_label: 'senior', quote: 'profil senior. Minimum 7 ans d\'expérience en Product Marketing', ignored: [{ quote: "Nous avons 10 ans d'expérience du marché", why: "l'entreprise parle d'elle" }] },
    summary: 'PMM senior chez Inqom, 7 ans exigés.',
    ...over,
  });
}

describe('expérience : criteres.json', () => {
  test('absent : règle coupée, aucun label ; donné : labels par défaut, remplaçables', () => {
    expect(criteria.experience_max_annees).toBe(0);
    expect(criteria.experience_labels_exclus).toEqual([]);
    expect(junior.experience_max_annees).toBe(3);
    expect(junior.experience_labels_exclus).toEqual(DEFAULT_SENIORITY_LABELS);
    const custom = readCriteria({ langues: ['fr'], salaire_min_annuel: 0, experience_max_annees: 5, experience_labels_exclus: ['Head of', 'VP'] }).criteria as Criteria;
    expect(custom.experience_labels_exclus).toEqual(['head of', 'vp']);
    const labelsOnly = readCriteria({ langues: ['fr'], salaire_min_annuel: 0, experience_labels_exclus: ['senior'] }).criteria as Criteria;
    expect(labelsOnly.experience_max_annees).toBe(0);
    expect(labelsOnly.experience_labels_exclus).toEqual(['senior']);
  });
  test('refuse un maximum non entier ou des labels mal formés', () => {
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, experience_max_annees: '3' }).problems.join()).toContain('experience_max_annees');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, experience_max_annees: 2.5 }).criteria).toBeNull();
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, experience_max_annees: 3, experience_labels_exclus: 'senior' }).problems.join()).toContain('experience_labels_exclus');
  });
});

describe('expérience : balayage', () => {
  test('formes françaises et anglaises, fourchettes par la borne basse, plafonds', () => {
    const years = (s: string): [number | null, number | null][] => scanExperienceYears(s).map((m) => [m.years_min, m.years_max]);
    expect(years("Minimum 7 ans d'expérience en Product Marketing")).toEqual([[7, null]]);
    expect(years('minimum 5 years')).toEqual([[5, null]]);
    expect(years('5+ years in B2B SaaS')).toEqual([[5, null]]);
    expect(years('3 à 5 ans d’expérience')).toEqual([[3, 5]]);
    expect(years("at least 4 years' experience")).toEqual([[4, null]]);
    expect(years('3-5 years of relevant professional experience')).toEqual([[3, 5]]);
    expect(years('Expérience de 5 ans dans un poste similaire')).toEqual([[5, null]]);
    expect(years('Vous justifiez de cinq ans d’expérience')).toEqual([[5, null]]);
    expect(years('Two years of experience')).toEqual([[2, null]]);
    expect(years("jusqu'à 3 ans d'expérience")).toEqual([[null, 3]]);
    expect(years('2 ans d’expérience minimum')).toEqual([[2, null]]);
  });
  test('faux positifs : existence de l’entreprise, année, téléphone, l’entreprise parle d’elle, durée de contrat', () => {
    for (const s of ["7 ans d'existence de l'entreprise", 'Fondée en 2024, Inqom compte 80 personnes', 'Tel : +33 6 12 34 56 78', 'Nous avons 10 ans d’expérience du marché', 'Depuis 12 ans, nous accompagnons les cabinets', 'CDD de 2 ans', 'après 1 an d’ancienneté']) {
      expect(scanExperienceYears(s)).toEqual([]);
    }
  });
  test('les champs du radar ne comptent pas ; une même exigence répétée ne compte qu’une fois', () => {
    expect(scanExperienceYears('Rien.\n\n--- Champs du radar (pas l’annonce) ---\nSalaire : 38k€ (3 ans d’expérience)')).toEqual([]);
    expect(scanExperienceYears("5 ans d'expérience. Encore : 5 years of experience.").length).toBe(1);
  });
  test('les années d’une citation : chiffres et nombres en lettres', () => {
    expect(quoteYears('Minimum 7 ans d’expérience')).toEqual([7]);
    expect(quoteYears('cinq ans')).toEqual([5]);
    expect(quoteYears('between 3 and 5 years')).toEqual([3, 5]);
    expect(quoteYears('Fondée en 2024')).toEqual([]);
  });
  test('labels dans l’intitulé : mots entiers, « lead generation » et « staff accountant » exclus', () => {
    expect(seniorityLabelsIn('Senior Product Marketing Manager', DEFAULT_SENIORITY_LABELS)).toEqual(['senior']);
    expect(seniorityLabelsIn('Lead Generation Specialist', DEFAULT_SENIORITY_LABELS)).toEqual([]);
    expect(seniorityLabelsIn('Product Marketing Lead', DEFAULT_SENIORITY_LABELS)).toEqual(['lead']);
    expect(seniorityLabelsIn('Head of Growth', DEFAULT_SENIORITY_LABELS)).toEqual(['head of']);
    expect(seniorityLabelsIn('Staff Accountant', DEFAULT_SENIORITY_LABELS)).toEqual([]);
    expect(seniorityLabelsIn('Growth Marketing Manager (seniority: mid)', DEFAULT_SENIORITY_LABELS)).toEqual([]);
    expect(seniorityLabelsIn('Directrice Marketing', DEFAULT_SENIORITY_LABELS)).toEqual(['directrice']);
  });
  test('l’intitulé vient de l’offre, sinon des champs du radar', () => {
    expect(offerTitle('{"title":"Senior PMM"}', 'x\n--- Champs du radar ---\nPoste : Autre')).toBe('Senior PMM');
    expect(offerTitle('', 'x\n\n--- Champs du radar (pas l’annonce) ---\nEntreprise : Inqom\nPoste : Product Marketing Manager\nLieu : Paris')).toBe('Product Marketing Manager');
    expect(offerTitle('pas du json', 'Poste : dans le corps, pas les champs')).toBe('');
  });
});

describe('expérience : extraction', () => {
  test('lecture : entiers ou null, citation obligatoire dès qu’un fait est déclaré, « not_stated » accepté', () => {
    const raw = JSON.parse(JSON.stringify(inqom())) as Record<string, unknown>;
    expect(readExtraction(raw).problems).toEqual([]);
    expect(readExtraction({ ...raw, experience: 'not_stated' }).extraction?.experience).toEqual(EXPERIENCE_NOT_STATED);
    expect(readExtraction({ ...raw, experience: null }).extraction?.experience).toEqual(EXPERIENCE_NOT_STATED);
    delete raw.experience;
    expect(readExtraction(raw).extraction?.experience).toBeNull();
    expect(readExtraction({ ...raw, experience: { years_min: 'sept', years_max: null, seniority_label: null, quote: 'q' } }).problems.join()).toContain('integers');
    expect(readExtraction({ ...raw, experience: { years_min: 5, years_max: 3, seniority_label: null, quote: 'q' } }).problems.join()).toContain('greater');
    expect(readExtraction({ ...raw, experience: { years_min: 7, years_max: null, seniority_label: null, quote: '' } }).problems.join()).toContain('without a quote');
    expect(readExtraction({ ...raw, experience: { years_min: null, years_max: null, seniority_label: null, quote: '', ignored: [{ quote: 'x' }] } }).problems.join()).toContain('ignored[0].why');
  });
  test('Inqom : l’extraction fidèle passe ; la citation doit être dans l’annonce et porter le nombre et le label', () => {
    expect(checkExtraction(inqom(), INQOM, junior)).toEqual([]);
    expect(checkExtraction(inqom({ experience: { ...inqom().experience!, quote: 'Minimum 10 ans d’expérience' } }), INQOM, junior).join('\n')).toContain('experience: the quote');
    expect(checkExtraction(inqom({ experience: { ...inqom().experience!, years_min: 5 } }), INQOM, junior).join('\n')).toContain('experience.years_min = 5 does not appear');
    expect(checkExtraction(inqom({ experience: { ...inqom().experience!, seniority_label: 'lead' } }), INQOM, junior).join('\n')).toContain('seniority_label "lead" is not in the quoted text');
  });
  test('une exigence d’années que l’agent a manquée est rattrapée ; une mention écartée avec sa raison passe', () => {
    const missed = inqom({ experience: { ...EXPERIENCE_NOT_STATED } });
    const problems = checkExtraction(missed, INQOM, junior);
    expect(problems.join('\n')).toContain('asks for years of experience');
    expect(problems.join('\n')).toContain('7 ans d\'experience');
    const dismissed = inqom({ experience: { ...EXPERIENCE_NOT_STATED, ignored: [{ quote: "Minimum 7 ans d'expérience", why: 'test' }] } });
    expect(checkExtraction(dismissed, INQOM, junior)).toEqual([]);
  });
  test('règle coupée : la clé peut manquer et le balayage ne renvoie pas l’agent ; une citation inventée reste refusée', () => {
    expect(checkExtraction(inqom({ experience: null }), INQOM, criteria)).toEqual([]);
    expect(checkExtraction(inqom({ experience: { ...EXPERIENCE_NOT_STATED } }), INQOM, criteria)).toEqual([]);
    expect(checkExtraction(inqom({ experience: null }), INQOM, junior).join('\n')).toContain('"experience" is missing');
    expect(checkExtraction(inqom({ experience: { years_min: 2, years_max: null, seniority_label: null, quote: 'deux ans de bonheur', ignored: [] } }), INQOM, criteria).join('\n')).toContain('experience: the quote');
  });
});

describe('expérience : décision', () => {
  test('Inqom : 7 ans exigés contre 3 au plus écarte, avec la citation ; le profil senior du corps passe en note', () => {
    const d = decideTriage(inqom(), junior, true, { title: 'Product Marketing Manager' });
    expect(d.decision).toBe('ecartee');
    expect(d.reasons).toEqual(["Exige 7 ans d'expérience (max 3) : « profil senior. Minimum 7 ans d'expérience en Product Marketing »"]);
    expect(d.notes.join('\n')).toContain('Profil « senior » annoncé (max 3 ans d\'expérience)');
  });
  test('un label senior dans l’intitulé écarte, même sans années ; dans le corps seul, à vérifier', () => {
    const body = inqom({ experience: { years_min: null, years_max: null, seniority_label: 'senior', quote: 'profil senior', ignored: [] } });
    const title = decideTriage(body, junior, true, { title: 'Senior Product Marketing Manager' });
    expect(title.decision).toBe('ecartee');
    expect(title.reasons[0]).toBe("Intitulé de poste senior (« senior », max 3 ans d'expérience) : « Senior Product Marketing Manager »");
    const onlyBody = decideTriage(body, junior, true, { title: 'Product Marketing Manager' });
    expect(onlyBody.decision).toBe('a_verifier');
    expect(onlyBody.reasons).toEqual(["Profil « senior » annoncé (max 3 ans d'expérience) : « profil senior »"]);
    expect(decideTriage(body, junior, true, { title: 'Lead Generation Specialist' }).decision).toBe('a_verifier');
  });
  test('dans la limite : retenue avec une note ; la borne basse d’une fourchette décide ; 3 ans pour 3 au plus passe', () => {
    const within = decideTriage(inqom({ experience: { years_min: 2, years_max: 3, seniority_label: null, quote: '2 à 3 ans', ignored: [] } }), junior, true, { title: 'Product Marketing Manager' });
    expect(within.decision).toBe('retenue');
    expect(within.reasons).toEqual(['Langues, salaire, mode de travail et expérience conformes à criteres.json']);
    expect(within.notes.join('\n')).toContain('Expérience demandée : 2 à 3 ans (max 3)');
    expect(decideTriage(inqom({ experience: { years_min: 3, years_max: 6, seniority_label: null, quote: '3 à 6 ans', ignored: [] } }), junior, true).decision).toBe('retenue');
    expect(decideTriage(inqom({ experience: { years_min: 4, years_max: 6, seniority_label: null, quote: '4 à 6 ans', ignored: [] } }), junior, true).decision).toBe('ecartee');
  });
  test('non précisé : aucun effet (retenue si tout le reste est conforme)', () => {
    const d = decideTriage(inqom({ experience: { ...EXPERIENCE_NOT_STATED } }), junior, true, { title: 'Product Marketing Manager' });
    expect(d.decision).toBe('retenue');
    expect(d.notes.join()).not.toContain('Expérience');
  });
  test('règle coupée : sortie identique à avant, même avec 7 ans exigés et un intitulé senior', () => {
    const d = decideTriage(inqom(), criteria, true, { title: 'Senior Product Marketing Manager' });
    expect(d.decision).toBe('retenue');
    expect(d.reasons).toEqual(['Langues, salaire et mode de travail conformes à criteres.json']);
    expect(d.notes.join()).not.toContain('xpérience');
    expect(decideTriage(inqom({ experience: null }), criteria, true)).toEqual(decideTriage(inqom(), criteria, true));
  });
  test('labels seuls (sans maximum d’années) : l’intitulé écarte, les années ne comptent pas', () => {
    const labelsOnly = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, experience_labels_exclus: ['senior'] }).criteria as Criteria;
    expect(decideTriage(inqom(), labelsOnly, true, { title: 'Senior PMM' }).reasons).toEqual(['Intitulé de poste senior (« senior ») : « Senior PMM »']);
    expect(decideTriage(inqom({ experience: { ...inqom().experience!, seniority_label: null } }), labelsOnly, true, { title: 'PMM' }).decision).toBe('retenue');
  });
});

describe('mode de travail : la phrase du marqueur rendue à l’agent', () => {
  const DEEL = `About Deel. Deel is the all-in-one payroll and HR platform for global teams. We are a full remote company with team members in 100+ countries. You will own lifecycle campaigns for our self-serve customers.`;
  test('la phrase qui porte le marqueur, normalisée, est une citation que le contrôle accepte', () => {
    const sentence = markerSentence(DEEL, 'full remote');
    expect(sentence).toBe('we are a full remote company with team members in 100+ countries.');
    const quoted = checkExtraction(extraction({ languages: [], posting_language: { code: 'en', quote: sentence }, work_mode: { value: 'full_remote', quote: sentence }, salary: null, experience: null }), DEEL, criteria);
    expect(quoted.filter((p) => p.startsWith('work_mode') || p.startsWith('posting_language'))).toEqual([]);
    expect(markerSentence(DEEL, 'hybrid')).toBe('');
  });
  test('« not_stated » contre « full remote » (Deel) : le problème cite la phrase à reprendre', () => {
    const problems = checkExtraction(extraction({ languages: [], work_mode: { value: 'not_stated', quote: '' }, salary: null, experience: null }), DEEL, criteria);
    expect(problems.join('\n')).toContain('work_mode is "not_stated" but the posting says "full remote" in "we are a full remote company with team members in 100+ countries."; set work_mode.value');
  });
});

describe('mode de travail : plateformes 100 % télétravail', () => {
  test('les sources du radar reconnues, les autres non', () => {
    expect(remoteOnlySource('Himalayas')).toBe('Himalayas');
    expect(remoteOnlySource('Jobicy (jobicy.com)')).toBe('Jobicy');
    expect(remoteOnlySource('WeWorkRemotely')).toBe('WeWorkRemotely');
    expect(remoteOnlySource('RemoteOK')).toBe('RemoteOK');
    expect(remoteOnlySource('Remotive')).toBe('Remotive');
    expect(remoteOnlySource('Working Nomads')).toBe('Working Nomads');
    expect(remoteOnlySource('Jobspresso')).toBe('Jobspresso');
    expect(remoteOnlySource('EU Remote Jobs')).toBe('EU Remote Jobs');
    expect(remoteOnlySource('Welcome to the Jungle (télétravail)')).toBe('Welcome to the Jungle (page télétravail)');
    for (const other of ['Welcome to the Jungle', 'Adzuna', 'LinkedIn', 'Jobgether', 'Arbeitnow', 'Apify ATS', 'Jobdatalake', '']) expect(remoteOnlySource(other)).toBeNull();
  });
  test('la source vient de l’offre, sinon des champs du radar', () => {
    expect(offerSource('{"source":"Himalayas"}', '')).toBe('Himalayas');
    expect(offerSource('{}', 'Texte.\n\n--- Champs du radar (pas l\'annonce) ---\nSource : Remotive\n')).toBe('Remotive');
    expect(offerSource('', 'Texte sans champs')).toBe('');
  });
  const silent = (): Extraction => extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English and Italian' }], not_required: [], work_mode: { value: 'not_stated', quote: '' } });
  test('non précisé sur une plateforme 100 % télétravail : retenue, la base dans les raisons', () => {
    const d = decideTriage(silent(), criteria, true, { source: 'Himalayas', posting: 'We are hiring.' });
    expect(d.decision).toBe('retenue');
    expect(d.reasons).toEqual(['Langues, salaire et mode de travail conformes à criteres.json', "Télétravail d'après la source Himalayas (plateforme 100 % télétravail ; l'annonce ne parle ni d'hybride, ni de sur site, ni de jours au bureau)"]);
    expect(d.notes.some((n) => n.startsWith('Télétravail d'))).toBe(false);
  });
  test('ailleurs, ou avec une mention de bureau dans le texte, ou critère indifferent : la règle d’avant', () => {
    expect(decideTriage(silent(), criteria, true, { source: 'Adzuna' }).reasons).toEqual(["Mode de travail non précisé dans l'annonce"]);
    expect(decideTriage(silent(), criteria, true, { source: 'Jobicy', posting: 'Two office days per month in Lisbon.' }).reasons).toEqual(["Mode de travail non précisé dans l'annonce"]);
    const indifferent = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, remote: 'indifferent' }).criteria as Criteria;
    expect(decideTriage(silent(), indifferent, true, { source: 'Himalayas' }).reasons).toEqual(['Langues, salaire et mode de travail conformes à criteres.json']);
  });
  test('hybride lu sur une plateforme 100 % télétravail : écartée quand même ; résumé seul : à vérifier, la base en note', () => {
    const hybrid = decideTriage(extraction({ languages: [{ code: 'en', requirement: 'required', quote: 'Fluent in English and Italian' }], not_required: [], work_mode: { value: 'hybrid', quote: 'Hybrid, 2 days a week' } }), criteria, true, { source: 'Himalayas' });
    expect(hybrid.decision).toBe('ecartee');
    const partial = decideTriage(silent(), criteria, false, { source: 'Remotive', posting: 'Short summary.' });
    expect(partial.decision).toBe('a_verifier');
    expect(partial.reasons).toEqual(['Annonce complète non lue : seul le résumé du radar a été trié']);
    expect(partial.notes.some((n) => n.startsWith("Télétravail d'après la source Remotive"))).toBe(true);
  });
});

describe('âge de l’offre : offre_age_max_jours (7 jours par défaut)', () => {
  const now = new Date('2026-10-23T20:00:00Z');
  const fresh = (): Extraction => inqom({ experience: null });
  test('criteres.json : absent 7, entier lu, 0 coupe, autre chose refusé', () => {
    expect(criteria.offre_age_max_jours).toBe(7);
    expect((readCriteria({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: 14 }).criteria as Criteria).offre_age_max_jours).toBe(14);
    expect((readCriteria({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: 0 }).criteria as Criteria).offre_age_max_jours).toBe(0);
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: '7' }).problems.join()).toContain('offre_age_max_jours');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, offre_age_max_jours: -1 }).criteria).toBeNull();
  });
  test('plus de N jours : écartée, la raison en tête, le reste en notes', () => {
    const d = decideTriage(fresh(), criteria, true, { posting: INQOM, published: '2026-10-12', now });
    expect(d.decision).toBe('ecartee');
    expect(d.reasons).toEqual(['offre trop ancienne (publiée le 2026-10-12, > 7 jours)']);
    expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000), now }).reasons[0]).toBe('offre trop ancienne (publiée le 2026-10-01, > 7 jours)');
    expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published: 'Mon, 12 Oct 2026 09:00:00 +0000', now }).decision).toBe('ecartee');
  });
  test('date inconnue, illisible, dans la limite, ou règle coupée : la décision ne change pas', () => {
    const base = decideTriage(fresh(), criteria, true, { posting: INQOM });
    expect(base.decision).toBe('retenue');
    for (const published of [undefined, '', 'récent', '2026-10-16']) expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published, now }).decision).toBe('retenue');
    expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published: '2026-10-16', now }).notes).toContain('Publiée le 2026-10-16 (7 jours, max 7)');
    const off = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, offre_age_max_jours: 0 }).criteria as Criteria;
    expect(decideTriage(fresh(), off, true, { posting: INQOM, published: '2020-01-01', now })).toEqual(base);
  });
  test('une date relative du tableau se compte depuis la lecture du radar (radar_at)', () => {
    expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published: 'il y a 2 jours', readAt: '2026-10-10T12:00:00Z', now }).reasons).toEqual(['offre trop ancienne (publiée le 2026-10-08, > 7 jours)']);
    expect(decideTriage(fresh(), criteria, true, { posting: INQOM, published: 'il y a 2 jours', readAt: 'n/a', now }).decision).toBe('retenue');
  });
  test('offerPublished : date_published et radar_at du JSON de l’offre, vides sinon', () => {
    expect(offerPublished('{"date_published":"2026-10-20","radar_at":"2026-10-20T08:00:00Z"}')).toEqual({ published: '2026-10-20', readAt: '2026-10-20T08:00:00Z' });
    expect(offerPublished('{"date_published":1761200000}')).toEqual({ published: 1761200000, readAt: '' });
    expect(offerPublished('{}')).toEqual({ published: '', readAt: '' });
    expect(offerPublished('pas du json')).toEqual({ published: '', readAt: '' });
  });
});

// ── Présence au bureau pour une période (Bending Spoons, 2026-10-24) ─────────

const BENDING = `Bending Spoons is one of the world's leading mobile app companies. We are looking for a Growth Marketing Associate.
Location: Milan, Italy. We support remote work across Europe once you are settled in.
For the first few months, new hires spend most days at the Milan office, to learn how we work.
Fluent English is required. Gross annual salary: 45.000€.`;

describe('mode de travail : présence au bureau pour une période', () => {
  test('« for the first few months, new hires spend most days at the Milan office » est un marqueur sur site', () => {
    const m = detectWorkMode(BENDING);
    expect(m.office_period.length).toBeGreaterThan(0);
    expect(m.on_site).toContain(m.office_period[0]);
    expect(officePeriodMarkers('During onboarding you will spend two weeks at our Lisbon HQ.')).not.toEqual([]);
    expect(officePeriodMarkers('Les premiers mois, vous serez au bureau de Lyon trois jours par semaine.')).not.toEqual([]);
  });
  test('« not_stated » et « full_remote » sont renvoyés au travail, même avec un marqueur de télétravail ailleurs', () => {
    const base = { languages: [{ code: 'en', requirement: 'required' as const, quote: 'Fluent English is required' }], salary: { min: null, max: 45000, currency: 'EUR', period: 'year' as const, quote: 'Gross annual salary: 45.000€' }, posting_language: { code: 'en', quote: "Bending Spoons is one of the world's leading mobile app companies." }, experience: { ...EXPERIENCE_NOT_STATED } };
    const silent = checkExtraction(extraction({ ...base, work_mode: { value: 'not_stated', quote: '' } }), BENDING, criteria).join('\n');
    expect(silent).toContain('work_mode is "not_stated" but the posting says');
    expect(silent).toContain('milan office');
    const remotePosting = `${BENDING} After that, the role is fully remote.`;
    const claimed = checkExtraction(extraction({ ...base, work_mode: { value: 'full_remote', quote: 'After that, the role is fully remote.' } }), remotePosting, criteria).join('\n');
    expect(claimed).toContain('requires office presence for a period');
    const honest = extraction({ ...base, work_mode: { value: 'hybrid', quote: 'For the first few months, new hires spend most days at the Milan office' } });
    expect(checkExtraction(honest, remotePosting, criteria)).toEqual([]);
    const d = decideTriage(honest, criteria, true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain('Poste non 100 % télétravail (hybride)');
  });
  test('une plateforme 100 % télétravail ne couvre pas des mois au bureau', () => {
    const d = decideTriage(extraction({ languages: [], work_mode: { value: 'not_stated', quote: '' } }), criteria, true, { source: 'Himalayas', posting: BENDING });
    expect(d.decision).toBe('a_verifier');
  });
  test('faux positifs évités : bureau facultatif, onboarding à distance, remote-first', () => {
    expect(officePeriodMarkers('For the first few weeks you can work from our Paris office if you wish.')).toEqual([]);
    expect(officePeriodMarkers('Remote onboarding: we have no office, the team works from home.')).toEqual([]);
    expect(officePeriodMarkers('We are remote-first, office optional. You will run campaigns for the first months.')).toEqual([]);
  });
});

// ── Cœur du poste contre le profil (Melotech, 2026-10-24) ─────────────────

const MELOTECH = `Melotech is building the future of music. As our Founding Growth Manager you will own acquisition.
What we are looking for: 2-7 years of hands-on experience running high-volume paid acquisition on Meta, TikTok and Snapchat.
Strong SQL and Python skills to analyse cohorts yourself.
You will own our lifecycle and CRM programs end to end.
This is a fully remote role within Europe.`;

const PROFILE = `# Antoine — profil maître

## Expériences
- **Growth Marketing** chez Exemplia : refonte du parcours CRM (emails, push) pour 120 000 clients.
- Gestion des réseaux sociaux organiques (Instagram, LinkedIn).
- Requêtes SQL simples pour le suivi des campagnes.
`;

const core = (backings: [CoreRequirement['backing'], string][]): CoreRequirement[] => {
  const base = [
    { requirement: 'Achat média payant à gros volume (Meta, TikTok, Snapchat)', quote: '2-7 years of hands-on experience running high-volume paid acquisition on Meta, TikTok and Snapchat' },
    { requirement: "SQL et Python pour l'analyse", quote: 'Strong SQL and Python skills' },
    { requirement: 'Pilotage du lifecycle CRM', quote: 'You will own our lifecycle and CRM programs end to end.' },
  ];
  return base.map((b, i) => ({ ...b, backing: backings[i][0], profile_quote: backings[i][1] }));
};

describe('cœur du poste : vérification des citations', () => {
  test('une extraction fidèle passe : citations dans l’annonce et dans le profil (casse, espaces, Markdown mis à part)', () => {
    const c = core([['missing', ''], ['partial', 'Requêtes SQL simples pour le suivi des campagnes'], ['backed', 'Growth Marketing chez Exemplia : refonte du parcours  CRM (emails, push)']]);
    expect(checkCoreFit(c, MELOTECH, PROFILE)).toEqual([]);
    expect(normalizeProfile('- **Growth Marketing** chez')).toBe('growth marketing chez');
  });
  test('citation absente de l’annonce, ou prise dans les champs du radar : refusée', () => {
    const c = core([['missing', ''], ['missing', ''], ['backed', 'refonte du parcours CRM']]);
    c[0].quote = '5+ years of paid social';
    expect(checkCoreFit(c, MELOTECH, PROFILE).join()).toContain('core_requirements[0]');
    const withRadar = `${MELOTECH}\n\n--- Champs du radar (pas l'annonce) ---\nPoste : Founding Growth Manager paid social`;
    const r = core([['missing', ''], ['missing', ''], ['backed', 'refonte du parcours CRM']]);
    r[0].quote = 'Founding Growth Manager paid social';
    expect(checkCoreFit(r, withRadar, PROFILE).join()).toContain('not in the posting verbatim');
  });
  test('appui inventé, appui sans citation, « missing » avec citation : refusés', () => {
    expect(checkCoreFit(core([['backed', 'Achat média TikTok à 2 M€ par an'], ['missing', ''], ['missing', '']]), MELOTECH, PROFILE).join()).toContain('not in the candidate profile verbatim');
    expect(checkCoreFit(core([['partial', ''], ['missing', ''], ['missing', '']]), MELOTECH, PROFILE).join()).toContain('without a profile_quote');
    expect(checkCoreFit(core([['missing', 'Requêtes SQL simples'], ['missing', ''], ['missing', '']]), MELOTECH, PROFILE).join()).toContain('backing is "missing" but profile_quote is given');
  });
  test('exactement trois exigences, distinctes ; clé obligatoire quand un profil est donné', () => {
    expect(checkCoreFit(core([['missing', ''], ['missing', ''], ['missing', '']]).slice(0, 2), MELOTECH, PROFILE).join()).toContain('give exactly 3');
    const dup = core([['missing', ''], ['missing', ''], ['missing', '']]);
    dup[1].quote = dup[0].quote;
    expect(checkCoreFit(dup, MELOTECH, PROFILE).join()).toContain('the same posting quote');
    expect(checkCoreFit(null, MELOTECH, PROFILE).join()).toContain('"core_requirements" is missing');
  });
  test('sans profil : rien n’est vérifié', () => {
    expect(checkCoreFit(null, MELOTECH, null)).toEqual([]);
    expect(checkCoreFit(core([['backed', 'inventé'], ['missing', ''], ['missing', '']]).slice(0, 1), MELOTECH, '  ')).toEqual([]);
  });
  test('forme : backing hors de l’énumération, libellé vide', () => {
    const raw = JSON.parse(JSON.stringify(extraction())) as Record<string, unknown>;
    expect(readExtraction({ ...raw, core_requirements: [{ requirement: 'SQL', quote: 'x', backing: 'yes', profile_quote: '' }] }).problems.join()).toContain('backing must be "backed", "partial" or "missing"');
    expect(readExtraction({ ...raw, core_requirements: [{ requirement: '', quote: 'x', backing: 'missing' }] }).problems.join()).toContain('requirement must name');
    expect(readExtraction({ ...raw, core_requirements: 'aucun' }).problems.join()).toContain('"core_requirements" must be an array');
    expect(readExtraction({ ...raw, core_requirements: [{ requirement: 'SQL', quote: 'x', backing: 'partial', profile_quote: 'y' }] }).extraction?.core_requirements?.[0].backing).toBe('partial');
  });
});

describe('cœur du poste : la règle', () => {
  const remote = { languages: [] as Extraction['languages'] };
  test('deux exigences absentes du profil ou plus : écartée, « Cœur du poste hors profil : <req1> ; <req2> »', () => {
    const d = decideTriage(extraction({ ...remote, core_requirements: core([['missing', ''], ['missing', ''], ['backed', 'refonte du parcours CRM']]) }), criteria, true, { profileGiven: true });
    expect(d.decision).toBe('ecartee');
    expect(d.reasons).toEqual(["Cœur du poste hors profil : Achat média payant à gros volume (Meta, TikTok, Snapchat) ; SQL et Python pour l'analyse"]);
    const all = decideTriage(extraction({ ...remote, core_requirements: core([['missing', ''], ['missing', ''], ['missing', '']]) }), criteria, true, { profileGiven: true });
    expect(all.reasons[0].split(' ; ')).toHaveLength(3);
  });
  test('une seule absente : note « À renforcer », décision inchangée', () => {
    const d = decideTriage(extraction({ ...remote, core_requirements: core([['missing', ''], ['partial', 'Requêtes SQL simples'], ['backed', 'refonte du parcours CRM']]) }), criteria, true, { profileGiven: true });
    expect(d.decision).toBe('retenue');
    expect(d.notes).toContain('À renforcer : Achat média payant à gros volume (Meta, TikTok, Snapchat)');
    expect(d.notes).toContain('Cœur du poste : 1 exigence étayée, 1 en partie, 1 absente du profil, sur 3');
  });
  test('« partial » ne compte pas comme absent ; la règle s’ajoute aux autres', () => {
    expect(decideTriage(extraction({ ...remote, core_requirements: core([['partial', 'a'], ['partial', 'b'], ['missing', '']]) }), criteria, true, { profileGiven: true }).decision).toBe('retenue');
    const both = decideTriage(extraction({ core_requirements: core([['missing', ''], ['missing', ''], ['backed', 'c']]) }), criteria, true, { profileGiven: true });
    expect(both.reasons).toHaveLength(2);
    expect(both.reasons[0]).toContain("Exige l'italien");
  });
  test('sans profil : non évalué, une note le dit, la décision ne change pas', () => {
    const e = extraction({ ...remote, core_requirements: core([['missing', ''], ['missing', ''], ['missing', '']]) });
    const d = decideTriage(e, criteria, true);
    expect(d.decision).toBe('retenue');
    expect(d.notes).toContain('Adéquation au cœur du poste non évaluée : profil du candidat non fourni');
    expect(decideTriage(extraction(remote), criteria, true, { profileGiven: false }).notes).toContain('Adéquation au cœur du poste non évaluée : profil du candidat non fourni');
  });
});

describe('outils nommés : à l’appréciation du candidat (Antoine, 2026-11-12)', () => {
  const KLAVIYO = `${MELOTECH}\nHands-on Klaviyo experience (flows, segmentation) is a must.`;
  const remote = { languages: [] as Extraction['languages'] };
  test('un outil n’écarte jamais : une note le liste, la décision ne bouge pas', () => {
    const d = decideTriage(extraction({ ...remote, core_requirements: core([['partial', 'a'], ['backed', 'b'], ['backed', 'c']]), tools_requested: [{ tool: 'Klaviyo', quote: 'Hands-on Klaviyo experience' }, { tool: 'Klaviyo', quote: 'x' }, { tool: 'Shopify', quote: 'y' }] }), criteria, true, { profileGiven: true });
    expect(d.decision).toBe('retenue');
    expect(d.notes).toContain('Outils demandés (à ton appréciation) : Klaviyo, Shopify');
    expect(decideTriage(extraction(remote), criteria, true).notes.join()).not.toContain('Outils demandés');
  });
  test('un outil comme exigence du cœur : refusé ; citation d’outil hors annonce : refusée', () => {
    const c = core([['missing', ''], ['partial', 'Requêtes SQL simples pour le suivi des campagnes'], ['backed', 'refonte du parcours CRM']]);
    c[0] = { requirement: 'Klaviyo', quote: 'Hands-on Klaviyo experience (flows, segmentation) is a must.', backing: 'missing', profile_quote: '' };
    const tools = [{ tool: 'Klaviyo', quote: 'Hands-on Klaviyo experience (flows, segmentation)' }];
    expect(checkCoreFit(c, KLAVIYO, PROFILE, tools).join()).toContain("tools are the candidate's call");
    expect(checkCoreFit(core([['missing', ''], ['partial', 'Requêtes SQL simples pour le suivi des campagnes'], ['backed', 'refonte du parcours CRM']]), KLAVIYO, PROFILE, tools)).toEqual([]);
    expect(checkCoreFit(null, KLAVIYO, null, [{ tool: 'Shopify', quote: 'Shopify Plus stores' }]).join()).toContain('tools_requested[0]');
  });
  test('forme : liste facultative, nom obligatoire', () => {
    const raw = JSON.parse(JSON.stringify(extraction())) as Record<string, unknown>;
    expect(readExtraction(raw).extraction?.tools_requested).toEqual([]);
    expect(readExtraction({ ...raw, tools_requested: 'Klaviyo' }).problems.join()).toContain('"tools_requested" must be an array');
    expect(readExtraction({ ...raw, tools_requested: [{ tool: '', quote: 'x' }] }).problems.join()).toContain('tools_requested[0].tool');
  });
});

describe('experience sans exigence : citation de remplissage', () => {
  test('« not_stated » à la place de la citation vide est accepté quand rien n’est exigé', () => {
    const { readExtraction } = require('./triage-checks.ts') as typeof import('./triage-checks.ts');
    const base = { languages: [], not_required: [], salary: null, other_criteria: [], posting_language: { code: 'en', quote: 'We look for adaptable marketers who can take ownership of a growth problem and shift priorities.' }, work_mode: { mode: 'not_stated', quote: '' }, summary: 'x' };
    const r = readExtraction(JSON.stringify({ ...base, experience: { years_min: null, years_max: null, seniority_label: null, quote: 'not_stated' } }));
    expect(r.problems.filter((p) => p.includes('experience'))).toEqual([]);
    expect(r.extraction?.experience?.quote ?? '').toBe('');
  });
});

describe('zone d’embauche (zone_embauche : europe)', () => {
  const europe = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, zone_embauche: 'europe' }).criteria as Criteria;
  const base = { languages: [] };
  test('criteres.json : europe ou monde, monde par défaut', () => {
    expect(criteria.zone_embauche).toBe('monde');
    expect(europe.zone_embauche).toBe('europe');
    expect(readCriteria({ langues: ['fr'], salaire_min_annuel: 0, zone_embauche: 'usa' }).problems.join()).toContain('zone_embauche');
  });
  test('réservée hors Europe : écartée avec la citation ; ouverte : retenue ; muette : une note', () => {
    const closed = decideTriage(extraction({ ...base, hiring_zone: { value: 'closed', quote: 'US only' } }), europe, true);
    expect(closed.decision).toBe('ecartee');
    expect(closed.reasons.join()).toContain("N'embauche pas en Europe");
    expect(decideTriage(extraction({ ...base, hiring_zone: { value: 'open', quote: 'work from anywhere in Europe' } }), europe, true).decision).toBe('retenue');
    const silent = decideTriage(extraction({ ...base, hiring_zone: { value: 'not_stated', quote: '' } }), europe, true);
    expect(silent.decision).toBe('retenue');
    expect(silent.notes.join()).toContain("Zone d'embauche non précisée");
  });
  test('règle coupée (monde) : « closed » ne change rien', () => {
    expect(decideTriage(extraction({ ...base, hiring_zone: { value: 'closed', quote: 'US only' } }), criteria, true).decision).toBe('retenue');
  });
  test('lecture : valeur connue, citation exigée, clé obligatoire quand la règle est active', () => {
    const raw = (hz: unknown) => ({ languages: [], not_required: [], salary: null, salary_ignored: [], other_criteria: [], posting_language: { code: 'en', quote: 'x' }, work_mode: { value: 'not_stated', quote: '' }, summary: 's', hiring_zone: hz });
    expect(readExtraction(raw({ value: 'maybe', quote: '' })).problems.join()).toContain('hiring_zone.value');
    expect(readExtraction(raw({ value: 'closed', quote: '' })).problems.join()).toContain('without a quote');
    expect(readExtraction(raw({ value: 'open', quote: 'anywhere in Europe' })).extraction?.hiring_zone).toEqual({ value: 'open', quote: 'anywhere in Europe' });
    const missing = checkExtraction(extraction({ hiring_zone: undefined }), SMARTNESS, europe);
    expect(missing.join()).toContain('"hiring_zone" is missing');
    expect(checkExtraction(extraction({ hiring_zone: undefined }), SMARTNESS, criteria).join()).not.toContain('hiring_zone');
    const unfaithful = checkExtraction(extraction({ hiring_zone: { value: 'closed', quote: 'US residents only' } }), SMARTNESS, europe);
    expect(unfaithful.join()).toContain('hiring_zone');
    expect(checkExtraction(extraction({ hiring_zone: { value: 'open', quote: 'work from anywhere in Europe' } }), SMARTNESS, europe).join()).not.toContain('hiring_zone');
  });
});
