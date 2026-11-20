import { describe, expect, test } from 'bun:test';
import { armSubmit, clickRecorded } from './click-trace.ts';

const none = { armed: null, click: null, receipt: null, receiptScreenshot: false };

describe('armSubmit : submit ne démarre qu’une fois par run', () => {
  test('premier passage, rien dans out_dir : la porte s’ouvre', () => {
    expect(armSubmit(none)).toEqual({ clear: true, reason: 'no earlier submit attempt in this run: submit may click once', evidence: [] });
  });

  test('armed.json (submit déjà démarré, puis le run a échoué et a été repris) : porte fermée, même sans click.json', () => {
    const arm = armSubmit({ ...none, armed: JSON.stringify({ at: '2026-10-20T10:00:00Z', run: 'r1' }) });
    expect(arm.clear).toBe(false);
    expect(arm.evidence).toEqual(['armed.json: the submit step already started in this run at 2026-10-20T10:00:00Z']);
    expect(arm.reason).toContain('nothing is clicked again');
  });

  test('chaque trace d’une tentative ferme la porte, lisible ou non', () => {
    expect(armSubmit({ ...none, armed: '{broken' }).clear).toBe(false);
    expect(armSubmit({ ...none, click: JSON.stringify({ at: '2026-10-20T10:00:01Z' }) }).evidence).toEqual(['click.json records a click attempt at 2026-10-20T10:00:01Z']);
    expect(armSubmit({ ...none, click: '' }).evidence).toEqual(['click.json exists (the submit agent was about to click)']);
    expect(armSubmit({ ...none, receipt: JSON.stringify({ submitted: false }) }).clear).toBe(false);
    expect(armSubmit({ ...none, receiptScreenshot: true }).clear).toBe(false);
  });

  test('toutes les traces sont citées', () => {
    const arm = armSubmit({ armed: '{}', click: '{}', receipt: '{}', receiptScreenshot: true });
    expect(arm.clear).toBe(false);
    expect(arm.evidence).toHaveLength(4);
  });
});

describe('clickRecorded : click.json, écrit juste avant le clic, compte comme un envoi possible', () => {
  test('absent : rien', () => {
    expect(clickRecorded(null)).toBeNull();
  });
  test('présent, daté ou illisible : une trace', () => {
    expect(clickRecorded(JSON.stringify({ at: '2026-10-20T10:00:01Z' }))).toBe('click.json records a click attempt at 2026-10-20T10:00:01Z');
    expect(clickRecorded('{not json')).toBe('click.json exists (the submit agent was about to click)');
    expect(clickRecorded(JSON.stringify({ at: '' }))).toBe('click.json exists (the submit agent was about to click)');
  });
});
