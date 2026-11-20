import { describe, expect, test } from 'bun:test';
import { decodeEntities, parseKeywords, readOffer } from './check.ts';

describe('cv-tailor check helpers', () => {
  test('lit l’offre et décode les entités HTML des offres scrapées', () => {
    const offer = readOffer('{"company":"STATION F","title":"SALES OPERATIONS &amp; GTM ENGINEER","skills_required":"revenue operations coordinator"}');
    expect(offer.title).toBe('SALES OPERATIONS & GTM ENGINEER');
    expect(decodeEntities('l&#39;offre &quot;x&quot;')).toBe('l\'offre "x"');
    expect(readOffer('pas du json')).toEqual({});
  });
  test('les mots-clés explicites priment, sinon ceux de l’offre, sinon skills_required', () => {
    expect(parseKeywords('n8n, GTM;HubSpot\nn8n', {})).toEqual(['n8n', 'GTM', 'HubSpot']);
    expect(parseKeywords('', { keywords: 'SQL, Python', skills_required: 'x' })).toEqual(['SQL', 'Python']);
    expect(parseKeywords('', { skills_required: 'revenue operations' })).toEqual(['revenue operations']);
    expect(parseKeywords('', {})).toEqual([]);
  });
});
