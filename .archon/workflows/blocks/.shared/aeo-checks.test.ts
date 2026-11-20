import { describe, expect, test } from 'bun:test';
import { DEFAULT_ASSET_RULES, checkAsset, extractJsonLd, headingProblems, validateJsonLd } from './aeo-checks.ts';

const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [1, 2, 3].map((i) => ({ '@type': 'Question', name: `Q${i} ?`, acceptedAnswer: { '@type': 'Answer', text: `R${i}` } })) };
const article = { '@context': 'https://schema.org', '@type': 'Article', headline: 'Plan de taggage GTM', author: { '@type': 'Person', name: 'A' }, datePublished: '2026-10-18' };
const para = 'Le plan de taggage GTM décrit chaque événement du tunnel avant la mise en ligne. '.repeat(8);
const asset = `# Plan de taggage GTM : la méthode en 5 étapes\n\n${para}\n\n## Pourquoi un plan avant la page\n\n${para}\n\n### Les événements\n\n${para}\n\n## Questions fréquentes\n\n${para}\n\n\`\`\`json\n${JSON.stringify([article, faq])}\n\`\`\`\n`;

describe('aeo checks', () => {
  test('extrait et valide le JSON-LD', () => {
    const blocks = extractJsonLd(asset);
    expect(blocks).toHaveLength(1);
    expect(validateJsonLd(blocks[0].parsed)).toEqual([]);
    expect(validateJsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] })).toContain('FAQPage must carry at least 3 questions in mainEntity (got 0)');
    expect(validateJsonLd({ '@context': 'https://example.org', '@type': 'Recipe' })[1]).toContain('not in the supported list');
    expect(validateJsonLd({ '@context': 'https://schema.org', '@type': 'Article' })).toContain('JSON-LD Article is missing "headline"');
  });
  test('hiérarchie des titres', () => {
    expect(headingProblems('# A\n\n## B\n\n## C\n')).toEqual([]);
    expect(headingProblems('# A\n\n#### D\n\n## B\n# E')).toEqual(['exactly one H1 expected (got 2)', 'at least two H2 sections expected', 'heading level jumps from H1 to H4']);
  });
  test('accepte un actif complet avec intention restituée', () => {
    expect(checkAsset(asset, { ...DEFAULT_ASSET_RULES, intent: 'plan de taggage GTM' })).toEqual({ ok: true, problems: [], types: ['Article', 'FAQPage'] });
  });
  test('refuse sans FAQ, avec JSON cassé ou intention absente', () => {
    const noFaq = asset.replace(JSON.stringify([article, faq]), JSON.stringify(article));
    expect(checkAsset(noFaq, DEFAULT_ASSET_RULES).problems).toContain('an FAQPage JSON-LD block is required (AEO: answer engines cite Q/A)');
    const broken = asset.replace('```json\n', '```json\n{oops ');
    expect(checkAsset(broken, DEFAULT_ASSET_RULES).problems.some((p) => p.startsWith('JSON-LD does not parse'))).toBe(true);
    expect(checkAsset(asset, { ...DEFAULT_ASSET_RULES, intent: 'recette de cuisine végétarienne' }).problems.some((p) => p.includes('does not restate the search intent'))).toBe(true);
  });
});
