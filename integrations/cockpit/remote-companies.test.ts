import { describe, expect, test } from 'bun:test';
import { appendNew } from '../../.archon/workflows/systems/.shared/radar.ts';
import { remoteJobToPending, remoteView } from './remote-companies.ts';

const companies = {
  _meta: { at: '2026-11-08T12:00:00Z', rule: 'au moins 3 postes dont 90 % remote' },
  companies: {
    'greenhouse:distco': { name: 'Distco', ats: 'greenhouse', slug: 'distco', careers: 'https://job-boards.greenhouse.io/distco', total: 12, remote: 12, hybrid: 0, source: 'tableau', last_read: '2026-11-08T11:00:00Z' },
    'ashby:posthog': { name: 'Posthog', ats: 'ashby', slug: 'posthog', careers: 'https://jobs.ashbyhq.com/posthog', total: 40, remote: 40, hybrid: 0, source: 'manuel', last_read: '2026-11-08T11:00:00Z' },
    'lever:empty': { name: 'Empty', ats: 'lever', slug: 'empty', careers: 'javascript:alert(1)', total: 3, remote: 3, hybrid: 0, source: 'tableau' },
    'lever:aaa': { name: 'Aaa', ats: 'lever', slug: 'aaa', kind: 'partiel', total: 30, remote: 2, hybrid: 4, source: 'tableau' },
    'index:gitbook': { name: 'GitBook', ats: '', slug: '', careers: 'https://www.gitbook.com/about/careers', kind: 'full', board: false, total: 0, remote: 0, hybrid: 0, source: 'index', note: '100% Remote-First' },
  },
};
const jobs = {
  companies: {
    'ashby:posthog': { read_at: '2026-11-08T11:00:00Z', others: 30, jobs: [
      { id: 'ATS-AS-ph1', title: 'Developer Marketer, Sales', location: 'Remote (EMEA)', link: 'https://jobs.ashbyhq.com/posthog/ph1', posted: '2026-09-29', remote: true, target: false },
      { id: 'ATS-AS-ph3', title: 'Growth Marketing Manager', location: 'Remote (EU)', link: 'https://jobs.ashbyhq.com/posthog/ph3', posted: '2026-11-07', remote: true, target: true },
      { id: 'x', title: 'Piège', link: 'javascript:alert(1)' },
    ] },
    'greenhouse:distco': { jobs: [{ id: 'ATS-GR-2', title: 'Partnerships Lead', link: 'https://d.example/2', posted: '2026-10-20' }, { id: 'ATS-GR-3', title: 'Sales Lead', link: 'https://d.example/3' }] },
    'lever:aaa': { jobs: [{ id: 'ATS-LE-1', title: 'Growth Lead', link: 'https://a.example/1' }, { id: 'ATS-LE-2', title: 'CRM Lead', link: 'https://a.example/2' }, { id: 'ATS-LE-3', title: 'SEO Lead', link: 'https://a.example/3' }] },
  },
};

describe('vue des entreprises full remote', () => {
  test('les listées à la main d’abord, puis les full remote, puis les partielles ; le plus de postes devant ; ce qui est au tableau est dit ; liens non https écartés', () => {
    const board = [{ id: 'ATS-AS-ph3', slug: 'posthog', company: 'Posthog', title: 'Growth Marketing Manager', link: 'https://jobs.ashbyhq.com/posthog/ph3', status: 'APPLIED' }, { slug: 'distco', company: 'Distco', title: 'x', link: 'https://D.example/2', status: 'PENDING_VALIDATION' }];
    const v = remoteView(companies, jobs, board);
    expect(v.at).toBe('2026-11-08T12:00:00Z');
    expect(v.companies.map((c) => c.key)).toEqual(['ashby:posthog', 'greenhouse:distco', 'lever:empty', 'index:gitbook', 'lever:aaa']);
    expect(v.companies.map((c) => c.kind)).toEqual(['full', 'full', 'full', 'full', 'partiel']);
    expect(v.companies[3]).toMatchObject({ board: false, probed: true, note: '100% Remote-First', careers: 'https://www.gitbook.com/about/careers', jobs: [] });
    const ph = v.companies[0]!;
    expect(ph.jobs.map((j) => [j.title, j.onBoard])).toEqual([['Developer Marketer, Sales', null], ['Growth Marketing Manager', 'posthog']]);
    expect(ph.others).toBe(30);
    expect(v.companies[1]!.jobs[0]!.onBoard).toBe('distco');
    expect(v.companies[2]!.careers).toBe('');
    expect(remoteView(null, null, [])).toEqual({ at: null, rule: '', companies: [] });
  });

  test('zone et doublons appliqués aussi par la vue (fichiers écrits avant la règle)', () => {
    const old = { companies: { 'lever:aaa': { jobs: [
      { id: '1', title: 'Account Executive', location: 'Bogota, Colombia', link: 'https://a.example/1' },
      { id: '2', title: 'Account Executive', location: 'Madrid', link: 'https://a.example/2' },
      { id: '3', title: 'Account  executive', location: 'Lisbon', link: 'https://a.example/3' },
    ] } } };
    const v = remoteView(companies, old, [], (where) => !/colombia/i.test(where));
    const aaa = v.companies.find((c) => c.key === 'lever:aaa')!;
    expect(aaa.jobs.map((j) => [j.title, j.location, j.more])).toEqual([['Account Executive', 'Madrid', 1]]);
    expect(aaa.outsideEurope).toBe(1);
  });

  test('mise au tableau : même id que le radar, source dite, une seule fois', () => {
    const v = remoteView(companies, jobs, []);
    const ph = v.companies[0]!;
    const row = remoteJobToPending(ph, ph.jobs[0]!);
    expect(row).toMatchObject({ id: 'ATS-AS-ph1', slug: 'posthog', company: 'Posthog', title: 'Developer Marketer, Sales', source: 'Entreprise full remote (Ashby)', remote_declared: true, ajoutee_par: 'Antoine', date_published: '2026-09-29' });
    const first = appendNew([], [row], 'cockpit', new Date('2026-11-08T13:00:00Z'));
    expect(first.jobs?.[0]).toMatchObject({ status: 'PENDING_VALIDATION', index: 1 });
    expect(appendNew(first.jobs!, [row], 'cockpit', new Date()).jobs).toBeNull();
    const aaa = v.companies.find((c) => c.key === 'lever:aaa')!;
    expect(remoteJobToPending(aaa, aaa.jobs[0]!)).toMatchObject({ source: 'Entreprise full remote (Lever)', remote_basis: 'poste remote sur le tableau Lever de l\'employeur (2 postes remote sur 30)' });
  });
});
