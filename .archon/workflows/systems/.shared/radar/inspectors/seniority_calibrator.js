/**
 * CALIBREUR DE SÉNIORITÉ & SCOPE (Inspecteur 3)
 * Pilier : 02_Assistant_Personnel (< 70 lignes)
 * Contrat : Vérifie que le niveau exigé est strictement de 1 à 3 ans et dans le domaine Growth / Marketing.
 * Un autre candidat donne ses propres mots de domaine (`core_domains` de sa taxonomie) ; sans
 * eux, ce sont ceux d'Antoine ci-dessous.
 */

const CORE_DOMAINS = [
  'growth', 'marketing', 'acquisition', 'crm', 'traffic', 'media', 'paid',
  'seo', 'sea', 'cro', 'revops', 'demand', 'lifecycle', 'inbound', 'ads',
  'conversion', 'digital', 'content', 'ops', 'gtm', 'automation', 'operations',
  // 2026-11-14 (Antoine : Canonical et PostHog sont « exactement le cœur de cible ») : métiers voisins.
  'marketer', 'sales', 'enablement', 'customer success', 'community', 'communication', 'brand', 'partnership', 'business development', 'business developer', 'developer relations', 'devrel', 'social media', 'go-to-market', 'commercial', 'croissance'
];

// « lead » et « partner » ne disent pas le niveau (Product Marketing Lead, Partner Marketing Manager) : jamais disqualifiants.
const DROPPED_LABELS = new Set(['lead', 'partner']);

function evaluateSeniority(job, taxonomy) {
  // Les mots de niveau se lisent dans l'INTITULÉ seulement (2026-11-14) : dans le texte, « lead
  // generation », « our sales leaders », « report to the Senior Director » écartaient des postes justes.
  // Dans le texte, seules les exigences d'années (« 5+ years », « 5-7 years », « 6+ ans ») comptent.
  const titleText = String(job.title || '').toLowerCase();
  const fullText = `${job.title} ${job.description} ${job.skills_required}`.toLowerCase();
  const disqLabels = (taxonomy?.target_experience?.disqualified_labels || [
    'senior', 'sr.', 'principal', 'staff', 'director', 'directeur', 'head of',
    'vp', 'chief', 'c-level', '5+ years', '6+ years', '10+ years'
  ]).filter(l => !DROPPED_LABELS.has(String(l).toLowerCase()));

  for (const label of disqLabels) {
    const years = /\d/.test(label);
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i');
    if (re.test(years ? fullText : titleText)) {
      return { pass: false, reason: `Critère d'expérience trop élevé détecté : "${label}"` };
    }
  }

  // Vérification du domaine Growth / Marketing / Ops dans le titre ou correspondance taxonomie
  const titleLower = job.title.toLowerCase();
  const queries = taxonomy?.search_queries || [];
  const matchesTaxonomy = queries.some(q => {
    const ql = q.toLowerCase();
    return titleLower.includes(ql) || ql.includes(titleLower);
  });
  const domains = Array.isArray(taxonomy?.core_domains) && taxonomy.core_domains.length > 0 ? taxonomy.core_domains.map(d => String(d).toLowerCase()) : CORE_DOMAINS;
  const hasDomain = domains.some(d => titleLower.includes(d)) || matchesTaxonomy;
  if (!hasDomain) {
    return { pass: false, reason: domains === CORE_DOMAINS ? `Titre hors domaine Growth / Marketing Digital : "${job.title}"` : `Titre hors domaine du candidat : "${job.title}"` };
  }

  return { pass: true, reason: 'Calibrage 1-3 ans et adéquation métier validés' };
}

module.exports = { evaluateSeniority };
