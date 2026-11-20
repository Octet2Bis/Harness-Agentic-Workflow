/**
 * Imprime le dossier de candidature en PDF avec un navigateur headless déjà présent sur la
 * machine — l'entrée `pdf_cmd` si définie (modèle avec {html} et {pdf}), sinon Edge ou Chrome
 * (Windows, Linux, macOS) —, puis vérifie chaque PDF par du code avant que quiconque le voie
 * (`verifyPdf`, `systems/.shared/pdf-checks.ts`) : structure, pages (CV : 2 au plus, liaison
 * `cv_max_pages` ; lettre : une exactement), couche texte extractible, aucune page sans texte,
 * e-mail et téléphone du profil, aucun reste de gabarit (`{{…}}`, TODO, lorem ipsum,
 * [à compléter]), chiffres de la source relus dans le PDF, polices embarquées. Pas de
 * dépendance à installer.
 *
 * - `CV.md` → `CV.html` → `CV.pdf`, toujours ;
 * - `letter.html` → `letter.pdf`, quand une lettre de motivation a été écrite dans le même
 *   dossier : une page exactement, mêmes contrôles. Une lettre refusée rend `ok: false` comme
 *   un CV refusé : rien ne part avec un PDF faux.
 *
 * Le texte extrait de chaque PDF (ce qu'un ATS lit) est déposé à côté (`CV.txt`, `letter.txt`).
 * Un PDF refusé est renommé `<nom>.rejected.pdf` : `record` ne le recopie pas dans
 * `applications/<slug>/` comme le CV de la candidature, et il reste dans les artefacts pour
 * comprendre.
 *
 * Rend `{ ok, pdf, engine, pages, problems, summary, letter, letter_pages }` : `pdf` est le CV
 * vérifié (vide sinon), `pages` ses pages, `problems` ceux des deux PDF, en français, chacun
 * préfixé du nom du fichier ; `letter` la lettre vérifiée (vide sans lettre ou si elle est
 * refusée). `renderChecked` (exporté) imprime et vérifie un HTML quelconque : la même porte
 * pour tout autre rendu.
 *
 * Liaisons : INPUTS_OUT_DIR (dossier du dossier de candidature dans les artefacts),
 * INPUTS_PDF_CMD, INPUTS_PROFILE (profil maître : e-mail et téléphone attendus ; vide ou
 * illisible, ceux de `candidate.json`), INPUTS_CV_MAX_PAGES (2 par défaut), INPUTS_LETTER (le
 * verdict JSON du bloc cover-letter : letter.html n'est imprimé que s'il dit ok).
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { artifactsDir, emit, text } from '../../.shared/io.ts';
import { cvDocument } from '../../.shared/markdown.ts';
import { type Contact, PAGE_LIMITS, type PdfRules, htmlText, pdfRules, readProfileContact, verifyPdf } from '../../.shared/pdf-checks.ts';

// Chrome d'abord (Antoine, 2026-10-25 : le robot passe par Chrome), Edge seulement si Chrome manque.
export const BROWSERS = [
  'chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'google-chrome',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'msedge',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function run(argv: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(argv, { stdout: 'ignore', stderr: 'pipe' });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

function fileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

/** Imprime `htmlPath` en `pdfPath` : `pdfCmd` d'abord, sinon le premier navigateur qui y arrive. Rend le moteur, vide si aucun. */
export async function printPdf(htmlPath: string, pdfPath: string, pdfCmd = ''): Promise<string> {
  if (pdfCmd.trim() !== '') {
    // Découper le modèle avant d'y mettre les chemins : un chemin avec des espaces reste un seul argument.
    const argv = pdfCmd.trim().split(/\s+/).map((part) => part.replace('{html}', htmlPath).replace('{pdf}', pdfPath));
    if ((await run(argv)) && existsSync(pdfPath)) return argv[0] ?? 'pdf_cmd';
  }
  for (const browser of BROWSERS) {
    if ((browser.includes('/') || browser.includes('\\')) && !existsSync(browser)) continue;
    if ((await run([browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, fileUrl(htmlPath)])) && existsSync(pdfPath)) return browser;
  }
  return '';
}

export interface RenderedPdf {
  ok: boolean;
  /** Le PDF vérifié ; vide s'il n'a pas été produit ou s'il est refusé. */
  pdf: string;
  engine: string;
  pages: number;
  chars: number;
  problems: string[];
  summary: string;
}

/** Ce qui imprime un HTML en PDF et rend le moteur (vide si aucun) : `printPdf`, ou un faux dans les tests. */
export type Printer = (htmlPath: string, pdfPath: string, pdfCmd: string) => Promise<string>;

/**
 * Imprime puis vérifie : la porte de tout PDF qui sort d'un HTML. Le texte extrait va dans
 * `<nom>.txt` ; un PDF refusé devient `<nom>.rejected.pdf`. `rules.source` vide : les nombres
 * attendus sont ceux du texte visible du HTML.
 */
export async function renderChecked(htmlPath: string, pdfPath: string, rules: PdfRules, pdfCmd = '', print: Printer = printPdf): Promise<RenderedPdf> {
  const stem = pdfPath.replace(/\.pdf$/i, '');
  const rejected = `${stem}.rejected.pdf`;
  const refuse = (engine: string, problem: string): RenderedPdf => ({ ok: false, pdf: '', engine, pages: 0, chars: 0, problems: [problem], summary: problem });
  try {
    for (const stale of [pdfPath, rejected, `${stem}.txt`]) rmSync(stale, { force: true });
  } catch (err) {
    return refuse('', `${rules.label} : impossible de remplacer l'ancien fichier (${errorText(err)}) — ouvert dans une autre application ?`);
  }
  const engine = await print(htmlPath, pdfPath, pdfCmd);
  if (engine === '' || !existsSync(pdfPath)) {
    return refuse('', `${rules.label} : aucun navigateur headless ne l'a produit — renseigner l'entrée pdf_cmd (« <commande> {html} {pdf} ») ou installer Edge/Chrome ; ${basename(htmlPath)} est prêt à imprimer à la main`);
  }
  const setAside = (): void => {
    try {
      renameSync(pdfPath, rejected);
    } catch {
      // Le renommage n'est qu'une protection de plus : `ok: false` arrête déjà la candidature.
    }
  };
  let verdict: ReturnType<typeof verifyPdf>;
  try {
    const source = rules.source !== '' ? rules.source : htmlText(readFileSync(htmlPath, 'utf8'));
    verdict = verifyPdf(readFileSync(pdfPath), { ...rules, source });
  } catch (err) {
    setAside();
    return refuse(engine, `${rules.label} : illisible par les contrôles (${errorText(err)})`);
  }
  try {
    writeFileSync(`${stem}.txt`, `${verdict.text}\n`, 'utf8');
  } catch {
    // Le texte extrait n'est qu'une aide pour comprendre un refus.
  }
  if (!verdict.ok) setAside();
  const summary = verdict.ok
    ? `${rules.label} imprimé avec ${engine} et vérifié : ${verdict.pages} page(s), ${verdict.chars} caractères lisibles`
    : `${rules.label} refusé par les contrôles, gardé sous ${basename(rejected)}`;
  return { ok: verdict.ok, pdf: verdict.ok ? pdfPath : '', engine, pages: verdict.pages, chars: verdict.chars, problems: verdict.problems, summary };
}

/** Les resserrements essayés quand le CV déborde d'une page : une ligne de trop ne doit pas faire une page 2 presque vide. */
export const FIT_ZOOMS = [0.97, 0.94] as const;

/** Le HTML resserré d'un facteur `zoom` (texte réel inchangé, seule l'échelle d'impression bouge). */
export function fitZoomHtml(html: string, zoom: number): string {
  const style = `<style data-fit="${zoom}">body{zoom:${zoom}}</style>`;
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`;
}

/** L'e-mail et le téléphone attendus : ceux du profil maître, sinon ceux de `candidate.json` (vérifiés par cv-tailor). */
export function expectedContact(profilePath: string, dir: string): Contact {
  if (profilePath !== '' && existsSync(profilePath)) {
    try {
      return readProfileContact(readFileSync(profilePath, 'utf8'));
    } catch {
      // illisible : candidate.json
    }
  }
  try {
    const candidate = JSON.parse(readFileSync(join(dir, 'candidate.json'), 'utf8')) as Record<string, unknown>;
    return { email: typeof candidate.email === 'string' ? candidate.email : '', phone: typeof candidate.phone === 'string' ? candidate.phone : '' };
  } catch {
    return { email: '', phone: '' };
  }
}

if (import.meta.main) {
  const dir = join(artifactsDir(), text(process.env.INPUTS_OUT_DIR) || 'application');
  const markdownPath = join(dir, 'CV.md');
  const htmlPath = join(dir, 'CV.html');
  // La lettre : seulement quand le bloc cover-letter a rendu ok (liaison INPUTS_LETTER, son
  // verdict en JSON ; null ou absent : pas de lettre). Un letter.html d'un tour refusé reste
  // sur le disque, il n'est pas imprimé.
  const letterVerdict = ((): { ok?: unknown } | null => {
    try {
      const v = JSON.parse(text(process.env.INPUTS_LETTER) || 'null') as unknown;
      return v !== null && typeof v === 'object' ? (v as { ok?: unknown }) : null;
    } catch {
      return null;
    }
  })();
  const letterPath = letterVerdict?.ok === true ? join(dir, 'letter.html') : '';
  const pdfCmd = text(process.env.INPUTS_PDF_CMD);
  const contact = expectedContact(text(process.env.INPUTS_PROFILE).trim(), dir);
  const maxPages = Number.parseInt(text(process.env.INPUTS_CV_MAX_PAGES), 10);
  const cvPages = { min: 1, max: Number.isInteger(maxPages) && maxPages >= 1 ? maxPages : PAGE_LIMITS.cv.max };
  if (!existsSync(markdownPath)) {
    const problem = `CV.md introuvable dans ${dir}`;
    emit({ ok: false, pdf: '', engine: '', pages: 0, problems: [problem], summary: `${problem}.`, letter: '', letter_pages: 0 });
  } else {
    const markdown = readFileSync(markdownPath, 'utf8');
    const title = (markdown.match(/^#\s+(.*)$/m)?.[1] ?? 'CV').trim();
    const html = cvDocument(markdown, title);
    writeFileSync(htmlPath, html, 'utf8');
    const cvRules = pdfRules('cv', { contact, pages: cvPages });
    let cv = await renderChecked(htmlPath, join(dir, 'CV.pdf'), cvRules, pdfCmd);
    // Deux pages pour une ligne de trop : on resserre un peu et on garde la version d'une page si elle passe.
    for (const zoom of FIT_ZOOMS) {
      if (!cv.ok || cv.pages <= 1) break;
      writeFileSync(htmlPath, fitZoomHtml(html, zoom), 'utf8');
      const fitted = await renderChecked(htmlPath, join(dir, 'CV.pdf'), cvRules, pdfCmd);
      if (fitted.ok && fitted.pages === 1) cv = { ...fitted, summary: `${fitted.summary} (resserré à ${Math.round(zoom * 100)} %)` };
      else if (zoom === FIT_ZOOMS[FIT_ZOOMS.length - 1]) {
        writeFileSync(htmlPath, html, 'utf8');
        cv = await renderChecked(htmlPath, join(dir, 'CV.pdf'), cvRules, pdfCmd);
        break;
      }
    }
    const letter = letterPath !== '' && existsSync(letterPath) ? await renderChecked(letterPath, join(dir, 'letter.pdf'), pdfRules('letter', { contact }), pdfCmd) : null;
    const ok = cv.ok && (letter === null || letter.ok);
    const problems = [...cv.problems, ...(letter?.problems ?? [])];
    const known = [contact.email !== '' ? 'e-mail' : '', contact.phone !== '' ? 'téléphone' : ''].filter((part) => part !== '').join(' et ');
    const checked = known === '' ? ' (ni e-mail ni téléphone connus : non contrôlés)' : `, ${known} du profil présents`;
    const summary = ok ? `${cv.summary}${checked}${letter === null ? '' : ` ; ${letter.summary}`}.` : `${problems.join(' ; ')}.`;
    emit({ ok, pdf: cv.pdf, engine: cv.engine, pages: cv.pages, problems, summary, letter: letter?.pdf ?? '', letter_pages: letter?.pages ?? 0 });
  }
}
