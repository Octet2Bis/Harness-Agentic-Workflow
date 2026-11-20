import { describe, expect, test } from 'bun:test';
import { type Verdict, decide } from './done.ts';

const verified = (summary: string, path: string): Verdict => ({ ok: true, status: 'verified', summary, deliverable: { path } });
const rejected = (summary: string, path: string): Verdict => ({ ok: false, status: 'rejected', summary, deliverable: { path } });
const unconverged = (summary: string, path: string): Verdict => ({ ok: false, status: 'unconverged', summary: `Checks still failing after 3 round(s); the judge did not run. ${summary}`, deliverable: { path } });
const dossier = verified('D ok', 'dossier.md');
const angle = verified('A ok', 'proposal.md');
const sequence = verified('S ok', 'sequence.md');

describe('done : chaque bloc arrête la chaîne pour une raison nommée', () => {
  test('[approved] tout ok et approuvé : ok true, rien envoyé', () => {
    expect(decide(dossier, angle, sequence, { decision: 'approve', text: '' })).toEqual({
      ok: true,
      stage: 'done',
      summary: 'Approved at final review; nothing was sent. S ok',
      deliverables: { dossier: 'dossier.md', angle: 'proposal.md', sequence: 'sequence.md' },
    });
  });

  test('[dossier-unconverged] le dossier ne converge pas : stage dossier', () => {
    const outcome = decide(unconverged('only 2 competitors', 'dossier.md'), null, null, null);
    expect(outcome).toMatchObject({ ok: false, stage: 'dossier', deliverables: { dossier: 'dossier.md', angle: null, sequence: null } });
    expect(outcome.summary).toBe('Company dossier did not converge: Checks still failing after 3 round(s); the judge did not run. only 2 competitors');
  });

  test('[dossier-no-verdict] un nœud du dossier échoue : verdict null', () => {
    expect(decide(null, null, null, null).summary).toBe('Company dossier returned no verdict: one of its nodes failed (a model or script error), so its verdict was skipped.');
  });

  test('[angle-rejected] le juge refuse l\'angle : stage angle', () => {
    expect(decide(dossier, rejected('proof beside the point', 'proposal.md'), null, null)).toMatchObject({ ok: false, stage: 'angle', summary: 'Offer angle rejected: proof beside the point' });
  });

  test('[sequence-rejected] le juge refuse la séquence : stage sequence', () => {
    expect(decide(dossier, angle, rejected('pushy', 'sequence.md'), null)).toMatchObject({ ok: false, stage: 'sequence', summary: 'Outbound sequence rejected: pushy' });
  });

  test('les trois blocs ok sans « go » : aucun chemin, le nœud échoue', () => {
    expect(() => decide(dossier, angle, sequence, null)).toThrow('done: unexpected state');
    expect(() => decide(dossier, angle, sequence, { decision: 'reject', text: 'no' })).toThrow('done: unexpected state');
  });
});
