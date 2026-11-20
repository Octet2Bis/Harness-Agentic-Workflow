import { describe, expect, test } from 'bun:test';
import { holds as blockHolds } from '../../blocks/apply-submit/scripts/own.ts';
import { CV_REVISION, LETTER_REVISION, MAX_ATTEMPTS, type Outcome, type PendingJob, REVISION_BRIEF_MAX, REVISION_HEADER, applicationFileNames, attemptsOf, claimedFrom, clickEvidence, deriveKeywords, findJob, holdsClaim, letterNote, mayRecord, offerForBlock, outcome, pickCv, pickVerdict, recordStatus, reviewerLine, revisionBrief, revisionTarget, usableFindings, postingText, postingUrl, visibleText } from './career.ts';

const jobs = [
  { id: 'LI-1', slug: 'station_f', company: 'STATION F', title: 'SALES OPERATIONS &amp; GTM ENGINEER', link: 'https://fr.linkedin.com/jobs/view/1', skills_required: 'revenue operations coordinator', hook_angle: 'Tracking GTM, Automatisation n8n et Acquisition B2B/B2C', status: 'VALIDATED' },
];

describe('career rules', () => {
  test('trouve une offre par slug, insensible à la casse', () => {
    expect(findJob(jobs, 'Station_F')?.id).toBe('LI-1');
    expect(findJob(jobs, 'nope')).toBeNull();
    expect(findJob({}, 'x')).toBeNull();
  });
  test('dérive des mots-clés dédoublonnés et décodés', () => {
    // L'angle du jury (hook_angle, en français) n'est pas un mot-clé : il n'est pas exigé mot à mot dans le CV.
    expect(deriveKeywords(jobs[0])).toEqual(['revenue operations coordinator']);
    expect(deriveKeywords({ skills_required: 'n8n, GTM', matched_skills: 'GTM, SQL', hook_angle: '' })).toEqual(['n8n', 'GTM', 'SQL']);
  });
  test('avec l’annonce, ne garde que les mots-clés qui y figurent (la requête du radar n’en est pas un)', () => {
    const posting = 'Sales Operations & Enablement Specialist. You will own HubSpot, build revenue operations dashboards and run sales enablement sessions.';
    // « chargé de revops » : requête de la taxonomie (français) posée par le radar LinkedIn, absente d'une annonce anglaise.
    expect(deriveKeywords({ skills_required: 'chargé de revops' }, posting)).toEqual([]);
    expect(deriveKeywords({ skills_required: 'HubSpot, revenue operations, Salesforce', matched_skills: 'sales enablement' }, posting)).toEqual(['HubSpot', 'revenue operations', 'sales enablement']);
    // Sans annonce : comportement inchangé.
    expect(deriveKeywords({ skills_required: 'chargé de revops' })).toEqual(['chargé de revops']);
    // Mots délimités : « sales ops » ne couvre pas « salesops », « C++ » reste cherché tel quel.
    expect(deriveKeywords({ skills_required: 'sales ops' }, 'salesops team')).toEqual([]);
    expect(deriveKeywords({ skills_required: 'C++' }, 'we code in c++ daily')).toEqual(['C++']);
  });
  test('prépare l’offre pour le bloc avec l’annonce lue', () => {
    const offer = offerForBlock(jobs[0], 'full text', ['a', 'b']);
    expect(offer.title).toBe('SALES OPERATIONS & GTM ENGINEER');
    expect(offer.keywords).toBe('a, b');
    expect(offer.description_full).toBe('full text');
  });
  test('extrait le texte visible d’une page', () => {
    expect(visibleText('<html><style>x{}</style><body><h1>Job</h1><script>1</script><p>We need &amp; want <b>GTM</b></p></body></html>')).toBe('Job\nWe need & want GTM');
  });
  test('nomme les fichiers comme le bot Telegram les attend', () => {
    expect(applicationFileNames('Antoine Lecerf', 'station_f')).toEqual({
      cv: 'CV_Antoine_Lecerf_station_f.md',
      pdf: 'CV_Antoine_Lecerf_station_f.pdf',
      pitch: 'Message_Accroche_station_f.md',
      letter: 'Lettre_Antoine_Lecerf_station_f.md',
      letterPdf: 'Lettre_Antoine_Lecerf_station_f.pdf',
      contact: 'interlocuteur_cible.json',
      receipt: 'submission_receipt.json',
    });
  });
  test('dérive l’issue et le statut à écrire', () => {
    const ok = { ok: true, summary: 's' };
    expect(outcome({ load: ok, tailor: ok, render: ok, route: ok, submit: { ok: true, summary: 'sent', submitted: true } })).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED' });
    expect(outcome({ load: ok, tailor: { ok: false, summary: 'B+' }, render: null, route: null, submit: null })).toMatchObject({ stage: 'tailor', status: 'VALIDATED' });
    expect(outcome({ load: ok, tailor: ok, render: { ok: false, summary: 'no engine' }, route: null, submit: null })).toMatchObject({ stage: 'render', status: 'TAILORED' });
    // cv-only (bouton « CV sur mesure ») : CV rendu → TAILORED, done ; un rendu raté reste un échec de rendu.
    expect(outcome({ load: ok, tailor: ok, render: ok, route: null, submit: null }, [], true)).toMatchObject({ ok: true, stage: 'done', status: 'TAILORED' });
    expect(outcome({ load: ok, tailor: ok, render: { ok: false, summary: 'no engine' }, route: null, submit: null }, [], true)).toMatchObject({ ok: false, stage: 'render' });
    expect(outcome({ load: ok, tailor: { ok: false, summary: 'B+' }, render: null, route: null, submit: null }, [], true)).toMatchObject({ stage: 'tailor', status: 'VALIDATED' });
    expect(outcome({ load: ok, tailor: ok, render: ok, route: ok, submit: { ok: false, summary: 'spinner', submitted: true } })).toMatchObject({ stage: 'submit', status: 'APPLY_UNPROVEN' });
    expect(outcome({ load: ok, tailor: ok, render: ok, route: ok, submit: { ok: false, summary: 'refused', submitted: false } })).toMatchObject({ status: 'APPLY_FAILED' });
    expect(outcome({ load: null, tailor: null, render: null, route: null, submit: null })).toMatchObject({ stage: 'load', status: 'VALIDATED' });
  });
});

describe('career outcome : blocs unconverged, sans verdict, et jamais « envoyé » sans submitted: true', () => {
  const ok = { ok: true, summary: 's' };
  const tailored = { ok: true, status: 'verified', summary: 'CV ok' };
  const upToSubmit = { load: ok, tailor: tailored, render: ok, route: ok };

  test('cv-tailor unconverged : APPLY_FAILED au stage tailor, hors de la file (pas VALIDATED)', () => {
    const result = outcome({
      load: ok,
      tailor: { ok: false, status: 'unconverged', summary: 'Checks still failing after 3 round(s); the judge did not run. angle growth ops', problems: ['CV covers 1/3 offer keywords', 'figure "+40%" not in profile'] },
      render: null,
      route: null,
      submit: null,
    });
    expect(result).toEqual({
      ok: false,
      stage: 'tailor',
      status: 'APPLY_FAILED',
      summary:
        'CV did not converge: Checks still failing after 3 round(s); the judge did not run. angle growth ops Nothing was rendered or sent. Last problems: CV covers 1/3 offer keywords; figure "+40%" not in profile.',
    });
  });

  test('cv-tailor rejected (Reviewer) : VALIDATED, comme avant', () => {
    expect(outcome({ load: ok, tailor: { ok: false, status: 'rejected', summary: 'B+' }, render: null, route: null, submit: null })).toEqual({
      ok: false,
      stage: 'tailor',
      status: 'VALIDATED',
      summary: 'CV rejected: B+',
    });
  });

  test('cv-tailor sans verdict (un nœud a échoué) : VALIDATED, jamais « pas convergé »', () => {
    const result = outcome({ load: ok, tailor: null, render: null, route: null, submit: null });
    expect(result).toMatchObject({ ok: false, stage: 'tailor', status: 'VALIDATED' });
    expect(result.summary).toContain('cv-tailor returned no verdict');
    expect(result.summary).not.toContain('converge');
  });

  test('apply-submit unconverged (submitted: false) : TAILORED au stage submit, rien d’envoyé', () => {
    const result = outcome({
      ...upToSubmit,
      submit: {
        ok: false,
        status: 'unconverged',
        submitted: false,
        summary: 'Checks still failing after 2 round(s); the judge did not run. The form was not sent and no go was asked. stopped by a CAPTCHA',
        problems: ['blocked before the form could be filled: CAPTCHA on the apply page'],
      },
    });
    expect(result).toEqual({
      ok: false,
      stage: 'submit',
      status: 'TAILORED',
      summary:
        'Form did not converge: Checks still failing after 2 round(s); the judge did not run. The form was not sent and no go was asked. stopped by a CAPTCHA Last problems: blocked before the form could be filled: CAPTCHA on the apply page.',
    });
  });

  test('apply-submit sans verdict et sans trace de clic : TAILORED, le résumé dit de vérifier avant tout renvoi', () => {
    for (const result of [outcome({ ...upToSubmit, submit: null }), outcome({ ...upToSubmit, submit: null }, [])]) {
      expect(result).toMatchObject({ ok: false, stage: 'submit', status: 'TAILORED' });
      expect(result.summary).toContain('no verdict');
      expect(result.summary).toContain('mailbox');
    }
  });

  test('apply-submit sans verdict mais avec trace de clic : APPLY_UNPROVEN, jamais « prêt, pas envoyé »', () => {
    const result = outcome({ ...upToSubmit, submit: null }, ['receipt.json says submitted: true']);
    expect(result).toMatchObject({ ok: false, stage: 'submit', status: 'APPLY_UNPROVEN' });
    expect(result.summary).toContain('receipt.json says submitted: true');
    expect(result.summary).toContain('mailbox');
  });

  test('les traces ne comptent que pour un apply-submit sans verdict', () => {
    const evidence = ['receipt.json says submitted: true'];
    expect(outcome({ ...upToSubmit, submit: { ok: false, status: 'refused', submitted: false, summary: 'x' } }, evidence).status).toBe('TAILORED');
    expect(outcome({ ...upToSubmit, route: { ok: false, summary: 'no page' }, submit: null }, evidence)).toMatchObject({ stage: 'route', status: 'TAILORED' });
  });

  test('refus au go : TAILORED (le listener ne la reprend jamais), résumé du bloc tel quel, rien d’envoyé', () => {
    const result = outcome({
      ...upToSubmit,
      submit: { ok: false, status: 'refused', submitted: false, summary: 'Refused at the go: nothing was sent. salary answer too low', problems: [] },
    });
    expect(result).toEqual({ ok: false, stage: 'submit', status: 'TAILORED', summary: 'Refused at the go: nothing was sent. salary answer too low' });
  });

  test('envoi signalé par prefill (submitted: true, unproven) : APPLY_UNPROVEN', () => {
    expect(outcome({ ...upToSubmit, submit: { ok: false, status: 'unproven', submitted: true, summary: 'prefill says sent' } })).toMatchObject({ stage: 'submit', status: 'APPLY_UNPROVEN' });
  });

  test('un envoi possible (submitted: true) n’est jamais lu comme « non envoyé », même étiqueté unconverged', () => {
    expect(outcome({ ...upToSubmit, submit: { ok: false, status: 'unconverged', submitted: true, summary: 'x' } })).toMatchObject({ stage: 'submit', status: 'APPLY_UNPROVEN' });
  });

  test('APPLIED ou APPLY_UNPROVEN seulement si apply-submit rend submitted: true', () => {
    const verdicts = [
      null,
      { ok: true, status: 'verified', summary: 'x' },
      { ok: true, status: 'verified', submitted: false, summary: 'x' },
      { ok: false, status: 'rejected', submitted: false, summary: 'x' },
      { ok: false, status: 'unproven', submitted: false, summary: 'x' },
      { ok: false, status: 'unconverged', submitted: false, summary: 'x' },
      { ok: false, status: 'unconverged', summary: 'x' },
      { ok: false, status: 'refused', submitted: false, summary: 'x' },
    ];
    for (const submit of verdicts) {
      const result = outcome({ ...upToSubmit, submit });
      expect(['APPLIED', 'APPLY_UNPROVEN']).not.toContain(result.status);
      expect(result.ok).toBe(false);
    }
    expect(outcome({ ...upToSubmit, submit: { ok: true, status: 'verified', submitted: true, summary: 'sent' } })).toEqual({ ok: true, stage: 'done', status: 'APPLIED', summary: 'sent' });
  });

  test('ok sans submitted: true (contrat rompu) : APPLY_FAILED, jamais APPLIED', () => {
    const result = outcome({ ...upToSubmit, submit: { ok: true, status: 'verified', summary: 'looks fine' } });
    expect(result).toMatchObject({ ok: false, stage: 'submit', status: 'APPLY_FAILED' });
    expect(result.summary).toStartWith('apply-submit returned ok without submitted: true');
  });
});

describe('clickEvidence : les traces d’un clic dans submission/, quand apply-submit n’a rien rendu', () => {
  const none = { decision: null, prefill: null, receipt: null, receiptScreenshot: false };

  test('rien dans submission/ : aucune trace', () => {
    expect(clickEvidence(none)).toEqual([]);
  });
  test('decide n’a pas autorisé le clic (refus, formulaire rouge) : aucune trace', () => {
    expect(clickEvidence({ ...none, decision: JSON.stringify({ proceed: false, path: 'rejected', text: 'no' }), prefill: JSON.stringify({ submitted: false }) })).toEqual([]);
  });
  test('clic autorisé par decide : trace (une erreur après le go peut suivre un clic réel)', () => {
    expect(clickEvidence({ ...none, decision: JSON.stringify({ proceed: true, path: 'auto', text: '' }) })).toEqual(['decision.json says the submit step was cleared to click (path auto)']);
  });
  test('reçu écrit par submit : submitted true, ambigu, ou clic daté', () => {
    expect(clickEvidence({ ...none, receipt: JSON.stringify({ submitted: true }) })).toEqual(['receipt.json says submitted: true']);
    expect(clickEvidence({ ...none, receipt: JSON.stringify({ error: 'x' }) })).toEqual(['receipt.json exists without submitted: false']);
    expect(clickEvidence({ ...none, receipt: JSON.stringify({ submitted: false, clicked_at: '2026-10-20T10:00:00Z' }) })).toEqual(['receipt.json records a click at 2026-10-20T10:00:00Z']);
    expect(clickEvidence({ ...none, receipt: '{not json' })).toEqual(['receipt.json exists but is unreadable']);
  });
  test('reçu « form lost before submit » (submitted: false, sans clic) : aucune trace', () => {
    expect(clickEvidence({ ...none, receipt: JSON.stringify({ submitted: false, clicked_at: '', error: 'form lost before submit' }) })).toEqual([]);
  });
  test('click.json (écrit par l’agent juste avant le clic) : trace, même seul, même illisible', () => {
    expect(clickEvidence({ ...none, click: JSON.stringify({ at: '2026-10-20T10:00:03Z', control: 'Submit application' }) })).toEqual(['click.json says the submit agent was about to click at 2026-10-20T10:00:03Z']);
    expect(clickEvidence({ ...none, click: '{oops' })).toEqual(['click.json says the submit agent was about to click']);
  });
  test('armed.json (écrit par arm juste avant que submit démarre) : trace', () => {
    expect(clickEvidence({ ...none, armed: JSON.stringify({ at: '2026-10-20T10:00:00Z', run: 'r' }) })).toEqual(['armed.json says the submit step started at 2026-10-20T10:00:00Z']);
  });
  test('click.json fait écrire APPLY_UNPROVEN au lieu de TAILORED quand apply-submit n’a rien rendu', () => {
    const ok = { ok: true, summary: 's' };
    const upToSubmit = { load: ok, tailor: { ok: true, status: 'verified', summary: 'CV ok' }, render: ok, route: ok, submit: null };
    // Sans click.json : aucune trace (le go a été refusé, decision.json dit proceed: false) → TAILORED.
    const refusedDecision = JSON.stringify({ proceed: false, path: 'rejected', text: '' });
    expect(outcome(upToSubmit, clickEvidence({ ...none, decision: refusedDecision })).status).toBe('TAILORED');
    // Avec click.json (l'agent allait cliquer) : APPLY_UNPROVEN, quoi que dise decision.json.
    const withClick = outcome(upToSubmit, clickEvidence({ ...none, decision: refusedDecision, click: JSON.stringify({ at: '2026-10-20T10:00:03Z' }) }));
    expect(withClick.status).toBe('APPLY_UNPROVEN');
    expect(withClick.summary).toContain('click.json');
  });
  test('capture après clic, ou prefill qui dit avoir envoyé : trace', () => {
    expect(clickEvidence({ ...none, receiptScreenshot: true })).toEqual(['receipt.png (taken after the click) exists']);
    expect(clickEvidence({ ...none, prefill: JSON.stringify({ submitted: true }) })).toEqual(['prefill.json says the form was already submitted during prefill']);
    expect(clickEvidence({ ...none, prefill: '{broken' })).toEqual([]);
  });
});

describe('recordStatus : le statut de CE run, le compteur de passages porté et borné', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const job = (over: Partial<PendingJob> = {}): PendingJob => ({ slug: 'acme', company: 'Acme', title: 't', link: '', status: 'APPLYING', validated_at: '2026-10-20T08:00:00Z', ...over });
  const retry: Outcome = { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected: B+' };

  test('premier passage : compte 1, attaché au validated_at, champs du bot intacts', () => {
    const before = job({ applying: { run: 'l1', at: '2026-10-20T11:00:00Z' } });
    const written = recordStatus(before, retry, 'run-1', now);
    expect(written).toEqual({
      status: 'VALIDATED',
      summary: 'CV rejected: B+',
      harness: { run: 'run-1', stage: 'tailor', at: '2026-10-20T12:00:00.000Z', summary: 'CV rejected: B+', attempts: 1, attempts_for: '2026-10-20T08:00:00Z' },
    });
    expect(before.validated_at).toBe('2026-10-20T08:00:00Z');
  });

  test(`au ${MAX_ATTEMPTS}e passage qui remettrait l’offre en file : APPLY_FAILED avec un résumé`, () => {
    const second = recordStatus(job({ harness: { attempts: 1, attempts_for: '2026-10-20T08:00:00Z' } }), retry, 'run-2', now);
    expect(second).toMatchObject({ status: 'VALIDATED', harness: { attempts: 2 } });
    const third = recordStatus(job({ harness: { attempts: 2, attempts_for: '2026-10-20T08:00:00Z' } }), retry, 'run-3', now);
    expect(third.status).toBe('APPLY_FAILED');
    expect(third.harness.attempts).toBe(3);
    expect(third.summary).toStartWith('Stopped after 3 attempts');
    expect(third.summary).toContain('CV rejected: B+');
    expect(third.harness.summary).toBe(third.summary);
  });

  test('une issue finale n’est pas touchée par le plafond, mais compte', () => {
    const sent: Outcome = { ok: true, stage: 'done', status: 'APPLIED', summary: 'sent' };
    expect(recordStatus(job({ harness: { attempts: 5, attempts_for: '2026-10-20T08:00:00Z' } }), sent, 'r', now)).toMatchObject({ status: 'APPLIED', harness: { attempts: 6 } });
  });

  test('un nouveau /valider (autre validated_at) remet le compteur à zéro', () => {
    const revalidated = job({ validated_at: '2026-10-21T08:00:00Z', harness: { attempts: 3, attempts_for: '2026-10-20T08:00:00Z' } });
    expect(attemptsOf(revalidated)).toBe(0);
    expect(recordStatus(revalidated, retry, 'r', now)).toMatchObject({ status: 'VALIDATED', harness: { attempts: 1, attempts_for: '2026-10-21T08:00:00Z' } });
  });

  test('compteur absent ou illisible : zéro', () => {
    expect(attemptsOf(job())).toBe(0);
    expect(attemptsOf(job({ harness: { attempts: 'x', attempts_for: '2026-10-20T08:00:00Z' } }))).toBe(0);
    expect(attemptsOf(job({ harness: null }))).toBe(0);
  });

  test('un envoi déjà fait s’écrit même si l’offre a été passée APPLY_FAILED entre-temps (prise périmée)', () => {
    const closedAsStale = job({ status: 'APPLY_FAILED', applying: undefined, harness: { stage: 'listener', note: 'The claim went stale', attempts: 0, attempts_for: '2026-10-20T08:00:00Z' } });
    const sent: Outcome = { ok: true, stage: 'done', status: 'APPLIED', summary: 'Application sent and confirmed.' };
    expect(recordStatus(closedAsStale, sent, 'apply-run', now)).toMatchObject({ status: 'APPLIED', harness: { run: 'apply-run', stage: 'done', summary: 'Application sent and confirmed.' } });
  });

  test('run lancé à la main sur une offre pas validée : une issue VALIDATED réécrit le statut d’avant la prise (applying.from), jamais VALIDATED', () => {
    // Le défaut : prise TAILORED (ou PENDING_VALIDATION, APPLY_FAILED), Reviewer sous A- → record
    // écrivait VALIDATED, qui survit au pull, et le listener postulait sans go sur une plateforme vérifiée.
    for (const from of ['TAILORED', 'PENDING_VALIDATION', 'APPLY_FAILED']) {
      const claimed = job({ applying: { run: 'A1', at: 'x', artifacts: '/a', from } });
      expect(claimedFrom(claimed, 'A1')).toBe(from);
      const written = recordStatus(claimed, retry, 'A1', now);
      expect(written.status).toBe(from);
      expect(written.summary).toStartWith('CV rejected: B+ Not re-queued:');
      expect(written.harness).toMatchObject({ run: 'A1', stage: 'tailor', from, attempts: 1 });
      // record rejoué : l'offre n'est plus APPLYING, harness.from garde le statut d'avant.
      expect(recordStatus({ ...claimed, status: written.status, applying: undefined, harness: written.harness }, retry, 'A1', now).status).toBe(from);
    }
    // Sans statut d'avant : APPLY_FAILED, pas VALIDATED.
    expect(recordStatus(job({ applying: { run: 'A1', from: '' } }), retry, 'A1', now).status).toBe('APPLY_FAILED');
  });

  test('run lancé à la main sur une offre VALIDATED, ou prise du listener : VALIDATED reste permis (et borné)', () => {
    expect(recordStatus(job({ applying: { run: 'A1', from: 'VALIDATED' } }), retry, 'A1', now)).toMatchObject({ status: 'VALIDATED', summary: 'CV rejected: B+' });
    expect(recordStatus(job({ applying: { run: 'L1' } }), retry, 'A1', now).status).toBe('VALIDATED');
    expect(claimedFrom(job({ applying: { run: 'L1' } }), 'A1')).toBeNull();
    // Une issue finale n'est pas touchée : seul VALIDATED est remplacé.
    expect(recordStatus(job({ applying: { run: 'A1', from: 'TAILORED' } }), { ok: true, stage: 'done', status: 'APPLIED', summary: 'sent' }, 'A1', now).status).toBe('APPLIED');
  });
});

describe('mayRecord : record n’écrit que sur l’offre de SA prise, et ne rétrograde jamais un envoi', () => {
  const job = (status: string, over: Partial<PendingJob> = {}): PendingJob => ({ slug: 'acme', company: 'Acme', title: 't', link: '', status, validated_at: '2026-10-20T08:00:00Z', ...over });
  const notSent = ['TAILORED', 'APPLY_FAILED', 'VALIDATED'];
  const sent = ['APPLIED', 'APPLY_UNPROVEN'];

  test('APPLYING par cette prise : toute issue s’écrit', () => {
    for (const status of [...notSent, ...sent]) {
      expect(mayRecord(job('APPLYING', { applying: { run: 'L1', at: 'x' } }), status, 'A1', 'L1').allowed).toBe(true);
    }
  });

  test('prise close par le listener (périmée, settle) : plus tenue ; un « pas envoyé » n’y touche pas, un envoi déjà fait s’y écrit', () => {
    const stale = job('APPLY_FAILED', { harness: { run: 'L1', stage: 'listener', at: 'x', note: 'The claim went stale' } });
    for (const status of notSent) expect(mayRecord(stale, status, 'A1', 'L1').allowed).toBe(false);
    for (const status of sent) expect(mayRecord(stale, status, 'A1', 'L1').allowed).toBe(true);
  });

  test('run à la main (run = prise = A1) : ce que le filet du listener a écrit pour lui n’est pas « ce même run », une validation plus récente reste', () => {
    // Le défaut : la règle des prises périmées note harness.run = la prise, ici A1 lui-même ;
    // /valider la remet en file (VALIDATED, harness du PC gardé au pull). Le TAILORED du vieux run
    // refusé ou superseded passait par sameRun et l'écrasait ; le bot refuse /valider sur TAILORED.
    const requeued = job('VALIDATED', { validated_at: '2026-10-20T11:00:00Z', harness: { run: 'A1', stage: 'listener', note: 'The claim went stale' } });
    for (const status of notSent) {
      const decision = mayRecord(requeued, status, 'A1', 'A1');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('newer validation');
    }
    const closed = job('APPLY_FAILED', { harness: { run: 'A1', stage: 'listener', note: 'The claim went stale' } });
    for (const status of notSent) expect(mayRecord(closed, status, 'A1', 'A1').allowed).toBe(false);
  });

  test('simulation : une offre APPLIED par un run plus récent reste APPLIED quand un run plus ancien est refusé au go', () => {
    // L1 prend l'offre, attend le go ; prise périmée → APPLY_FAILED ; /valider la remet en file ;
    // L2 la prend, envoie, APPLIED. Puis l'humain refuse enfin le go de L1 : son record dit TAILORED.
    let board = job('APPLIED', { harness: { run: 'A2', stage: 'done', at: '2026-10-20T12:00:00Z', attempts: 1, attempts_for: '2026-10-20T11:00:00Z' }, validated_at: '2026-10-20T11:00:00Z' });
    const refusal: Outcome = { ok: false, stage: 'submit', status: 'TAILORED', summary: 'Refused at the go: nothing was sent.' };
    const decision = mayRecord(board, refusal.status, 'A1', 'L1');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('never downgraded');
    if (decision.allowed) board = { ...board, ...recordStatus(board, refusal, 'A1', new Date()) };
    expect(board.status).toBe('APPLIED');
  });

  test('jamais rétrograder APPLIED ni APPLY_UNPROVEN, quel que soit le run', () => {
    for (const current of sent) {
      for (const status of notSent) {
        expect(mayRecord(job(current, { harness: { run: 'A2' } }), status, 'A1', 'L1').allowed).toBe(false);
        expect(mayRecord(job(current, { harness: { run: 'A2' } }), status, 'A1', '').allowed).toBe(false);
        expect(mayRecord(job(current, { harness: { run: 'A1' } }), status, 'A1', 'L1').allowed).toBe(false);
      }
    }
    expect(mayRecord(job('APPLIED', { harness: { run: 'A2' } }), 'APPLY_UNPROVEN', 'A1', 'L1').allowed).toBe(false);
    expect(mayRecord(job('APPLIED', { harness: { run: 'A2' } }), 'APPLIED', 'A1', 'L1').allowed).toBe(false);
    expect(mayRecord(job('APPLY_UNPROVEN', { harness: { run: 'A2' } }), 'APPLY_UNPROVEN', 'A1', 'L1').allowed).toBe(false);
    expect(mayRecord(job('APPLY_UNPROVEN', { harness: { run: 'A2' } }), 'APPLIED', 'A1', 'L1').allowed).toBe(true);
  });

  test('remise en file par une validation plus récente : un « pas envoyé » n’y touche pas, un envoi s’y écrit (sinon le listener postulerait deux fois)', () => {
    const requeued = job('VALIDATED', { validated_at: '2026-10-20T11:00:00Z', harness: { run: 'L1', stage: 'listener', note: 'The claim went stale' } });
    for (const status of notSent) {
      const decision = mayRecord(requeued, status, 'A1', 'L1');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('newer validation');
    }
    for (const status of sent) expect(mayRecord(requeued, status, 'A1', 'L1').allowed).toBe(true);
  });

  test('prise par un autre run (APPLYING) : rien ne s’écrit, envoi compris', () => {
    for (const status of [...notSent, ...sent]) {
      expect(mayRecord(job('APPLYING', { applying: { run: 'L2', at: 'x' } }), status, 'A1', 'L1').allowed).toBe(false);
      expect(mayRecord(job('APPLYING', { applying: { run: 'L2', at: 'x' } }), status, 'A1', '').allowed).toBe(false);
    }
  });

  test('APPLY_FAILED ou TAILORED d’une autre prise : un « pas envoyé » n’y touche pas, un envoi s’y écrit', () => {
    for (const current of ['APPLY_FAILED', 'TAILORED']) {
      const other = job(current, { harness: { run: 'L0', stage: 'listener' } });
      for (const status of notSent) expect(mayRecord(other, status, 'A1', 'L1').allowed).toBe(false);
      for (const status of sent) expect(mayRecord(other, status, 'A1', 'L1').allowed).toBe(true);
    }
  });

  test('sans prise (load n’a rien pris : offre d’un autre run, déjà envoyée, introuvable) : rien ne s’écrit', () => {
    for (const current of ['VALIDATED', 'PENDING_VALIDATION', 'APPLY_FAILED', 'TAILORED', 'APPLIED', 'APPLY_UNPROVEN']) {
      for (const status of [...notSent, ...sent]) expect(mayRecord(job(current), status, 'A1', '').allowed).toBe(false);
    }
    expect(mayRecord(job('APPLYING', { applying: { run: 'L1' } }), 'APPLIED', 'A1', '').reason).toContain('holds no claim');
  });

  test('lancé à la main, l’offre prise par load (applying.run = ce run) : record écrit comme pour une prise du listener', () => {
    for (const status of [...notSent, ...sent]) {
      expect(mayRecord(job('APPLYING', { applying: { run: 'A1', at: 'x', artifacts: '/a' } }), status, 'A1', 'A1').allowed).toBe(true);
    }
    // Prise de ce run close par la règle des prises périmées : un envoi déjà fait s'écrit quand même ; un « pas envoyé », non.
    expect(mayRecord(job('APPLY_FAILED', { harness: { run: 'A1', stage: 'listener' } }), 'APPLIED', 'A1', 'A1').allowed).toBe(true);
    expect(mayRecord(job('APPLY_FAILED', { harness: { run: 'A1', stage: 'listener' } }), 'TAILORED', 'A1', 'A1').allowed).toBe(false);
    // Le listener a pris l'offre pendant ce temps : rien.
    expect(mayRecord(job('APPLYING', { applying: { run: 'L2', at: 'x' } }), 'TAILORED', 'A1', 'A1').allowed).toBe(false);
  });

  test('record rejoué dans le même run : il réécrit sa propre issue sans recompter le passage', () => {
    const first = recordStatus(job('APPLYING', { applying: { run: 'L1' } }), { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected' }, 'A1', new Date('2026-10-20T12:00:00Z'));
    const afterFirst = job(first.status, { harness: first.harness });
    expect(mayRecord(afterFirst, 'VALIDATED', 'A1', 'L1').allowed).toBe(true);
    expect(recordStatus(afterFirst, { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected' }, 'A1', new Date()).harness.attempts).toBe(1);
    expect(recordStatus(afterFirst, { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected' }, 'A2', new Date()).harness.attempts).toBe(2);
  });
});

describe('holdsClaim : l’offre est-elle encore tenue par cette prise (load, record, la garde own d’apply-submit)', () => {
  const job = (status: string, over: Partial<PendingJob> = {}): PendingJob => ({ slug: 'acme', company: 'Acme', title: 't', link: '', status, ...over });
  const cases: [PendingJob, string, boolean][] = [
    [job('APPLYING', { applying: { run: 'L1', at: 'x' } }), 'L1', true],
    [job('APPLYING', { applying: { run: 'L1', at: 'x' } }), 'L2', false],
    [job('APPLYING', { applying: { run: 'L1', at: 'x' } }), '', false],
    [job('APPLYING'), 'L1', false],
    [job('APPLY_FAILED', { harness: { run: 'L1', stage: 'listener' } }), 'L1', false],
    [job('APPLY_FAILED', { harness: { run: 'L1', stage: 'tailor' } }), 'L1', false],
    [job('APPLY_FAILED', { harness: { run: 'L0', stage: 'listener' } }), 'L1', false],
    [job('APPLY_UNPROVEN', { harness: { run: 'L1', stage: 'listener' } }), 'L1', false],
    [job('VALIDATED', { harness: { run: 'L1', stage: 'listener' } }), 'L1', false],
    [job('APPLIED', { harness: { run: 'L1', stage: 'done' } }), 'L1', false],
    [job('TAILORED', { harness: { run: 'L1', stage: 'submit' } }), 'L1', false],
  ];

  test('APPLYING par elle ; rien d’autre (une prise close par le listener ne l’est plus)', () => {
    for (const [entry, claim, held] of cases) expect(holdsClaim(entry, claim)).toBe(held);
  });

  test('la copie de la règle dans la garde own d’apply-submit dit la même chose', () => {
    for (const [entry, claim, held] of cases) expect(blockHolds(entry, claim)).toBe(held);
  });
});

describe('outcome : la garde d’annonce de load (posting-guard.ts)', () => {
  test('annonce expirée : APPLY_FAILED au stage load, résumé de load tel quel, jamais remise en file', () => {
    const load = { ok: false, summary: 'Posting expired (posting guard): la page répond 410.', posting: 'expirée' };
    expect(outcome({ load, tailor: null, render: null, route: null, submit: null })).toEqual({ ok: false, stage: 'load', status: 'APPLY_FAILED', summary: load.summary });
  });
  test('load en échec pour une autre raison (sans verdict de garde, ou annonce non lue) : VALIDATED, comme avant', () => {
    for (const load of [{ ok: false, summary: 'not loaded' }, { ok: false, summary: 'not loaded', posting: 'non lue' }]) {
      expect(outcome({ load, tailor: null, render: null, route: null, submit: null })).toMatchObject({ stage: 'load', status: 'VALIDATED' });
    }
  });
  test('annonce suspecte : un signal, pas un arrêt ; le run continue comme une annonce saine', () => {
    const load = { ok: true, summary: 's', posting: 'suspecte' };
    const ok = { ok: true, summary: 's' };
    expect(outcome({ load, tailor: ok, render: ok, route: ok, submit: { ok: true, summary: 'sent', submitted: true } })).toMatchObject({ ok: true, stage: 'done', status: 'APPLIED' });
  });
});

describe('outcome : offre plus tenue juste avant le clic (apply-submit superseded)', () => {
  test('TAILORED au stage submit, rien d’envoyé, résumé du bloc tel quel', () => {
    const ok = { ok: true, summary: 's' };
    const out = outcome({ load: ok, tailor: { ok: true, summary: 'cv' }, render: ok, route: ok, submit: { ok: false, status: 'superseded', submitted: false, summary: 'Not sent: the offer was VALIDATED.' } });
    expect(out).toEqual({ ok: false, stage: 'submit', status: 'TAILORED', summary: 'Not sent: the offer was VALIDATED.' });
  });
});

describe('revisionBrief : le brief de la seconde ronde de cv-tailor après un refus du Reviewer', () => {
  const rejected = {
    ok: false,
    status: 'rejected',
    summary: 'Angle growth ops. Keywords covered: 80%. Reviewer: B — a selling claim is copied from the posting',
    problems: [],
    findings: [
      { severity: 'minor', text: 'the bullets of the first experience are not ordered by relevance' },
      { severity: 'blocking', text: '« pilotage du P&L » is copied from the posting and not backed by the profile' },
      { severity: 'minor', text: 'the pitch quotes a figure the CV does not carry' },
    ],
    deliverable: { type: 'archon_artifact', run_id: 'r', path: 'application/CV.md' },
  };
  test('remarques du candidat d’abord, puis l’en-tête, les constats numérotés (bloquants d’abord) avec leur gravité, puis où est la version précédente', () => {
    const brief = revisionBrief('Insister sur n8n, pas sur HubSpot.', rejected);
    expect(brief.ok).toBe(true);
    const lines = brief.remarks.split('\n');
    expect(lines[0]).toBe('Insister sur n8n, pas sur HubSpot.');
    expect(lines[2]).toBe(REVISION_HEADER);
    expect(brief.remarks).toContain('Overall verdict: B — a selling claim is copied from the posting');
    expect(brief.remarks).toContain('1. [blocking] « pilotage du P&L » is copied from the posting and not backed by the profile');
    expect(brief.remarks).toContain('2. [minor] the bullets of the first experience are not ordered by relevance');
    expect(brief.remarks).toContain('3. [minor] the pitch quotes a figure the CV does not carry');
    expect(brief.remarks.indexOf('Insister')).toBeLessThan(brief.remarks.indexOf(REVISION_HEADER));
    expect(brief.remarks.indexOf('[blocking]')).toBeLessThan(brief.remarks.indexOf('[minor]'));
    expect(brief.remarks.endsWith('still in `application/`: start from it, keep what was right, and rewrite the three files.')).toBe(true);
    expect(brief.summary).toContain('3/3');
    expect(brief.summary).toContain('1 blocking');
  });
  test('sans remarque du candidat : l’en-tête ouvre le brief ; le dossier de sortie est nommé', () => {
    const brief = revisionBrief('', rejected, 'dossier');
    expect(brief.remarks.startsWith(REVISION_HEADER)).toBe(true);
    expect(brief.remarks).toContain('still in `dossier/`');
  });
  test('rien à réviser : verdict absent, unconverged ou verified → ok: false, remarques d’origine rendues telles quelles', () => {
    expect(revisionBrief('x', null)).toEqual({ ok: false, remarks: 'x', summary: 'No revision round: cv-tailor returned no verdict.' });
    expect(revisionBrief('x', { ...rejected, status: 'unconverged' }).ok).toBe(false);
    expect(revisionBrief('x', { ...rejected, status: 'unconverged' }).summary).toContain('unconverged, not rejected');
    expect(revisionBrief('', { ...rejected, ok: true, status: 'verified' }).ok).toBe(false);
  });
  test('constats illisibles ignorés ; aucun constat : le brief renvoie au verdict global', () => {
    const brief = revisionBrief('', { ...rejected, findings: [{ severity: 'blocking', text: '  ' }, 'nope', null] as unknown as { severity: string; text: string }[] });
    expect(brief.ok).toBe(true);
    expect(brief.remarks).toContain('(no itemised finding: fix what the overall verdict names)');
    expect(brief.remarks).not.toContain('1. [');
    expect(usableFindings(undefined)).toEqual([]);
  });
  test('borné : les constats qui ne tiennent pas sont comptés, jamais un brief au-delà du plafond, et un constat bloquant passe avant', () => {
    const findings = Array.from({ length: 40 }, (_, i) => ({ severity: i === 39 ? 'blocking' : 'minor', text: `finding ${i} ${'x'.repeat(300)}` }));
    const brief = revisionBrief('r'.repeat(5000), { ...rejected, findings });
    expect(brief.ok).toBe(true);
    expect(brief.remarks.length).toBeLessThanOrEqual(REVISION_BRIEF_MAX);
    expect(brief.remarks).toContain('1. [blocking] finding 39');
    expect(brief.remarks).toMatch(/\(\d+ more finding\(s\) not shown\)/);
    expect(brief.remarks).toContain('[…]');
    expect(brief.remarks.endsWith('rewrite the three files.')).toBe(true);
    expect(brief.summary).toMatch(/Revision round: \d+\/40/);
  });
  test('un constat trop long est coupé, le reste du brief tient', () => {
    const brief = revisionBrief('', { ...rejected, findings: [{ severity: 'blocking', text: 'y'.repeat(2000) }] }, 'application', 1200);
    expect(brief.remarks.length).toBeLessThanOrEqual(1200);
    expect(brief.remarks).toContain('1. [blocking] yyyy');
    expect(brief.remarks).toContain('rewrite the three files.');
  });
  test('reviewerLine lit la fin « Reviewer: … » du résumé du verdict', () => {
    expect(reviewerLine('Checks ok. Reviewer: B+ — tasks, not results')).toBe('B+ — tasks, not results');
    expect(reviewerLine('Checks still failing after 3 round(s)')).toBe('');
  });
});

describe('pickCv : le verdict de CV qui compte après la ronde de révision', () => {
  const first = { ok: false, status: 'rejected', summary: 'first. Reviewer: B — copied claim', problems: [], findings: [{ severity: 'blocking', text: 'copied claim' }], deliverable: { type: 'archon_artifact', run_id: 'r', path: 'application/CV.md' } };
  const second = { ok: true, status: 'verified', summary: 'second. Reviewer: A — honest', problems: [], findings: [], deliverable: { type: 'archon_artifact', run_id: 'r', path: 'application/CV.md' } };
  test('seconde ronde rendue : son verdict, revised: true, même forme que le bloc', () => {
    expect(pickCv(first, second)).toEqual({ ok: true, status: 'verified', summary: 'second. Reviewer: A — honest', problems: [], findings: [], deliverable: second.deliverable, revised: true });
    const twice = pickCv(first, { ...first, summary: 'second refusal' });
    expect(twice.ok).toBe(false);
    expect(twice.status).toBe('rejected');
    expect(twice.revised).toBe(true);
    expect(twice.findings).toEqual([{ severity: 'blocking', text: 'copied claim' }]);
  });
  test('pas de seconde ronde (sautée) : le premier verdict, revised: false', () => {
    expect(pickCv(first, null)).toEqual({ ...first, revised: false });
    expect(pickCv({ ...first, status: 'unconverged', findings: undefined, deliverable: undefined }, null)).toMatchObject({ ok: false, status: 'unconverged', findings: [], deliverable: null, revised: false });
  });
  test('seconde ronde lancée mais sans verdict (un nœud a échoué) : le premier refus reste, et le résumé le dit', () => {
    const got = pickCv(first, null, true);
    expect(got.status).toBe('rejected');
    expect(got.revised).toBe(false);
    expect(got.summary).toContain('The revision round returned no verdict');
  });
  test('aucun verdict : status none, ok false, que outcome lit comme un bloc sans verdict', () => {
    const none = pickCv(null, null);
    expect(none).toMatchObject({ ok: false, status: 'none', deliverable: null, revised: false });
    expect(outcome({ load: { ok: true, summary: 'loaded' }, tailor: none, render: null, route: null, submit: null })).toMatchObject({ stage: 'tailor', status: 'VALIDATED' });
    expect(outcome({ load: { ok: true, summary: 'loaded' }, tailor: none, render: null, route: null, submit: null }).summary).toContain('returned no verdict');
  });
  test('un statut inconnu ne passe jamais pour un verdict ok', () => {
    expect(pickCv({ ok: true, status: 'weird', summary: 's' }, null)).toMatchObject({ ok: false, status: 'none' });
  });
});

describe('la ronde de révision de la lettre : mêmes règles, cible cover-letter', () => {
  const rejected = {
    ok: false,
    status: 'rejected',
    summary: 'Letter: 274 words (fr). Reviewer: B — generic tone, restates the posting',
    problems: [],
    findings: [
      { severity: 'minor', text: '« Je me permets de » opens the letter' },
      { severity: 'blocking', text: 'the second paragraph restates the posting instead of saying what the candidate did' },
    ],
    deliverable: { type: 'archon_artifact', run_id: 'r', path: 'application/letter.md' },
  };
  test('revisionTarget : cover-letter → la lettre, tout le reste (vide compris) → le CV', () => {
    expect(revisionTarget('cover-letter')).toBe(LETTER_REVISION);
    expect(revisionTarget(' cover-letter ')).toBe(LETTER_REVISION);
    expect(revisionTarget('')).toBe(CV_REVISION);
    expect(revisionTarget('cv-tailor')).toBe(CV_REVISION);
  });
  test('le brief nomme letter.md seulement (letter.html est mis en page par le contrôle), bloquants d’abord', () => {
    const brief = revisionBrief('Ton plus chaleureux.', rejected, 'application', REVISION_BRIEF_MAX, LETTER_REVISION);
    expect(brief.ok).toBe(true);
    expect(brief.remarks.startsWith('Ton plus chaleureux.')).toBe(true);
    expect(brief.remarks).toContain('1. [blocking] the second paragraph restates the posting');
    expect(brief.remarks).toContain('2. [minor] « Je me permets de » opens the letter');
    expect(brief.remarks.endsWith('The previous version (letter.md) is still in `application/`: start from it, keep what was right, and rewrite it.')).toBe(true);
    expect(brief.remarks).not.toContain('CV.md');
    expect(brief.remarks).not.toContain('letter.html');
  });
  test('rien à réviser : le bloc nommé dans le résumé est cover-letter', () => {
    expect(revisionBrief('x', null, 'application', REVISION_BRIEF_MAX, LETTER_REVISION).summary).toBe('No revision round: cover-letter returned no verdict.');
    expect(revisionBrief('x', { ...rejected, status: 'unconverged' }, 'application', REVISION_BRIEF_MAX, LETTER_REVISION).ok).toBe(false);
  });
  test('pickVerdict : la seconde lettre si elle a rendu un verdict, sinon la première ; aucun verdict → none, au nom du bloc', () => {
    const second = { ...rejected, ok: true, status: 'verified', summary: 'Reviewer: A- — direct and warm', findings: [] };
    expect(pickVerdict(rejected, second, true, 'cover-letter')).toMatchObject({ ok: true, status: 'verified', revised: true });
    expect(pickVerdict(rejected, { ...rejected, summary: 'again' }, true, 'cover-letter')).toMatchObject({ ok: false, status: 'rejected', revised: true });
    expect(pickVerdict(rejected, null, true, 'cover-letter').summary).toContain('The revision round returned no verdict');
    expect(pickVerdict(null, null, false, 'cover-letter')).toMatchObject({ ok: false, status: 'none', summary: 'cover-letter returned no verdict.' });
    expect(pickCv(rejected, second)).toEqual(pickVerdict(rejected, second, true, 'cv-tailor'));
  });
  test('letterNote : vérifiée, refusée après révision, ou rien quand la lettre est sautée', () => {
    expect(letterNote(null)).toBe('');
    expect(letterNote({ status: 'verified', revised: false })).toBe(' Letter: verified.');
    expect(letterNote({ status: 'verified', revised: true })).toContain('second version');
    expect(letterNote({ status: 'rejected', revised: true, summary: 'Reviewer: B+' })).toBe(' Letter rejected après révision (not attached): Reviewer: B+');
    expect(letterNote({ status: 'unconverged', summary: 's' })).toBe(' Letter unconverged (not attached): s');
  });
});

describe('outcome : après la ronde de révision (revised), même issue, résumé qui le dit', () => {
  const base = { load: { ok: true, summary: 'loaded' }, render: null, route: null, submit: null };
  test('second refus du Reviewer : VALIDATED au stage tailor, « après révision »', () => {
    const got = outcome({ ...base, tailor: { ok: false, status: 'rejected', summary: 'Reviewer: B — still copied', revised: true } });
    expect(got).toMatchObject({ ok: false, stage: 'tailor', status: 'VALIDATED' });
    expect(got.summary).toBe('CV rejected après révision: Reviewer: B — still copied');
  });
  test('seconde ronde pas convergée : APPLY_FAILED au stage tailor, « après révision »', () => {
    const got = outcome({ ...base, tailor: { ok: false, status: 'unconverged', summary: 'checks red', problems: ['p1'], revised: true } });
    expect(got).toMatchObject({ ok: false, stage: 'tailor', status: 'APPLY_FAILED' });
    expect(got.summary).toContain('CV did not converge après révision: checks red');
  });
  test('sans révision, les résumés ne changent pas', () => {
    expect(outcome({ ...base, tailor: { ok: false, status: 'rejected', summary: 's', revised: false } }).summary).toBe('CV rejected: s');
    expect(outcome({ ...base, tailor: { ok: false, status: 'rejected', summary: 's' } }).summary).toBe('CV rejected: s');
  });
});

describe('lecture d\'une annonce LinkedIn (Dana, 2026-10-24)', () => {
  test('postingUrl : le sous-domaine pays passe sur www, le reste ne bouge pas', () => {
    expect(postingUrl('https://hu.linkedin.com/jobs/view/digital-seo-at-dana-4456785650')).toBe('https://www.linkedin.com/jobs/view/digital-seo-at-dana-4456785650');
    expect(postingUrl('https://es.linkedin.com/jobs/view/1?trk=x')).toBe('https://www.linkedin.com/jobs/view/1?trk=x');
    expect(postingUrl('https://www.linkedin.com/jobs/view/1')).toBe('https://www.linkedin.com/jobs/view/1');
    expect(postingUrl('https://jobs.lever.co/acme/1')).toBe('https://jobs.lever.co/acme/1');
    expect(postingUrl('https://uk.linkedin.com.evil.test/jobs/view/1')).toBe('https://uk.linkedin.com.evil.test/jobs/view/1');
  });
  test('postingText : titre, description et critères seulement ; sans bloc, tout le texte visible', () => {
    const login = '<form><label>E-mail-cím vagy telefonszám</label><label>Jelszó</label></form>'.repeat(5);
    const html = `<html><head><title>Digital/SEO/SEA &amp; AI Specialist - EU | LinkedIn</title></head><body><div>Elfogadás Elutasítás</div>${login}
      <section class="description"><div class="description__text"><section class="show-more-less-html"><div class="show-more-less-html__markup relative">
      <strong>Job Purpose</strong> The Specialist is responsible for online channel activation.<ul><li>Develop and execute SEO strategies</li></ul>
      Mandatory: English</div><button class="show-more-less-html__button">Show more</button></section></div>
      <ul class="description__job-criteria-list"><li><h3>Seniority level</h3><span>Mid-Senior level</span></li></ul></section>
      <div>Hasonló állások Social Ads Manager</div></body></html>`;
    const text = postingText(html);
    expect(text).toContain('Digital/SEO/SEA & AI Specialist - EU');
    expect(text).toContain('Develop and execute SEO strategies');
    expect(text).toContain('Mandatory: English');
    expect(text).toContain('Mid-Senior level');
    expect(text).not.toContain('Jelszó');
    expect(text).not.toContain('Hasonló állások');
    expect(postingText('<p>Plain posting</p><p>Remote</p>')).toBe('Plain posting\nRemote');
  });
});

import { linkedinApplyUrl } from './career.ts';

describe('linkedinApplyUrl', () => {
  test('lit la page employeur dans la balise applyUrl de la page publique', () => {
    const html = '<section><code id="applyUrl" style="display: none"><!--"https://www.linkedin.com/jobs/view/externalApply/4456785650?url=https%3A%2F%2Fjobs%2Eexample%2Ecom%2Fdana%2Fjob%2F123%3Fsource%3Dlinkedin&amp;urlHash=AbCd"--></code></section>';
    expect(linkedinApplyUrl(html)).toBe('https://jobs.example.com/dana/job/123?source=linkedin');
  });
  test('rien sans la balise (candidature simplifiée), ni pour un lien qui reste sur LinkedIn ou non https', () => {
    expect(linkedinApplyUrl('<button>Easy Apply</button>')).toBe('');
    expect(linkedinApplyUrl('<code id="applyUrl"><!--"https://www.linkedin.com/jobs/view/externalApply/1?url=https%3A%2F%2Fwww.linkedin.com%2Fjobs%2F1"--></code>')).toBe('');
    expect(linkedinApplyUrl('<code id="applyUrl"><!--"https://www.linkedin.com/x?url=javascript%3Aalert(1)"--></code>')).toBe('');
  });
});

import { answersForOffer, salaryMinimum, sourceLabel } from './career.ts';

describe('réponses adaptées à l’offre', () => {
  test('salaryMinimum : le bas de la fourchette en euros, jamais une autre devise, un taux ni sous le plancher', () => {
    expect(salaryMinimum('38k€ - 50k€ (1-3 ans)')).toBe(38000);
    expect(salaryMinimum('40 000 - 55 000 €')).toBe(40000);
    expect(salaryMinimum('45000-60000')).toBe(45000);
    expect(salaryMinimum('36000 - 50000 USD (annual)')).toBeNull();
    expect(salaryMinimum('$30000 - $35000')).toBeNull();
    expect(salaryMinimum('34 - 43 USD')).toBeNull();
    expect(salaryMinimum('30k€ - 40k€')).toBeNull();
    expect(salaryMinimum('Selon profil')).toBeNull();
    expect(salaryMinimum({ min: 1 })).toBeNull();
  });
  test('sourceLabel : le nom du site, le site carrière pour un tableau d’employeurs', () => {
    expect(sourceLabel('LinkedIn (Live 24h)')).toBe('LinkedIn');
    expect(sourceLabel('Welcome to the Jungle (télétravail)')).toBe('Welcome to the Jungle');
    expect(sourceLabel('Tableaux employeurs (Greenhouse)')).toBe("Site carrière de l'entreprise");
    expect(sourceLabel(undefined)).toBe('');
  });
  test('answersForOffer : salaire et source remplacés, Variantes et Choix gardés, le reste intact', () => {
    const md = "# Réponses\n\n## Préavis\nUn mois.\n\n## Prétentions salariales\nVariantes : Salary expectations\n\n## Comment avez-vous connu l'offre ?\nVariantes : Source\nancienne\n\n## Ville\nParis\n";
    const out = answersForOffer(md, { salary_range: '42k€ - 50k€', source: 'LinkedIn (Live 24h)' });
    expect(out).toContain('## Prétentions salariales\nVariantes : Salary expectations\n42 000 € bruts annuels\n');
    expect(out).toContain("## Comment avez-vous connu l'offre ?\nVariantes : Source\nLinkedIn\n");
    expect(out).toContain('## Préavis\nUn mois.');
    expect(out).toContain('## Ville\nParis');
    expect(answersForOffer(md, {})).toContain('35 000 € bruts annuels');
  });
});
