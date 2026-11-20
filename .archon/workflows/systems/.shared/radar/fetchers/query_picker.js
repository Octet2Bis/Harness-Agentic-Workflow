/**
 * query_picker.js — Les requêtes des sources interrogées par mot-clé (Adzuna, Jobgether, JSearch,
 * Jobdatalake quand son adresse porte {keyword}), avec un curseur tournant
 * Pilier : 02_Assistant_Personnel / Career Ops
 *
 * Avant le 2026-10-23, ces sources prenaient les premières `search_queries` de la taxonomie,
 * toujours les mêmes, souvent en français (« chargé de revops ») : Adzuna rendait 0 offre sur
 * 6 pays. Désormais :
 * - `source_queries` de la taxonomie (liste par priorité, en anglais de préférence) quand elle
 *   est donnée ;
 * - sinon, pour Antoine (taxonomie sans `core_domains`), `DEFAULT_SOURCE_QUERIES` : ses
 *   intitulés cœur en anglais ;
 * - sinon (un autre candidat), ses `search_queries`, comme avant.
 * Chaque source avance son propre curseur (`query_cursor` de source_state.json) du nombre de
 * requêtes qu'elle consomme par cycle : d'un cycle à l'autre, la liste défile, le quota par cycle
 * ne change pas (Adzuna : 6 pays × `queries_max` 1 = 6 appels, toutes les 120 min ≈ 72 / jour).
 */

const DEFAULT_SOURCE_QUERIES = [
  'growth marketing manager',
  'product operations',
  'crm manager',
  'marketing automation',
  'email marketing',
  'lifecycle marketing',
  'revops'
];

const clean = list => (Array.isArray(list) ? list.map(q => String(q || '').trim()).filter(Boolean) : []);

// La liste de requêtes des sources par mot-clé, dans l'ordre de priorité, sans doublon.
function sourceQueries(taxonomy = {}) {
  const own = clean(taxonomy.source_queries);
  const list = own.length > 0 ? own
    : (Array.isArray(taxonomy.core_domains) && taxonomy.core_domains.length > 0 ? clean(taxonomy.search_queries) : DEFAULT_SOURCE_QUERIES);
  const seen = new Set();
  return list.filter(q => { const k = q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// La liste commencée au curseur (modulo sa longueur) : les `n` premières sont celles du cycle.
function rotate(list, cursor) {
  if (list.length === 0) return [];
  const c = ((Number(cursor) || 0) % list.length + list.length) % list.length;
  return [...list.slice(c), ...list.slice(0, c)];
}

// Rend la liste tournée pour `key` et avance son curseur de `n` dans `state.query_cursor` (muté).
function takeQueries(state, key, list, n) {
  const cursors = state.query_cursor && typeof state.query_cursor === 'object' ? state.query_cursor : {};
  const cursor = Number(cursors[key]) || 0;
  const out = rotate(list, cursor);
  if (list.length > 0) state.query_cursor = { ...cursors, [key]: (cursor + Math.max(1, n)) % list.length };
  return out;
}

module.exports = { DEFAULT_SOURCE_QUERIES, sourceQueries, rotate, takeQueries };
