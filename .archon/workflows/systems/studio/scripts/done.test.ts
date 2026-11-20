import { describe, expect, test } from 'bun:test';
import { type Verdict, decide, nextSteps } from './done.ts';

const verified = (summary: string, path: string): Verdict => ({ ok: true, status: 'verified', summary, deliverable: { path } });
const rejected = (summary: string, path: string): Verdict => ({ ok: false, status: 'rejected', summary, deliverable: { path } });
const unconverged = (summary: string, path: string): Verdict => ({
  ok: false,
  status: 'unconverged',
  summary: `Checks still failing after 3 round(s); the judge did not run. ${summary}`,
  deliverable: { path },
});
const all = {
  calibrate: verified('app: iOS app', 'calibrage.json'),
  brief: verified('brief ok', 'BRIEF.md'),
  design: verified('AA in both themes', 'design-system.md'),
  content: verified('24 entries fr/en', 'content.json'),
};
const calibration = JSON.stringify({ type: 'app' });
const approve = { decision: 'approve' as const, text: '' };

describe('done : chaque bloc arrête la chaîne pour une raison nommée', () => {
  test('[approved] tout ok et approuvé : la ligne suivante est celle du type', () => {
    expect(decide(all, approve, calibration)).toEqual({
      ok: true,
      stage: 'done',
      summary: 'Approved at final review. 24 entries fr/en Next, the app lane: prd → ecrans → fonctionnalites → qa-finale → go → diffusion.',
      type: 'app',
      next: ['prd', 'ecrans', 'fonctionnalites', 'qa-finale', 'go', 'diffusion'],
      deliverables: { calibrage: 'calibrage.json', brief: 'BRIEF.md', design_system: 'design-system.md', content: 'content.json' },
    });
  });

  test('[approved] sans calibrage.json lisible : type null, pas de ligne inventée', () => {
    const outcome = decide(all, approve, null);
    expect(outcome.type).toBeNull();
    expect(outcome.next).toEqual([]);
    expect(outcome.summary).toBe('Approved at final review. 24 entries fr/en');
  });

  test("[calibrate-unconverged] le cadrage n'a pas convergé : rien après, pas de type", () => {
    const outcome = decide({ calibrate: unconverged('evidence not in the request', 'calibrage.json'), brief: null, design: null, content: null }, null, calibration);
    expect(outcome).toEqual({
      ok: false,
      stage: 'calibrate',
      summary: 'Calibration did not converge: Checks still failing after 3 round(s); the judge did not run. evidence not in the request',
      type: null,
      next: [],
      deliverables: { calibrage: 'calibrage.json', brief: null, design_system: null, content: null },
    });
  });

  test('[calibrate-no-verdict] un nœud du cadrage a échoué', () => {
    const outcome = decide({ calibrate: null, brief: null, design: null, content: null }, null, null);
    expect(outcome.stage).toBe('calibrate');
    expect(outcome.summary).toBe('Calibration returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.');
  });

  test('[brief-rejected] [design-rejected] [content-rejected] le stage est celui du bloc refusé, le type reste connu', () => {
    const b = decide({ ...all, brief: rejected('invented audience', 'BRIEF.md'), design: null, content: null }, null, calibration);
    expect([b.stage, b.summary, b.type]).toEqual(['brief', 'Brief rejected: invented audience', 'app']);
    const d = decide({ ...all, design: rejected('stock look', 'design-system.md'), content: null }, null, calibration);
    expect([d.stage, d.summary, d.deliverables.content]).toEqual(['design-system', 'Design system rejected: stock look', null]);
    const c = decide({ ...all, content: rejected('literal English', 'content.json') }, null, calibration);
    expect([c.stage, c.summary, c.next]).toEqual(['content-base', 'Content base rejected: literal English', []]);
  });

  test('quatre blocs ok sans « go » : done échoue plutôt que d’inventer une issue', () => {
    expect(() => decide(all, null, calibration)).toThrow('done: unexpected state');
    expect(() => decide(all, { decision: 'reject', text: 'no' }, calibration)).toThrow('done: unexpected state');
  });
});

describe('nextSteps', () => {
  test('the lane of each type, then the common finish', () => {
    expect(nextSteps('graphique')).toEqual(['direction-artistique', 'declinaisons', 'kit-de-marque', 'qa-finale', 'go', 'diffusion']);
    expect(nextSteps('site')).toEqual(['arborescence', 'pages', 'seo-tracking', 'qa-finale', 'go', 'diffusion']);
    expect(nextSteps(null)).toEqual([]);
  });
});
