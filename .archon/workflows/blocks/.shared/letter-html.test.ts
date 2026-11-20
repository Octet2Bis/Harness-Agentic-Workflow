import { describe, expect, test } from 'bun:test';
import { LETTER_LAYOUT } from './letter-checks.ts';
import { escapeHtml, inline, letterCss, renderLetterHtml, typography } from './letter-html.ts';
import { LINKEDIN_SVG, PAINT_ORDER_BREAKERS } from './print-style.ts';

const letter = `# Jane Doe
jane@example.org · [portfolio](https://jane.example)

Paris, le 22 octobre 2026

**Objet :** candidature au poste de Growth Ops Manager chez Acme & Co

Madame, Monsieur,

Premier paragraphe,
écrit sur deux lignes.

- **Outbound :** ~50% d'ouverture
- *n8n* : qualification des leads

Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.

Jane Doe
`;

describe('rendu HTML de la lettre', () => {
  const html = renderLetterHtml(letter, { lang: 'fr' });

  test('document A4 complet, dans la langue de la lettre, titré du nom', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('<title>Lettre de motivation — Jane Doe</title>');
    expect(html).toContain('@page { size: A4; margin: 20mm 0; }');
    expect(html).toContain('body { margin: 0; padding: 0 22mm; }');
    expect(renderLetterHtml(letter, { lang: 'en' })).toContain('<title>Cover letter — Jane Doe</title>');
  });

  test("en-tête, date, objet, paragraphes joints, liste groupée, signature, dans l'ordre", () => {
    const order = [
      '<header class="masthead"><h1>Jane Doe</h1><p class="contact"><a href="mailto:jane@example.org">jane@example.org</a> <span class="sep">·</span> <a href="https://jane.example">portfolio</a></p></header>',
      '<p class="date">Paris, le 22 octobre 2026</p>',
      '<p class="subject"><strong>Objet\u00a0:</strong> candidature au poste de Growth Ops Manager chez Acme &amp; Co</p>',
      '<p>Madame, Monsieur,</p>',
      '<p>Premier paragraphe, écrit sur deux lignes.</p>',
      "<ul><li><strong>Outbound\u00a0:</strong> ~50% d'ouverture</li><li><em>n8n</em>\u00a0: qualification des leads</li></ul>",
      "<p>Je vous prie d'agréer, Madame, Monsieur, mes salutations distinguées.</p>",
      '<p class="signature">Jane Doe</p>',
    ];
    let at = -1;
    for (const fragment of order) {
      const next = html.indexOf(fragment);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  test('espaces insécables là où une ligne ne doit pas casser, pas ailleurs', () => {
    expect(typography('sur 1 200 prospects : 50 % « oui » ?')).toBe('sur 1\u00a0200 prospects\u00a0: 50\u00a0% «\u00a0oui\u00a0»\u00a0?');
    expect(typography('+33 6 12 34 56 78, en 2024 avec 3 équipes')).toBe('+33 6 12 34 56 78, en 2024 avec 3 équipes');
  });

  test('échappe le HTML écrit par l’agent : il ne passe jamais tel quel', () => {
    expect(escapeHtml('<b>"x" & y</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
    expect(inline('<script>alert(1)</script> **ok**')).toBe('&lt;script&gt;alert(1)&lt;/script&gt; <strong>ok</strong>');
    expect(renderLetterHtml('# A B\n\n**Objet :** x\n\n<img src=x onerror=y>\n\nA B', { lang: 'fr' })).not.toContain('<img');
  });

  test('la feuille de style suit les cotes de l’estimation (police, interligne, marges)', () => {
    const css = letterCss({ ...LETTER_LAYOUT, fontPt: 12, lineHeight: 1.5, marginMm: { vertical: 25, horizontal: 30 } });
    expect(css).toContain('font-size: 12pt; line-height: 1.5;');
    expect(css).toContain('@page { size: A4; margin: 25mm 0; }');
    expect(css).toContain('@page :first { margin-top: 0; }');
    expect(css).toContain('padding: 0 30mm;');
    expect(css).toContain('max-width: 150mm');
  });

  test('l’identité du CV : ligne de contact rangée et lisible, rien de distant ni d’hors flux', () => {
    const contact = renderLetterHtml('# Jane Doe\nhttps://www.linkedin.com/in/jane-doe/ · +33 6 00 00 00 00 · jane@example.org\n\nLyon, le 22 octobre 2026\n\n**Objet :** x\n\nCorps.\n\nJane Doe', { lang: 'fr' });
    expect(contact).toContain(
      '<p class="contact"><a href="mailto:jane@example.org">jane@example.org</a> <span class="sep">·</span> +33 6 00 00 00 00 <span class="sep">·</span> <a class="ico" href="https://www.linkedin.com/in/jane-doe/" aria-label="LinkedIn">' + LINKEDIN_SVG + '</a></p>',
    );
    const css = letterCss();
    expect(css).toContain('-webkit-print-color-adjust: exact');
    expect(css).not.toMatch(/url\(|@import|https?:\/\//i);
    expect(PAINT_ORDER_BREAKERS.test(css)).toBe(false);
  });
});
