import { describe, expect, test } from 'bun:test';
import { checkDesign, countOptions, countSteps } from './check.ts';

const filler = 'x'.repeat(700);
const good = `# D\n\n## Objectif\n\n${filler}\n\n## Options\n\n### Option 1 : A\n\na\n\n### Option 2 : B\n\nb\n\n## Décision\n\nA\n\n## Plan\n\n1. un\n2. deux\n3. trois\n\n## Risques\n\nr`;

describe('design check', () => {
  test('compte les options et les étapes', () => {
    expect(countOptions(good)).toBe(2);
    expect(countSteps(good)).toBe(3);
  });

  test('refuse une seule option', () => {
    const result = checkDesign(good.replace('### Option 2 : B\n\nb\n', ''));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('only 1 "### Option');
  });

  test('refuse un plan trop court', () => {
    const result = checkDesign(good.replace('3. trois\n', ''));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('only 2 numbered step(s)');
  });

  test('accepte un design complet', () => {
    expect(checkDesign(good)).toEqual({ ok: true, problems: [] });
  });
});
