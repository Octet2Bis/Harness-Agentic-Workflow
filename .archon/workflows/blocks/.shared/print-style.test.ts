import { describe, expect, test } from 'bun:test';
import { FONTS, LINKEDIN_SVG, PAINT_ORDER_BREAKERS, PALETTE, contactKind, contactLineHtml, contactSegmentHtml, mastheadCss, orderContact, pageCss, prettyUrl, splitContact, tokensCss } from './print-style.ts';

const plain = (markdown: string): string => markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;');

describe('identité imprimée partagée par le CV et la lettre', () => {
  test('genre de chaque segment : lieu, e-mail, téléphone, LinkedIn, portfolio, poste étiqueté', () => {
    expect(contactKind('Lyon')).toBe('place');
    expect(contactKind('100% remote')).toBe('place');
    expect(contactKind('jane.doe@example.org')).toBe('email');
    expect(contactKind('**E-mail :** jane.doe@example.org')).toBe('email');
    expect(contactKind('+33 6 00 00 00 00')).toBe('phone');
    expect(contactKind('**Tél :** 06.00.00.00.00')).toBe('phone');
    expect(contactKind('[linkedin.com/in/jane](https://www.linkedin.com/in/jane)')).toBe('linkedin');
    expect(contactKind('https://linkedin.com/in/jane')).toBe('linkedin');
    expect(contactKind('https://jane.example/')).toBe('url');
    expect(contactKind('jane.example')).toBe('url');
    expect(contactKind('Application: Acme — Growth Lead')).toBe('role');
    expect(contactKind('**Poste :** Growth')).toBe('role');
    expect(contactKind('Lieu : Lyon')).toBe('place');
    // Une année seule n'est pas un téléphone.
    expect(contactKind('2024')).toBe('place');
  });

  test('ligne rangée lieu · e-mail · téléphone · LinkedIn · portfolio, ordre d’origine gardé dans un genre', () => {
    const segments = splitContact('https://jane.example/ · jane@example.org | +33 6 00 00 00 00 • Lyon · https://linkedin.com/in/jane · https://blog.example');
    expect(orderContact(segments).map((s) => s.kind)).toEqual(['place', 'email', 'phone', 'linkedin', 'url', 'url']);
    expect(orderContact(segments).map((s) => s.text).slice(-2)).toEqual(['https://jane.example/', 'https://blog.example']);
    // Un tiret dans un nom ou une URL ne coupe pas : seuls « · », « • », « | » entourés d'espaces séparent.
    expect(splitContact('Saint-Étienne · a-b@example.org')).toEqual(['Saint-Étienne', 'a-b@example.org']);
  });

  test('URL lisible, e-mail en mailto, séparateurs d’accent qui restent du texte', () => {
    expect(prettyUrl('https://www.jane.example/')).toBe('jane.example');
    expect(prettyUrl('http://jane.example/work/')).toBe('jane.example/work');
    const html = contactLineHtml(['https://www.jane.example/', 'jane@example.org', 'Lyon'], plain);
    expect(html).toBe('Lyon <span class="sep">·</span> <a href="mailto:jane@example.org">jane@example.org</a> <span class="sep">·</span> <a href="https://www.jane.example/">jane.example</a>');
    // Le reste passe par l'inline de l'appelant, qui échappe.
    expect(contactLineHtml(['<b>x</b> · a@b.co'], plain)).toContain('&lt;b>x&lt;/b>');
  });

  test('LinkedIn devient un logo cliquable, un lien Markdown garde son libellé (« Portfolio »)', () => {
    const logo = (href: string) => `<a class="ico" href="${href}" aria-label="LinkedIn">${LINKEDIN_SVG}</a>`;
    expect(contactSegmentHtml('https://www.linkedin.com/in/jane/', plain)).toBe(logo('https://www.linkedin.com/in/jane/'));
    expect(contactSegmentHtml('[linkedin.com/in/jane](https://linkedin.com/in/jane)', plain)).toBe(logo('https://linkedin.com/in/jane'));
    expect(contactSegmentHtml('linkedin.com/in/jane', plain)).toBe(logo('https://linkedin.com/in/jane'));
    expect(LINKEDIN_SVG).toStartWith('<svg viewBox="0 0 24 24"');
    const link = (md: string) => md.replace(/\[([^\]]+)\]\(([^)]+)\)/, '<a href="$2">$1</a>');
    expect(contactLineHtml(['[Portfolio](https://jane.example/)', 'https://linkedin.com/in/jane'], link)).toBe(
      `${logo('https://linkedin.com/in/jane')} <span class="sep">·</span> <a href="https://jane.example/">Portfolio</a>`,
    );
  });

  test('rien de distant ni d’hors flux : polices système, pas d’url(…) ni @import, ordre de peinture = ordre de lecture', () => {
    const css = `${pageCss({ verticalMm: 14, horizontalMm: 16 })}\n${tokensCss()}\n${mastheadCss(28, { verticalMm: 12, horizontalMm: 16 })}`;
    expect(css).not.toMatch(/url\(|@import|https?:/i);
    expect(css).toContain('print-color-adjust: exact');
    expect(css).toContain('-webkit-print-color-adjust: exact');
    expect(PAINT_ORDER_BREAKERS.test(css)).toBe(false);
    expect(PAINT_ORDER_BREAKERS.test('li { position: relative; }')).toBe(true);
    expect(PAINT_ORDER_BREAKERS.test('li::before { opacity: 0.7 }')).toBe(true);
    expect(PAINT_ORDER_BREAKERS.test('h2 { text-transform: uppercase; }')).toBe(false);
    expect(FONTS.sans).toMatch(/Arial, "Liberation Sans", sans-serif$/);
    expect(FONTS.serif).toMatch(/serif$/);
  });

  test('bandeau pleine largeur par les marges, pas par un élément positionné', () => {
    const page = pageCss({ verticalMm: 14, horizontalMm: 16 });
    // Pas de marge latérale côté page : le corps les reprend ; la première page n'a pas de marge haute (le bandeau la remplace).
    expect(page).toContain('@page { size: A4; margin: 14mm 0; }');
    expect(page).toContain('@page :first { margin-top: 0; }');
    expect(page).toContain('padding: 0 16mm;');
    // L'en-tête déborde du corps d'autant, dans le flux, et reprend la marge haute en padding.
    const head = mastheadCss(30, { verticalMm: 12, horizontalMm: 16 });
    expect(head).toContain('.masthead { margin: 0 -16mm; padding: 12mm 16mm');
    expect(head).toContain('background: var(--band)');
    expect(head).toContain('font-size: 30pt;');
  });

  test('couleurs opaques, toutes exposées en variables CSS', () => {
    for (const value of Object.values(PALETTE)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    const tokens = tokensCss();
    expect(tokens).toContain(`--warm-light: ${PALETTE.warmLight};`);
    expect(tokens).toContain(`--band: ${PALETTE.band};`);
    expect(tokens).toContain(`--accent: ${PALETTE.accent};`);
  });
});
