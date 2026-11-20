/**
 * `render` sans navigateur : `renderChecked` avec un faux imprimeur qui recopie un PDF imprimé
 * une fois par Chromium (`systems/.shared/fixtures/pdf/`), puis le script entier lancé comme
 * Archon le lance, `pdf_cmd` pointant sur un faux imprimeur. Un dernier cas imprime pour de vrai
 * la mise en page de `cvDocument` quand Edge ou Chrome est là (sauté sinon) : une page, les
 * contrôles verts, et le texte relu dans l'ordre du document.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfRules } from '../../.shared/pdf-checks.ts';
import { cvDocument } from '../../.shared/markdown.ts';
import { LINKEDIN_SVG } from '../../../blocks/.shared/print-style.ts';
import { type Printer, FIT_ZOOMS, expectedContact, fitZoomHtml, printPdf, renderChecked } from './render.ts';

const fixtures = join(import.meta.dir, '..', '..', '.shared', 'fixtures', 'pdf');
const root = mkdtempSync(join(tmpdir(), 'render-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const contact = { email: 'camille.martin@exemple.fr', phone: '06 12 34 56 78' };
const copying =
  (name: string): Printer =>
  async (_html, pdf) => {
    copyFileSync(join(fixtures, name), pdf);
    return 'faux-imprimeur';
  };
function workdir(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
/** Le CV.md dont `cv-one-page.html` est la sortie de `cvDocument` (sa mise en page d'avant le 2026-10-23 : la fixture éprouve la lecture du PDF, pas le dessin). */
const CV_MD = `# Camille Martin — Responsable Growth

camille.martin@exemple.fr · +33 6 12 34 56 78 · Paris · [linkedin.com/in/camille-martin](https://www.linkedin.com/in/camille-martin)

## Profil

Responsable growth chez Acme : 8 ans d'expérience, **+35 %** de leads qualifiés en 2023, coût d'acquisition divisé par 2.

## Expériences

- **Acme** (2019 – 2024) : refonte du tunnel d'inscription, efficacité officielle des campagnes affichée chaque semaine.
- **Beta** (03/2016 - 07/2019) : 1 200 comptes ouverts, NPS de 62.

## Compétences

SQL, HubSpot, Python, « français », anglais C1 — œuvre à 100 %.
`;

describe('renderChecked : imprimer, puis vérifier avant que quiconque voie le PDF', () => {
  test('PDF conforme : ok, chemin rendu, texte déposé, ancien refus effacé', async () => {
    const dir = workdir('ok');
    const html = join(dir, 'CV.html');
    copyFileSync(join(fixtures, 'cv-one-page.html'), html);
    writeFileSync(join(dir, 'CV.rejected.pdf'), 'ancien refus');
    const result = await renderChecked(html, join(dir, 'CV.pdf'), pdfRules('cv', { contact }), '', copying('cv-one-page.pdf'));
    expect(result).toMatchObject({ ok: true, pdf: join(dir, 'CV.pdf'), engine: 'faux-imprimeur', pages: 1, problems: [] });
    expect(result.summary).toStartWith('CV.pdf imprimé avec faux-imprimeur et vérifié : 1 page(s)');
    expect(readFileSync(join(dir, 'CV.txt'), 'utf8')).toContain('camille.martin@exemple.fr · +33 6 12 34 56 78');
    expect(existsSync(join(dir, 'CV.rejected.pdf'))).toBe(false);
  });
  test('PDF refusé : ok false, problème en français, PDF mis de côté sous .rejected.pdf', async () => {
    const dir = workdir('refused');
    const html = join(dir, 'CV.html');
    copyFileSync(join(fixtures, 'three-pages.html'), html);
    const result = await renderChecked(html, join(dir, 'CV.pdf'), pdfRules('cv', { minChars: 10 }), '', copying('three-pages.pdf'));
    expect(result).toMatchObject({ ok: false, pdf: '', pages: 3, problems: ['CV.pdf : 3 pages, 2 au plus'] });
    expect(existsSync(join(dir, 'CV.pdf'))).toBe(false);
    expect(existsSync(join(dir, 'CV.rejected.pdf'))).toBe(true);
    expect(readFileSync(join(dir, 'CV.txt'), 'utf8')).toContain('Page 3');
  });
  test('aucun moteur : ok false, et la marche à suivre', async () => {
    const dir = workdir('none');
    const html = join(dir, 'CV.html');
    writeFileSync(html, '<p>x</p>');
    const result = await renderChecked(html, join(dir, 'CV.pdf'), pdfRules('cv'), '', async () => '');
    expect(result).toMatchObject({ ok: false, pdf: '', engine: '', pages: 0 });
    expect(result.problems[0]).toStartWith("CV.pdf : aucun navigateur headless ne l'a produit — renseigner l'entrée pdf_cmd");
  });
});

describe('expectedContact : le profil maître, sinon candidate.json', () => {
  test('profil, puis candidate.json, puis rien', () => {
    const dir = workdir('contact');
    writeFileSync(join(dir, 'profile.md'), '**E-mail :** a.b@exemple.fr · **Tél :** 06 11 22 33 44');
    writeFileSync(join(dir, 'candidate.json'), JSON.stringify({ email: 'c.d@exemple.fr', phone: '' }));
    expect(expectedContact(join(dir, 'profile.md'), dir)).toEqual({ email: 'a.b@exemple.fr', phone: '06 11 22 33 44' });
    expect(expectedContact('', dir)).toEqual({ email: 'c.d@exemple.fr', phone: '' });
    expect(expectedContact(join(dir, 'absent.md'), workdir('vide'))).toEqual({ email: '', phone: '' });
  });
});

describe('render, le script entier comme Archon le lance', () => {
  // Le modèle pdf_cmd se découpe sur les blancs : un chemin de bun qui en contient ne s'y écrit pas.
  test.skipIf(/\s/.test(process.execPath))('CV conforme, lettre avec des restes de gabarit : ok false, contrat de sortie complet', async () => {
    const art = workdir('run');
    const app = join(art, 'application');
    mkdirSync(app);
    writeFileSync(join(app, 'CV.md'), CV_MD);
    copyFileSync(join(fixtures, 'placeholder.html'), join(app, 'letter.html'));
    writeFileSync(join(art, 'profile.md'), '**E-mail :** camille.martin@exemple.fr — **Téléphone :** 06.12.34.56.78\n');
    writeFileSync(join(art, 'fake-print.ts'), "import { copyFileSync } from 'node:fs';\nconst out = process.argv[2] ?? '';\ncopyFileSync((out.endsWith('letter.pdf') ? process.env.FAKE_LETTER_PDF : process.env.FAKE_CV_PDF) ?? '', out);\n");
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'render.ts')], {
      cwd: art,
      env: {
        ...process.env,
        ARTIFACTS_DIR: art,
        INPUTS_OUT_DIR: 'application',
        INPUTS_PDF_CMD: `${process.execPath} fake-print.ts {pdf}`,
        INPUTS_PROFILE: join(art, 'profile.md'),
        INPUTS_CV_MAX_PAGES: '2',
        // Le verdict du bloc cover-letter : letter.html n'est imprimé que s'il dit ok.
        INPUTS_LETTER: '{"ok":true,"status":"verified"}',
        FAKE_CV_PDF: join(fixtures, 'cv-one-page.pdf'),
        FAKE_LETTER_PDF: join(fixtures, 'placeholder.pdf'),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = JSON.parse(await new Response(proc.stdout).text()) as Record<string, unknown>;
    expect(await proc.exited).toBe(0);
    expect(Object.keys(output).sort()).toEqual(['engine', 'letter', 'letter_pages', 'ok', 'pages', 'pdf', 'problems', 'summary']);
    expect(output).toMatchObject({ ok: false, pdf: join(app, 'CV.pdf'), engine: process.execPath, pages: 1, letter: '', letter_pages: 1 });
    const problems = output.problems as string[];
    expect(problems).toContain('letter.pdf : reste de gabarit dans le texte : « {{entreprise}} », « TODO », « Lorem ipsum », « [à compléter] »');
    expect(problems.every((problem) => problem.startsWith('letter.pdf : '))).toBe(true);
    expect(output.summary).toBe(`${problems.join(' ; ')}.`);
    expect(existsSync(join(app, 'CV.pdf'))).toBe(true);
    expect(existsSync(join(app, 'letter.rejected.pdf'))).toBe(true);
    // CV.html est la mise en page de cvDocument : le nom, le poste, une ligne de contact rangée.
    expect(readFileSync(join(app, 'CV.html'), 'utf8')).toContain(
      '<header class="masthead"><h1>Camille Martin</h1><p class="role"><span class="title">Responsable Growth</span></p><p class="contact">Paris <span class="sep">·</span> <a href="mailto:camille.martin@exemple.fr">camille.martin@exemple.fr</a> <span class="sep">·</span> +33 6 12 34 56 78 <span class="sep">·</span> <a class="ico" href="https://www.linkedin.com/in/camille-martin" aria-label="LinkedIn">' + LINKEDIN_SVG + '</a></p></header>',
    );
  });

  test.skipIf(/\s/.test(process.execPath))('lettre refusée par son bloc (INPUTS_LETTER sans ok) : letter.html ignoré, CV seul', async () => {
    const art = workdir('run-no-letter');
    const app = join(art, 'application');
    mkdirSync(app);
    writeFileSync(join(app, 'CV.md'), CV_MD);
    copyFileSync(join(fixtures, 'placeholder.html'), join(app, 'letter.html'));
    writeFileSync(join(art, 'fake-print.ts'), "import { copyFileSync } from 'node:fs';\nconst out = process.argv[2] ?? '';\ncopyFileSync((out.endsWith('letter.pdf') ? process.env.FAKE_LETTER_PDF : process.env.FAKE_CV_PDF) ?? '', out);\n");
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, 'render.ts')], {
      cwd: art,
      env: { ...process.env, ARTIFACTS_DIR: art, INPUTS_OUT_DIR: 'application', INPUTS_PDF_CMD: `${process.execPath} fake-print.ts {pdf}`, INPUTS_PROFILE: '', INPUTS_CV_MAX_PAGES: '2', INPUTS_LETTER: '{"ok":false,"status":"rejected"}', FAKE_CV_PDF: join(fixtures, 'cv-one-page.pdf'), FAKE_LETTER_PDF: join(fixtures, 'placeholder.pdf') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    const output = JSON.parse(stdout.trim().split('\n').pop()!) as Record<string, unknown>;
    expect(output).toMatchObject({ ok: true, pages: 1, letter: '', letter_pages: 0 });
    expect(existsSync(join(app, 'letter.pdf'))).toBe(false);
  });
});

/** Un CV fictif dans les deux formes de période (fin de titre, ligne en italique). */
const DATED_MD = `# CV — Camille Martin

Application: Acme — Responsable Growth · camille.martin@exemple.fr · +33 6 12 34 56 78 · Paris · https://camille.example/

## Profil

Responsable growth : acquisition B2B, automatisation, reporting.

## Expériences

### Acme — Responsable Growth · 09/2024 – 05/2026
- Refonte du tunnel d'inscription.
- Outbound multicanal, environ 50% d'ouverture.

### Beta — Chargée d'acquisition
*03/2016 – 07/2019 · Remote*
- 1 200 comptes ouverts, NPS de 62.

## Compétences

- **Acquisition :** SEO, SEA, outbound
- **Outils :** HubSpot, n8n, Looker Studio

## Formation

- Master marketing digital, 2015
`;

describe('cvDocument imprimé pour de vrai (Edge ou Chrome présent)', () => {
  test('une page, contrôles verts, texte relu dans l’ordre du document', async () => {
    const dir = workdir('real-print');
    const html = join(dir, 'CV.html');
    writeFileSync(html, cvDocument(DATED_MD, 'CV — Camille Martin'));
    const result = await renderChecked(html, join(dir, 'CV.pdf'), pdfRules('cv', { contact }), '', printPdf);
    if (result.engine === '') return; // aucun navigateur sur cette machine : rien à imprimer
    expect(result).toMatchObject({ ok: true, pages: 1, problems: [] });
    const lines = readFileSync(join(dir, 'CV.txt'), 'utf8').split('\n');
    const order = ['Camille Martin', 'camille.martin@exemple.fr', 'PROFIL', 'EXPÉRIENCES', 'Acme — Responsable Growth 09/2024 – 05/2026', 'Refonte du tunnel', "Beta — Chargée d'acquisition 03/2016 – 07/2019 · Remote", '1 200 comptes', 'COMPÉTENCES', 'Acquisition : SEO', 'FORMATION', 'Master marketing'];
    const at = order.map((needle) => lines.findIndex((line) => line.includes(needle)));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  }, 60_000);
});

describe('fitZoomHtml', () => {
  test('ajoute une échelle d’impression avant </head> sans toucher au texte', () => {
    const html = '<html><head><title>CV</title></head><body><p>Texte</p></body></html>';
    const fitted = fitZoomHtml(html, 0.97);
    expect(fitted).toContain('<style data-fit="0.97">body{zoom:0.97}</style></head>');
    expect(fitted.replace(/<style data-fit[^>]*>[^<]*<\/style>/, '')).toBe(html);
  });
  test('reste léger : au plus 6 % de resserrement', () => {
    expect(Math.min(...FIT_ZOOMS)).toBeGreaterThanOrEqual(0.94);
  });
});
