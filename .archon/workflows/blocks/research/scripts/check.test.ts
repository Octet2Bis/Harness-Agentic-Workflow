import { describe, expect, test } from 'bun:test';
import { checkResearch, citationProblems, countSources } from './check.ts';

const filler = 'x'.repeat(800);
const good = `# Q\n\n## Résumé\n\n${filler}\n\n## Constats\n\n1. a [S1]\n2. b [S2] [S3]\n\n## Sources\n\n- [S1] doc — a.md\n- [S2] doc — b.md\n- [S3] page — https://x\n\n## Limites\n\nnone`;

describe('research check', () => {
  test('compte les sources sous ## Sources seulement', () => {
    expect(countSources(good)).toBe(3);
    expect(countSources('# Q\n\n- [S1] hors section')).toBe(0);
  });

  test('refuse un rapport avec moins de trois sources', () => {
    const result = checkResearch(good.replace('- [S3] page — https://x\n', '').replace(' [S3]', ''));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining('only 2 distinct source(s)')]);
  });

  test('une source répétée (même identifiant ou même emplacement) ne compte qu\'une fois', () => {
    expect(countSources(good.replace('- [S3] page — https://x', '- [S3] même doc — A.md'))).toBe(2);
    expect(countSources(good.replace('- [S3] page — https://x', '- [S2] page — https://x'))).toBe(2);
  });

  test('accepte un rapport complet', () => {
    expect(checkResearch(good)).toEqual({ ok: true, problems: [] });
  });

  test('refuse un rapport sous 800 caractères', () => {
    const result = checkResearch(good.replace(filler, 'x'.repeat(500)));
    expect(result.problems).toEqual([expect.stringContaining('too short')]);
  });

  test('exige un titre # qui reformule la question', () => {
    const result = checkResearch(good.replace('# Q\n', 'Q\n'));
    expect(result.problems).toEqual(['no "# <title>" line restating the question']);
  });

  test('chaque constat cite une source listée', () => {
    expect(citationProblems(good.replace('1. a [S1]', '1. a'))).toEqual(['finding 1 cites no source [S<n>]']);
    expect(citationProblems(good.replace('1. a [S1]', '1. a [S9]'))).toEqual([
      'finding 1 cites [S9], which is not listed under "## Sources"',
    ]);
    expect(citationProblems(good.replace('1. a [S1]\n2. b [S2] [S3]', 'des constats en prose'))).toEqual([
      '"## Constats" lists no finding (numbered or bulleted)',
    ]);
  });

  test('nomme les sections manquantes et les marqueurs', () => {
    const result = checkResearch(`# Q\n\n## Résumé\n\nTODO ${filler}`);
    expect(result.ok).toBe(false);
    expect(result.problems).toContain('missing section: "Sources"');
    expect(result.problems).toContain('draft marker found: "TODO"');
  });
});
