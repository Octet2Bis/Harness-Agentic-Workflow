/**
 * La garde de propriété (`own`) : le clic n'a lieu que si l'offre est encore tenue par la
 * prise de l'appelant, relue juste avant `arm`. La règle pure (`ownership`, `holds`), puis le
 * script lancé pour de vrai sur un tableau temporaire.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holds, ownership } from './own.ts';

const noTraces = { armed: null, click: null, receipt: null, receiptScreenshot: false };
const board = (entry: Record<string, unknown>): string => JSON.stringify([{ slug: 'other', status: 'VALIDATED' }, { slug: 'acme', company: 'Acme', ...entry }]);
const check = (entry: Record<string, unknown> | null, claim = 'L1', traces = noTraces) =>
  ownership({ board: entry === null ? null : board(entry), boardPath: '/career/pending_gold_jobs.json', slug: 'acme', claim, traces });

describe('ownership : le clic seulement si l’offre est encore tenue par cette prise', () => {
  test('APPLYING par cette prise : tenue', () => {
    expect(check({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } })).toMatchObject({ held: true, evidence: [] });
  });

  test('prise close par le filet du listener (périmée pendant l’attente du go) : plus tenue, rien n’est envoyé', () => {
    expect(check({ status: 'APPLY_FAILED', harness: { run: 'L1', stage: 'listener' } }).held).toBe(false);
  });

  test('le défaut corrigé : run à la main (A1) au go plus de deux heures, prise close, /valider sur la VM, go approuvé sur le PC avant le pull : pas de clic', () => {
    // La règle des prises périmées a clos la prise de A1 sur le PC : APPLY_FAILED, harness.run = A1.
    // Le /valider n'est encore que sur la VM ; own lit la copie du PC. Avant le correctif, la
    // branche APPLY_FAILED la disait tenue : A1 cliquait, puis le pull remettait l'offre en file
    // et le listener postulait une seconde fois, sans go, sur une plateforme vérifiée.
    const closed = { status: 'APPLY_FAILED', validated_at: 'old', harness: { run: 'A1', stage: 'listener', note: 'The claim went stale' } };
    const out = check(closed, 'A1');
    expect(out.held).toBe(false);
    expect(out.reason).toStartWith('Not sent:');
    expect(out.reason).toContain('APPLY_FAILED');
  });

  test('scénario A : un run lancé à la main (prise A1) quand le listener tient l’offre (L1) : pas tenue, rien n’est envoyé', () => {
    const out = check({ status: 'APPLYING', applying: { run: 'L1', at: 'x' } }, 'A1');
    expect(out.held).toBe(false);
    expect(out.reason).toStartWith('Not sent:');
    expect(out.reason).toContain('APPLYING by another run (L1)');
  });

  test('scénario B : vieux run repris après que le filet a clos sa prise et qu’un /valider l’a remise en file : pas tenue', () => {
    for (const entry of [
      { status: 'VALIDATED', validated_at: 'newer', harness: { run: 'L1', stage: 'listener' } },
      { status: 'APPLYING', applying: { run: 'L2', at: 'x' } },
      { status: 'APPLIED', harness: { run: 'A2', stage: 'done' } },
      { status: 'APPLY_UNPROVEN', harness: { run: 'L1', stage: 'listener' } },
      { status: 'TAILORED', harness: { run: 'A1', stage: 'submit' } },
      { status: 'APPLY_FAILED', harness: { run: 'L0', stage: 'listener' } },
      { status: 'APPLY_FAILED', harness: { run: 'L1', stage: 'tailor' } },
    ]) {
      expect(check(entry).held).toBe(false);
    }
  });

  test('dans le doute, pas tenue : tableau absent, illisible, offre absente, prise vide', () => {
    expect(check(null).held).toBe(false);
    expect(ownership({ board: '{broken', boardPath: '/b.json', slug: 'acme', claim: 'L1', traces: noTraces }).held).toBe(false);
    expect(ownership({ board: '', boardPath: '/b.json', slug: 'acme', claim: 'L1', traces: noTraces }).held).toBe(false);
    expect(ownership({ board: '[]', boardPath: '/b.json', slug: 'acme', claim: 'L1', traces: noTraces }).held).toBe(false);
    expect(ownership({ board: board({ status: 'APPLYING', applying: { run: '' } }), boardPath: '/b.json', slug: 'acme', claim: '', traces: noTraces }).held).toBe(false);
    expect(ownership({ board: board({ status: 'APPLYING', applying: { run: 'L1' } }), boardPath: '/b.json', slug: '', claim: 'L1', traces: noTraces }).held).toBe(false);
  });

  test('sans tableau à vérifier (bloc utilisé seul) : tenue', () => {
    expect(ownership({ board: null, boardPath: '', slug: '', claim: '', traces: noTraces }).held).toBe(true);
  });

  test('slug sans casse, BOM toléré', () => {
    const raw = `﻿${JSON.stringify([{ slug: 'ACME', status: 'APPLYING', applying: { run: 'L1' } }])}`;
    expect(ownership({ board: raw, boardPath: '/b.json', slug: 'acme', claim: 'L1', traces: noTraces }).held).toBe(true);
  });

  test('porte les traces d’un submit déjà démarré (le verdict ne dit alors jamais « pas envoyé »)', () => {
    const out = check({ status: 'VALIDATED' }, 'L1', { ...noTraces, armed: '{"at":"t"}' });
    expect(out.held).toBe(false);
    expect(out.evidence.join(' ')).toContain('armed.json');
  });

  test('holds : la règle seule', () => {
    expect(holds({ status: 'APPLYING', applying: { run: 'L1' } }, 'L1')).toBe(true);
    expect(holds({ status: 'APPLYING', applying: { run: 'L1' } }, '')).toBe(false);
    expect(holds({ status: 'APPLY_FAILED', harness: { run: 'L1', stage: 'listener' } }, 'L1')).toBe(false);
    expect(holds({ status: 'APPLY_UNPROVEN', harness: { run: 'L1', stage: 'listener' } }, 'L1')).toBe(false);
  });
});

describe('own.ts lancé pour de vrai', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function run(entry: Record<string, unknown>, claim: string, armed = false): Record<string, unknown> {
    const root = mkdtempSync(join(tmpdir(), 'own-test-'));
    dirs.push(root);
    const artifacts = join(root, 'artifacts');
    mkdirSync(join(artifacts, 'submission'), { recursive: true });
    if (armed) writeFileSync(join(artifacts, 'submission', 'armed.json'), '{"at":"t"}');
    const boardPath = join(root, 'pending_gold_jobs.json');
    writeFileSync(boardPath, board(entry));
    const proc = Bun.spawnSync(['bun', join(import.meta.dir, 'own.ts')], {
      env: { ...process.env, ARTIFACTS_DIR: artifacts, INPUTS_CLAIM_BOARD: boardPath, INPUTS_CLAIM_SLUG: 'acme', INPUTS_CLAIM_RUN: claim, INPUTS_OUT_DIR: 'submission' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(proc.exitCode).toBe(0);
    return JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
  }

  test('tenue : held true ; remise en file : held false', () => {
    expect(run({ status: 'APPLYING', applying: { run: 'L1' } }, 'L1')).toMatchObject({ held: true, evidence: [] });
    expect(run({ status: 'VALIDATED' }, 'L1')).toMatchObject({ held: false });
  });

  test('armed.json présent : les traces sont portées', () => {
    expect((run({ status: 'VALIDATED' }, 'L1', true).evidence as string[]).length).toBe(1);
  });
});
