#!/usr/bin/env bun
/**
 * Contrôles génériques pour prototyper la boucle d'un bloc avant d'écrire ses règles
 * métier (MECHANICS.md § 1, « boucle naïve ») — porté de `toolbox/check.js` du harness v0.
 *
 *   bun scripts/check.ts <contrôle> <fichier> [argument]
 *   contrôles : exists | min-chars N | max-chars N | min-links N | has-sections "A,B" |
 *               has-text "…" | no-text "…" | json | json-keys "a,b"
 *
 * Code de sortie 0 = passe, 1 = échoue (motif sur stderr), 2 = usage (argument manquant ou
 * illisible compris : un contrôle mal appelé ne passe jamais). S'enchaîne avec `&&`
 * dans un `until_bash`. Une fois le métier connu, les règles migrent dans
 * `.archon/workflows/blocks/.shared/<nom>-checks.ts` avec leurs tests.
 */

import { existsSync, readFileSync } from 'node:fs';

export const CHECKS = ['exists', 'min-chars', 'max-chars', 'min-links', 'has-sections', 'has-text', 'no-text', 'json', 'json-keys'] as const;
export type CheckName = (typeof CHECKS)[number];

const list = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const NUMERIC = new Set(['min-chars', 'max-chars', 'min-links']);
const NEEDS_TEXT = new Set(['has-sections', 'has-text', 'no-text', 'json-keys']);

/**
 * L'argument manque ou est illisible ? Sans ce garde-fou, `min-chars <fichier>` (N oublié)
 * compare à NaN et passe toujours : un `until_bash` mal écrit finirait la boucle sur n'importe quoi.
 */
export function argumentProblem(name: string, arg?: string): string | null {
  if (NUMERIC.has(name) && !(arg !== undefined && arg.trim() !== '' && Number.isFinite(Number(arg)) && Number(arg) >= 0)) {
    return `${name} attend un nombre (lu : ${arg === undefined ? 'rien' : `« ${arg} »`})`;
  }
  if (NEEDS_TEXT.has(name) && (name === 'has-text' || name === 'no-text' ? (arg ?? '') === '' : list(arg).length === 0)) {
    return `${name} attend un argument non vide`;
  }
  return null;
}

/** Applique un contrôle à un contenu ; `null` = passe, sinon le motif d'échec. */
export function runCheck(name: string, content: string | null, arg?: string): string | null {
  const bad = argumentProblem(name, arg);
  if (bad !== null) return bad;
  if (content === null) return 'fichier absent';
  switch (name as CheckName) {
    case 'exists':
      return null;
    case 'min-chars': {
      const n = content.trim().length;
      return n < Number(arg) ? `${n} < ${arg} caractères` : null;
    }
    case 'max-chars': {
      const n = content.length;
      return n > Number(arg) ? `${n} > ${arg} caractères` : null;
    }
    case 'min-links': {
      const n = new Set(content.match(/https?:\/\/[^\s)>\]]+/g) ?? []).size;
      return n < Number(arg) ? `${n} lien(s) distinct(s), ${arg} attendus` : null;
    }
    case 'has-sections': {
      const headings = (content.match(/^#{1,6}\s+(.+)$/gm) ?? []).map((h) => h.replace(/^#+\s+/, '').trim());
      const missing = list(arg).filter((s) => !headings.includes(s));
      return missing.length ? `sections manquantes : ${missing.join(', ')}` : null;
    }
    case 'has-text':
      return content.toLowerCase().includes(String(arg).toLowerCase()) ? null : `« ${arg} » absent`;
    case 'no-text':
      return content.includes(String(arg)) ? `« ${arg} » présent` : null;
    case 'json':
    case 'json-keys': {
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch (error) {
        return `JSON invalide (${(error as Error).message})`;
      }
      if (name === 'json') return null;
      const missing = list(arg).filter((k) => typeof data !== 'object' || data === null || !(k in (data as object)));
      return missing.length ? `clés manquantes : ${missing.join(', ')}` : null;
    }
    default:
      return `contrôle inconnu : ${name}`;
  }
}

if (import.meta.main) {
  const [name, file, arg] = process.argv.slice(2);
  const bad = name ? argumentProblem(name, arg) : null;
  if (!name || !file || !(CHECKS as readonly string[]).includes(name) || bad !== null) {
    if (bad !== null) console.error(bad);
    console.error(`usage: bun scripts/check.ts <${CHECKS.join('|')}> <fichier> [argument]`);
    process.exitCode = 2;
  } else {
    const content = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const problem = runCheck(name, content, arg);
    if (problem !== null) {
      console.error(`ÉCHEC ${name} ${file} : ${problem}`);
      process.exitCode = 1;
    }
  }
}
