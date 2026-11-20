import { describe, expect, test } from 'bun:test';
import { companyLinkConflict, linkEmployer, reconciles } from './company-link.ts';

const li = (slug: string) => `https://es.linkedin.com/jobs/view/growth-marketing-specialist-at-${slug}-4300000001`;

describe('linkEmployer : ce que le lien dit de l’employeur', () => {
  test('LinkedIn : le dernier « -at- » avant l’identifiant, preuve forte', () => {
    expect(linkEmployer(li('everai'))).toEqual({ token: 'everai', strength: 'strong', where: 'LinkedIn link' });
    expect(linkEmployer('https://www.linkedin.com/jobs/view/head-of-growth-at-scale-at-ideal-direct-4012345678')?.token).toBe('ideal-direct');
  });
  test('LinkedIn sans nom dans le lien (…/jobs/view/<id>) : rien à dire', () => {
    expect(linkEmployer('https://pt.linkedin.com/jobs/view/4475957729')).toBeNull();
    expect(linkEmployer('https://www.linkedin.com/company/darkroom')).toBeNull();
  });
  test('ATS : identifiant du tableau, preuve faible', () => {
    expect(linkEmployer('https://job-boards.greenhouse.io/bpcs/jobs/7477705')).toEqual({ token: 'bpcs', strength: 'weak', where: 'ATS board job-boards.greenhouse.io' });
    expect(linkEmployer('https://jobs.lever.co/AIFund/abc')?.token).toBe('AIFund');
    expect(linkEmployer('https://jobs.ashbyhq.com/supabase/123')?.token).toBe('supabase');
    expect(linkEmployer('https://acme.recruitee.com/o/growth')?.token).toBe('acme');
    expect(linkEmployer('https://bettervits.wd3.myworkdayjobs.com/en-US/x/job/1')?.token).toBe('bettervits');
    expect(linkEmployer('https://boards.greenhouse.io/embed/job_app?for=acme')).toBeNull();
  });
  test('autres liens, lien illisible : null', () => {
    expect(linkEmployer('https://euremotejobs.com/?p=47722')).toBeNull();
    expect(linkEmployer('https://jobs.workable.com/view/abc')).toBeNull();
    expect(linkEmployer('pas une url')).toBeNull();
    expect(linkEmployer('')).toBeNull();
  });
});

describe('reconciles : même employeur malgré la casse, les accents, la ponctuation, la forme juridique', () => {
  for (const [company, token] of [
    ['Darkroom', 'darkroom'],
    ['notebooksbilliger.de', 'notebooksbilliger-de'],
    ['StarTech.com', 'startech-com'],
    ['Triangle Grup de Serveis', 'triangle-grup-de-serveis'],
    ['Ideal Direct', 'ideal-direct'],
    ['Graphica Digitalis', 'graphica-digitalis'],
    ['Société Générale', 'societe-generale'],
    ["L'Oréal", 'loreal'],
    ['Procter &amp; Gamble', 'procter-gamble'],
    ['Acme SAS', 'acme'],
    ['Supabase', 'supabase'],
    ['Bettervits Ltd', 'bettervits'],
  ]) {
    test(`${company} ~ ${token}`, () => expect(reconciles(company!, token!)).toBe(true));
  }
  for (const [company, token] of [
    ['Bizneo HR', 'everai'],
    ['OnTheGoSystems', 'darkroom'],
    ['notebooksbilliger.de', 'bettervits'],
    ['Triangle Grup de Serveis', 'graphica-digitalis'],
    ['StarTech.com', 'ideal-direct'],
  ]) {
    test(`${company} ≠ ${token} (les cinq lignes du 2026-10-24)`, () => expect(reconciles(company!, token!)).toBe(false));
  }
});

describe('companyLinkConflict', () => {
  test('les cinq lignes observées : refusables (preuve forte)', () => {
    const r = companyLinkConflict('Bizneo HR', li('everai'));
    expect(r).toEqual({ reason: '« Bizneo HR » ne correspond pas à l\'employeur « everai » du lien (LinkedIn link)', strength: 'strong' });
    expect(companyLinkConflict('OnTheGoSystems', li('darkroom'))?.strength).toBe('strong');
    expect(companyLinkConflict('notebooksbilliger.de', li('bettervits'))?.strength).toBe('strong');
    expect(companyLinkConflict('Triangle Grup de Serveis', li('graphica-digitalis'))?.strength).toBe('strong');
    expect(companyLinkConflict('StarTech.com', li('ideal-direct'))?.strength).toBe('strong');
  });
  test('d’accord, ou rien à comparer : null', () => {
    expect(companyLinkConflict('EverAI', li('everai'))).toBeNull();
    expect(companyLinkConflict('Entreprise non communiquée', li('everai'))).toBeNull();
    expect(companyLinkConflict('', li('everai'))).toBeNull();
    expect(companyLinkConflict(undefined, li('everai'))).toBeNull();
    expect(companyLinkConflict('Smartness', 'https://pt.linkedin.com/jobs/view/4475957729')).toBeNull();
    expect(companyLinkConflict('Primer', 'https://euremotejobs.com/?p=47722')).toBeNull();
  });
  test('identifiant d’ATS abrégé : seulement signalé (preuve faible)', () => {
    expect(companyLinkConflict('Blueprint Technologies', 'https://job-boards.greenhouse.io/bpcs/jobs/7477705')?.strength).toBe('weak');
  });
});
