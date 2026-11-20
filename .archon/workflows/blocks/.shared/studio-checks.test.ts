import { describe, expect, test } from 'bun:test';
import {
  calibratedType,
  checkBrief,
  checkCalibration,
  checkContent,
  checkDesignDoc,
  checkTokens,
  contrast,
  localeMismatch,
  numbersIn,
  routeFor,
  sections,
  tokenExists,
  undocumentedComponents,
} from './studio-checks.ts';

// ── Cadrage ──────────────────────────────────────────────────────────────────

const REQUEST =
  "Je veux retravailler Aevum, mon app iOS de pauses actives. Il faut un design system propre et une base de contenu en français et en anglais avant de refaire les écrans.";

function calibration(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'app',
    evidence: ['mon app iOS de pauses actives', 'avant de refaire les écrans'],
    deliverables: ['design system', 'base de contenu FR/EN', 'écrans'],
    platforms: ['ios'],
    existing: ['AevumApp/UI/DesignSystem/Theme.swift'],
    route: routeFor('app'),
    ...patch,
  });
}

describe('checkCalibration', () => {
  const options = { request: REQUEST, exists: (path: string) => path === 'AevumApp/UI/DesignSystem/Theme.swift' };

  test('a well-founded calibration passes and gives its type', () => {
    expect(checkCalibration(calibration(), options)).toEqual({ ok: true, problems: [], type: 'app' });
  });

  test('missing or broken file', () => {
    expect(checkCalibration(null, options).problems[0]).toContain('missing');
    expect(checkCalibration('{', options).problems[0]).toContain('not valid JSON');
    expect(checkCalibration('[]', options).problems[0]).toContain('JSON object');
  });

  test('the type is one of three', () => {
    const result = checkCalibration(calibration({ type: 'website' }), options);
    expect(result.type).toBeNull();
    expect(result.problems.join()).toContain('type must be one of graphique, site, app');
  });

  test('evidence is quoted word for word from the request', () => {
    expect(checkCalibration(calibration({ evidence: [] }), options).problems.join()).toContain('quote at least one passage');
    expect(checkCalibration(calibration({ evidence: ['une application mobile'] }), options).problems.join()).toContain('not in the request');
    expect(checkCalibration(calibration({ evidence: ['iOS'] }), options).problems.join()).toContain('too short');
    // Les guillemets typographiques et les espaces ne comptent pas.
    expect(checkCalibration(calibration({ evidence: ['mon  app iOS de pauses actives'] }), options).ok).toBe(true);
  });

  test('platforms fit the type', () => {
    expect(checkCalibration(calibration({ platforms: ['print'] }), options).problems.join()).toContain('does not fit a app project');
    expect(checkCalibration(calibration({ type: 'site', platforms: ['ios'], route: routeFor('site') }), options).problems.join()).toContain('does not fit a site project');
    expect(checkCalibration(calibration({ platforms: [] }), options).problems.join()).toContain('at least one target platform');
  });

  test('existing files are real', () => {
    expect(checkCalibration(calibration({ existing: ['Theme.swift'] }), options).problems.join()).toContain('does not exist');
    expect(checkCalibration(calibration({ existing: 'none' }), options).problems.join()).toContain('a list (possibly empty)');
    expect(checkCalibration(calibration({ existing: ['anything'] }), { request: REQUEST }).ok).toBe(true);
  });

  test('the route is the one the type imposes', () => {
    const result = checkCalibration(calibration({ route: routeFor('site') }), options);
    expect(result.problems.join()).toContain('route must be exactly brief → design-system → content-base → prd → ecrans');
    expect(routeFor('graphique')).toEqual([
      'brief', 'design-system', 'content-base', 'direction-artistique', 'declinaisons', 'kit-de-marque', 'qa-finale', 'go', 'diffusion',
    ]);
  });

  test('deliverables are named', () => {
    expect(checkCalibration(calibration({ deliverables: [' '] }), options).problems.join()).toContain('name at least one thing');
  });
});

// ── Brief ────────────────────────────────────────────────────────────────────

const BRIEF = `# Brief : refonte d'Aevum

## Problème
Les personnes qui passent plus de sept heures par jour sur écran décrochent des pauses actives au bout de quelques jours, parce que le blocage seul crée un vide.

## Cible
Professionnels du savoir et fondateurs, sur iPhone, qui veulent garder leur attention sans quitter leurs outils de travail.

## Contexte d'usage
Au moment où une app bloquée dépasse son seuil, et aux trois moments clés de la journée : matin, après le déjeuner, fin de journée.

## Hors-champ
- Pas de fil social ni de partage public.
- Pas de paywall avant le diagnostic.
- Pas de données biométriques sur un serveur.

## Appétit
Six semaines, une personne : le design system et la base de contenu d'abord, les écrans ensuite.

## Plateforme
Application iOS (SwiftUI), avec un simulateur web pour les démonstrations.

## Critères de réussite
- Les contrastes du design system passent le niveau AA dans les deux thèmes.
- Chaque texte de l'app existe en français et en anglais, sans chiffre inventé.
`;

describe('checkBrief', () => {
  test('a complete brief passes', () => {
    expect(checkBrief(BRIEF, 'app')).toEqual({ ok: true, problems: [] });
  });

  test('missing file, length and title', () => {
    expect(checkBrief(null, 'app').problems[0]).toContain('missing');
    expect(checkBrief('## Problème\ncourt', 'app').problems.join()).toContain('too short');
    expect(checkBrief(BRIEF + 'x'.repeat(6000), 'app').problems.join()).toContain('too long');
    expect(checkBrief(BRIEF.replace("# Brief : refonte d'Aevum\n", ''), 'app').problems.join()).toContain('title line');
  });

  test('every section is there', () => {
    expect(checkBrief(BRIEF.replace('## Appétit', '## Budget'), 'app').problems.join()).toContain('missing section "## Appétit"');
  });

  test('out of scope has three items, success criteria two', () => {
    const fewOut = BRIEF.replace('- Pas de paywall avant le diagnostic.\n', '');
    expect(checkBrief(fewOut, 'app').problems.join()).toContain('Hors-champ: at least 3 items');
    const fewSuccess = BRIEF.replace("- Chaque texte de l'app existe en français et en anglais, sans chiffre inventé.\n", '');
    expect(checkBrief(fewSuccess, 'app').problems.join()).toContain('Critères de réussite: at least 2 items');
  });

  test('the platform fits the calibrated type', () => {
    const iosOnly = BRIEF.replace(', avec un simulateur web pour les démonstrations', '');
    expect(checkBrief(iosOnly, 'graphique').problems.join()).toContain('Plateforme: name at least one platform a graphique project targets');
    expect(checkBrief(iosOnly, 'app').ok).toBe(true);
    expect(checkBrief(BRIEF, null).problems.join()).toContain('calibration type is unknown');
  });

  test('no draft marker', () => {
    expect(checkBrief(BRIEF.replace('Six semaines', 'TODO six semaines'), 'app').problems.join()).toContain('draft marker found: "TODO"');
  });
});

describe('sections', () => {
  test('indexes each ## section by its normalized title', () => {
    const found = sections("# T\n## Contexte d’usage\nA\n## Hors-champ\n- x\n");
    expect(found.get("contexte d'usage")).toBe('A');
    expect(found.get('hors-champ')).toBe('- x');
  });
});

// ── Design system ────────────────────────────────────────────────────────────

const light = { bg: '#ffffff', surface: '#f4f4f2', fg: '#1f2022', muted: '#5c5f66', accent: '#c23800', border: '#d0d1cc' };
const dark = { bg: '#121314', surface: '#1f2022', fg: '#f2f2ee', muted: '#a8abb2', accent: '#ff7a45', border: '#3a3c40' };

function tokens(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    color: { light, dark },
    font: { display: 'Inter Display, system-ui, sans-serif', body: 'Inter, system-ui, sans-serif' },
    type_scale: [12, 14, 16, 20, 25, 31, 39],
    space: [4, 8, 12, 16, 24, 32, 48],
    radius: { none: 0, md: 8, full: 999 },
    components: [
      { name: 'Button', tokens: ['color.accent', 'color.bg', 'radius.md', 'font.body', 'space'], states: ['default', 'hover', 'pressed', 'focus', 'disabled'] },
      { name: 'Card', tokens: ['color.surface', 'color.border', 'radius.md', 'space'], states: ['default'] },
      { name: 'Input', tokens: ['color.bg', 'color.fg', 'color.border', 'type_scale'], states: ['default', 'focus', 'error'] },
    ],
    ...patch,
  });
}

describe('contrast', () => {
  test('WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5);
  });
});

describe('checkTokens', () => {
  test('a coherent token set passes', () => {
    expect(checkTokens(tokens(), 'app')).toEqual({ ok: true, problems: [] });
  });

  test('both themes, every role, hex colours', () => {
    expect(checkTokens(tokens({ color: { light } }), 'app').problems.join()).toContain('color.light and color.dark are both required');
    expect(checkTokens(tokens({ color: { light: { ...light, accent: 'orange' }, dark } }), 'app').problems.join()).toContain('color.light.accent must be a #rrggbb');
    expect(checkTokens(tokens({ color: { light: { ...light, brand: '#000000' }, dark } }), 'app').problems.join()).toContain('same roles');
  });

  test('contrast is measured in both themes', () => {
    const pale = checkTokens(tokens({ color: { light: { ...light, muted: '#9a9a9a' }, dark } }), 'app');
    expect(pale.problems.join()).toContain('contrast light muted on bg');
    const darkAccent = checkTokens(tokens({ color: { light, dark: { ...dark, accent: '#5a2a10' } } }), 'app');
    expect(darkAccent.problems.join()).toContain('contrast dark accent on bg');
  });

  test('type scale ascends at a steady ratio with a body size', () => {
    expect(checkTokens(tokens({ type_scale: [12, 14, 16] }), 'app').problems.join()).toContain('at least 5 sizes');
    expect(checkTokens(tokens({ type_scale: [12, 14, 13, 20, 25] }), 'app').problems.join()).toContain('must ascend');
    expect(checkTokens(tokens({ type_scale: [12, 14, 16, 40, 48] }), 'app').problems.join()).toContain('16 → 40 has ratio 2.50');
    expect(checkTokens(tokens({ type_scale: [20, 24, 28, 34, 40] }), 'app').problems.join()).toContain('body size between 14 and 18');
  });

  test('spacing sits on a grid', () => {
    expect(checkTokens(tokens({ space: [4, 8, 12, 18, 24] }), 'app').problems.join()).toContain('off the 4 px grid: 18');
    expect(checkTokens(tokens({ space: [5, 10, 15, 20, 25] }), 'app').problems.join()).toContain('base of 2, 4 or 8');
    expect(checkTokens(tokens({ space: [4, 8, 8, 16, 24] }), 'app').problems.join()).toContain('space must ascend');
  });

  test('fonts and radius', () => {
    expect(checkTokens(tokens({ font: { body: 'Inter' } }), 'app').problems.join()).toContain('font.display and font.body');
    expect(checkTokens(tokens({ radius: {} }), 'app').problems.join()).toContain('radius');
  });

  test('components use defined tokens and keep a focus state', () => {
    const fewer = JSON.parse(tokens());
    fewer.components = fewer.components.slice(0, 1);
    expect(checkTokens(JSON.stringify(fewer), 'site').problems.join()).toContain('components: at least 3 for a site');
    expect(checkTokens(JSON.stringify(fewer), 'graphique').ok).toBe(true);
    const ghost = JSON.parse(tokens());
    ghost.components[0].tokens.push('color.brand');
    expect(checkTokens(JSON.stringify(ghost), 'app').problems.join()).toContain('token "color.brand" is not defined');
    const noFocus = JSON.parse(tokens());
    noFocus.components[0].states = ['default', 'hover'];
    expect(checkTokens(JSON.stringify(noFocus), 'app').problems.join()).toContain('needs a "focus" state');
    const noDefault = JSON.parse(tokens());
    noDefault.components[1].states = ['hover'];
    expect(checkTokens(JSON.stringify(noDefault), 'app').problems.join()).toContain('must include "default"');
  });
});

describe('tokenExists', () => {
  test('dotted references into the token file', () => {
    const t = JSON.parse(tokens());
    expect(tokenExists(t, 'color.accent')).toBe(true);
    expect(tokenExists(t, 'radius.md')).toBe(true);
    expect(tokenExists(t, 'space')).toBe(true);
    expect(tokenExists(t, 'space.4')).toBe(false);
    expect(tokenExists(t, 'shadow.lg')).toBe(false);
  });
});

const DESIGN_DOC = `# Design system : Aevum

## Intention
Une signalétique de quai suisse : des aplats, une encre, un signal orange pour la seule action qui compte sur l'écran. Rien de flou, rien de décoratif.

## Couleurs
Fond, surface, encre, texte secondaire, accent et bordure, en clair et en sombre. L'accent ne porte que l'action principale ; le texte secondaire reste lisible (AA) sur le fond.

## Typographie
Inter pour le texte, Inter Display pour les titres ; échelle de 12 à 39 px au rapport 1,25, corps à 16 px.

## Espacements
Grille de 4 px : 4, 8, 12, 16, 24, 32, 48. Les écarts entre blocs prennent 24 ou 32, jamais une valeur hors grille.

## Composants
Button (accent sur fond, rayon md, états survol, pression, focus, désactivé), Card (surface et bordure, rayon md), Input (encre, bordure, focus visible).

## Règles d'usage
Un seul bouton accent par écran. Le focus clavier est toujours visible. Une couleur ne porte jamais seule une information.
`;

describe('checkDesignDoc', () => {
  test('a complete doc passes', () => {
    expect(checkDesignDoc(DESIGN_DOC)).toEqual({ ok: true, problems: [] });
  });
  test('sections, length, raw colours in components', () => {
    expect(checkDesignDoc(null).problems[0]).toContain('missing');
    expect(checkDesignDoc('# DS\n## Intention\nx').problems.join()).toContain('too short');
    expect(checkDesignDoc(DESIGN_DOC.replace("## Règles d'usage", '## Divers')).problems.join()).toContain('missing section "## Règles d\'usage"');
    expect(checkDesignDoc(DESIGN_DOC.replace('Button (accent', 'Button (#FF4400')).problems.join()).toContain('raw colour');
  });
});

// ── Base de contenu ──────────────────────────────────────────────────────────

const SOURCE = 'Aevum propose 12 protocoles de longévité et une pause active de 45 secondes quand une app dépasse son seuil.';

function content(patch: Record<string, unknown> = {}, entries?: unknown[]): string {
  return JSON.stringify({
    locales: ['fr', 'en'],
    voice: "Direct et calme, à la deuxième personne ; on dit ce que fait l'app, jamais ce qu'elle promet.",
    entries: entries ?? [
      { key: 'home.hero.title', fr: 'Une pause active, pas un écran noir', en: 'An active break, not a blank screen', max: 48 },
      { key: 'home.hero.subtitle', fr: 'Quand une app dépasse son seuil, 45 secondes pour bouger.', en: 'When an app crosses its limit, 45 seconds to move.' },
      { key: 'protocols.count', fr: '12 protocoles guidés', en: '12 guided protocols' },
      { key: 'cta.start', fr: 'Commencer', en: 'Start', max: 16 },
      { key: 'shield.secondary', fr: "Revenir à l'accueil", en: 'Back to home' },
    ],
    ...patch,
  });
}

describe('numbersIn', () => {
  test('reads figures the way they will be looked up', () => {
    expect(numbersIn('1 200 clients, 3,5 étoiles, 45 %')).toEqual(['1200', '3.5', '45']);
  });
});

describe('checkContent', () => {
  test('a complete content base passes', () => {
    expect(checkContent(content(), { source: SOURCE })).toEqual({ ok: true, problems: [] });
  });

  test('locales and voice', () => {
    expect(checkContent(content({ locales: ['fr', 'fr'] }), { source: SOURCE }).problems.join()).toContain('distinct language codes');
    expect(checkContent(content({ voice: 'Sympa.' }), { source: SOURCE }).problems.join()).toContain('describe the tone');
  });

  test('enough entries, keys dotted and unique', () => {
    expect(checkContent(content({}, []), { source: SOURCE }).problems.join()).toContain('at least 5');
    const entries = JSON.parse(content()).entries;
    entries[1].key = 'Home Hero';
    entries[2].key = 'home.hero.title';
    const problems = checkContent(content({}, entries), { source: SOURCE }).problems.join();
    expect(problems).toContain('"Home Hero" must be dotted lowercase');
    expect(problems).toContain('"home.hero.title" is used twice');
  });

  test('every locale has every entry, within its length', () => {
    const entries = JSON.parse(content()).entries;
    delete entries[3].en;
    entries[0].fr = 'Une pause active qui remplace enfin un écran noir et vide';
    const problems = checkContent(content({}, entries), { source: SOURCE }).problems.join();
    expect(problems).toContain('cta.start: missing en text');
    expect(problems).toContain('home.hero.title (fr) is 57 characters, at most 48');
  });

  test('no draft, no untranslated copy, no invented figure', () => {
    const entries = JSON.parse(content()).entries;
    entries[4].en = 'TODO';
    entries[1].en = entries[1].fr;
    entries[2].fr = '15 protocoles guidés';
    const problems = checkContent(content({}, entries), { source: SOURCE }).problems.join();
    expect(problems).toContain('shield.secondary (en): draft marker "TODO"');
    expect(problems).toContain('home.hero.subtitle: the same text in every locale looks untranslated');
    expect(problems).toContain('the figure 15 is not in the source material');
  });
});

// ── Liens entre les étapes ───────────────────────────────────────────────────

describe('calibratedType', () => {
  test('explicit input first, then calibrage.json', () => {
    expect(calibratedType('site', calibration())).toBe('site');
    expect(calibratedType('', calibration())).toBe('app');
    expect(calibratedType('', null)).toBeNull();
    expect(calibratedType('website', '{')).toBeNull();
  });
});

describe('undocumentedComponents', () => {
  test('every component of tokens.json is named in the Composants section', () => {
    expect(undocumentedComponents(tokens(), DESIGN_DOC)).toEqual([]);
    expect(undocumentedComponents(tokens(), DESIGN_DOC.replace(', Input (encre, bordure, focus visible)', ''))).toEqual(['Input']);
  });
});

describe('localeMismatch', () => {
  test('the content declares exactly the requested languages', () => {
    expect(localeMismatch(content(), ['fr', 'en'])).toEqual([]);
    expect(localeMismatch(content(), ['fr', 'en', 'de'])).toEqual(['locales: "de" was requested and is missing']);
    expect(localeMismatch(content(), ['fr'])).toEqual(['locales: "en" was not requested']);
  });
});
