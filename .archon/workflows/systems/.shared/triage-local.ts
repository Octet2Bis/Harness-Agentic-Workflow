/**
 * Le tri par un petit modèle local (moteur `local` de `career-triage`), sans Claude : le harness
 * « petits modèles » éprouvé le 2026-11-08 sur 16 offres triées par Claude (Desktop\test-7b,
 * qwen2.5 7B Q4_0 sur la VM : même verdict, même raison que Claude sur les 11 offres qu'il pouvait
 * juger ; les 5 autres : annonces expirées ou tronquées, et le cœur du poste, laissé à Claude).
 *
 * Le code d'abord, le modèle pour les seules questions que le code ne tranche pas, le code vérifie
 * la réponse, la règle décide :
 *  1. les règles du tri par code (`triageByRules` : langue de rédaction et écriture, salaire écrit
 *     une fois, mode de travail, expérience, annonce close) ;
 *  2. QUESTIONS COURTES ET FERMÉES au modèle sur des phrases que le code a choisies (une langue
 *     étrangère nommée : exigée, souhaitée ou non demandée ? ; le mode de travail quand les règles
 *     ne le lisent pas ; la zone d'embauche ; la phrase de paie parmi plusieurs montants), sortie
 *     imposée par un schéma JSON à énumérations : le modèle n'écrit jamais de citation ;
 *  3. CONTRÔLES DU CODE sur chaque réponse : la phrase choisie doit porter ce que le modèle dit
 *     (« hors Europe » : une restriction et un lieu hors d'Europe, aucun lieu européen ; « 100 %
 *     télétravail » : un mot de télétravail, rien de partiel ; la paie : un mot de paie, pas un
 *     avantage) ; sinon la réponse est refusée, le critère reste « non précisé » et une note le dit ;
 *  4. `decideTriage` décide, comme pour les règles et le bloc job-triage.
 *
 * Le cœur du poste face au profil n'est pas jugé ici (trop long pour un 7B sur CPU) : c'est le
 * travail de Claude sur la short-list. `ask` est injecté : Ollama en production (`ollamaAsk`),
 * une fonction en test. Aucun appel à Claude.
 */

import { type Criteria, type Extraction, type TriageDecision, closedPostingSentence, decideTriage, detectLanguage, languageLabel, normalize, offerPublished, offerSource, offerTitle, postingBody, scanExperienceYears, scanLanguageMentions, scriptLanguage } from '../../blocks/.shared/triage-checks.ts';
import { salaryByRules, workModeByRules } from './triage-rules.ts';

export const LOCAL_NOTE = 'Tri par le modèle local (questions fermées, réponses contrôlées par le code), sans Claude : cœur du poste non évalué';
export const DEFAULT_LOCAL_MODEL = 'qwen2.5:7b-instruct-q4_0';

export type QuestionKind = 'langue' | 'mode' | 'zone' | 'salaire';
export interface LocalQuestion {
  kind: QuestionKind;
  prompt: string;
  schema: Record<string, unknown>;
  phrases: string[];
  lang?: string;
}
export type Answer = { answer?: string; sentence?: number } | null;
export type Ask = (q: LocalQuestion) => Promise<Answer>;
export interface Asked {
  kind: QuestionKind;
  phrases: string[];
  lang?: string;
  answer: Answer;
  seconds: number;
}
export interface LocalDecision extends TriageDecision {
  questions: Asked[];
  controls: string[];
}

// ── Les phrases de l'annonce ───────────────────────────────────────────────

/** Le texte d'une annonce sans l'habillage de LinkedIn (« Signaler cette offre d'emploi » … « Niveau hiérarchique ») ni HTML. */
export function prunePosting(posting: string): string {
  let body = postingBody(posting).replace(/<\/?(p|li|ul|ol|br|div|h\d|strong|em|b|i|span)[^>]*>/gi, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n');
  let start = 0;
  for (const m of ['Signaler cette offre d’emploi', "Signaler cette offre d'emploi", 'Report this job']) {
    const i = body.indexOf(m);
    if (i >= 0) {
      start = i + m.length;
      break;
    }
  }
  let end = body.length;
  for (const m of ['Niveau hiérarchique', 'Seniority level', 'Offres d’emploi similaires', 'Similar jobs', 'Recherches associées', 'People also viewed']) {
    const i = body.indexOf(m, start);
    if (i >= 0 && i < end) end = i;
  }
  const kept = body.slice(start, end).trim();
  body = kept.length >= 300 ? kept : body.trim();
  return body;
}

/** Les phrases d'une annonce élaguée : par ligne et fin de phrase, 12 à 400 caractères, sans doublon. */
export function sentencesOf(body: string): string[] {
  return body
    .split(/\n+|(?<=[.!?;])\s+(?=[A-ZÀ-Ý•\-])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 12 && s.length <= 400)
    .filter((s, i, a) => a.indexOf(s) === i);
}

const ZONE_WORDS = /\b(based in|located in|reside|residen|authori[sz]ed to work|work authori[sz]ation|right to work|work permit|visa|sponsor|eligible to work|time ?zones?|timezone|EMEA|Europe|European|EU\b|UK\b|United Kingdom|United States|U\.S\.|USA|US-based|North America|Canada|LATAM|APAC|anywhere|worldwide|global(ly)?|countries|Lieu|Location|remote in|remote -|remote —)/i;
const WM_WORDS = /(remote|t[ée]l[ée]travail|hybrid|hybride|on-site|onsite|on site|sur site|office|bureau|locaux|pr[ée]sentiel|distanciel|[àa] distance|home|anywhere|distributed|location[- ]independent|wfh|virtual|relocat|in person|in-person|days a week|jours par semaine)/i;

// ── Les questions ──────────────────────────────────────────────────────────

const PREFIX = 'You classify ONE short piece of a job posting for a candidate. Answer only with the JSON object asked. Never explain.\n\n';
const numbered = (list: string[]): string => list.map((s, i) => `${i + 1}. ${s}`).join('\n');

export const QUESTIONS = {
  langue: (lang: string, s: string): LocalQuestion => ({
    kind: 'langue', lang, phrases: [s],
    prompt: `${PREFIX}Question type: LANGUAGE.\nIs the language "${lang}" asked of the CANDIDATE in this sentence? "required" = a condition (fluent, native, must, C1, needed). "preferred" = softened (a plus, nice to have, an advantage, ideally, bonus). "not_asked" = the sentence names the language for another reason (a market, a country, clients, a team, a product, a menu).\n\nSentence: """${s}"""`,
    schema: { type: 'object', required: ['answer'], properties: { answer: { enum: ['required', 'preferred', 'not_asked'] } } },
  }),
  mode: (list: string[]): LocalQuestion => ({
    kind: 'mode', phrases: list,
    prompt: `${PREFIX}Question type: WORK MODE.\nFrom these numbered sentences of one posting, where does the job happen? "full_remote" = fully remote (100% remote, remote-first, work from anywhere, remote based in a country). "hybrid" = some days or periods at an office. "on_site" = at a workplace. "not_stated" = the sentences do not say. Give the number of the sentence that proves it (0 when not_stated).\n\n${numbered(list)}`,
    schema: { type: 'object', required: ['answer', 'sentence'], properties: { answer: { enum: ['full_remote', 'hybrid', 'on_site', 'not_stated'] }, sentence: { type: 'integer' } } },
  }),
  zone: (list: string[]): LocalQuestion => ({
    kind: 'zone', phrases: list,
    prompt: `${PREFIX}Question type: HIRING ZONE.\nThe candidate lives in Europe (UK and Ireland included). From these numbered sentences, can the role be filled from Europe? "open" = it hires in Europe, a European country, EMEA or anywhere. "closed" = it keeps the role to people outside Europe (US only, must reside in the United States, authorized to work in the US, Canada, LATAM, APAC time zones). "not_stated" = the sentences do not say. Give the number of the sentence that proves it (0 when not_stated).\n\n${numbered(list)}`,
    schema: { type: 'object', required: ['answer', 'sentence'], properties: { answer: { enum: ['open', 'closed', 'not_stated'] }, sentence: { type: 'integer' } } },
  }),
  salaire: (list: string[]): LocalQuestion => ({
    kind: 'salaire', phrases: list,
    prompt: `${PREFIX}Question type: SALARY.\nWhich numbered sentence gives the BASE PAY of this job (not funding, revenue, budget, bonus, equipment allowance)? Give its number, or 0 when none is the pay.\n\n${numbered(list)}`,
    schema: { type: 'object', required: ['sentence'], properties: { sentence: { type: 'integer' } } },
  }),
};

// ── Les contrôles du code sur la réponse ───────────────────────────────────

const EUROPE = /\b(europe|european|europeenne?s?|eu|eea|emea|cet|cest|uk|u\.k\.|united kingdom|great britain|britain|england|scotland|wales|ireland|irlande|france|germany|allemagne|deutschland|spain|espagne|portugal|italy|italie|netherlands|pays-bas|holland|belgium|belgique|luxembourg|switzerland|suisse|austria|autriche|poland|pologne|czech|czechia|tcheque|slovakia|slovaquie|hungary|hongrie|romania|roumanie|bulgaria|bulgarie|greece|grece|croatia|croatie|serbia|serbie|slovenia|slovenie|bosnia|bosnie|montenegro|albania|albanie|macedonia|macedoine|kosovo|moldova|moldavie|ukraine|lithuania|lituanie|latvia|lettonie|estonia|estonie|finland|finlande|sweden|suede|norway|norvege|denmark|danemark|iceland|islande|malta|malte|cyprus|chypre|london|londres|paris|berlin|madrid|barcelona|barcelone|lisbon|lisbonne|porto|amsterdam|rotterdam|brussels|bruxelles|milan|rome|dublin|vienna|vienne|zurich|geneva|geneve|munich|hamburg|warsaw|varsovie|krakow|cracovie|prague|budapest|bucharest|bucarest|sofia|athens|athenes|stockholm|copenhagen|copenhague|oslo|helsinki|tallinn|riga|vilnius|lyon|marseille|lille|toulouse|bordeaux|nantes|pristina|tirana|belgrade|zagreb|ljubljana|kyiv|kiev|lviv|odesa)\b/;
const NON_EUROPE = /(united states|u\.s\.|america|canada|canadian|latam|latin america|apac|asia|australia|new zealand|india|brazil|brasil|mexico|philippines|singapore|japan|china|israel|south africa|nigeria|kenya|egypt|turkey|dubai|uae|pacific time|eastern time|etats-unis)/;
/** Sigles, en majuscules seulement (« us » = nous). */
const NON_EUROPE_CS = /\b(US|USA|EST|PST|CST|ET|PT)\b/;
const RESTRICT = /(must|only|required|requires?|need to (be|live|reside)|have to be|based in|located in|living in|live in|reside|residen|authori[sz]ed|authori[sz]ation|right to work|eligib|citizen|visa|sponsor|work permit|uniquement|seulement|resid|time ?zones?|overlap)/;
const OPEN_WORLD = /(anywhere|worldwide|world-wide|global(ly)? remote|any country|international|partout)/;
const PARTIAL_REMOTE = /(\b\d{1,2}\s*%\s*(de\s+|of\s+)?(teletravail|remote)|\b[1-4]\s*(jours?|days?)\s*(de\s+|of\s+)?(teletravail|remote|from home|wfh|home ?office))/;
const REMOTE_WORD = /(remote|teletravail|work from home|\bwfh\b|from anywhere|distributed team|home-based|home based)/;
const PRESENCE = /(office|bureau|locaux|on-site|onsite|on site|sur site|presentiel|in person|in-person|hybrid|hybride|campus|\bhq\b|headquarters|days? (a|per) week|jours? par semaine|relocat|siege)/;
const STRONG_PAY = /(salaire|salary|salaries|remuneration|compensation|base pay|\bbase\b|brut|gross|\bote\b|\btjm\b|day rate|daily rate|package)/;
const PAY = /(\bpay\b|paid|per annum|p\.a\.|annual|annuel|par an|per year|a year|\/year|\/an\b|\bk€|€\s?k\b|\d\s?k\b)/;
const PERK = /(ticket|restaurant|meal|repas|swile|lunch|dejeuner|mutuelle|transport|navigo|rembours|reimburs|allowance|stipend|budget|equipment|equipement|setup|set-up|signing|levee|raised|funding|series [a-d]\b|revenue|chiffre d'affaires|\barr\b|valuation|valoris)/;

export type Check = { ok: true } | { ok: false; why: string };

/** « hors Europe » : une restriction, un lieu hors d'Europe, aucun lieu européen ; « ouvert » : l'Europe ou « partout » nommés. */
export function checkZone(answer: string, sentence: string): Check {
  const t = normalize(sentence);
  if (answer === 'closed') {
    if (EUROPE.test(t)) return { ok: false, why: 'le modèle dit « hors Europe » mais la phrase nomme un lieu européen' };
    if (!RESTRICT.test(t)) return { ok: false, why: 'le modèle dit « hors Europe » mais la phrase ne pose aucune restriction' };
    if (!NON_EUROPE.test(t) && !NON_EUROPE_CS.test(sentence)) return { ok: false, why: "le modèle dit « hors Europe » mais la phrase ne nomme aucun lieu hors d'Europe" };
    return { ok: true };
  }
  if (answer === 'open') return EUROPE.test(t) || OPEN_WORLD.test(t) ? { ok: true } : { ok: false, why: "le modèle dit « ouvert à l'Europe » mais la phrase ne nomme ni l'Europe ni « partout »" };
  return { ok: true };
}

/** « 100 % télétravail » : un mot de télétravail, rien de partiel ni d'hybride ; hybride / sur site : un mot de bureau ou de présence. */
export function checkWorkMode(answer: string, sentence: string): Check {
  const t = normalize(sentence);
  if (answer === 'full_remote') {
    if (!REMOTE_WORD.test(t)) return { ok: false, why: 'le modèle dit « 100 % télétravail » mais la phrase ne parle pas de télétravail' };
    if (PARTIAL_REMOTE.test(t) || /hybri/.test(t)) return { ok: false, why: 'le modèle dit « 100 % télétravail » mais la phrase dit un télétravail partiel' };
    return { ok: true };
  }
  if (answer === 'hybrid' || answer === 'on_site') return PRESENCE.test(t) || PARTIAL_REMOTE.test(t) ? { ok: true } : { ok: false, why: `le modèle dit « ${answer === 'hybrid' ? 'hybride' : 'sur site'} » mais la phrase ne parle ni de bureau ni de présence` };
  return { ok: true };
}

/** La phrase de paie : un mot de paie fort, ou un mot de paie sans avantage (titre-restaurant, budget, levée de fonds…). */
export function checkSalary(sentence: string): Check {
  const t = normalize(sentence);
  if (STRONG_PAY.test(t)) return { ok: true };
  if (PAY.test(t) && !PERK.test(t)) return { ok: true };
  return { ok: false, why: 'la phrase ne parle pas de paie (avantage, levée de fonds, budget…)' };
}

const short = (s: string): string => (s.length > 90 ? `${s.slice(0, 90)}…` : s);

// ── Le tri ─────────────────────────────────────────────────────────────────

/**
 * Trie une offre : règles, questions fermées au modèle (`ask`), contrôles du code, `decideTriage`.
 * Une question sans réponse lisible (modèle injoignable, sortie hors schéma) laisse le critère
 * « non précisé » ; si le modèle ne répond à rien, `controls` le dit et le tri reste celui des règles.
 */
export async function triageLocal(offerJson: string, posting: string, criteria: Criteria, postingFull: boolean, ask: Ask, now: Date = new Date()): Promise<LocalDecision> {
  const body = prunePosting(posting);
  const radarAt = posting.indexOf('--- Champs du radar');
  // L'annonce sans habillage, champs du radar gardés : ce que lisent les règles, les questions et la décision.
  const clean = radarAt >= 0 ? `${body}\n\n${posting.slice(radarAt)}` : body;
  const all = sentencesOf(body);
  const questions: Asked[] = [];
  const controls: string[] = [];
  const put = async (q: LocalQuestion): Promise<Answer> => {
    const t0 = Date.now();
    let answer: Answer = null;
    try {
      answer = await ask(q);
    } catch (err) {
      controls.push(`Question « ${q.kind} » sans réponse du modèle : ${(err as Error).message.slice(0, 120)}`);
    }
    questions.push({ kind: q.kind, phrases: q.phrases, lang: q.lang, answer, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    return answer;
  };
  const pick = (a: Answer, list: string[]): string | undefined => (typeof a?.sentence === 'number' && a.sentence >= 1 ? list[a.sentence - 1] : undefined);

  // Langue de rédaction : l'écriture, puis les mots-outils.
  const script = scriptLanguage(body);
  const detected = script !== null ? { code: script } : detectLanguage(body);
  const postingLanguage = detected?.code ?? criteria.langues[0] ?? 'en';
  const notes: string[] = [];
  if (detected === null) notes.push('Langue de rédaction non reconnue par le code (texte court ou bilingue)');

  // Langues : le code trouve chaque mention, le modèle dit si elle est exigée.
  const spoken = new Set(criteria.langues);
  const languages: Extraction['languages'] = [];
  const not_required: Extraction['not_required'] = [];
  const doubts: Extraction['other_criteria'] = [];
  for (const m of scanLanguageMentions(body)) {
    if (spoken.has(m.code) || m.code === postingLanguage) continue;
    const s = String(m.excerpt).replace(/^…|…$/g, '').trim();
    const name = languageLabel(m.code).replace(/^l'|^le |^la /, '');
    const a = await put(QUESTIONS.langue(name, s));
    if (a?.answer === 'required' || a?.answer === 'preferred') languages.push({ code: m.code, requirement: a.answer, quote: s });
    else if (a?.answer === 'not_asked') not_required.push({ code: m.code, quote: s, why: 'non demandée au candidat (modèle local)' });
    else doubts.push({ criterion: `Langue nommée : ${languageLabel(m.code)}`, met: false, quote: m.excerpt, note: 'exigée ou souhaitée, à lire (le modèle local n\'a pas répondu)' });
  }

  // Salaire : la règle lit seule un montant ; plusieurs → le modèle choisit la phrase de paie, le code vérifie.
  let salaryRead = salaryByRules(clean, criteria.taux_eur);
  const salaryDoubt = salaryRead.doubt;
  if (salaryRead.doubt !== undefined) {
    const amounts = all.filter((s) => /\d/.test(s) && /[€$£]|\b(eur|gbp|usd|chf|k)\b/i.test(s) && checkSalary(s).ok).slice(0, 6);
    if (amounts.length > 0) {
      const s = pick(await put(QUESTIONS.salaire(amounts)), amounts);
      if (s !== undefined) {
        const c = checkSalary(s);
        if (!c.ok) controls.push(`Salaire : réponse refusée, ${c.why} (« ${short(s)} »)`);
        else salaryRead = salaryByRules(s, criteria.taux_eur);
      }
    }
  }

  // Mode de travail : la règle d'abord ; « non précisé » → question sur les phrases que le code a choisies.
  let work_mode = workModeByRules(clean);
  if (work_mode.value === 'not_stated') {
    const list = all.filter((s) => WM_WORDS.test(s)).slice(0, 8);
    if (list.length > 0) {
      const a = await put(QUESTIONS.mode(list));
      const s = pick(a, list);
      if (a?.answer !== undefined && a.answer !== 'not_stated' && s !== undefined) {
        const c = checkWorkMode(a.answer, s);
        if (c.ok) work_mode = { value: a.answer as Extraction['work_mode']['value'], quote: s };
        else controls.push(`Mode de travail : réponse refusée, ${c.why} (« ${short(s)} »)`);
      }
    }
  }

  // Zone d'embauche : jamais lue par les règles ; question sur les phrases géographiques.
  let hiring_zone: NonNullable<Extraction['hiring_zone']> = { value: 'not_stated', quote: '' };
  const zl = all.filter((s) => ZONE_WORDS.test(s)).slice(0, 8);
  if (zl.length > 0) {
    const a = await put(QUESTIONS.zone(zl));
    const s = pick(a, zl);
    if ((a?.answer === 'open' || a?.answer === 'closed') && s !== undefined) {
      const c = checkZone(a.answer, s);
      if (c.ok) hiring_zone = { value: a.answer, quote: s };
      else controls.push(`Zone : réponse refusée, ${c.why} (« ${short(s)} »)`);
    }
  }

  // Expérience : le code.
  const years = scanExperienceYears(clean).filter((e) => e.years_min !== null).sort((a, b) => (b.years_min as number) - (a.years_min as number));
  const top = years[0];
  const extraction: Extraction = {
    languages,
    not_required,
    salary: salaryRead.salary ?? null,
    salary_ignored: [],
    other_criteria: doubts,
    posting_language: { code: postingLanguage, quote: all.find((s) => s.length >= 60) ?? '' },
    work_mode,
    experience: top !== undefined ? { years_min: top.years_min, years_max: top.years_max, seniority_label: null, quote: top.excerpt, ignored: [] } : { years_min: null, years_max: null, seniority_label: null, quote: '', ignored: [] },
    core_requirements: null,
    hiring_zone,
    summary: 'tri par le modèle local',
  };
  const { published, readAt } = offerPublished(offerJson);
  const rule = salaryRead.doubt !== undefined && salaryRead.salary === undefined ? { ...criteria, salaire_inconnu: 'garder' as const } : criteria;
  const decision = decideTriage(extraction, rule, postingFull, { title: offerTitle(offerJson, posting), source: offerSource(offerJson, posting), posting: clean, published, readAt, now, profileGiven: false });
  const kept = decision.notes.filter((n) => !n.startsWith('Adéquation au cœur du poste non évaluée') && !(salaryRead.salary === undefined && salaryDoubt !== undefined && n === "Salaire non indiqué dans l'annonce"));
  if (salaryRead.salary === undefined && salaryDoubt !== undefined) notes.push(`Salaire non tranché, offre gardée : ${salaryDoubt}`);
  const allNotes = [...kept, ...notes, ...controls];
  if (questions.length > 0 && questions.every((q) => q.answer === null)) allNotes.push('Le modèle local n\'a répondu à aucune question : critères laissés « non précisé »');
  // La page entière (habillage compris : LinkedIn y écrit « Les candidatures ne sont plus acceptées »).
  const closed = closedPostingSentence(posting);
  if (closed !== '') return { ...decision, decision: 'ecartee', reasons: [`Annonce close : « ${closed} »`], notes: allNotes, questions, controls };
  return { ...decision, notes: allNotes, questions, controls };
}

// ── Ollama ─────────────────────────────────────────────────────────────────

/**
 * Le client Ollama : `/api/generate` sans flux, sortie imposée par le schéma de la question,
 * température 0, contexte constant (cache du préfixe), modèle gardé chargé `keep_alive`.
 * Une erreur réseau ou une sortie illisible lève : la question est comptée sans réponse.
 */
export function ollamaAsk(url: string, model: string = DEFAULT_LOCAL_MODEL, options: { keepAlive?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Ask {
  const doFetch = options.fetchImpl ?? fetch;
  return async (q) => {
    const res = await doFetch(`${url.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: q.prompt, stream: false, format: q.schema, keep_alive: options.keepAlive ?? '30m', options: { num_ctx: 4096, temperature: 0, num_predict: 40 } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
    const d = (await res.json()) as { response?: string; error?: string };
    if (d.error) throw new Error(d.error);
    const v = JSON.parse(String(d.response ?? '')) as Answer;
    if (v === null || typeof v !== 'object') throw new Error('sortie hors schéma');
    return v;
  };
}
