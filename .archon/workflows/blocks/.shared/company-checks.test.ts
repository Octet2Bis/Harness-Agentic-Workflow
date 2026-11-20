import { describe, expect, test } from 'bun:test';
import { checkDossier, checkProposal, quoted } from './company-checks.ts';

const activity = "Acme édite un logiciel de planification pour les équipes d'événementiel, vendu par abonnement aux agences européennes de taille moyenne.";
const dossier = `# Dossier : Acme

Pays : FR
Site : https://acme.example
Full remote : la page carrières annonce « 100 % remote, partout en Europe » [S2]

## Activité

- ${activity} [S1]
- L'équipe compte une quarantaine de personnes réparties dans six pays. [S2]

## Concurrents

- **Planito** : même cible, prix plus bas, pas d'intégration billetterie [S3]
- **Eventsy** : vise les grands comptes [S3]
- **Crewly** : spécialiste des bénévoles [S4]

## Signaux récents

- 2026-06 : levée de 8 M€ pour s'étendre en Espagne et en Italie [S4]
- 2026-09-15 : lancement d'un module de gestion des bénévoles [S1]

## Recrutement

- Head of Growth, poste ouvert en remote [S2]

## Besoins probables

- B1 : structurer l'acquisition sur deux nouveaux marchés après la levée [S4]
- B2 : faire adopter le module bénévoles par les agences existantes [S1]

## Contact

- Claire Martin, CEO, adresse publiée claire@acme.example [S2]
- Canal : email

## Sources

- [S1] Site d'Acme — https://acme.example
- [S2] Page carrières — https://acme.example/careers
- [S3] Comparatif des outils — https://comparatif.example/outils
- [S4] Article sur la levée — https://presse.example/acme-leve-8-millions
`;

describe('checkDossier', () => {
  test('accepte un dossier complet', () => {
    expect(checkDossier(dossier, 'Acme', '2026-10-23')).toEqual({ ok: true, problems: [], country: 'FR', channel: 'email' });
  });

  test("refuse l'e-mail froid pour une entreprise allemande", () => {
    const result = checkDossier(dossier.replace('Pays : FR', 'Pays : DE'), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('channel "email" is not allowed for a company in DE')]);
  });

  test("refuse le canal e-mail sans adresse publiée", () => {
    const result = checkDossier(dossier.replace(', adresse publiée claire@acme.example', ''), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('never guess one')]);
  });

  test('refuse un signal de plus de douze mois et un signal futur', () => {
    const result = checkDossier(dossier.replace('2026-06 :', '2025-06 :').replace('2026-09-15', '2026-12-01'), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('more than 12 months ago'), expect.stringContaining('after today')]);
  });

  test('refuse moins de trois concurrents (l\'entreprise elle-même ne compte pas)', () => {
    const result = checkDossier(dossier.replace('**Crewly**', '**Acme**'), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('only 2 distinct competitor(s)')]);
  });

  test('refuse une affirmation sans source ou citant une source absente', () => {
    const result = checkDossier(dossier.replace(`${activity} [S1]`, activity).replace('vise les grands comptes [S3]', 'vise les grands comptes [S9]'), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('"## Activité" item 1 cites no source'), expect.stringContaining('cites [S9]')]);
  });

  test('refuse moins de quatre sources web et une source sans URL', () => {
    const result = checkDossier(dossier.replace('https://presse.example/acme-leve-8-millions', 'notes internes'), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('only 3 distinct web source(s)'), expect.stringContaining('source [S4] does not end with an http(s) URL')]);
  });

  test('exige le pays, le site, la preuve du full remote et le canal', () => {
    const result = checkDossier(dossier.replace('Pays : FR\n', '').replace('Site : https://acme.example\n', '').replace(/^Full remote.*\n/m, '').replace('- Canal : email\n', ''), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([
      expect.stringContaining('"Pays :'),
      expect.stringContaining('"Site :'),
      expect.stringContaining('"Full remote :'),
      expect.stringContaining('"- Canal :'),
    ]);
  });

  test('exige deux à quatre besoins', () => {
    const result = checkDossier(dossier.replace(/^- B2 .*\n/m, ''), 'Acme', '2026-10-23');
    expect(result.problems).toEqual([expect.stringContaining('lists 1 need(s)')]);
  });

  test('refuse un fichier absent', () => {
    expect(checkDossier(null, 'Acme', '2026-10-23').ok).toBe(false);
  });
});

const profile = "Directeur des opérations : j'ai lancé l'activité sur trois nouveaux marchés européens en 18 mois, de zéro à 40 clients.";
const diagnostic = Array.from({ length: 200 }, (_, i) => (i % 10 === 9 ? 'marché.' : 'mot')).join(' ');
const proposal = `# Proposition : Acme

## Axes

### Ouvrir l'Espagne et l'Italie

- Besoin : « structurer l'acquisition sur deux nouveaux marchés après la levée »
- Preuve : « j'ai lancé l'activité sur trois nouveaux marchés européens en 18 mois »
- Formule : freelance, CDI

## Mini-diagnostic

${diagnostic}

## Accroche

J'ai regardé comment Acme pourrait ouvrir l'Espagne après sa levée et j'en ai tiré une page de pistes concrètes. Si elle vous parle, on en discute vingt minutes ?
`;

describe('checkProposal', () => {
  const context = { dossier, profile, formulas: ['CDI', 'freelance', 'portage'] };

  test('accepte une proposition complète', () => {
    expect(checkProposal(proposal, context)).toEqual({ ok: true, problems: [], axes: 1 });
  });

  test('refuse un besoin absent du dossier et une preuve absente du profil', () => {
    const result = checkProposal(proposal.replace('deux nouveaux marchés', 'trois nouveaux pays').replace('en 18 mois', 'en 6 mois'), context);
    expect(result.problems).toEqual([expect.stringContaining('is not quoted word for word from "## Besoins probables"'), expect.stringContaining("from the candidate's profile")]);
  });

  test('refuse une formule que le candidat n\'accepte pas', () => {
    const result = checkProposal(proposal.replace('freelance, CDI', 'stage'), context);
    expect(result.problems).toEqual([expect.stringContaining('formula "stage"')]);
  });

  test('refuse un mini-diagnostic trop court et une accroche sans question', () => {
    const result = checkProposal(proposal.replace(diagnostic, 'trop court '.repeat(60)).replace('on en discute vingt minutes ?', 'on en discute.'), context);
    expect(result.problems).toEqual([expect.stringContaining('"## Mini-diagnostic" is 120 words'), expect.stringContaining('exactly one question')]);
  });

  test('refuse une accroche trop longue pour une note LinkedIn', () => {
    const result = checkProposal(proposal.replace("J'ai regardé", `${'Une observation précise sur Acme. '.repeat(5)}J'ai regardé`), context);
    expect(result.problems).toEqual([expect.stringContaining('fits a LinkedIn connection note')]);
  });

  test('refuse trois axes', () => {
    const axis = proposal.split('## Axes\n\n')[1].split('## Mini-diagnostic')[0];
    const result = checkProposal(proposal.replace(axis, axis + axis + axis), context);
    expect(result.problems).toEqual([expect.stringContaining('holds 3 axis(es)')]);
  });

  test('une citation trop courte ne prouve rien', () => {
    expect(quoted('marchés', profile)).toBe(false);
    expect(quoted("J'ai lancé l’activité", profile)).toBe(true);
  });
});
