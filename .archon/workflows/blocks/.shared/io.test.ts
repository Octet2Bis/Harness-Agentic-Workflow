import { describe, expect, test } from 'bun:test';
import { artifactPointer, nextTry } from './io.ts';

// Le compteur de tours de chaque contrôle : `until_bash` s'arrête quand il atteint
// max_iterations. S'il ne comptait plus (toujours 1), la boucle s'épuiserait et le run
// finirait `failed`, sans verdict typé.
describe('nextTry', () => {
  test('commence à 1 sans tour précédent lisible', () => {
    expect(nextTry(undefined)).toBe(1);
    expect(nextTry('')).toBe(1);
    expect(nextTry('null')).toBe(1);
    expect(nextTry('abc')).toBe(1);
  });
  test('compte à partir du tour précédent', () => {
    expect(nextTry('1')).toBe(2);
    expect(nextTry('7')).toBe(8);
  });
  test('tolère les espaces autour de la liaison', () => {
    expect(nextTry(' 3 ')).toBe(4);
  });
});

describe('artifactPointer', () => {
  test('nomme un fichier relatif aux artefacts du run, avec le run courant', () => {
    process.env.WORKFLOW_ID = 'run-1';
    expect(artifactPointer('submission/verdict.json')).toEqual({ type: 'archon_artifact', run_id: 'run-1', path: 'submission/verdict.json' });
    expect(artifactPointer('.\\application\\CV.md').path).toBe('application/CV.md');
  });
  test('refuse un dossier : Archon exige un fichier régulier (premier run réel, 2026-10-22)', () => {
    expect(() => artifactPointer('application')).toThrow('never a directory');
    expect(() => artifactPointer('submission/')).toThrow('never a directory');
  });
  test('refuse un chemin absolu ou remontant', () => {
    expect(() => artifactPointer('/tmp/CV.md')).toThrow('relative');
    expect(() => artifactPointer('C:\\x\\CV.md')).toThrow('relative');
    expect(() => artifactPointer('../CV.md')).toThrow("'..'");
  });
});
