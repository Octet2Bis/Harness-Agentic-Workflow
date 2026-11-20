import { describe, expect, test } from 'bun:test';
import { gitBashCandidates, resolveBash } from './check.ts';

const none = (): boolean => false;
const only = (...paths: string[]) => (path: string): boolean => paths.includes(path);

describe('resolveBash : le bash des tests, dans l’ordre de resolveBashPath d’Archon', () => {
  test('Linux et macOS sans ARCHON_BASH_PATH : bash nu, cherché dans le PATH (comportement d’avant)', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(resolveBash({}, platform, none)).toBe('bash');
      expect(resolveBash({ ARCHON_BASH_PATH: '' }, platform, none)).toBe('bash');
    }
  });

  test('ARCHON_BASH_PATH d’abord, sur toute plateforme, avant les emplacements de Git Bash', () => {
    const exists = only('/opt/bash', 'C:\\Program Files\\Git\\bin\\bash.exe');
    expect(resolveBash({ ARCHON_BASH_PATH: '/opt/bash' }, 'linux', exists)).toBe('/opt/bash');
    expect(resolveBash({ ARCHON_BASH_PATH: '/opt/bash' }, 'win32', exists)).toBe('/opt/bash');
  });

  test('ARCHON_BASH_PATH vers un chemin absent : une erreur qui le nomme, jamais un repli silencieux', () => {
    expect(() => resolveBash({ ARCHON_BASH_PATH: 'D:\\nope\\bash.exe' }, 'win32', none)).toThrow(
      "ARCHON_BASH_PATH points to a path that does not exist: 'D:\\nope\\bash.exe'",
    );
  });

  test('Windows : le premier Git Bash installé, dans l’ordre d’Archon, jamais le bash nu (lanceur WSL)', () => {
    const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\U\\AppData\\Local', USERPROFILE: 'C:\\U' };
    expect(gitBashCandidates(env)).toEqual([
      'C:\\PF\\Git\\bin\\bash.exe',
      'C:\\PF\\Git\\usr\\bin\\bash.exe',
      'C:\\PF86\\Git\\bin\\bash.exe',
      'C:\\U\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
      'C:\\U\\scoop\\apps\\git\\current\\bin\\bash.exe',
    ]);
    expect(resolveBash(env, 'win32', only('C:\\PF86\\Git\\bin\\bash.exe', 'C:\\U\\scoop\\apps\\git\\current\\bin\\bash.exe'))).toBe(
      'C:\\PF86\\Git\\bin\\bash.exe',
    );
    expect(resolveBash(env, 'win32', only('C:\\U\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'))).toBe(
      'C:\\U\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
    );
  });

  test('Windows sans Git Bash trouvé : le chemin canonique, pour que l’erreur nomme un chemin réel', () => {
    expect(resolveBash({ ProgramFiles: 'C:\\PF' }, 'win32', none)).toBe('C:\\PF\\Git\\bin\\bash.exe');
    expect(resolveBash({}, 'win32', none)).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  test('Windows sans LOCALAPPDATA ni USERPROFILE : seuls les emplacements de Program Files', () => {
    expect(gitBashCandidates({})).toEqual([
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ]);
  });
});
