/**
 * Bout en bout, hors réseau : un candidat « alertes mail seulement » comme sur la VM (cycle.sh) :
 * radar-vm.ts --no-triage sur son dossier (LinkedIn France sur site, faux réseau) puis mail-vm.ts
 * vers un faux serveur SMTP. Vérifie que les offres françaises « (H/F) » sur site entrent au
 * tableau, que les stages / la vente pure sont écartés, et que le mail part avec Paris en tête.
 */

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCycle } from '../vm-radar/radar-vm.ts';
import { run } from './mail-vm.ts';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const card = (id: string, title: string, company: string, loc: string): string => `<li>
  <div class="base-card relative w-full base-search-card job-search-card">
    <a class="base-card__full-link" href="https://fr.linkedin.com/jobs/view/${title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}-at-${company.toLowerCase()}-${id}?position=1"><span class="sr-only">${title}</span></a>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">${title}</h3>
      <h4 class="base-search-card__subtitle">${company}</h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">${loc}</span>
        <time class="job-search-card__listdate" datetime="TODAY">1 hour ago</time>
      </div>
    </div>
  </div>
</li>`;

const PAGE = [
  card('4400000001', 'Chargé de projet événementiel sportif (H/F)', 'ASO', 'Boulogne-Billancourt, Île-de-France, France'),
  card('4400000002', 'Coordinatrice des bénévoles F/H', 'FFR', 'Marcoussis, Île-de-France, France'),
  card('4400000003', 'Chef de projet événementiel', 'Lyon Events', 'Lyon, Auvergne-Rhône-Alpes, France'),
  card('4400000004', 'Stagiaire chargé de projet événementiel', 'Agence', 'Paris, Île-de-France, France'),
  card('4400000005', 'Commercial événementiel (H/F)', 'Agence', 'Paris, Île-de-France, France'),
].join('\n');

function fakeSmtp(): Promise<{ port: number; data: () => string; close: () => void }> {
  let data = '';
  const server = createServer((sock) => {
    let buf = '';
    let inData = false;
    let n = 0;
    sock.write('220 ok\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 ok\r\n');
          } else data += `${line}\n`;
          continue;
        }
        n++;
        if (line.startsWith('EHLO')) sock.write('250 ok\r\n');
        else if (line === 'AUTH LOGIN' || n === 3) sock.write('334 x\r\n');
        else if (n === 4) sock.write('235 ok\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ port: (server.address() as { port: number }).port, data: () => data, close: () => server.close() })));
}

test('radar du candidat (sans tri) puis mail récapitulatif', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cand-e2e-'));
  roots.push(root);
  const career = join(root, 'candidats', 'camille');
  mkdirSync(career, { recursive: true });
  writeFileSync(join(career, 'candidat.json'), JSON.stringify({ id: 'camille', nom: 'Camille', vm: true }));
  writeFileSync(join(career, 'career_taxonomy.json'), JSON.stringify({
    search_queries: ['chargé de projet événementiel', 'coordinateur des bénévoles'],
    core_domains: ['événement', 'evenement', 'bénévol', 'sportif', 'event '],
    remote_policy: 'indifferent',
    target_experience: { disqualified_labels: ['stage', 'stagiaire', 'alternance', 'commercial', '10+ years'] },
  }));
  writeFileSync(join(career, 'criteres.json'), JSON.stringify({ langues: ['fr', 'en'], remote: 'indifferent', offre_age_max_jours: 7 }));
  writeFileSync(join(career, 'job_sources.json'), JSON.stringify({ version: 'test', sources: [{ name: 'LinkedIn', enabled: true, batch_size: 1, searches: [{ location: 'France', keep_gendered_titles: true }] }] }));
  writeFileSync(join(career, 'pending_gold_jobs.json'), '[]\n');
  writeFileSync(join(career, 'alertes_mail.json'), JSON.stringify({ to: 'camille@example.org', nom: 'Camille', heures: [8, 18], priorite_lieux: ['paris', 'ile-de-france'] }));
  const fake = join(root, 'fake-fetch.cjs');
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(fake, `
const urls = [];
async function fetchUrl(url) {
  urls.push(url);
  if (url.includes('/search?')) {
    if (!url.includes('location=France') || url.includes('f_WT=')) return { status: 500, data: '' };
    return { status: 200, data: ${JSON.stringify(PAGE.replaceAll('TODAY', today))} };
  }
  if (url.includes('/jobPosting/')) return { status: 200, data: '<div class="show-more-less-html__markup">Poste sur site. Vous coordonnez les équipes de bénévoles et la logistique de l\\'événement, en lien avec les partenaires et les collectivités.</div>' };
  return { status: 503, data: '' };
}
async function request() { return { status: 500, data: '' }; }
module.exports = { fetchUrl, request };
`);
  const o = parseArgs(['--career', career, '--work', join(root, 'runs-camille'), '--no-triage', '--fetch-module', fake]);
  const report = await runCycle(o);
  expect(report.errors).toEqual([]);
  expect(report.triage).toEqual([]);
  const board = JSON.parse(readFileSync(join(career, 'pending_gold_jobs.json'), 'utf8')) as { title: string; remote_declared: boolean }[];
  expect(board.map((b) => b.title).sort()).toEqual(['Chargé de projet événementiel sportif (H/F)', 'Chef de projet événementiel', 'Coordinatrice des bénévoles F/H']);
  expect(board.every((b) => b.remote_declared === false)).toBe(true);

  const srv = await fakeSmtp();
  const env = { MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(srv.port), MAIL_SMTP_TLS: 'none', MAIL_SMTP_USER: 'radar@example.org', MAIL_SMTP_PASS: 'x' };
  const out = await run({ career, envFiles: [], dryRun: false, out: '', force: true, now: new Date() }, env);
  srv.close();
  expect(out).toContain('envoyé (smtp)');
  expect(out).toContain('3 nouvelles offres (2 à Paris / IDF)');
  const html = Buffer.from(srv.data().split('Content-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n')[1]!.split('--')[0]!.replace(/\n/g, ''), 'base64').toString('utf8');
  expect(html.indexOf('Coordinatrice des bénévoles')).toBeLessThan(html.indexOf('Chef de projet événementiel<'));
  expect(html).toContain('Reste de la France');
});
