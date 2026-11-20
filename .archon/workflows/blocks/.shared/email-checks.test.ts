import { describe, expect, test } from 'bun:test';
import { DEFAULT_SEQUENCE_RULES, checkSequence, parseTouches, similarity } from './email-checks.ts';

const good = `# Séquence — Head of Growth, SaaS B2B 20-200 salariés

## T1 — Le signal
**Objet :** Votre page pricing a changé la semaine dernière
Bonjour Claire,

Votre nouvelle page pricing met en avant l'offre équipe. Chez Way2Tech on a vu ce changement doubler les démos entrantes quand le tracking suivait chaque palier.

Vous mesurez déjà quel palier convertit ?

Antoine

## T2 — La preuve
**Objet :** Comment Be Mate a fiabilisé son ROAS
Bonjour Claire,

Chez Be Mate, un plan de taggage GTM + CAPI a rendu l'attribution lisible en trois semaines, sans refonte du site.

Un retour d'expérience de dix minutes vous serait utile ?

Antoine

## T3 — L'angle décideur
**Objet :** Une question pour votre prochain comité produit
Bonjour Claire,

Si le comité arbitre le budget acquisition au trimestre, un tableau CAC par palier évite les débats d'opinion. Je peux vous montrer le gabarit que j'utilise.

Je vous l'envoie ?

Antoine

## T4 — Break-up
**Objet :** Je clos le sujet
Bonjour Claire,

Dernier message de ma part : si le moment n'est pas le bon, je ne reviendrai pas. Le gabarit reste disponible si le sujet revient.

Dois-je le laisser à quelqu'un d'autre chez vous ?

Antoine

## Notes
Signal : refonte pricing (LinkedIn, 12/10). Cadence : J0, J+3, J+7, J+14. Cible Gold ≥ 85 uniquement.`;

describe('parseTouches', () => {
  test('découpe les touches, lit l’objet et le corps', () => {
    const touches = parseTouches(good);
    expect(touches.map((t) => t.index)).toEqual([1, 2, 3, 4]);
    expect(touches[0].subject).toBe('Votre page pricing a changé la semaine dernière');
    expect(touches[0].body.startsWith('Bonjour Claire')).toBe(true);
    expect(touches[0].body.includes('Objet')).toBe(false);
  });
  test('deux angles différents ne se ressemblent pas', () => {
    const [a, b] = parseTouches(good);
    expect(similarity(a.body, b.body)).toBeLessThan(0.5);
    expect(similarity(a.body, a.body)).toBe(1);
  });
});

describe('checkSequence', () => {
  test('accepte une séquence conforme', () => {
    expect(checkSequence(good, DEFAULT_SEQUENCE_RULES)).toEqual({ ok: true, problems: [], touches: 4 });
  });
  test('nomme les problèmes : touche manquante, spam, variable, longueur, pas de question, pas de break-up', () => {
    const bad = good
      .replace(/## T4 — Break-up[\s\S]*?## Notes/, '## Notes')
      .replace('Votre nouvelle page pricing', 'OFFRE EXCEPTIONNELLE GRATUIT {{FIRSTNAME}} : votre nouvelle page pricing')
      .replace('Vous mesurez déjà quel palier convertit ?', 'Vous mesurez déjà quel palier convertit.')
      .replace('Chez Be Mate, un plan', `Chez Be Mate, ${'mot '.repeat(130)}un plan`);
    const result = checkSequence(bad, DEFAULT_SEQUENCE_RULES);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('sequence has 3 touch(es) ("## T<n> — <angle>"), 4 expected');
    expect(result.problems).toContain('unresolved template variable ({{…}} or [FIRSTNAME]) found');
    expect(result.problems).toContain('T1: spam trigger "gratuit"');
    expect(result.problems).toContain('T1: no question (one clear ask per touch)');
    expect(result.problems.some((p) => p.startsWith('T2: body is') && p.includes('at most 120'))).toBe(true);
    expect(result.problems).toContain('T3: the last touch must be a courteous break-up (say it is the last note)');
  });
  test('refuse deux touches qui répètent le même angle', () => {
    const twice = good.replace(/## T2 — La preuve[\s\S]*?## T3/, `## T2 — Bis\n**Objet :** Encore le pricing\n${parseTouches(good)[0].body}\n\n## T3`);
    expect(checkSequence(twice, DEFAULT_SEQUENCE_RULES).problems.some((p) => p.includes('repeat the same angle'))).toBe(true);
  });
});

describe('mentions de prospection (requireNotice)', () => {
  const rules = { ...DEFAULT_SEQUENCE_RULES, requireNotice: true };
  const stop = 'Répondez stop et je ne vous écrirai plus.';
  const source = 'Votre adresse figure sur la page équipe de votre site.';
  const withNotice = good
    .replace('Vous mesurez déjà quel palier convertit ?', `Vous mesurez déjà quel palier convertit ?\n\n${source} ${stop}`)
    .replace('Un retour d\'expérience de dix minutes vous serait utile ?', `Un retour d'expérience de dix minutes vous serait utile ?\n\n${stop}`)
    .replace('Je vous l\'envoie ?', `Je vous l'envoie ?\n\n${stop}`)
    .replace('Le gabarit reste disponible si le sujet revient.', `Le gabarit reste disponible si le sujet revient. ${stop}`);

  test('sans l\'option, la séquence de référence passe toujours', () => {
    expect(checkSequence(good, DEFAULT_SEQUENCE_RULES).ok).toBe(true);
  });

  test('avec l\'option, chaque touche offre le stop et la première dit d\'où vient l\'adresse', () => {
    expect(checkSequence(withNotice, rules).problems).toEqual([]);
  });

  test('refuse une touche sans moyen de dire stop et une première touche muette sur la source', () => {
    const result = checkSequence(withNotice.replace(`${source} `, '').replace(`Je vous l'envoie ?\n\n${stop}`, "Je vous l'envoie ?"), rules);
    expect(result.problems).toEqual([expect.stringContaining('T3: no simple way to stop'), expect.stringContaining('T1: the first touch does not say where the address comes from')]);
  });
});
