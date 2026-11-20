/**
 * Conversion Markdown → HTML minimale et déterministe pour imprimer un CV d'une page en
 * PDF (titres, gras, italique, liens, listes, règles, paragraphes). Pas de dépendance.
 *
 * `markdownToHtml` traduit ligne à ligne ; `cvBodyHtml` met en page un CV : l'en-tête (nom,
 * ligne de poste, ligne de contact rangée lieu · e-mail · téléphone · LinkedIn · portfolio),
 * une section par `##`, une entrée par `###` (« Entreprise — Poste », la période alignée à
 * droite quand le titre la porte en fin ou qu'une première ligne en italique la donne), les
 * listes « **Étiquette :** éléments » en rangées, des pastilles quand ce sont des mots-clés.
 * Tout reste du texte, dans l'ordre du Markdown : c'est l'ordre que lit un ATS. L'identité
 * (bandeau, couleurs, polices, ligne de contact) est celle de la lettre
 * (`blocks/.shared/print-style.ts`).
 */

import { FONTS, type PageMargins, contactKind, contactLineHtml, mastheadCss, pageCss, splitContact, tokensCss } from '../../blocks/.shared/print-style.ts';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function inline(markdown: string): string {
  let html = escapeHtml(markdown);
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  return html;
}

// ── Lecture en blocs ─────────────────────────────────────────────────────────────

export type MdBlock = { kind: 'heading'; level: number; text: string } | { kind: 'paragraph'; lines: string[] } | { kind: 'list'; items: string[] } | { kind: 'rule' };

/** Le Markdown en blocs : titres, paragraphes (lignes consécutives), listes, règles. */
export function markdownBlocks(markdown: string): MdBlock[] {
  const out: MdBlock[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  const flushList = () => {
    if (list.length > 0) out.push({ kind: 'list', items: list });
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length > 0) out.push({ kind: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (heading) {
      flushList();
      flushParagraph();
      out.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushList();
      flushParagraph();
      out.push({ kind: 'rule' });
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (line.trim() === '') {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushList();
  flushParagraph();
  return out;
}

/** Le HTML ligne à ligne, sans mise en page : `<hN>`, `<p>`, `<ul>`, `<hr>`. */
export function markdownToHtml(markdown: string): string {
  return markdownBlocks(markdown)
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `<h${block.level}>${inline(block.text)}</h${block.level}>`;
        case 'paragraph':
          return `<p>${inline(block.lines.join(' '))}</p>`;
        case 'list':
          return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
        default:
          return '<hr>';
      }
    })
    .join('\n');
}

// ── Périodes ─────────────────────────────────────────────────────────────────────

const MONTH = String.raw`(?:jan|f[ée]v|feb|mar|avr|apr|mai|may|juin|jun|juil|jul|ao[uû]|aug|sep|oct|nov|d[ée]c|dec)[\p{L}]*\.?`;
const POINT = String.raw`(?:(?:\d{1,2}[/.])?(?:19|20)\d{2}|${MONTH}\s+(?:19|20)\d{2})`;
const OPEN = String.raw`(?:pr[ée]sent|present|current|now|today|aujourd['’]hui|en cours|ce jour|actuel(?:le)?|ongoing)`;
const RANGE = String.raw`(?:${POINT}\s*(?:[–—-]|to|à|au)\s*(?:${POINT}|${OPEN})|(?:since|depuis)\s+${POINT})`;
/** Une période en fin de titre : « · 09/2024 – 05/2026 », « (2019 – 2024) », « | depuis 2023 », « · 2024 ». */
const TRAILING_DATE = new RegExp(String.raw`(?:\s+[·|,–—-]\s+|\s*\()(${RANGE}|${POINT})\)?\s*$`, 'iu');
const HAS_DATE = new RegExp(String.raw`(?:${RANGE}|${POINT})`, 'iu');

/** Sépare d'un titre la période qui le termine : `{ title, date }`, `date` vide s'il n'en porte pas. */
export function splitTrailingDate(heading: string): { title: string; date: string } {
  const match = TRAILING_DATE.exec(heading);
  if (match === null || match.index === 0) return { title: heading, date: '' };
  return { title: heading.slice(0, match.index).trim(), date: match[1].trim() };
}

/** Une ligne tout en italique qui porte une date (« *09/2024 – 05/2026 · Remote* ») : son texte, sinon null. */
export function italicMeta(line: string): string | null {
  const match = /^(?:\*([^*]+)\*|_([^_]+)_)$/.exec(line.trim());
  const text = (match?.[1] ?? match?.[2] ?? '').trim();
  return text !== '' && HAS_DATE.test(text) ? text : null;
}

// ── Mise en page du CV ───────────────────────────────────────────────────────────

/** « Entreprise — Poste » : l'entreprise en gras, le tiret d'accent, le poste. Sans tiret, le titre entier. */
function entryTitleHtml(title: string): string {
  const match = /^(.+?)\s+([—–])\s+(.+)$/.exec(title);
  if (match === null) return `<span class="org">${inline(title)}</span>`;
  return `<span class="org">${inline(match[1])}</span> <span class="dash">${match[2]}</span> <span class="what">${inline(match[3])}</span>`;
}

/** Une liste « **Étiquette :** éléments » (chaque élément étiqueté, deux-points compris) : des rangées. */
const ROW = /^\*\*([^*]+?)\*\*\s*(:?)\s*(.*)$/;
function isRows(items: string[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => {
      const m = ROW.exec(item);
      return m !== null && (m[1].trim().endsWith(':') || m[2] === ':') && m[3].trim() !== '';
    })
  );
}

/** Les éléments d'une valeur de rangée, coupés aux virgules hors parenthèses : « a, b (c, d) » → « a », « b (c, d) ». */
export function splitItems(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(' || char === '[') depth++;
    if ((char === ')' || char === ']') && depth > 0) depth--;
    if (char === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += char;
  }
  out.push(current.trim());
  return out.filter((item) => item !== '');
}

/** Une pastille ne porte qu'un mot-clé : au plus 42 signes, sans phrase (pas de point final). */
const CHIP_MAX = 42;

/**
 * La valeur d'une rangée : une liste de mots-clés devient des pastilles (`.chip`), la virgule
 * gardée en vrai texte entre elles (`.cs`, de la couleur du fond de page : un ATS lit toujours
 * « a, b, c »). Une valeur qui ressemble à une phrase reste du texte.
 */
function rowValueHtml(value: string): string {
  const items = splitItems(value);
  const chips = items.length >= 2 && items.every((item) => item.length <= CHIP_MAX && !/[.;:]\s*$/.test(item));
  if (!chips) return `<span class="v">${inline(value)}</span>`;
  return `<span class="v chips">${items.map((item) => `<span class="chip">${inline(item)}</span>`).join('<span class="cs">, </span>')}</span>`;
}

function listHtml(items: string[]): string {
  if (!isRows(items)) return `<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
  const rows = items.map((item) => {
    const m = ROW.exec(item)!;
    const label = m[1].trim().endsWith(':') ? m[1].trim() : `${m[1].trim()}:`;
    // Les deux-points ne partent jamais seuls à la ligne (« Réseaux sociaux & contenu » puis « : » en dessous,
    // vu sur le CV Pikki le 2026-10-25) : le dernier mot et eux restent ensemble, l'espace reste un vrai espace pour l'ATS.
    const k = inline(label).replace(/(\S+) :$/, '<span class="nw">$1 :</span>');
    return `<li><strong class="k">${k}</strong> ${rowValueHtml(m[3].trim())}</li>`;
  });
  return `<ul class="rows">${rows.join('')}</ul>`;
}

function blockHtml(block: MdBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h${Math.min(6, Math.max(4, block.level))}>${inline(block.text)}</h${Math.min(6, Math.max(4, block.level))}>`;
    case 'paragraph':
      return `<p>${inline(block.lines.join(' '))}</p>`;
    case 'list':
      return listHtml(block.items);
    default:
      return '<hr>';
  }
}

/** Le préfixe d'un titre de CV qui n'est pas le nom : « CV — Jane Doe » → « Jane Doe ». */
const CV_PREFIX = /^(?:cv|c\.v\.|curriculum(?:\s+vitae)?|r[ée]sum[ée])$/iu;

/** Le nom et le poste du `# …` : « Jane Doe — Growth Lead » → nom et poste ; « CV — Jane Doe » → le nom seul. */
export function splitName(h1: string): { name: string; role: string } {
  const parts = h1.split(/\s+[—–-]\s+/);
  if (parts.length > 1 && CV_PREFIX.test(parts[0].trim())) parts.shift();
  return { name: parts[0].trim(), role: parts.slice(1).join(' — ').trim() };
}

/** Une ligne « Étiquette : texte » de poste : l'étiquette en petites capitales grises, le texte en accent. */
function roleHtml(segment: string): string {
  const match = /^\s*(?:\*\*)?([\p{L}][\p{L} .'’/&-]{0,30}?\s*:)(?:\*\*)?\s+(.*)$/u.exec(segment);
  if (match === null) return `<span class="title">${inline(segment)}</span>`;
  return `<span class="label">${inline(match[1].trim())}</span> <span class="title">${inline(match[2].replace(/^\*\*|\*\*$/g, ''))}</span>`;
}

/** L'en-tête : le nom, la ligne de poste, la ligne de contact rangée ; le reste du préambule tel quel. */
function mastheadHtml(blocks: MdBlock[]): string {
  const roles: string[] = [];
  const contacts: string[] = [];
  const rest: string[] = [];
  let name = '';
  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 1 && name === '') {
      const split = splitName(block.text);
      name = split.name;
      if (split.role !== '') roles.push(split.role);
    } else if (block.kind === 'paragraph') {
      for (const line of block.lines) {
        const segments = splitContact(line);
        const kinds = segments.map((segment) => contactLineKinds(segment));
        if (!kinds.some((kind) => kind === 'contact')) {
          roles.push(line);
          continue;
        }
        segments.forEach((segment, i) => (kinds[i] === 'role' ? roles.push(segment) : contacts.push(segment)));
      }
    } else if (block.kind !== 'rule') rest.push(blockHtml(block));
  }
  const out: string[] = [];
  if (name !== '') out.push(`<h1>${inline(name)}</h1>`);
  if (roles.length > 0) out.push(`<p class="role">${roles.map(roleHtml).join(' <span class="sep">·</span> ')}</p>`);
  if (contacts.length > 0) out.push(`<p class="contact">${contactLineHtml(contacts, inline)}</p>`);
  out.push(...rest);
  return out.length > 0 ? `<header class="masthead">${out.join('')}</header>` : '';
}

/** Un segment de préambule : un poste étiqueté, un contact (e-mail, téléphone, lien), ou autre chose (un lieu). */
function contactLineKinds(segment: string): 'role' | 'contact' | 'other' {
  const kind = contactKind(segment);
  if (kind === 'role') return 'role';
  return kind === 'place' ? 'other' : 'contact';
}

/** Une entrée `###` : son en-tête (titre, période à droite) et ce qui la suit jusqu'au titre suivant. */
function entryHtml(heading: string, body: MdBlock[]): string {
  let { title, date } = splitTrailingDate(heading);
  const first = body[0];
  if (date === '' && first?.kind === 'paragraph') {
    const meta = italicMeta(first.lines[0]);
    if (meta !== null) {
      date = meta;
      body = first.lines.length > 1 ? [{ kind: 'paragraph', lines: first.lines.slice(1) }, ...body.slice(1)] : body.slice(1);
    }
  }
  const head = `<div class="entry-head"><h3>${entryTitleHtml(title)}</h3>${date !== '' ? `<p class="when">${inline(date)}</p>` : ''}</div>`;
  return `<article class="entry">${head}${body.map(blockHtml).join('')}</article>`;
}

/** Le corps d'un CV : en-tête, puis une `<section>` par `##`, une `<article>` par `###`. */
export function cvBodyHtml(markdown: string): string {
  const blocks = markdownBlocks(markdown);
  const firstH1 = blocks.findIndex((block) => block.kind === 'heading' && block.level === 1);
  // La première section : le premier `##`, ou un second `#` (le premier est le nom).
  const firstSection = blocks.findIndex((block, at) => block.kind === 'heading' && (block.level === 2 || (block.level === 1 && at !== firstH1)));
  const preamble = firstSection < 0 ? blocks : blocks.slice(0, firstSection);
  const out: string[] = [mastheadHtml(preamble)];
  let i = firstSection < 0 ? blocks.length : firstSection;
  while (i < blocks.length) {
    const heading = blocks[i] as Extract<MdBlock, { kind: 'heading' }>;
    i++;
    const parts: string[] = [];
    let loose: MdBlock[] = [];
    const flushLoose = () => {
      parts.push(...loose.map(blockHtml));
      loose = [];
    };
    while (i < blocks.length && !(blocks[i].kind === 'heading' && (blocks[i] as { level: number }).level <= 2)) {
      const block = blocks[i];
      if (block.kind === 'heading' && block.level === 3) {
        flushLoose();
        const body: MdBlock[] = [];
        i++;
        while (i < blocks.length && !(blocks[i].kind === 'heading' && (blocks[i] as { level: number }).level <= 3)) body.push(blocks[i++]);
        parts.push(entryHtml(block.text, body));
      } else {
        loose.push(block);
        i++;
      }
    }
    flushLoose();
    out.push(`<section><h2>${inline(heading.text)}</h2>${parts.join('')}</section>`);
  }
  return out.filter((part) => part !== '').join('\n');
}

/** Les marges du CV : 13 mm en haut et en bas (la première page a le bandeau à la place), 16 mm sur les côtés. */
export const CV_PAGE: PageMargins = { verticalMm: 13, horizontalMm: 16 };

/**
 * Feuille de style : A4, une colonne, 9,8 pt sur 1,45. Le bandeau d'en-tête pleine largeur
 * (`print-style.ts`), le poste en crème ; les titres de section en capitales espacées d'accent,
 * un repère corail devant et un filet après ; le profil sur un panneau teinté à liseré d'accent ;
 * les entreprises en accent ; les entrées insécables, la période en chiffres tabulaires à droite ;
 * les compétences en rangées de pastilles. Rien de distant (`url(…)`, `@import`) : polices
 * système seulement ; rien d'hors flux (`PAINT_ORDER_BREAKERS`).
 */
export const CV_CSS = `
${pageCss(CV_PAGE)}
${tokensCss()}
body { font-family: ${FONTS.sans}; font-size: 9.8pt; line-height: 1.45; color: var(--ink); font-feature-settings: "kern", "liga"; -webkit-font-smoothing: antialiased; }
${mastheadCss(29, { verticalMm: 9, horizontalMm: CV_PAGE.horizontalMm })}
.masthead { margin-bottom: 11pt; padding-bottom: 5.2mm; }
.masthead h1 { margin-bottom: 5.5pt; padding-bottom: 5.5pt; }
.role { margin: 0 0 3pt; font-size: 10.8pt; font-weight: 600; color: var(--cream); letter-spacing: 0.005em; }
.role .label { font-weight: 600; font-size: 7.4pt; text-transform: uppercase; letter-spacing: 0.16em; color: var(--band-muted); padding-right: 0.15em; }
.role .sep { color: var(--warm-light); padding: 0 0.2em; }
.contact { font-size: 8.9pt; }
section { margin: 0 0 9pt; }
h2 { display: flex; align-items: center; gap: 6pt; font-size: 7.9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); margin: 0 0 6pt; break-after: avoid; }
h2::before { content: ""; flex: none; width: 9pt; height: 3pt; border-radius: 1.5pt; background: var(--warm); }
h2::after { content: ""; flex: 1; border-top: 0.6pt solid var(--rule); }
section > p { margin: 0 0 3pt; }
section:first-of-type > p { font-size: 10pt; line-height: 1.48; background: var(--tint); border-left: 2.4pt solid var(--accent); border-radius: 0 3pt 3pt 0; padding: 4.5pt 10pt 5pt; margin: 0; }
.entry { margin: 0 0 7pt; break-inside: avoid; }
.entry-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10pt; margin: 0 0 2.5pt; }
h3 { font-size: 10.2pt; font-weight: 400; margin: 0; color: var(--ink); }
h3 .org { font-weight: 700; color: var(--accent); }
h3 .dash { color: var(--dot); padding: 0 0.1em; }
h3 .what { color: var(--ink); font-weight: 500; }
.when { margin: 0; flex: none; font-size: 8.4pt; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
h4, h5, h6 { font-size: 9.6pt; margin: 4pt 0 1pt; }
p { margin: 0 0 3pt; }
ul { list-style: none; margin: 0 0 3pt; padding: 0; }
li { padding-left: 10pt; margin: 0 0 2pt; break-inside: avoid; }
li::before { content: ""; display: inline-block; width: 3.2pt; height: 3.2pt; margin: 0 6.8pt 0 -10pt; border-radius: 50%; background: var(--dot); vertical-align: 0.2em; }
ul.rows { display: grid; grid-template-columns: fit-content(56mm) 1fr; column-gap: 12pt; row-gap: 2.6pt; align-items: start; }
ul.rows li { display: contents; }
ul.rows li::before { display: none; }
ul.rows .k { font-weight: 600; color: var(--ink); line-height: 1.45; }
ul.rows .nw { white-space: nowrap; }
ul.rows .v { color: var(--ink); }
.chips { line-height: 1.52; margin-top: -0.6pt; }
.chip { display: inline-block; line-height: 1.28; padding: 0.2pt 5.5pt 0.5pt; border-radius: 7pt; background: var(--tint); color: var(--accent); font-size: 8.9pt; font-weight: 500; white-space: nowrap; }
.cs { color: #fff; font-size: 9pt; letter-spacing: -0.12em; }
strong { font-weight: 600; }
a { color: inherit; text-decoration: none; }
hr { border: 0; border-top: 0.6pt solid var(--rule); margin: 6pt 0; }
code { font-family: inherit; }
@media screen { body { max-width: 178mm; margin: 0 auto 13mm; } }
`;

export function cvDocument(markdown: string, title: string): string {
  return `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${CV_CSS}</style></head><body>\n${cvBodyHtml(markdown)}\n</body></html>\n`;
}
