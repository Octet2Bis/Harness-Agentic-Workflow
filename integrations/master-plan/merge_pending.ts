#!/usr/bin/env bun
/**
 * Fusionne les deux copies de `pending_gold_jobs.json`, offre par offre, pour
 * `sync_pending.ps1` : jamais une copie n'écrase l'autre. La règle est `mergeBoards`
 * (`.archon/workflows/systems/.shared/pending.ts`, pure, testée dans `pending.test.ts`) :
 * le PC garde ses statuts du harness (APPLYING, TAILORED, APPLIED, APPLY_UNPROVEN,
 * APPLY_FAILED), sauf une nouvelle validation (`validated_at` plus récent) ou un statut que
 * seul le bot écrit sur la VM ; jamais une candidature en cours ou partie ; les champs du bot
 * viennent de la VM ; une offre d'un seul côté est gardée.
 *
 *   bun merge_pending.ts pull <pc.json> <vm.json>
 *     avant le tour : la copie de la VM (téléchargée dans <vm.json>) entre dans <pc.json>.
 *   bun merge_pending.ts push <pc.json> <vm.json> <out.json>
 *     la copie de la VM relue à l'instant (<vm.json>) reçoit les statuts du PC ; le résultat va
 *     dans <out.json> (à renvoyer sur la VM) et dans <pc.json>.
 *
 * `archon trigger fire` rend la main dès que le run du listener est lancé en arrière-plan : le
 * `push` tourne donc PENDANT le tour, en même temps que `claim`, `load`, `record`, `close` et
 * `settle`. Toute la relecture, la fusion et l'écriture de <pc.json> se font sous le verrou du
 * tableau (`pending_gold_jobs.json.lock` à côté de <pc.json>, `withBoardLock`), que tous ces
 * écrivains prennent aussi : aucune prise ni aucun statut écrit pendant la fusion n'est perdu.
 * Ce qu'un écrivain pose après la fusion part au `push` suivant.
 *
 * <pc.json> absent vaut un tableau vide ; une copie illisible arrête tout sans rien écrire.
 * Les écritures sont atomiques (tmp + rename) et refaites sur EPERM / EBUSY (`writeBoard`).
 */

import { existsSync } from 'node:fs';
import { mergeBoards, readBoard, withBoardLock, writeBoard } from '../../.archon/workflows/systems/.shared/pending.ts';

const [mode, pcPath, vmPath, outPath] = process.argv.slice(2);

if ((mode !== 'pull' && mode !== 'push') || !pcPath || !vmPath || (mode === 'push' && !outPath)) {
  process.stderr.write('usage: bun merge_pending.ts pull <pc.json> <vm.json> | push <pc.json> <vm.json> <out.json>\n');
  process.exitCode = 2;
} else {
  try {
    if (!existsSync(vmPath)) throw new Error(`VM copy not found: ${vmPath}`);
    const vm = readBoard(vmPath);
    withBoardLock(pcPath, `merge_pending ${mode}`, () => {
      const pc = existsSync(pcPath) ? readBoard(pcPath) : [];
      const { jobs, notes } = mergeBoards(pc, vm);
      const content = `${JSON.stringify(jobs, null, 2)}\n`;
      if (mode === 'push') writeBoard(outPath!, jobs, content);
      writeBoard(pcPath, jobs, content);
      for (const note of notes) process.stdout.write(`${note}\n`);
      process.stdout.write(`merged ${jobs.length} offer(s) (${mode})\n`);
    });
  } catch (err) {
    process.stderr.write(`merge_pending: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
