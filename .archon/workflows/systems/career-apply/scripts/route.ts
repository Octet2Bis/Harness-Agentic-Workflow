/**
 * Où se postule cette offre ? Table des plateformes (pure, testée). Un lien d'agrégateur
 * (LinkedIn, Himalayas…) n'est pas une page de candidature : le nœud `resolve` ira
 * chercher celle de l'employeur. Pas d'E/S : les fixtures l'exécutent pour de vrai.
 *
 * Une offre LinkedIn dont la page publique donne la page employeur (`direct_apply`, lue par load)
 * part directement sur cette page : pas de `resolve`, pas de session LinkedIn.
 *
 * Liaisons : INPUTS_LINK, INPUTS_DIRECT_APPLY.
 */

import { emit, text } from '../../.shared/io.ts';
import { detectRoute } from '../../.shared/platforms.ts';

const board = text(process.env.INPUTS_LINK).trim();
const direct = text(process.env.INPUTS_DIRECT_APPLY).trim();
const viaBoard = detectRoute(board);
// La page employeur lue par load remplace le lien d'agrégateur.
const link = viaBoard.aggregator && /^https:\/\//i.test(direct) ? direct : board;
const route = detectRoute(link);
const needsResolve = link === '' || route.aggregator;
emit({
  platform: route.platform,
  method: route.method,
  aggregator: route.aggregator,
  needs_account: route.needsAccount,
  needs_resolve: needsResolve,
  apply_url: needsResolve ? '' : link,
  summary: needsResolve
    ? `${route.label} is an aggregator: the employer's application page must be resolved from ${link || '(no link)'}`
    : link !== board
      ? `Apply directly on ${route.label} (${route.host}), the employer page given by the ${viaBoard.label} posting`
      : `Apply directly on ${route.label} (${route.host})`,
});
