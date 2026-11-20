/** Copie de blocks/.shared/io.test.ts pour la partie partagée par le pack `systems`. */

import { describe, expect, test } from 'bun:test';
import { artifactPointer } from './io.ts';

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
