import { describe, expect, test } from 'bun:test';
import { readCriteria } from '../../blocks/.shared/triage-checks.ts';
import { RULES_NOTE, salaryByRules, triageByRules, workModeByRules } from './triage-rules.ts';

const criteria = (over: Record<string, unknown> = {}) => {
  const c = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, salaire_inconnu: 'garder', remote: 'full', experience_max_annees: 6, ...over }).criteria;
  if (c === null) throw new Error('criteria');
  return c;
};
const offer = (over: Record<string, unknown> = {}) => JSON.stringify({ title: 'Growth Marketing Manager', source: 'LinkedIn', ...over });
const EN = 'You will own the growth of our product and you will work with the team. We are a remote company and this is a role for you. Our team is small and you will have impact. We are looking for someone who can run experiments with the team, and for a person who will build the playbook with our sales team. What you will do: you are the one who will report to the CEO and you will be part of the leadership. You are curious and you have energy. This is what we offer: equity and the hardware you need for your work.';
const posting = (extra: string) => `${EN}\n${extra}\n\n--- Champs du radar (pas l'annonce) ---\nPoste : Growth Marketing Manager\nSource : LinkedIn\n`;

describe('triage par règles', () => {
  test('télétravail complet écrit, rien d\'autre : retenue, avec la note du moteur', () => {
    const d = triageByRules(offer(), posting('This position is fully remote.'), criteria(), true);
    expect(d.decision).toBe('retenue');
    expect(d.notes).toContain(RULES_NOTE);
  });
  test('hybride : écartée sous remote full', () => {
    const d = triageByRules(offer(), posting('This is a hybrid role, 2 days per week in our Lisbon office.'), criteria(), true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain('hybride');
  });
  test('intégration au bureau malgré « fully remote » : hybride', () => {
    expect(workModeByRules('Fully remote after onboarding. For the first few months, new hires spend most days at the Milan office.').value).toBe('hybrid');
  });
  test('« remote- or hybrid » au choix (COROS) : non précisé, à vérifier, pas écartée', () => {
    const text = 'Working Mode: Flexible, remote- or hybrid working arrangement if being based close to our hub in Linz (AT).';
    expect(workModeByRules(text).value).toBe('not_stated');
    expect(triageByRules(offer(), posting(text), criteria(), true).decision).not.toBe('ecartee');
    expect(workModeByRules('Hybrid or fully remote, your choice.').value).toBe('not_stated');
    expect(workModeByRules('This is a hybrid role, 2 days per week in our Lisbon office.').value).toBe('hybrid');
    expect(workModeByRules('Politique de télétravail flexible (jusqu\'à 50% télétravail).').value).toBe('hybrid');
    expect(workModeByRules('Vous aurez 2 jours de télétravail par semaine.').value).toBe('hybrid');
    expect(workModeByRules('This is a 100% remote role.').value).toBe('full_remote');
  });
  test('langue étrangère nommée : à vérifier, jamais écartée sur le seul balayage', () => {
    const d = triageByRules(offer(), posting('Fully remote. Fluent Italian is required.'), criteria(), true);
    expect(d.decision).toBe('a_verifier');
    expect(d.reasons.join(' ')).toContain('italien');
  });
  test('années d\'expérience au-delà du max : écartée', () => {
    expect(triageByRules(offer(), posting('Fully remote. Minimum 8 years of experience in B2B marketing.'), criteria(), true).decision).toBe('ecartee');
  });
  test('intitulé senior : écartée', () => {
    expect(triageByRules(offer({ title: 'Senior Growth Manager' }), posting('Fully remote.'), criteria(), true).decision).toBe('ecartee');
  });
  test('salaire écrit une fois sous le seuil : écartée ; mensuel converti', () => {
    expect(triageByRules(offer(), posting('Fully remote. Salary: 28,000 € per year.'), criteria(), true).decision).toBe('ecartee');
    expect(salaryByRules('Salaire : 3 500 € brut par mois', criteria().taux_eur).salary).toMatchObject({ min: null, max: 3500, period: 'month', currency: 'EUR' });
  });
  test('annonce en cyrillique : langue lue par l\'écriture (ukrainien écarté)', () => {
    const uk = 'Ми шукаємо маркетолога, який любить експериментувати, швидко освоює нові інструменти і працює з командою. Їхня робота є важливою для нас. '.repeat(4);
    const d = triageByRules(offer(), `${uk}\nFully remote.\n\n--- Champs du radar (pas l'annonce) ---\nSource : LinkedIn\n`, criteria(), true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.join(' ')).toContain('ukrainien');
  });
  test('annonce close : écartée par le code', () => {
    const d = triageByRules(offer(), posting('Fully remote. Les candidatures ne sont plus acceptées.'), criteria(), true);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain('Annonce close');
  });
  test('un avantage chiffré n\'est pas un salaire (titre-restaurant, budget, levée)', () => {
    expect(salaryByRules('Prise en charge par l\'employeur Carte ticket restaurant Swile de 10 euros par jour (participation de l\'employeur)', criteria().taux_eur)).toEqual({});
    expect(salaryByRules('Home Office Setup: One-off £500 reimbursement following probation.', criteria().taux_eur)).toEqual({});
    expect(salaryByRules('Salaire : 42 000 € brut par an, tickets restaurant en plus', criteria().taux_eur).salary).toMatchObject({ max: 42000, currency: 'EUR' });
    const d = triageByRules(offer(), posting('Fully remote. Carte ticket restaurant Swile de 10 euros par jour.'), criteria({ salaire_inconnu: 'garder' }), true);
    expect(d.reasons.join(' ')).not.toContain('Salaire sous');
  });
  test('plusieurs montants : à vérifier, même quand le salaire inconnu s\'écarte', () => {
    const d = triageByRules(offer(), posting('Fully remote. Base 40,000 € plus a bonus.\nWe raised 12,000,000 € last year and grew a lot in every market we serve.'), criteria({ salaire_inconnu: 'ecarter' }), true);
    expect(d.decision).toBe('a_verifier');
    expect(d.reasons.join(' ')).toContain('à lire');
  });
  test('rien sur le mode de travail : à vérifier ; annonce lue en partie : à vérifier', () => {
    expect(triageByRules(offer(), posting(''), criteria(), true).reasons).toContain("Mode de travail non précisé dans l'annonce");
    expect(triageByRules(offer(), posting('Fully remote.'), criteria(), false).decision).toBe('a_verifier');
  });
  test('annonce rédigée en italien : écartée', () => {
    const it = 'Il nostro team è alla ricerca di una persona che si occupi della crescita del prodotto con il team. Sono richieste anche competenze per la gestione delle campagne e della strategia, per una azienda che cresce nel mercato. Il ruolo è nel nostro ufficio, con il team della crescita e della vendita, e anche con il team delle operazioni per una crescita sostenibile. Per il ruolo sono importanti la conoscenza del mercato e la capacità di lavorare con il team, anche per la gestione delle relazioni con il cliente e con il team di prodotto per una crescita del nostro mercato e della nostra azienda.';
    expect(triageByRules(offer(), `${it}\n\n--- Champs du radar (pas l'annonce) ---\nPoste : Growth\n`, criteria(), true).decision).toBe('ecartee');
  });
});
