import { describe, expect, test } from 'bun:test';
import { checkReview, diffFiles, unquotePath } from './review-checks.ts';

// Sortie réelle de `git diff HEAD` + fichiers non suivis (`git diff --no-index /dev/null <f>`) :
// chemin à espaces (git ajoute une tabulation), accents entre guillemets, binaire, suppression, renommage.
const realDiff = "diff --git a/docs/mon fichier.md b/docs/mon fichier.md\nnew file mode 100644\nindex 0000000..587be6b\n--- /dev/null\n+++ b/docs/mon fichier.md\t\n@@ -0,0 +1 @@\n+x\ndiff --git a/src/a.ts b/src/a.ts\nindex 7898192..422c2b7 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n a\n+b\ndiff --git a/src/bin.dat b/src/bin.dat\nnew file mode 100644\nindex 0000000..bdc955b\nBinary files /dev/null and b/src/bin.dat differ\ndiff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644\nindex 3367afd..0000000\n--- a/src/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\ndiff --git a/src/ren.ts b/src/renamed.ts\nsimilarity index 100%\nrename from src/ren.ts\nrename to src/renamed.ts\ndiff --git a/docs/mon fichier.md b/docs/mon fichier.md\n+new file mode 100644\n+index 0000000..587be6b\n+--- /dev/null\n++++ b/docs/mon fichier.md\t\n+@@ -0,0 +1 @@\n++x\n+diff --git a/src/a.ts b/src/a.ts\n+index 7898192..422c2b7 100644\n+--- a/src/a.ts\n++++ b/src/a.ts\n+@@ -1 +1,2 @@\n+ a\n++b\n+diff --git a/src/bin.dat b/src/bin.dat\n+new file mode 100644\n+index 0000000..bdc955b\n+Binary files /dev/null and b/src/bin.dat differ\n+diff --git a/src/old.ts b/src/old.ts\n+deleted file mode 100644\n+index 3367afd..0000000\n+--- a/src/old.ts\n++++ /dev/null\n+@@ -1 +0,0 @@\n+-old\n+diff --git a/src/ren.ts b/src/renamed.ts\n+similarity index 100%\n+rename from src/ren.ts\n+rename to src/renamed.ts\ndiff --git \"a/src/caf\\303\\251.ts\" \"b/src/caf\\303\\251.ts\"\nnew file mode 100644\nindex 0000000..975fbec\n--- /dev/null\n+++ \"b/src/caf\\303\\251.ts\"\n@@ -0,0 +1 @@\n+y\ndiff --git a/src/untracked file.ts b/src/untracked file.ts\nnew file mode 100644\nindex 0000000..4ae8ef0\n--- /dev/null\n+++ b/src/untracked file.ts\t\n@@ -0,0 +1 @@\n+u\n";

const diff = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\ndiff --git a/src/b.ts b/src/b.ts\n+++ b/src/b.ts\n`;
const finding = { file: 'src/a.ts', line: 3, severity: 'blocking', text: 'null is dereferenced when the list is empty; guard it' };

describe('review checks', () => {
  test('lists the files of a diff', () => {
    expect(diffFiles(diff)).toEqual(['src/a.ts', 'src/b.ts']);
  });
  test('a clean pass and a justified fail are ok', () => {
    expect(checkReview(JSON.stringify({ verdict: 'pass', summary: 'The diff matches the plan and is covered by tests.', findings: [] }), diff).ok).toBe(true);
    const r = checkReview(JSON.stringify({ verdict: 'fail', summary: 'One blocking defect in the empty-list path.', findings: [finding] }), diff);
    expect(r.ok).toBe(true);
    expect(r.code_verdict).toBe('fail');
    expect(r.blocking).toBe(1);
  });
  test('verdict and findings must agree, and findings must point into the diff', () => {
    expect(checkReview(JSON.stringify({ verdict: 'fail', summary: 'Something is wrong somewhere in there.', findings: [] }), diff).problems).toContain('verdict "fail" needs at least one blocking finding');
    const r = checkReview(JSON.stringify({ verdict: 'pass', summary: 'Looks fine to me overall, nothing serious.', findings: [{ ...finding, file: 'src/zzz.ts' }] }), diff);
    expect(r.problems.some((p) => p.includes('not in the diff'))).toBe(true);
    expect(r.problems.some((p) => p.includes('verdict "pass" with 1 blocking'))).toBe(true);
  });
  test('missing diff, bad JSON, short text are problems', () => {
    expect(checkReview(null, null).problems).toEqual(['diff.patch missing or empty: write the diff since `git merge-base <base> HEAD`, working tree and untracked files included, to the artifacts before reviewing', 'review.json not found']);
    expect(checkReview('{oops', diff).code_verdict).toBe('unknown');
    expect(checkReview(JSON.stringify({ verdict: 'pass', summary: 'ok', findings: [{ file: 'src/a.ts', severity: 'minor', text: 'short' }] }), diff).problems).toHaveLength(2);
  });
});

describe('diffFiles on real git output', () => {
  test('reads spaced, quoted, binary, deleted, renamed and untracked files', () => {
    expect(diffFiles(realDiff).sort()).toEqual(
      ['docs/mon fichier.md', 'src/a.ts', 'src/bin.dat', 'src/café.ts', 'src/old.ts', 'src/renamed.ts', 'src/untracked file.ts'].sort(),
    );
  });
  test('unquotes C-style paths', () => {
    expect(unquotePath('"src/caf\\303\\251.ts"')).toBe('src/café.ts');
    expect(unquotePath('"a \\"b\\".ts"')).toBe('a "b".ts');
    expect(unquotePath('plain/path.ts')).toBe('plain/path.ts');
  });
});
