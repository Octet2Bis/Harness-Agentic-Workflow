import { describe, expect, test } from 'bun:test';
import { decide } from './decide.ts';

describe('apply-submit decide', () => {
  test('aucun go requis : envoi automatique', () => {
    expect(decide(false, null)).toEqual({ proceed: true, path: 'auto', text: '' });
  });

  test('go requis et approuvé : envoi', () => {
    expect(decide(true, { decision: 'approve', text: 'ok' })).toEqual({ proceed: true, path: 'approved', text: 'ok' });
  });

  test('go requis et refusé, ou sans réponse : pas d\'envoi', () => {
    expect(decide(true, { decision: 'reject', text: 'fix the salary' })).toEqual({ proceed: false, path: 'rejected', text: 'fix the salary' });
    expect(decide(true, null)).toEqual({ proceed: false, path: 'rejected', text: 'no answer' });
  });

  test('cran sauté (formulaire jamais vert au plafond) : unconverged, jamais d\'envoi, même avec un go', () => {
    const decision = decide(null, null);
    expect(decision.proceed).toBe(false);
    expect(decision.path).toBe('unconverged');
    expect(decide(null, { decision: 'approve', text: '' }).proceed).toBe(false);
  });

  test('seul un false explicite dispense du go', () => {
    expect(decide('false', null).proceed).toBe(false);
    expect(decide(0, null).proceed).toBe(false);
    expect(decide('true', { decision: 'approve', text: '' }).path).toBe('approved');
  });

  test('envoi signalé par prefill : jamais de second clic, quels que soient le cran et le go', () => {
    expect(decide(false, null, true)).toEqual({ proceed: false, path: 'submitted_early', text: 'prefill reports the form was already submitted: nothing more is clicked' });
    expect(decide(true, { decision: 'approve', text: 'go' }, true).proceed).toBe(false);
    expect(decide(null, null, true).path).toBe('submitted_early');
  });

  test('seul un true explicite signale un envoi précoce', () => {
    expect(decide(false, null, 'true').path).toBe('auto');
    expect(decide(false, null, null).path).toBe('auto');
    expect(decide(false, null, 1).path).toBe('auto');
  });

  test('un refus est une décision typée, sans envoi : le verdict en fait « refused »', () => {
    expect(decide(true, { decision: 'reject', text: 'not this one' }, false)).toEqual({ proceed: false, path: 'rejected', text: 'not this one' });
  });
});
