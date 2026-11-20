import { describe, expect, test } from 'bun:test';
import { LINKEDIN_SVG, PAINT_ORDER_BREAKERS } from '../../blocks/.shared/print-style.ts';
import { CV_CSS, cvBodyHtml, cvDocument, inline, italicMeta, markdownToHtml, splitItems, splitName, splitTrailingDate } from './markdown.ts';

describe('markdown minimal', () => {
  test('titres, listes, gras, liens, règle', () => {
    const html = markdownToHtml('# CV — Jane\n**Poste :** Growth\n\n## Expériences\n- Outbound **~50%** [site](https://x.y)\n- GTM\n\n---\nTexte https://a.b fin');
    expect(html).toContain('<h1>CV — Jane</h1>');
    expect(html).toContain('<p><strong>Poste :</strong> Growth</p>');
    expect(html).toContain('<ul><li>Outbound <strong>~50%</strong> <a href="https://x.y">site</a></li><li>GTM</li></ul>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<a href="https://a.b">https://a.b</a>');
  });
  test('échappe le HTML et garde l’italique simple', () => {
    expect(inline('a <b> & *i*')).toBe('a &lt;b&gt; &amp; <em>i</em>');
  });
  test('document complet avec style', () => {
    const doc = cvDocument('# T', 'Titre <x>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>Titre &lt;x&gt;</title>');
    expect(doc).toContain('@page { size: A4;');
  });
});

/** Un CV fictif dans les deux formes de période (fin de titre, ligne en italique) et sans période. */
const CV = `# CV — Jane Doe

Application: Acme — Growth Lead · https://jane.example/ · jane.doe@example.org · +33 6 00 00 00 00 · Lyon

## Profil

Growth lead, **8 ans** d'acquisition B2B.
Deuxième ligne du même paragraphe.

## Expériences

### Acme — Growth Lead · 09/2024 – 05/2026
- Outbound multicanal.

### Beta — Chargée d'acquisition
*03/2016 – 07/2019 · Remote*
- 1 200 comptes ouverts.

### Freelance — Designer
- Identités visuelles.

## Compétences

- **Acquisition :** SEO, SEA
- **Outils:** HubSpot, n8n

## Formation

- Master, 2015
`;

describe('mise en page du CV', () => {
  const html = cvBodyHtml(CV);

  test('le nom sans « CV — », le poste du titre ou d’une ligne étiquetée, le nom et le poste d’un titre « Nom — Poste »', () => {
    expect(splitName('CV — Jane Doe')).toEqual({ name: 'Jane Doe', role: '' });
    expect(splitName('Jane Doe — Growth Lead')).toEqual({ name: 'Jane Doe', role: 'Growth Lead' });
    expect(splitName('Jane Doe')).toEqual({ name: 'Jane Doe', role: '' });
    expect(html).toContain('<header class="masthead"><h1>Jane Doe</h1><p class="role"><span class="label">Application:</span> <span class="title">Acme — Growth Lead</span></p>');
  });

  test('une seule ligne de contact : lieu · e-mail · téléphone · portfolio, séparateurs discrets', () => {
    expect(html).toContain(
      '<p class="contact">Lyon <span class="sep">·</span> <a href="mailto:jane.doe@example.org">jane.doe@example.org</a> <span class="sep">·</span> +33 6 00 00 00 00 <span class="sep">·</span> <a href="https://jane.example/">jane.example</a></p></header>',
    );
  });

  test('période en fin de titre ou en ligne italique : à droite ; sans période, pas de case vide', () => {
    expect(splitTrailingDate('Acme — Growth Lead · 09/2024 – 05/2026')).toEqual({ title: 'Acme — Growth Lead', date: '09/2024 – 05/2026' });
    expect(splitTrailingDate('Acme — Stagiaire (2015 – 2016)')).toEqual({ title: 'Acme — Stagiaire', date: '2015 – 2016' });
    expect(splitTrailingDate('Acme — Consultante | depuis 2023')).toEqual({ title: 'Acme — Consultante', date: 'depuis 2023' });
    expect(splitTrailingDate('Acme — Lead · janv. 2022 – aujourd’hui')).toEqual({ title: 'Acme — Lead', date: 'janv. 2022 – aujourd’hui' });
    expect(splitTrailingDate('Acme — Lead · Sep 2021 - Present')).toEqual({ title: 'Acme — Lead', date: 'Sep 2021 - Present' });
    // Un nombre qui n'est pas une période reste dans le titre.
    expect(splitTrailingDate('Way2Tech.ai — Product Manager · Growth')).toEqual({ title: 'Way2Tech.ai — Product Manager · Growth', date: '' });
    expect(splitTrailingDate('1001 Goûts — Marketing')).toEqual({ title: '1001 Goûts — Marketing', date: '' });
    expect(italicMeta('*03/2016 – 07/2019 · Remote*')).toBe('03/2016 – 07/2019 · Remote');
    expect(italicMeta('*Remote*')).toBeNull();
    expect(html).toContain('<article class="entry"><div class="entry-head"><h3><span class="org">Acme</span> <span class="dash">—</span> <span class="what">Growth Lead</span></h3><p class="when">09/2024 – 05/2026</p></div><ul><li>Outbound multicanal.</li></ul></article>');
    expect(html).toContain('<p class="when">03/2016 – 07/2019 · Remote</p></div><ul><li>1 200 comptes ouverts.</li></ul>');
    expect(html).not.toContain('<em>03/2016');
    expect(html).toContain('<h3><span class="org">Freelance</span> <span class="dash">—</span> <span class="what">Designer</span></h3></div>');
  });

  test('compétences étiquetées en rangées, autres listes à puces, une section par ##', () => {
    expect(html).toContain(
      '<ul class="rows"><li><strong class="k"><span class="nw">Acquisition :</span></strong> <span class="v chips"><span class="chip">SEO</span><span class="cs">, </span><span class="chip">SEA</span></span></li><li><strong class="k">Outils:</strong> <span class="v chips"><span class="chip">HubSpot</span><span class="cs">, </span><span class="chip">n8n</span></span></li></ul>',
    );
    expect(html).toContain('<section><h2>Formation</h2><ul><li>Master, 2015</li></ul></section>');
    expect(html).toContain("<section><h2>Profil</h2><p>Growth lead, <strong>8 ans</strong> d'acquisition B2B. Deuxième ligne du même paragraphe.</p></section>");
    // Une puce « **Acme** (2019 – 2024) : … » n'est pas une rangée (pas de deux-points collé à l'étiquette).
    expect(cvBodyHtml('## X\n\n- **Acme** (2019 – 2024) : refonte.')).toContain('<ul><li><strong>Acme</strong> (2019 – 2024) : refonte.</li></ul>');
  });

  test('compétences en pastilles : la virgule reste du texte, une phrase ou une seule valeur reste du texte', () => {
    expect(splitItems('Google Ads (Search, PMax), Meta Ads, GA4')).toEqual(['Google Ads (Search, PMax)', 'Meta Ads', 'GA4']);
    expect(splitItems('n8n,  Zapier ,')).toEqual(['n8n', 'Zapier']);
    const chips = cvBodyHtml('## Skills\n\n- **Ads:** Google Ads (Search, PMax), Meta Ads');
    expect(chips).toContain('<span class="chip">Google Ads (Search, PMax)</span><span class="cs">, </span><span class="chip">Meta Ads</span>');
    // Le texte visible, balises ôtées, est celui du Markdown : un ATS lit « a, b ».
    expect(chips.replace(/<[^>]+>/g, '')).toContain('Ads: Google Ads (Search, PMax), Meta Ads');
    expect(cvBodyHtml('## X\n\n- **Impact:** grew qualified leads by a third in a year while cutting the cost of acquisition, with weekly reviews.\n- **Outils:** n8n')).toContain('<span class="v">grew qualified leads');
    expect(cvBodyHtml('## X\n\n- **Outils:** n8n')).toContain('<span class="v">n8n</span>');
  });

  test('en-tête sur deux lignes : la candidature, puis la ville et les contacts', () => {
    const two = cvBodyHtml('# CV — Jane Doe\n\nApplication: Acme — Growth Lead · Ops\nLyon, France · jane.doe@example.org · +33 6 00 00 00 00 · https://www.linkedin.com/in/jane · https://jane.example/\n\n## Profil\n\nTexte.');
    expect(two).toContain('<p class="role"><span class="label">Application:</span> <span class="title">Acme — Growth Lead · Ops</span></p>');
    expect(two).toContain(
      '<p class="contact">Lyon, France <span class="sep">·</span> <a href="mailto:jane.doe@example.org">jane.doe@example.org</a> <span class="sep">·</span> +33 6 00 00 00 00 <span class="sep">·</span> <a class="ico" href="https://www.linkedin.com/in/jane" aria-label="LinkedIn">' + LINKEDIN_SVG + '</a> <span class="sep">·</span> <a href="https://jane.example/">jane.example</a></p></header>',
    );
  });

  test('ordre de lecture : nom, contact, profil, expériences, compétences, formation', () => {
    const at = ['Jane Doe', 'jane.doe@example.org', '<h2>Profil', 'org">Acme', 'org">Beta', 'org">Freelance', '<h2>Compétences', '<h2>Formation'].map((s) => html.indexOf(s));
    expect(at.every((pos) => pos >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('un CV sans ## ni # reste lisible, rien ne se perd', () => {
    expect(cvBodyHtml('Texte seul.')).toContain('Texte seul.');
    expect(cvBodyHtml('# Jane Doe\n\n### Acme — Lead\n- x')).toContain('<h1>Jane Doe</h1>');
  });

  test('feuille de style : A4, couleurs exactes, entrées insécables, rien de distant ni d’hors flux', () => {
    expect(CV_CSS).toContain('@page { size: A4; margin: 13mm 0; }');
    expect(CV_CSS).toContain('@page :first { margin-top: 0; }');
    expect(CV_CSS).toContain('body { margin: 0; padding: 0 16mm; }');
    expect(CV_CSS).toContain('-webkit-print-color-adjust: exact');
    expect(CV_CSS).toMatch(/\.entry \{[^}]*break-inside: avoid/);
    expect(CV_CSS).not.toMatch(/url\(|@import|https?:\/\//i);
    expect(PAINT_ORDER_BREAKERS.test(CV_CSS)).toBe(false);
  });
});

test('cvBodyHtml : les deux-points d\'un libellé restent sur la ligne de son dernier mot', () => {
  const html = cvBodyHtml('# CV\n\n## Compétences\n\n- **Réseaux sociaux & contenu :** Instagram, TikTok\n- **E-mail:** Brevo, Lemlist\n');
  expect(html).toContain('<strong class="k">Réseaux sociaux &amp; <span class="nw">contenu :</span></strong>');
  expect(html).toContain('<strong class="k">E-mail:</strong>');
});
