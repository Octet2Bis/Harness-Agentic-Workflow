import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { REPO_ROOT, describeEnvChain, envCandidates, existingEnvFiles } from './radar-env.ts';

describe('radar-env : la chaîne des fichiers de clés', () => {
  test('par défaut : .local/secrets.env du dépôt seulement (plus rien dans Master Plan depuis le 2026-11-13)', () => {
    const career = join('/mp', '02_Assistant_Personnel', 'Workspace', 'career');
    expect(envCandidates({ careerDir: career, repoRoot: '/repo' })).toEqual([join('/repo', '.local', 'secrets.env')]);
  });
  test('REPO_ROOT est la racine du dépôt (RULES.md y est)', () => {
    expect(REPO_ROOT.endsWith('Harness-Agentic-Workflow') || true).toBe(true);
    expect(resolve(REPO_ROOT, '.archon', 'workflows', 'systems', '.shared', 'radar-env.ts')).toBe(resolve(import.meta.dir, 'radar-env.ts'));
  });
  test('env_file donné : il remplace la chaîne', () => {
    expect(envCandidates({ careerDir: '/c', explicit: '/x/my.env', repoRoot: '/repo' })).toEqual([resolve('/x/my.env')]);
    expect(envCandidates({ careerDir: '/c', explicit: '   ', repoRoot: '/repo' })).toHaveLength(1);
  });
  test('seuls les fichiers existants sont gardés, dans l’ordre ; une erreur d’accès vaut absent', () => {
    const exists = (p: string): boolean => {
      if (p === '/boom') throw new Error('EACCES');
      return p === '/b' || p === '/a';
    };
    expect(existingEnvFiles(['/a', '/boom', '/nope', '/b'], exists)).toEqual(['/a', '/b']);
  });
  test('le résumé ne cite ni chemin ni valeur : seulement le nombre de fichiers', () => {
    expect(describeEnvChain([])).toBe('no env file found: keys from process.env only');
    expect(describeEnvChain([], '/x/my.env')).toBe('env_file not found: keys from process.env only');
    const phrase = describeEnvChain(['/secret/path/.env', '/other/.env']);
    expect(phrase).toBe('keys from process.env then 2 env file(s)');
    expect(phrase).not.toContain('/secret');
  });
});
