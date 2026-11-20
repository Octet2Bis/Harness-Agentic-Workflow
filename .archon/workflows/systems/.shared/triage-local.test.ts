import { describe, expect, test } from 'bun:test';
import { readCriteria } from '../../blocks/.shared/triage-checks.ts';
import { type Ask, type LocalQuestion, checkSalary, checkWorkMode, checkZone, ollamaAsk, prunePosting, sentencesOf, triageLocal } from './triage-local.ts';

const criteria = (over: Record<string, unknown> = {}) => {
  const c = readCriteria({ langues: ['fr', 'en'], salaire_min_annuel: 35000, salaire_inconnu: 'garder', remote: 'full', experience_max_annees: 4, zone_embauche: 'europe', ...over }).criteria;
  if (c === null) throw new Error('criteria');
  return c;
};
const offer = JSON.stringify({ title: 'Growth Marketing Manager', source: 'LinkedIn' });
const EN = 'You will own the growth of our product and you will work with the team. Our team is small and you will have impact. We are looking for someone who can run experiments with the team, and for a person who will build the playbook with our sales team. What you will do: you are the one who will report to the CEO and you will be part of the leadership. You are curious and you have energy. This is what we offer: equity and the hardware you need for your work.';
const posting = (extra: string) => `${EN}\n${extra}\n\n--- Champs du radar (pas l'annonce) ---\nPoste : Growth Marketing Manager\nSource : LinkedIn\n`;

/** Un faux modèle : une réponse par type de question, et le journal des questions posées. */
function fake(answers: Partial<Record<LocalQuestion['kind'], (q: LocalQuestion) => { answer?: string; sentence?: number }>>): { ask: Ask; asked: LocalQuestion[] } {
  const asked: LocalQuestion[] = [];
  return {
    asked,
    ask: async (q) => {
      asked.push(q);
      const f = answers[q.kind];
      return f ? f(q) : { answer: 'not_stated', sentence: 0 };
    },
  };
}
const sentenceWith = (q: LocalQuestion, needle: string) => q.phrases.findIndex((p) => p.includes(needle)) + 1;

describe('contrôles du code sur la réponse du modèle', () => {
  test('zone « hors Europe » : restriction et lieu hors d\'Europe exigés, aucun lieu européen', () => {
    expect(checkZone('closed', 'You must be based in the United States and have U.S. work authorization').ok).toBe(true);
    expect(checkZone('closed', 'Remote, based in Kosovo.').ok).toBe(false);
    expect(checkZone('closed', 'Together, we serve over 1,000 retailers across 27 markets, including Europe, Canada, the USA.').ok).toBe(false);
    expect(checkZone('closed', 'Salary : Up to £60,000 base salary + variable bonus, dependent on experience and location.').ok).toBe(false);
    expect(checkZone('open', 'Remote within EMEA.').ok).toBe(true);
    expect(checkZone('open', 'We are a fast growing team.').ok).toBe(false);
  });
  test('mode « 100 % télétravail » : un mot de télétravail, rien de partiel', () => {
    expect(checkWorkMode('full_remote', 'This is a fully remote role.').ok).toBe(true);
    expect(checkWorkMode('full_remote', 'Home Office Setup: One-off £500 reimbursement following successful completion of probation.').ok).toBe(false);
    expect(checkWorkMode('full_remote', 'Remote, 2 days of remote per week.').ok).toBe(false);
    expect(checkWorkMode('on_site', 'Nos bureaux sont situés au coeur de Paris.').ok).toBe(true);
    expect(checkWorkMode('hybrid', 'We love experiments.').ok).toBe(false);
  });
  test('phrase de paie : un mot de paie, pas un avantage', () => {
    expect(checkSalary('Salary : Up to £60,000 base salary + variable bonus.').ok).toBe(true);
    expect(checkSalary("Carte ticket restaurant Swile de 10 euros par jour (participation de l'employeur)").ok).toBe(false);
    expect(checkSalary("We've raised more than $180m from some of the world's top investors.").ok).toBe(false);
  });
});

describe('triageLocal', () => {
  test('langue étrangère : le modèle dit exigée → écartée, avec la phrase du code', async () => {
    const { ask, asked } = fake({ langue: () => ({ answer: 'required' }) });
    const d = await triageLocal(offer, posting('Fully remote. Fluent German is a must for this role.'), criteria(), true, ask);
    expect(asked.map((q) => q.kind)).toContain('langue');
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.join(' ')).toContain("l'allemand");
  });
  test('langue étrangère : « un plus » → note seulement', async () => {
    const { ask } = fake({ langue: () => ({ answer: 'preferred' }) });
    const d = await triageLocal(offer, posting('Fully remote. German is a plus.'), criteria(), true, ask);
    expect(d.decision).toBe('retenue');
    expect(d.notes.join(' ')).toContain('est un plus');
  });
  test('modèle injoignable : la langue nommée reste à vérifier, la note le dit', async () => {
    const ask: Ask = async () => {
      throw new Error('ECONNREFUSED');
    };
    const d = await triageLocal(offer, posting('Fully remote. Fluent German is a must for this role.'), criteria(), true, ask);
    expect(d.decision).toBe('a_verifier');
    expect(d.notes.join(' ')).toContain('sans réponse du modèle');
  });
  test('zone : « hors Europe » sur une phrase qui le prouve → écartée', async () => {
    const { ask } = fake({ zone: (q) => ({ answer: 'closed', sentence: sentenceWith(q, 'United States') }) });
    const d = await triageLocal(offer, posting('Fully remote. You must be based in the United States and have U.S. work authorization.'), criteria(), true, ask);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.join(' ')).toContain("N'embauche pas en Europe");
  });
  test('zone : « hors Europe » sur une liste de marchés → refusé par le code, offre gardée', async () => {
    const { ask } = fake({ zone: (q) => ({ answer: 'closed', sentence: sentenceWith(q, 'markets') }) });
    const d = await triageLocal(offer, posting('Fully remote. We serve retailers across 27 markets, including Europe, Canada, the USA, Latin America.'), criteria(), true, ask);
    expect(d.decision).toBe('retenue');
    expect(d.controls[0]).toContain('Zone : réponse refusée');
  });
  test('mode : « 100 % télétravail » tiré d\'un remboursement → refusé, à vérifier', async () => {
    const { ask } = fake({ mode: (q) => ({ answer: 'full_remote', sentence: sentenceWith(q, 'Home Office') }) });
    const d = await triageLocal(offer, posting('Home Office Setup: One-off £500 reimbursement following successful completion of probation.'), criteria(), true, ask);
    expect(d.decision).toBe('a_verifier');
    expect(d.controls.join(' ')).toContain('Mode de travail : réponse refusée');
  });
  test('mode : le code lit « jusqu\'à 50% télétravail » sans demander au modèle', async () => {
    const { ask, asked } = fake({});
    const d = await triageLocal(offer, posting("Politique de télétravail flexible (jusqu'à 50% télétravail)."), criteria(), true, ask);
    expect(asked.filter((q) => q.kind === 'mode')).toHaveLength(0);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.join(' ')).toContain('hybride');
  });
  test('salaire : plusieurs montants, le modèle choisit la paie, le code la lit', async () => {
    const { ask } = fake({ salaire: (q) => ({ sentence: sentenceWith(q, 'Salary') }) });
    const d = await triageLocal(offer, posting('Fully remote.\nSalary: 25,000 € to 30,000 € gross per year.\nWe raised 12,000,000 € last year.'), criteria(), true, ask);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons.join(' ')).toContain('Salaire sous');
  });
  test('titre-restaurant : jamais un salaire, offre gardée', async () => {
    const { ask } = fake({});
    const d = await triageLocal(offer, posting('Fully remote. Carte ticket restaurant Swile de 10 euros par jour.'), criteria(), true, ask);
    expect(d.reasons.join(' ')).not.toContain('Salaire sous');
  });
  test('annonce close : écartée', async () => {
    const { ask } = fake({});
    const d = await triageLocal(offer, posting('Fully remote. Les candidatures ne sont plus acceptées.'), criteria(), true, ask);
    expect(d.decision).toBe('ecartee');
    expect(d.reasons[0]).toContain('Annonce close');
  });
  test('habillage LinkedIn retiré avant les phrases', () => {
    const body = prunePosting(`Menu Connexion\nSignaler cette offre d'emploi\n${EN}\nNiveau hiérarchique\nPremier emploi\nOffres d'emploi similaires`);
    expect(body).not.toContain('Niveau hiérarchique');
    expect(sentencesOf(body).length).toBeGreaterThan(3);
  });
});

describe('ollamaAsk', () => {
  test('envoie le schéma de la question et lit la réponse JSON', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ response: '{"answer":"required"}' }));
    }) as unknown as typeof fetch;
    const ask = ollamaAsk('http://127.0.0.1:11434', 'qwen2.5:7b-instruct-q4_0', { fetchImpl });
    const a = await ask({ kind: 'langue', prompt: 'p', schema: { type: 'object' }, phrases: ['s'] });
    expect(a).toEqual({ answer: 'required' });
    expect(sent).toMatchObject({ model: 'qwen2.5:7b-instruct-q4_0', stream: false, format: { type: 'object' }, options: { temperature: 0, num_ctx: 4096 } });
  });
  test('une erreur d\'Ollama lève', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'model not found' }))) as unknown as typeof fetch;
    await expect(ollamaAsk('http://x', 'm', { fetchImpl })({ kind: 'zone', prompt: 'p', schema: {}, phrases: [] })).rejects.toThrow('model not found');
  });
});
