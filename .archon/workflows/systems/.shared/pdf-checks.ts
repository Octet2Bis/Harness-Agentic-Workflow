/**
 * Contrôles d'un PDF par du code, avant que quiconque le voie : structure (en-tête, `%%EOF`,
 * `startxref`, catalogue, pas de chiffrement), nombre de pages, couche texte extractible,
 * aucune page sans texte, e-mail et téléphone du candidat présents, aucun reste de gabarit,
 * chiffres lisibles, polices embarquées. Chaque règle rend une liste de problèmes en français,
 * vide quand elle passe ; `verifyPdf` les enchaîne.
 *
 * Pur et sans dépendance : le PDF est lu ici même (objets, flux d'objets, FlateDecode par
 * node:zlib, arbre des pages, flux de contenu) et son texte décodé comme un ATS le lit — par
 * les CMap ToUnicode qu'émettent Chromium et Edge (Skia : polices Type0 Identity-H en chaînes
 * hexadécimales de glyphes de deux octets, polices Type3 octet par octet, `/ActualText`), à
 * défaut par l'encodage de la police (WinAnsi, `/Differences`). Les espaces et les retours à la
 * ligne sont déduits des positions des glyphes (chasses de la police), pas devinés.
 *
 * Adapté de ai-job-search/tools/verify_pdf.py (MIT)
 * (nombre de pages, couche texte minimale, texte requis comparé après repli typographique,
 * texte extrait déposé avant les contrôles pour qu'un échec reste lisible).
 * Adapté de ai-job-search/tools/verify_layout.py (MIT)
 * (une page sans texte est un défaut, pas une page « vide mais correcte »).
 */

import { constants, inflateSync } from 'node:zlib';

// ── 1. Objets PDF ───────────────────────────────────────────────────────────────────
// Les octets sont portés par des chaînes latin1 : un caractère = un octet, sans copie.

interface PdfName { kind: 'name'; name: string }
interface PdfString { kind: 'string'; bytes: string }
interface PdfRef { kind: 'ref'; num: number }
interface PdfDict { kind: 'dict'; map: Record<string, PdfValue> }
interface PdfStream { kind: 'stream'; map: Record<string, PdfValue>; raw: string }
interface PdfOp { kind: 'op'; op: string }
type PdfValue = number | boolean | null | PdfName | PdfString | PdfRef | PdfDict | PdfStream | PdfValue[];

type Token =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: string }
  | { t: 'kw'; v: string }
  | { t: 'punct'; v: string };

const WHITESPACE = '\x00\t\n\f\r ';
const DELIMITERS = '()<>[]{}/%';

class Lexer {
  constructor(readonly s: string, public pos = 0) {}

  skip(): void {
    const s = this.s;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (WHITESPACE.includes(c)) this.pos++;
      else if (c === '%') while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++;
      else break;
    }
  }

  private word(): string {
    const start = this.pos;
    while (this.pos < this.s.length && !WHITESPACE.includes(this.s[this.pos]) && !DELIMITERS.includes(this.s[this.pos])) this.pos++;
    return this.s.slice(start, this.pos);
  }

  private literal(): string {
    const s = this.s;
    let depth = 1;
    let out = '';
    this.pos++;
    while (this.pos < s.length) {
      const c = s[this.pos++];
      if (c === '\\') {
        const n = s[this.pos++] ?? '';
        const escaped: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
        if (n in escaped) out += escaped[n];
        else if (n === '\r') {
          if (s[this.pos] === '\n') this.pos++;
        } else if (n === '\n') {
          // fin de ligne échappée : la chaîne continue
        } else if (n >= '0' && n <= '7') {
          let octal = n;
          while (octal.length < 3 && s[this.pos] >= '0' && s[this.pos] <= '7') octal += s[this.pos++];
          out += String.fromCharCode(parseInt(octal, 8) & 0xff);
        } else out += n;
      } else if (c === '(') {
        depth++;
        out += c;
      } else if (c === ')') {
        if (--depth === 0) break;
        out += c;
      } else out += c;
    }
    return out;
  }

  private hex(): string {
    const end = this.s.indexOf('>', this.pos);
    const close = end < 0 ? this.s.length : end;
    let digits = this.s.slice(this.pos + 1, close).replace(/[^0-9A-Fa-f]/g, '');
    this.pos = close + 1;
    if (digits.length % 2 === 1) digits += '0';
    let out = '';
    for (let i = 0; i < digits.length; i += 2) out += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
    return out;
  }

  /** Le jeton suivant ; null en fin de texte. */
  token(): Token | null {
    this.skip();
    const s = this.s;
    if (this.pos >= s.length) return null;
    const c = s[this.pos];
    if (c === '/') {
      this.pos++;
      return { t: 'name', v: this.word().replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === '(') return { t: 'str', v: this.literal() };
    if (c === '<') {
      if (s[this.pos + 1] === '<') {
        this.pos += 2;
        return { t: 'punct', v: '<<' };
      }
      return { t: 'str', v: this.hex() };
    }
    if (c === '>') {
      this.pos += s[this.pos + 1] === '>' ? 2 : 1;
      return { t: 'punct', v: '>>' };
    }
    if ('[]{}'.includes(c)) {
      this.pos++;
      return { t: 'punct', v: c };
    }
    if (c === ')') {
      this.pos++;
      return { t: 'kw', v: ')' };
    }
    const word = this.word();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: Number(word) };
    return { t: 'kw', v: word };
  }
}

function isOp(value: PdfValue | PdfOp | undefined): value is PdfOp {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'op';
}

/** Une valeur à partir du jeton `tok` : `n g R` devient une référence, un mot-clé un opérateur. */
function readValue(lex: Lexer, tok: Token | null): PdfValue | PdfOp | undefined {
  if (tok === null) return undefined;
  if (tok.t === 'num') {
    if (Number.isInteger(tok.v) && tok.v >= 0) {
      const save = lex.pos;
      const gen = lex.token();
      if (gen?.t === 'num' && Number.isInteger(gen.v)) {
        const r = lex.token();
        if (r?.t === 'kw' && r.v === 'R') return { kind: 'ref', num: tok.v };
      }
      lex.pos = save;
    }
    return tok.v;
  }
  if (tok.t === 'name') return { kind: 'name', name: tok.v };
  if (tok.t === 'str') return { kind: 'string', bytes: tok.v };
  if (tok.t === 'kw') {
    if (tok.v === 'true') return true;
    if (tok.v === 'false') return false;
    if (tok.v === 'null') return null;
    return { kind: 'op', op: tok.v };
  }
  if (tok.v === '[') {
    const items: PdfValue[] = [];
    for (let next = lex.token(); next !== null && !(next.t === 'punct' && next.v === ']'); next = lex.token()) {
      const value = readValue(lex, next);
      if (value !== undefined && !isOp(value)) items.push(value);
    }
    return items;
  }
  if (tok.v === '<<') {
    const map: Record<string, PdfValue> = {};
    for (let next = lex.token(); next !== null && !(next.t === 'punct' && next.v === '>>'); next = lex.token()) {
      if (next.t !== 'name') continue;
      const value = readValue(lex, lex.token());
      if (value !== undefined && !isOp(value)) map[next.v] = value;
    }
    return { kind: 'dict', map };
  }
  return undefined;
}

// ── 2. Le document : objets, flux, catalogue, pages ─────────────────────────────────

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** ASCII85Decode (ReportLab et d'autres l'enchaînent avant FlateDecode) : 5 caractères → 4 octets, « z » → 4 zéros. */
function ascii85(data: string): string {
  const body = data.replace(/\s+/g, '').replace(/^<~/, '').split('~>')[0];
  let out = '';
  let group: number[] = [];
  const flush = (count: number): void => {
    let n = 0;
    for (const digit of group) n = n * 85 + digit;
    out += String.fromCharCode(Math.floor(n / 0x1000000) & 0xff, Math.floor(n / 0x10000) & 0xff, Math.floor(n / 0x100) & 0xff, n & 0xff).slice(0, count);
  };
  for (const char of body) {
    if (char === 'z' && group.length === 0) {
      out += '\0\0\0\0';
      continue;
    }
    const digit = char.charCodeAt(0) - 33;
    if (digit < 0 || digit > 84) continue;
    group.push(digit);
    if (group.length === 5) {
      flush(4);
      group = [];
    }
  }
  if (group.length > 1) {
    const kept = group.length - 1;
    while (group.length < 5) group.push(84);
    flush(kept);
  }
  return out;
}

interface Page {
  map: Record<string, PdfValue>;
  resources: Record<string, PdfValue>;
}

class PdfDocument {
  readonly objects = new Map<number, PdfValue>();
  readonly structure: string[] = [];
  trailer: Record<string, PdfValue> | null = null;
  pages: Page[] = [];
  private readonly decoded = new WeakMap<PdfStream, string>();

  constructor(readonly s: string) {
    const head = s.slice(0, 1024).indexOf('%PDF-');
    if (head < 0) {
      this.structure.push("pas un PDF : l'en-tête %PDF- manque au début du fichier");
      return;
    }
    if (!s.slice(-1024).includes('%%EOF')) this.structure.push('PDF tronqué : pas de marqueur %%EOF à la fin du fichier');
    const xref = /startxref\s+(\d+)/g;
    let offset = -1;
    for (let m = xref.exec(s); m !== null; m = xref.exec(s)) offset = Number(m[1]);
    if (offset < 0 || !(s.startsWith('xref', offset) || /^\d+\s+\d+\s+obj\b/.test(s.slice(offset, offset + 40)))) {
      this.structure.push('table des objets introuvable : startxref manque ou ne pointe pas sur elle (fichier abîmé, fins de ligne converties ?)');
    }
    this.scanObjects();
    const root = this.mapOf(this.trailer?.Root);
    if (this.trailer?.Encrypt !== undefined) this.structure.push('PDF chiffré : son texte ne peut pas être vérifié');
    if (root === null) {
      this.structure.push('catalogue introuvable : le trailer ne nomme pas de /Root lisible');
      // Sans catalogue, les objets /Type /Page dans l'ordre du fichier.
      for (const value of this.objects.values()) {
        const map = this.mapOf(value);
        if (map !== null && this.nameOf(map.Type) === 'Page') this.pages.push({ map, resources: this.mapOf(this.resolve(map.Resources)) ?? {} });
      }
    } else this.collectPages(root.Pages, {}, new Set(), 0);
    if (this.pages.length === 0) this.structure.push('aucune page');
  }

  /** Tous les objets `n g obj … endobj`, dans l'ordre du fichier (le dernier défini l'emporte), flux d'objets compris. */
  private scanObjects(): void {
    const s = this.s;
    const header = /(?<!\d)(\d+)\s+\d+\s+obj\b/g;
    const trailers: { at: number; map: Record<string, PdfValue> }[] = [];
    let pos = 0;
    for (;;) {
      header.lastIndex = pos;
      const m = header.exec(s);
      if (m === null) break;
      const lex = new Lexer(s, m.index + m[0].length);
      const value = readValue(lex, lex.token());
      pos = lex.pos;
      if (value === undefined || isOp(value)) continue;
      let object: PdfValue = value;
      lex.skip();
      if (s.startsWith('stream', lex.pos) && typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'dict') {
        let start = lex.pos + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        const length = value.map.Length;
        let end = -1;
        if (typeof length === 'number' && length >= 0) {
          const after = new Lexer(s, start + length);
          after.skip();
          if (s.startsWith('endstream', after.pos)) end = start + length;
        }
        if (end < 0) {
          const found = s.indexOf('endstream', start);
          end = found < 0 ? s.length : found;
          while (end > start && (s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
        }
        object = { kind: 'stream', map: value.map, raw: s.slice(start, end) };
        pos = Math.max(pos, end);
        if (this.nameOf(value.map.Type) === 'XRef') trailers.push({ at: m.index, map: value.map });
      }
      this.objects.set(Number(m[1]), object);
      if (typeof object === 'object' && object !== null && !Array.isArray(object) && object.kind === 'stream' && this.nameOf(object.map.Type) === 'ObjStm') {
        this.unpackObjectStream(object);
      }
    }
    const word = /trailer\s*<</g;
    for (let t = word.exec(s); t !== null; t = word.exec(s)) {
      const lex = new Lexer(s, t.index + 7);
      const value = readValue(lex, lex.token());
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'dict') trailers.push({ at: t.index, map: value.map });
    }
    trailers.sort((a, b) => a.at - b.at);
    this.trailer = [...trailers].reverse().find((t) => t.map.Root !== undefined)?.map ?? trailers.at(-1)?.map ?? null;
  }

  private unpackObjectStream(stream: PdfStream): void {
    let data: string;
    try {
      data = this.decode(stream);
    } catch {
      return;
    }
    const count = typeof stream.map.N === 'number' ? stream.map.N : 0;
    const first = typeof stream.map.First === 'number' ? stream.map.First : 0;
    const lex = new Lexer(data.slice(0, first));
    const entries: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const num = lex.token();
      const at = lex.token();
      if (num?.t !== 'num' || at?.t !== 'num') break;
      entries.push([num.v, at.v]);
    }
    for (const [num, at] of entries) {
      const inner = new Lexer(data, first + at);
      const value = readValue(inner, inner.token());
      if (value !== undefined && !isOp(value)) this.objects.set(num, value);
    }
  }

  resolve(value: PdfValue | undefined): PdfValue | undefined {
    let current = value;
    for (let depth = 0; depth < 32 && typeof current === 'object' && current !== null && !Array.isArray(current) && current.kind === 'ref'; depth++) {
      current = this.objects.get(current.num) ?? null;
    }
    return current;
  }

  /** Le dictionnaire d'un objet (ou d'un flux), résolu ; null sinon. */
  mapOf(value: PdfValue | undefined): Record<string, PdfValue> | null {
    const v = this.resolve(value);
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && (v.kind === 'dict' || v.kind === 'stream')) return v.map;
    return null;
  }

  stream(value: PdfValue | undefined): PdfStream | null {
    const v = this.resolve(value);
    return typeof v === 'object' && v !== null && !Array.isArray(v) && v.kind === 'stream' ? v : null;
  }

  array(value: PdfValue | undefined): PdfValue[] {
    const v = this.resolve(value);
    return Array.isArray(v) ? v : [];
  }

  number(value: PdfValue | undefined, fallback: number): number {
    const v = this.resolve(value);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  nameOf(value: PdfValue | undefined): string {
    const v = this.resolve(value);
    return typeof v === 'object' && v !== null && !Array.isArray(v) && v.kind === 'name' ? v.name : '';
  }

  /** Le contenu décodé d'un flux (FlateDecode, ASCIIHexDecode, ASCII85Decode) ; lève une erreur sur un filtre inconnu (LZW, RunLength…). */
  decode(stream: PdfStream): string {
    const cached = this.decoded.get(stream);
    if (cached !== undefined) return cached;
    const filter = this.resolve(stream.map.Filter);
    const filters = Array.isArray(filter) ? filter.map((f) => this.nameOf(f)) : filter === undefined || filter === null ? [] : [this.nameOf(filter)];
    let data = stream.raw;
    for (const name of filters) {
      if (name === 'FlateDecode' || name === 'Fl') {
        const params = this.mapOf(stream.map.DecodeParms);
        if (params !== null && this.number(params.Predictor, 1) > 1) throw new Error('prédicteur FlateDecode non pris en charge');
        data = inflateSync(Buffer.from(data, 'latin1'), { finishFlush: constants.Z_SYNC_FLUSH }).toString('latin1');
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        data = new Lexer(`<${data.split('>')[0]}>`).token()?.v as string;
      } else if (name === 'ASCII85Decode' || name === 'A85') {
        data = ascii85(data);
      } else throw new Error(`filtre ${name || '?'} non pris en charge`);
    }
    this.decoded.set(stream, data);
    return data;
  }

  /** Les feuilles de l'arbre des pages, dans l'ordre, avec les ressources héritées. */
  private collectPages(node: PdfValue | undefined, inherited: Record<string, PdfValue>, seen: Set<Record<string, PdfValue>>, depth: number): void {
    const map = this.mapOf(node);
    if (map === null || seen.has(map) || depth > 32) return;
    seen.add(map);
    const resources = this.mapOf(map.Resources) ?? inherited;
    const kids = this.resolve(map.Kids);
    if (this.nameOf(map.Type) === 'Pages' || (Array.isArray(kids) && this.nameOf(map.Type) !== 'Page')) {
      for (const kid of this.array(map.Kids)) this.collectPages(kid, resources, seen, depth + 1);
    } else this.pages.push({ map, resources });
  }
}

// ── 3. Les polices : du code au texte ───────────────────────────────────────────────

/** Ce que les contrôles retiennent d'une police utilisée par une page. */
export interface PdfFont {
  name: string;
  subtype: string;
  embedded: boolean;
  /** Glyphes affichés sans correspondance Unicode (ni ToUnicode, ni encodage connu). */
  unmapped: number;
}

interface Font {
  report: PdfFont;
  /** Codes de deux octets (Type0 Identity-H/V). */
  twoBytes: boolean;
  ranges: { len: number; lo: number; hi: number }[];
  toUnicode: Map<string, string>;
  encoding: (string | undefined)[] | null;
  width(code: number): number;
}

const WIN_ANSI_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
  quoteright: '’', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\',
  bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', quoteleft: '‘', braceleft: '{', bar: '|', braceright: '}',
  asciitilde: '~', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„',
  guillemotleft: '«', guillemotright: '»', guilsinglleft: '‹', guilsinglright: '›', ellipsis: '…', bullet: '•',
  periodcentered: '·', degree: '°', Euro: '€', euro: '€', copyright: '©', registered: '®', trademark: '™', section: '§',
  nbspace: '\u00A0', nonbreakingspace: '\u00A0', minus: '−', multiply: '×', divide: '÷', oe: 'œ', OE: 'Œ', ae: 'æ', AE: 'Æ',
  germandbls: 'ß', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl',
};
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circumflex: '\u0302', dieresis: '\u0308', cedilla: '\u0327', tilde: '\u0303', ring: '\u030A', caron: '\u030C' };

/** Le caractère d'un nom de glyphe (liste d'Adobe, réduite à l'alphabet latin, `uniXXXX`, `uXXXX`). */
export function glyphToUnicode(name: string): string | undefined {
  const base = name.split('.')[0];
  if (base.includes('_')) {
    const parts = base.split('_').map(glyphToUnicode);
    return parts.every((part) => part !== undefined) ? parts.join('') : undefined;
  }
  if (base in GLYPHS) return GLYPHS[base];
  if (/^[A-Za-z]$/.test(base)) return base;
  const accented = base.match(/^([A-Za-z])(acute|grave|circumflex|dieresis|cedilla|tilde|ring|caron)$/);
  if (accented) return (accented[1] + ACCENTS[accented[2]]).normalize('NFC');
  const uni = base.match(/^uni((?:[0-9A-Fa-f]{4})+)$/);
  if (uni) return (uni[1].match(/.{4}/g) ?? []).map((hex) => String.fromCharCode(parseInt(hex, 16))).join('');
  const u = base.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (u) return String.fromCodePoint(parseInt(u[1], 16));
  return undefined;
}

function utf16(bytes: string): string {
  if (bytes.length % 2 === 1) return bytes;
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1));
  return out;
}

function bytesToInt(bytes: string): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) n = n * 256 + bytes.charCodeAt(i);
  return n;
}

/** Une chaîne de texte PDF (`/ActualText`, `/Title`) : UTF-16BE avec BOM, UTF-8 avec BOM, sinon PDFDocEncoding (≈ latin1). */
function textString(bytes: string): string {
  if (bytes.startsWith('\xFE\xFF')) return utf16(bytes.slice(2));
  if (bytes.startsWith('\xEF\xBB\xBF')) return Buffer.from(bytes.slice(3), 'latin1').toString('utf8');
  return bytes;
}

/** Une CMap ToUnicode : plages de codes (`codespacerange`) et correspondances (`bfchar`, `bfrange`). */
function parseToUnicode(cmap: string): { ranges: Font['ranges']; map: Map<string, string> } {
  const ranges: Font['ranges'] = [];
  const map = new Map<string, string>();
  const lex = new Lexer(cmap);
  let mode = '';
  let items: PdfValue[] = [];
  const str = (value: PdfValue | undefined): string | null => (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'string' ? value.bytes : null);
  const target = (value: PdfValue | undefined): string | null => {
    const bytes = str(value);
    if (bytes !== null) return utf16(bytes);
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'name') return glyphToUnicode(value.name) ?? null;
    return null;
  };
  for (let tok = lex.token(); tok !== null; tok = lex.token()) {
    if (tok.t === 'kw') {
      if (tok.v === 'begincodespacerange' || tok.v === 'beginbfchar' || tok.v === 'beginbfrange') {
        mode = tok.v;
        items = [];
      } else if (tok.v.startsWith('end') && mode !== '') {
        if (mode === 'begincodespacerange') {
          for (let i = 0; i + 1 < items.length; i += 2) {
            const lo = str(items[i]);
            const hi = str(items[i + 1]);
            if (lo !== null && hi !== null && lo.length > 0) ranges.push({ len: lo.length, lo: bytesToInt(lo), hi: bytesToInt(hi) });
          }
        } else if (mode === 'beginbfchar') {
          for (let i = 0; i + 1 < items.length; i += 2) {
            const src = str(items[i]);
            const dst = target(items[i + 1]);
            if (src !== null && dst !== null) map.set(`${src.length}:${bytesToInt(src)}`, dst);
          }
        } else {
          for (let i = 0; i + 2 < items.length; i += 3) {
            const lo = str(items[i]);
            const hi = str(items[i + 1]);
            const dst = items[i + 2];
            if (lo === null || hi === null) continue;
            const first = bytesToInt(lo);
            const last = Math.min(bytesToInt(hi), first + 0xffff);
            for (let code = first; code <= last; code++) {
              let mapped: string | null = null;
              if (Array.isArray(dst)) mapped = target(dst[code - first]);
              else {
                const base = target(dst);
                if (base !== null && base.length > 0) mapped = base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (code - first));
              }
              if (mapped !== null) map.set(`${lo.length}:${code}`, mapped);
            }
          }
        }
        mode = '';
      }
      continue;
    }
    if (mode === '') continue;
    const value = readValue(lex, tok);
    if (value !== undefined && !isOp(value)) items.push(value);
  }
  return { ranges, map };
}

function hasFontFile(doc: PdfDocument, descriptor: PdfValue | undefined): boolean {
  const map = doc.mapOf(descriptor);
  return map !== null && (map.FontFile !== undefined || map.FontFile2 !== undefined || map.FontFile3 !== undefined);
}

/** L'encodage d'une police simple : base (WinAnsi par défaut, ASCII + latin1) et `/Differences`. */
function simpleEncoding(doc: PdfDocument, encoding: PdfValue | undefined): (string | undefined)[] {
  const table: (string | undefined)[] = [];
  const dict = doc.mapOf(encoding);
  const baseName = dict !== null ? doc.nameOf(dict.BaseEncoding) : doc.nameOf(encoding);
  for (let code = 0; code < 256; code++) {
    if (code >= 0x20 && code < 0x7f) table[code] = String.fromCharCode(code);
    else if (code >= 0x80 && code < 0xa0) table[code] = baseName === 'WinAnsiEncoding' || baseName === '' ? WIN_ANSI_HIGH[code - 0x80] : undefined;
    else if (code >= 0xa0) table[code] = String.fromCharCode(code);
  }
  if (baseName === 'StandardEncoding') {
    table[0x27] = '’';
    table[0x60] = '‘';
  }
  if (dict !== null) {
    let code = 0;
    for (const item of doc.array(dict.Differences)) {
      const value = doc.resolve(item);
      if (typeof value === 'number') code = value;
      else if (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'name') {
        table[code] = glyphToUnicode(value.name);
        code++;
      }
    }
  }
  return table;
}

function loadFont(doc: PdfDocument, map: Record<string, PdfValue>, resourceName: string): Font {
  const subtype = doc.nameOf(map.Subtype) || '?';
  const toUnicodeStream = doc.stream(map.ToUnicode);
  let parsed: ReturnType<typeof parseToUnicode> = { ranges: [], map: new Map() };
  if (toUnicodeStream !== null) {
    try {
      parsed = parseToUnicode(doc.decode(toUnicodeStream));
    } catch {
      parsed = { ranges: [], map: new Map() };
    }
  }
  let name = doc.nameOf(map.BaseFont);
  let embedded: boolean;
  let width: (code: number) => number;
  let encoding: (string | undefined)[] | null = null;
  let twoBytes = false;
  if (subtype === 'Type0') {
    const descendant = doc.mapOf(doc.array(map.DescendantFonts)[0]) ?? {};
    const encodingName = doc.nameOf(map.Encoding);
    twoBytes = encodingName === 'Identity-H' || encodingName === 'Identity-V' || parsed.ranges.length === 0;
    embedded = hasFontFile(doc, descendant.FontDescriptor);
    const defaultWidth = doc.number(descendant.DW, 1000);
    const widths = new Map<number, number>();
    const w = doc.array(descendant.W);
    for (let i = 0; i < w.length; ) {
      const first = doc.number(w[i], -1);
      const next = doc.resolve(w[i + 1]);
      if (Array.isArray(next)) {
        next.forEach((value, j) => widths.set(first + j, doc.number(value, defaultWidth)));
        i += 2;
      } else {
        const last = Math.min(doc.number(next, first), first + 0xffff);
        const value = doc.number(w[i + 2], defaultWidth);
        for (let cid = first; cid <= last; cid++) widths.set(cid, value);
        i += 3;
      }
    }
    width = (code) => (widths.get(code) ?? defaultWidth) / 1000;
  } else {
    const firstChar = doc.number(map.FirstChar, 0);
    const widths = doc.array(map.Widths);
    const descriptor = doc.mapOf(map.FontDescriptor);
    if (subtype === 'Type3') {
      // Les glyphes d'une police Type3 sont des procédures du fichier : embarquée par construction.
      embedded = true;
      name = name || (descriptor !== null ? doc.nameOf(descriptor.FontName) : '') || resourceName;
      const scale = doc.number(doc.array(map.FontMatrix)[0], 0.001);
      width = (code) => doc.number(widths[code - firstChar], 0) * scale;
    } else {
      embedded = hasFontFile(doc, map.FontDescriptor);
      const missing = descriptor !== null ? doc.number(descriptor.MissingWidth, 0) : 0;
      // Sans /Widths (police standard non embarquée), une chasse moyenne d'un demi-cadratin.
      width = (code) => (widths.length === 0 ? 0.5 : doc.number(widths[code - firstChar], missing) / 1000);
    }
    encoding = simpleEncoding(doc, map.Encoding);
  }
  return {
    report: { name: name || resourceName, subtype, embedded, unmapped: 0 },
    twoBytes,
    ranges: parsed.ranges,
    toUnicode: parsed.map,
    encoding,
    width,
  };
}

/** Découpe une chaîne affichée en codes (longueur selon la police) et rend leur texte. */
function decodeCodes(font: Font, bytes: string): { code: number; single: boolean; text: string }[] {
  const out: { code: number; single: boolean; text: string }[] = [];
  for (let i = 0; i < bytes.length; ) {
    let len = font.twoBytes ? 2 : 1;
    if (!font.twoBytes && font.encoding === null && font.ranges.length > 0) {
      for (const candidate of [1, 2, 3, 4]) {
        if (i + candidate > bytes.length) break;
        const code = bytesToInt(bytes.slice(i, i + candidate));
        if (font.ranges.some((r) => r.len === candidate && code >= r.lo && code <= r.hi)) {
          len = candidate;
          break;
        }
      }
    }
    len = Math.min(len, bytes.length - i);
    const code = bytesToInt(bytes.slice(i, i + len));
    i += len;
    let text = font.toUnicode.get(`${len}:${code}`);
    if (text === undefined && font.encoding !== null) text = font.encoding[code];
    if (text === undefined) {
      font.report.unmapped++;
      text = '\uFFFD';
    }
    out.push({ code, single: len === 1, text });
  }
  return out;
}

// ── 4. Le texte d'une page : interprète des flux de contenu ─────────────────────────

interface GraphicState {
  ctm: Matrix;
  font: Font | null;
  size: number;
  charSpacing: number;
  wordSpacing: number;
  scale: number;
  leading: number;
}

class PageText {
  out = '';
  private last: { x: number; y: number; size: number } | null = null;

  /** Avant un fragment : retour à la ligne si la ligne change, espace si un blanc sépare les glyphes. */
  separate(x: number, y: number, size: number): void {
    const last = this.last;
    if (last === null || this.out === '') return;
    const unit = Math.max(size, last.size, 0.01);
    if (Math.abs(y - last.y) > unit * 0.5) {
      if (!this.out.endsWith('\n')) this.out = `${this.out.replace(/[ \t]+$/, '')}\n`;
    } else {
      const dx = x - last.x;
      if ((dx > unit * 0.2 || dx < -unit) && !/\s$/.test(this.out)) this.out += ' ';
    }
  }

  moved(x: number, y: number, size: number): void {
    this.last = { x, y, size };
  }
}

class Interpreter {
  private readonly fonts = new Map<Record<string, PdfValue>, Font>();
  readonly used = new Set<Font>();

  constructor(private readonly doc: PdfDocument) {}

  pageText(page: Page): string {
    const text = new PageText();
    const contents = this.doc.resolve(page.map.Contents);
    const streams = Array.isArray(contents) ? contents.map((c) => this.doc.stream(c)) : [this.doc.stream(contents)];
    const content = streams.filter((s): s is PdfStream => s !== null).map((s) => this.doc.decode(s)).join('\n');
    const gs: GraphicState = { ctm: [...IDENTITY], font: null, size: 0, charSpacing: 0, wordSpacing: 0, scale: 1, leading: 0 };
    this.run(content, page.resources, gs, text, 0);
    return text.out.normalize('NFC').trim();
  }

  private font(resources: Record<string, PdfValue>, name: string): Font | null {
    const fonts = this.doc.mapOf(resources.Font);
    const map = fonts === null ? null : this.doc.mapOf(fonts[name]);
    if (map === null) return null;
    let font = this.fonts.get(map);
    if (font === undefined) {
      font = loadFont(this.doc, map, name);
      this.fonts.set(map, font);
    }
    return font;
  }

  private run(content: string, resources: Record<string, PdfValue>, start: GraphicState, page: PageText, depth: number): void {
    const doc = this.doc;
    const lex = new Lexer(content);
    const stack: GraphicState[] = [];
    const spans: { actual: string | null; start: number }[] = [];
    let gs: GraphicState = { ...start };
    let tm: Matrix = [...IDENTITY];
    let tlm: Matrix = [...IDENTITY];
    let operands: (PdfValue | undefined)[] = [];
    const num = (i: number, fallback = 0): number => {
      const v = operands[i];
      return typeof v === 'number' ? v : fallback;
    };
    const nextLine = (tx: number, ty: number): void => {
      tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
      tm = [...tlm];
    };
    const show = (bytes: string): void => {
      const font = gs.font;
      if (font === null) return;
      this.used.add(font);
      const at = multiply(tm, gs.ctm);
      const size = gs.size * Math.sqrt(Math.abs(at[0] * at[3] - at[1] * at[2]));
      page.separate(at[4], at[5], size);
      for (const glyph of decodeCodes(font, bytes)) {
        page.out += glyph.text;
        const advance = (font.width(glyph.code) * gs.size + gs.charSpacing + (glyph.single && glyph.code === 32 ? gs.wordSpacing : 0)) * gs.scale;
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
      }
      const end = multiply(tm, gs.ctm);
      page.moved(end[4], end[5], size);
    };
    for (let tok = lex.token(); tok !== null; tok = lex.token()) {
      const value = readValue(lex, tok);
      if (!isOp(value)) {
        operands.push(value);
        continue;
      }
      switch (value.op) {
        case 'q':
          stack.push({ ...gs });
          break;
        case 'Q':
          gs = stack.pop() ?? gs;
          break;
        case 'cm':
          gs.ctm = multiply([num(0, 1), num(1), num(2), num(3, 1), num(4), num(5)], gs.ctm);
          break;
        case 'BT':
          tm = [...IDENTITY];
          tlm = [...IDENTITY];
          break;
        case 'Tf': {
          const name = operands[0];
          gs.font = typeof name === 'object' && name !== null && !Array.isArray(name) && name.kind === 'name' ? this.font(resources, name.name) : null;
          gs.size = num(1);
          break;
        }
        case 'Tc':
          gs.charSpacing = num(0);
          break;
        case 'Tw':
          gs.wordSpacing = num(0);
          break;
        case 'Tz':
          gs.scale = num(0, 100) / 100;
          break;
        case 'TL':
          gs.leading = num(0);
          break;
        case 'Td':
          nextLine(num(0), num(1));
          break;
        case 'TD':
          gs.leading = -num(1);
          nextLine(num(0), num(1));
          break;
        case 'Tm':
          tlm = [num(0, 1), num(1), num(2), num(3, 1), num(4), num(5)];
          tm = [...tlm];
          break;
        case 'T*':
          nextLine(0, -gs.leading);
          break;
        case 'Tj':
        case "'":
        case '"': {
          if (value.op === '"') {
            gs.wordSpacing = num(0);
            gs.charSpacing = num(1);
          }
          if (value.op !== 'Tj') nextLine(0, -gs.leading);
          const str = operands.at(-1);
          if (typeof str === 'object' && str !== null && !Array.isArray(str) && str.kind === 'string') show(str.bytes);
          break;
        }
        case 'TJ': {
          const items = operands[0];
          if (!Array.isArray(items)) break;
          for (const item of items) {
            if (typeof item === 'number') tm = multiply([1, 0, 0, 1, (-item / 1000) * gs.size * gs.scale, 0], tm);
            else if (typeof item === 'object' && item !== null && !Array.isArray(item) && item.kind === 'string') show(item.bytes);
          }
          break;
        }
        case 'Do': {
          const name = operands[0];
          const xobjects = doc.mapOf(resources.XObject);
          const form = typeof name === 'object' && name !== null && !Array.isArray(name) && name.kind === 'name' && xobjects !== null ? doc.stream(xobjects[name.name]) : null;
          if (form !== null && doc.nameOf(form.map.Subtype) === 'Form' && depth < 8) {
            const matrix = doc.array(form.map.Matrix).map((v) => doc.number(v, 0));
            const ctm = matrix.length === 6 ? multiply(matrix as Matrix, gs.ctm) : gs.ctm;
            this.run(doc.decode(form), doc.mapOf(form.map.Resources) ?? resources, { ...gs, ctm }, page, depth + 1);
          }
          break;
        }
        case 'BMC':
          spans.push({ actual: null, start: page.out.length });
          break;
        case 'BDC': {
          const props = operands[1];
          const named = typeof props === 'object' && props !== null && !Array.isArray(props) && props.kind === 'name' ? doc.mapOf(doc.mapOf(resources.Properties)?.[props.name]) : null;
          const map = named ?? (typeof props === 'object' && props !== null && !Array.isArray(props) && props.kind === 'dict' ? props.map : null);
          const actual = map === null ? undefined : doc.resolve(map.ActualText);
          spans.push({ actual: typeof actual === 'object' && actual !== null && !Array.isArray(actual) && actual.kind === 'string' ? textString(actual.bytes) : null, start: page.out.length });
          break;
        }
        case 'EMC': {
          const span = spans.pop();
          if (span !== undefined && span.actual !== null) {
            // /ActualText : le texte du fragment remplace celui des glyphes (Chromium s'en sert pour un glyphe sans Unicode propre).
            const lead = page.out.slice(span.start).match(/^\s*/)?.[0] ?? '';
            page.out = page.out.slice(0, span.start) + lead + span.actual;
          }
          break;
        }
        case 'BI': {
          // Image en ligne : sauter ses octets jusqu'à « EI ».
          const id = content.indexOf('ID', lex.pos);
          const end = id < 0 ? -1 : content.slice(id + 2).search(/\sEI(?:\s|$)/);
          lex.pos = id < 0 || end < 0 ? content.length : id + 2 + end + 3;
          break;
        }
      }
      operands = [];
    }
  }
}

// ── 5. Lire un PDF ──────────────────────────────────────────────────────────────────

export interface PdfReading {
  /** Problèmes de structure (en-tête, %%EOF, startxref, catalogue, chiffrement, aucune page). */
  structure: string[];
  /** Le texte de chaque page, dans l'ordre de l'arbre des pages. */
  pages: string[];
  /** Les polices dont un texte a été affiché. */
  fonts: PdfFont[];
  /** Flux de contenu illisibles (filtre inconnu, flux abîmé). */
  errors: string[];
}

/** Lit un PDF : structure, pages, texte de chaque page, polices utilisées. Ne lève jamais. */
export function readPdf(bytes: Uint8Array): PdfReading {
  const doc = new PdfDocument(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'));
  const interpreter = new Interpreter(doc);
  const pages: string[] = [];
  const errors: string[] = [];
  doc.pages.forEach((page, i) => {
    try {
      pages.push(interpreter.pageText(page));
    } catch (error) {
      pages.push('');
      errors.push(`page ${i + 1} : flux de contenu illisible (${error instanceof Error ? error.message : String(error)})`);
    }
  });
  // Une police par nom et sous-type : Chromium découpe une police Type3 en plusieurs objets.
  const fonts = new Map<string, PdfFont>();
  for (const { report } of interpreter.used) {
    const key = `${report.name}|${report.subtype}`;
    const seen = fonts.get(key);
    if (seen === undefined) fonts.set(key, { ...report });
    else fonts.set(key, { ...seen, embedded: seen.embedded && report.embedded, unmapped: seen.unmapped + report.unmapped });
  }
  return { structure: [...doc.structure], pages, fonts: [...fonts.values()], errors };
}

// ── 6. Les règles ───────────────────────────────────────────────────────────────────

/**
 * Le texte replié pour comparer (pas pour afficher) : NFKC (ligatures, espaces insécables),
 * apostrophes et guillemets typographiques, tirets, espaces. Repris de `normalize_text()` de
 * verify_pdf.py.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PageLimits {
  min: number;
  max: number;
}

export function pageCountProblems(count: number, limits: PageLimits): string[] {
  if (count === 0) return [];
  if (limits.min === limits.max && count !== limits.min) return [`${count} pages, il en faut exactement ${limits.min}`];
  if (count > limits.max) return [`${count} pages, ${limits.max} au plus`];
  if (count < limits.min) return [`${count} page(s), au moins ${limits.min}`];
  return [];
}

/** La couche texte existe : au moins `minChars` caractères visibles sur l'ensemble des pages. */
export function textLayerProblems(pages: string[], minChars: number): string[] {
  const chars = pages.join('').replace(/\s/g, '').length;
  if (pages.length === 0 || chars >= minChars) return [];
  return [`couche texte vide ou presque : ${chars} caractère(s) extrait(s), au moins ${minChars} attendus (PDF image ? un ATS n'y lira rien)`];
}

/** Aucune page sans texte : une page blanche ou image seule trahit un débordement ou un rendu raté. */
export function blankPageProblems(pages: string[]): string[] {
  const blank = pages.flatMap((text, i) => (text.replace(/\s/g, '') === '' ? [i + 1] : []));
  if (blank.length === 0) return [];
  return [`${blank.length > 1 ? 'pages' : 'page'} ${blank.join(', ')} sans texte (page blanche ou image seule)`];
}

export interface Contact {
  email: string;
  phone: string;
}

/** Les chiffres significatifs d'un téléphone : les 9 derniers, préfixe national ou international ôté. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\(0\)/g, '').replace(/\D/g, '');
  return digits.length < 6 ? '' : digits.slice(-9);
}

/** E-mail et téléphone du profil maître (Markdown). Un téléphone libellé (« Tél », « Téléphone », « Phone »…) d'abord, sinon un numéro français. */
export function readProfileContact(profile: string): Contact {
  const email = profile.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? '';
  const labeled = profile.match(/\b(?:t[ée]l[ée]phone|t[ée]l\b\.?|phone|mobile|portable|gsm)[^\S\n]*[*_]*[^\S\n]*[:：]?[^\S\n]*[*_]*[^\S\n]*(\+?\(?\d[\d \t.()\-/\u00A0]{6,}\d)/iu)?.[1];
  const french = profile.match(/(?<![\d+])(?:\+\d{2,3}[^\S\n]?(?:\(0\)[^\S\n]?)?[1-9]|0[1-9])(?:[ .\-]?\d{2}){4}(?!\d)/)?.[0];
  const phone = [labeled, french].find((candidate) => candidate !== undefined && /^\d{8,15}$/.test(candidate.replace(/\(0\)/g, '').replace(/\D/g, ''))) ?? '';
  return { email, phone: phone.trim() };
}

/** L'e-mail et le téléphone du candidat, quand on les connaît, figurent dans le texte du PDF. */
export function contactProblems(text: string, contact: Contact): string[] {
  const problems: string[] = [];
  const compact = foldText(text).replace(/\s/g, '').toLowerCase();
  const email = contact.email.trim().toLowerCase();
  if (email !== '' && !compact.includes(email)) problems.push(`l'e-mail du profil (${contact.email.trim()}) manque dans le texte du PDF`);
  const key = phoneKey(contact.phone);
  if (key !== '' && !foldText(text).replace(/[\s.()\-/+]/g, '').includes(key)) problems.push(`le téléphone du profil (${contact.phone.trim()}) manque dans le texte du PDF`);
  return problems;
}

/** Les restes de gabarit qu'aucun envoi ne doit porter. */
export const DEFAULT_PLACEHOLDERS: RegExp[] = [/\{\{[^{}]{0,80}\}\}/gu, /\bTODO\b/gu, /lorem\s+ipsum/giu, /\[\s*[àa]\s+compl[ée]ter\s*\]/giu];

export function placeholderProblems(text: string, patterns: RegExp[] = DEFAULT_PLACEHOLDERS): string[] {
  const folded = foldText(text);
  const found = [...new Set(patterns.flatMap((pattern) => [...folded.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].map((m) => m[0])))];
  if (found.length === 0) return [];
  return [`reste de gabarit dans le texte : ${found.slice(0, 6).map((f) => `« ${f} »`).join(', ')}`];
}

/**
 * Glyphes illisibles : codes sans Unicode (U+FFFD), zone privée (icônes, polices mal encodées),
 * caractères de contrôle, et le texte UTF-8 lu comme du latin1 (« Ã© », « â€™ »).
 */
export function garbledProblems(text: string, fonts: PdfFont[] = []): string[] {
  const problems: string[] = [];
  const replacement = (text.match(/\uFFFD/g) ?? []).length;
  if (replacement > 0) {
    const culprits = fonts.filter((font) => font.unmapped > 0).map((font) => font.name);
    problems.push(`${replacement} glyphe(s) sans correspondance Unicode${culprits.length > 0 ? ` (police ${culprits.join(', ')})` : ''} : copié ou lu par un ATS, ce texte est illisible`);
  }
  const privateUse = (text.match(/[\uE000-\uF8FF]/g) ?? []).length;
  if (privateUse > 0) problems.push(`${privateUse} caractère(s) de la zone privée Unicode (icônes ou glyphes mal encodés)`);
  const controls = (text.match(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g) ?? []).length;
  if (controls > 0) problems.push(`${controls} caractère(s) de contrôle dans le texte (glyphes mal décodés)`);
  const mojibake = [...new Set(text.match(/Ã[\u00A0-\u00BF]|â€./g) ?? [])];
  if (mojibake.length > 0) problems.push(`texte mal encodé (UTF-8 lu comme du latin1) : ${mojibake.slice(0, 4).map((m) => `« ${m} »`).join(', ')} — le HTML déclare-t-il <meta charset="utf-8"> ?`);
  return problems;
}

/**
 * Le texte visible d'un HTML, la source de `figureProblems` : sans `<head>` (le titre ne
 * s'imprime pas), commentaires, scripts ni styles ; entités décodées (`&#160;` n'est pas un
 * chiffre du document).
 */
export function htmlText(html: string): string {
  const char = (code: number): string => (Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ');
  return html
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => char(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => char(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chaque nombre de la source (deux chiffres ou plus : dates, chiffres clés) se relit dans le texte du PDF. */
export function figureProblems(text: string, source: string): string[] {
  if (source.trim() === '') return [];
  const joinDigits = (value: string): string => foldText(value).replace(/(?<=\d)[\s.,]+(?=\d)/g, '');
  const have = joinDigits(text);
  const wanted = [...new Set(joinDigits(source).match(/\d{2,}/g) ?? [])];
  const missing = wanted.filter((figure) => !have.includes(figure));
  if (missing.length === 0) return [];
  return [`chiffres de la source absents du texte du PDF (glyphes illisibles ?) : ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`];
}

/** Chaque police utilisée est embarquée : sinon le lecteur voit une police de substitution, et ses chiffres peuvent changer. */
export function fontProblems(fonts: PdfFont[]): string[] {
  const missing = fonts.filter((font) => !font.embedded).map((font) => `${font.name} (${font.subtype})`);
  if (missing.length === 0) return [];
  return [`police(s) non embarquée(s) : ${[...new Set(missing)].join(', ')} — le PDF s'affichera autrement chez le lecteur`];
}

// ── 7. Le contrôle complet ──────────────────────────────────────────────────────────

export type PdfKind = 'cv' | 'letter';

/** CV : deux pages au plus (configurable) ; lettre de motivation : une page exactement. */
export const PAGE_LIMITS: Record<PdfKind, PageLimits> = { cv: { min: 1, max: 2 }, letter: { min: 1, max: 1 } };

/** En deçà, la couche texte n'est pas celle d'un CV ni d'une lettre. */
export const MIN_TEXT_CHARS = 200;

export interface PdfRules {
  /** Le nom du fichier, en tête de chaque problème (« CV.pdf : … »). */
  label: string;
  pages: PageLimits;
  minChars: number;
  /** E-mail et téléphone attendus ; vides, la règle est sautée. */
  contact: Contact;
  placeholders: RegExp[];
  /** Le texte visible de la source (le HTML imprimé) : ses nombres doivent se relire ; vide, la règle est sautée. */
  source: string;
}

export function pdfRules(kind: PdfKind, overrides: Partial<PdfRules> = {}): PdfRules {
  return {
    label: kind === 'cv' ? 'CV.pdf' : 'letter.pdf',
    pages: PAGE_LIMITS[kind],
    minChars: MIN_TEXT_CHARS,
    contact: { email: '', phone: '' },
    placeholders: DEFAULT_PLACEHOLDERS,
    source: '',
    ...overrides,
  };
}

export interface PdfVerdict {
  ok: boolean;
  pages: number;
  /** Caractères visibles extraits (hors blancs). */
  chars: number;
  /** Le texte extrait, page par page séparées par un saut de page. */
  text: string;
  fonts: PdfFont[];
  /** Chaque problème, préfixé par `rules.label`. */
  problems: string[];
}

/** Toutes les règles sur un PDF. Les règles qui lisent le texte ne tournent que s'il y a un texte. */
export function verifyPdf(bytes: Uint8Array, rules: PdfRules): PdfVerdict {
  const reading = readPdf(bytes);
  const text = reading.pages.join('\n\f');
  const chars = text.replace(/\s/g, '').length;
  const problems = [...reading.structure, ...reading.errors];
  if (reading.pages.length > 0) {
    problems.push(...pageCountProblems(reading.pages.length, rules.pages));
    problems.push(...textLayerProblems(reading.pages, rules.minChars));
    problems.push(...blankPageProblems(reading.pages));
    if (chars > 0) {
      problems.push(...contactProblems(text, rules.contact));
      problems.push(...placeholderProblems(text, rules.placeholders));
      problems.push(...garbledProblems(text, reading.fonts));
      problems.push(...figureProblems(text, rules.source));
    }
    problems.push(...fontProblems(reading.fonts));
  }
  return {
    ok: problems.length === 0,
    pages: reading.pages.length,
    chars,
    text,
    fonts: reading.fonts,
    problems: problems.map((problem) => `${rules.label} : ${problem}`),
  };
}
