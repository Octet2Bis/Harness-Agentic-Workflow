/**
 * Les garde-fous d'apply-submit qui vivent dans le YAML, pas dans un script : aucune autre
 * porte ne casse si on les retire (une fixture ne joue qu'un tour de boucle, n'exécute pas
 * `until_bash` et ne sait pas reprendre un run ; `archon validate` exige une liaison pour
 * chaque `INPUTS_*` lu, pas sa valeur). Ce test lit apply-submit.yaml avec Bun.YAML.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Node {
  id: string;
  script?: string;
  wait?: { attention?: string };
  when?: string;
  depends_on?: string[];
  always_run?: boolean;
  retry?: { max_attempts?: number };
  with?: Record<string, unknown>;
  loop_group?: { max_iterations?: number; until_bash?: string; nodes?: Node[] };
}

const doc = Bun.YAML.parse(readFileSync(join(import.meta.dir, '..', 'apply-submit.yaml'), 'utf8')) as { nodes: Node[] };
const node = (id: string): Node => {
  const found = doc.nodes.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`node ${id} missing from apply-submit.yaml`);
  return found;
};

/** Les tests `[ … ]` de la dernière instruction de until_bash, et ce que lit chaque variable. */
function untilClauses(until: string): { vars: Map<string, string>; tests: string[]; joins: string[] } {
  const statements = until.split(/;|\n/).map((part) => part.trim()).filter(Boolean);
  const vars = new Map<string, string>();
  for (const statement of statements) {
    const match = /^([A-Za-z_]\w*)=\$([\w.]+)$/.exec(statement);
    if (match) vars.set(match[1]!, match[2]!);
  }
  const parts = (statements.at(-1) ?? '').split(/\s*(\|\||&&)\s*/);
  return { vars, tests: parts.filter((_, i) => i % 2 === 0), joins: parts.filter((_, i) => i % 2 === 1) };
}

describe('apply-submit.yaml : la boucle prepare', () => {
  const loop = node('prepare').loop_group!;
  const { vars, tests, joins } = untilClauses(loop.until_bash ?? '');

  test('s’arrête dès que prefill dit avoir envoyé (submitted_early), par « || »', () => {
    expect(vars.get('e')).toBe('check_prefill.output.submitted_early');
    expect(tests).toContain('[ "$e" = true ]');
    expect(joins.every((join) => join === '||')).toBe(true);
  });

  test('s’arrête au plafond par le compteur du contrôle, plafond = max_iterations = 2', () => {
    expect(loop.max_iterations).toBe(2);
    expect(vars.get('t')).toBe('check_prefill.output.tries');
    expect(tests).toContain(`[ "$t" -ge ${loop.max_iterations} ]`);
    expect(vars.get('ok')).toBe('check_prefill.output.ok');
    expect(tests).toContain('[ "$ok" = true ]');
    expect(tests).toHaveLength(3);
  });

  test('le contrôle reporte l’envoi précoce du tour précédent (le drapeau ne retombe jamais)', () => {
    const check = loop.nodes!.find((entry) => entry.id === 'check_prefill')!;
    expect(check.with?.submitted_before).toBe('$LOOP_PREV.check_prefill.output.submitted_early');
    expect(check.with?.tries).toBe('$LOOP_PREV.check_prefill.output.tries');
  });
});

describe('apply-submit.yaml : jamais deux clics', () => {
  test('la garde own relit le tableau juste avant arm, à chaque reprise (always_run), après un « on envoie »', () => {
    const own = node('own');
    expect(own.always_run).toBe(true);
    expect(own.depends_on).toEqual(['decide']);
    expect(own.when).toBe('$decide.output.proceed == true');
    expect(own.with).toMatchObject({ claim_board: '$INPUTS.claim_board', claim_slug: '$INPUTS.claim_slug', claim_run: '$INPUTS.claim_run' });
  });

  test('arm passe avant submit à chaque reprise (always_run) et seulement si l’offre est encore tenue', () => {
    const arm = node('arm');
    expect(arm.always_run).toBe(true);
    expect(arm.depends_on).toEqual(['own']);
    expect(arm.when).toBe('$own.output.held == true');
  });

  test('submit ne démarre que porte ouverte, avec le moins de rejeux qu’Archon permette', () => {
    const submit = node('submit');
    expect(submit.depends_on).toEqual(['arm']);
    expect(submit.when).toBe('$arm.output.clear == true');
    expect(submit.retry?.max_attempts).toBe(1);
  });

  test('le verdict lit la porte (fermée : unproven, submitted: true) et la garde (perdue : superseded)', () => {
    expect(node('verdict').with?.arm).toEqual({ from: '$arm.output', if_skipped: null });
    expect(node('verdict').with?.own).toEqual({ from: '$own.output', if_skipped: null });
  });
});

describe('apply-submit.yaml : le formulaire, ses hôtes, ses réponses', () => {
  const body = node('prepare').loop_group!.nodes!;
  const prefill = body.find((entry) => entry.id === 'prefill')!;
  const check = body.find((entry) => entry.id === 'check_prefill')!;

  test('target (un script) passe avant la boucle, et prefill suit son résultat, pas sa supposition', () => {
    expect(node('target').script).toBe('target');
    expect(node('prepare').depends_on).toEqual(['target']);
    expect(prefill.with).toMatchObject({
      form_url: '$target.output.form_url',
      how: '$target.output.how',
      needs_login: '$target.output.needs_login',
      handover: '$target.output.handover',
      hosts: '$target.output.hosts',
      letter: '$target.output.letter',
      letter_text: '$target.output.letter_text',
    });
    expect(node('submit').with?.hosts).toBe('$target.output.hosts');
  });

  test('check_prefill lit le mode et les plateformes vérifiées comme gate : une question reste « à remplir par Antoine » seulement si le go suit', () => {
    for (const key of ['mode', 'platform', 'verified_platforms']) expect(check.with?.[key]).toBe(node('gate').with?.[key]);
  });

  test('les contrôles recalculent les hôtes depuis l’URL de l’appelant ; le go montre le résumé (et son récapitulatif)', () => {
    expect(check.with).toMatchObject({ apply_url: '$INPUTS.apply_url', platform: '$INPUTS.platform', answers_file: '$INPUTS.answers_file', profile: '$INPUTS.profile', letter: '$INPUTS.letter', cv: '$INPUTS.cv' });
    expect(node('check_receipt').with).toMatchObject({ apply_url: '$INPUTS.apply_url', platform: '$INPUTS.platform', method: '$INPUTS.method' });
    expect(node('go').wait?.attention).toContain('$prepare.output.summary');
    expect(node('go').wait?.attention).toContain('à remplir par Antoine');
  });
});
