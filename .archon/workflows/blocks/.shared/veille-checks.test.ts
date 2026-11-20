import { describe, expect, test } from 'bun:test';
import { DEFAULT_CATEGORIES, checkFiche, parseSources, readMeta } from './veille-checks.ts';

const today = new Date('2026-10-18T12:00:00Z');
const source = 'https://www.instagram.com/reel/DehIT3lNgHC/';
const body = 'x '.repeat(120);
const fiche = `# Fiche de veille — Agentic engineering (reel de @kem_glitch)

- **Date :** 2026-10-18
- **Source :** ${source}
- **Catégorie :** IA & Systèmes Multi-Agents

## De quoi s'agit-il
Le reel décrit des blocs vérifiés : agent, contrôles code, juge en contexte vierge. ${body}

## Problème
Nos workflows reposent sur la relecture humaine de bout en bout. ${body}

## Impact
Temps de vérification et erreurs silencieuses. ${body}

## Recommandation immédiate
Appliquer le gabarit de bloc au pôle 04 de 02_Assistant_Personnel (career_ops) d'abord.

## Sources
- [S1] Transcription du reel — ${source} (2026-10-16)
- [S2] Archon, workflow-language-constitution — https://github.com/coleam00/Archon (2026-10-16)

## Limites
Audio transcrit automatiquement ; deux passages inaudibles.`;

describe('veille checks', () => {
  test('lit les métadonnées et les sources', () => {
    expect(readMeta(fiche)).toEqual({ date: '2026-10-18', source, category: 'IA & Systèmes Multi-Agents' });
    expect(parseSources(fiche)).toHaveLength(2);
    expect(parseSources(fiche)[1]).toMatchObject({ url: 'https://github.com/coleam00/Archon', date: '2026-10-16' });
  });
  test('accepte une fiche complète', () => {
    expect(checkFiche(fiche, { source, categories: DEFAULT_CATEGORIES, today, minChars: 600 })).toEqual({ ok: true, problems: [], category: 'IA & Systèmes Multi-Agents' });
  });
  test('refuse la fiche gabarit, la date future, la catégorie inconnue, la source perdue, la reco sans pilier', () => {
    const bad = fiche
      .replace('2026-10-18', '2027-01-01')
      .replace('IA & Systèmes Multi-Agents', 'Divers')
      .replace(`- **Source :** ${source}`, '- **Source :** autre')
      .replace("Appliquer le gabarit de bloc au pôle 04 de 02_Assistant_Personnel (career_ops) d'abord.", 'Consulter la ressource pour extraction de code ou de pattern.')
      .replace(' (2026-10-16)\n- [S2]', '\n- [S2]');
    const result = checkFiche(bad, { source, categories: DEFAULT_CATEGORIES, today, minChars: 600 });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('missing or invalid "- **Date :** YYYY-MM-DD" (got "2027-01-01")');
    expect(result.problems).toContain(`the Source line does not carry the input source (${source})`);
    expect(result.problems.some((p) => p.startsWith('category "Divers"'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('template phrase found'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('source without a valid date'))).toBe(true);
    expect(result.problems.some((p) => p.startsWith('"Recommandation immédiate" must name'))).toBe(true);
  });
  test('une fiche absente est un problème unique', () => {
    expect(checkFiche(null, { source, categories: DEFAULT_CATEGORIES, today, minChars: 600 }).problems).toEqual(['deliverable.md is missing in $ARTIFACTS_DIR']);
  });
});
