/**
 * Faut-il un « go » humain avant le clic final ? Dérivé du mode et de la liste des
 * plateformes vérifiées (`.shared/platforms.ts`, pur, testé). Aucune lecture disque :
 * les fixtures l'exécutent pour de vrai. `check-prefill.ts` fait le même calcul : un champ
 * laissé « à remplir par Antoine » n'est admis que si ce go suivra.
 *
 * Liaisons : INPUTS_MODE, INPUTS_PLATFORM, INPUTS_VERIFIED_PLATFORMS.
 */

import { emit, text } from '../../.shared/io.ts';
import { needsHumanGo, parseSubmitMode, parseVerifiedPlatforms } from '../../.shared/platforms.ts';

// Même lecture que `check-prefill.ts`, qui en déduit si des champs peuvent rester à Antoine.
const mode = parseSubmitMode(text(process.env.INPUTS_MODE));
const platform = text(process.env.INPUTS_PLATFORM).trim() || 'unknown';
const verified = parseVerifiedPlatforms(text(process.env.INPUTS_VERIFIED_PLATFORMS));
const needsGo = needsHumanGo(mode, platform, verified);
emit({
  needs_go: needsGo,
  reason: needsGo
    ? `mode ${mode}: platform "${platform}" needs a human go before the final click`
    : `mode ${mode}: platform "${platform}" is sent without asking`,
});
