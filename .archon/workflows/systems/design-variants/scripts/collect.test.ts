import { describe, expect, test } from 'bun:test';
import { type Status, type Verdict, collectVariants } from './collect.ts';

const verdict = (ok: boolean, status: Status, summary: string, path: string): Verdict => ({ ok, status, summary, deliverable: { path } });
const UNCONVERGED_SUMMARY = 'Checks still failing after 3 round(s); the judge did not run. stub: page built';

// Chaque variante a sa boucle, son juge et son verdict : les quatre issues se combinent
// librement dans un vrai run. Les fixtures (stubs `work`/`check` partagés) n'en jouent que
// quelques combinaisons ; ces tests couvrent les autres. Un verdict a toujours `status` et un
// livrable (output_format du verdict de `landing-page`) : aucun test n'en retire.
describe('collect', () => {
  test('propose les survivantes, puis none', () => {
    const all = collectVariants(
      {
        a: verdict(true, 'verified', 'A sober', 'variant-a.html'),
        b: verdict(true, 'verified', 'B proof first', 'variant-b.html'),
        c: verdict(true, 'verified', 'C narrative', 'variant-c.html'),
      },
      '/runs/1',
    );
    expect(all.survivors).toBe(3);
    expect(all.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'none']);
    expect(all.options[1]).toEqual({ id: 'b', label: 'B: B proof first' });
    expect(all.statuses).toEqual({ a: 'verified', b: 'verified', c: 'verified' });
  });

  test('nomme sans les proposer la variante sans verdict, la refusée et la non convergée, chacune avec ses mots', () => {
    const mixed = collectVariants(
      { a: null, b: verdict(false, 'rejected', 'B rejected', 'variant-b.html'), c: verdict(false, 'unconverged', UNCONVERGED_SUMMARY, 'variant-c.html') },
      '/runs/1',
    );
    expect(mixed.survivors).toBe(0);
    expect(mixed.options.map((o) => o.id)).toEqual(['none']);
    expect(mixed.variants).toEqual({ a: null, b: false, c: false });
    expect(mixed.statuses).toEqual({ a: null, b: 'rejected', c: 'unconverged' });
    expect(mixed.text.split('\n')).toEqual([
      'A (/runs/1/variant-a.html): no verdict (a node of the block failed: its judge, or a step of its check loop); not offered.',
      'B (/runs/1/variant-b.html) ok=false, rejected by its judge — B rejected; not offered.',
      `C (/runs/1/variant-c.html) did not converge: ${UNCONVERGED_SUMMARY}; not offered.`,
    ]);
  });

  test('une variante non convergée parmi des survivantes : seules les survivantes sont proposées', () => {
    const oneUnconverged = collectVariants(
      {
        a: verdict(true, 'verified', 'A sober', 'variant-a.html'),
        b: verdict(false, 'unconverged', UNCONVERGED_SUMMARY, 'variant-b.html'),
        c: verdict(true, 'verified', 'C narrative', 'variant-c.html'),
      },
      '/runs/1',
    );
    expect(oneUnconverged.survivors).toBe(2);
    expect(oneUnconverged.options.map((o) => o.id)).toEqual(['a', 'c', 'none']);
    expect(oneUnconverged.variants).toEqual({ a: true, b: false, c: true });
    expect(oneUnconverged.statuses).toEqual({ a: 'verified', b: 'unconverged', c: 'verified' });
    expect(oneUnconverged.summaries.b).toBe(UNCONVERGED_SUMMARY);
  });

  test('les trois non convergées : aucune survivante, seule l’option none reste', () => {
    const v = (l: string) => verdict(false, 'unconverged', UNCONVERGED_SUMMARY, `variant-${l}.html`);
    const allUnconverged = collectVariants({ a: v('a'), b: v('b'), c: v('c') }, '/runs/1');
    expect(allUnconverged.survivors).toBe(0);
    expect(allUnconverged.options.map((o) => o.id)).toEqual(['none']);
    expect(allUnconverged.statuses).toEqual({ a: 'unconverged', b: 'unconverged', c: 'unconverged' });
    for (const line of allUnconverged.text.split('\n')) {
      expect(line).toContain(' did not converge: Checks still failing after 3 round(s)');
      // « did not converge », puis le constat du bloc une seule fois : rien de redit.
      expect(line.match(/converge/g)).toHaveLength(1);
      expect(line.match(/checks still failing/gi)).toHaveLength(1);
      expect(line).not.toContain('last round');
    }
  });
});
