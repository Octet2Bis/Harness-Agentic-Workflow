import { describe, expect, test } from 'bun:test';
import { join, posix, win32 } from 'node:path';
import {
  coreFit,
  type RunRow, LEGACY_CANDIDATE, RADAR_EVERY_MINUTES, RADAR_FIRST_DELAY_MS, allowedHosts, artifactsDirOf, candidatePaths, canLaunch, careerDirOfRun, interviewRunArgs, isLive, isLocalHost, isTextFile, openableUrl, openerArgs, chromeProfileDir, chromeProfileWanted, zoneOf, latestRunBySlug, maskSecretLike, nodeLabel, parseArgs, stepStateKind, stepStateLabel, parseDetachedRunId, parseRuns,
  parseRemarks, progress, pullArgs, radarRunArgs, radarSourceKind, readOffers, readRadarReport, refusal, remarkEntry, readCandidate, respondArgs, runArgs, runsOfCareer, samePath, slugOfRun, sortOffers,
  attentionItems, contactsRunArgs, contactsView, pickPdf, toastCommand,
} from './lib.ts';

const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'station_f', company: 'STATION F', title: 'SALES OPERATIONS &amp; GTM ENGINEER', link: 'https://fr.linkedin.com/jobs/view/1',
  source: 'LinkedIn (Live 24h)', location: 'Paris, France', match_score: 88, tier: 'Gold', status: 'PENDING_VALIDATION',
  hook_angle: 'GTM', jury_verdict: 'ok', harness: null, ...extra,
});

describe('readOffers : le tableau du bot, normalisé', () => {
  test('lit les champs du bot et décode les entités HTML', () => {
    const [o] = readOffers([row()]);
    expect(o).toMatchObject({ slug: 'station_f', title: 'SALES OPERATIONS & GTM ENGINEER', score: 88, status: 'PENDING_VALIDATION', harness: null, applying: null });
  });
  test('garde ce qui décrit l’annonce : description, compétences, salaire, date, rôle visé, siège', () => {
    const [o] = readOffers([row({ description: 'Poste 1-3 ans chez STATION F &amp; co', skills_required: 'revops', salary_range: '38k€ - 50k€', date_published: '2026-09-14', target_role: 'Head of Growth', company_hq: 'Paris' })]);
    expect(o).toMatchObject({ description: 'Poste 1-3 ans chez STATION F & co', skills: 'revops', salary: '38k€ - 50k€', date: '2026-09-14', targetRole: 'Head of Growth', hq: 'Paris' });
  });
  test('ignore ce qui n’est pas une offre, tolère un score absent ou en texte, lit harness et applying', () => {
    const offers = readOffers([null, 'x', { company: 'sans slug' }, row({ match_score: '75', harness: { run: 'r1', stage: 'tailor', at: 't', summary: 's' }, applying: { run: 'r1', at: 't' } })]);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.score).toBe(75);
    expect(offers[0]!.harness).toEqual({ run: 'r1', stage: 'tailor', at: 't', summary: 's', apply_url: '' });
    expect(offers[0]!.applying).toEqual({ run: 'r1', at: 't' });
    expect(readOffers({ not: 'an array' })).toEqual([]);
    expect(readOffers([row({ match_score: undefined })])[0]!.score).toBeNull();
  });
});

describe('canLaunch : mêmes règles que la prise du tableau', () => {
  test('PENDING_VALIDATION, VALIDATED, TAILORED, APPLY_FAILED se lancent ; APPLYING, APPLIED, APPLY_UNPROVEN non', () => {
    for (const status of ['PENDING_VALIDATION', 'VALIDATED', 'TAILORED', 'APPLY_FAILED']) expect(canLaunch(readOffers([row({ status })])[0]!).ok).toBe(true);
    for (const status of ['APPLYING', 'APPLIED', 'APPLY_UNPROVEN', 'REJECTED']) expect(canLaunch(readOffers([row({ status })])[0]!).ok).toBe(false);
    expect(canLaunch(readOffers([row({ status: 'APPLY_UNPROVEN' })])[0]!).reason).toContain('boîte mail');
  });
});

describe('les commandes Archon', () => {
  test('runArgs : career-apply en dossier sans git, mode confirm par défaut, détaché', () => {
    expect(runArgs({ harness: 'C:\\H', slug: 'acme', careerDir: 'C:\\career' })).toEqual([
      'workflow', 'run', 'career-apply', '--cwd', 'C:\\H', '--folder', '--input', 'slug=acme', '--input', 'career_dir=C:\\career', '--input', 'mode=confirm', '--detach',
    ]);
    expect(runArgs({ harness: 'h', slug: 'a', careerDir: 'c', mode: 'verified-only', verifiedPlatforms: 'lever' })).toContain('verified_platforms=lever');
  });
  test('parseDetachedRunId lit « Run id: … »', () => {
    expect(parseDetachedRunId("Started 'career-apply' in the background.\nRun id: 88320bca-6c49\nTrack it with: archon workflow get 88320bca-6c49\n")).toBe('88320bca-6c49');
    expect(parseDetachedRunId('rien')).toBeNull();
  });
  test('respondArgs : approve/reject, ou respond avec la raison', () => {
    expect(respondArgs('r1', 'approve')).toEqual(['workflow', 'approve', 'r1']);
    expect(respondArgs('r1', 'reject', ' pas cette offre ')).toEqual(['workflow', 'respond', 'r1', 'reject', 'pas cette offre']);
  });
});

describe('interview-prep : un run par offre, repéré par son dossier', () => {
  test('la commande du README du bloc', () => {
    expect(interviewRunArgs({ harness: 'C:\\h', careerDir: 'C:\\career', slug: 'acme', stage: 'manager', join: win32.join })).toEqual([
      'workflow', 'run', 'interview-prep', '--cwd', 'C:\\h', '--folder', '--input', 'application=C:\\career\\applications\\acme', '--input', 'profile=C:\\career\\master_profile.md', '--input', 'stage=manager', '--detach']);
  });
  test('careerDirOfRun retrouve le dossier carrière depuis application=', () => {
    expect(careerDirOfRun({ id: 'i', status: 'completed', metadata: { inputs: { application: 'C:\\Users\\HP\\career\\applications\\acme' } } })).toBe('C:\\Users\\HP\\career');
    expect(careerDirOfRun({ id: 'i', status: 'completed', metadata: { inputs: { application: '/tmp/career/applications/acme/' } } })).toBe('/tmp/career');
    expect(careerDirOfRun({ id: 'i', status: 'completed', metadata: { inputs: { application: '/tmp/acme' } } })).toBeNull();
  });
  test('slugOfRun lit le dossier application ; latestRunBySlug filtre par workflow', () => {
    const rows = [
      { id: 'i1', status: 'completed', workflow_name: 'interview-prep', started_at: '2026-10-22T10:00:00Z', metadata: { inputs: { application: 'C:\\career\\applications\\acme\\' } } },
      { id: 'c1', status: 'paused', workflow_name: 'career-apply', started_at: '2026-10-22T11:00:00Z', metadata: { inputs: { slug: 'acme' } } },
    ];
    expect(slugOfRun(rows[0]!)).toBe('acme');
    expect([...latestRunBySlug(rows).values()].map((r) => r.id)).toEqual(['c1']);
    expect([...latestRunBySlug(rows, {}, 'interview-prep').values()].map((r) => r.id)).toEqual(['i1']);
    // La relève notée sous `#radar` dans launches.json (ou une ancienne clé `radar`) n'est jamais prise pour une candidature (elle bloquerait la file).
    const withRadar = [...rows, { id: 'radar-1', status: 'running', workflow_name: 'career-radar', started_at: '2026-10-22T12:00:00Z', metadata: { inputs: { career_dir: 'C:\\career' } } }];
    expect([...latestRunBySlug(withRadar, { acme: 'c1', '#radar': 'radar-1' }).keys()]).toEqual(['acme']);
    expect([...latestRunBySlug(withRadar, { acme: 'c1', radar: 'radar-1' }).keys()]).toEqual(['acme']);
    expect([...latestRunBySlug(withRadar, { '#radar': 'radar-1' }, 'career-radar').keys()]).toEqual(['#radar']);
  });
});

describe('relève des sources (career-radar)', () => {
  test('radarRunArgs : la commande du système, détachée, sur le dossier carrière ; sources et env_file seulement s’ils sont donnés', () => {
    expect(radarRunArgs({ harness: 'C:\\H', careerDir: 'C:\\career' })).toEqual(['workflow', 'run', 'career-radar', '--cwd', 'C:\\H', '--folder', '--input', 'career_dir=C:\\career', '--detach']);
    expect(radarRunArgs({ harness: 'h', careerDir: 'c', sources: ' linkedin,remotive ', envFile: '' })).toEqual(['workflow', 'run', 'career-radar', '--cwd', 'h', '--folder', '--input', 'career_dir=c', '--input', 'sources=linkedin,remotive', '--detach']);
    expect(radarRunArgs({ harness: 'h', careerDir: 'c', envFile: 'C:\\secrets\\.env' })).toContain('env_file=C:\\secrets\\.env');
  });
  test('radarSourceKind suit sourceCounts du radar : 200, OK…, run lancé… sont ok ; attente… est warn ; tout le reste (clé absente, erreur réseau, 4xx/5xx, inconnu) est bad', () => {
    for (const s of ['200', 'OK', 'ok', 'OK (12 offres)', 'run lancé (Apify)', 'run Apify en cours']) expect(radarSourceKind(s)).toBe('ok');
    for (const s of ['attente (prochain appel dans 12 min)', 'Attente du quota']) expect(radarSourceKind(s)).toBe('warn');
    for (const s of ['clé absente (ADZUNA_APP_KEY)', 'erreur réseau', 'échec de lecture', 'timeout', '403', '500 Internal Server Error', '204', '', undefined, 'désactivée']) expect(radarSourceKind(s)).toBe('bad');
  });
  test('maskSecretLike : un nom de variable passe, ce qui ressemble à une valeur de clé non', () => {
    expect(maskSecretLike('clé absente (ADZUNA_APP_KEY)')).toBe('clé absente (ADZUNA_APP_KEY)');
    expect(maskSecretLike('attente (prochain appel dans 12 min)')).toBe('attente (prochain appel dans 12 min)');
    expect(maskSecretLike('401 avec la clé a1b2c3d4e5f6a7b8c9d0e1f2')).toBe('401 avec la clé [valeur masquée]');
    expect(maskSecretLike('sk-proj-ABCDEFGHIJKLMNOP1234567890')).toBe('[valeur masquée]');
    expect(maskSecretLike(null)).toBe('');
  });
  test('readRadarReport : le rapport du radar normalisé (familles par source, compteurs, slugs ajoutés) ; autre chose rend null', () => {
    const r = readRadarReport({
      at: '2026-10-23T08:00:00.000Z',
      sources: [{ name: 'linkedin', status: '200', count: 12, duration_ms: 1840.4 }, { name: 'adzuna', status: 'clé absente (ADZUNA_APP_KEY)', count: 0, duration_ms: 1 }, { name: 'wttj', status: 'erreur réseau', count: '0', duration_ms: 'x' }, null, 'x'],
      raw_count: 12, qualified_count: 3, added: 1, added_slugs: ['acme', '', 7], rejected_count: 9,
    })!;
    expect(r).toMatchObject({ at: '2026-10-23T08:00:00.000Z', rawCount: 12, qualifiedCount: 3, added: 1, addedSlugs: ['acme', '7'], rejectedCount: 9, okCount: 1, failedCount: 2 });
    expect(r.sources.map((s) => [s.name, s.kind, s.count, s.durationMs])).toEqual([['linkedin', 'ok', 12, 1840], ['adzuna', 'bad', 0, 1], ['wttj', 'bad', 0, 0]]);
    // Quand le radar donne ses propres comptes (sources_ok, sources_failed), ce sont eux qui s'affichent.
    expect(readRadarReport({ sources: [{ name: 'a', status: '200' }], sources_ok: 3, sources_failed: 0 })).toMatchObject({ okCount: 3, failedCount: 0 });
    expect(readRadarReport({})).toMatchObject({ at: '', sources: [], rawCount: 0, added: 0, addedSlugs: [], okCount: 0, failedCount: 0 });
    expect(readRadarReport(null)).toBeNull();
    expect(readRadarReport([1])).toBeNull();
    expect(readRadarReport('x')).toBeNull();
  });
});

describe('parseRuns / latestRunBySlug / progress', () => {
  const runs = [
    { id: 'old', status: 'failed', workflow_name: 'career-apply', started_at: '2026-10-22T13:00:00Z', metadata: { inputs: { slug: 'station_f' } }, nodes: [{ nodeId: 'load', state: 'completed' }, { nodeId: 'work', state: 'failed' }] },
    { id: 'new', status: 'paused', workflow_name: 'career-apply', started_at: '2026-10-22T15:00:00Z', output_root: '/root', metadata: { inputs_values: { slug: 'station_f' } }, nodes: [{ nodeId: 'load', state: 'completed' }, { nodeId: 'tailor__verdict', state: 'completed' }, { nodeId: 'submit__go', state: 'waiting' }, { nodeId: 'record', state: 'pending' }] },
    { id: 'other', status: 'completed', workflow_name: 'research', started_at: '2026-10-22T16:00:00Z', metadata: { inputs: { slug: 'station_f' } } },
    { id: 'anon', status: 'running', workflow_name: 'career-apply', started_at: '2026-10-22T16:00:00Z', metadata: null },
  ];
  test('parseRuns accepte un tableau JSON, une ligne par run, ou { runs: [...] }, et ignore le texte', () => {
    expect(parseRuns(JSON.stringify(runs)).map((r) => r.id)).toEqual(['old', 'new', 'other', 'anon']);
    expect(parseRuns(runs.map((r) => JSON.stringify(r)).join('\n') + '\nnote: fin').map((r) => r.id)).toEqual(['old', 'new', 'other', 'anon']);
    expect(parseRuns(JSON.stringify({ runs })).length).toBe(4);
    expect(parseRuns('')).toEqual([]);
  });
  test('slugOfRun lit inputs_values puis inputs', () => {
    expect(slugOfRun(runs[1] as never)).toBe('station_f');
    expect(slugOfRun(runs[3] as never)).toBeNull();
  });
  test('latestRunBySlug garde le run career-apply le plus récent par offre, et rattache les runs lancés par le cockpit', () => {
    const latest = latestRunBySlug(parseRuns(JSON.stringify(runs)), { huron: 'anon' });
    expect(latest.get('station_f')?.id).toBe('new');
    expect(latest.get('huron')?.id).toBe('anon');
    expect(latest.size).toBe(2);
  });
  test('progress compte les nœuds et trouve la pause qui attend le go', () => {
    expect(progress(runs[1] as never)).toEqual({ total: 4, done: 2, failed: [], running: [], waiting: 'submit__go' });
    expect(progress(runs[0] as never)).toMatchObject({ done: 1, failed: ['work'], waiting: null });
    expect(progress({ id: 'x', status: 'running' })).toEqual({ total: 0, done: 0, failed: [], running: [], waiting: null });
  });
  test('artifactsDirOf suit Archon : <output_root>/artifacts/runs/<id>', () => {
    expect(artifactsDirOf(runs[1] as never, join)).toBe(join('/root', 'artifacts', 'runs', 'new'));
    expect(artifactsDirOf(runs[0] as never, join)).toBeNull();
  });
  test('libellés et états', () => {
    expect(nodeLabel('submit__go')).toBe('Ton go');
    expect(nodeLabel('inconnu')).toBe('inconnu');
    expect(nodeLabel('tailor__write')).toBe('CV sur mesure : rédaction');
    expect(nodeLabel('bloc__etape_x')).toBe('bloc › etape x');
    expect(nodeLabel('toString')).toBe('toString');
    // Libellés propres à un workflow : le `record` de la relève n'est pas celui de career-apply ; un workflow inconnu retombe sur la table commune.
    expect(nodeLabel('record')).toBe('Enregistrement sur le tableau');
    expect(nodeLabel('record', 'career-radar')).toBe('fusion dans le tableau');
    expect(nodeLabel('collect', 'career-radar')).toBe('lecture des sources');
    expect(nodeLabel('radar__screen', 'career-radar')).toBe('contrôles');
    expect(nodeLabel('submit__go', 'career-radar')).toBe('Ton go');
    expect(nodeLabel('record', 'career-apply')).toBe('Enregistrement sur le tableau');
    expect(nodeLabel('collect', 'hasOwnProperty')).toBe('collect');
    expect(stepStateLabel('COMPLETED')).toBe('faite');
    expect(stepStateKind('error')).toBe('bad');
    expect(stepStateKind('in_progress')).toBe('live');
    expect(stepStateKind('skipped')).toBe('');
    expect(isLive('paused')).toBe(true);
    expect(isLive('completed')).toBe(false);
    expect(isTextFile('CV.md')).toBe(true);
    expect(isTextFile('CV.pdf')).toBe(false);
  });
});

describe('parseArgs', () => {
  test('--career-dir obligatoire ; valeurs par défaut', () => {
    expect(parseArgs(['--career-dir', 'C:\\career'])).toEqual({ careerDir: 'C:\\career', harness: null, port: null, archon: ['archon'], mode: 'confirm', verifiedPlatforms: '', open: true, pull: null, pullEvery: 5, allowHosts: [], triage: true, triageEngine: 'rules', radar: true, radarEvery: 15, toast: true, contacts: false });
    expect(parseArgs(['--career-dir', 'c', '--triage-engine', 'llm', '--contacts'])).toMatchObject({ triageEngine: 'llm', contacts: true });
    expect(() => parseArgs(['--career-dir', 'c', '--triage-engine', 'opus'])).toThrow();
    expect(parseArgs(['--career-dir', 'c', '--no-toast', '--no-contacts'])).toMatchObject({ toast: false, contacts: false });
    expect(RADAR_EVERY_MINUTES).toBe(15);
    expect(RADAR_FIRST_DELAY_MS).toBe(60_000);
    expect(() => parseArgs([])).toThrow('--career-dir');
  });
  test('options', () => {
    const a = parseArgs(['--career-dir', 'c', '--harness', 'h', '--port', '9000', '--archon', 'bun cli.ts', '--mode', 'verified-only', '--verified-platforms', 'lever', '--no-open']);
    expect(a).toMatchObject({ harness: 'h', port: 9000, archon: ['bun', 'cli.ts'], mode: 'verified-only', verifiedPlatforms: 'lever', open: false });
    expect(() => parseArgs(['--career-dir', 'c', '--mode', 'yolo'])).toThrow('--mode');
    expect(() => parseArgs(['--career-dir', 'c', '--zut'])).toThrow('inconnu');
    expect(parseArgs(['--career-dir', 'c', '--pull', 'bun fake.ts', '--pull-every', '0'])).toMatchObject({ pull: ['bun', 'fake.ts'], pullEvery: 0 });
    expect(() => parseArgs(['--career-dir', 'c', '--pull-every', '-1'])).toThrow('--pull-every');
    expect(parseArgs(['--career-dir', 'c', '--allow-host', 'PC.tailnet.ts.net', '--allow-host', 'x:8443']).allowHosts).toEqual(['pc.tailnet.ts.net', 'x:8443']);
    expect(parseArgs(['--career-dir', 'c', '--no-triage', '--no-radar'])).toMatchObject({ triage: false, radar: false, radarEvery: 15 });
    expect(parseArgs(['--career-dir', 'c', '--radar-every', '0.05'])).toMatchObject({ radar: true, radarEvery: 0.05 });
    expect(() => parseArgs(['--career-dir', 'c', '--radar-every', '-1'])).toThrow('--radar-every');
  });
});

describe('refusal : seule la page du cockpit agit', () => {
  const allowed = allowedHosts(8766, ['pc.tailnet.ts.net']);
  const req = (extra: Partial<Parameters<typeof refusal>[0]> = {}) => ({ method: 'POST', host: '127.0.0.1:8766', origin: null, referer: null, contentType: 'application/json', ...extra });
  test('la page elle-même, un client sans navigateur, le proxy accepté : oui', () => {
    expect(allowed).toEqual(['127.0.0.1:8766', 'localhost:8766', 'pc.tailnet.ts.net']);
    expect(refusal(req({ origin: 'http://127.0.0.1:8766' }), allowed)).toBeNull();
    expect(refusal(req({ referer: 'http://localhost:8766/#acme' , host: 'localhost:8766' }), allowed)).toBeNull();
    expect(refusal(req(), allowed)).toBeNull();
    expect(refusal(req({ host: 'pc.tailnet.ts.net', origin: 'https://pc.tailnet.ts.net' }), allowed)).toBeNull();
    expect(refusal({ ...req({ host: '127.0.0.1:8766' }), method: 'GET', contentType: null }, allowed)).toBeNull();
  });
  test('un autre site, un domaine rebondi, un corps non JSON : non', () => {
    expect(refusal(req({ origin: 'https://evil.example' }), allowed)).toContain('autre page');
    expect(refusal(req({ origin: 'null' }), allowed)).toContain('illisible');
    expect(refusal(req({ referer: 'http://127.0.0.1.evil.example:8766/' }), allowed)).toContain('autre page');
    expect(refusal(req({ origin: 'file://' }), allowed)).not.toBeNull();
    expect(refusal(req({ contentType: 'text/plain' }), allowed)).toContain('application/json');
    expect(refusal({ ...req({ host: 'rebind.evil.example:8766' }), method: 'GET', contentType: null }, allowed)).toContain('hôte');
    expect(refusal(req({ host: null }), allowed)).toContain('hôte');
  });
});

describe('le tableau de la VM', () => {
  test('pullArgs : sync_pending.ps1 -Direction pull sur le dossier carrière du cockpit, PowerShell selon la plateforme', () => {
    const win = pullArgs({ harness: 'C:\\h', careerDir: 'C:\\h\\.local\\career', platform: 'win32', join: win32.join, resolve: win32.resolve });
    expect(win).toEqual(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\h\\integrations\\master-plan\\sync_pending.ps1', '-Direction', 'pull', '-CareerDir', 'C:\\h\\.local\\career']);
    expect(pullArgs({ harness: '/h', careerDir: '/mp/02_Assistant_Personnel/Workspace/career', platform: 'linux', join: posix.join, resolve: posix.resolve })[0]).toBe('pwsh');
  });
  test('sortOffers : les plus récentes d’abord, puis le score, puis l’ordre du tableau', () => {
    const rows = [{ slug: 'a', date: '2026-09-15', score: 90 }, { slug: 'b', date: '2026-10-22', score: 70 }, { slug: 'c', date: '2026-10-22', score: 95 }, { slug: 'd', date: '', score: null }, { slug: 'e', date: '2026-10-22', score: 70 }];
    expect(sortOffers(rows).map((o) => o.slug)).toEqual(['c', 'b', 'e', 'a', 'd']);
  });
  test('sortOffers : une offre ajoutée à la main se range au jour de son ajout', () => {
    const rows = [{ slug: 'a', date: '2026-11-10', score: 75 }, { slug: 'canonical', date: '2026-07-06', score: 75, added: '2026-11-13' }];
    expect(sortOffers(rows).map((o) => o.slug)).toEqual(['canonical', 'a']);
  });
  test('sortOffers : une offre du site de l’employeur se range au jour où le radar l’a trouvée', () => {
    const rows = [{ slug: 'a', date: '2026-11-10', score: 75 }, { slug: 'kit', date: '2026-08-01', score: 75, seen: '2026-11-12' }];
    expect(sortOffers(rows).map((o) => o.slug)).toEqual(['kit', 'a']);
  });
});

describe('remarques : même fichier et même forme que /remarque du bot', () => {
  test('remarkEntry date la remarque et refuse le vide', () => {
    expect(remarkEntry('  Insiste sur le tracking GTM \r\n', new Date('2026-10-22T14:30:00Z'))).toBe('[2026-10-22T14:30:00.000Z] Insiste sur le tracking GTM\n');
    expect(() => remarkEntry('  ', new Date())).toThrow('vide');
  });
  test('parseRemarks lit les entrées du bot et les lignes de suite', () => {
    expect(parseRemarks('[2026-10-22T14:30:00.000Z] Insiste sur GTM\n[2026-10-22T15:00:00.000Z] Moins de QA\nsuite\n\n')).toEqual([
      { at: '2026-10-22T14:30:00.000Z', text: 'Insiste sur GTM' },
      { at: '2026-10-22T15:00:00.000Z', text: 'Moins de QA\nsuite' },
    ]);
    expect(parseRemarks('sans date')).toEqual([{ at: '', text: 'sans date' }]);
    expect(parseRemarks('')).toEqual([]);
  });
});

describe('candidats', () => {
  test('sans candidat.json : le candidat d’origine (profil .local/browser-profile, launches.json, tableau de la VM)', () => {
    const c = readCandidate(null);
    expect(c).toEqual(LEGACY_CANDIDATE);
    expect(candidatePaths(c, 'C:\\h', win32.join, win32.isAbsolute)).toEqual({ browserProfile: 'C:\\h\\.local\\browser-profile', launches: 'C:\\h\\.local\\cockpit\\launches.json' });
  });

  test('avec candidat.json : nom, port, profil de navigateur et runs à part ; pas de VM sauf demande', () => {
    const c = readCandidate({ id: 'camille', nom: 'Camille', port: 8767, acces_telephone: ['c@ex.com', '', 3] });
    expect(c).toEqual({ id: 'camille', name: 'Camille', port: 8767, browserProfile: null, pull: 'none', allowUsers: ['c@ex.com'], radarAuto: true });
    expect(readCandidate({ id: 'a', radar_auto: false }).radarAuto).toBe(false);
    expect(readCandidate({ id: 'a', radar_auto: true }).radarAuto).toBe(true);
    expect(candidatePaths(c, '/h', posix.join, posix.isAbsolute)).toEqual({ browserProfile: '/h/.local/browser-profile-camille', launches: '/h/.local/cockpit/camille/launches.json' });
    expect(readCandidate({ id: 'a', tableau_depuis_vm: true }).pull).toBe('vm');
    expect(readCandidate({ id: 'a' }).name).toBe('a');
    expect(candidatePaths(readCandidate({ id: 'a', profil_navigateur: 'D:\\nav' }), 'C:\\h', win32.join, win32.isAbsolute).browserProfile).toBe('D:\\nav');
    expect(candidatePaths(readCandidate({ id: 'a', profil_navigateur: '.local/x' }), '/h', posix.join, posix.isAbsolute).browserProfile).toBe('/h/.local/x');
  });

  test('un candidat.json mal formé est refusé, jamais deviné', () => {
    expect(() => readCandidate([])).toThrow('objet');
    expect(() => readCandidate({ nom: 'X' })).toThrow('"id"');
    expect(() => readCandidate({ id: 'Camille' })).toThrow('"id"');
    expect(() => readCandidate({ id: '../x' })).toThrow('"id"');
    expect(() => readCandidate({ id: 'a', port: 70000 })).toThrow('"port"');
    expect(() => readCandidate({ id: 'a', profil_navigateur: ' ' })).toThrow('profil_navigateur');
    expect(() => readCandidate({ id: 'a', radar_auto: 'non' })).toThrow('radar_auto');
  });

  test('chaque cockpit ne voit que les runs de son dossier carrière (plus ceux qu’il a lancés)', () => {
    const run = (id: string, dir?: string): RunRow => ({ id, status: 'running', workflow_name: 'career-apply', metadata: dir === undefined ? null : { inputs: { slug: 'acme', career_dir: dir } } });
    const rows = [run('a', 'C:\\MP\\career'), run('b', 'C:\\Users\\HP\\Desktop\\Carriere-Camille\\'), run('c'), run('d')];
    expect(runsOfCareer(rows, 'c:/mp/career/', {}, 'win32').map((r) => r.id)).toEqual(['a']);
    expect(runsOfCareer(rows, 'C:\\Users\\HP\\Desktop\\Carriere-Camille', { acme: 'd' }, 'win32').map((r) => r.id)).toEqual(['b', 'd']);
    expect(samePath('/a/B', '/a/b', 'linux')).toBe(false);
    expect(samePath('C:\\A\\', 'c:/a', 'win32')).toBe(true);
  });
});

describe('ouvrir une annonce dans le navigateur par défaut du PC', () => {
  test('openableUrl : http(s) seulement, sans espace ni contrôle', () => {
    expect(openableUrl('https://jobs.lever.co/acme/1?lever-source=x&y=2')).toBe('https://jobs.lever.co/acme/1?lever-source=x&y=2');
    expect(openableUrl('http://example.com')).toBe('http://example.com/');
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/system32/calc.exe', 'https://a.com/x y', 'https://a.com/\nx', 'notaurl', 42, null, `https://a.com/${'x'.repeat(2100)}`]) expect(openableUrl(bad)).toBeNull();
  });
  test('openerArgs : sans shell sous Windows, open / xdg-open ailleurs', () => {
    expect(openerArgs('win32', 'https://a.com/?x=1&y=2')).toEqual(['rundll32', 'url.dll,FileProtocolHandler', 'https://a.com/?x=1&y=2']);
    expect(openerArgs('darwin', 'https://a.com/')).toEqual(['open', 'https://a.com/']);
    expect(openerArgs('linux', 'https://a.com/')).toEqual(['xdg-open', 'https://a.com/']);
    // Chrome trouvé sous Windows : l'annonce s'ouvre dans Chrome, sans shell.
    expect(openerArgs('win32', 'https://a.com/', 'C:\\Chrome\\chrome.exe')).toEqual(['C:\\Chrome\\chrome.exe', 'https://a.com/']);
    expect(openerArgs('darwin', 'https://a.com/', 'C:\\Chrome\\chrome.exe')).toEqual(['open', 'https://a.com/']);
    expect(openerArgs('win32', 'https://a.com/', 'C:\\Chrome\\chrome.exe', 'Profile 2')).toEqual(['C:\\Chrome\\chrome.exe', '--profile-directory=Profile 2', 'https://a.com/']);
  });

  test('chromeProfileDir : le profil Chrome par nom, compte Google ou dossier ; rien quand c’est ambigu', () => {
    const state = { profile: { info_cache: {
      Default: { name: 'Rocket School', user_name: 'prenom@rocket-school.example', gaia_name: 'Prénom Nom' },
      'Profile 2': { name: 'Perso', user_name: 'prenom.nom@mail.example', gaia_name: 'Prénom Nom' },
      'Profile 3': { name: 'Test', user_name: '' },
    } } };
    expect(chromeProfileDir(state, 'prenom.nom')).toBe('Profile 2');
    expect(chromeProfileDir(state, 'PRENOM.NOM@mail.example')).toBe('Profile 2');
    expect(chromeProfileDir(state, 'perso')).toBe('Profile 2');
    expect(chromeProfileDir(state, 'Profile 3')).toBe('Profile 3');
    expect(chromeProfileDir(state, 'rocket')).toBe('Default');
    expect(chromeProfileDir(state, 'prénom nom')).toBeNull(); // deux profils au même nom de personne
    expect(chromeProfileDir(state, 'inconnu')).toBeNull();
    expect(chromeProfileDir({}, 'perso')).toBeNull();
    expect(chromeProfileDir(state, '')).toBeNull();
    expect(chromeProfileWanted({ profil: ' perso ' })).toBe('perso');
    expect(chromeProfileWanted(null)).toBe('');
  });
  test('isLocalHost : le PC seulement, pas le téléphone', () => {
    expect(isLocalHost('127.0.0.1:8766', 8766)).toBe(true);
    expect(isLocalHost('LOCALHOST:8766', 8766)).toBe(true);
    expect(isLocalHost('pc.tail1234.ts.net:8766', 8766)).toBe(false);
    expect(isLocalHost('127.0.0.1:9999', 8766)).toBe(false);
    expect(isLocalHost(null, 8766)).toBe(false);
  });
});

describe('zoneOf : la règle de zone du radar sur une ligne du tableau', () => {
  const { evaluateTerritory } = require('../../.archon/workflows/systems/.shared/radar/inspectors/remote_auditor.js');
  test('hors Europe écartée, Europe et monde gardés, entités décodées', () => {
    expect(zoneOf({ location: 'Remote, AMER' }, evaluateTerritory)).toEqual({ pass: false, reason: 'Zone hors Europe dans la localisation : "Remote, AMER"' });
    expect(zoneOf({ location: 'Toronto, Canada' }, evaluateTerritory).pass).toBe(false);
    expect(zoneOf({ location: 'Remote', description: 'Candidates must be US-based.' }, evaluateTerritory).pass).toBe(false);
    for (const location of ['United Kingdom', 'Amer, Catalonia, Spain', 'Remote (US or Europe)', 'Worldwide', '']) expect(zoneOf({ location }, evaluateTerritory).pass).toBe(true);
    expect(zoneOf(null, evaluateTerritory).pass).toBe(true);
    // Canonical (Greenhouse) : « Home based - … » = télétravail ; « Office based - … » non.
    const { parseBoard } = require('../../.archon/workflows/systems/.shared/radar/fetchers/ats_boards.js');
    const posts = parseBoard('greenhouse', 'canonical', { jobs: [{ id: 1, title: 'Content Marketing Manager', absolute_url: 'https://x/1', location: { name: 'Home based - EMEA' } }, { id: 2, title: 'Graduate SDR', absolute_url: 'https://x/2', location: { name: 'Office based - London, UK' } }] });
    expect(posts.map((p: { remote: boolean }) => p.remote)).toEqual([true, false]);
    expect(zoneOf({ location: 'Home based - Americas; Home based - EMEA' }, evaluateTerritory).pass).toBe(true);
  });
});

import { chromePath, robotBrowserArgs } from './lib.ts';

describe('navigateur du robot', () => {
  test('Chrome cherché chez Google (machine, x86, utilisateur) ; null sinon', () => {
    const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\HP\\AppData\\Local' };
    expect(chromePath(env, (p) => p.startsWith('C:\\Users'))).toBe('C:\\Users\\HP\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    expect(chromePath(env, (p) => p === 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(chromePath(env, () => false)).toBeNull();
  });
  test('le profil du candidat, l’adresse en dernier argument, sans shell', () => {
    expect(robotBrowserArgs('chrome.exe', 'C:\\H\\.local\\browser-profile', 'https://jobs.dana.com/a?b=1&c=2')).toEqual(['chrome.exe', '--user-data-dir=C:\\H\\.local\\browser-profile', '--no-first-run', 'https://jobs.dana.com/a?b=1&c=2']);
  });
  test('la page employeur du dernier passage est lue, jamais hors https', () => {
    const [ok, bad] = readOffers([row({ harness: { run: 'r', stage: 'submit', at: 't', summary: 's', apply_url: 'https://jobs.dana.com/x' } }), row({ slug: 'b', harness: { run: 'r', stage: 'submit', at: 't', summary: 's', apply_url: 'javascript:alert(1)' } })]);
    expect(ok!.harness!.apply_url).toBe('https://jobs.dana.com/x');
    expect(bad!.harness!.apply_url).toBe('');
  });
});

describe('décideurs (bloc decision-makers)', () => {
  test('le run part sur le dossier de l’offre avec le profil maître, détaché', () => {
    expect(contactsRunArgs({ harness: '/h', careerDir: '/c', slug: 'dana', join: posix.join })).toEqual(['workflow', 'run', 'decision-makers', '--cwd', '/h', '--folder', '--input', 'application=/c/applications/dana', '--input', 'profile=/c/master_profile.md', '--detach']);
  });

  test('decideurs.json : liens LinkedIn et Hunter construits ici, source LinkedIn ou courtier retirée, aucune adresse gardée', () => {
    const v = contactsView({
      company: 'Dana Incorporated', job_title: 'Sales Ops', domain: 'Dana.com', language: 'en',
      people: [
        { name: 'Jane Doe', role: 'VP Sales', why: 'dirige l’équipe', source: 'https://www.dana.com/leadership', evidence: 'Jane Doe, VP' },
        { name: 'John Roe', role: 'Recruiter', why: 'recrute', source: 'https://fr.linkedin.com/in/johnroe' },
        { name: '', role: 'x' },
      ],
      searches: ['Dana "Sales Operations"'],
      linkedin_note: { to: 'Jane Doe', text: 'Hi Jane, écris-moi à jane@dana.com' },
      email: { to: 'Jane Doe', subject: 'Sales Ops', body: 'Hello' },
      sources: ['https://www.dana.com/leadership', 'http://insecure.example', 'https://www.zoominfo.com/p/x'],
    })!;
    expect(v.domain).toBe('dana.com');
    expect(v.hunter).toBe('https://hunter.io/search/dana.com');
    expect(v.people.map((p) => p.name)).toEqual(['Jane Doe', 'John Roe']);
    expect(v.people[0]!.linkedin).toBe('https://www.linkedin.com/search/results/people/?keywords=Jane%20Doe%20Dana%20Incorporated');
    expect(v.people[1]!.source).toBe('');
    expect(v.searches[0]!.url).toContain('keywords=Dana%20%22Sales%20Operations%22');
    expect(v.note.text).not.toContain('@');
    expect(v.sources).toEqual(['https://www.dana.com/leadership']);
    expect(contactsView({ company: 'x' })).toBeNull();
    expect(contactsView({ people: [], domain: 'https://dana.com/' })!.hunter).toBe('');
  });

  test('le PDF ouvert est celui du run quand il existe, sinon celui du dossier ; jamais un PDF refusé', () => {
    expect(pickPdf('cv', ['application/CV.md', 'application/CV.pdf'], ['CV_Antoine_Lecerf_dana.pdf'])).toEqual({ from: 'run', path: 'application/CV.pdf' });
    expect(pickPdf('cv', [], ['CV_Antoine_Lecerf_dana.rejected.pdf', 'CV_Antoine_Lecerf_dana.pdf'])).toEqual({ from: 'dossier', path: 'CV_Antoine_Lecerf_dana.pdf' });
    expect(pickPdf('lettre', ['application/letter.pdf'], [])).toEqual({ from: 'run', path: 'application/letter.pdf' });
    expect(pickPdf('lettre', ['application/CV.pdf'], ['Lettre_Antoine_dana.rejected.pdf'])).toBeNull();
  });
});

describe('alerte « à toi »', () => {
  const offer = (extra: Record<string, unknown>) => readOffers([row(extra)])[0]!;
  test('go attendu, compte à ouvrir, candidature à la main, envoi à vérifier, étape en échec ; un refus au go ou un run qui travaille n’en sont pas', () => {
    const items = attentionItems([
      offer({ slug: 'fail', company: 'Fail', status: 'VALIDATED' }),
      offer({ slug: 'dana', company: 'Dana', status: 'TAILORED', harness: { run: 'r1', stage: 'submit', at: '2026-10-24T17:03', summary: 'Form did not converge: Compte Dana à créer ou à ouvrir sur jobs.dana.com dans le navigateur du robot, puis relancer' } }),
      offer({ slug: 'acme', company: 'Acme', status: 'APPLYING' }),
      offer({ slug: 'route', company: 'Route', status: 'TAILORED', harness: { run: 'r2', stage: 'route', at: 't2', summary: 'No application page: resolve found nothing' } }),
      offer({ slug: 'no', company: 'No', status: 'TAILORED', harness: { run: 'r3', stage: 'submit', at: 't3', summary: 'Refused at the go: nothing was sent. No reason given.' } }),
      offer({ slug: 'unp', company: 'Unp', status: 'APPLY_UNPROVEN', harness: { run: 'r4', stage: 'submit', at: 't4', summary: 'maybe sent' } }),
      offer({ slug: 'busy', company: 'Busy', status: 'APPLYING' }),
    ], {
      acme: { id: 'run-acme', status: 'paused', waiting: 'submit__go', failed: [] },
      busy: { id: 'run-busy', status: 'running', waiting: null, failed: [] },
      fail: { id: 'run-fail', status: 'failed', waiting: null, failed: ['render'] },
    });
    expect(items.map((i) => [i.kind, i.slug])).toEqual([['go', 'acme'], ['compte', 'dana'], ['main', 'route'], ['verifier', 'unp'], ['panne', 'fail']]);
    expect(items[0]!.key).toBe('go:run-acme');
    expect(items[1]!.key).toBe('compte:dana:2026-10-24T17:03');
    expect(items[4]!.detail).toContain('PDF du CV et de la lettre');
  });

  test('la notification Windows : script en -EncodedCommand, titre échappé pour le XML et pour PowerShell', () => {
    const argv = toastCommand("Go attendu : L'Oréal & Co <x>", 'Relis le CV', 'http://127.0.0.1:8766/#loreal');
    expect(argv.slice(0, 6)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand']);
    const script = Buffer.from(argv[6]!, 'base64').toString('utf16le');
    expect(script).toContain("L&apos;Oréal &amp; Co &lt;x&gt;");
    expect(script).toContain('launch="http://127.0.0.1:8766/#loreal"');
    expect(script).not.toMatch(/LoadXml\('[^\n]*[^']'[^')\n]/);
  });
});

describe('coreFit', () => {
  test('lit la note du tri et la classe : forte, moyenne, faible', () => {
    expect(coreFit(['Publiée le 2026-10-24 (1 jour, max 7)', 'Cœur du poste : 2 exigences étayées, 1 en partie, 0 absente du profil, sur 3'])).toEqual({ level: 'forte', proven: 2, partial: 1, missing: 0, total: 3 });
    expect(coreFit(['Cœur du poste : 3 exigences étayées, 0 en partie, 0 absente du profil, sur 3'])!.level).toBe('forte');
    expect(coreFit(['Cœur du poste : 1 exigence étayée, 1 en partie, 1 absente du profil, sur 3'])!.level).toBe('moyenne');
    expect(coreFit(['Cœur du poste : 0 exigence étayée, 3 en partie, 0 absente du profil, sur 3'])!.level).toBe('moyenne');
    expect(coreFit(['Cœur du poste : 0 exigence étayée, 2 en partie, 1 absente du profil, sur 3'])!.level).toBe('faible');
  });
  test('rien à lire : null', () => {
    expect(coreFit(['Adéquation au cœur du poste non évaluée : profil absent'])).toBeNull();
    expect(coreFit([])).toBeNull();
    expect(coreFit(null)).toBeNull();
    expect(coreFit(['Cœur du poste : 0 exigence étayée, 0 en partie, 0 absente du profil, sur 0'])).toBeNull();
  });
});
