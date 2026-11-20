import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Outcome, type PendingJob, holdsClaim, mayRecord, recordStatus } from './career.ts';
import {
  acquireBoardLock,
  claimForRun,
  inFlight,
  isStale,
  lockPathOf,
  markApplying,
  markFailed,
  mergeBoards,
  mergeJob,
  orphanReason,
  pickValidated,
  readBoard,
  recordUnwritten,
  releaseBoardLock,
  releaseStale,
  retrying,
  settleClaim,
  submissionEvidence,
  updateBoard,
  withBoardLock,
  writeBoard,
} from './pending.ts';

const now = new Date('2026-10-18T15:00:00Z');
const jobs = [
  { slug: 'a', company: 'A', title: 't', link: '', status: 'PENDING_VALIDATION', index: 1 },
  { slug: 'b', company: 'B', title: 't', link: '', status: 'VALIDATED', validated_at: '2026-10-18T14:30:00Z', index: 2 },
  { slug: 'c', company: 'C', title: 't', link: '', status: 'VALIDATED', validated_at: '2026-10-18T14:00:00Z', index: 3 },
  { slug: 'd', company: 'D', title: 't', link: '', status: 'APPLYING', applying: { run: 'r1', at: '2026-10-18T10:00:00Z' }, index: 4 },
  { slug: 'e', company: 'E', title: 't', link: '', status: 'APPLYING', applying: { run: 'r2', at: '2026-10-18T14:50:00Z' }, index: 5 },
];

describe('pending board', () => {
  test('prend la plus ancienne offre VALIDATED', () => {
    expect(pickValidated(jobs)?.slug).toBe('c');
    expect(pickValidated([])).toBeNull();
    expect(pickValidated('x')).toBeNull();
  });
  test('sans validated_at, départage par index', () => {
    expect(pickValidated([{ slug: 'y', status: 'VALIDATED', index: 9 }, { slug: 'x', status: 'VALIDATED', index: 2 }])?.slug).toBe('x');
  });
  test('marque la prise et l’échec sans toucher aux autres', () => {
    const taken = markApplying(jobs as never, 'c', 'run-9', now);
    expect(taken[2]).toMatchObject({ status: 'APPLYING', applying: { run: 'run-9', at: '2026-10-18T15:00:00.000Z' } });
    expect(taken[1].status).toBe('VALIDATED');
    const failed = markFailed(taken, 'c', 'run-9', now, 'child run crashed');
    expect(failed[2]).toMatchObject({ status: 'APPLY_FAILED', harness: { summary: 'child run crashed' } });
  });
});

describe('pickValidated : une offre qui revient en file ne bloque pas les autres', () => {
  const v = (slug: string, validatedAt: string, attempts?: number, index = 0): PendingJob => ({
    slug,
    company: slug,
    title: 't',
    link: '',
    status: 'VALIDATED',
    validated_at: validatedAt,
    index,
    ...(attempts === undefined ? {} : { harness: { attempts, attempts_for: validatedAt } }),
  });

  test('la moins tentée d’abord, même plus récente', () => {
    const retried = v('old', '2026-10-18T08:00:00Z', 1);
    const fresh = v('new', '2026-10-18T14:00:00Z');
    expect(pickValidated([retried, fresh])?.slug).toBe('new');
  });
  test('à tentatives égales, la plus ancienne validation, puis index', () => {
    expect(pickValidated([v('b', '2026-10-18T10:00:00Z', 2), v('a', '2026-10-18T09:00:00Z', 2)])?.slug).toBe('a');
    expect(pickValidated([v('y', '2026-10-18T09:00:00Z', 1, 9), v('x', '2026-10-18T09:00:00Z', 1, 2)])?.slug).toBe('x');
  });
  test('un compteur d’une validation antérieure ne compte plus (nouveau /valider)', () => {
    const revalidated = { ...v('re', '2026-10-18T08:00:00Z'), harness: { attempts: 2, attempts_for: '2026-10-17T08:00:00Z' } };
    expect(pickValidated([v('other', '2026-10-18T09:00:00Z'), revalidated])?.slug).toBe('re');
  });
  test('une offre refusée par le Reviewer à chaque passage sort de la file au 3e, les autres passent', () => {
    const stuck = v('stuck', '2026-10-18T08:00:00Z');
    const next = v('next', '2026-10-18T09:00:00Z');
    let board: PendingJob[] = [stuck, next];
    const picked: string[] = [];
    const rejected: Outcome = { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected: B+' };
    const applied: Outcome = { ok: true, stage: 'done', status: 'APPLIED', summary: 'sent' };
    for (let turn = 0; turn < 5; turn++) {
      const job = pickValidated(board);
      if (job === null) break;
      picked.push(job.slug);
      board = markApplying(board, job.slug, `l${turn}`, now);
      board = board.map((entry) => {
        if (entry.slug !== job.slug) return entry;
        const written = recordStatus(entry, entry.slug === 'stuck' ? rejected : applied, `a${turn}`, now);
        return { ...entry, status: written.status, harness: written.harness };
      });
    }
    expect(picked).toEqual(['stuck', 'next', 'stuck', 'stuck']);
    expect(board.find((job) => job.slug === 'stuck')).toMatchObject({ status: 'APPLY_FAILED', validated_at: '2026-10-18T08:00:00Z', harness: { attempts: 3 } });
    expect(board.find((job) => job.slug === 'next')?.status).toBe('APPLIED');
  });
});

describe('releaseStale : une prise périmée est close, jamais remise en file', () => {
  test('APPLYING de plus de deux heures → APPLY_FAILED avec la note ; les récentes restent', () => {
    expect(isStale(jobs[3] as never, now)).toBe(true);
    expect(isStale(jobs[4] as never, now)).toBe(false);
    const { jobs: next, stale } = releaseStale(jobs as never, now);
    expect(stale).toEqual(['d']);
    expect(next[3]).toMatchObject({ status: 'APPLY_FAILED', applying: undefined, harness: { run: 'r1', stage: 'listener', at: '2026-10-18T15:00:00.000Z' } });
    const note = String((next[3].harness as { note: string }).note);
    expect(note).toContain('The claim went stale');
    expect(note).toContain('submission/');
    expect(note).toContain('mailbox');
    expect(note).toContain('/valider');
    expect(next[4].status).toBe('APPLYING');
  });
  test('aucune prise périmée ne redevient VALIDATED, et le listener ne la reprend pas', () => {
    const { jobs: next } = releaseStale([jobs[3]] as never, now);
    expect(next[0].status).toBe('APPLY_FAILED');
    expect(pickValidated(next)).toBeNull();
  });
  test('date illisible : périmée aussi', () => {
    expect(isStale({ slug: 'z', status: 'APPLYING', applying: { run: 'r' } } as never, now)).toBe(true);
  });
  test('le compteur de passages et les champs du bot sont portés', () => {
    const job = { slug: 'k', company: 'K', title: 't', link: '', status: 'APPLYING', validated_at: '2026-10-18T08:00:00Z', applying: { run: 'r', at: '2026-10-18T09:00:00Z' }, harness: { attempts: 2, attempts_for: '2026-10-18T08:00:00Z', summary: 'old' } };
    const { jobs: next } = releaseStale([job] as never, now);
    expect(next[0]).toMatchObject({ validated_at: '2026-10-18T08:00:00Z', harness: { attempts: 2, attempts_for: '2026-10-18T08:00:00Z' } });
    expect(markFailed([job] as never, 'k', 'l', now, 'x')[0]).toMatchObject({ harness: { attempts: 2, attempts_for: '2026-10-18T08:00:00Z', summary: 'x' } });
  });

  test('prise close après deux heures au go : plus tenue (son run ne clique plus) ; un envoi déjà fait s’écrit quand même', () => {
    const paused = { slug: 'p', company: 'P', title: 't', link: '', status: 'APPLYING', validated_at: '2026-10-18T08:00:00Z', applying: { run: 'listener-1', at: '2026-10-18T09:00:00Z' } };
    // Un autre réveil du listener clôt la prise périmée.
    const { jobs: afterStale } = releaseStale([paused] as never, now);
    expect(afterStale[0].status).toBe('APPLY_FAILED');
    expect(String((afterStale[0].harness as { note: string }).note)).toContain('A go must be answered within two hours');
    // Approuvé plus tard, ce run ne clique plus (own : holdsClaim) et son « pas envoyé » ne s'écrit pas.
    expect(holdsClaim(afterStale[0], 'listener-1')).toBe(false);
    expect(mayRecord(afterStale[0], 'TAILORED', 'apply-run-1', 'listener-1').allowed).toBe(false);
    // Un envoi fait avant la clôture (record arrivé tard) s'écrit quand même.
    const job = afterStale[0];
    expect(mayRecord(job, 'APPLIED', 'apply-run-1', 'listener-1').allowed).toBe(true);
    const written = recordStatus(job, { ok: true, stage: 'done', status: 'APPLIED', summary: 'Application sent and confirmed.' }, 'apply-run-1', new Date('2026-10-18T18:00:00Z'));
    expect(written.status).toBe('APPLIED');
    // Le filet du listener ne réécrit pas l'offre : elle n'est plus APPLYING.
    const recorded = [{ ...job, status: written.status, harness: written.harness }];
    expect(settleClaim(recorded, { path: 'work', slug: 'p', run: 'listener-1' }, now, 'x')).toMatchObject({ settled: false, status: 'APPLIED' });
  });
});

describe('settleClaim : le filet du listener quand le sous-run n’a rien écrit', () => {
  const claim = { path: 'work', slug: 'd', run: 'r1' };

  test('encore APPLYING par CE run : APPLY_FAILED avec la raison, compteur porté', () => {
    const board = [{ ...jobs[3], validated_at: 'v', harness: { attempts: 1, attempts_for: 'v' } }] as PendingJob[];
    const result = settleClaim(board, claim, now, orphanReason('r1'));
    expect(result.settled).toBe(true);
    expect(result.status).toBe('APPLY_FAILED');
    expect(result.jobs[0]).toMatchObject({ status: 'APPLY_FAILED', applying: undefined, harness: { run: 'r1', stage: 'listener', attempts: 1 } });
    expect(String((result.jobs[0].harness as { summary: string }).summary)).toContain('career-apply ended without recording a final status');
  });
  test('APPLYING par un AUTRE run : pas touchée', () => {
    expect(settleClaim(jobs as never, { ...claim, slug: 'e' }, now, 'x')).toMatchObject({ settled: false, status: 'APPLYING' });
  });
  test('déjà écrite par record (ou close, ou une reprise à la main) : pas touchée', () => {
    for (const status of ['APPLIED', 'APPLY_UNPROVEN', 'TAILORED', 'VALIDATED', 'APPLY_FAILED']) {
      const board = [{ ...jobs[3], status }] as PendingJob[];
      const result = settleClaim(board, claim, now, 'x');
      expect(result).toMatchObject({ settled: false, status });
      expect(result.jobs).toBe(board);
    }
  });
  test('rien de pris, offre absente, run inconnu : rien', () => {
    expect(settleClaim(jobs as never, null, now, 'x').settled).toBe(false);
    expect(settleClaim(jobs as never, { path: 'idle', slug: '', run: '' }, now, 'x').settled).toBe(false);
    expect(settleClaim(jobs as never, { ...claim, slug: 'nope' }, now, 'x').settled).toBe(false);
    expect(settleClaim(jobs as never, { ...claim, run: '' }, now, 'x').settled).toBe(false);
  });
});

describe('recordUnwritten : close écrit l’issue que record n’a pas pu écrire, sous la garde de settleClaim', () => {
  const claim = { path: 'work', slug: 'acme', run: 'L1' };
  const applying = (): PendingJob[] => [{ slug: 'acme', company: 'Acme', title: 't', link: '', status: 'APPLYING', validated_at: 'v', applying: { run: 'L1', at: '2026-10-18T14:00:00Z' } }];
  const sent = { ok: true, stage: 'done', status: 'APPLIED', status_written: false, summary: 'Application sent and confirmed. Status APPLIED (not written: pending_gold_jobs.json could not be written (EPERM: operation not permitted)). Not done: copy to applications/acme/CV.pdf failed (EBUSY).' };

  test('record n’a pas pu écrire, offre encore APPLYING par cette prise : le statut de record, pas APPLY_FAILED', () => {
    const result = recordUnwritten(applying(), claim, sent, now);
    expect(result).toMatchObject({ written: true, status: 'APPLIED' });
    expect(result.jobs[0]).toMatchObject({ status: 'APPLIED', applying: undefined, harness: { run: 'L1', stage: 'done', summary: 'Application sent and confirmed.', attempts: 1, attempts_for: 'v' } });
    expect(String((result.jobs[0].harness as { note: string }).note)).toContain('career-listener (close)');
    // settle, qui passe ensuite, ne touche plus l'offre.
    expect(settleClaim(result.jobs, claim, now, 'x')).toMatchObject({ settled: false, status: 'APPLIED' });
  });

  test('sans close, settle aurait écrit APPLY_FAILED sur une candidature envoyée (le défaut corrigé)', () => {
    expect(settleClaim(applying(), claim, now, 'x')).toMatchObject({ settled: true, status: 'APPLY_FAILED' });
  });

  test('record a écrit (status_written: true), ou l’offre n’est plus APPLYING par cette prise : rien', () => {
    expect(recordUnwritten(applying(), claim, { ...sent, status_written: true }, now).written).toBe(false);
    const other = [{ ...applying()[0], applying: { run: 'L2', at: 'x' } }];
    expect(recordUnwritten(other, claim, sent, now)).toMatchObject({ written: false, status: 'APPLYING' });
    const requeued = [{ ...applying()[0], status: 'VALIDATED', applying: undefined }];
    expect(recordUnwritten(requeued, claim, { ...sent, status: 'TAILORED' }, now)).toMatchObject({ written: false, status: 'VALIDATED' });
  });

  test('issue absente ou statut inconnu, prise vide : rien', () => {
    expect(recordUnwritten(applying(), claim, null, now).written).toBe(false);
    expect(recordUnwritten(applying(), claim, { ...sent, status: 'WHATEVER' }, now).written).toBe(false);
    expect(recordUnwritten(applying(), { path: 'idle', slug: '', run: '' }, sent, now).written).toBe(false);
  });

  test('le plafond de passages s’applique aussi ici', () => {
    const board = [{ ...applying()[0], harness: { attempts: 2, attempts_for: 'v' } }];
    const retry = { ok: false, stage: 'tailor', status: 'VALIDATED', status_written: false, summary: 'CV rejected: B+ Status VALIDATED (not written: x).' };
    expect(recordUnwritten(board, claim, retry, now)).toMatchObject({ written: true, status: 'APPLY_FAILED' });
  });
});

describe('mergeBoards : la synchronisation PC ⇄ VM fusionne offre par offre, jamais d’écrasement', () => {
  const offer = (status: string, over: Partial<PendingJob> = {}): PendingJob => ({ slug: 'acme', company: 'Acme', title: 't', link: '', status, validated_at: '2026-10-18T08:00:00Z', ...over });
  /** La synchronisation d'avant : la copie de la VM écrasait celle du PC. */
  const blindPull = (_pc: PendingJob[], vm: PendingJob[]): PendingJob[] => structuredClone(vm);
  /** record, tel que career-apply l'exécute (mayRecord puis recordStatus). */
  const record = (board: PendingJob[], status: Outcome['status'], run: string, claimRun: string, at: Date): PendingJob[] =>
    board.map((job) => {
      if (job.slug !== 'acme' || !mayRecord(job, status, run, claimRun).allowed) return job;
      const written = recordStatus(job, { ok: status === 'APPLIED', stage: status === 'APPLIED' ? 'done' : 'submit', status, summary: status }, run, at);
      return { ...job, status: written.status, harness: written.harness, applying: undefined };
    });

  for (const status of ['APPLIED', 'TAILORED'] as const) {
    test(`course entre deux tours : go donné entre deux tours, ${status} écrit sur le PC seulement, survit au pull, au délai de deux heures et au push`, () => {
      const t0 = new Date('2026-10-18T09:00:00Z');
      let vm: PendingJob[] = [offer('VALIDATED')];
      // Tour 1 : pull, claim (APPLYING), le sous-run attend le go ; push.
      let pc = mergeBoards([], vm).jobs;
      pc = markApplying(pc, 'acme', 'L1', t0);
      vm = mergeBoards(pc, vm).jobs;
      pc = mergeBoards(pc, vm).jobs;
      expect(vm[0].status).toBe('APPLYING');
      // Entre deux tours : l'humain répond au go, record écrit sur le PC seulement.
      pc = record(pc, status, 'A1', 'L1', new Date('2026-10-18T09:20:00Z'));
      expect(pc[0].status).toBe(status);
      // Avant le correctif : le pull suivant rendait APPLYING, et deux heures plus tard la règle
      // des prises périmées écrivait APPLY_FAILED, que /valider accepte.
      const before = releaseStale(blindPull(pc, vm), new Date('2026-10-18T11:30:00Z')).jobs;
      expect(before[0].status).toBe('APPLY_FAILED');
      // Tour 2 : pull fusionné, rien de périmé, rien à prendre ; push.
      pc = mergeBoards(pc, vm).jobs;
      expect(pc[0].status).toBe(status);
      const later = new Date('2026-10-18T11:30:00Z');
      const { jobs: afterStale, stale } = releaseStale(pc, later);
      expect(stale).toEqual([]);
      expect(pickValidated(afterStale)).toBeNull();
      vm = mergeBoards(afterStale, vm).jobs;
      expect(vm[0]).toMatchObject({ status, validated_at: '2026-10-18T08:00:00Z', harness: { run: 'A1' } });
      expect(vm[0].applying).toBeUndefined();
    });
  }

  test('deux annonces d’une même entreprise (même slug, ids différents) : la ligne du PC seule n’est plus jetée', () => {
    // 2026-11-03 : COROS EMEA (HIM-518335953), ajoutée par le radar du PC, disparaissait au pull suivant.
    const vm = [offer('PENDING_VALIDATION', { slug: 'coros', id: 'HIM-735490519', title: 'Sales Operations Specialist DEAT' })];
    const pc = [...structuredClone(vm), offer('PENDING_VALIDATION', { slug: 'coros', id: 'HIM-518335953', title: 'Sales & Trade Marketing Specialist EMEA' })];
    const merged = mergeBoards(pc, vm);
    expect(merged.jobs.map((j) => (j as { id?: string }).id)).toEqual(['HIM-735490519', 'HIM-518335953']);
    expect(merged.notes).toContain('coros (HIM-518335953): only on the PC, kept');
    // Le push suivant la renvoie à la VM, et un nouveau pull la garde.
    const vm2 = mergeBoards(merged.jobs, vm).jobs;
    expect(mergeBoards(merged.jobs, vm2).jobs).toHaveLength(2);
    // Chaque ligne fusionne avec la sienne : le statut de l’une ne passe pas à l’autre.
    const pcApplied = merged.jobs.map((j) => ((j as { id?: string }).id === 'HIM-518335953' ? { ...j, status: 'APPLIED' } : j));
    const out = mergeBoards(pcApplied, vm2).jobs;
    expect(out.find((j) => (j as { id?: string }).id === 'HIM-735490519')?.status).toBe('PENDING_VALIDATION');
    expect(out.find((j) => (j as { id?: string }).id === 'HIM-518335953')?.status).toBe('APPLIED');
  });

  test('sans id commun, la fusion retombe sur le slug (ligne ancienne sans id d’un côté)', () => {
    const merged = mergeBoards([offer('TAILORED', { harness: { run: 'A1', at: '2026-10-18T09:20:00Z' } })], [offer('PENDING_VALIDATION', { id: 'LI-1' })]).jobs;
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'LI-1', harness: { run: 'A1' } });
  });

  test('un /valider fait sur la VM entre le pull et le push n’est pas perdu au push', () => {
    const pc = [offer('APPLY_FAILED', { harness: { run: 'L0', stage: 'listener', at: '2026-10-18T07:00:00Z', attempts: 1, attempts_for: '2026-10-18T08:00:00Z' } })];
    const vmNow = [offer('VALIDATED', { validated_at: '2026-10-18T10:05:00Z', description: 'updated by the bot' })];
    const pushed = mergeBoards(pc, vmNow).jobs;
    expect(pushed[0]).toMatchObject({ status: 'VALIDATED', validated_at: '2026-10-18T10:05:00Z', description: 'updated by the bot', harness: { run: 'L0' } });
    expect(pickValidated(pushed)?.slug).toBe('acme');
  });

  test('un /valider sur une vue périmée (la VM montrait VALIDATED, le PC a APPLYING, APPLIED ou APPLY_UNPROVEN) reste sans effet', () => {
    for (const status of ['APPLYING', 'APPLIED', 'APPLY_UNPROVEN']) {
      const pc = [offer(status, { applying: status === 'APPLYING' ? { run: 'L1', at: '2026-10-18T09:00:00Z' } : undefined, harness: { run: 'A1', at: '2026-10-18T09:20:00Z' } })];
      const vm = [offer('VALIDATED', { validated_at: '2026-10-18T09:30:00Z' })];
      const merged = mergeBoards(pc, vm).jobs[0];
      expect(merged.status).toBe(status);
      expect(merged.validated_at).toBe('2026-10-18T09:30:00Z');
      expect(pickValidated([merged])).toBeNull();
    }
  });

  test('un statut que seul le bot écrit l’emporte sur un statut libre du PC, jamais sur un verrouillé', () => {
    expect(mergeJob(offer('VALIDATED'), offer('REJECTED')).job.status).toBe('REJECTED');
    expect(mergeJob(offer('TAILORED', { harness: { run: 'A1', at: 'x' } }), offer('PENDING_VALIDATION')).job).toMatchObject({ status: 'PENDING_VALIDATION', harness: { run: 'A1' } });
    expect(mergeJob(offer('APPLIED'), offer('PENDING_VALIDATION')).job.status).toBe('APPLIED');
    expect(mergeJob(offer('PENDING_VALIDATION'), offer('VALIDATED', { validated_at: '2026-10-18T10:00:00Z' })).job.status).toBe('VALIDATED');
  });

  test('le PC garde ses statuts du harness ; les champs du bot viennent de la VM', () => {
    const pc = [offer('TAILORED', { harness: { run: 'A1', at: '2026-10-18T09:20:00Z' }, description: 'old' })];
    const vm = [offer('APPLYING', { applying: { run: 'L1', at: '2026-10-18T09:00:00Z' }, description: 'new' })];
    expect(mergeBoards(pc, vm).jobs[0]).toMatchObject({ status: 'TAILORED', description: 'new', harness: { run: 'A1' } });
    expect(mergeBoards(pc, vm).jobs[0].applying).toBeUndefined();
  });

  test('une écriture du harness plus récente sur la VM (copie du PC restaurée) l’emporte : jamais une prise ou un envoi effacé', () => {
    const pc = [offer('VALIDATED')];
    const vm = [offer('APPLIED', { harness: { run: 'A1', at: '2026-10-18T09:20:00Z' } })];
    expect(mergeBoards(pc, vm).jobs[0].status).toBe('APPLIED');
    const vmClaim = [offer('APPLYING', { applying: { run: 'L1', at: '2026-10-18T09:00:00Z' } })];
    expect(mergeBoards(pc, vmClaim).jobs[0]).toMatchObject({ status: 'APPLYING', applying: { run: 'L1' } });
  });

  test('offres d’un seul côté : ajoutées depuis la VM, gardées depuis le PC ; ordre de la VM puis du PC', () => {
    const pc = [offer('APPLYING', { slug: 'pc-only' }), offer('TAILORED', { slug: 'both' })];
    const vm = [offer('PENDING_VALIDATION', { slug: 'vm-only' }), offer('VALIDATED', { slug: 'both' })];
    const { jobs, notes } = mergeBoards(pc, vm);
    expect(jobs.map((job) => [job.slug, job.status])).toEqual([['vm-only', 'PENDING_VALIDATION'], ['both', 'TAILORED'], ['pc-only', 'APPLYING']]);
    expect(notes).toContain('pc-only: only on the PC, kept');
    expect(notes.some((note) => note.startsWith('both: PC TAILORED / VM VALIDATED → TAILORED'))).toBe(true);
  });

  test('copies absentes ou illisibles : la fusion ne perd rien de l’autre côté', () => {
    expect(mergeBoards(null, [offer('VALIDATED')]).jobs).toHaveLength(1);
    expect(mergeBoards([offer('APPLIED')], 'x').jobs[0].status).toBe('APPLIED');
  });
});

// ── Round 3 : la prise d'un run lancé à la main, le filet qui n'écrit jamais « échoué » sur un envoi, le verrou ──

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('claimForRun : un run career-apply lancé à la main prend l’offre comme le listener', () => {
  const t = new Date('2026-10-20T10:00:00Z');
  const offer = (status: string, over: Partial<PendingJob> = {}): PendingJob => ({ slug: 'acme', company: 'Acme', title: 't', link: '', status, validated_at: 'v', ...over });
  const manual = { claimRun: '', run: 'A1', now: t, artifacts: '/runs/A1/artifacts' };

  test('à la main : APPLYING avec applying.run = ce run, sa date et son dossier d’artefacts ; le listener ne la prend plus', () => {
    for (const status of ['VALIDATED', 'TAILORED', 'APPLY_FAILED', 'PENDING_VALIDATION']) {
      const out = claimForRun([offer(status)], 'acme', manual);
      expect(out).toMatchObject({ ok: true, claim: 'A1', self: true });
      expect(out.jobs![0]).toMatchObject({ status: 'APPLYING', validated_at: 'v', applying: { run: 'A1', at: t.toISOString(), artifacts: '/runs/A1/artifacts' } });
      expect(pickValidated(out.jobs)).toBeNull();
      expect(holdsClaim(out.jobs![0]!, 'A1')).toBe(true);
    }
  });

  test('scénario A : à la main pendant que le listener tient l’offre, ou une fois envoyée : refus, rien d’écrit', () => {
    const cases: [PendingJob, string][] = [
      [offer('APPLYING', { applying: { run: 'L1', at: '2026-10-20T09:59:00Z' } }), 'APPLYING by another run (L1'],
      [offer('APPLIED', { harness: { run: 'A0' } }), 'APPLIED'],
      [offer('APPLY_UNPROVEN', { harness: { run: 'L0' } }), 'APPLY_UNPROVEN'],
    ];
    for (const [job, words] of cases) {
      const out = claimForRun([job], 'acme', manual);
      expect(out).toMatchObject({ ok: false, jobs: null, claim: '' });
      expect(out.summary).toContain(words);
    }
  });

  test('une candidature à la fois (un profil de navigateur) : refus tant qu’une autre offre est APPLYING récente ; une prise périmée ne compte pas', () => {
    const busy = [offer('VALIDATED'), { ...offer('APPLYING', { applying: { run: 'L1', at: '2026-10-20T09:30:00Z' } }), slug: 'other' }];
    expect(claimForRun(busy, 'acme', manual)).toMatchObject({ ok: false, jobs: null });
    expect(claimForRun(busy, 'acme', manual).summary).toContain('one at a time');
    const stale = [offer('VALIDATED'), { ...offer('APPLYING', { applying: { run: 'L1', at: '2026-10-20T07:00:00Z' } }), slug: 'other' }];
    expect(claimForRun(stale, 'acme', manual).ok).toBe(true);
  });

  test('load rejoué dans le même run : la prise est gardée ; sans id de run, refus ; offre absente, refus', () => {
    expect(claimForRun([offer('APPLYING', { applying: { run: 'A1', at: 'x' } })], 'acme', manual)).toMatchObject({ ok: true, claim: 'A1', self: true });
    expect(claimForRun([offer('VALIDATED')], 'acme', { ...manual, run: '' }).ok).toBe(false);
    expect(claimForRun([offer('VALIDATED')], 'nope', manual).ok).toBe(false);
  });

  test('par le listener : l’offre doit être encore tenue par sa prise ; APPLYING, elle reçoit le dossier d’artefacts du sous-run', () => {
    const viaListener = { claimRun: 'L1', run: 'A1', now: t, artifacts: '/runs/A1/artifacts' };
    const held = claimForRun([offer('APPLYING', { applying: { run: 'L1', at: 'x' } })], 'ACME', viaListener);
    expect(held).toMatchObject({ ok: true, claim: 'L1', self: false });
    expect(held.jobs![0]).toMatchObject({ status: 'APPLYING', applying: { run: 'L1', at: 'x', artifacts: '/runs/A1/artifacts' } });
    expect(claimForRun([offer('APPLYING', { applying: { run: 'L2', at: 'x' } })], 'acme', viaListener)).toMatchObject({ ok: false, jobs: null, claim: '' });
    expect(claimForRun([offer('VALIDATED')], 'acme', viaListener).ok).toBe(false);
  });

  test('à la main : applying.from note le statut d’avant la prise ; une issue VALIDATED le réécrit, jamais VALIDATED, et le pull ne la remet pas en file', () => {
    // Le défaut : prise TAILORED, Reviewer sous A- (issue VALIDATED) → record écrivait VALIDATED,
    // gardé au pull (écriture du harness plus récente), et le listener postulait sans go.
    const retry: Outcome = { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected: B+' };
    for (const from of ['TAILORED', 'APPLY_FAILED', 'PENDING_VALIDATION']) {
      const vm = [offer(from, { harness: { run: 'L0', stage: 'submit', at: '2026-10-19T10:00:00Z' } })];
      const claimed = claimForRun(structuredClone(vm), 'acme', manual).jobs!;
      expect(claimed[0]).toMatchObject({ status: 'APPLYING', applying: { run: 'A1', from } });
      // record : mayRecord puis recordStatus.
      const job = claimed[0]!;
      expect(mayRecord(job, 'VALIDATED', 'A1', 'A1').allowed).toBe(true);
      const written = recordStatus(job, retry, 'A1', new Date('2026-10-20T10:30:00Z'));
      expect(written.status).toBe(from);
      const pc = [{ ...job, status: written.status, harness: written.harness, applying: undefined }];
      const pulled = mergeBoards(pc, vm).jobs;
      expect(pulled[0]!.status).toBe(from);
      expect(pickValidated(pulled)).toBeNull();
      // settle depuis record.json (record n'a pas pu écrire) : même règle.
      const settled = settleClaim(claimed, { path: 'work', slug: 'acme', run: 'A1' }, t, 'x', { result: { ok: false, stage: 'tailor', status: 'VALIDATED', summary: 'CV rejected: B+' }, by: 'career-apply (settle, from record.json)' });
      expect(settled).toMatchObject({ settled: true, status: from, via: 'result' });
      expect(pickValidated(settled.jobs)).toBeNull();
    }
    // Prise VALIDATED : le retour en file reste permis.
    const fromValidated = claimForRun([offer('VALIDATED')], 'acme', manual).jobs![0]!;
    expect(fromValidated.applying).toMatchObject({ from: 'VALIDATED' });
    expect(recordStatus(fromValidated, retry, 'A1', t).status).toBe('VALIDATED');
  });

  test('le défaut corrigé : run à la main au go plus de deux heures, prise close, /valider sur la VM, vieux go approuvé sur le PC avant le pull : pas de clic, et la validation reste', () => {
    const t0 = new Date('2026-10-20T08:00:00Z');
    let vm: PendingJob[] = [offer('VALIDATED', { validated_at: '2026-10-20T07:00:00Z' })];
    let pc = mergeBoards([], vm).jobs;
    // A1 lancé à la main prend l'offre, attend le go ; push.
    pc = claimForRun(pc, 'acme', { ...manual, now: t0 }).jobs!;
    vm = mergeBoards(pc, vm).jobs;
    // Trois heures plus tard, la règle des prises périmées du listener clôt la prise de A1 ; push.
    pc = releaseStale(pc, new Date('2026-10-20T11:00:00Z')).jobs;
    expect(pc[0]).toMatchObject({ status: 'APPLY_FAILED', harness: { run: 'A1', stage: 'listener' } });
    vm = mergeBoards(pc, vm).jobs;
    // Antoine suit la note : /valider sur Telegram (VM seulement).
    vm = [{ ...vm[0]!, status: 'VALIDATED', validated_at: '2026-10-20T11:05:00Z' }];
    // Puis il approuve le vieux go sur le PC avant le pull : own lit la copie du PC.
    expect(holdsClaim(pc[0]!, 'A1')).toBe(false); // avant le correctif : true, A1 cliquait
    // A1 rend superseded → TAILORED : rien ne s'écrit, ni sur APPLY_FAILED ni après le pull sur VALIDATED.
    expect(mayRecord(pc[0]!, 'TAILORED', 'A1', 'A1').allowed).toBe(false);
    pc = mergeBoards(pc, vm).jobs;
    expect(pc[0]).toMatchObject({ status: 'VALIDATED', validated_at: '2026-10-20T11:05:00Z', harness: { run: 'A1', stage: 'listener' } });
    const late = mayRecord(pc[0]!, 'TAILORED', 'A1', 'A1'); // avant le correctif : sameRun, TAILORED écrasait la validation
    expect(late.allowed).toBe(false);
    expect(late.reason).toContain('newer validation');
    expect(pickValidated(pc)?.slug).toBe('acme');
  });

  test('inFlight : les offres APPLYING récentes seulement', () => {
    const board = [offer('APPLYING', { applying: { run: 'L1', at: '2026-10-20T09:00:00Z' } }), { ...offer('APPLYING', { applying: { run: 'L0', at: '2026-10-20T07:00:00Z' } }), slug: 'old' }, { ...offer('VALIDATED'), slug: 'v' }];
    expect(inFlight(board, t)).toEqual([{ slug: 'acme', run: 'L1' }]);
  });
});

describe('settleClaim et releaseStale : jamais APPLY_FAILED sur une candidature peut-être envoyée', () => {
  const t = new Date('2026-10-20T10:00:00Z');
  const claim = { path: 'work', slug: 'acme', run: 'L1' };
  const applying = (): PendingJob[] => [{ slug: 'acme', company: 'Acme', title: 't', link: '', status: 'APPLYING', validated_at: 'v', applying: { run: 'L1', at: '2026-10-20T09:00:00Z', artifacts: '/runs/A1' } }];
  const sentUnwritten = { ok: true, stage: 'done', status: 'APPLIED', status_written: false, summary: 'Application sent and confirmed. Status APPLIED (not written: pending_gold_jobs.json could not be written (EPERM)).' };

  test('le défaut reproduit : close a eu APPLIED sans pouvoir l’écrire ; settle relit close.json et écrit APPLIED, pas APPLY_FAILED', () => {
    // Sans le résultat sauvé, settle écrivait APPLY_FAILED (« run failed or was cancelled »), que /valider accepte.
    expect(settleClaim(applying(), claim, t, orphanReason('L1')).status).toBe('APPLY_FAILED');
    const out = settleClaim(applying(), claim, t, orphanReason('L1'), { result: sentUnwritten, by: 'career-listener (settle, from close.json)' });
    expect(out).toMatchObject({ settled: true, status: 'APPLIED', via: 'result' });
    expect(out.jobs[0]).toMatchObject({ status: 'APPLIED', applying: undefined, harness: { run: 'L1', stage: 'done', summary: 'Application sent and confirmed.' } });
    expect(String((out.jobs[0].harness as { note: string }).note)).toContain('from close.json');
  });

  test('cancel pendant submit (rien rendu, armed.json dans submission/) : APPLY_UNPROVEN avec les traces', () => {
    const out = settleClaim(applying(), claim, t, orphanReason('L1'), { evidence: () => ['armed.json says the submit step started'] });
    expect(out).toMatchObject({ settled: true, status: 'APPLY_UNPROVEN', via: 'evidence' });
    expect(String((out.jobs[0].harness as { summary: string }).summary)).toContain('may have been sent: armed.json');
  });

  test('sans résultat ni trace : APPLY_FAILED comme avant ; offre plus tenue : rien', () => {
    expect(settleClaim(applying(), claim, t, 'x', { result: null, evidence: () => [] })).toMatchObject({ settled: true, status: 'APPLY_FAILED', via: 'reason' });
    const other = [{ ...applying()[0]!, applying: { run: 'L2', at: 'x' } }];
    expect(settleClaim(other, claim, t, 'x', { result: sentUnwritten })).toMatchObject({ settled: false, status: 'APPLYING' });
  });

  test('la règle des prises périmées lit aussi submission/ : APPLY_UNPROVEN quand un clic a pu avoir lieu', () => {
    const old = [{ ...applying()[0]!, applying: { run: 'A1', at: '2026-10-20T07:00:00Z', artifacts: '/runs/A1' } }];
    const { jobs: next, stale } = releaseStale(old, t, undefined, (job) => ((job.applying as { artifacts?: string }).artifacts === '/runs/A1' ? ['click.json records a click attempt'] : []));
    expect(stale).toEqual(['acme']);
    expect(next[0]).toMatchObject({ status: 'APPLY_UNPROVEN', applying: undefined, harness: { run: 'A1', stage: 'listener' } });
    expect(String((next[0]!.harness as { note: string }).note)).toContain('may have been sent');
  });

  test('submissionEvidence lit <applying.artifacts>/submission/ pour de vrai', () => {
    const dir = tempDir('evidence-');
    mkdirSync(join(dir, 'submission'));
    const job = { ...applying()[0]!, applying: { run: 'L1', at: 'x', artifacts: dir } };
    expect(submissionEvidence(job)).toEqual([]);
    writeFileSync(join(dir, 'submission', 'armed.json'), JSON.stringify({ at: '2026-10-20T09:30:00Z' }));
    expect(submissionEvidence(job).join(' ')).toContain('armed.json');
    expect(submissionEvidence({ ...job, applying: { run: 'L1', at: 'x' } })).toEqual([]);
  });
});

describe('le verrou du tableau et l’écriture refaite sur EPERM / EBUSY', () => {
  test('retrying refait sur EPERM et EBUSY, pas sur une autre erreur', () => {
    let calls = 0;
    const flaky = (): string => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('busy'), { code: calls === 1 ? 'EPERM' : 'EBUSY' });
      return 'ok';
    };
    expect(retrying(flaky, [1, 1, 1])).toBe('ok');
    expect(calls).toBe(3);
    expect(() => retrying(() => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); }, [1])).toThrow('nope');
    let always = 0;
    expect(() => retrying(() => { always++; throw Object.assign(new Error('locked'), { code: 'EBUSY' }); }, [1, 1])).toThrow('locked');
    expect(always).toBe(3);
  });

  test('readBoard / writeBoard : aller-retour, BOM toléré, pas de .tmp laissé', () => {
    const dir = tempDir('board-');
    const path = join(dir, 'pending_gold_jobs.json');
    writeFileSync(path, `﻿${JSON.stringify([{ slug: 'a', status: 'VALIDATED' }])}`);
    expect(readBoard(path)).toEqual([{ slug: 'a', status: 'VALIDATED' }] as never);
    writeBoard(path, [{ slug: 'b' }]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([{ slug: 'b' }]);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    writeFileSync(path, '{"not":"an array"}');
    expect(() => readBoard(path)).toThrow('not a JSON array');
  });

  test('le verrou : exclusif, rendu après usage (même sur une exception), seulement par son détenteur', () => {
    const dir = tempDir('lock-');
    const path = join(dir, 'pending_gold_jobs.json');
    const token = acquireBoardLock(path, 'first');
    expect(existsSync(lockPathOf(path))).toBe(true);
    expect(() => acquireBoardLock(path, 'second', { waitMs: 150 })).toThrow('locked by another writer');
    releaseBoardLock(path, 'someone-else');
    expect(existsSync(lockPathOf(path))).toBe(true);
    releaseBoardLock(path, token);
    expect(existsSync(lockPathOf(path))).toBe(false);
    expect(() => withBoardLock(path, 'thrower', () => { throw new Error('boom'); })).toThrow('boom');
    expect(existsSync(lockPathOf(path))).toBe(false);
  });

  test('un verrou laissé par un écrivain mort est cassé après staleMs ; un récent, jamais', () => {
    const dir = tempDir('lock-');
    const path = join(dir, 'pending_gold_jobs.json');
    writeFileSync(lockPathOf(path), JSON.stringify({ token: 'dead', holder: 'crashed', pid: 1 }));
    const past = new Date(Date.now() - 60_000);
    utimesSync(lockPathOf(path), past, past);
    const token = acquireBoardLock(path, 'next', { staleMs: 15_000, waitMs: 2_000 });
    expect(JSON.parse(readFileSync(lockPathOf(path), 'utf8')).token).toBe(token);
    releaseBoardLock(path, token);
    writeFileSync(lockPathOf(path), JSON.stringify({ token: 'alive', holder: 'writer', pid: 1 }));
    expect(() => acquireBoardLock(path, 'next', { staleMs: 15_000, waitMs: 200 })).toThrow('locked by another writer');
    expect(JSON.parse(readFileSync(lockPathOf(path), 'utf8')).token).toBe('alive');
  });

  test('deux processus qui écrivent en même temps sous le verrou : aucune écriture perdue', () => {
    const dir = tempDir('contention-');
    const path = join(dir, 'pending_gold_jobs.json');
    writeFileSync(path, JSON.stringify([{ slug: 'counter', status: 'VALIDATED', n: 0 }]));
    const worker = join(dir, 'worker.ts');
    writeFileSync(
      worker,
      `import { updateBoard } from ${JSON.stringify(join(import.meta.dir, 'pending.ts'))};\n` +
        `for (let i = 0; i < 40; i++) updateBoard(process.argv[2]!, 'worker', (jobs) => { const job = jobs[0] as { n: number }; const seen = job.n; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); job.n = seen + 1; return { jobs, value: null }; });\n`
    );
    const procs = [0, 1].map(() => Bun.spawn(['bun', worker, path], { stdout: 'pipe', stderr: 'pipe' }));
    const codes = procs.map((proc) => proc.exited);
    return Promise.all(codes).then((exits) => {
      expect(exits).toEqual([0, 0]);
      expect((JSON.parse(readFileSync(path, 'utf8')) as { n: number }[])[0]!.n).toBe(80);
      expect(existsSync(lockPathOf(path))).toBe(false);
    });
  }, 30_000);

  test('updateBoard : relit, modifie, réécrit ; rien à écrire quand change rend null', () => {
    const dir = tempDir('update-');
    const path = join(dir, 'pending_gold_jobs.json');
    writeFileSync(path, JSON.stringify([{ slug: 'a', status: 'VALIDATED' }]));
    expect(updateBoard(path, 't', (jobs) => ({ jobs: markApplying(jobs, 'a', 'L1', new Date('2026-10-20T10:00:00Z')), value: 1 }))).toBe(1);
    expect(readBoard(path)[0]).toMatchObject({ status: 'APPLYING', applying: { run: 'L1' } });
    const before = readFileSync(path, 'utf8');
    updateBoard(path, 't', () => ({ jobs: null, value: null }));
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
