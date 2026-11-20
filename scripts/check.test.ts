import { describe, expect, test } from 'bun:test';
import { runCheck } from './check.ts';

const md = '# T\n\n## Question\nQ\n\n## Sources\n- https://a.example/x (2026-01-01)\n- https://b.example/y\n\n## Synthèse\nS\n';

describe('generic checks', () => {
  test('pass on a conforming file', () => {
    expect(runCheck('exists', md)).toBeNull();
    expect(runCheck('min-chars', md, '20')).toBeNull();
    expect(runCheck('max-chars', md, '1000')).toBeNull();
    expect(runCheck('min-links', md, '2')).toBeNull();
    expect(runCheck('has-sections', md, 'Question,Sources,Synthèse')).toBeNull();
    expect(runCheck('has-text', md, '## question')).toBeNull();
    expect(runCheck('no-text', md, 'TODO')).toBeNull();
    expect(runCheck('json', '{"a":1}')).toBeNull();
    expect(runCheck('json-keys', '{"a":1,"b":2}', 'a,b')).toBeNull();
  });
  test('fail with a reason', () => {
    expect(runCheck('exists', null)).toBe('fichier absent');
    expect(runCheck('min-chars', md, '9999')).toMatch(/< 9999/);
    expect(runCheck('max-chars', md, '10')).toMatch(/> 10/);
    expect(runCheck('min-links', md, '3')).toMatch(/2 lien/);
    expect(runCheck('has-sections', md, 'Question,Limites')).toBe('sections manquantes : Limites');
    expect(runCheck('has-text', md, 'zzz')).toMatch(/absent/);
    expect(runCheck('no-text', md, 'Synthèse')).toMatch(/présent/);
    expect(runCheck('json', '{oops')).toMatch(/JSON invalide/);
    expect(runCheck('json-keys', '{"a":1}', 'a,b')).toBe('clés manquantes : b');
    expect(runCheck('nope', md)).toMatch(/inconnu/);
  });
  test('an argument that is missing or not a number never passes', () => {
    expect(runCheck('min-chars', md)).toMatch(/attend un nombre/);
    expect(runCheck('min-links', md, 'trois')).toMatch(/attend un nombre/);
    expect(runCheck('max-chars', md, '')).toMatch(/attend un nombre/);
    expect(runCheck('has-sections', md)).toMatch(/non vide/);
    expect(runCheck('json-keys', '{"a":1}', ' , ')).toMatch(/non vide/);
    expect(runCheck('no-text', md)).toMatch(/non vide/);
  });
});
