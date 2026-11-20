/**
 * Contrôles déterministes d'un actif de contenu AEO/SEO (pôle 02 Acquisition & AEO de
 * Master Plan) : un article ou une page en Markdown qui embarque son bloc JSON-LD
 * Schema.org. Reprend l'esprit de `schema_validator.py` (contexte, @type connu, champs
 * obligatoires par type) et ajoute la hiérarchie des titres, la FAQ, l'intention
 * restituée et l'absence de phrases creuses. Purs, testés.
 */

import { DEFAULT_SLOP, slopPhrases } from './cv-checks.ts';

export const REQUIRED_BY_TYPE: Record<string, string[]> = {
  FAQPage: ['mainEntity'],
  Article: ['headline', 'author', 'datePublished'],
  BlogPosting: ['headline', 'author', 'datePublished'],
  HowTo: ['name', 'step'],
  SoftwareApplication: ['name', 'applicationCategory', 'operatingSystem'],
  Organization: ['name', 'url'],
  Product: ['name', 'description'],
  WebPage: ['name'],
};

/** Les blocs JSON-LD d'un document : ```json … ``` contenant @context, ou <script type="application/ld+json">. */
export function extractJsonLd(markdown: string): { raw: string; parsed: unknown; error: string }[] {
  const blocks: string[] = [];
  for (const match of markdown.matchAll(/```(?:json|jsonld|json-ld)\s*\n([\s\S]*?)```/g)) blocks.push(match[1]);
  for (const match of markdown.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) blocks.push(match[1]);
  return blocks
    .filter((raw) => raw.includes('@context') || raw.includes('@type'))
    .map((raw) => {
      try {
        return { raw, parsed: JSON.parse(raw) as unknown, error: '' };
      } catch (error) {
        return { raw, parsed: null, error: (error as Error).message };
      }
    });
}

function typesOf(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  return Array.isArray(type) ? type.map(String) : typeof type === 'string' ? [type] : [];
}

export function validateJsonLd(parsed: unknown): string[] {
  const problems: string[] = [];
  const nodes: Record<string, unknown>[] = [];
  const push = (value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) nodes.push(value as Record<string, unknown>);
  };
  if (Array.isArray(parsed)) parsed.forEach(push);
  else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['@graph'])) ((parsed as Record<string, unknown>)['@graph'] as unknown[]).forEach(push);
  else push(parsed);
  if (nodes.length === 0) return ['JSON-LD is not an object, an array of objects or an @graph'];
  const context = String((parsed as Record<string, unknown>)?.['@context'] ?? nodes[0]['@context'] ?? '');
  if (!context.includes('schema.org')) problems.push('JSON-LD @context must be https://schema.org');
  for (const node of nodes) {
    const types = typesOf(node);
    if (types.length === 0) problems.push('a JSON-LD node has no @type');
    for (const type of types) {
      const required = REQUIRED_BY_TYPE[type];
      if (required === undefined) {
        problems.push(`JSON-LD @type "${type}" is not in the supported list (${Object.keys(REQUIRED_BY_TYPE).join(', ')})`);
        continue;
      }
      for (const key of required) if (node[key] === undefined || node[key] === '' || node[key] === null) problems.push(`JSON-LD ${type} is missing "${key}"`);
      if (type === 'FAQPage') {
        const entities = Array.isArray(node.mainEntity) ? (node.mainEntity as Record<string, unknown>[]) : [];
        if (entities.length < 3) problems.push(`FAQPage must carry at least 3 questions in mainEntity (got ${entities.length})`);
        for (const question of entities) {
          const answer = question.acceptedAnswer as Record<string, unknown> | undefined;
          if (question['@type'] !== 'Question' || typeof question.name !== 'string' || !answer || answer['@type'] !== 'Answer' || typeof answer.text !== 'string') {
            problems.push('each FAQPage mainEntity must be a Question with a name and an acceptedAnswer Answer with text');
            break;
          }
        }
      }
      if (type === 'HowTo' && !(Array.isArray(node.step) && node.step.length >= 2)) problems.push('HowTo needs at least 2 steps');
    }
  }
  return problems;
}

export function headingProblems(markdown: string): string[] {
  const problems: string[] = [];
  const levels = markdown
    .split('\n')
    .map((line) => line.match(/^(#{1,6})\s+\S/)?.[1].length ?? 0)
    .filter((level) => level > 0);
  const h1 = levels.filter((level) => level === 1).length;
  if (h1 !== 1) problems.push(`exactly one H1 expected (got ${h1})`);
  if (levels.filter((level) => level === 2).length < 2) problems.push('at least two H2 sections expected');
  let previous = 0;
  for (const level of levels) {
    if (level > previous + 1 && previous !== 0) problems.push(`heading level jumps from H${previous} to H${level}`);
    previous = level;
  }
  return [...new Set(problems)];
}

export interface AssetRules {
  intent: string;
  minChars: number;
  slop: string[];
  requireFaq: boolean;
}

export const DEFAULT_ASSET_RULES: AssetRules = { intent: '', minChars: 1500, slop: DEFAULT_SLOP, requireFaq: true };

export function checkAsset(content: string | null, rules: AssetRules): { ok: boolean; problems: string[]; types: string[] } {
  if (content === null || content.trim() === '') return { ok: false, problems: ['asset file is missing or empty'], types: [] };
  const problems: string[] = [];
  const body = content.replace(/```[\s\S]*?```/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  if (body.trim().length < rules.minChars) problems.push(`asset body is ${body.trim().length} chars, at least ${rules.minChars} expected (JSON-LD excluded)`);
  problems.push(...headingProblems(body));
  const blocks = extractJsonLd(content);
  const types: string[] = [];
  if (blocks.length === 0) problems.push('no JSON-LD block (```json with @context) found');
  for (const block of blocks) {
    if (block.error !== '') problems.push(`JSON-LD does not parse: ${block.error}`);
    else {
      problems.push(...validateJsonLd(block.parsed));
      const list = Array.isArray(block.parsed) ? block.parsed : [block.parsed];
      for (const node of list) if (node && typeof node === 'object') types.push(...typesOf(node as Record<string, unknown>));
    }
  }
  if (rules.requireFaq && !types.includes('FAQPage')) problems.push('an FAQPage JSON-LD block is required (AEO: answer engines cite Q/A)');
  if (rules.intent.trim() !== '') {
    const words = rules.intent.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const head = body.slice(0, 1200).toLowerCase();
    const hits = words.filter((word) => head.includes(word)).length;
    if (words.length > 0 && hits / words.length < 0.5) problems.push(`the opening (first 1,200 chars) does not restate the search intent "${rules.intent}"`);
  }
  for (const phrase of slopPhrases(body, rules.slop)) problems.push(`hollow phrase "${phrase}"`);
  for (const marker of ['TODO', 'TBD', 'lorem ipsum', '<placeholder>', '{{']) if (body.toLowerCase().includes(marker.toLowerCase())) problems.push(`draft marker found: "${marker}"`);
  return { ok: problems.length === 0, problems, types: [...new Set(types)] };
}
