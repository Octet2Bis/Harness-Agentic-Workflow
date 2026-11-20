/**
 * Le connecteur LinkedIn lit chaque champ dans SA carte (incident du 2026-10-24 : cinq listes
 * appariées par rang ; une carte entièrement cliquable `<a class="base-card…">`, sans
 * `base-card__full-link`, ou sans <time> décalait les suivantes, et Bizneo HR partait au tableau
 * avec le lien d'une annonce EverAI). `bun test` sur ce fichier ; jamais le réseau.
 */

import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyLinkConflict } from '../../company-link.ts';

const require = createRequire(import.meta.url);
const { fetchLinkedInLive, parseCards } = require('./linkedin_fetcher.js') as {
  fetchLinkedInLive: (queries: string[], options: Record<string, unknown>) => Promise<{ status: unknown; jobs: { company: string; title: string; link: string; location: string; date_published: string }[] }>;
  parseCards: (html: string) => { title: string; company: string; link: string; date: string; loc: string }[];
};

const TODAY = new Date().toISOString().slice(0, 10);

/** Une carte comme la page invitée de LinkedIn les sert : div + lien plein cadre, nom de l'entreprise en lien. */
function divCard(slug: string, id: string, title: string, company: string, opts: { time?: boolean; companyLink?: boolean } = {}): string {
  const name = opts.companyLink === false ? `\n          ${company}\n        ` : `\n          <a class="hidden-nested-link" href="https://es.linkedin.com/company/${slug}?trk=public_jobs">\n            ${company}\n          </a>\n        `;
  return `<li>
  <div class="base-card relative w-full hover:no-underline base-card--link base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:${id}">
    <a class="base-card__full-link absolute top-0 right-0 bottom-0 left-0 p-0 z-[2]" href="https://es.linkedin.com/jobs/view/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-at-${slug}-${id}?position=1&amp;pageNum=0">
      <span class="sr-only">
        ${title}
      </span>
    </a>
    <div class="search-entity-media"><img class="artdeco-entity-image" alt="${company}"></div>
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">
        ${title}
      </h3>
      <h4 class="base-search-card__subtitle">${name}</h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">
          Madrid, Community of Madrid, Spain
        </span>
        ${opts.time === false ? '' : `<time class="job-search-card__listdate--new" datetime="${TODAY}">2 hours ago</time>`}
      </div>
    </div>
  </div>
</li>`;
}

/** La carte entièrement cliquable : l'élément de la carte est lui-même le lien, l'entreprise en texte nu. */
function anchorCard(slug: string, id: string, title: string, company: string): string {
  return `<li>
  <a class="base-card relative w-full hover:no-underline base-card--link base-search-card base-search-card--link job-search-card" href="https://es.linkedin.com/jobs/view/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-at-${slug}-${id}?refId=x" data-entity-urn="urn:li:jobPosting:${id}">
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">
        ${title}
      </h3>
      <h4 class="base-search-card__subtitle">
        ${company}
      </h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">
          Remote
        </span>
        <time class="job-search-card__listdate" datetime="${TODAY}">1 day ago</time>
      </div>
    </div>
  </a>
</li>`;
}

const PAGE = [
  anchorCard('bizneo-hr', '4300000001', 'Growth Marketing Specialist', 'Bizneo HR'),
  divCard('everai', '4300000002', 'Performance Marketing Manager', 'EverAI'),
  divCard('darkroom', '4300000003', 'Lifecycle Marketing Manager', 'Darkroom', { time: false }),
  divCard('onthegosystems', '4300000004', 'Marketing Operations Specialist', 'OnTheGoSystems', { companyLink: false }),
  divCard('smartness', '4300000005', 'Sales Operations Specialist', 'Smartness'),
].join('\n');

test('parseCards : chaque champ vient de sa carte, quelle que soit la forme des voisines', () => {
  const cards = parseCards(PAGE);
  expect(cards.map((c) => [c.company, c.link.replace(/^.*\/jobs\/view\//, '')])).toEqual([
    ['Bizneo HR', 'growth-marketing-specialist-at-bizneo-hr-4300000001'],
    ['EverAI', 'performance-marketing-manager-at-everai-4300000002'],
    ['Darkroom', 'lifecycle-marketing-manager-at-darkroom-4300000003'],
    ['OnTheGoSystems', 'marketing-operations-specialist-at-onthegosystems-4300000004'],
    ['Smartness', 'sales-operations-specialist-at-smartness-4300000005'],
  ]);
  expect(cards.map((c) => c.title)).toEqual(['Growth Marketing Specialist', 'Performance Marketing Manager', 'Lifecycle Marketing Manager', 'Marketing Operations Specialist', 'Sales Operations Specialist']);
  expect(cards.map((c) => c.date)).toEqual([TODAY, TODAY, '', TODAY, TODAY]);
  expect(cards[0]!.loc).toBe('Remote');
  expect(cards[1]!.loc).toBe('Madrid, Community of Madrid, Spain');
});

test("fetchLinkedInLive : aucune offre n'a l'entreprise d'une annonce et le lien d'une autre", async () => {
  const careerDir = mkdtempSync(join(tmpdir(), 'radar-li-cards-'));
  try {
    const get = async (url: string) => (url.includes('/jobPosting/') ? { status: 404, data: '' } : { status: 200, data: PAGE });
    const { status, jobs } = await fetchLinkedInLive(['growth marketing'], { careerDir, fetchUrl: get, jitterMs: 0 });
    expect(status).toBe(200);
    expect(jobs.length).toBe(5);
    for (const job of jobs) expect(companyLinkConflict(job.company, job.link)).toBeNull();
    const bizneo = jobs.find((j) => j.company === 'Bizneo HR');
    expect(bizneo?.link).toBe('https://es.linkedin.com/jobs/view/growth-marketing-specialist-at-bizneo-hr-4300000001');
    expect(bizneo?.title).toBe('Growth Marketing Specialist');
    expect(jobs.find((j) => j.company === 'Darkroom')?.date_published).toBe('< 24h (filtre LinkedIn)');
  } finally {
    rmSync(careerDir, { recursive: true, force: true });
  }
});

test("fetchLinkedInLive : sans `searches`, l'URL d'Antoine est inchangée", async () => {
  const careerDir = mkdtempSync(join(tmpdir(), 'radar-li-url-'));
  try {
    const urls: string[] = [];
    const get = async (url: string) => { urls.push(url); return { status: 200, data: '' }; };
    await fetchLinkedInLive(['growth marketing'], { careerDir, fetchUrl: get, jitterMs: 0 });
    expect(urls).toEqual(['https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=growth%20marketing%20remote&location=Europe&f_WT=2&f_TPR=r86400&sortBy=DD&start=0']);
  } finally {
    rmSync(careerDir, { recursive: true, force: true });
  }
});

test('fetchLinkedInLive : recherches du candidat (France sur site avec « (H/F) », étranger en CDD), arrêt au 429', async () => {
  const careerDir = mkdtempSync(join(tmpdir(), 'radar-li-searches-'));
  try {
    const urls: string[] = [];
    const page = divCard('aso', '4300000009', 'Chargé de projet événementiel (H/F)', 'ASO');
    const get = async (url: string) => {
      urls.push(url);
      if (url.includes('/jobPosting/')) return { status: 404, data: '' };
      return url.includes('location=France') ? { status: 200, data: page } : { status: 429, data: '' };
    };
    const source = { searches: [
      { location: 'France', keep_gendered_titles: true },
      { location: 'Europe', f_JT: 'C,T', contract_hint: 'CDD / mission (filtre LinkedIn)' },
    ], batch_size: 2 };
    const { status, jobs } = await fetchLinkedInLive(['chargé de projet événementiel', 'volunteer manager', 'event coordinator'], { careerDir, fetchUrl: get, jitterMs: 0, source });
    const searches = urls.filter((u) => u.includes('/search?'));
    expect(searches).toEqual([
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=charg%C3%A9%20de%20projet%20%C3%A9v%C3%A9nementiel&location=France&f_TPR=r86400&sortBy=DD&start=0',
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=volunteer%20manager&location=France&f_TPR=r86400&sortBy=DD&start=0',
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=charg%C3%A9%20de%20projet%20%C3%A9v%C3%A9nementiel&location=Europe&f_JT=C%2CT&f_TPR=r86400&sortBy=DD&start=0',
    ]);
    expect(status).toBe(429);
    expect(jobs.length).toBe(2);
    expect(jobs[0]!.title).toBe('Chargé de projet événementiel (H/F)');
    expect((jobs[0] as unknown as { remote_declared: boolean }).remote_declared).toBe(false);
  } finally {
    rmSync(careerDir, { recursive: true, force: true });
  }
});
