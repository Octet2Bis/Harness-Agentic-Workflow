/**
 * AUDITEUR REMOTE & TERRITORIAL (Inspecteur 2)
 * Pilier : 02_Assistant_Personnel
 * Contrat : écarte toute mention de présentiel ; sinon, s'appuie sur la déclaration de la source
 * (champ remote_declared posé par le connecteur, remote_basis nommant qui le déclare quand ce
 * n'est pas la source elle-même) ou sur une mention remote explicite.
 * Rien n'est « certifié » : c'est ce que dit l'annonce.
 */

// Territoire : un poste « remote » réservé à une zone hors Europe (résidence exigée) ne sert pas
// Antoine (pays cibles FR/DE/NL/ES/IT/PT/UK, autres pays européens acceptés). On lit le seul champ
// `location` (jamais le siège) avec la table de pays et régions de geo.js, et quelques formules de
// résidence de la description. Une mention européenne ou mondiale dans la localisation l'emporte toujours.
const { zonesIn, EUROPE } = require('./geo');
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const words = list => new RegExp(`(^|[^a-z])(${list.join('|')})($|[^a-z])`);
const RESIDENCY = words([
  'us only', 'us-only', 'usa only', 'u\\.s\\. only', 'us residents', 'us-based', 'based in the us',
  'based in the united states', 'reside in the us', 'reside in the united states', 'within the united states',
  'authorized to work in the united states', 'authorized to work in the us', 'us work authorization',
  'canada only', 'based in canada', 'latam only', 'americas only'
]);

function evaluateTerritory(job) {
  const zones = zonesIn(job.location);
  if (zones.codes.size && !zones.anywhere && ![...zones.codes].some(c => EUROPE.has(c))) {
    return { pass: false, reason: `Zone hors Europe dans la localisation : "${job.location}"` };
  }
  const desc = fold(job.description);
  const phrase = desc.match(RESIDENCY);
  if (phrase) return { pass: false, reason: `Résidence hors Europe exigée : "${phrase[2]}"` };
  return { pass: true };
}

// ── Télétravail : ce qui le prouve, ce qui l'exclut (2026-11-14, Antoine : « n'en manquer aucun à
// cause des mots, sans aller jusqu'à l'hybride ») ─────────────────────────────────────────────────
// Le texte est lu sans casse ni accents (`fold`). Les mots du métier qui ressemblent à un mode de
// travail ne comptent pas : « hybrid cloud » (Canonical), « on-site SEO », « in-person events »,
// « sur site web », « no relocation », « occasional on-site team retreats ».

// Télétravail complet dit en toutes lettres : il l'emporte sur les indices faibles de bureau.
const FULL_REMOTE = new RegExp([
  '100 ?% ?(remote|teletravail|en teletravail|a distance|distanciel|remoto|telework)',
  'fully[- ]remote', 'full[- ]remote', 'full[- ]time remote', 'entirely remote', 'completely remote', 'totally remote',
  'remote[- ]first', 'remote[- ]only', 'all[- ]remote', 'remote[- ]native', 'remote by default', 'remote company', 'remote-based', 'remote based',
  'fully distributed', 'distributed (team|company|workforce|organi[sz]ation|by design)', 'async[- ]first',
  'work(ing)? from anywhere', 'work[- ]from[- ]anywhere', 'from anywhere in', 'anywhere in (europe|the eu|emea|the world)',
  'location[- ]independent', 'location[- ]agnostic', 'location[- ]flexible',
  'home[- ]based', 'work(ing)? from home', 'work[- ]from[- ]home', '\\bwfh\\b', 'telecommut\\w*', 'telework\\w*',
  'remote (anywhere|worldwide|global|europe|emea|eu)\\b', 'remote ?[-(–—:/] ?(europe|emea|eu|uk|france|spain|portugal|germany|netherlands|ireland|anywhere|worldwide|global)',
  '(teletravail|full teletravail) (complet|total|integral|a 100)', 'full teletravail', 'en teletravail (complet|total|integral)',
  '(entierement|totalement|completement|integralement) (a distance|en teletravail|en remote|distanciel)',
  'depuis (chez (vous|toi)|n.importe ou|votre domicile)', 'ou que (vous soyez|tu sois)', 'sans (aucun )?bureau',
  '(totalmente|100 ?%) (en )?remoto', 'teletrabajo (100|completo|total)', 'trabajo (100 ?% )?remoto'
].join('|'));

// Un mot de télétravail, plus faible : suffit quand rien ne parle de bureau.
const REMOTE_WORD = new RegExp([
  '\\bremote\\b', 'teletravail', 'distanciel', '\\ba distance\\b', 'travail a distance', 'anywhere', 'worldwide',
  '\\bvirtual\\b', 'distributed', 'remoto', 'remota', 'teletrabajo', 'teletrabalho', 'zdaln', 'fernarbeit', 'nomad'
].join('|'));

// Présence exigée : toujours éliminatoire, même à côté d'un « fully remote ».
const HARD_ONSITE = new RegExp([
  '\\bhybrid(e)?\\b(?! ?(cloud|multi|multicloud|app|apps|application|mobile|infra|infrastructure|it\\b|saas|deployment|workload|architecture|solution|environment of cloud|car|vehicle|engine|data|event|events|kubernetes|edge|integration))',
  'hybrid (work|working|role|position|model|schedule|setup|arrangement|policy)', 'travail hybride', 'mode hybride', 'poste hybride',
  '\\b([1-4]|one|two|three|four) days? (a|per|each) week (in|at|from|on) (the |our )?(office|hq|headquarters|site|campus)', '(twice|three times) a week (in|at|from|on) ',
  'in-office days', 'days in (the )?office', 'office days', 'office[- ]based', 'in[- ]office (role|position|presence|days|attendance)',
  'jours? (par semaine )?(sur site|au bureau|en presentiel|dans nos locaux)', '\\b[1-4] jours? de (teletravail|remote)',
  '(?<!pas de |sans |aucun |no )presentiel', 'presence (requise|obligatoire)',
  'partially remote', 'partial(ly)? remote', 'partly remote', 'semi[- ]remote', 'remote (possible|partiel|occasionnel|ponctuel)',
  'teletravail (partiel|possible|occasionnel|ponctuel|jusqu)', '(possibilite|option) de teletravail', 'smart working',
  '\\b(50|60|70|80) ?% ?(remote|teletravail)', '80-100%', 'part[- ]time', 'temps partiel',
  '\\bnot (a |an )?(fully |100 ?% )?remote', '\\bnon[- ]remote', 'ne (se fait|s.effectue|est) pas (en|a) (teletravail|distance|remote)', 'pas (de|en) (full )?(remote|teletravail complet)'
].join('|'));

// Indices de bureau, écartés seulement sans télétravail complet écrit ; les formes du métier et les négations ne comptent pas.
const SOFT_ONSITE = new RegExp([
  '(?<!(occasional|optional|annual|quarterly|yearly|regular|company|team|periodic) )\\bon[- ]?site\\b(?! ?(seo|search|conversion|optimi[sz]ation|experience|content|personali[sz]ation|tracking|analytics|behaviou?r|ux|cro|engagement|marketing|events?|activation|merchandising|banners?|messaging|campaigns?|retreats?|meetups?|gatherings?|offsites?|visits?|support|training|testing|a\\/b))',
  '\\bsur (site|place)\\b(?! ?(web|internet|e-?commerce|marchand))',
  '(?<!(occasional|optional|annual|quarterly|yearly|regular|company|team) )in[- ]person(?! ?(events?|meetups?|retreats?|offsites?|gatherings?|team ?building|conferences?|summits?|trade ?shows?|workshops?))',
  '\\bin[- ]office\\b(?! ?(365|suite|tools))', '\\bau bureau\\b', '\\b(at|in|from|to) (the|our) (office|offices|hq|headquarters)\\b', '\\bdans nos (locaux|bureaux)\\b', 'from our office', 'our office in', 'based in our',
  '(?<!(no|not|without|zero|free of|don.t need to|no need to|won.t need to|never need to) )\\breloca(te|tion|ting)\\b(?! ?(is |are )?(not|never) )',
  'remote[- ]friendly'
].join('|'));

// Les phrases niées ou facultatives ne disent rien du bureau.
const NEGATED = /\b(no|not|without|never|zero|no need to|don.t need to|pas (de|besoin)|sans|aucun(e)?|nul besoin)\b(?:(?!remote|teletravail|distance)[^.;!?\n,]){0,25}?\b(office|bureau|on[- ]?site|sur site|presentiel|reloca\w*|commut\w*|demenag\w*)\b|\b(office|bureau|on[- ]?site|presence)\b[^.;!?\n]{0,30}?\b(optional|optionnel(le)?|facultati\w*|if you (wish|like|want)|si (vous le souhaitez|tu le souhaites))\b/g;

function workModeOf(text) {
  const t = fold(text).replace(NEGATED, ' ');
  const full = t.match(FULL_REMOTE);
  const hard = t.match(HARD_ONSITE);
  const soft = t.match(SOFT_ONSITE);
  return { full: full ? full[0] : null, hard: hard ? hard[0] : null, soft: soft ? soft[0] : null, word: (t.match(REMOTE_WORD) || [null])[0] };
}

function evaluateRemote(job) {
  // Champs séparés : une formule ne doit pas enjamber deux champs (« Remote » + « Based in our Paris hub »).
  const fullText = [job.title, job.location, job.description, job.company_hq || ''].join(' | ');
  const wm = workModeOf(fullText);

  // 1. Présence exigée (hybride, jours au bureau, télétravail partiel) : éliminatoire.
  if (wm.hard) return { pass: false, reason: `Mention de travail non-remote détectée : "${wm.hard.trim()}"` };
  // 1 bis. Indice de bureau sans télétravail complet écrit : éliminatoire aussi.
  if (wm.soft && !wm.full) return { pass: false, reason: `Mention de travail non-remote détectée : "${wm.soft.trim()}"` };

  // 2. Remote réservé à une zone hors Europe
  const territory = evaluateTerritory(job);
  if (!territory.pass) return territory;

  // 3. La source (plateforme 100 % remote, filtre remote) ou l'index d'entreprises affirme le télétravail
  if (job.remote_declared === true) {
    const source = job.source || 'source inconnue';
    return { pass: true, reason: job.remote_basis ? `${job.remote_basis} — ${source}` : `déclaré remote par la source (${source})` };
  }

  // 4. Validation textuelle pour les autres sources
  if (!wm.full && !wm.word) {
    return { pass: false, reason: `Localisation physique sans mention Remote explicite (${job.location || job.company_hq || 'localisation non communiquée'})` };
  }
  return { pass: true, reason: `mention remote explicite dans l'annonce (« ${(wm.full || wm.word).trim()} »)` };
}

module.exports = { evaluateRemote, evaluateTerritory, workModeOf, FULL_REMOTE, HARD_ONSITE, SOFT_ONSITE };
