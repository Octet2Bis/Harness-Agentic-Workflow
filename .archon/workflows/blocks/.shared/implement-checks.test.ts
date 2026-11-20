import { describe, expect, test } from 'bun:test';
import { doneTasks, journalProblems, remainingTasks, testProblems } from './implement-checks.ts';

const journal = `# Journal\n\n## Fait\n- T1 : modèle de données\n- T2 : migration\n\n## Reste\n- T3 : endpoint\n- T4 : tests d'intégration\n`;

describe('journal', () => {
  test('counts done and remaining tasks', () => {
    expect(doneTasks(journal)).toHaveLength(2);
    expect(remainingTasks(journal)).toEqual(['- T3 : endpoint', "- T4 : tests d'intégration"]);
    expect(journalProblems(journal)).toEqual([]);
  });
  test('an empty Reste, or an explicit empty marker, means nothing remains', () => {
    expect(remainingTasks('## Fait\n- x\n\n## Reste\n')).toEqual([]);
    for (const marker of ['- (rien)', '- Aucune', 'Néant.', '(none)', '1. rien']) {
      expect(remainingTasks(`## Fait\n- x\n\n## Reste\n${marker}\n`)).toEqual([]);
    }
  });
  test('numbered items and prose under Reste are remaining tasks', () => {
    expect(remainingTasks('## Fait\n- x\n\n## Reste\n1. T3\n2) T4\n')).toEqual(['1. T3', '2) T4']);
    expect(remainingTasks("## Fait\n- x\n\n## Reste\nBrancher l'endpoint\n")).toEqual(["Brancher l'endpoint"]);
    expect(remainingTasks('## Reste\n- T3 : endpoint\n  suite de la puce\n')).toEqual(['- T3 : endpoint']);
    expect(doneTasks('## Fait\n1. T1\n2. T2\n\n## Reste\n')).toHaveLength(2);
  });
  test('missing journal or sections are problems', () => {
    expect(journalProblems(null)[0]).toMatch(/not found/);
    expect(journalProblems('## Fait\n- x\n')).toEqual(['journal: section "## Reste" missing']);
    expect(journalProblems('## Fait\n\n## Reste\n- y\n')[0]).toMatch(/lists nothing/);
  });
});

describe('tests', () => {
  test('green tests raise nothing, red tests carry the tail', () => {
    expect(testProblems(0, 'ok', 'npm test')).toEqual([]);
    const [problem] = testProblems(1, 'line1\nline2\nFAIL foo', 'npm test', 2);
    expect(problem).toContain('exit 1');
    expect(problem).toContain('FAIL foo');
    expect(problem).not.toContain('line1');
    expect(testProblems(null, '', 'npm test')[0]).toMatch(/did not finish/);
  });
});
