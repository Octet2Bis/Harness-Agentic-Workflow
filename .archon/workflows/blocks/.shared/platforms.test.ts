import { describe, expect, test } from 'bun:test';
import {
  applicationForm,
  applyUrlProblems,
  confirmationFound,
  detectRoute,
  handoverFor,
  hostAllowed,
  hostOf,
  hostPolicy,
  isMailto,
  needsHumanGo,
  pageHostProblems,
  parseSubmitMode,
  parseVerifiedPlatforms,
  urlSafetyProblems,
} from './platforms.ts';

describe('detectRoute', () => {
  test('reconnaît les ATS', () => {
    expect(detectRoute('https://jobs.lever.co/acme/123').platform).toBe('lever');
    expect(detectRoute('https://job-boards.greenhouse.io/acme/jobs/1')).toMatchObject({ platform: 'greenhouse', method: 'form', aggregator: false });
    expect(detectRoute('https://acme.teamtailor.com/jobs/1-growth').platform).toBe('teamtailor');
    expect(detectRoute('https://acme.wd3.myworkdayjobs.com/en-US/x/job/1')).toMatchObject({ platform: 'workday', needsAccount: true });
  });
  test('reconnaît les agrégateurs et les sites inconnus', () => {
    expect(detectRoute('https://fr.linkedin.com/jobs/view/sales-ops-at-station-f-4465779260')).toMatchObject({ platform: 'linkedin', aggregator: true, method: 'easy_apply' });
    expect(detectRoute('https://himalayas.app/companies/bellesa/jobs/email-marketing')).toMatchObject({ platform: 'himalayas', aggregator: true });
    expect(detectRoute('https://www.acme-corp.com/careers/growth-ops')).toMatchObject({ platform: 'unknown', host: 'acme-corp.com', aggregator: false });
  });
  test('hostOf tolère une URL invalide', () => {
    expect(hostOf('pas une url')).toBe('');
    expect(detectRoute('pas une url').platform).toBe('unknown');
  });
});

describe('applyUrlProblems', () => {
  test('accepte un ATS en https et un mailto', () => {
    expect(applyUrlProblems('https://jobs.ashbyhq.com/acme/uuid')).toEqual([]);
    expect(applyUrlProblems('mailto:jobs@acme.com')).toEqual([]);
    expect(isMailto('mailto:jobs@acme.com')).toBe(true);
  });
  test('refuse un agrégateur, sauf LinkedIn en candidature simplifiée', () => {
    expect(applyUrlProblems('https://uk.linkedin.com/jobs/view/1')[0]).toContain('aggregator (LinkedIn)');
    expect(applyUrlProblems('https://uk.linkedin.com/jobs/view/1', { easyApply: true })).toEqual([]);
    expect(applyUrlProblems('https://himalayas.app/jobs/1')[0]).toContain('aggregator (Himalayas)');
  });
  test('refuse http et le vide', () => {
    expect(applyUrlProblems('http://jobs.lever.co/acme/1')[0]).toContain('not https');
    expect(applyUrlProblems('')).toEqual(['apply URL is empty']);
  });
});

describe('confirmationFound / needsHumanGo', () => {
  test('reconnaît une confirmation, spécifique ou générique, en FR et EN', () => {
    expect(confirmationFound('Thank you for applying to Acme!', 'lever')).toBe('thank you for applying');
    expect(confirmationFound('Votre candidature a bien été envoyée.', 'unknown')).toBe('candidature a bien été envoyée');
    expect(confirmationFound('Please complete the required fields', 'greenhouse')).toBeNull();
  });
  test('le go humain dépend du mode et des plateformes vérifiées', () => {
    expect(needsHumanGo('confirm', 'lever', ['lever'])).toBe(true);
    expect(needsHumanGo('auto', 'lever', [])).toBe(false);
    expect(needsHumanGo('verified-only', 'lever', ['lever'])).toBe(false);
    expect(needsHumanGo('verified-only', 'greenhouse', ['lever'])).toBe(true);
  });
});

describe('parseSubmitMode / parseVerifiedPlatforms (gate et check_prefill lisent pareil)', () => {
  test('auto et confirm tels quels, tout le reste verified-only', () => {
    expect(parseSubmitMode(' confirm ')).toBe('confirm');
    expect(parseSubmitMode('auto')).toBe('auto');
    expect(parseSubmitMode('')).toBe('verified-only');
    expect(parseSubmitMode('AUTO')).toBe('verified-only');
    expect(parseVerifiedPlatforms(' lever, ,greenhouse ')).toEqual(['lever', 'greenhouse']);
    expect(parseVerifiedPlatforms('')).toEqual([]);
  });
});

describe('applicationForm : où s’ouvre le formulaire (le script, pas la supposition de l’agent)', () => {
  test('Greenhouse : la page embed/job_app hors de l’iframe, depuis l’annonce, gh_jid ou l’embed, UE comprise', () => {
    const direct = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4567';
    expect(applicationForm('https://boards.greenhouse.io/acme/jobs/4567')).toMatchObject({ platform: 'greenhouse', form_url: direct, needs_login: false, handover: false });
    expect(applicationForm('https://job-boards.greenhouse.io/acme/jobs/4567?gh_src=x').form_url).toBe(direct);
    expect(applicationForm('https://boards.greenhouse.io/acme?gh_jid=4567').form_url).toBe(direct);
    expect(applicationForm('https://boards.greenhouse.io/embed/job_app?for=acme&token=4567').form_url).toBe(direct);
    expect(applicationForm('https://job-boards.eu.greenhouse.io/acme/jobs/4567').form_url).toBe('https://job-boards.eu.greenhouse.io/embed/job_app?for=acme&token=4567');
    // Sans identifiant d'annonce : l'URL telle quelle, et la marche à suivre.
    expect(applicationForm('https://boards.greenhouse.io/acme')).toMatchObject({ form_url: 'https://boards.greenhouse.io/acme', platform: 'greenhouse' });
  });
  test('Lever + /apply, Ashby + /application, Workable + /apply/ ; déjà suffixée, l’URL reste', () => {
    expect(applicationForm('https://jobs.lever.co/acme/0a1b-2c3d').form_url).toBe('https://jobs.lever.co/acme/0a1b-2c3d/apply');
    expect(applicationForm('https://jobs.lever.co/acme/0a1b-2c3d/apply').form_url).toBe('https://jobs.lever.co/acme/0a1b-2c3d/apply');
    expect(applicationForm('https://jobs.eu.lever.co/acme/0a1b?lever-source=LinkedIn').form_url).toBe('https://jobs.eu.lever.co/acme/0a1b/apply?lever-source=LinkedIn');
    expect(applicationForm('https://jobs.ashbyhq.com/acme/uuid-1').form_url).toBe('https://jobs.ashbyhq.com/acme/uuid-1/application');
    expect(applicationForm('https://apply.workable.com/acme/j/ABC123/').form_url).toBe('https://apply.workable.com/acme/j/ABC123/apply/');
  });
  test('Workday, SuccessFactors, Taleo : la session qu’Antoine a ouverte dans le navigateur du robot, jamais un compte créé (2026-10-24)', () => {
    const wd = applicationForm('https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/Growth-Ops_R123');
    expect(wd).toMatchObject({ platform: 'workday', needs_login: true, handover: false, form_url: 'https://acme.wd3.myworkdayjobs.com/en-US/External/job/Paris/Growth-Ops_R123/apply' });
    expect(wd.how).toContain('ne crée jamais');
    expect(applicationForm('https://careers.acme.com/job/123', 'workday')).toMatchObject({ needs_login: true, handover: false, form_url: 'https://careers.acme.com/job/123' });
    expect(handoverFor('https://acme.wd1.myworkdayjobs.com/x')).toBeNull();
    expect(applicationForm('https://career4.successfactors.com/career?company=danaP&career_job_req_id=1')).toMatchObject({ platform: 'successfactors', needs_login: true, handover: false, form_url: 'https://career4.successfactors.com/career?company=danaP&career_job_req_id=1' });
    expect(applicationForm('https://acme.taleo.net/careersection/2/jobdetail.ftl?job=1').how).toContain('Taleo');
    expect(hostAllowed('career4.successfactors.com', hostPolicy('https://jobs.dana.com/talentcommunity/apply/1/').hosts)).toBe(true);
  });
  test('Welcome to the Jungle, LinkedIn : la session du profil ; un agrégateur n’est pas un formulaire ; SmartRecruiters, e-mail, site d’employeur', () => {
    expect(applicationForm('https://www.welcometothejungle.com/fr/companies/acme/jobs/growth')).toMatchObject({ platform: 'wttj', needs_login: true, handover: false });
    expect(applicationForm('https://fr.linkedin.com/jobs/view/123')).toMatchObject({ platform: 'linkedin', needs_login: true, form_url: 'https://fr.linkedin.com/jobs/view/123' });
    expect(applicationForm('https://fr.indeed.com/viewjob?jk=1')).toMatchObject({ platform: 'indeed', form_url: '', needs_login: true });
    expect(applicationForm('https://jobs.smartrecruiters.com/Acme/123-growth').how).toContain('jobs.smartrecruiters.com');
    expect(applicationForm('mailto:jobs@acme.com')).toMatchObject({ platform: 'email', form_url: '' });
    const site = applicationForm('https://www.acme.com/careers/growth?gh_jid=42');
    expect(site).toMatchObject({ platform: 'unknown', form_url: 'https://www.acme.com/careers/growth?gh_jid=42', handover: false });
    expect(site.how).toContain('gh_jid=42');
  });
  test('une URL douteuse ou illisible : rien à ouvrir', () => {
    expect(applicationForm('http://jobs.lever.co/acme/1')).toMatchObject({ platform: 'lever', form_url: '' });
    expect(applicationForm('https://greenhouse.io@evil.com/acme').form_url).toBe('');
    expect(applicationForm('pas une url').form_url).toBe('');
  });
});

describe('hostPolicy / pageHostProblems : l’hôte exact ou un vrai sous-domaine, jamais un sosie', () => {
  const greenhouse = hostPolicy('https://boards.greenhouse.io/acme/jobs/4567', 'greenhouse');
  const ip = [203, 0, 113, 7].join('.');

  test('l’hôte de la plateforme et ses sous-domaines passent', () => {
    expect(pageHostProblems('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=4567', greenhouse, 'Le formulaire')).toEqual([]);
    expect(pageHostProblems('https://boards.greenhouse.io/acme/jobs/4567', greenhouse, 'Le formulaire')).toEqual([]);
    expect(hostAllowed('JOB-BOARDS.GREENHOUSE.IO', ['job-boards.greenhouse.io'])).toBe(true);
  });

  test('refusés : sosies (suffixe, préfixe, tiret), autre ATS, http, identifiants, port, punycode, IP, point final', () => {
    const refused = [
      'https://job-boards.greenhouse.io.evil.com/embed/job_app',
      'https://boards.greenhouse-io.com/acme',
      'https://evil-boards.greenhouse.io.com/acme',
      'https://greenhouse.io/acme',
      'https://jobs.lever.co/acme/1/apply',
      'http://job-boards.greenhouse.io/embed/job_app',
      'https://job-boards.greenhouse.io@evil.com/embed',
      'https://evil.com\\@job-boards.greenhouse.io/embed',
      'https://job-boards.greenhouse.io:8443/embed',
      'https://job-boards.gréénhouse.io/embed',
      `https://${ip}/embed`,
      'https://job-boards.greenhouse.io./embed',
      'javascript:alert(1)',
      '',
    ];
    for (const url of refused) {
      const problems = pageHostProblems(url, greenhouse, 'Le formulaire');
      expect(problems.length).toBeGreaterThan(0);
      expect(problems[0]).toStartWith('Le formulaire');
    }
    expect(pageHostProblems('https://job-boards.greenhouse.io.evil.com/x', greenhouse, 'Le formulaire')[0]).toContain('hors des hôtes autorisés pour greenhouse');
    expect(urlSafetyProblems('https://jоbs.lever.co/acme', 'La page')[0]).toContain('punycode');
  });

  test('le site d’un employeur : son hôte (sans www) et les ATS connus, jamais un agrégateur', () => {
    const site = hostPolicy('https://www.acme.com/careers/growth', 'unknown');
    expect(site.platform).toBe('unknown');
    for (const ok of ['https://acme.com/careers/apply', 'https://careers.acme.com/apply', 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1', 'https://jobs.lever.co/acme/1/apply']) {
      expect(pageHostProblems(ok, site, 'La page')).toEqual([]);
    }
    for (const no of ['https://acme.com.evil.net/apply', 'https://www.linkedin.com/jobs/view/1', 'https://himalayas.app/jobs/1']) {
      expect(pageHostProblems(no, site, 'La page')[0]).toContain("hors des hôtes autorisés pour ce site d'employeur");
    }
  });

  test('LinkedIn « Candidature simplifiée » : linkedin.com seulement ; un mailto : aucun hôte ; une URL de candidature douteuse n’autorise pas son hôte', () => {
    expect(hostPolicy('https://fr.linkedin.com/jobs/view/1', 'linkedin').hosts).toEqual(['linkedin.com']);
    expect(hostPolicy('mailto:jobs@acme.com', 'email').hosts).toEqual([]);
    expect(hostPolicy('http://careers.acme.com/apply', 'unknown').hosts).not.toContain('careers.acme.com');
    expect(hostPolicy('https://careers.acme.com/job/1', 'lever').hosts).toEqual(['jobs.lever.co', 'jobs.eu.lever.co', 'careers.acme.com']);
  });
});
