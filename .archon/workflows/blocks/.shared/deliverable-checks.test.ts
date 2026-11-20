import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULES, evaluateDeliverable } from './deliverable-checks.ts';

const rules = { ...DEFAULT_RULES, requiredSections: ['Résumé', 'Sources'], minChars: 50 };

describe('evaluateDeliverable', () => {
  test('refuse un livrable absent', () => {
    const result = evaluateDeliverable(null, rules);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('missing');
  });

  test('refuse un livrable vide', () => {
    expect(evaluateDeliverable('   \n', rules).ok).toBe(false);
  });

  test('refuse un livrable trop court', () => {
    const result = evaluateDeliverable('# Résumé\n\n## Sources\n\ncourt', rules);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining('too short')]);
  });

  test('nomme chaque section manquante', () => {
    const result = evaluateDeliverable('# Résumé\n\n' + 'x'.repeat(60), rules);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['missing section: "Sources"']);
  });

  test('un mot qui contient un marqueur n\'est pas un brouillon', () => {
    const result = evaluateDeliverable('# Résumé\n\n## Sources\n\nSuivi sur Mastodon, Todoist et todos los días. ' + 'x'.repeat(60), rules);
    expect(result).toEqual({ ok: true, problems: [] });
  });

  test('refuse un livrable trop long quand une borne est fixée', () => {
    const result = evaluateDeliverable('# Résumé\n\n## Sources\n\n' + 'x'.repeat(120), { ...rules, maxChars: 100 });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringContaining('too long')]);
  });

  test('refuse les marqueurs de brouillon', () => {
    const result = evaluateDeliverable('# Résumé\n\n## Sources\n\nTODO ' + 'x'.repeat(60), rules);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['draft marker found: "TODO"']);
  });

  test('accepte un livrable complet', () => {
    const result = evaluateDeliverable('# Résumé\n\n' + 'x'.repeat(60) + '\n\n## Sources\n\n- a', rules);
    expect(result).toEqual({ ok: true, problems: [] });
  });
});
