import { describe, expect, test } from 'bun:test';
import { checkReport, countSourceRefs } from './check.ts';

const filler = 'x'.repeat(500);
const good = `# R\n\n## Synthèse\n\n${filler}\n\n## Résultats\n\nr (research, Constats 1)\n\n## Recommandations\n\n- faire A, parce que\n\n## Prochaines étapes\n\n1. un\n\n## Sources\n\n- recherche — artifacts/research.md`;

describe('report check', () => {
  test('refuse un rapport sans recommandation', () => {
    const result = checkReport(good.replace('- faire A, parce que\n', ''));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['no bulleted recommendation under "## Recommandations"']);
  });

  test('refuse un rapport sans prochaine étape', () => {
    const result = checkReport(good.replace('1. un', 'un'));
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['no numbered step under "## Prochaines étapes"']);
  });

  test('refuse un rapport de plus de 6 000 caractères', () => {
    const result = checkReport(good.replace(filler, 'x'.repeat(6000)));
    expect(result.problems).toEqual([expect.stringContaining('too long')]);
  });

  test('exige un titre et une section Sources', () => {
    expect(checkReport(good.replace('# R\n', 'R\n')).problems).toEqual(['no "# <title>" line']);
    expect(checkReport(good.split('\n\n## Sources')[0]).problems).toEqual(['missing section: "Sources"']);
  });

  test('une source doit pointer vers une URL ou un chemin', () => {
    expect(countSourceRefs('- https://exemple.org/page\n- voir research.md\n- docs/plan\n- une conversation')).toBe(3);
    const result = checkReport(good.replace('- recherche — artifacts/research.md', '- ce que je sais'));
    expect(result.problems).toEqual(['no source under "## Sources" pointing at a URL or a file path']);
  });

  test('accepte un rapport complet', () => {
    expect(checkReport(good)).toEqual({ ok: true, problems: [] });
  });
});
