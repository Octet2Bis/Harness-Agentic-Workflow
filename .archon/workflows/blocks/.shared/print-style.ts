/**
 * L'identité imprimée du dossier de candidature, partagée par le CV (`cvDocument`,
 * `systems/.shared/markdown.ts`) et la lettre (`letter-html.ts`) : un bandeau d'en-tête bleu-vert
 * profond pleine largeur (le nom en sérif crème, la ligne de contact claire), un accent
 * bleu-vert pour la structure, une touche chaude (corail) posée deux fois (le trait sous le nom,
 * les repères des titres de section), un sans-sérif pour le texte. Pur, sans dépendance, sans
 * rien de distant : les piles de polices ne nomment que des polices système (le PDF s'imprime
 * hors ligne, sous Windows comme sous Linux), aucune `url(…)` ni `@import`.
 *
 * Tout ce qui se lit reste du vrai texte dans l'ordre du document (un ATS lit le PDF) : le
 * bandeau, les filets, les repères, les puces et les pastilles sont des fonds et des bordures,
 * jamais des glyphes ni des images. Et aucun `position:` ni `opacity` : Chromium peint un élément
 * positionné (ou translucide) après le flux, et son texte sortirait du PDF après tout le reste
 * (constaté le 2026-10-23 : en-tête et puces relus en fin de page). `PAINT_ORDER_BREAKERS` le
 * vérifie. Le bandeau pleine largeur vient des marges : `@page` n'a pas de marge latérale (le
 * corps les reprend en `padding`), ni de marge haute en première page (le bandeau la remplace),
 * et l'en-tête déborde du corps par des marges négatives, dans le flux.
 */

/** Ce qui ferait peindre (donc extraire) un texte hors de l'ordre du document. */
export const PAINT_ORDER_BREAKERS = /(?<![\w-])(?:position\s*:\s*(?:relative|absolute|fixed|sticky)|opacity\s*:|z-index\s*:|transform\s*:|float\s*:)/;

/**
 * Les couleurs, toutes opaques (voir `PAINT_ORDER_BREAKERS`) : encre, gris secondaire, filets,
 * l'accent bleu-vert et son éclairci (puces), le bandeau et ce qui s'y lit (crème, clair, discret),
 * la touche chaude (corail, et sa version claire sur le bandeau), la teinte des pastilles.
 */
export const PALETTE = {
  ink: '#1d2327',
  muted: '#5c666c',
  rule: '#d5d9d6',
  accent: '#155e63',
  dot: '#5a8f93',
  band: '#123f43',
  cream: '#fbf4e6',
  onBand: '#cfe1de',
  bandMuted: '#8fb6b1',
  warm: '#de7a55',
  warmLight: '#f2a98a',
  tint: '#eaf2f0',
} as const;

/**
 * Les piles de polices, système seulement. Texte : Inter si elle est installée, sinon Segoe UI
 * (Windows), Helvetica Neue (macOS), Liberation Sans / Arial. Le nom : Iowan Old Style (macOS),
 * Cambria (Windows) ou Caladea, son équivalent métrique libre (Linux), puis Georgia. Pas de
 * Charter : la version Linux est en Type 1, que Chromium n'affiche plus.
 */
export const FONTS = {
  sans: 'Inter, "Segoe UI", "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Iowan Old Style", Cambria, Caladea, Georgia, "Liberation Serif", serif',
} as const;

/** Les variables CSS de l'identité et l'impression des couleurs à l'identique. */
export function tokensCss(): string {
  const vars = Object.entries(PALETTE)
    .map(([name, value]) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`)
    .join(' ');
  return `:root { ${vars} --sans: ${FONTS.sans}; --serif: ${FONTS.serif}; }
html { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`;
}

/** Les marges d'une page A4 à bandeau : haut et bas `verticalMm` (sauf le haut de la première page), côtés `horizontalMm` portés par le corps. */
export interface PageMargins {
  verticalMm: number;
  horizontalMm: number;
}

/** La page A4 : pas de marge latérale ni, en première page, de marge haute côté `@page` ; le corps reprend les côtés. */
export function pageCss({ verticalMm, horizontalMm }: PageMargins): string {
  return `@page { size: A4; margin: ${verticalMm}mm 0; }
@page :first { margin-top: 0; }
body { margin: 0; padding: 0 ${horizontalMm}mm; }`;
}

/**
 * L'en-tête commun, un bandeau pleine largeur : il déborde du corps de `horizontalMm` de chaque
 * côté (marges négatives, dans le flux) et reprend en haut la marge que la première page n'a pas.
 * Le nom (`h1`) en sérif crème, souligné d'un trait corail (un fond, pas un caractère) ; la ligne
 * de contact (`.contact`, séparateurs `.sep`) en clair. Sur écran, le bandeau garde ses marges.
 */
export function mastheadCss(namePt: number, { verticalMm, horizontalMm }: PageMargins): string {
  return `
.masthead { margin: 0 -${horizontalMm}mm; padding: ${verticalMm}mm ${horizontalMm}mm 7.5mm; background: var(--band); color: var(--on-band); }
.masthead h1 { font-family: var(--serif); font-weight: 400; font-size: ${namePt}pt; line-height: 1.08; letter-spacing: -0.005em; color: var(--cream); margin: 0; padding-bottom: 7pt; background: linear-gradient(var(--warm), var(--warm)) left bottom / 13mm 2.2pt no-repeat; }
.contact { color: var(--on-band); margin: 0; }
.contact .sep { color: var(--warm-light); padding: 0 0.25em; }
.contact a { color: inherit; text-decoration: none; }
.contact a.ico svg { width: 1.05em; height: 1.05em; vertical-align: -0.16em; fill: currentColor; }`;
}

export type ContactKind = 'place' | 'email' | 'phone' | 'linkedin' | 'url' | 'role';

/** Une étiquette en tête de segment (« **Tél :** », « Application: ») : un mot ou trois, puis deux-points et une espace. */
const LABEL = /^\s*(?:\*\*|__)?([\p{L}][\p{L} .'’/&-]{0,30}?)\s*:(?:\*\*|__)?\s+(?:\*\*|__)?/u;
/** Les étiquettes qui annoncent un contact ou un lieu, pas un poste. */
const CONTACT_LABEL = /^(?:e-?mail|courriel|mail|t[ée]l(?:[ée]phone)?|phone|mobile|portable|linkedin|portfolio|site(?: web)?|web(?:site)?|github|adresse|address|location|lieu|ville|localisation|contact)$/iu;

/** Le texte d'un segment sans emphase ni étiquette : ce qu'on classe. */
function bare(segment: string): string {
  const unlabelled = segment.replace(LABEL, '');
  return unlabelled.replace(/\*\*|__|`/g, '').replace(/^\*(.*)\*$/, '$1').trim();
}

/** Le genre d'un segment de ligne de contact. Un segment étiqueté d'autre chose qu'un contact (« Application: … », « Poste : … ») est un `role`. */
export function contactKind(segment: string): ContactKind {
  const text = bare(segment);
  const link = /\[[^\]]*\]\(([^)\s]+)\)/.exec(text)?.[1] ?? '';
  const target = link !== '' ? link : text;
  if (/^(?:mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) return 'email';
  if (/linkedin\.com\//i.test(target)) return 'linkedin';
  if (/^https?:\/\/\S+$/i.test(target) || /^(?:www\.)?[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?$/i.test(target)) return 'url';
  if (/^\+?\(?\d[\d\s().-]{6,}\d$/.test(target) && (target.match(/\d/g) ?? []).length >= 8) return 'phone';
  const label = LABEL.exec(segment)?.[1]?.trim() ?? '';
  if (label !== '' && !CONTACT_LABEL.test(label)) return 'role';
  return 'place';
}

/** Les segments d'une ligne de contact : séparés par « · », « • » ou « | » entourés d'espaces. */
export function splitContact(line: string): string[] {
  return line
    .split(/\s+[·•|]\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const ORDER: Record<ContactKind, number> = { role: 0, place: 1, email: 2, phone: 3, linkedin: 4, url: 5 };

/** Les segments rangés lieu · e-mail · téléphone · LinkedIn · portfolio (ordre d'origine gardé dans un même genre). */
export function orderContact(segments: string[]): { kind: ContactKind; text: string }[] {
  return segments
    .map((text, index) => ({ kind: contactKind(text), text, index }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.index - b.index)
    .map(({ kind, text }) => ({ kind, text }));
}

/** Une URL à lire : sans protocole, sans « www. », sans barre finale. */
export function prettyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Le logo LinkedIn (carré « in », tracé libre de droits de Simple Icons), à la couleur du texte. */
export const LINKEDIN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>';

/** L'adresse d'un segment LinkedIn : l'URL nue, la cible d'un lien Markdown, ou `linkedin.com/in/…` sans protocole. */
function linkedinHref(text: string): string {
  const target = /\[[^\]]*\]\(([^)\s]+)\)/.exec(text)?.[1] ?? bare(text);
  return /^https?:\/\//i.test(target) ? target : `https://${target}`;
}

/**
 * Un segment de contact en HTML : LinkedIn devient son logo cliquable (l'adresse vit dans le lien
 * du PDF, plus dans sa couche texte), une URL nue un lien lisible (`antoine.example`), un
 * e-mail nu un lien `mailto:` ; le reste passe par `inline` (le Markdown d'une ligne de
 * l'appelant, qui échappe tout) : `[Portfolio](https://…)` y devient un lien « Portfolio ».
 */
export function contactSegmentHtml(segment: string, inline: (markdown: string) => string): string {
  const text = segment.trim();
  if (contactKind(text) === 'linkedin') {
    return `<a class="ico" href="${escapeAttr(linkedinHref(text))}" aria-label="LinkedIn">${LINKEDIN_SVG}</a>`;
  }
  if (/^https?:\/\/\S+$/i.test(text)) return `<a href="${escapeAttr(text)}">${inline(prettyUrl(text))}</a>`;
  if (/^[^\s@*[\]()]+@[^\s@*[\]()]+\.[^\s@*[\]()]+$/.test(text)) return `<a href="mailto:${escapeAttr(text)}">${inline(text)}</a>`;
  return inline(text);
}

/** La ligne de contact : segments rangés, séparés par un point médian d'accent (du texte : un ATS lit « a · b »). */
export function contactLineHtml(segments: string[], inline: (markdown: string) => string): string {
  return orderContact(segments)
    .map(({ text }) => contactSegmentHtml(text, inline))
    .join(' <span class="sep">·</span> ');
}
