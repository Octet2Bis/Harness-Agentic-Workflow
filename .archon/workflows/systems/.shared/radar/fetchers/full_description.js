/**
 * full_description.js — La description complète d'une annonce, quand la source la donne
 * Pilier : 02_Assistant_Personnel / Career Ops
 * `description` reste le résumé de 400 caractères que lit le jury (inchangé, parité VM) ;
 * `description_full` porte le texte entier de l'annonce (HTML retiré, paragraphes gardés,
 * 15 000 caractères au plus) pour que le tri (career-triage) lise l'annonce même quand la page
 * de l'offre ne se laisse pas lire (mur, ATS en JavaScript). Les API qui la donnent : Himalayas
 * (`description`), Working Nomads, RemoteOK, Remotive, Arbeitnow (`description`), Jobicy
 * (`jobDescription`), les flux RSS (`content:encoded` ou `description`), JSearch
 * (`job_description`), l'acteur Apify (`description`). Ajouté le 2026-10-23 : 34 tris sur 79
 * ne lisaient que le résumé du radar.
 */

const FULL_DESCRIPTION_MAX = 15000;
/** En dessous, le texte n'en dit pas plus que le résumé : le champ n'est pas posé. */
const FULL_DESCRIPTION_MIN = 400;

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ' };

// Le HTML (éventuellement échappé : « &lt;p&gt; ») en texte : blocs en lignes, balises retirées,
// espaces réduits ligne par ligne, lignes vides supprimées. `&amp;` est décodé en dernier.
function htmlToText(html) {
  let s = String(html || '');
  for (let k = 0; k < 2 && /&lt;\/?[a-z]/i.test(s); k++) s = s.replace(/&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&#160;/g, m => ENTITIES[m]).replace(/&amp;/g, '&');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|ul|ol|tr|section|article)\s*>|<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&#160;/g, m => ENTITIES[m])
    .replace(/&amp;/g, '&');
  return s.split('\n').map(l => l.replace(/[ \t\r\f\v ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// `{ description_full }` à étaler dans l'offre quand la source donne plus que le résumé, `{}` sinon.
function fullDescriptionField(html) {
  const text = htmlToText(html);
  if (text.length < FULL_DESCRIPTION_MIN) return {};
  return { description_full: text.length > FULL_DESCRIPTION_MAX ? `${text.slice(0, FULL_DESCRIPTION_MAX)}…` : text };
}

module.exports = { htmlToText, fullDescriptionField, FULL_DESCRIPTION_MAX, FULL_DESCRIPTION_MIN };
