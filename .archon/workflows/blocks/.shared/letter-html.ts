/**
 * Rendu HTML imprimable d'une lettre de motivation (letter.md → letter.html), déterministe
 * et sans dépendance : A4, une page, à l'identité du CV (`print-style.ts`, que
 * `cvDocument` de `systems/.shared/markdown.ts` partage) : le bandeau d'en-tête (le nom en sérif
 * crème souligné de corail, la ligne de contact rangée), l'objet en petites capitales corail, la
 * signature en sérif d'accent. Le
 * PDF se rend plus tard, hors du bloc (Edge/Chrome headless, comme `render` de career-apply
 * pour CV.html).
 *
 * La lettre est découpée par `letterBlocks` (`letter-checks.ts`), le même découpage que
 * l'estimation d'une page : ce qui est compté est ce qui est imprimé, et la feuille de style
 * garde les cotes de `LETTER_LAYOUT` (police, interligne, marges, pleine largeur) sans
 * dépasser les espaces qu'elle compte. L'agent n'écrit jamais de HTML.
 */

import { type Language, LETTER_LAYOUT, type LetterBlock, type LetterLayout, letterBlocks, parseLetter } from './letter-checks.ts';
import { FONTS, contactLineHtml, mastheadCss, pageCss, splitContact, tokensCss } from './print-style.ts';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Les espaces qui ne doivent pas casser une ligne deviennent insécables : entre les groupes
 * d'un nombre (« 1 200 »), avant « % », « € », « : », « ; », « ? », « ! », « » », après « « ».
 */
export function typography(text: string): string {
  return text
    .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0')
    .replace(/ (?=[%€:;?!»])/g, '\u00a0')
    .replace(/« /g, '«\u00a0');
}

/** Le Markdown d'une ligne : liens, gras, italique, code ; tout le reste est échappé. */
export function inline(markdown: string): string {
  let html = typography(escapeHtml(markdown));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

/**
 * La feuille de style : les cotes de `LETTER_LAYOUT`, l'identité du CV (`print-style.ts`). Le
 * bandeau remplace la marge haute de la page : il commence au bord et reprend cette marge en
 * haut, si bien que le texte qui suit descend d'autant qu'avec l'en-tête que l'estimation compte.
 */
export function letterCss(layout: LetterLayout = LETTER_LAYOUT): string {
  const page = { verticalMm: layout.marginMm.vertical, horizontalMm: layout.marginMm.horizontal };
  return `
${pageCss(page)}
${tokensCss()}
body { font-family: ${FONTS.sans}; font-size: ${layout.fontPt}pt; line-height: ${layout.lineHeight}; color: var(--ink); font-feature-settings: "kern", "liga"; }
${mastheadCss(24, { verticalMm: Math.min(12, layout.marginMm.vertical), horizontalMm: layout.marginMm.horizontal })}
.masthead { margin-bottom: 13pt; padding-bottom: 6mm; }
.masthead h1 { margin-bottom: 6pt; padding-bottom: 6pt; }
.contact { font-size: 9.2pt; line-height: 1.35; }
.date { text-align: right; color: var(--muted); margin: 0 0 10pt; font-variant-numeric: tabular-nums; }
.subject { margin: 0 0 12pt; font-weight: 600; }
.subject strong { font-weight: 700; font-size: 0.74em; text-transform: uppercase; letter-spacing: 0.16em; color: var(--warm); padding-right: 0.35em; }
h2 { font-size: ${layout.fontPt}pt; font-weight: 600; color: var(--accent); margin: 10pt 0 4pt; }
p { margin: 0 0 8pt; }
ul { list-style: none; margin: 0 0 8pt; padding: 0; }
li { padding-left: 14pt; margin: 0 0 3pt; }
li::before { content: ""; display: inline-block; width: 3.6pt; height: 3.6pt; margin: 0 7.4pt 0 -11pt; border-radius: 50%; background: var(--dot); vertical-align: 0.18em; }
strong { font-weight: 600; }
.signature { font-family: var(--serif); font-size: 1.18em; line-height: 1.2; color: var(--accent); margin: 16pt 0 0; }
a { color: inherit; text-decoration: none; }
code { font-family: inherit; }
@media screen { body { max-width: ${210 - 2 * layout.marginMm.horizontal}mm; margin: 0 auto ${layout.marginMm.vertical}mm; } }
`;
}

function blockHtml(block: LetterBlock): string {
  switch (block.kind) {
    case 'name':
      return `<h1>${inline(block.text)}</h1>`;
    case 'contact':
      return `<p class="contact">${contactLineHtml(splitContact(block.text), inline)}</p>`;
    case 'date':
      return `<p class="date">${inline(block.text)}</p>`;
    case 'subject':
      return `<p class="subject">${inline(block.text)}</p>`;
    case 'heading':
      return `<h2>${inline(block.text)}</h2>`;
    case 'item':
      return `<li>${inline(block.text)}</li>`;
    case 'signature':
      return `<p class="signature">${inline(block.text)}</p>`;
    default:
      return `<p>${inline(block.text)}</p>`;
  }
}

/** Le corps HTML : l'en-tête (nom, contact) dans `<header class="masthead">`, les éléments de liste consécutifs dans un `<ul>`. */
export function letterBodyHtml(blocks: LetterBlock[]): string {
  const out: string[] = [];
  const head = blocks.filter((block) => block.kind === 'name' || block.kind === 'contact');
  if (head.length > 0) out.push(`<header class="masthead">${head.map(blockHtml).join('')}</header>`);
  let list: string[] = [];
  const flush = (): void => {
    if (list.length > 0) out.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  for (const block of blocks) {
    if (block.kind === 'name' || block.kind === 'contact') continue;
    if (block.kind === 'item') list.push(blockHtml(block));
    else {
      flush();
      out.push(blockHtml(block));
    }
  }
  flush();
  return out.join('\n');
}

export interface LetterHtmlOptions {
  lang: Language;
  /** Le titre du document (métadonnée du PDF) ; défaut : « Lettre de motivation — <nom> » ou « Cover letter — <nom> ». */
  title?: string;
  layout?: LetterLayout;
}

/** Le document complet, prêt à imprimer en une page A4. */
export function renderLetterHtml(markdown: string, options: LetterHtmlOptions): string {
  const parts = parseLetter(markdown);
  const label = options.lang === 'en' ? 'Cover letter' : 'Lettre de motivation';
  const title = options.title ?? (parts.name !== '' ? `${label} — ${parts.name}` : label);
  const layout = options.layout ?? LETTER_LAYOUT;
  return `<!doctype html>\n<html lang="${options.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${letterCss(layout)}</style></head><body>\n${letterBodyHtml(letterBlocks(parts))}\n</body></html>\n`;
}
