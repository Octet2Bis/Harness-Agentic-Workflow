/**
 * Règles pures du bloc `review` : la forme du verdict de relecture (`review.json`) et sa
 * cohérence avec le diff relu. Le verdict est lu par du code, pas par un humain.
 */

export type Severity = 'blocking' | 'minor';
export type CodeVerdict = 'pass' | 'fail';

export interface Finding {
  file: string;
  line?: number;
  severity: Severity;
  text: string;
}

export interface Review {
  verdict: CodeVerdict;
  summary: string;
  findings: Finding[];
}

export interface ReviewCheck {
  ok: boolean;
  problems: string[];
  code_verdict: CodeVerdict | 'unknown';
  blocking: number;
}

export const MIN_TEXT = 20;

const ESCAPES: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };

/** Un chemin tel que git l'écrit : nu, ou entre guillemets avec échappements C et octets en octal (`"caf\303\251.ts"`). */
export function unquotePath(path: string): string {
  if (!path.startsWith('"')) return path;
  const body = path.endsWith('"') && path.length > 1 ? path.slice(1, -1) : path.slice(1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1))![0];
      bytes.push(parseInt(octal, 8));
      i += octal.length;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** `a/x` ou `"b/x"` (éventuellement suivi d'une tabulation, comme git l'écrit pour un chemin à espaces) → `x`. */
function sidePath(raw: string, prefix: 'a/' | 'b/'): string | null {
  const path = unquotePath(raw.replace(/\t.*$/, ''));
  return path.startsWith(prefix) ? path.slice(2) : null;
}

/** La ligne `diff --git a/X b/X` d'un fichier sans `---`/`+++` (binaire, mode) : X, même avec des espaces. */
function headerPath(header: string): string | null {
  const quoted = /^(?:"(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*")$/.exec(header);
  if (quoted) return sidePath(quoted[1]!, 'b/');
  const half = (header.length - 5) / 2;
  if (Number.isInteger(half) && header.startsWith('a/') && header.slice(2, 2 + half) === header.slice(half + 5)) return header.slice(half + 5);
  const plain = / b\/(.+)$/.exec(header);
  return plain ? plain[1]! : null;
}

/**
 * Les fichiers touchés par un diff unifié de git : le côté `b/` (`+++`), le côté `a/` pour un
 * fichier supprimé, la cible d'un renommage ; chemins à espaces et chemins entre guillemets
 * (accents, `core.quotePath`) compris.
 */
export function diffFiles(diff: string): string[] {
  const files: string[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue;
    const lines = chunk.split('\n');
    let file: string | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) break;
      const plus = /^\+\+\+ (.+)$/.exec(line);
      const minus = /^--- (.+)$/.exec(line);
      const moved = /^(?:rename|copy) to (.+)$/.exec(line);
      if (plus && !plus[1]!.startsWith('/dev/null')) file = sidePath(plus[1]!, 'b/') ?? file;
      else if (minus && !minus[1]!.startsWith('/dev/null') && file === null) file = sidePath(minus[1]!, 'a/');
      else if (moved) file = unquotePath(moved[1]!);
    }
    file ??= headerPath(lines[0]!.slice('diff --git '.length).replace(/\r$/, ''));
    if (file !== null && !files.includes(file)) files.push(file);
  }
  return files;
}

export function parseReview(raw: string | null): { review: Review | null; problem: string | null } {
  if (raw === null) return { review: null, problem: 'review.json not found' };
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { review: null, problem: 'review.json is not an object' };
    return { review: value as Review, problem: null };
  } catch (error) {
    return { review: null, problem: `review.json is not valid JSON: ${(error as Error).message}` };
  }
}

export function checkReview(raw: string | null, diff: string | null): ReviewCheck {
  const problems: string[] = [];
  const files = diff === null ? [] : diffFiles(diff);
  if (diff === null || diff.trim() === '') problems.push('diff.patch missing or empty: write the diff since `git merge-base <base> HEAD`, working tree and untracked files included, to the artifacts before reviewing');

  const { review, problem } = parseReview(raw);
  if (problem) problems.push(problem);
  if (review === null) return { ok: false, problems, code_verdict: 'unknown', blocking: 0 };

  if (review.verdict !== 'pass' && review.verdict !== 'fail') problems.push(`verdict must be "pass" or "fail" (read: ${JSON.stringify(review.verdict)})`);
  if (typeof review.summary !== 'string' || review.summary.trim().length < MIN_TEXT) problems.push(`summary must be a sentence (≥ ${MIN_TEXT} chars)`);
  if (!Array.isArray(review.findings)) problems.push('findings must be an array (empty when the diff is clean)');

  const findings = Array.isArray(review.findings) ? review.findings : [];
  findings.forEach((f, i) => {
    const where = `finding ${i + 1}`;
    if (typeof f !== 'object' || f === null) return void problems.push(`${where}: not an object`);
    if (typeof f.file !== 'string' || f.file === '') problems.push(`${where}: file missing`);
    else if (files.length > 0 && !files.includes(f.file)) problems.push(`${where}: ${f.file} is not in the diff (${files.join(', ')})`);
    if (f.line !== undefined && (!Number.isInteger(f.line) || f.line < 1)) problems.push(`${where}: line must be a positive integer`);
    if (f.severity !== 'blocking' && f.severity !== 'minor') problems.push(`${where}: severity must be blocking or minor`);
    if (typeof f.text !== 'string' || f.text.trim().length < MIN_TEXT) problems.push(`${where}: text must say what is wrong and how to fix it (≥ ${MIN_TEXT} chars)`);
  });

  const blocking = findings.filter((f) => f && f.severity === 'blocking').length;
  if (review.verdict === 'fail' && blocking === 0) problems.push('verdict "fail" needs at least one blocking finding');
  if (review.verdict === 'pass' && blocking > 0) problems.push(`verdict "pass" with ${blocking} blocking finding(s): make it "fail" or downgrade them`);

  const code_verdict: ReviewCheck['code_verdict'] = review.verdict === 'pass' || review.verdict === 'fail' ? review.verdict : 'unknown';
  return { ok: problems.length === 0, problems, code_verdict, blocking };
}
