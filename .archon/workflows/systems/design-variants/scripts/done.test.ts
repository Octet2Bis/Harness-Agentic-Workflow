import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { type Status, type Verdict, collectVariants } from './collect.ts';
import { decide } from './done.ts';

const verdict = (ok: boolean, status: Status, summary: string, path: string): Verdict => ({ ok, status, summary, deliverable: { path } });
const UNCONVERGED_SUMMARY = 'Checks still failing after 3 round(s); the judge did not run. stub: page built';
const allPass = collectVariants(
  {
    a: verdict(true, 'verified', 'A sober', 'variant-a.html'),
    b: verdict(true, 'verified', 'B proof first', 'variant-b.html'),
    c: verdict(true, 'verified', 'C narrative', 'variant-c.html'),
  },
  '/runs/1',
);
// B est restée rouge à son plafond de tours (verdict unconverged) : A et C survivent.
const bUnconverged = collectVariants(
  {
    a: verdict(true, 'verified', 'A sober', 'variant-a.html'),
    b: verdict(false, 'unconverged', UNCONVERGED_SUMMARY, 'variant-b.html'),
    c: verdict(true, 'verified', 'C narrative', 'variant-c.html'),
  },
  '/runs/1',
);
// Aucune survivante, une variante dans chacun des trois états non proposés.
const noneLeft = collectVariants(
  { a: null, b: verdict(false, 'rejected', 'B rejected', 'variant-b.html'), c: verdict(false, 'unconverged', UNCONVERGED_SUMMARY, 'variant-c.html') },
  '/runs/1',
);
const unconverged = (l: string) => verdict(false, 'unconverged', UNCONVERGED_SUMMARY, `variant-${l}.html`);
const allUnconverged = collectVariants({ a: unconverged('a'), b: unconverged('b'), c: unconverged('c') }, '/runs/1');

// Deux issues seulement atteignent `done` : une survivante choisie, ou aucune survivante
// (`choose` sauté). La fixture qui joue chaque cas est nommée dans le titre ; sans fixture,
// le commentaire dit ce qui le rend possible.
describe('done : le choix est l’id de l’option, jamais une lettre cherchée dans le texte', () => {
  test("[chosen] « C'est la B » avec decision b garde la B (l'ancienne regex rendait c)", () => {
    expect(decide(allPass, { decision: 'b', text: "C'est la B" })).toEqual({
      ok: true,
      chosen: 'b',
      variants: { a: true, b: true, c: true },
      statuses: { a: 'verified', b: 'verified', c: 'verified' },
      summary: "Variant B kept: B proof first (note: C'est la B)",
    });
  });

  // Le texte est libre : il peut nommer une autre variante que l'option choisie.
  test('le texte ne contredit jamais la décision', () => {
    expect(decide(allPass, { decision: 'b', text: 'Celle qui a le meilleur CTA : B' }).chosen).toBe('b');
    expect(decide(allPass, { decision: 'a', text: "C'est la B" }).chosen).toBe('a');
  });

  // Chaque variante a sa propre boucle : une seule peut rester rouge à son plafond.
  test('une variante non convergée n’empêche pas de garder une survivante', () => {
    expect(decide(bUnconverged, { decision: 'c', text: '' })).toEqual({
      ok: true,
      chosen: 'c',
      variants: { a: true, b: false, c: true },
      statuses: { a: 'verified', b: 'unconverged', c: 'verified' },
      summary: 'Variant C kept: C narrative',
    });
  });

  // Une variante sans verdict, une refusée, une non convergée : les trois raisons à la fois
  // (chaque variante a sa boucle et son juge).
  test('choix sauté faute de survivante : ok false, l’état de chaque variante dans le résumé, chacun avec ses mots', () => {
    expect(decide(noneLeft, null)).toEqual({
      ok: false,
      chosen: null,
      variants: { a: null, b: false, c: false },
      statuses: { a: null, b: 'rejected', c: 'unconverged' },
      summary:
        'No variant passed its checks and judge; nothing was offered to choose (A: no verdict (a node of the block failed: its judge, or a step of its check loop); B: rejected by its judge; C: did not converge).',
    });
  });

  test('[all-unconverged] les trois non convergées : choix sauté, issue ok false qui le dit pour chacune', () => {
    expect(decide(allUnconverged, null)).toEqual({
      ok: false,
      chosen: null,
      variants: { a: false, b: false, c: false },
      statuses: { a: 'unconverged', b: 'unconverged', c: 'unconverged' },
      summary:
        'No variant passed its checks and judge; nothing was offered to choose (A: did not converge; B: did not converge; C: did not converge).',
    });
  });
});

describe('done : le seul garde-fou fait échouer le nœud', () => {
  // Choix sauté alors qu'une variante survit : le YAML l'interdit (`choose` tourne dès que
  // `survivors > 0`, `none` annule le run par `drop`, un select n'accepte qu'une option
  // proposée). Le script, lancé pour de vrai, sort en échec sans rien rendre.
  test('pas de choix malgré des survivantes : « done: unexpected state », code 1, rien sur stdout', () => {
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'done.ts')], {
      env: { ...process.env, INPUTS_COLLECT: JSON.stringify(allPass), INPUTS_CHOOSE: 'null' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(1);
    expect(proc.stdout.toString()).toBe('');
    expect(proc.stderr.toString()).toStartWith('done: unexpected state: choice null with 3 variant(s) offered');
  });
});
