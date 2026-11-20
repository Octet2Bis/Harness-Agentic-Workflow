/**
 * SENTINELLE LINGUISTIQUE & JURIDIQUE (Inspecteur 1)
 * Pilier : 02_Assistant_Personnel (< 70 lignes)
 * Contrat : Vérifie statistiquement par N-grams que la langue de travail est 100% FR ou EN.
 */

const NGRAM_PROFILES = {
  fr: [' de ', ' le ', ' la ', ' et ', ' en ', ' un ', 'une', 'des', 'les', 'que', 'dans', 'pour', 'sur', 'avec', 'sont', 'ment', 'tion', 'ique'],
  en: ['the', 'and', 'with', 'for', 'you', 'that', 'this', 'have', 'from', 'our', 'are', 'not', 'your', 'will', 'team', 'tion', 'ing ', 'ment'],
  es: [' de ', ' la ', ' en ', ' el ', ' y ', ' a ', ' que ', 'los', 'del', 'las', 'por', 'con', 'para', 'una', 'sus', 'como', 'cion', 'idad', 'bajo', 'amos'],
  it: [' di ', ' che ', ' e ', ' la ', ' il ', ' un ', ' per ', ' in ', 'del', 'non', 'con', 'una', 'sono', 'della', 'dei', 'delle', 'zione', 'iamo'],
  de: ['der', 'die', 'das', 'und', 'von', 'zu ', 'mit', 'ist', 'des', 'nicht', 'ein', 'eine', 'aufgaben', 'ung ', 'keit', 'lich', 'isch', 'schaft'],
  nl: ['van', 'het', 'een', ' en ', 'dat', 'op ', 'te ', 'voor', 'met', 'zijn', 'aan', 'niet', 'om ', 'geen', 'werk', 'ing ', 'heid', 'baar']
};

function scoreLanguage(text) {
  const clean = ` ${text.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ' ').replace(/\s+/g, ' ')} `;
  const scores = { fr: 0, en: 0, es: 0, it: 0, de: 0, nl: 0 };
  for (const [lang, grams] of Object.entries(NGRAM_PROFILES)) {
    for (const g of grams) if (clean.includes(g)) scores[lang] += 1;
  }
  return scores;
}

function evaluateLanguage(job, taxonomy) {
  const fullText = `${job.title} ${job.description} ${job.skills_required} ${job.company} ${job.company_hq || ''}`.toLowerCase();

  // 1. Rejet cyrillique / grec
  if (/[Ѐ-ӿͰ-Ͽ]/.test(fullText)) {
    return { pass: false, reason: 'Alphabet non latin détecté (cyrillique / grec)' };
  }

  // 2. Rejet des suffixes légaux de genre non-FR/EN dans le titre (:in, *in, m/w/d, m/v/x...)
  if (/(?:[:*_]in\b|\b[a-z]+:in\b|\b[a-z]+\*in\b|\b[a-z]+_in\b|\bm\/w\/[dx]\b|\(m\/w\/[dx]\)|\(w\/m\/d\)|\(m\/v\/x\)|\(gn\)\b)/i.test(job.title || '')) {
    return { pass: false, reason: 'Suffixe légal de genre non-FR/EN détecté dans le titre (:in, *in, m/w/d...)' };
  }

  // 3. Titre explicitement dans une langue tierce ou exigeant une langue tierce
  if (/\b(?:consultor\/a|amministrativo|acquisti|responsabile|desarrollador|práctica|tirocinio|stage|german speaking|spanish speaking|italian speaking)\b/i.test(job.title)) {
    return { pass: false, reason: `Intitulé en langue étrangère non autorisée : "${job.title}"` };
  }

  // 4. Détection statistique par N-grams (Profil fréquentiel)
  const scores = scoreLanguage(fullText);
  const bestLang = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  // Rejet si une langue tierce (ES, IT, DE, NL) est la plus probable avec un score marqué
  if (['es', 'it', 'de', 'nl'].includes(bestLang[0]) && bestLang[1] >= 4) {
    return { pass: false, reason: `Langue étrangère détectée par N-grams (${bestLang[0].toUpperCase()}, score: ${bestLang[1]})` };
  }

  // Si l'annonce est sur un sous-domaine étranger, exiger une dominance FR ou EN certifiée
  const isForeignSub = /^https?:\/\/(?:de|at|ch|es|it|nl|pl|pt|se|dk|no|fi)\.linkedin\.com/i.test(job.link || '');
  if (isForeignSub && Math.max(scores.fr, scores.en) < 4) {
    return { pass: false, reason: 'Offre sur domaine étranger sans dominance linguistique FR ou EN certifiée' };
  }

  return { pass: true, reason: `Langue de travail FR/EN validée (${bestLang[0].toUpperCase()})` };
}

module.exports = { evaluateLanguage, scoreLanguage };
