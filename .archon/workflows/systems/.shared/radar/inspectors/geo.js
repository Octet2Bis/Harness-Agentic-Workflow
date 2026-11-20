/**
 * geo.js — Pays et régions cités dans un texte de localisation (Pilier 02)
 * Table reprise de gates.py du projet JobCampaign (transmis par Antoine le 2026-10-24, voir THIRD_PARTY.md).
 * `zonesIn(texte)` rend { codes: Set<ISO2>, anywhere: bool } ; « US », « UK », « EU » ne comptent qu'en majuscules
 * (sinon « us » anglais ou « nous » passeraient pour les États-Unis).
 */

const EU27 = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const EUROPE = new Set([...EU27, ...'GB CH NO IS LI AL BA ME MK RS UA MD XK'.split(' ')]);
const LATAM = 'MX AR BO BR CL CO CR CU DO EC SV GT HN NI PA PY PE UY PR'.split(' ');
const GROUPS = [
  ['european union|europe|europa|europ[ée]en(?:ne)?|eea|cet|cest', [...EUROPE]],
  ['emea', [...EUROPE, ...'AE SA IL QA ZA EG NG KE MA TN GH'.split(' ')]],
  ['latam|latin america|am[ée]rica latina|south america', LATAM],
  ['north america|am[ée]rique du nord|amer|americas', ['US', 'CA', 'MX']],
  ['apac|asia[- ]pacific|asia', 'AU NZ SG HK JP CN IN KR TW TH VN ID MY PH'.split(' ')],
  ['dach', ['DE', 'AT', 'CH']], ['nordics?', 'SE DK FI NO IS'.split(' ')], ['benelux', ['BE', 'NL', 'LU']], ['iberia', ['ES', 'PT']]
];
const COUNTRIES = [
  ['united kingdom|u\\.k\\.|great britain|britain|england|scotland|wales|northern ireland|royaume-uni|reino unido|london|londres|manchester|edinburgh', 'GB'],
  ['united states|u\\.s\\.a?|america|etats-unis|[ée]tats-unis|estados unidos|new york|california|texas|florida|massachusetts|illinois|colorado|virginia|' +
   'north carolina|ohio|michigan|pennsylvania|new jersey|arizona|oregon|minnesota|wisconsin|maryland|utah|nevada|connecticut|georgia, us|' +
   'san francisco|bay area|seattle|austin|boston|chicago|atlanta|los angeles|denver|miami|nyc|washington, d\\.?c\\.?', 'US'],
  ['france|frankreich|paris|lyon|marseille|toulouse|bordeaux|lille|nantes', 'FR'], ['germany|deutschland|allemagne|alemania|berlin|munich|m[üu]nchen|hamburg|frankfurt|cologne|k[öo]ln', 'DE'],
  ['spain|espa[ñn]a|espagne|spanien|madrid|barcelona|valencia', 'ES'], ['italy|italia|italie|italien|milan|milano|rome|roma|turin|torino', 'IT'],
  ['portugal|lisbon|lisboa|porto', 'PT'], ['netherlands|holland|nederland|pays-bas|niederlande|amsterdam|rotterdam|utrecht|the hague', 'NL'],
  ['belgium|belgique|belgi[eë]|belgien|brussels|bruxelles|antwerp', 'BE'], ['luxembourg|luxemburg', 'LU'], ['ireland|irlande|irlanda|irland|dublin', 'IE'],
  ['austria|autriche|[öo]sterreich|vienna|wien', 'AT'], ['switzerland|suisse|schweiz|suiza|svizzera|zurich|z[üu]rich|geneva|gen[èe]ve|basel', 'CH'],
  ['poland|pologne|polska|polonia|polen|warsaw|warszawa|krakow|krak[óo]w|wroclaw', 'PL'], ['sweden|su[èe]de|sverige|suecia|schweden|stockholm', 'SE'],
  ['denmark|danemark|danmark|dinamarca|d[äa]nemark|copenhagen', 'DK'], ['finland|finlande|suomi|finlandia|finnland|helsinki', 'FI'],
  ['norway|norv[èe]ge|norge|noruega|norwegen|oslo', 'NO'], ['czech republic|czechia|tch[èe]quie|prague', 'CZ'], ['romania|roumanie|rum[äa]nien|bucharest', 'RO'],
  ['bulgaria|bulgarie|bulgarien|sofia', 'BG'], ['croatia|croatie|kroatien|zagreb', 'HR'], ['greece|gr[èe]ce|grecia|griechenland|athens', 'GR'],
  ['hungary|hongrie|ungarn|budapest', 'HU'], ['slovakia|slovaquie', 'SK'], ['slovenia|slov[éè]nie', 'SI'], ['estonia|estonie|tallinn', 'EE'],
  ['latvia|lettonie|riga', 'LV'], ['lithuania|lituanie|vilnius', 'LT'], ['malta|malte', 'MT'], ['cyprus|chypre|chipre', 'CY'],
  ['ukraine|kyiv|kiev', 'UA'], ['serbia|belgrade', 'RS'],
  ['canada|toronto|vancouver|montreal|montr[ée]al|ontario|quebec|qu[ée]bec', 'CA'], ['mexico|m[eé]xico|mexique', 'MX'], ['brazil|brasil|br[ée]sil|s[ãa]o paulo', 'BR'],
  ['argentina|argentine|buenos aires', 'AR'], ['chile|chili', 'CL'], ['colombia|colombie|bogota|bogot[áa]', 'CO'], ['peru|p[ée]rou', 'PE'], ['uruguay', 'UY'],
  ['ecuador|[ée]quateur', 'EC'], ['costa rica', 'CR'], ['india|inde|bangalore|bengaluru|mumbai|delhi|hyderabad|pune', 'IN'], ['australia|australie|sydney|melbourne', 'AU'],
  ['new zealand', 'NZ'], ['singapore|singapour', 'SG'], ['hong kong', 'HK'], ['japan|japon|tokyo', 'JP'], ['china|chine', 'CN'], ['philippines|manila', 'PH'],
  ['pakistan', 'PK'], ['uae|dubai|abu dhabi|united arab emirates', 'AE'], ['israel|tel aviv', 'IL'], ['south africa|cape town|johannesburg', 'ZA'],
  ['nigeria|lagos', 'NG'], ['kenya|nairobi', 'KE'], ['egypt|cairo', 'EG'], ['morocco|maroc', 'MA'], ['turkey|turkiye|t[üu]rkiye|turquie|istanbul', 'TR']
];
const ANY = /(?<![\p{L}\p{N}])(?:worldwide|anywhere|global|globally|world wide|any country|everywhere|international)(?![\p{L}\p{N}])/iu;
const bounded = (w, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`, flags);
const COUNTRY_RX = COUNTRIES.map(([w, c]) => [bounded(w), [c]]);
const GROUP_RX = GROUPS.map(([w, codes]) => [bounded(w), codes]);
const CASE_TOKENS = [[/(?<![\w.])(?:US|U\.S\.|USA|SF|NYC)(?![\w])/u, ['US']], [/(?<![\w.])UK(?![\w])/u, ['GB']], [/(?<![\w.])EU(?![\w])/u, EU27]];

function zonesIn(text) {
  const s = String(text || '');
  const codes = new Set();
  for (const [rx, list] of [...COUNTRY_RX, ...GROUP_RX, ...CASE_TOKENS]) if (rx.test(s)) list.forEach(c => codes.add(c));
  return { codes, anywhere: ANY.test(s) };
}

module.exports = { zonesIn, EUROPE, EU27 };
