/**
 * Contrôles déterministes d'une séquence de cold e-mails (pôle 04 Outbound de Master Plan),
 * dans l'esprit de `email_linter.py` et `ai_slop_linter.py` : nombre de touches, objet court,
 * corps ≤ N mots, pas de variable de gabarit non résolue, pas de mot déclencheur de spam, pas
 * de ponctuation agressive, une question (CTA) par touche, des angles distincts, un break-up
 * à la fin, pas de phrase creuse. Purs, testés. Le reste (valeur, ton pair-à-pair, cohérence
 * avec l'ICP et le signal) va au juge.
 */

import { DEFAULT_SLOP, countWords, slopPhrases } from './cv-checks.ts';

export interface Touch {
  index: number;
  title: string;
  subject: string;
  body: string;
}

/** Découpe `## T1 — angle` … en touches ; l'objet est la ligne `**Objet :** …` (ou `**Subject:** …`). */
export function parseTouches(markdown: string): Touch[] {
  const touches: Touch[] = [];
  const parts = markdown.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const [heading, ...rest] = part.split('\n');
    const match = heading.match(/^T(\d+)\s*[—–-]?\s*(.*)$/i);
    if (!match) continue;
    const lines = rest.join('\n').split(/^## /m)[0].split('\n');
    const subjectLine = lines.find((line) => /^\*\*(Objet|Subject)\s*:?\*\*\s*:?/i.test(line)) ?? '';
    const subject = subjectLine.replace(/^\*\*(Objet|Subject)\s*:?\*\*\s*:?\s*/i, '').trim();
    const body = lines
      .filter((line) => line !== subjectLine)
      .join('\n')
      .trim();
    touches.push({ index: Number(match[1]), title: match[2].trim(), subject, body });
  }
  return touches;
}

export const SPAM_TRIGGERS: string[] = [
  'gratuit',
  'offre exceptionnelle',
  'urgent',
  '100%',
  'garanti',
  'cliquez ici',
  'sans engagement',
  'promotion',
  'free',
  'act now',
  'limited time',
  'guarantee',
  'no obligation',
  'click here',
  'winner',
  '$$$',
  'risk-free',
  'once in a lifetime',
];

export const BREAKUP_MARKERS: string[] = ['dernier message', 'dernière relance', 'je ne reviendrai', 'je clos', 'je ferme', 'last note', 'last email', 'closing the loop', 'close the loop', "i'll stop here", 'won’t follow up', "won't follow up"];

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );
}

/** Similarité de Jaccard des vocabulaires : deux touches trop proches répètent le même angle. */
export function similarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const word of setA) if (setB.has(word)) common += 1;
  return common / (setA.size + setB.size - common);
}

export interface SequenceRules {
  touches: number;
  maxWords: number;
  maxSubjectChars: number;
  maxSimilarity: number;
  requireBreakup: boolean;
  slop: string[];
  spam: string[];
  /**
   * Prospection à froid vers des personnes (France / UE) : chaque touche offre un moyen simple
   * de ne plus être contacté, et la première dit d'où vient l'adresse (RGPD art. 14).
   */
  requireNotice?: boolean;
}

export const OPT_OUT = /répondez\s+[«"“]?\s*stop|ne plus (?:être contacté|recevoir|vous écrire)|désinscri|unsubscribe|opt[- ]out|reply\s+["“]?stop/i;
export const ADDRESS_SOURCE = /(?:adresse|e-mail|email|contact)[^.\n]{0,60}(?:publi|trouv|indiqu|figur)|(?:found|published)[^.\n]{0,40}(?:address|email|contact)/i;

export const DEFAULT_SEQUENCE_RULES: SequenceRules = {
  touches: 4,
  maxWords: 120,
  maxSubjectChars: 60,
  maxSimilarity: 0.5,
  requireBreakup: true,
  slop: DEFAULT_SLOP,
  spam: SPAM_TRIGGERS,
};

export function checkSequence(content: string | null, rules: SequenceRules): { ok: boolean; problems: string[]; touches: number } {
  if (content === null || content.trim() === '') return { ok: false, problems: ['sequence file is missing or empty'], touches: 0 };
  const problems: string[] = [];
  const touches = parseTouches(content);
  if (touches.length !== rules.touches) problems.push(`sequence has ${touches.length} touch(es) ("## T<n> — <angle>"), ${rules.touches} expected`);
  if (/\{\{[^}]*\}\}|\[(FIRSTNAME|PRÉNOM|PRENOM|COMPANY|ENTREPRISE|NOM)\]/i.test(content)) problems.push('unresolved template variable ({{…}} or [FIRSTNAME]) found');
  if (!/^##\s+Notes\s*$/m.test(content)) problems.push('missing section "## Notes" (signal used, cadence, who it goes to)');
  for (const marker of ['TODO', 'TBD', 'lorem ipsum', '<placeholder>']) {
    if (content.toLowerCase().includes(marker.toLowerCase())) problems.push(`draft marker found: "${marker}"`);
  }
  touches.forEach((touch) => {
    const tag = `T${touch.index}`;
    if (touch.subject === '') problems.push(`${tag}: missing "**Objet :** …" line`);
    else if (touch.subject.length > rules.maxSubjectChars) problems.push(`${tag}: subject is ${touch.subject.length} chars, at most ${rules.maxSubjectChars}`);
    const words = countWords(touch.body);
    if (words === 0) problems.push(`${tag}: empty body`);
    if (words > rules.maxWords) problems.push(`${tag}: body is ${words} words, at most ${rules.maxWords}`);
    const text = `${touch.subject}\n${touch.body}`;
    const lower = text.toLowerCase();
    for (const trigger of rules.spam) if (lower.includes(trigger.toLowerCase())) problems.push(`${tag}: spam trigger "${trigger}"`);
    for (const phrase of slopPhrases(text, rules.slop)) problems.push(`${tag}: hollow phrase "${phrase}"`);
    if ((text.match(/!/g) ?? []).length > 1) problems.push(`${tag}: more than one exclamation mark`);
    const shouting = text.match(/\b[A-ZÀ-Ý]{5,}\b/g) ?? [];
    if (shouting.length > 1) problems.push(`${tag}: shouting words (${shouting.slice(0, 3).join(', ')})`);
    if (!touch.body.includes('?')) problems.push(`${tag}: no question (one clear ask per touch)`);
    if ((touch.body.match(/\?/g) ?? []).length > 2) problems.push(`${tag}: more than two questions (one ask per touch)`);
  });
  for (let i = 0; i < touches.length; i += 1) {
    for (let j = i + 1; j < touches.length; j += 1) {
      const score = similarity(touches[i].body, touches[j].body);
      if (score > rules.maxSimilarity) problems.push(`T${touches[i].index} and T${touches[j].index} repeat the same angle (similarity ${Math.round(score * 100)}%)`);
    }
  }
  if (rules.requireBreakup && touches.length > 0) {
    const last = touches[touches.length - 1];
    if (!BREAKUP_MARKERS.some((marker) => last.body.toLowerCase().includes(marker))) problems.push(`T${last.index}: the last touch must be a courteous break-up (say it is the last note)`);
  }
  if (rules.requireNotice) {
    touches.forEach((touch) => {
      if (!OPT_OUT.test(touch.body)) problems.push(`T${touch.index}: no simple way to stop the messages (e.g. « Répondez stop et je ne vous écrirai plus. »)`);
    });
    if (touches.length > 0 && !ADDRESS_SOURCE.test(touches[0].body)) problems.push(`T${touches[0].index}: the first touch does not say where the address comes from (e.g. « Votre adresse figure sur la page équipe de votre site. »)`);
  }
  return { ok: problems.length === 0, problems, touches: touches.length };
}
