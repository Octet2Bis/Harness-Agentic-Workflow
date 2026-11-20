/**
 * Une seule déclaration de l'URL de candidature : celle du lien quand il mène déjà à
 * l'employeur, celle trouvée par `resolve` sinon ; refusée si elle pointe encore vers un
 * agrégateur ou n'est pas https. Pure ; exécutée pour de vrai par les fixtures.
 *
 * Liaisons : INPUTS_ROUTE (sortie de `route`), INPUTS_RESOLVED (sortie de `resolve`, null si sauté).
 */

import { emit, nullableJson } from '../../.shared/io.ts';
import { applyUrlProblems, detectRoute, isMailto } from '../../.shared/platforms.ts';

interface Route {
  platform: string;
  method: string;
  needs_resolve: boolean;
  apply_url: string;
}
interface Resolved {
  apply_url: string;
  easy_apply: boolean;
  how: string;
}

const route = nullableJson(process.env.INPUTS_ROUTE) as Route | null;
const resolved = nullableJson(process.env.INPUTS_RESOLVED) as Resolved | null;

if (route === null) {
  emit({ ok: false, apply_url: '', platform: 'unknown', method: 'form', problems: ['route produced no output'], summary: 'No route.' });
} else {
  const url = route.needs_resolve ? (resolved?.apply_url ?? '').trim() : route.apply_url;
  const easyApply = resolved?.easy_apply === true;
  const problems = applyUrlProblems(url, { easyApply });
  if (route.needs_resolve && resolved === null) problems.unshift('the aggregator link was not resolved to an application page');
  const final = isMailto(url) ? { platform: 'email', method: 'email', label: 'e-mail' } : { ...detectRoute(url), method: easyApply ? 'easy_apply' : detectRoute(url).method };
  emit({
    ok: problems.length === 0,
    apply_url: problems.length === 0 ? url : '',
    platform: problems.length === 0 ? final.platform : 'unknown',
    method: problems.length === 0 ? final.method : 'form',
    problems,
    summary: problems.length === 0 ? `Apply on ${final.label} (${final.method}): ${url}${resolved?.how ? ` — ${resolved.how}` : ''}` : problems.join('; '),
  });
}
