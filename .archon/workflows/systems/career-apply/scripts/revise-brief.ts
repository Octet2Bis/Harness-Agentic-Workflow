/**
 * Le brief de la seconde ronde d'un bloc révisable, quand son Reviewer a refusé un livrable
 * aux contrôles verts (condition `when:` du nœud, `status == 'rejected'`) : `revise_brief`
 * (cv-tailor → `tailor2`) et `revise_letter_brief` (cover-letter → `letter2`). Les remarques
 * du candidat telles que `load` les a lues, puis les constats du Reviewer numérotés avec leur
 * gravité, bloquants d'abord, puis où retrouver la version précédente. La règle est pure
 * (`revisionBrief`, `revisionTarget`, systems/.shared/career.ts, testées) ; ici les liaisons, et
 * une copie de la première version dans `<out_dir>-v1/` pour qu'elle reste lisible après la
 * réécriture (au mieux : son absence n'arrête rien). cv-tailor : le dossier entier, s'il n'a
 * pas déjà été copié ; cover-letter : letter.md et letter.html, chacun s'il n'y est pas déjà
 * (le dossier `-v1/` peut déjà tenir la première version du CV).
 *
 * Rend `{ ok, remarks, summary }` : `ok: false` (rien à réviser, la seconde ronde sautée) si le
 * verdict lu n'est pas un refus du Reviewer ; `remarks` est l'entrée `remarks` de la seconde
 * ronde.
 *
 * Liaisons : INPUTS_REMARKS (les remarques du candidat, sortie de `load`), INPUTS_VERDICT (le
 * verdict JSON de la première ronde), INPUTS_OUT_DIR (le dossier du dossier de candidature dans
 * les artefacts, `application`), INPUTS_BLOCK (`cv-tailor` par défaut, ou `cover-letter`).
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CV_REVISION, type CvBlockVerdict, REVISION_BRIEF_MAX, revisionBrief, revisionTarget } from '../../.shared/career.ts';
import { artifactsDir, emit, nullableJson, text } from '../../.shared/io.ts';

const outDir = text(process.env.INPUTS_OUT_DIR).trim() || 'application';
const target = revisionTarget(text(process.env.INPUTS_BLOCK));
const verdict = nullableJson(process.env.INPUTS_VERDICT) as CvBlockVerdict | null;
const brief = revisionBrief(text(process.env.INPUTS_REMARKS), verdict, outDir, REVISION_BRIEF_MAX, target);

let kept = '';
if (brief.ok) {
  try {
    const src = join(artifactsDir(), outDir);
    const dst = join(artifactsDir(), `${outDir}-v1`);
    if (target === CV_REVISION) {
      if (existsSync(src) && !existsSync(dst)) {
        cpSync(src, dst, { recursive: true });
        kept = ` First version kept in ${outDir}-v1/.`;
      }
    } else {
      const copied: string[] = [];
      for (const file of target.files) {
        if (!existsSync(join(src, file)) || existsSync(join(dst, file))) continue;
        mkdirSync(dst, { recursive: true });
        cpSync(join(src, file), join(dst, file));
        copied.push(file);
      }
      if (copied.length > 0) kept = ` First version kept in ${outDir}-v1/ (${copied.join(', ')}).`;
    }
  } catch (err) {
    kept = ` First version not copied (${err instanceof Error ? err.message : String(err)}).`;
  }
}

emit({ ok: brief.ok, remarks: brief.remarks, summary: `${brief.summary}${kept}` });
