/**
 * Les règles de `pdf-checks.ts`, chacune avec un cas qui passe et un cas qui doit échouer, sans
 * navigateur : les PDF de `fixtures/pdf/` ont été imprimés une fois par Chromium (Skia, comme
 * Edge) depuis les HTML voisins, puis versionnés ; les cas tordus sont des PDF écrits à la main
 * ici (`build`).
 *
 * Régénérer un PDF (Chromium de Playwright, par exemple) :
 *   chrome --headless --no-sandbox --disable-gpu --no-pdf-header-footer \
 *     --print-to-pdf=fixtures/pdf/<nom>.pdf fixtures/pdf/<nom>.html
 * `cv-one-page.html` est la sortie de `cvDocument` (markdown.ts) : sur cette machine, Chromium y
 * a pris Inter, police variable, qu'il écrit en Type3 (un glyphe par opérateur, /ActualText) ;
 * les trois autres sont en Liberation Sans, Type0 Identity-H (chaînes hexadécimales de glyphes).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  blankPageProblems,
  contactProblems,
  figureProblems,
  fontProblems,
  foldText,
  garbledProblems,
  glyphToUnicode,
  htmlText,
  pageCountProblems,
  pdfRules,
  phoneKey,
  placeholderProblems,
  readPdf,
  readProfileContact,
  textLayerProblems,
  verifyPdf,
} from './pdf-checks.ts';

const fixture = (name: string): Buffer => readFileSync(join(import.meta.dir, 'fixtures', 'pdf', name));
const cvPdf = fixture('cv-one-page.pdf');
const cvSource = htmlText(fixture('cv-one-page.html').toString('utf8'));
const threePages = fixture('three-pages.pdf');
const placeholderPdf = fixture('placeholder.pdf');
const imageOnly = fixture('image-only.pdf');
const profile = '# Camille Martin\n\n**E-mail :** camille.martin@exemple.fr · **Téléphone :** 06.12.34.56.78\n\n## Expériences\n- 2019 – 2024 : Acme, +35 %\n';
const contact = readProfileContact(profile);

// ── Un PDF écrit à la main : objets numérotés, table des objets juste ───────────────
function build(objects: Record<number, string>, trailer = '/Root 1 0 R'): Buffer {
  let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets = new Map<number, number>();
  for (const [num, body] of Object.entries(objects)) {
    offsets.set(Number(num), out.length);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  }
  const size = Math.max(...offsets.keys()) + 1;
  const xref = out.length;
  out += `xref\n0 ${size}\n`;
  for (let n = 0; n < size; n++) out += offsets.has(n) ? `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n';
  out += `trailer\n<< /Size ${size} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const stream = (data: string, dict = ''): string => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const flate = (data: string, dict = ''): string => stream(deflateSync(Buffer.from(data, 'latin1')).toString('latin1'), `/Filter /FlateDecode ${dict}`);
const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
/** Une page, sa police /F1 (objet 5) et son contenu (objet 4, compressé), plus des objets annexes. */
function onePage(content: string, font = HELVETICA, extra: Record<number, string> = {}, resources = ''): Buffer {
  return build({
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> ${resources} >> /Contents 4 0 R >>`,
    4: flate(content),
    5: font,
    ...extra,
  });
}
/** Une police Type0 Identity-H embarquée (FontFile2), avec ou sans ToUnicode (objet 9). */
function type0(toUnicode: string | null): Record<number, string> {
  return {
    5: `<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Fake /Encoding /Identity-H /DescendantFonts [6 0 R] ${toUnicode === null ? '' : '/ToUnicode 9 0 R'} >>`,
    6: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Fake /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R /DW 500 >>',
    7: '<< /Type /FontDescriptor /FontName /ABCDEF+Fake /Flags 4 /FontFile2 8 0 R >>',
    8: stream('glyphes'),
    ...(toUnicode === null ? {} : { 9: flate(toUnicode) }),
  };
}
const CMAP = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0020> <0050> <00660069> endbfchar
3 beginbfrange <0010> <0019> <0030> <0024> <003D> <0041> <0044> <0045> [<00E9> <0153>] endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;
function withType0(content: string, toUnicode: string | null = CMAP): Buffer {
  const objects = type0(toUnicode);
  const { 5: font, ...rest } = objects;
  return onePage(content, font, rest);
}

describe('lecture des PDF de Chromium (fixtures versionnées)', () => {
  test('CV d’une page en polices Type3 : texte dans l’ordre, accents, /ActualText du « + »', () => {
    const reading = readPdf(cvPdf);
    expect(reading.structure).toEqual([]);
    expect(reading.errors).toEqual([]);
    expect(reading.pages).toHaveLength(1);
    const text = reading.pages[0];
    expect(text.split('\n')[0]).toBe('Camille Martin — Responsable Growth');
    expect(text).toContain('camille.martin@exemple.fr · +33 6 12 34 56 78 · Paris');
    expect(text).toContain('EXPÉRIENCES');
    expect(text).toContain('Acme (2019 – 2024) : refonte du tunnel');
    expect(text).toContain('« français », anglais C1 — œuvre à 100 %.');
    expect(reading.fonts.map((font) => font.subtype)).toEqual(['Type3', 'Type3']);
    expect(reading.fonts.every((font) => font.embedded && font.unmapped === 0)).toBe(true);
  });
  test('polices Type0 Identity-H : chaînes hexadécimales de glyphes décodées par ToUnicode', () => {
    const reading = readPdf(placeholderPdf);
    expect(reading.pages[0].split('\n')).toEqual([
      'Madame, Monsieur,',
      'Je souhaite rejoindre {{entreprise}} comme Responsable Growth. TODO : chiffre clé [à compléter].',
      'Lorem ipsum dolor sit amet.',
      'camille.martin@exemple.fr · 06 12 34 56 78',
    ]);
    expect(reading.fonts).toEqual([{ name: 'AAAAAA+LiberationSans', subtype: 'Type0', embedded: true, unmapped: 0 }]);
  });
  test('trois pages, dans l’ordre de l’arbre des pages', () => {
    expect(readPdf(threePages).pages).toEqual(['Page 1\nContenu de la page 1 : expérience 2021.', 'Page 2\nContenu de la page 2 : expérience 2022.', 'Page 3\nContenu de la page 3 : expérience 2023.']);
  });
  test('une page image seule : une page, aucun texte, aucune police', () => {
    expect(readPdf(imageOnly)).toEqual({ structure: [], pages: [''], fonts: [], errors: [] });
  });
});

describe('verifyPdf : le CV conforme passe, chaque problème porte le nom du fichier', () => {
  test('CV : une page, contact du profil, source relue, polices embarquées', () => {
    const verdict = verifyPdf(cvPdf, pdfRules('cv', { contact, source: cvSource }));
    expect(verdict.problems).toEqual([]);
    expect(verdict).toMatchObject({ ok: true, pages: 1 });
    expect(verdict.chars).toBeGreaterThan(400);
  });
  test('le même PDF passe comme lettre d’une page', () => {
    expect(verifyPdf(cvPdf, pdfRules('letter', { contact })).ok).toBe(true);
  });
  test('les problèmes sont préfixés et en français', () => {
    const verdict = verifyPdf(threePages, pdfRules('letter', { minChars: 10 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toEqual(['letter.pdf : 3 pages, il en faut exactement 1']);
  });
  test('sans texte, les règles qui lisent le texte se taisent : seul le vrai problème est dit', () => {
    const verdict = verifyPdf(imageOnly, pdfRules('cv', { contact, source: cvSource }));
    expect(verdict.problems).toEqual([
      'CV.pdf : couche texte vide ou presque : 0 caractère(s) extrait(s), au moins 200 attendus (PDF image ? un ATS n\'y lira rien)',
      'CV.pdf : page 1 sans texte (page blanche ou image seule)',
    ]);
  });
});

describe('règle : structure (en-tête, %%EOF, startxref, catalogue, chiffrement)', () => {
  test('passe : PDF de Chromium et PDF écrit à la main', () => {
    expect(readPdf(cvPdf).structure).toEqual([]);
    expect(readPdf(onePage('BT /F1 12 Tf 72 720 Td (Bonjour) Tj ET')).structure).toEqual([]);
  });
  test('échoue : pas un PDF', () => {
    expect(readPdf(Buffer.from('<html><body>Erreur 500</body></html>')).structure).toEqual(["pas un PDF : l'en-tête %PDF- manque au début du fichier"]);
  });
  test('échoue : PDF tronqué (écriture interrompue)', () => {
    const structure = readPdf(cvPdf.subarray(0, cvPdf.length - 300)).structure;
    expect(structure).toContain('PDF tronqué : pas de marqueur %%EOF à la fin du fichier');
  });
  test('échoue : startxref décalé (fins de ligne converties)', () => {
    const shifted = Buffer.from(cvPdf.toString('latin1').replace(/startxref\n(\d+)/, (_, n: string) => `startxref\n${Number(n) + 7}`), 'latin1');
    expect(readPdf(shifted).structure.join(' ')).toContain('startxref');
  });
  test('échoue : pas de catalogue, ou chiffré', () => {
    const noRoot = build({ 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [] /Count 0 >>' }, '');
    expect(readPdf(noRoot).structure).toEqual(['catalogue introuvable : le trailer ne nomme pas de /Root lisible', 'aucune page']);
    const encrypted = build({ 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 3: '<< /Type /Page /Parent 2 0 R >>' }, '/Root 1 0 R /Encrypt 9 0 R');
    expect(readPdf(encrypted).structure).toEqual(['PDF chiffré : son texte ne peut pas être vérifié']);
  });
});

describe('règle : nombre de pages (CV ≤ 2 par défaut, lettre = 1)', () => {
  test('passe : CV d’une ou deux pages, lettre d’une page, plafond configurable', () => {
    expect(pageCountProblems(1, pdfRules('cv').pages)).toEqual([]);
    expect(pageCountProblems(2, pdfRules('cv').pages)).toEqual([]);
    expect(pageCountProblems(1, pdfRules('letter').pages)).toEqual([]);
    expect(pageCountProblems(readPdf(threePages).pages.length, { min: 1, max: 3 })).toEqual([]);
  });
  test('échoue : CV de trois pages, lettre de deux', () => {
    expect(pageCountProblems(readPdf(threePages).pages.length, pdfRules('cv').pages)).toEqual(['3 pages, 2 au plus']);
    expect(pageCountProblems(2, pdfRules('letter').pages)).toEqual(['2 pages, il en faut exactement 1']);
    expect(pageCountProblems(2, { min: 1, max: 1 })).toHaveLength(1);
  });
});

describe('règle : couche texte extractible', () => {
  test('passe : le CV porte plusieurs centaines de caractères', () => {
    expect(textLayerProblems(readPdf(cvPdf).pages, 200)).toEqual([]);
  });
  test('échoue : page image seule, ou texte trop maigre', () => {
    expect(textLayerProblems(readPdf(imageOnly).pages, 200)[0]).toStartWith('couche texte vide ou presque : 0 caractère(s)');
    expect(textLayerProblems(readPdf(threePages).pages, 200)[0]).toContain('au moins 200 attendus');
  });
});

describe('règle : aucune page sans texte', () => {
  test('passe : chaque page a du texte', () => {
    expect(blankPageProblems(readPdf(threePages).pages)).toEqual([]);
  });
  test('échoue : page image seule, page blanche en fin de document', () => {
    expect(blankPageProblems(readPdf(imageOnly).pages)).toEqual(['page 1 sans texte (page blanche ou image seule)']);
    const trailingBlank = build({
      1: '<< /Type /Catalog /Pages 2 0 R >>',
      2: '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> >> >>',
      3: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
      4: stream('BT /F1 12 Tf 72 720 Td (Une page) Tj ET'),
      5: HELVETICA,
      6: '<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>',
      7: stream('0 0 1 rg 0 0 10 10 re f'),
    });
    expect(readPdf(trailingBlank).pages).toEqual(['Une page', '']);
    expect(blankPageProblems(readPdf(trailingBlank).pages)).toEqual(['page 2 sans texte (page blanche ou image seule)']);
  });
});

describe('règle : e-mail et téléphone du profil dans le texte', () => {
  test('lit le contact du profil maître, quel que soit le format du numéro', () => {
    expect(contact).toEqual({ email: 'camille.martin@exemple.fr', phone: '06.12.34.56.78' });
    expect(readProfileContact('Phone: +33 (0)6 12 34 56 78 — me@x.io')).toEqual({ email: 'me@x.io', phone: '+33 (0)6 12 34 56 78' });
    expect(readProfileContact('Paris · 07 98 76 54 32 · a@b.fr')).toEqual({ email: 'a@b.fr', phone: '07 98 76 54 32' });
    expect(readProfileContact('Expériences 2019 – 2023, 120 000 € de budget')).toEqual({ email: '', phone: '' });
    expect(phoneKey('+33 (0)6 12 34 56 78')).toBe(phoneKey('06.12.34.56.78'));
  });
  test('passe : +33 6 12 34 56 78 (Type3) et 06 12 34 56 78 (Type0) valent 06.12.34.56.78', () => {
    expect(contactProblems(readPdf(cvPdf).pages.join('\n'), contact)).toEqual([]);
    expect(contactProblems(readPdf(placeholderPdf).pages.join('\n'), contact)).toEqual([]);
    expect(contactProblems('rien', { email: '', phone: '' })).toEqual([]);
  });
  test('échoue : un autre e-mail, un autre numéro, ou rien', () => {
    const text = readPdf(cvPdf).pages.join('\n');
    expect(contactProblems(text, { email: 'camille@autre.fr', phone: '06 99 99 99 99' })).toEqual([
      "l'e-mail du profil (camille@autre.fr) manque dans le texte du PDF",
      'le téléphone du profil (06 99 99 99 99) manque dans le texte du PDF',
    ]);
    expect(contactProblems('Camille Martin', contact)).toHaveLength(2);
  });
});

describe('règle : aucun reste de gabarit', () => {
  test('passe : le CV n’en porte aucun', () => {
    expect(placeholderProblems(readPdf(cvPdf).pages.join('\n'))).toEqual([]);
    expect(placeholderProblems('Tout est à jour ; todo-list livrée ; [à compléter si besoin] non.')).toEqual([]);
  });
  test('échoue : {{…}}, TODO, [à compléter], lorem ipsum', () => {
    expect(placeholderProblems(readPdf(placeholderPdf).pages.join('\n'))).toEqual(['reste de gabarit dans le texte : « {{entreprise}} », « TODO », « Lorem ipsum », « [à compléter] »']);
    expect(placeholderProblems('[A COMPLÉTER]')).toHaveLength(1);
  });
});

describe('règle : glyphes lisibles (pas de U+FFFD, de zone privée, de contrôle, de texte mal encodé)', () => {
  test('passe : CV Chromium, et police Type0 avec ToUnicode (plages, tableau, ligature)', () => {
    const reading = readPdf(cvPdf);
    expect(garbledProblems(reading.pages.join('\n'), reading.fonts)).toEqual([]);
    const type0Text = readPdf(withType0('BT /F1 10 Tf 72 720 Td <0024002500030050000300110012> Tj <0044 0045> Tj ET')).pages[0];
    expect(type0Text).toBe('AB fi 12éœ');
    expect(garbledProblems(type0Text)).toEqual([]);
  });
  test('échoue : police Type0 sans ToUnicode (identifiants de glyphes seuls)', () => {
    const reading = readPdf(withType0('BT /F1 10 Tf 72 720 Td <00240025> Tj ET', null));
    expect(reading.pages[0]).toBe('\uFFFD\uFFFD');
    expect(garbledProblems(reading.pages[0], reading.fonts)).toEqual(['2 glyphe(s) sans correspondance Unicode (police ABCDEF+Fake) : copié ou lu par un ATS, ce texte est illisible']);
  });
  test('échoue : zone privée, caractères de contrôle, UTF-8 lu comme du latin1', () => {
    expect(garbledProblems('Tél \uE0B0 06')).toEqual(['1 caractère(s) de la zone privée Unicode (icônes ou glyphes mal encodés)']);
    expect(garbledProblems('a\u0001b')).toEqual(['1 caractère(s) de contrôle dans le texte (glyphes mal décodés)']);
    expect(garbledProblems('ExpÃ©riences â€™')[0]).toStartWith('texte mal encodé (UTF-8 lu comme du latin1) : « Ã© », « â€™ »');
  });
});

describe('règle : chiffres de la source relus dans le PDF', () => {
  test('passe : chaque nombre du HTML du CV est dans son texte (1 200 compris)', () => {
    expect(cvSource).toContain('1 200');
    expect(figureProblems(readPdf(cvPdf).pages.join('\n'), cvSource)).toEqual([]);
    expect(figureProblems('rien', '')).toEqual([]);
  });
  test('échoue : un nombre de la source manque ou a été mal décodé', () => {
    expect(figureProblems(readPdf(cvPdf).pages.join('\n'), `${cvSource} Chiffre d'affaires 2025 : 48 k€`)).toEqual(['chiffres de la source absents du texte du PDF (glyphes illisibles ?) : 2025, 48']);
    expect(figureProblems('Acme (2O19 – 2O24)', 'Acme (2019 – 2024)')).toHaveLength(1);
  });
  test('htmlText : sans <head>, commentaires ni styles, entités décodées', () => {
    expect(htmlText('<html><head><title>Lettre 2099</title><style>p{margin:12px}</style></head><body><!-- 1234 --><p>A&nbsp;&amp;&#160;B 2024</p></body></html>')).toBe('A & B 2024');
  });
});

describe('règle : polices embarquées', () => {
  test('passe : Type3 et Type0 de Chromium, TrueType avec FontFile2', () => {
    expect(fontProblems(readPdf(cvPdf).fonts)).toEqual([]);
    expect(fontProblems(readPdf(placeholderPdf).fonts)).toEqual([]);
    const trueType = onePage('BT /F1 12 Tf 72 720 Td (Bonjour) Tj ET', '<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Arial /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>', {
      6: '<< /Type /FontDescriptor /FontName /ABCDEF+Arial /Flags 32 /FontFile2 7 0 R >>',
      7: stream('glyphes'),
    });
    expect(readPdf(trueType).fonts).toEqual([{ name: 'ABCDEF+Arial', subtype: 'TrueType', embedded: true, unmapped: 0 }]);
    expect(fontProblems(readPdf(trueType).fonts)).toEqual([]);
  });
  test('échoue : Helvetica standard, non embarquée', () => {
    const reading = readPdf(onePage('BT /F1 12 Tf 72 720 Td (Caf\\351 cr\\350me) Tj ET'));
    expect(reading.pages).toEqual(['Café crème']);
    expect(fontProblems(reading.fonts)).toEqual(["police(s) non embarquée(s) : Helvetica (Type1) — le PDF s'affichera autrement chez le lecteur"]);
  });
});

describe('décodage : espaces, lignes, objets compressés, formulaires, /ActualText', () => {
  test('TJ : un grand crénage est un espace, un petit non ; Td vers le bas est une ligne', () => {
    expect(readPdf(onePage('BT /F1 10 Tf 72 720 Td [(Bon) -400 (jour) -20 (s)] TJ 0 -14 Td (Ligne 2) Tj ET')).pages).toEqual(['Bon jours\nLigne 2']);
  });
  test('/ActualText remplace le glyphe (chaîne simple ou UTF-16)', () => {
    const page = readPdf(onePage('BT /F1 10 Tf 72 720 Td /Span << /ActualText (+) >> BDC (x) Tj EMC (33) Tj /Span << /ActualText <FEFF00E9> >> BDC (e) Tj EMC ET')).pages[0];
    expect(page).toBe('+33é');
  });
  test('flux d’objets (ObjStm) : la page et sa police compressées', () => {
    const page = '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>';
    const header = `4 0 5 ${page.length + 1} `;
    const pdf = build({
      1: '<< /Type /Catalog /Pages 2 0 R >>',
      2: '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
      3: flate(`${header}${page} ${HELVETICA}`, `/Type /ObjStm /N 2 /First ${header.length}`),
      6: flate('BT /F1 12 Tf 72 720 Td (Compress\\351) Tj ET'),
    });
    expect(readPdf(pdf)).toMatchObject({ structure: [], pages: ['Compressé'] });
  });
  test('formulaire (XObject Form) : son texte compte', () => {
    const pdf = onePage('q 1 0 0 1 50 50 cm /X1 Do Q', HELVETICA, { 6: stream('BT /F1 12 Tf 0 0 Td (Formulaire) Tj ET', '/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >>') }, '/XObject << /X1 6 0 R >>');
    expect(readPdf(pdf).pages).toEqual(['Formulaire']);
  });
  test('filtres enchaînés ASCII85Decode puis FlateDecode (ReportLab)', () => {
    const a85 = (bytes: Buffer): string => {
      let out = '';
      for (let i = 0; i < bytes.length; i += 4) {
        const chunk = bytes.subarray(i, i + 4);
        let n = Buffer.concat([chunk, Buffer.alloc(4 - chunk.length)]).readUInt32BE(0);
        const digits: string[] = [];
        for (let k = 0; k < 5; k++) {
          digits.unshift(String.fromCharCode(33 + (n % 85)));
          n = Math.floor(n / 85);
        }
        out += digits.slice(0, chunk.length + 1).join('');
      }
      return `${out}~>`;
    };
    const content = a85(deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (ReportLab) Tj ET', 'latin1')));
    const pdf = build({ 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 3: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', 4: stream(content, '/Filter [/ASCII85Decode /FlateDecode]'), 5: HELVETICA });
    expect(readPdf(pdf)).toMatchObject({ errors: [], pages: ['ReportLab'] });
  });
  test('un flux illisible est nommé, sans exception', () => {
    const pdf = build({ 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 3: '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', 4: stream('xx', '/Filter /LZWDecode') });
    expect(readPdf(pdf).errors).toEqual(['page 1 : flux de contenu illisible (filtre LZWDecode non pris en charge)']);
  });
  test('noms de glyphes et repli typographique', () => {
    expect(['eacute', 'Ccedilla', 'uni00E0', 'u1F600', 'f_i', 'zero', 'quoteright', 'g400'].map(glyphToUnicode)).toEqual(['é', 'Ç', 'à', '😀', 'fi', '0', '’', undefined]);
    expect(foldText('l’\uFB01n\u00A0– « x »')).toBe("l'fin - « x »");
  });
});
