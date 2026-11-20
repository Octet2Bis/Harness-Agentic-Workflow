/**
 * Les pages carrières des entreprises vérifiées comme source du radar, sur des réponses écrites
 * à la main dans la forme publique de chaque API (`test/*.sample.json`) : aucun appel réseau,
 * aucun tableau écrit. L'URL d'API déduite de `careers_url`, la lecture des six ATS (les trois
 * derniers d'après leur documentation seule), le repli par pays, le filtre d'intitulés tel qu'il
 * est dans `index.js`, l'écart des doublons.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  atsEndpoint,
  dedupeAgainstBoard,
  groupByCountry,
  isoDay,
  matchesTarget,
  mergeSmartRecruitersDetail,
  parseAshby,
  parseBoard,
  parseGreenhouse,
  parseLever,
  parseRecruitee,
  parseSmartRecruiters,
  parseWorkable,
  smartRecruitersDetailUrl,
  smartRecruitersNextOffset,
  stripHtml,
} from './radar_ats_boards.ts';

const sample = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dir, 'test', name), 'utf8')) as unknown;
const NOW = new Date('2026-10-22T22:00:00Z');

describe('atsEndpoint : de la page carrières à son API publique', () => {
  test('Greenhouse, Lever, Ashby : le jeton est le premier segment du chemin', () => {
    expect(atsEndpoint('https://boards.greenhouse.io/circleci')).toEqual({ ats: 'greenhouse', token: 'circleci', endpoint: 'https://boards-api.greenhouse.io/v1/boards/circleci/jobs?content=true' });
    expect(atsEndpoint('https://job-boards.eu.greenhouse.io/nordlys/jobs/1')?.endpoint).toBe('https://boards-api.eu.greenhouse.io/v1/boards/nordlys/jobs?content=true');
    expect(atsEndpoint('https://jobs.lever.co/mistral')).toEqual({ ats: 'lever', token: 'mistral', endpoint: 'https://api.lever.co/v0/postings/mistral?mode=json' });
    expect(atsEndpoint('https://jobs.eu.lever.co/kestrel/')?.endpoint).toBe('https://api.eu.lever.co/v0/postings/kestrel?mode=json');
    expect(atsEndpoint('https://jobs.ashbyhq.com/Deel')).toEqual({ ats: 'ashby', token: 'Deel', endpoint: 'https://api.ashbyhq.com/posting-api/job-board/Deel' });
  });

  test('Workable (sous-domaine ou apply.), Recruitee (sous-domaine), SmartRecruiters (premier segment)', () => {
    const workable = { ats: 'workable', token: 'balena', endpoint: 'https://apply.workable.com/api/v1/widget/accounts/balena?details=true' };
    expect(atsEndpoint('https://balena.workable.com/')).toEqual(workable);
    expect(atsEndpoint('https://apply.workable.com/balena/')).toEqual(workable);
    expect(atsEndpoint('https://apply.workable.com/balena/j/A1B2C3D4E5/')).toEqual(workable);
    expect(atsEndpoint('https://astronomer.recruitee.com/')).toEqual({ ats: 'recruitee', token: 'astronomer', endpoint: 'https://astronomer.recruitee.com/api/offers/' });
    expect(atsEndpoint('https://astronomer.recruitee.com/o/some-offer')?.token).toBe('astronomer');
    expect(atsEndpoint('https://jobs.smartrecruiters.com/Meridian')).toEqual({ ats: 'smartrecruiters', token: 'Meridian', endpoint: 'https://api.smartrecruiters.com/v1/companies/Meridian/postings?limit=100&offset=0' });
    expect(atsEndpoint('https://careers.smartrecruiters.com/Meridian/744000045001001')?.token).toBe('Meridian');
  });

  test('les autres ATS, les agrégateurs et les pages maison : null (pas couverts ici)', () => {
    expect(atsEndpoint('https://jobs.workable.com/view/abc')).toBeNull();
    expect(atsEndpoint('https://www.workable.com/')).toBeNull();
    expect(atsEndpoint('https://recruitee.com/')).toBeNull();
    expect(atsEndpoint('https://jobs.smartrecruiters.com/')).toBeNull();
    expect(atsEndpoint('https://acme.teamtailor.com/')).toBeNull();
    expect(atsEndpoint('https://uk.linkedin.com/jobs/view/growth-marketing-manager-emea-at-harvey-4437588553')).toBeNull();
    expect(atsEndpoint('https://www.welcometothejungle.com/fr/companies/lempire/jobs')).toBeNull();
    expect(atsEndpoint('https://example.com/careers')).toBeNull();
    expect(atsEndpoint('https://boards.greenhouse.io/')).toBeNull();
    expect(atsEndpoint('pas une url')).toBeNull();
  });
});

describe('parseGreenhouse / parseLever / parseAshby : des réponses sauvegardées aux champs du tableau', () => {
  test('Greenhouse : id, lien de l’employeur, lieu, texte à plat, date, service ; un job sans titre est écarté', () => {
    const { jobs, skipped } = parseGreenhouse(sample('greenhouse_jobs.sample.json'), 'Nordlys', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['GH-7001001', 'GH-7001002', 'GH-7001003']);
    expect(skipped).toEqual(['greenhouse 7001004: no title']);
    const [first] = jobs;
    expect(first).toMatchObject({ slug: 'nordlys', company: 'Nordlys', title: 'Growth Marketing Manager', location: 'Remote - Spain', remote_declared: true, source: 'Page carrières (greenhouse)', date_published: '2026-10-21' });
    expect(first?.link).toBe('https://boards.greenhouse.io/nordlys/jobs/7001001?gh_src=radar');
    expect(first?.description).toBe('We are hiring a Growth Marketing Manager to own paid acquisition and lifecycle.');
    expect(first?.ats).toEqual({ ats: 'greenhouse', token: '', external_id: '7001001', department: 'Marketing', employment_type: '' });
    expect(jobs[2]?.remote_declared).toBe(false);
  });

  test('Lever : intitulé `text`, tous les lieux, télétravail par `workplaceType`, salaire, date depuis l’epoch ; sans id écarté', () => {
    const { jobs, skipped } = parseLever(sample('lever_postings.sample.json'), 'Kestrel', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['LEV-a1b2c3d4-0000-4000-8000-000000000001', 'LEV-a1b2c3d4-0000-4000-8000-000000000002']);
    expect(skipped).toEqual(['lever ?: no id']);
    expect(jobs[0]).toMatchObject({ title: 'Revenue Operations Analyst', location: 'Dublin, Remote - Europe', remote_declared: true, salary_range: '45000–55000 EUR/per-year-salary', date_published: '2026-10-21', link: 'https://jobs.lever.co/kestrel/a1b2c3d4-0000-4000-8000-000000000001' });
    expect(jobs[0]?.ats.department).toBe('Revenue');
    expect(jobs[0]?.ats.employment_type).toBe('Full-time');
    expect(jobs[1]).toMatchObject({ location: 'Dublin', remote_declared: false, description: 'Front desk & supplies.', salary_range: '' });
  });

  test('Ashby : lieux principal et secondaires, `isRemote`, service ; un job non listé est écarté avec sa raison', () => {
    const { jobs, skipped } = parseAshby(sample('ashby_board.sample.json'), 'Zephyr', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['ASH-b7e1c0de-1111-4222-8333-000000000001']);
    expect(skipped).toEqual(['ashby b7e1c0de-1111-4222-8333-000000000002: not listed']);
    expect(jobs[0]).toMatchObject({ title: 'Lifecycle Marketing Specialist', location: 'Barcelona, Remote (EU)', remote_declared: true, date_published: '2026-10-22', description: 'Own onboarding and reactivation e-mail flows in Klaviyo.' });
    expect(jobs[0]?.ats).toMatchObject({ ats: 'ashby', department: 'Marketing', employment_type: 'FullTime' });
  });

  test('parseBoard : l’ATS de l’URL choisit le parseur et pose le jeton ; un ATS non couvert ne lit rien', () => {
    const read = parseBoard('https://jobs.ashbyhq.com/zephyr', sample('ashby_board.sample.json'), 'Zephyr', NOW);
    expect(read.endpoint?.ats).toBe('ashby');
    expect(read.jobs[0]?.ats.token).toBe('zephyr');
    const none = parseBoard('https://acme.teamtailor.com/', {}, 'Acme', NOW);
    expect(none.endpoint).toBeNull();
    expect(none.jobs).toEqual([]);
    expect(none.skipped[0]).toContain('ATS non couvert');
  });

  test('stripHtml et isoDay : texte à plat avec entités décodées, date au jour', () => {
    expect(stripHtml('<p>A &amp; B</p><script>x()</script> <b>c</b>')).toBe('A & B c');
    expect(isoDay('2026-10-21T08:12:00-04:00')).toBe('2026-10-21');
    expect(isoDay(1792569600000)).toBe('2026-10-21');
    expect(isoDay('n/a')).toBe('');
    expect(isoDay(undefined)).toBe('');
  });
});

describe('parseWorkable / parseRecruitee / parseSmartRecruiters : d’après la documentation seule, à confirmer sur une vraie réponse', () => {
  test('Workable : shortcode, lien de l’annonce, lieu, télétravail par `telecommuting` ou `workplace_type`, entités du titre décodées ; sans shortcode écarté', () => {
    const { jobs, skipped } = parseWorkable(sample('workable_widget.sample.json'), 'Balena', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['WRK-A1B2C3D4E5', 'WRK-F6G7H8I9J0', 'WRK-K1L2M3N4O5']);
    expect(skipped).toEqual(['workable ?: no id']);
    const [first] = jobs;
    expect(first).toMatchObject({ slug: 'balena', company: 'Balena', title: 'Growth & Lifecycle Marketing Manager', location: 'Barcelona, Spain', remote_declared: true, source: 'Page carrières (workable)', date_published: '2026-10-21', salary_range: '' });
    expect(first?.link).toBe('https://apply.workable.com/balena/j/A1B2C3D4E5/');
    expect(first?.description).toBe('Own paid acquisition & lifecycle for the EU market. HubSpot Google Ads');
    expect(first?.ats).toEqual({ ats: 'workable', token: '', external_id: 'A1B2C3D4E5', department: 'Marketing', employment_type: 'Full-time' });
    expect(jobs[1]).toMatchObject({ location: 'Austin, TX, United States', remote_declared: true });
    expect(jobs[2]).toMatchObject({ location: 'New York, NY, United States', remote_declared: false, description: 'Close mid-market deals from our NYC office.' });
  });

  test('Recruitee : id numérique, lieux `city, country`, `remote`, prérequis dans skills_required, salaire ; une offre non publiée est écartée', () => {
    const { jobs, skipped } = parseRecruitee(sample('recruitee_offers.sample.json'), 'Astronomer', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['REC-2300101', 'REC-2300102', 'REC-2300103']);
    expect(skipped).toEqual(['recruitee 2300104: status closed']);
    expect(jobs[0]).toMatchObject({
      title: 'Revenue Operations Manager (m/f/d)',
      link: 'https://astronomer.recruitee.com/o/revenue-operations-manager-m-f-d',
      location: 'Berlin, Germany',
      remote_declared: true,
      description: 'Own the CRM data model and pipeline reporting for the GTM team.',
      skills_required: 'HubSpot or Salesforce admin SQL',
      salary_range: '60000–75000 EUR/yearly',
      date_published: '2026-10-22',
    });
    expect(jobs[0]?.ats).toEqual({ ats: 'recruitee', token: '', external_id: '2300101', department: 'Revenue', employment_type: 'fulltime' });
    expect(jobs[1]).toMatchObject({ location: 'Denver, United States', remote_declared: false, salary_range: '', skills_required: '' });
    expect(jobs[2]).toMatchObject({ title: 'Head of Growth & Partnerships', location: 'Amsterdam, Netherlands, Paris, France', remote_declared: false, salary_range: '90000 EUR/yearly' });
  });

  test('SmartRecruiters : la liste donne id, intitulé, lieu (code pays en majuscules), `location.remote`, lien construit, description vide ; sans id écarté', () => {
    const { jobs, skipped } = parseSmartRecruiters(sample('smartrecruiters_postings.sample.json'), 'Meridian', NOW);
    expect(jobs.map((j) => j.id)).toEqual(['SMR-744000045001001', 'SMR-744000045001002', 'SMR-744000045001003']);
    expect(skipped).toEqual(['smartrecruiters ?: no id']);
    const [first] = jobs;
    expect(first).toMatchObject({ title: 'Demand Generation Lead', link: 'https://jobs.smartrecruiters.com/Meridian/744000045001001', location: 'Paris, Île-de-France, FR', remote_declared: true, description: '', skills_required: '', date_published: '2026-10-22' });
    expect(first?.ats).toEqual({ ats: 'smartrecruiters', token: 'Meridian', external_id: '744000045001001', department: 'Marketing', employment_type: 'Full-time' });
    expect(jobs[1]).toMatchObject({ location: 'Boston, MA, US', remote_declared: false });
    expect(jobs[2]).toMatchObject({ title: 'Product Marketing Manager & Analyst', location: 'Lisbon, PT' });
  });

  test('SmartRecruiters : le second appel (`ref`) remplit description, prérequis et lien de candidature ; un détail vide ne change rien', () => {
    const [first] = parseSmartRecruiters(sample('smartrecruiters_postings.sample.json'), 'Meridian', NOW).jobs;
    expect(smartRecruitersDetailUrl(first!)).toBe('https://api.smartrecruiters.com/v1/companies/Meridian/postings/744000045001001');
    const merged = mergeSmartRecruitersDetail(first!, sample('smartrecruiters_posting_detail.sample.json'));
    expect(merged).toMatchObject({
      id: 'SMR-744000045001001',
      title: 'Demand Generation Lead',
      link: 'https://jobs.smartrecruiters.com/Meridian/744000045001001-demand-generation-lead',
      description: 'Own inbound & outbound demand generation for EMEA.',
      skills_required: '5+ years in B2B demand generation HubSpot, Google Ads',
      remote_declared: true,
    });
    expect(mergeSmartRecruitersDetail(first!, {})).toEqual(first!);
  });

  test('SmartRecruiters : la pagination par offset s’arrête à `totalFound`', () => {
    expect(smartRecruitersNextOffset(sample('smartrecruiters_postings.sample.json'), 0)).toBeNull();
    expect(smartRecruitersNextOffset({ totalFound: 250, content: new Array(100).fill({}) }, 0)).toBe(100);
    expect(smartRecruitersNextOffset({ totalFound: 250, content: new Array(50).fill({}) }, 200)).toBeNull();
    expect(smartRecruitersNextOffset({ totalFound: 250, content: [] }, 0)).toBeNull();
  });

  test('parseBoard : les trois nouveaux ATS sont branchés et le jeton de l’URL est posé (le lien SmartRecruiters le reprend)', () => {
    expect(parseBoard('https://balena.workable.com/', sample('workable_widget.sample.json'), 'Balena', NOW).jobs[0]?.ats).toMatchObject({ ats: 'workable', token: 'balena' });
    expect(parseBoard('https://astronomer.recruitee.com/', sample('recruitee_offers.sample.json'), 'Astronomer', NOW).jobs[0]?.ats).toMatchObject({ ats: 'recruitee', token: 'astronomer' });
    const smart = parseBoard('https://jobs.smartrecruiters.com/meridian', sample('smartrecruiters_postings.sample.json'), 'Meridian', NOW);
    expect(smart.jobs[0]?.ats.token).toBe('meridian');
    expect(smart.jobs[0]?.link).toBe('https://jobs.smartrecruiters.com/meridian/744000045001001');
  });

  test('groupByCountry : la même offre Workable publiée en Espagne et aux États-Unis est une ligne ; dedupeAgainstBoard écarte ce que le tableau a', () => {
    const workable = parseWorkable(sample('workable_widget.sample.json'), 'Balena', NOW).jobs;
    const rows = groupByCountry(workable);
    expect(rows.map((r) => r.title)).toEqual(['Growth & Lifecycle Marketing Manager', 'Account Executive']);
    expect(rows[0]?.locations).toEqual(['Barcelona, Spain', 'Austin, TX, United States']);
    expect(rows[0]?.variants.map((v) => v.id)).toEqual(['WRK-A1B2C3D4E5', 'WRK-F6G7H8I9J0']);
    const board = [
      { slug: 'balena', company: 'BALENA', title: 'Growth &amp; Lifecycle Marketing Manager', link: 'https://es.linkedin.com/jobs/view/456', status: 'PENDING_VALIDATION' },
      { slug: 'astronomer', company: 'Astronomer', title: 'SDR', link: 'https://astronomer.recruitee.com/o/sales-development-representative/', status: 'APPLIED' },
    ];
    const recruitee = parseRecruitee(sample('recruitee_offers.sample.json'), 'Astronomer', NOW).jobs;
    const smart = parseSmartRecruiters(sample('smartrecruiters_postings.sample.json'), 'Meridian', NOW).jobs;
    const { fresh, duplicates } = dedupeAgainstBoard([...rows, ...recruitee, ...smart], board);
    expect(duplicates).toEqual([
      { id: 'WRK-A1B2C3D4E5', reason: 'same company and title as balena' },
      { id: 'REC-2300102', reason: 'same posting link as astronomer' },
    ]);
    expect(fresh.map((c) => c.id)).toEqual(['WRK-K1L2M3N4O5', 'REC-2300101', 'REC-2300103', 'SMR-744000045001001', 'SMR-744000045001002', 'SMR-744000045001003']);
  });
});

describe('groupByCountry : une ligne par offre, les pays en liste', () => {
  test('la même offre publiée par pays est une ligne, la plus récente devant, avec ses variantes', () => {
    const { jobs } = parseGreenhouse(sample('greenhouse_jobs.sample.json'), 'Nordlys', NOW);
    const rows = groupByCountry(jobs);
    expect(rows.map((r) => r.title)).toEqual(['Growth Marketing Manager', 'Senior Backend Engineer (Go)']);
    const [growth] = rows;
    expect(growth?.id).toBe('GH-7001001');
    expect(growth?.locations).toEqual(['Remote - Spain', 'Remote - Portugal']);
    expect(growth?.location).toBe('Remote - Spain, Remote - Portugal');
    expect(growth?.variants.map((v) => v.id)).toEqual(['GH-7001001', 'GH-7001002']);
  });

  test('deux lignes au même lien (requête de suivi en plus) ne comptent qu’une variante ; le télétravail d’une variante vaut pour la ligne', () => {
    const { jobs } = parseGreenhouse(sample('greenhouse_jobs.sample.json'), 'Nordlys', NOW);
    const twice = [...jobs, { ...jobs[0]!, id: 'GH-copy', link: 'https://boards.greenhouse.io/nordlys/jobs/7001001?utm_source=x', location: 'Remote - Spain' }];
    const rows = groupByCountry(twice);
    expect(rows[0]?.variants.length).toBe(2);
    const onsite = [{ ...jobs[2]!, remote_declared: false }, { ...jobs[2]!, id: 'GH-x', link: 'https://boards.greenhouse.io/nordlys/jobs/9', location: 'Remote', remote_declared: true }];
    expect(groupByCountry(onsite)[0]?.remote_declared).toBe(true);
  });
});

describe('matchesTarget : le filtre de index.js, déjà large', () => {
  const queries = ['growth marketing specialist', 'revenue operations analyst', 'chargé de marketing digital'];
  test('sans requêtes tout passe ; un mot du domaine dans le titre suffit, même loin des intitulés visés', () => {
    expect(matchesTarget({ title: 'Senior Backend Engineer' })).toBe(true);
    expect(matchesTarget({ title: 'VP Marketing' }, queries)).toBe(true);
    expect(matchesTarget({ title: 'Operations Associate (warehouse)' }, queries)).toBe(true);
    expect(matchesTarget({ title: 'CRM Developer (Dynamics 365)' }, queries)).toBe(true);
  });
  test('sinon l’intitulé visé dans le titre, ou tous ses mots de plus de trois lettres, ou l’intitulé exact dans le corps', () => {
    expect(matchesTarget({ title: 'Analyst, Revenue Operations' }, queries)).toBe(true);
    expect(matchesTarget({ title: 'Senior Backend Engineer (Go)' }, queries)).toBe(false);
    expect(matchesTarget({ title: 'Senior Backend Engineer (Go)', description: 'You will sit next to our revenue operations analyst.' }, queries)).toBe(true);
    expect(matchesTarget({ title: 'Office Manager', description: 'Front desk.' }, queries)).toBe(false);
  });
});

describe('dedupeAgainstBoard : ce que le tableau a déjà', () => {
  const board = [
    { slug: 'nordlys', company: 'NORDLYS', title: 'Growth Marketing Manager', link: 'https://es.linkedin.com/jobs/view/123', status: 'PENDING_VALIDATION' },
    { slug: 'kestrel', company: 'Kestrel', title: 'Office Manager', link: 'https://jobs.lever.co/kestrel/a1b2c3d4-0000-4000-8000-000000000002/', status: 'APPLIED' },
  ];
  test('même entreprise + intitulé (vu par LinkedIn) ou même lien d’ATS : écartés avec la raison ; le reste passe', () => {
    const gh = parseGreenhouse(sample('greenhouse_jobs.sample.json'), 'Nordlys', NOW).jobs;
    const lever = parseLever(sample('lever_postings.sample.json'), 'Kestrel', NOW).jobs;
    const { fresh, duplicates } = dedupeAgainstBoard([...groupByCountry(gh), ...lever], board);
    expect(duplicates).toEqual([
      { id: 'GH-7001001', reason: 'same company and title as nordlys' },
      { id: 'LEV-a1b2c3d4-0000-4000-8000-000000000002', reason: 'same posting link as kestrel' },
    ]);
    expect(fresh.map((c) => c.id)).toEqual(['GH-7001003', 'LEV-a1b2c3d4-0000-4000-8000-000000000001']);
  });
});
