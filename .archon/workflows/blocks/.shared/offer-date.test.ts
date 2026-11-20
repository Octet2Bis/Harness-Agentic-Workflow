import { describe, expect, test } from 'bun:test';
import { DEFAULT_OFFER_AGE_MAX_DAYS, ageLimitFor, isoDay, offerAge, parseOfferDate, parseRelativeDate, readOfferAgeMaxDays, tooOld, tooOldReason } from './offer-date.ts';

const NOW = new Date('2026-10-23T20:00:00Z');
const day = (v: unknown, anchor: Date = NOW): string | null => {
  const d = parseOfferDate(v, anchor);
  return d === null ? null : isoDay(d);
};

describe('parseOfferDate : les formes des sources', () => {
  test('ISO, jour seul ou avec heure et fuseau', () => {
    expect(day('2026-10-16')).toBe('2026-10-16');
    expect(day('2026-10-23T07:09:57+00:00')).toBe('2026-10-23');
    expect(day('2026-10-22T23:30:00Z')).toBe('2026-10-22');
    expect(day('2026-10-22 08:00:00')).toBe('2026-10-22');
  });
  test('epoch en secondes et en millisecondes, nombre ou chaîne', () => {
    const s = Math.floor(Date.parse('2026-10-20T10:00:00Z') / 1000);
    expect(day(s)).toBe('2026-10-20');
    expect(day(s * 1000)).toBe('2026-10-20');
    expect(day(String(s))).toBe('2026-10-20');
    expect(day(String(s * 1000))).toBe('2026-10-20');
    expect(day(0)).toBeNull();
    expect(day(42)).toBeNull(); // 1970 : pas une date de publication
  });
  test('RFC 2822 des flux RSS, avec ou sans heure', () => {
    expect(day('Fri, 23 Oct 2026 10:00:00 +0000')).toBe('2026-10-23');
    expect(day('Thu, 15 Oct 2026 23:59:00 GMT')).toBe('2026-10-15');
    expect(day('Fri, 23 Oct 2026')).toBe('2026-10-23');
    expect(day('5 Oct 2026')).toBe('2026-10-05');
  });
  test('dates relatives en anglais', () => {
    expect(day('3 days ago')).toBe('2026-10-20');
    expect(day('Posted 2 weeks ago')).toBe('2026-10-09');
    expect(day('a day ago')).toBe('2026-10-22');
    expect(day('an hour ago')).toBe('2026-10-23');
    expect(day('30+ days ago')).toBe('2026-09-23');
    expect(day('1 month ago')).toBe('2026-09-23');
    expect(day('3h ago')).toBe('2026-10-23');
    expect(day('today')).toBe('2026-10-23');
    expect(day('Yesterday')).toBe('2026-10-22');
    expect(day('just now')).toBe('2026-10-23');
  });
  test('dates relatives en français (WTTJ)', () => {
    expect(day('il y a 3 jours')).toBe('2026-10-20');
    expect(day('Il y a 8 jours')).toBe('2026-10-15');
    expect(day('il y a une semaine')).toBe('2026-10-16');
    expect(day('il y a 2 semaines')).toBe('2026-10-09');
    expect(day('il y a plus de 30 jours')).toBe('2026-09-23');
    expect(day('il y a un mois')).toBe('2026-09-23');
    expect(day('il y a 1 an')).toBe('2025-10-23');
    expect(day('il y a 1 heure')).toBe('2026-10-23');
    expect(day("aujourd'hui")).toBe('2026-10-23');
    expect(day('hier')).toBe('2026-10-22');
    expect(day('avant-hier')).toBe('2026-10-21');
    expect(day("à l'instant")).toBe('2026-10-23');
    expect(day('Publiée il y a 4 jours')).toBe('2026-10-19');
  });
  test('une borne en heures (« < 24h (filtre LinkedIn) ») compte pour maintenant ; « 3h » pour il y a 3 heures', () => {
    expect(day('< 24h (filtre LinkedIn)')).toBe('2026-10-23');
    expect(day('last 24 hours')).toBe('2026-10-23');
    expect(day('3h', new Date('2026-10-23T01:00:00Z'))).toBe('2026-10-22');
  });
  test('relatif compté depuis le moment de lecture (anchor), pas depuis le tri', () => {
    expect(day('il y a 3 jours', new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-07');
    expect(parseRelativeDate('2 days ago', new Date('2026-10-10T12:00:00Z'))?.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });
  test('rien de lisible : null (jamais une date inventée)', () => {
    for (const v of ['', '   ', 'récent', 'Product Manager 2', 'n/a', null, undefined, {}, [], 'il y a', 'il y a quelques jours', '3 bananas ago', true]) expect(day(v)).toBeNull();
  });
});

describe('offerAge et tooOld : la règle d’âge', () => {
  test('jours de calendrier : le 16 pour le 23, 7 jours ; le 15, 8 jours', () => {
    expect(offerAge('2026-10-16', NOW)).toEqual({ day: '2026-10-16', days: 7 });
    expect(offerAge('2026-10-15T23:00:00Z', NOW)).toEqual({ day: '2026-10-15', days: 8 });
    expect(offerAge('', NOW)).toBeNull();
  });
  test('au-delà de N : la raison dit la date et N ; à N, après N, illisible, future ou N = 0 : rien', () => {
    expect(tooOld('2026-10-15', 7, NOW)).toBe('offre trop ancienne (publiée le 2026-10-15, > 7 jours)');
    expect(tooOld('2026-10-16', 7, NOW)).toBeNull();
    expect(tooOld('il y a 8 jours', 7, NOW)).toBe('offre trop ancienne (publiée le 2026-10-15, > 7 jours)');
    expect(tooOld('2026-10-20', 2, NOW)).toBe(tooOldReason('2026-10-20', 2));
    expect(tooOld('récent', 7, NOW)).toBeNull();
    expect(tooOld('2026-11-30', 7, NOW)).toBeNull();
    expect(tooOld('2020-01-01', 0, NOW)).toBeNull();
  });
  test('une date relative se compte depuis sa lecture : « il y a 3 jours » lu il y a 10 jours a 13 jours', () => {
    expect(tooOld('il y a 3 jours', 7, NOW, new Date('2026-10-13T20:00:00Z'))).toBe('offre trop ancienne (publiée le 2026-10-10, > 7 jours)');
    expect(tooOld('il y a 3 jours', 7, NOW)).toBeNull();
  });
});

describe('readOfferAgeMaxDays : offre_age_max_jours de criteres.json', () => {
  test('absent : 7 ; entier : lui ; 0 : règle coupée', () => {
    expect(DEFAULT_OFFER_AGE_MAX_DAYS).toBe(7);
    expect(readOfferAgeMaxDays({ langues: ['fr'] })).toEqual({ days: 7, problem: null });
    expect(readOfferAgeMaxDays(null)).toEqual({ days: 7, problem: null });
    expect(readOfferAgeMaxDays({ offre_age_max_jours: null })).toEqual({ days: 7, problem: null });
    expect(readOfferAgeMaxDays({ offre_age_max_jours: 14 })).toEqual({ days: 14, problem: null });
    expect(readOfferAgeMaxDays({ offre_age_max_jours: 0 })).toEqual({ days: 0, problem: null });
  });
  test('autre chose : un problème, et le défaut', () => {
    for (const bad of ['7', 2.5, -1, true]) {
      const r = readOfferAgeMaxDays({ offre_age_max_jours: bad });
      expect(r.days).toBe(7);
      expect(r.problem).toContain('offre_age_max_jours');
    }
  });
});

describe('ageLimitFor : pas de limite sur le site de l’employeur', () => {
  test('sites et tableaux des employeurs sans limite, sites d’emploi inchangés', () => {
    for (const src of ['Tableaux employeurs (Greenhouse)', 'Entreprise full remote (Ashby)', 'Apify ATS', 'Workable (search)', 'Freehire (api)', 'Jobdatalake']) expect(ageLimitFor(src, 7)).toBe(0);
    expect(ageLimitFor('LinkedIn (Live 24h)', 7)).toBe(7);
    expect(ageLimitFor('Himalayas', 7)).toBe(7);
    expect(ageLimitFor(undefined, 7)).toBe(7);
  });
});
