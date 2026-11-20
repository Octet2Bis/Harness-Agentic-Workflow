/**
 * L'entreprise d'une offre contre son lien, sans réseau ni modèle (testé par `company-link.test.ts`).
 * Quand la source donne les deux, le lien nomme souvent l'employeur : le segment
 * `…/jobs/view/<intitulé>-at-<entreprise>-<id>` d'une annonce LinkedIn (preuve forte : LinkedIn le
 * tire du nom de l'entreprise), ou l'identifiant du tableau d'un ATS (`job-boards.greenhouse.io/<id>/…`,
 * `jobs.lever.co/<id>/…`, `<id>.recruitee.com`… : preuve faible, c'est souvent une abréviation,
 * « bpcs » pour Blueprint Technologies). Motif (2026-10-24) : le connecteur LinkedIn appariait par
 * rang des listes extraites séparément, et cinq offres sont arrivées au tableau avec l'entreprise
 * d'une annonce et le lien d'une autre (Bizneo HR sur une annonce EverAI…).
 *
 * `companyLinkConflict` rend null quand les deux se concilient ou qu'on ne peut rien dire (lien sans
 * nom d'employeur, entreprise non communiquée), sinon la raison et la force de la preuve : le radar du
 * PC refuse une offre `strong` et signale une `weak` (`company_link_check`), le tri écarte une `strong`.
 */

/** Ce que le lien dit de l'employeur, ou null. */
export interface LinkEmployer {
  token: string;
  strength: 'strong' | 'weak';
  where: string;
}

/** Les mots qui ne distinguent pas un employeur (formes juridiques, mots de domaine, entités HTML). */
const GENERIC = new Set([
  'inc', 'ltd', 'llc', 'llp', 'gmbh', 'ag', 'sa', 'sas', 'sasu', 'sarl', 'srl', 'spa', 'bv', 'nv', 'plc', 'oy', 'ab', 'as', 'kg', 'se',
  'co', 'corp', 'company', 'group', 'groupe', 'grupo', 'holding', 'the', 'and', 'de', 'des', 'du', 'la', 'le', 'les', 'el', 'et',
  'com', 'io', 'ai', 'app', 'hq', 'jobs', 'careers', 'career', 'amp', 'www',
]);

/** Minuscules, sans accents. */
function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !GENERIC.has(t));
}

/** Les sous-domaines d'ATS qui sont l'identifiant de l'employeur (`acme.recruitee.com`). */
const ATS_SUBDOMAIN = /^([a-z0-9][a-z0-9-]*)\.(?:recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|jobs\.personio\.(?:de|com)|(?:wd\d+\.)?myworkdayjobs\.com)$/;
/** Les ATS dont le premier segment du chemin est l'identifiant de l'employeur. */
const ATS_PATH_HOST = /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$|^jobs(?:\.eu)?\.lever\.co$|^jobs\.ashbyhq\.com$|^apply\.workable\.com$|^jobs\.smartrecruiters\.com$/;

export function linkEmployer(link: string): LinkEmployer | null {
  let url: URL;
  try {
    url = new URL(String(link ?? ''));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    // Le dernier « -at- » : un intitulé peut en contenir un (« growth-at-scale-lead-at-acme-41… »).
    const view = segments[0] === 'jobs' && segments[1] === 'view' ? (segments[2] ?? '') : '';
    const m = view.match(/^.*-at-(.+)-\d{6,}$/);
    return m ? { token: m[1]!, strength: 'strong', where: 'LinkedIn link' } : null;
  }
  const sub = host.match(ATS_SUBDOMAIN);
  if (sub) return { token: sub[1]!, strength: 'weak', where: `ATS board ${host}` };
  if (ATS_PATH_HOST.test(host) && segments[0] && segments[0] !== 'embed') return { token: segments[0], strength: 'weak', where: `ATS board ${host}` };
  return null;
}

/** Vrai quand le nom de l'entreprise et le nom tiré du lien désignent le même employeur. */
export function reconciles(company: string, token: string): boolean {
  const ct = tokens(company);
  const lt = tokens(token);
  const cc = ct.join('');
  const lc = lt.join('');
  if (cc === '' || lc === '') return true;
  if (cc.includes(lc) || lc.includes(cc)) return true;
  return ct.some((t) => t.length >= 3 && lc.includes(t)) || lt.some((t) => t.length >= 3 && cc.includes(t));
}

/**
 * Le désaccord entre l'entreprise et le lien d'une offre, ou null (d'accord, ou rien à comparer :
 * entreprise vide ou non communiquée, lien qui ne nomme pas l'employeur).
 */
export function companyLinkConflict(company: unknown, link: unknown): { reason: string; strength: 'strong' | 'weak' } | null {
  const name = String(company ?? '').trim();
  if (name === '' || /^entreprise non communiqu/i.test(name) || tokens(name).length === 0) return null;
  const employer = linkEmployer(String(link ?? ''));
  if (employer === null || reconciles(name, employer.token)) return null;
  return { reason: `« ${name} » ne correspond pas à l'employeur « ${employer.token} » du lien (${employer.where})`, strength: employer.strength };
}
