/**
 * La garde de propriété (`own`) : juste avant `arm`, donc juste avant le clic, `always_run:
 * true` (rejouée à chaque reprise du run, même si elle a déjà réussi). L'appelant tient une
 * prise sur l'offre (`claim_board`, `claim_slug`, `claim_run` : chez career-apply,
 * `pending_gold_jobs.json`, le slug et la prise que `load` a notée ou faite) ; le clic n'a lieu
 * que si l'offre est ENCORE tenue par cette prise, relue à l'instant : `status: APPLYING` avec
 * `applying.run` = la prise, rien d'autre.
 * Sinon (prise close par le filet du listener : périmée après deux heures au go, ou `settle` ;
 * remise en file par `/valider`, prise par un autre run, déjà envoyée, tableau illisible ou
 * introuvable), `arm` et `submit` sont sautés et le verdict rend `superseded` : rien n'est
 * envoyé. C'est le cas d'un vieux run approuvé après que le filet a clos sa prise (un go se
 * donne dans les deux heures, sinon `/valider`), ou d'un run lancé à la main pendant que le
 * listener tenait l'offre. Sans `claim_board` (bloc utilisé seul, fixtures), rien à vérifier :
 * tenue.
 *
 * `holds` est la règle `holdsClaim` de `systems/.shared/career.ts`, recopiée ici (un bloc
 * n'importe pas un système) ; `career.test.ts` vérifie que les deux disent la même chose.
 * La sortie porte aussi les traces d'un envoi déjà commencé dans ce run (`armSubmit`) : une
 * offre perdue après un premier `submit` n'est jamais dite « pas envoyée » par le verdict.
 *
 * Liaisons : INPUTS_CLAIM_BOARD, INPUTS_CLAIM_SLUG, INPUTS_CLAIM_RUN, INPUTS_OUT_DIR.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { type AttemptFiles, armSubmit } from './click-trace.ts';

export interface Ownership {
  held: boolean;
  reason: string;
  evidence: string[];
}

/** L'entrée du tableau est-elle tenue par la prise `claim` ? (règle `holdsClaim` de career.ts) */
export function holds(entry: Record<string, unknown>, claim: string): boolean {
  if (claim === '') return false;
  const applying = entry.applying as { run?: unknown } | undefined;
  return String(entry.status ?? '') === 'APPLYING' && String(applying?.run ?? '') === claim;
}

/**
 * La décision, pure : `board` est le texte du tableau (null s'il est absent), `traces` ce que
 * `<out_dir>/` contient. Dans le doute, pas tenue : rien n'est envoyé.
 */
export function ownership(input: { board: string | null; boardPath: string; slug: string; claim: string; traces: AttemptFiles }): Ownership {
  const evidence = armSubmit(input.traces).evidence;
  const no = (reason: string): Ownership => ({ held: false, reason: `Not sent: ${reason}.`, evidence });
  if (input.boardPath === '') return { held: true, reason: 'no claim to check (claim_board is empty)', evidence };
  if (input.slug === '' || input.claim === '') return no('claim_board is set but claim_slug or claim_run is empty, so this run cannot show it still holds the offer');
  if (input.board === null) return no(`the board ${input.boardPath} was not found, so this run cannot show it still holds the offer`);
  let entries: unknown;
  try {
    entries = JSON.parse(input.board.replace(/^﻿/, ''));
  } catch {
    return no(`the board ${input.boardPath} is unreadable, so this run cannot show it still holds the offer`);
  }
  const wanted = input.slug.toLowerCase();
  const entry = Array.isArray(entries)
    ? (entries.find((item) => item !== null && typeof item === 'object' && String((item as { slug?: unknown }).slug ?? '').toLowerCase() === wanted) as Record<string, unknown> | undefined)
    : undefined;
  if (entry === undefined) return no(`the offer ${input.slug} is no longer on the board`);
  if (holds(entry, input.claim)) {
    return { held: true, reason: `the offer is still ${String(entry.status)} by this run's claim (${input.claim})`, evidence };
  }
  const applyingRun = String((entry.applying as { run?: unknown } | undefined)?.run ?? '');
  const by = entry.status === 'APPLYING' ? ` by another run (${applyingRun || 'unknown'})` : '';
  return no(`just before the click, the offer was ${String(entry.status ?? 'without status')}${by}, no longer held by this run's claim (${input.claim}); another run or a newer validation owns it now`);
}

if (import.meta.main) {
  const boardPath = text(process.env.INPUTS_CLAIM_BOARD).trim();
  const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'submission');
  // Un fichier tenu un instant par un autre (Windows : EBUSY, EPERM) est relu jusqu'à 5 fois ;
  // toujours illisible, il vaut '' : pas tenue, rien n'est envoyé.
  const readIfAny = (path: string): string | null => {
    for (let attempt = 0; ; attempt++) {
      try {
        return existsSync(path) ? readFileSync(path, 'utf8') : null;
      } catch {
        if (attempt >= 4) return '';
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
      }
    }
  };
  emit(
    ownership({
      board: boardPath === '' ? null : readIfAny(boardPath),
      boardPath,
      slug: text(process.env.INPUTS_CLAIM_SLUG).trim(),
      claim: text(process.env.INPUTS_CLAIM_RUN).trim(),
      traces: {
        armed: readIfAny(join(dir, 'armed.json')),
        click: readIfAny(join(dir, 'click.json')),
        receipt: readIfAny(join(dir, 'receipt.json')),
        receiptScreenshot: existsSync(join(dir, 'receipt.png')),
      },
    })
  );
}
