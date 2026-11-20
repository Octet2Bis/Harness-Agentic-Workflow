/**
 * Le tri sans modèle (moteur `rules` de `career-triage`, défaut depuis le 2026-10-30) : les
 * balayages du code (`.shared/triage-checks.ts`, le filet du bloc `job-triage`) tiennent lieu
 * d'extraction, et la même règle (`decideTriage`) décide. Aucun appel de modèle, donc aucune
 * consommation du forfait Claude quand le cockpit trie seul chaque nouvelle offre.
 *
 * Ce que le code tranche seul : la langue de rédaction (mots-outils, `detectLanguage`), le mode de
 * travail quand les marqueurs ne se contredisent pas (hybride, sur site, jours au bureau pendant
 * l'intégration ; télétravail complet écrit), les années d'expérience exigées, l'intitulé senior,
 * un salaire écrit une seule fois avec sa devise. Ce qu'il ne sait pas lire devient un doute
 * (« à vérifier ») : une langue étrangère nommée près d'un mot d'exigence (exigée ou souhaitée ?),
 * plusieurs montants, des marqueurs contradictoires. Jamais lus : la zone d'embauche et le cœur
 * du poste face au profil (une note le dit). Une annonce écrite dans une écriture non latine
 * (cyrillique…) a sa langue lue par l'écriture ; une annonce close est écartée.
 */

import { type Criteria, type Extraction, type Period, type TriageDecision, closedPostingSentence, decideTriage, detectLanguage, scriptLanguage, detectWorkMode, languageLabel, markerSentence, normalize, offerPublished, offerSource, offerTitle, postingBody, quoteNumbers, scanExperienceYears, scanLanguageMentions, scanSalaryAmounts } from '../../blocks/.shared/triage-checks.ts';

export { readCriteria } from '../../blocks/.shared/triage-checks.ts';

/** La note écrite sur chaque tri du moteur `rules`. */
export const RULES_NOTE = 'Tri par les règles du code, sans modèle : zone d\'embauche et cœur du poste non lus, une langue étrangère nommée reste à vérifier';

const CURRENCIES: { code: string; pattern: RegExp }[] = [
  { code: 'EUR', pattern: /€|\beur(?:os?)?\b/i },
  { code: 'GBP', pattern: /£|\bgbp\b/i },
  { code: 'CHF', pattern: /\bchf\b/i },
  { code: 'PLN', pattern: /\bpln\b|\bz[lł]\b|zł/i },
  { code: 'SEK', pattern: /\bsek\b/i },
  { code: 'DKK', pattern: /\bdkk\b/i },
  { code: 'NOK', pattern: /\bnok\b/i },
  { code: 'CZK', pattern: /\bczk\b|\bkc\b/i },
  { code: 'RON', pattern: /\bron\b|\blei\b/i },
  { code: 'HUF', pattern: /\bhuf\b/i },
  { code: 'BGN', pattern: /\bbgn\b/i },
  { code: 'CAD', pattern: /\bcad\b/i },
  { code: 'AUD', pattern: /\baud\b/i },
  { code: 'USD', pattern: /\$|\busd\b/i },
];

function periodOf(excerpt: string): Period {
  const t = normalize(excerpt);
  if (/(?:per|par|\/|a|an|each)\s*(?:month|mois|mo\b)|monthly|mensuel|brut mensuel/.test(t)) return 'month';
  if (/(?:per|par|\/|an)\s*(?:hour|heure|h\b|hr\b)|hourly|horaire/.test(t)) return 'hour';
  if (/(?:per|par|\/|a)\s*(?:day|jour)|daily|journalier|tjm/.test(t)) return 'day';
  if (/(?:per|par|\/)\s*(?:week|semaine)|weekly|hebdo/.test(t)) return 'week';
  return 'year';
}

/**
 * Le salaire que le code lit seul : un seul montant (ou une fourchette) avec sa devise ; annuel
 * sauf mention d'une autre période ; un montant « annuel » sous 10 000 est illisible (période
 * omise ?), deux nombres hors d'un facteur 3 aussi. Rend `{ salary }`, ou `{ doubt }` quand il y a des montants mais pas de lecture sûre,
 * ou `{}` quand l'annonce n'en donne aucun.
 */
/**
 * Un montant d'avantage n'est pas un salaire : titre-restaurant, remboursement, budget matériel,
 * levée de fonds (Episto, 2026-11-08 : « Carte ticket restaurant Swile de 10 euros par jour » lu
 * 2 180 € brut par an, offre écartée pour salaire). Un extrait qui nomme la paie reste lu.
 */
const PAY_WORDS = /salaire|salary|salaries|remuneration|compensation|\bbase\b|brut|gross|\bote\b|\btjm\b|day rate|daily rate|package|\bpay\b|per annum|annual|annuel|par an\b|per year/;
const PERK_WORDS = /ticket|restaurant|meal|repas|swile|lunch|dejeuner|mutuelle|transport|navigo|rembours|reimburs|allowance|stipend|budget|equipment|equipement|setup|set-up|signing|levee|\bleve\b|raised|funding|series [a-d]\b|revenue|chiffre d'affaires|\barr\b|valuation|valoris/;
export function isPerkAmount(excerpt: string): boolean {
  const t = normalize(excerpt);
  return PERK_WORDS.test(t) && !PAY_WORDS.test(t);
}

export function salaryByRules(posting: string, rates: Record<string, number>): { salary?: Extraction['salary']; doubt?: string } {
  const amounts = scanSalaryAmounts(postingBody(posting)).filter((a) => !isPerkAmount(a));
  if (amounts.length === 0) return {};
  const shown = amounts.slice(0, 2).map((a) => `« ${a} »`).join(', ');
  if (amounts.length > 1) return { doubt: `Plusieurs montants dans l'annonce, à lire : ${shown}` };
  const excerpt = amounts[0];
  const currency = CURRENCIES.find((c) => c.pattern.test(excerpt))?.code ?? '';
  const period = periodOf(excerpt);
  const values = quoteNumbers(excerpt).filter((n) => n > 0 && (period !== 'year' || n >= 10_000));
  // Une fourchette tient dans un facteur 3 ; au-delà, deux montants sans rapport (« 40 000 € … levé 12 000 000 € »).
  if (currency === '' || rates[currency] === undefined || values.length === 0 || values.length > 2 || Math.max(...values) > 3 * Math.min(...values)) return { doubt: `Montant dans l'annonce, à lire : ${shown}` };
  // Un seul nombre : `max` seul (affiché « 45 000 € », pas « 45 000 € à 45 000 € »).
  return { salary: { min: values.length === 2 ? Math.min(...values) : null, max: Math.max(...values), currency, period, quote: excerpt } };
}

/**
 * Le mode de travail que le code lit seul : présence au bureau pour une période → hybride (même à
 * côté d'un « fully remote ») ; marqueurs hybride / sur site sans marqueur de télétravail →
 * hybride ; télétravail complet écrit sans marqueur contraire → full_remote ; « remote or hybrid »
 * (au choix, COROS 2026-11-03), rien, ou les deux → non précisé (à vérifier, ou télétravail d'après une plateforme 100 % télétravail).
 */
/** « remote- or hybrid working arrangement », « hybrid or remote », « remote/hybrid » : le télétravail est offert au choix, le code ne tranche pas. */
const REMOTE_OR_HYBRID = /\bremote\s*-?\s*(?:or|\/|ou)\s*(?:an?\s+)?hybri|\bhybri\w*\s*(?:or|\/|ou)\s*(?:fully\s+|100\s*%\s*)?remote\b|\bteletravail\s*(?:ou|\/)\s*hybride|\bhybride\s*(?:ou|\/)\s*(?:en\s+)?teletravail/;

/** Télétravail partiel chiffré : « jusqu'à 50% télétravail », « 2 jours de télétravail », « 80% remote » (Episto, 2026-11-08 : passé en « non précisé »). */
const PARTIAL_REMOTE = /\b\d{1,2}\s*%\s*(?:de\s+|of\s+)?(?:teletravail|remote)\b|\b[1-4]\s*(?:jours?|days?)\s*(?:de\s+|of\s+)?(?:teletravail|remote|from home|wfh|home ?office)\b/;

export function workModeByRules(posting: string): Extraction['work_mode'] {
  const wm = detectWorkMode(posting);
  const partial = PARTIAL_REMOTE.exec(normalize(postingBody(posting)));
  if (partial !== null && wm.remote.length === 0) return { value: 'hybrid', quote: markerSentence(posting, partial[0]) || partial[0] };
  const quote = (marker: string): string => markerSentence(posting, marker) || marker;
  const choice = REMOTE_OR_HYBRID.exec(normalize(postingBody(posting)));
  if (choice !== null && wm.office_period.length === 0) return { value: 'not_stated', quote: '' };
  if (wm.office_period.length > 0) return { value: 'hybrid', quote: quote(wm.office_period[0]) };
  if (wm.on_site.length > 0 && wm.remote.length === 0) return { value: 'hybrid', quote: quote(wm.on_site[0]) };
  if (wm.remote.length > 0 && wm.on_site.length === 0) return { value: 'full_remote', quote: quote(wm.remote[0]) };
  return { value: 'not_stated', quote: '' };
}

/** Le tri d'une offre par les règles seules : même forme que `decideTriage`, sans modèle. */
export function triageByRules(offerJson: string, posting: string, criteria: Criteria, postingFull: boolean, now: Date = new Date()): TriageDecision {
  const spoken = new Set(criteria.langues);
  const doubts: Extraction['other_criteria'] = [];
  const notes: string[] = [RULES_NOTE];
  const script = scriptLanguage(postingBody(posting));
  const detected = script !== null ? { code: script } : detectLanguage(postingBody(posting));
  const postingLanguage = detected?.code ?? criteria.langues[0] ?? 'en';
  if (detected === null) notes.push("Langue de rédaction non reconnue par le code (texte court ou bilingue)");
  for (const m of scanLanguageMentions(postingBody(posting))) {
    if (spoken.has(m.code) || m.code === postingLanguage) continue;
    doubts.push({ criterion: `Langue nommée : ${languageLabel(m.code)}`, met: false, quote: m.excerpt, note: 'exigée ou souhaitée, à lire' });
  }
  const salary = salaryByRules(posting, criteria.taux_eur);
  if (salary.doubt !== undefined) doubts.push({ criterion: 'Salaire', met: false, quote: '', note: salary.doubt });
  const years = scanExperienceYears(posting).filter((e) => e.years_min !== null);
  const top = years.sort((a, b) => (b.years_min as number) - (a.years_min as number))[0];
  const extraction: Extraction = {
    languages: [],
    not_required: [],
    salary: salary.salary ?? null,
    salary_ignored: [],
    other_criteria: doubts,
    posting_language: { code: postingLanguage, quote: '' },
    work_mode: workModeByRules(posting),
    experience: top !== undefined ? { years_min: top.years_min, years_max: top.years_max, seniority_label: null, quote: top.excerpt, ignored: [] } : { years_min: null, years_max: null, seniority_label: null, quote: '', ignored: [] },
    core_requirements: null,
    hiring_zone: null,
    summary: 'tri par règles',
  };
  const { published, readAt } = offerPublished(offerJson);
  // Des montants que le code ne sait pas lire ne sont pas « un salaire absent » : la règle du salaire inconnu ne joue pas, le doute le dit.
  const rule = salary.doubt !== undefined ? { ...criteria, salaire_inconnu: 'garder' as const } : criteria;
  const decision = decideTriage(extraction, rule, postingFull, { title: offerTitle(offerJson, posting), source: offerSource(offerJson, posting), posting, published, readAt, now, profileGiven: false });
  const kept = decision.notes.filter((n) => !n.startsWith('Adéquation au cœur du poste non évaluée') && !(salary.doubt !== undefined && n === "Salaire non indiqué dans l'annonce"));
  // Une annonce close ne prend plus de candidatures : écartée, quoi que disent les autres critères.
  const closed = closedPostingSentence(posting);
  if (closed !== '') return { ...decision, decision: 'ecartee', reasons: [`Annonce close : « ${closed} »`], notes: [...kept, ...notes] };
  return { ...decision, notes: [...kept, ...notes] };
}
