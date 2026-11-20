/**
 * Contrôles déterministes réutilisables sur un livrable Markdown.
 *
 * C'est la partie "le code vérifie" du bloc : pas de jugement, seulement des faits
 * qu'un script peut établir (le fichier existe, il a les sections attendues, il ne
 * contient pas de marqueur de brouillon). Ce que le code ne peut pas trancher va au juge.
 */

export interface CheckRules {
  /** Titres de sections (sans le `#`) qui doivent apparaître, dans n'importe quel ordre. */
  requiredSections: string[];
  /** Longueur minimale du corps, en caractères. */
  minChars: number;
  /** Longueur maximale du corps, en caractères (aucune si absente). */
  maxChars?: number;
  /**
   * Marqueurs de brouillon interdits, insensibles à la casse. Un marqueur fait de lettres
   * (TODO, TBD, lorem ipsum) se cherche en mot entier : « Mastodon » ou « Todoist » ne sont
   * pas des brouillons ; un marqueur avec ponctuation (`<placeholder>`) se cherche tel quel.
   */
  forbiddenMarkers: string[];
}

/** Le marqueur apparaît-il dans le texte (en mot entier s'il n'est fait que de lettres) ? */
export function hasMarker(text: string, marker: string): boolean {
  if (!/^[\p{L}\p{N} ]+$/u.test(marker)) return text.toLowerCase().includes(marker.toLowerCase());
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
}

export const DEFAULT_RULES: CheckRules = {
  requiredSections: [],
  minChars: 200,
  forbiddenMarkers: ['TODO', 'TBD', 'lorem ipsum', '<placeholder>'],
};

/** Évalue un livrable. Pure : pas d'accès disque, testable à l'unité. */
export function evaluateDeliverable(content: string | null, rules: CheckRules): CheckResult {
  const problems: string[] = [];
  if (content === null) {
    return { ok: false, problems: ['deliverable.md is missing in $ARTIFACTS_DIR'] };
  }
  const body = content.trim();
  if (body.length === 0) {
    return { ok: false, problems: ['deliverable.md is empty'] };
  }
  if (body.length < rules.minChars) {
    problems.push(`deliverable.md is too short: ${body.length} chars, at least ${rules.minChars} expected`);
  }
  if (rules.maxChars !== undefined && body.length > rules.maxChars) {
    problems.push(`deliverable.md is too long: ${body.length} chars, at most ${rules.maxChars}`);
  }
  const headings = new Set(
    body
      .split('\n')
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, '').trim().toLowerCase())
  );
  for (const section of rules.requiredSections) {
    if (!headings.has(section.toLowerCase())) {
      problems.push(`missing section: "${section}"`);
    }
  }
  for (const marker of rules.forbiddenMarkers) {
    if (hasMarker(body, marker)) {
      problems.push(`draft marker found: "${marker}"`);
    }
  }
  return { ok: problems.length === 0, problems };
}
