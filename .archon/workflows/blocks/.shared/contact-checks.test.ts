import { describe, expect, test } from 'bun:test';
import {
  BLOCKED_HOSTS,
  type ContactRules,
  DEFAULT_CONTACT_RULES,
  canonicalUrl,
  checkDecideurs,
  companyKey,
  companyMatches,
  digitGroups,
  domainProblems,
  emailAddresses,
  greets,
  isBlockedHost,
  mentions,
  nameProblems,
  phoneNumbers,
  readDecideurs,
  sourceProblems,
  unsupportedDigits,
} from './contact-checks.ts';

const profile = `# 👤 Profil Maître : Antoine Lecerf

**Langues :** Français (natif), Anglais (courant).
- Disponibilité : préavis d'un mois

### Way2Tech.ai — Product Manager · CRM Manager · Growth · 09/2024 – 05/2026 · Full remote
* **Campagnes outbound et CRM :** campagnes B2B multicanales (Apollo, Lemlist, HubSpot) ; ~50 % d'ouverture.
* **Automatisations :** flux n8n / Zapier pour l'enrichissement de leads, le scoring et la synchronisation CRM en temps réel.

### 1001 Goûts — Digital Marketing & Operations Automation
* **Reporting :** reporting marketing et commercial automatisé (Google Sheets / Looker Studio).
`;

const posting = `Smartness is hiring a Sales Operations & Enablement Specialist. With 5,000+ clients in 41 countries, we need someone who keeps the go-to-market machine aligned between Sales, Customer Success and Revenue Operations. You will own processes, documentation and enablement for our teams. Fluent in English and Italian.`;

const rules: ContactRules = {
  ...DEFAULT_CONTACT_RULES,
  company: 'Smartness S.r.l.',
  title: 'Sales Operations & Enablement Specialist (m/f/d)',
  language: 'en',
  profile,
  posting,
  candidate: 'Antoine Lecerf',
};

const body = `Hi Marco,

With 5,000+ clients in 41 countries, Smartness needs its go-to-market processes to stay aligned between Sales, Customer Success and leadership. That is the operational work I have been doing for growing teams.

At Way2Tech.ai I built n8n and Zapier workflows for lead enrichment, lead scoring and real-time CRM synchronisation. At 1001 Goûts I automated the marketing and sales reporting in Google Sheets and Looker Studio.

Would you have a short call next week to tell me how the role fits into the Sales team?

Best regards,
Antoine Lecerf`;

function good(): Record<string, unknown> {
  return {
    company: 'Smartness',
    job_title: 'Sales Operations & Enablement Specialist',
    domain: 'smartness.com',
    language: 'en',
    people: [
      {
        name: 'Marco Bellini',
        role: 'Sales Manager',
        why: "L'utilisateur direct d'un Sales Ops & Enablement : le plus à même de dire à qui le poste rapporte.",
        source: 'https://smartness.com/en/work-with-us',
        evidence: 'Marco Bellini, Sales Manager',
      },
      {
        name: 'Eléna Costa',
        role: 'People & Culture Manager',
        why: 'Pilote très probablement le recrutement.',
        source: 'https://www.smartness.com/en/work-with-us/',
        evidence: 'Elena COSTA — People & Culture Manager',
      },
    ],
    searches: ['Smartness "Revenue Operations"', 'Smartness "Head of Sales"'],
    linkedin_note: {
      to: 'Marco Bellini',
      text: "Hi Marco, I saw the Sales Operations & Enablement role at Smartness. I build the CRM syncs, lead scoring and reporting that keep sales and CS aligned (n8n, HubSpot, Looker Studio). Happy to share a one-pager if useful. Antoine",
    },
    email: { to: 'Marco Bellini', subject: 'Sales Operations at Smartness', body },
    sources: ['https://smartness.com/en/work-with-us'],
    notes: ['Non trouvé en public : un(e) Head of Revenue Operations.'],
  };
}

function check(mutate: (doc: Record<string, any>) => void, overrides: Partial<ContactRules> = {}) {
  const doc = good() as Record<string, any>;
  mutate(doc);
  return checkDecideurs(JSON.stringify(doc, null, 2), { ...rules, ...overrides });
}

function expectProblem(result: { ok: boolean; problems: string[] }, fragment: string) {
  expect(result.ok).toBe(false);
  expect(result.problems.some((p) => p.includes(fragment))).toBe(true);
}

describe('contact-checks : la fiche de référence passe', () => {
  test('aucun problème sur un fichier correct (accents, majuscules, www et barre finale tolérés)', () => {
    const result = checkDecideurs(JSON.stringify(good()), rules);
    expect(result.problems).toEqual([]);
    expect(result).toEqual({ ok: true, problems: [], people: 2 });
  });
});

describe('contact-checks : la forme', () => {
  test('absent, illisible, pas un objet', () => {
    expect(checkDecideurs(null, rules).problems[0]).toContain('absent');
    expect(checkDecideurs('```json\n{}\n```', rules).problems[0]).toContain("n'est pas un JSON valide");
    expect(checkDecideurs('[]', rules).problems[0]).toContain('doit être un objet');
  });
  test('champs manquants ou mal typés', () => {
    const { problems } = readDecideurs(JSON.stringify({ company: 'X', people: [{ name: 3 }], searches: 'a' }));
    expect(problems.some((p) => p.includes('people[0].name'))).toBe(true);
    expect(problems.some((p) => p.includes('« searches »'))).toBe(true);
    expect(problems.some((p) => p.includes('linkedin_note'))).toBe(true);
    expect(problems.some((p) => p.includes('« email »'))).toBe(true);
  });
});

describe('contact-checks : l’entreprise et le domaine', () => {
  test('companyKey ôte la forme juridique', () => {
    expect(companyKey('Dana Incorporated')).toBe('dana');
    expect(companyKey('Smartness S.r.l.')).toBe('smartness');
    expect(companyKey('Groupe')).toBe('groupe');
    expect(companyMatches('Dana', 'Dana Incorporated')).toBe(true);
    expect(companyMatches('Globex', 'Dana Incorporated')).toBe(false);
  });
  test('une autre entreprise que celle de l’offre est refusée', () => {
    expectProblem(check((d) => (d.company = 'Smartpricing')), "n'est pas l'entreprise de l'offre");
  });
  test('sans offre lisible, rien à comparer', () => {
    expectProblem(check(() => {}, { company: '' }), "entreprise de l'offre introuvable");
  });
  test('le domaine est un hôte nu', () => {
    expect(domainProblems('dana.com')).toEqual([]);
    expect(domainProblems('https://dana.com/')[0]).toContain('hôte nu');
    expect(domainProblems('dana.com/careers')[0]).toContain('hôte nu');
    expect(domainProblems('www.dana.com')[0]).toContain('www.');
    expect(domainProblems('linkedin.com')[0]).toContain('courtier');
    expectProblem(check((d) => (d.domain = '')), '« domain » vide');
  });
  test('job_title et language', () => {
    expectProblem(check((d) => (d.job_title = '')), 'job_title');
    expectProblem(check((d) => (d.language = 'fr')), 'la langue de l\'annonce est « en »');
  });
});

describe('contact-checks : les personnes', () => {
  test('noms complets', () => {
    expect(nameProblems('Marie de La Tour')).toEqual([]);
    expect(nameProblems("Seán O'Brien-Smith")).toEqual([]);
    expect(nameProblems('Marco')[0]).toContain('deux à cinq mots');
    expect(nameProblems('J. Smith')[0]).toContain('initiale');
    expect(nameProblems('Head of Sales 2')[0]).toContain('chiffre');
    expectProblem(check((d) => (d.people[0].name = 'Bellini')), 'deux à cinq mots');
  });
  test('nom en double', () => {
    expectProblem(check((d) => d.people.push({ ...d.people[0] })), 'nom en double');
  });
  test('au plus max_people', () => {
    expectProblem(check(() => {}, { maxPeople: 1 }), 'au plus 1');
  });
  test('rôle et raison non vides', () => {
    expectProblem(check((d) => (d.people[0].role = '')), '« role » vide');
    expectProblem(check((d) => (d.people[1].why = ' ')), '« why » vide');
  });
  test('source https, permise, listée', () => {
    expect(sourceProblems('http://smartness.com/team', 'x')[0]).toContain('https');
    expect(sourceProblems('https://it.linkedin.com/in/someone', 'x')[0]).toContain("n'est pas une source permise");
    expect(sourceProblems('https://rocketreach.co/smartness', 'x')[0]).toContain("n'est pas une source permise");
    expect(isBlockedHost('app.apollo.io')).toBe(true);
    expect(isBlockedHost('apolloio.example.com')).toBe(false);
    expect(BLOCKED_HOSTS).toContain('hunter.io');
    expect(canonicalUrl('https://WWW.Smartness.com/en/work-with-us/#team')).toBe('https://smartness.com/en/work-with-us');
    expectProblem(check((d) => (d.people[0].source = 'https://techcrunch.com/smartness')), "n'est pas dans « sources »");
    expectProblem(check((d) => (d.people[0].source = '')), '« source » vide');
  });
  test('la citation porte le nom de famille', () => {
    expectProblem(check((d) => (d.people[0].evidence = 'Our Sales Manager leads the team')), 'ne contient pas le nom « Bellini »');
    expectProblem(check((d) => (d.people[0].evidence = 'Bellini')), 'trop courte');
    expectProblem(check((d) => (d.people[0].evidence = '')), '« evidence » vide');
    expect(mentions('Elena COSTA — People', 'Costa')).toBe(true);
    expect(mentions('Costaano', 'Costa')).toBe(false);
  });
  test('moins de deux personnes : au moins deux recherches', () => {
    const empty = (d: Record<string, any>) => {
      d.people = [];
      d.linkedin_note.to = '';
      d.email.to = '';
      d.linkedin_note.text = d.linkedin_note.text.replace('Hi Marco', 'Hello');
      d.email.body = d.email.body.replace('Hi Marco', 'Hello');
    };
    expect(check(empty).problems).toEqual([]);
    expectProblem(check((d) => { empty(d); d.searches = ['Smartness "Sales"']; }), 'au moins deux recherches');
    expectProblem(check((d) => { d.people = d.people.slice(0, 1); d.searches = []; }), 'au moins deux recherches');
    expectProblem(check((d) => (d.searches = ['https://www.linkedin.com/search?q=x', 'b'])), 'pas une URL');
  });
});

describe('contact-checks : ni e-mail, ni téléphone, ni LinkedIn', () => {
  test('adresses trouvées, devinées ou masquées', () => {
    expect(emailAddresses('écrire à marco.bellini@smartness.com')).toEqual(['marco.bellini@smartness.com']);
    expect(emailAddresses('format probable : {prenom}.{nom}@smartness.com')).toEqual(['@smartness.com']);
    expect(emailAddresses('elena [at] smartness.com')).toHaveLength(1);
    expect(emailAddresses('https://medium.com/@smartness/post')).toEqual([]);
    expectProblem(check((d) => d.notes.push('Format probable : prenom.nom@smartness.com')), 'adresse e-mail');
    expectProblem(check((d) => (d.email.body = d.email.body.replace('Antoine Lecerf', 'Antoine Lecerf\nantoine@example.org'))), 'adresse e-mail');
  });
  test('téléphones, pas les dates ni les identifiants d’URL', () => {
    expect(phoneNumbers('Tél. +33 6 98 76 54 32')).toHaveLength(1);
    expect(phoneNumbers('(555) 123-4567')).toHaveLength(1);
    expect(phoneNumbers('le 2026-10-24, 5,000 clients, 41 pays')).toEqual([]);
    expect(phoneNumbers('https://news.example.com/article-123456789012')).toEqual([]);
    expectProblem(check((d) => (d.people[0].evidence = 'Marco Bellini, Sales Manager, +39 0464 123 456')), 'téléphone');
  });
  test('LinkedIn et les courtiers ne sont cités nulle part', () => {
    expectProblem(check((d) => d.notes.push('Profil : linkedin.com/in/bellini')), '« linkedin.com » cité');
    expectProblem(check((d) => d.notes.push('Vu sur https://www.zoominfo.com/c/smartness')), 'zoominfo.com');
    expect(check((d) => d.notes.push('À confirmer sur LinkedIn, connecté.')).ok).toBe(true);
  });
});

describe('contact-checks : la note LinkedIn', () => {
  test('« to » est une personne listée, ou vide sans personne', () => {
    expectProblem(check((d) => (d.linkedin_note.to = 'Luca Rodella')), 'linkedin_note.to');
    expectProblem(check((d) => (d.email.to = '')), 'email.to');
  });
  test('300 caractères, sans lien', () => {
    expectProblem(check((d) => (d.linkedin_note.text += ' '.padEnd(80, 'x'))), 'au plus 300');
    expectProblem(check((d) => (d.linkedin_note.text += ' https://antoinelecerf.fit/')), 'pas de lien');
  });
  test('salue par le prénom, nomme l’entreprise ou le poste', () => {
    expect(greets('Bonjour Eléna, je postule', 'Elena Costa')).toBe(true);
    expect(greets('Hello, I saw that Marco leads', 'Marco Bellini')).toBe(false);
    expectProblem(check((d) => (d.linkedin_note.text = d.linkedin_note.text.replace('Hi Marco', 'Hello'))), 'par son prénom');
    expectProblem(check((d) => (d.linkedin_note.text = 'Hi Marco, I build the CRM syncs, lead scoring and reporting that keep sales and CS aligned. Happy to share a one-pager if useful. Antoine')), "nommer l'entreprise");
  });
  test('langue, spam, slop, marqueurs', () => {
    expectProblem(check((d) => (d.linkedin_note.text = 'Bonjour Marco, je suis candidat au poste chez Smartness et je voudrais vous parler de mon parcours dans les opérations commerciales. Antoine')), 'écrite en français');
    expectProblem(check((d) => (d.linkedin_note.text += ' Click here')), 'spam « click here »');
    expectProblem(check((d) => (d.linkedin_note.text = d.linkedin_note.text.replace('I build', 'I am passionate about building'))), 'formule creuse');
    expectProblem(check((d) => (d.linkedin_note.text = d.linkedin_note.text.replace('Antoine', '[Prénom]'))), 'marqueur');
    expect(check((d) => (d.email.body = d.email.body.replace('Zapier workflows', 'Zapier workflows as a freelance consultant'))).ok).toBe(true);
  });
});

describe('contact-checks : l’e-mail', () => {
  test('objet de 60 caractères au plus', () => {
    expectProblem(check((d) => (d.email.subject = 'Sales Operations & Enablement Specialist at Smartness, a short note')), 'au plus 60');
    expectProblem(check((d) => (d.email.subject = '')), 'email.subject vide');
  });
  test('60 à 150 mots', () => {
    expectProblem(check((d) => (d.email.body = 'Hi Marco, would Smartness have a minute for a call?\n\nAntoine Lecerf')), 'entre 60 et 150');
    expectProblem(check((d) => (d.email.body = d.email.body.replace('Would you', `${'More context about my work. '.repeat(20)}Would you`))), 'entre 60 et 150');
  });
  test('salue, nomme l’entreprise, une seule demande, signé', () => {
    expectProblem(check((d) => (d.email.body = d.email.body.replace('Hi Marco', 'Hello there'))), 'email.body : saluer');
    expectProblem(check((d) => { d.email.body = d.email.body.replace('Smartness needs', 'your team needs'); d.email.subject = 'Sales Operations role'; }), "nommer l'entreprise");
    expectProblem(check((d) => (d.email.body = d.email.body.replace('Sales team?', 'Sales team.'))), 'aucune question');
    expectProblem(check((d) => (d.email.body = d.email.body.replace('leadership.', 'leadership? Who owns it? Why?'))), 'une seule demande');
    expectProblem(check((d) => (d.email.body = d.email.body.replace('Antoine Lecerf', 'Antoine'))), 'finir par le nom du candidat');
    expectProblem(check(() => {}, { candidate: '' }), 'nom du candidat introuvable');
  });
  test('langue de l’annonce', () => {
    const fr = `Bonjour Marco,\n\nJe vous écris au sujet du poste chez Smartness. Chez Way2Tech.ai, j'ai construit des flux n8n et Zapier pour l'enrichissement des leads, le scoring et la synchronisation du CRM en temps réel. Chez 1001 Goûts, j'ai automatisé le reporting marketing et commercial dans Google Sheets et Looker Studio, avec des alertes pour les équipes. Je connais bien le travail entre les ventes et le service client, et je sais documenter un process pour que les équipes l'adoptent.\n\nAuriez-vous un moment la semaine prochaine pour en parler ?\n\nAntoine Lecerf`;
    expectProblem(check((d) => (d.email.body = fr)), 'à écrire en anglais');
  });
});

describe('contact-checks : les nombres', () => {
  test('groupes de chiffres', () => {
    expect(digitGroups('5,000+ clients in 41 countries, n8n')).toEqual(['5', '000', '41', '8']);
    expect(unsupportedDigits('47 M€ and 41 countries', '41 countries')).toEqual(['47']);
  });
  test('un nombre de l’annonce passe, un nombre inventé non', () => {
    expectProblem(check((d) => (d.email.body = d.email.body.replace('a short call', 'a 20-minute call'))), 'nombre « 20 »');
  });
  test('un chiffre à unité vient du profil seul, même si l’annonce le porte', () => {
    expectProblem(check((d) => (d.email.body = d.email.body.replace('leadership.', 'leadership after a €47M Series B.'))), 'chiffre « 47m »');
    expectProblem(check((d) => (d.linkedin_note.text = d.linkedin_note.text.replace('Looker Studio)', 'Looker Studio, 70% open rates)'))), 'chiffre « 70% »');
    expect(check((d) => (d.linkedin_note.text = d.linkedin_note.text.replace('Looker Studio)', 'Looker Studio, ~50 % open rates)'))).ok).toBe(true);
  });
});
