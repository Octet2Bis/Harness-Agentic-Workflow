/**
 * Le cockpit lancé pour de vrai (sous-processus bun) contre un faux Archon (test/fake-archon.ts)
 * et un dossier carrière temporaire : le tableau est lu, une offre choisie part en
 * `career-apply … --folder --input mode=confirm --detach`, une à la fois (la seconde attend en
 * file), l'annonce se lit (lien du tableau, page lue comme `load` la lit), une remarque s'écrit
 * dans le fichier que `/remarque` du bot et `load` partagent, le CV du run se lit avant le go,
 * le go passe par `workflow approve`, le tableau se rafraîchit depuis la VM par la commande de
 * sync_pending.ps1 (ici un faux pull), et rien d'autre n'est envoyé à Archon. Un second cockpit,
 * à cadence courte, vérifie la relève des sources (career-radar) : première relève toute seule
 * après le délai, une à la fois, bouton refusé pendant une relève, rapport lu et offres ajoutées
 * visibles ; le premier cockpit tourne en `--no-radar`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criteriaHash } from '../../.archon/workflows/systems/.shared/triage.ts';

const root = mkdtempSync(join(tmpdir(), 'cockpit-test-'));
const career = join(root, 'career');
const harness = join(root, 'harness');
const statePath = join(root, 'fake-archon.json');
let proc: ReturnType<typeof Bun.spawn> | null = null;
let base = '';
/** Une fausse annonce en ligne : ce que `load` lirait avec fetch + visibleText. */
const site = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (req) => new URL(req.url).pathname === '/jobs/acme'
    ? new Response('<html><head><title>Growth Ops &amp; RevOps — Acme</title><style>p{}</style></head><body><nav>menu</nav><h1>Growth Ops</h1><p>Paris &amp; remote, CDI.</p><script>var x = 1;</script></body></html>', { headers: { 'content-type': 'text/html' } })
    : new Response('introuvable', { status: 404 }),
});

const criteria = JSON.stringify({ langues: ['français', 'anglais'], salaire_min_annuel: 40000 });

const offers = [
  { slug: 'acme', company: 'Acme', title: 'Growth Ops', link: `http://127.0.0.1:${site.port}/jobs/acme`, status: 'PENDING_VALIDATION', match_score: 90, location: 'Paris', source: 'LinkedIn', salary_range: '45-55k€', target_role: 'Head of Growth' },
  { slug: 'beta', company: 'Beta &amp; Co', title: 'GTM Lead', link: '', status: 'VALIDATED', match_score: 80 },
  { slug: 'sent', company: 'Sent', title: 'x', link: `http://127.0.0.1:${site.port}/jobs/sent`, status: 'APPLIED' },
  // Vu le 22 octobre sur le tableau d'Antoine : un slug qui est aussi un nom du prototype des objets.
  { slug: 'constructor', company: 'Constructor', title: 'Growth Lead', link: '', status: 'APPLIED' },
];

beforeAll(async () => {
  mkdirSync(join(career, 'applications', 'sent'), { recursive: true });
  mkdirSync(harness, { recursive: true });
  writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify(offers));
  writeFileSync(join(career, 'applications', 'sent', 'CV_Antoine_sent.md'), '# CV envoyé');
  writeFileSync(statePath, JSON.stringify({ runs: [], calls: [] }));
  proc = Bun.spawn(['bun', join(import.meta.dir, 'cockpit.ts'), '--career-dir', career, '--harness', harness, '--port', '0', '--no-open', '--archon', `bun ${join(import.meta.dir, 'test', 'fake-archon.ts')}`, '--pull', `bun ${join(import.meta.dir, 'test', 'fake-pull.ts')}`, '--pull-every', '0', '--no-radar', '--contacts'], {
    env: { ...process.env, FAKE_ARCHON_STATE: statePath, FAKE_ARCHON_ROOT: join(root, 'archon-home'), FAKE_PULL_BOARD: join(career, 'pending_gold_jobs.json'), FAKE_PULL_COUNT: join(root, 'pulls.txt'), FAKE_PULL_FAIL_FILE: join(root, 'pull-fails'), FAKE_TRIAGE_beta: 'ecartee', FAKE_TRIAGE_HASH: criteriaHash(criteria) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const reader = proc.stdout.getReader();
  let text = '';
  while (!/Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.test(text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`le cockpit s'est arrêté : ${text}\n${await new Response(proc.stderr).text()}`);
    text += new TextDecoder().decode(value);
  }
  base = /Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text)![1]!;
  reader.releaseLock();
});

afterAll(() => {
  proc?.kill();
  site.stop(true);
  rmSync(root, { recursive: true, force: true });
});

const get = async (p: string): Promise<any> => (await fetch(base + p.replace(/^\//, ''))).json();
const post = async (p: string, body: unknown): Promise<any> => (await fetch(base + p.replace(/^\//, ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const calls = (): string[][] => (JSON.parse(readFileSync(statePath, 'utf8')) as { calls: string[][] }).calls;
const until = async (pred: () => Promise<boolean>, ms = 8000): Promise<void> => {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('délai dépassé');
    await Bun.sleep(100);
  }
};

describe('cockpit', () => {
  test('la page et l’état : offres normalisées, lançables ou non selon le statut', async () => {
    const page = await (await fetch(base)).text();
    expect(page).toContain('Cockpit candidatures');
    // L'icône de la fenêtre (barre des tâches) : celle du bureau, servie par le cockpit.
    expect(page).toContain('<link rel="icon" href="/favicon.ico"');
    const icon = await fetch(base + 'favicon.ico');
    expect(icon.headers.get('content-type')).toBe('image/x-icon');
    expect(Buffer.from(await icon.arrayBuffer()).equals(readFileSync(join(import.meta.dir, 'cockpit-v2.ico')))).toBe(true);
    const s = await get('/api/state');
    expect(s.offers.map((o: any) => [o.slug, o.launch.ok])).toEqual([['acme', true], ['beta', true], ['sent', false], ['constructor', false]]);
    expect(s.offers[3].triage).toBeNull();
    expect(s.offers[1].company).toBe('Beta & Co');
    expect(s.live).toEqual([]);
    expect(s.config.mode).toBe('confirm');
    expect(s.pull).toMatchObject({ at: null, ok: null, running: false, every: 0 });
    expect(s.pull.command).toContain('fake-pull.ts');
  });

  test('« Rafraîchir depuis la VM » lance la commande de sync_pending.ps1 ; les offres venues de la VM apparaissent, les plus récentes d’abord', async () => {
    const r = await post('/api/pull', {});
    expect(r).toMatchObject({ ok: true, running: false });
    expect(r.output).toContain('OK (pull).');
    expect(readFileSync(join(root, 'pulls.txt'), 'utf8')).toBe('1');
    const s = await get('/api/state');
    expect(s.offers[0]).toMatchObject({ slug: 'vm-1', company: 'VM 1', date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), launch: { ok: true } });
    expect(s.offers.map((o: any) => o.slug)).toEqual(['vm-1', 'acme', 'beta', 'sent', 'constructor']);
    expect(s.pull.ok).toBe(true);
    expect(s.pull.at).toBeTruthy();
  });

  test('un rafraîchissement qui échoue (scp) est dit dans l’état et ne touche pas au tableau', async () => {
    writeFileSync(join(root, 'pull-fails'), '');
    const r = await post('/api/pull', {});
    expect(r.ok).toBe(false);
    expect(r.output).toContain('scp a échoué');
    const s = await get('/api/state');
    expect(s.pull.ok).toBe(false);
    expect(s.errors.some((e: string) => e.includes('rafraîchissement depuis la VM refusé'))).toBe(true);
    expect(s.offers.map((o: any) => o.slug)).toEqual(['vm-1', 'acme', 'beta', 'sent', 'constructor']);
    rmSync(join(root, 'pull-fails'));
  });

  test('l’annonce : lien et champs du tableau dans l’état, page lue comme load la lit (sans menu ni script), erreur dite quand la page manque', async () => {
    const s = await get('/api/state');
    expect(s.offers.find((o: any) => o.slug === 'acme')).toMatchObject({ link: `http://127.0.0.1:${site.port}/jobs/acme`, salary: '45-55k€', targetRole: 'Head of Growth' });
    const p = await get('/api/offer/acme/posting');
    expect(p.error).toBeNull();
    expect(p.title).toBe('Growth Ops & RevOps — Acme');
    expect(p.text).toContain('Growth Ops\nParis & remote, CDI.');
    expect(p.text).not.toContain('var x');
    expect(p.text).not.toContain('p{}');
    expect((await get('/api/offer/acme/posting')).fetchedAt).toBe(p.fetchedAt); // gardée
    expect((await get('/api/offer/acme/posting?reload=1')).fetchedAt).not.toBe(p.fetchedAt);
    const missing = await get('/api/offer/sent/posting');
    expect(missing.error).toContain('404');
    expect((await get('/api/offer/beta/posting')).error).toContain('pas de lien http');
    expect((await get('/api/offer/nope/posting')).error).toContain('absente');
    expect((await get('/api/offer/../posting')).error).toBeDefined();
  });

  test('une remarque d’ici va dans applications/<slug>/remarques_utilisateur.txt, dans la forme de /remarque du bot ; une remarque vide est refusée', async () => {
    expect(await get('/api/remarks/acme')).toMatchObject({ remarks: [] });
    const r = await post('/api/remarks', { slug: 'acme', text: '  Insiste sur le tracking GTM, pas sur la QA.\r\n' });
    expect(r.ok).toBe(true);
    expect(r.remarks).toHaveLength(1);
    expect(r.remarks[0].text).toBe('Insiste sur le tracking GTM, pas sur la QA.');
    const file = readFileSync(join(career, 'applications', 'acme', 'remarques_utilisateur.txt'), 'utf8');
    expect(file).toMatch(/^\[\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\] Insiste sur le tracking GTM, pas sur la QA\.\n$/);
    await post('/api/remarks', { slug: 'acme', text: 'Deuxième' });
    expect((await get('/api/remarks/acme')).remarks.map((x: any) => x.text)).toEqual(['Insiste sur le tracking GTM, pas sur la QA.', 'Deuxième']);
    expect((await post('/api/remarks', { slug: 'acme', text: '  ' })).error).toBe('remarque vide');
    expect((await post('/api/remarks', { slug: '../x', text: 'y' })).error).toBe('slug invalide');
  });

  test('deux offres choisies : la première part tout de suite, détachée, en mode confirm ; la seconde attend en file', async () => {
    const r = await post('/api/run', { slugs: ['acme', 'beta', 'sent', 'nope'], consigne: 'ignorée : plusieurs offres' });
    expect(r.added).toEqual(['acme', 'beta']);
    expect(r.orders.acme).toMatchObject({ consigne: '' });
    expect(r.refused.map((x: any) => x.slug)).toEqual(['sent', 'nope']);
    await until(async () => (await get('/api/state')).runs.acme !== undefined);
    const s = await get('/api/state');
    expect(s.runs.acme).toMatchObject({ id: 'run-acme', status: 'paused', waitingLabel: 'Ton go' });
    expect(s.queue).toEqual(['beta']);
    expect(s.live).toEqual([{ slug: 'acme', id: 'run-acme', status: 'paused' }]);
    const launch = calls().find((c) => c[0] === 'workflow' && c[1] === 'run')!;
    expect(launch).toEqual(['workflow', 'run', 'career-apply', '--cwd', harness, '--folder', '--input', 'slug=acme', '--input', `career_dir=${career}`, '--input', 'mode=confirm', '--detach']);
    expect(JSON.parse(readFileSync(join(harness, '.local', 'cockpit', 'launches.json'), 'utf8'))).toEqual({ acme: 'run-acme' });
    // Sans candidat.json : le profil de navigateur d'origine, passé à Archon pour .archon/mcp/browser.json.
    const run = (JSON.parse(readFileSync(statePath, 'utf8')) as { runs: { id: string; browser_profile: string }[] }).runs.find((x) => x.id === 'run-acme')!;
    expect(run.browser_profile).toBe(join(harness, '.local', 'browser-profile'));
  });

  test('le CV du run se lit avant le go ; le dossier final et le journal aussi', async () => {
    const files = await get('/api/run/run-acme/files');
    expect(files.files.map((f: any) => f.path)).toEqual(['application/CV.md']);
    expect(files.files[0].text).toContain('# CV — pour acme');
    const app = await get('/api/application/sent');
    expect(app.files[0]).toMatchObject({ path: 'CV_Antoine_sent.md', text: '# CV envoyé' });
    const logs = await get('/api/run/run-acme/logs');
    expect(logs.lines.join('\n')).toContain('submit__go');
    expect((await get('/api/application/..')).error).toBeDefined();
  });

  test('le go attendu est en tête (« à toi »), les décideurs partent tout seuls sur le CV prêt et sont recopiés dans le dossier ; le CV s’ouvre en PDF', async () => {
    const s0 = await get('/api/state');
    expect(s0.attention.map((i: any) => [i.kind, i.slug, i.seen])).toEqual([['go', 'acme', false]]);
    expect(s0.runs.acme.runningLabel).toBeNull();
    await until(async () => { const s = await get('/api/state'); return !!(s.contacts.runs.acme && s.contacts.runs.acme.copied); }, 15000);
    const dm = calls().find((c) => c[2] === 'decision-makers')!;
    expect(dm).toEqual(['workflow', 'run', 'decision-makers', '--cwd', harness, '--folder', '--input', `application=${join(career, 'applications', 'acme')}`, '--input', `profile=${join(career, 'master_profile.md')}`, '--detach']);
    expect(JSON.parse(readFileSync(join(career, 'applications', 'acme', 'decideurs.verdict.json'), 'utf8')).status).toBe('verified');
    const c = await get('/api/contacts/acme');
    expect(c.view.people[0]).toMatchObject({ name: 'Claire Martin', source: 'https://acme.example/equipe' });
    expect(c.view.hunter).toBe('https://hunter.io/search/acme.example');
    expect(c.view.people[0].linkedin).toContain('linkedin.com/search/results/people/?keywords=Claire%20Martin%20acme');
    expect((await get('/api/contacts/beta')).view).toBeNull();
    // une seule recherche toute seule par offre
    await Bun.sleep(5500);
    expect(calls().filter((x) => x[2] === 'decision-makers' && x.some((a) => a.endsWith('acme'))).length).toBe(1);
    // vu : l'alerte est rangée, elle reste listée comme vue
    expect((await post('/api/attention/seen', { key: 'go:run-acme' })).ok).toBe(true);
    expect((await get('/api/state')).attention[0].seen).toBe(true);
    // le PDF du run, tel qu'il sera joint
    const runDir = join(root, 'archon-home', 'run-acme', 'artifacts', 'runs', 'run-acme', 'application');
    writeFileSync(join(runDir, 'CV.pdf'), '%PDF-1.4 cv acme');
    const pdf = await fetch(base + 'api/pdf/acme/cv');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(await pdf.text()).toBe('%PDF-1.4 cv acme');
    expect((await fetch(base + 'api/pdf/acme/lettre')).status).toBe(404);
    expect((await fetch(base + 'api/pdf/..%2F..%2Fx/cv')).status).toBe(400);
  }, 30_000);

  test('le go passe par archon workflow approve ; la file avance ensuite ; un refus porte sa raison', async () => {
    const r = await post('/api/respond', { runId: 'run-acme', decision: 'approve' });
    expect(r.ok).toBe(true);
    expect(calls().some((c) => c.slice(0, 3).join(' ') === 'workflow approve run-acme')).toBe(true);
    await post('/api/run', { slugs: [] }); // un tour de file
    await until(async () => (await get('/api/state')).runs.beta !== undefined);
    const s = await get('/api/state');
    expect(s.queue).toEqual([]);
    expect(s.runs.acme.status).toBe('completed');
    expect(s.runs.beta.status).toBe('paused');
    const rj = await post('/api/respond', { runId: 'run-beta', decision: 'reject', text: 'pas cette fois' });
    expect(rj.ok).toBe(true);
    expect(calls().some((c) => c.slice(0, 5).join(' ') === 'workflow respond run-beta reject pas cette fois')).toBe(true);
    expect((await post('/api/respond', { runId: 'x y', decision: 'approve' })).error).toBeDefined();
  });

  test('la garde d’annonce : une page morte est dite expirée, une annonce normale ok', async () => {
    const dead = await get('/api/offer/sent/posting');
    expect(dead.error).toContain('404');
    expect(dead.guard.verdict).toBe('expirée');
    expect(dead.guard.reasons.join(' ')).toMatch(/404|disparue/);
    const fine = await get('/api/offer/acme/posting');
    expect(fine.guard.verdict).toBe('ok');
  });

  test('la préparation d’entretien part en interview-prep sur le dossier de l’offre, puis le résultat est recopié dans le dossier', async () => {
    const refused = await post('/api/interview', { slug: 'beta', stage: 'rh' });
    expect(refused.error).toContain('applications/beta/');
    expect((await post('/api/interview', { slug: 'sent', stage: 'ceo' })).error).toContain('étape');
    const r = await post('/api/interview', { slug: 'sent', stage: 'manager' });
    expect(r.ok).toBe(true);
    const call = calls().find((c) => c[2] === 'interview-prep')!;
    expect(call.slice(0, 2)).toEqual(['workflow', 'run']);
    expect(call).toContain('--detach');
    expect(call.find((a) => a.startsWith('application='))).toBe(`application=${join(career, 'applications', 'sent')}`);
    expect(call).toContain('stage=manager');
    await until(async () => { const s = await get('/api/state'); return s.interviews.sent && s.interviews.sent.copied === 'Entretien_manager.md'; });
    expect(readFileSync(join(career, 'applications', 'sent', 'Entretien_manager.md'), 'utf8')).toContain('étape : manager');
    const app = await get('/api/application/sent');
    expect(app.files.map((f: any) => f.path)).toContain('Entretien_manager.md');
  });

  test('une autre page ouverte dans le navigateur ne peut ni lancer ni donner le go', async () => {
    const before = calls().length;
    const raw = (headers: Record<string, string>, body = '{"runId":"run-beta","decision":"approve"}') => fetch(base + 'api/respond', { method: 'POST', headers, body });
    const evil = await raw({ 'content-type': 'application/json', origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect((await evil.json()).error).toContain('autre page');
    expect((await raw({ 'content-type': 'text/plain' })).status).toBe(403);
    expect((await raw({ 'content-type': 'application/json', referer: 'http://127.0.0.1.evil.example/' })).status).toBe(403);
    expect(calls().length).toBe(before);
    const own = await fetch(base + 'api/dequeue', { method: 'POST', headers: { 'content-type': 'application/json', origin: base.replace(/\/$/, '') }, body: '{"slug":"zzz"}' });
    expect(own.status).toBe(200);
  });

  test('sans criteres.json, aucun tri ne part ; avec, un career-triage à la fois sur les offres à traiter, et le badge avec ses raisons arrive dans l’état', async () => {
    expect(calls().some((c) => c[2] === 'career-triage')).toBe(false);
    const s0 = await get('/api/state');
    expect(s0.triage.enabled).toBe(false);
    expect(s0.triage.reason).toContain('criteres.json');
    writeFileSync(join(career, 'criteres.json'), criteria);
    // acme (PENDING_VALIDATION), beta (VALIDATED) et les offres venues de la VM attendent leur tri ; sent (APPLIED) jamais.
    await until(async () => { const st = await get('/api/state'); return st.triage.enabled && st.triage.waiting === 0 && st.triage.live === null; }, 30_000);
    const s = await get('/api/state');
    const toTriage = s.offers.filter((o: any) => ['PENDING_VALIDATION', 'VALIDATED'].includes(o.status)).map((o: any) => o.slug).sort();
    expect(toTriage).toContain('beta');
    expect(s.offers.filter((o: any) => o.triage).map((o: any) => o.slug).sort()).toEqual(toTriage);
    const by = Object.fromEntries(s.offers.map((o: any) => [o.slug, o.triage]));
    expect(by.beta.decision).toBe('ecartee');
    expect(by.beta.reasons[0]).toContain('italien');
    expect(by.beta.blockStatus).toBe('verified');
    expect(by.beta.stale).toBe(false);
    expect(by.acme.decision).toBe('retenue');
    expect(by.sent).toBeNull();
    const tri = calls().filter((c) => c[2] === 'career-triage');
    expect(tri.map((c) => c.find((x) => x.startsWith('key='))).sort()).toEqual(toTriage.map((k: string) => `key=${k}`));
    // Moteur par défaut : les règles du code, aucun appel de modèle (2026-10-30).
    expect(tri[0]).toEqual(['workflow', 'run', 'career-triage', '--detach', '--cwd', harness, '--folder', '--input', `career_dir=${career}`, '--input', 'engine=rules', '--input', tri[0]![12]!]);
    expect(s.triage.waiting).toBe(0);
    // Rien n'est retiré du tableau : beta reste lançable d'ici.
    expect(s.offers.find((o: any) => o.slug === 'beta').launch.ok).toBe(true);
  }, 35_000);

  test('bouton « Trier avec Claude » : un career-triage engine=llm sur l’offre demandée, et seulement sur ce bouton', async () => {
    const llm = () => calls().filter((c) => c[2] === 'career-triage' && c.includes('engine=llm'));
    expect(llm()).toHaveLength(0);
    expect((await post('/api/triage-llm', { slug: '../x' })).error).toBe('slug invalide');
    expect((await post('/api/triage-llm', { slug: 'inconnue' })).error).toContain('absente');
    const r = await post('/api/triage-llm', { slug: 'acme' });
    expect(r.error).toBeUndefined();
    expect(llm()).toHaveLength(1);
    expect(llm()[0]).toContain('key=acme');
  }, 20_000);

  test('intitules_exclus de criteres.json : le métier exclu est écarté par le code sur le tri déjà écrit, sans relancer les tris (empreinte inchangée)', async () => {
    const before = calls().filter((c) => c[2] === 'career-triage').length;
    writeFileSync(join(career, 'criteres.json'), JSON.stringify({ ...JSON.parse(criteria), intitules_exclus: ['growth ops'] }));
    const s = await get('/api/state');
    const acme = s.offers.find((o: any) => o.slug === 'acme').triage;
    expect(acme.decision).toBe('ecartee');
    expect(acme.blockStatus).toBe('regle');
    expect(acme.reasons).toEqual(['métier hors périmètre (« growth ops ») : Growth Ops']);
    expect(acme.notes[0]).toContain('tri par le modèle : retenue');
    expect(s.triage.waiting).toBe(0);
    await Bun.sleep(1500);
    expect(calls().filter((c) => c[2] === 'career-triage').length).toBe(before);
    writeFileSync(join(career, 'criteres.json'), criteria);
  }, 10_000);

  test('offre trop ancienne (offre_age_max_jours) : écartée par le code avant tout tri, sauf si elle est déjà envoyée', async () => {
    const before = calls().filter((c) => c[2] === 'career-triage').length;
    const boardPath = join(career, 'pending_gold_jobs.json');
    const board = readFileSync(boardPath, 'utf8');
    writeFileSync(boardPath, JSON.stringify([...offers,
      { slug: 'vieille', company: 'Vieille', title: 'Growth Marketer', link: '', status: 'PENDING_VALIDATION', date_published: '2026-09-14' },
      { slug: 'vieille-envoyee', company: 'Envoyée', title: 'Growth Marketer', link: '', status: 'APPLIED', date_published: '2026-09-14' },
    ]));
    try {
      const s = await get('/api/state');
      const old = s.offers.find((o: any) => o.slug === 'vieille').triage;
      expect(old).toMatchObject({ decision: 'ecartee', blockStatus: 'regle' });
      expect(old.reasons[0]).toStartWith('offre trop ancienne (publiée le 2026-09-14');
      expect(s.offers.find((o: any) => o.slug === 'vieille-envoyee').triage?.blockStatus).not.toBe('regle');
      await Bun.sleep(1500);
      expect(calls().filter((c) => c[2] === 'career-triage' && c.includes('key=vieille')).length).toBe(0);
      expect(calls().filter((c) => c[2] === 'career-triage').length - before).toBeLessThanOrEqual(1);
    } finally {
      writeFileSync(boardPath, board);
    }
  }, 10_000);

  test('--no-radar : pas de bouton, pas de relève automatique, et /api/radar est refusé', async () => {
    const s = await get('/api/state');
    expect(s.radar).toMatchObject({ enabled: false, auto: false, live: null, report: null });
    expect(s.radar.reason).toContain('--no-radar');
    const r = await fetch(base + 'api/radar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('--no-radar');
    expect(calls().some((c) => c[2] === 'career-radar')).toBe(false);
  });

  test('« Arrêter la candidature » : le run vivant est arrêté (workflow cancel), la ligne reprend son statut d’avant, rien n’est envoyé', async () => {
    const board = JSON.parse(readFileSync(join(career, 'pending_gold_jobs.json'), 'utf8')) as Record<string, unknown>[];
    board.push({ slug: 'gamma', company: 'Gamma', title: 'Growth', link: '', status: 'APPLYING', harness: { run: 'run-gamma', stage: 'submit', from: 'VALIDATED' } });
    writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify(board));
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.runs.push({ id: 'run-gamma', status: 'running', workflow_name: 'career-apply', started_at: new Date().toISOString(), metadata: { inputs: { slug: 'gamma', career_dir: career } }, nodes: [{ nodeId: 'submit', state: 'running' }] });
    writeFileSync(statePath, JSON.stringify(st));
    const r = await post('/api/stop', { slug: 'gamma' });
    expect(r).toMatchObject({ ok: true, stopped: ['run-gamm'] });
    expect(calls().some((c) => c[0] === 'workflow' && c[1] === 'cancel' && c[2] === 'run-gamma')).toBe(true);
    const row = (JSON.parse(readFileSync(join(career, 'pending_gold_jobs.json'), 'utf8')) as Record<string, any>[]).find((j) => j.slug === 'gamma')!;
    expect(row.status).toBe('VALIDATED');
    expect(row.harness.summary).toContain('arrêtée');
    expect((await post('/api/stop', { slug: 'gamma' })).note).toContain('plus aucun run');
    expect((await post('/api/stop', { slug: '../x' })).error).toBeDefined();
  });

  test('rien d’autre n’est envoyé à Archon que runs, run, get, logs, approve/respond, cancel (bouton d’arrêt)', () => {
    const subs = new Set(calls().map((c) => c.slice(0, 2).join(' ')));
    expect([...subs].sort()).toEqual(['workflow approve', 'workflow cancel', 'workflow get', 'workflow logs', 'workflow respond', 'workflow run', 'workflow runs']);
    expect(new Set(calls().filter((c) => c[1] === 'run').map((c) => c[2]))).toEqual(new Set(['career-apply', 'career-triage', 'interview-prep', 'decision-makers']));
  });
});

describe('relève des sources (career-radar) : un second cockpit, à cadence courte (3 s)', () => {
  const root2 = mkdtempSync(join(tmpdir(), 'cockpit-radar-'));
  const career2 = join(root2, 'career');
  const harness2 = join(root2, 'harness');
  const state2 = join(root2, 'fake-archon.json');
  const liveFile = join(root2, 'radar-live');
  let proc2: ReturnType<typeof Bun.spawn> | null = null;
  let base2 = '';
  const get2 = async (p: string): Promise<any> => (await fetch(base2 + p.replace(/^\//, ''))).json();
  const calls2 = (): string[][] => (JSON.parse(readFileSync(state2, 'utf8')) as { calls: string[][] }).calls;
  const radarCalls = (): string[][] => calls2().filter((c) => c[1] === 'run' && c[2] === 'career-radar');

  beforeAll(async () => {
    mkdirSync(career2, { recursive: true });
    mkdirSync(harness2, { recursive: true });
    writeFileSync(join(career2, 'pending_gold_jobs.json'), JSON.stringify(offers));
    writeFileSync(state2, JSON.stringify({ runs: [], calls: [] }));
    proc2 = Bun.spawn(['bun', join(import.meta.dir, 'cockpit.ts'), '--career-dir', career2, '--harness', harness2, '--port', '0', '--no-open', '--archon', `bun ${join(import.meta.dir, 'test', 'fake-archon.ts')}`, '--pull-every', '0', '--no-triage', '--radar-every', '0.05'], {
      env: { ...process.env, FAKE_ARCHON_STATE: state2, FAKE_ARCHON_ROOT: join(root2, 'archon-home'), FAKE_RADAR_LIVE_FILE: liveFile },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = proc2.stdout.getReader();
    let text = '';
    while (!/Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.test(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`le cockpit s'est arrêté : ${text}\n${await new Response(proc2.stderr).text()}`);
      text += new TextDecoder().decode(value);
    }
    base2 = /Cockpit : (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text)![1]!;
    reader.releaseLock();
  });

  afterAll(() => {
    proc2?.kill();
    rmSync(root2, { recursive: true, force: true });
  });

  test('au démarrage « aucune relève encore » ; la première part toute seule après le délai, avec la commande du système, et le rapport arrive dans l’état', async () => {
    const s0 = await get2('/api/state');
    expect(s0.radar).toMatchObject({ enabled: true, auto: true, every: 0.05, reason: '', live: null, report: null, reportError: null });
    await until(async () => radarCalls().length >= 1, 10_000);
    expect(radarCalls()[0]).toEqual(['workflow', 'run', 'career-radar', '--cwd', harness2, '--folder', '--input', `career_dir=${career2}`, '--detach']);
    await until(async () => (await get2('/api/state')).radar.report !== null, 8000);
    const s = await get2('/api/state');
    const p = s.radar.report;
    expect(p).toMatchObject({ rawCount: 16, qualifiedCount: 3, added: 1, addedSlugs: ['radar-1'], rejectedCount: 13, okCount: 2, failedCount: 2 });
    expect(p.sources.map((x: any) => [x.name, x.kind])).toEqual([['linkedin', 'ok'], ['remotive', 'ok'], ['adzuna', 'bad'], ['jooble', 'warn'], ['wttj', 'bad']]);
    expect(p.sources[2].status).toBe('clé absente (ADZUNA_APP_KEY)');
    expect(Date.parse(p.at)).toBeGreaterThan(0);
    // La relève est notée sous `#radar` dans launches.json (jamais un slug d'offre), sans passer pour une candidature.
    expect(JSON.parse(readFileSync(join(harness2, '.local', 'cockpit', 'launches.json'), 'utf8'))).toEqual({ '#radar': 'radar-1' });
    expect(s.runs['#radar']).toBeUndefined();
    expect(s.live).toEqual([]);
    // L'offre ajoutée par la relève est dans la liste, la plus récente d'abord.
    expect(s.offers[0]).toMatchObject({ slug: 'radar-1', launch: { ok: true } });
  }, 25_000);

  test('une relève à la fois : pendant une relève vivante, le bouton est refusé (« relève en cours »), l’horloge n’en lance pas d’autre, et le panneau dit l’étape', async () => {
    writeFileSync(liveFile, '');
    // La prochaine relève (horloge ou bouton) reste vivante tant que le fichier existe.
    await until(async () => { const r = await fetch(base2 + 'api/radar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return (await r.json()).error === 'relève en cours'; }, 10_000);
    const s = await get2('/api/state');
    expect(s.radar.live).toMatchObject({ status: 'running', step: 'screen', stepLabel: 'contrôles' });
    expect(s.radar.live.progress).toMatchObject({ done: 1, total: 3 });
    const n = radarCalls().length;
    await Bun.sleep(4000);
    expect(radarCalls().length).toBe(n);
    const liveId = s.radar.live.id;
    rmSync(liveFile);
    await until(async () => (await get2('/api/state')).radar.live === null, 8000);
    const after = await get2('/api/state');
    expect(after.radar.report.addedSlugs).toEqual([liveId]);
    expect(JSON.parse(readFileSync(join(harness2, '.local', 'cockpit', 'launches.json'), 'utf8'))['#radar']).toBe(liveId);
    expect(new Set(calls2().filter((c) => c[1] === 'run').map((c) => c[2]))).toEqual(new Set(['career-radar']));
  }, 25_000);
});

describe('accès depuis le téléphone (Tailscale)', () => {
  const as = (login: string | null, init: RequestInit = {}): Promise<Response> =>
    fetch(base + 'api/state', { ...init, headers: { ...(login ? { 'tailscale-user-login': login } : {}), 'x-forwarded-for': '100.64.0.2', ...(init.headers as Record<string, string> | undefined) } });

  test('sans remote-<port>.json, toute requête relayée est refusée ; la page locale passe', async () => {
    expect((await as('antoine@exemple.fr')).status).toBe(403);
    expect((await fetch(base + 'api/state')).status).toBe(200);
  });

  test('seul le compte listé passe ; un autre compte ne peut ni lire ni lancer', async () => {
    const port = new URL(base).port;
    mkdirSync(join(harness, '.local', 'cockpit'), { recursive: true });
    writeFileSync(join(harness, '.local', 'cockpit', `remote-${port}.json`), '\uFEFF' + JSON.stringify({ hosts: ['pc.tail1234.ts.net'], allowUsers: ['Antoine@Exemple.fr'] }));
    expect((await as('antoine@exemple.fr')).status).toBe(200);
    expect((await as('elle@exemple.fr')).status).toBe(403);
    expect((await as(null)).status).toBe(403);
    const before = calls().length;
    const r = await fetch(base + 'api/run', { method: 'POST', headers: { 'content-type': 'application/json', 'tailscale-user-login': 'elle@exemple.fr', 'x-forwarded-for': '100.64.0.3' }, body: JSON.stringify({ slugs: ['beta'] }) });
    expect(r.status).toBe(403);
    expect(calls().length).toBe(before);
  });

  test('la page servie sous le nom Tailscale passe pour le compte listé, POST compris', async () => {
    const ts = { host: 'pc.tail1234.ts.net', 'tailscale-user-login': 'antoine@exemple.fr', 'x-forwarded-for': '100.64.0.2' };
    expect((await fetch(base + 'api/state', { headers: ts })).status).toBe(200);
    const r = await fetch(base + 'api/dequeue', { method: 'POST', headers: { ...ts, origin: 'https://pc.tail1234.ts.net', 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'personne' }) });
    expect(r.status).toBe(200);
    const other = await fetch(base + 'api/dequeue', { method: 'POST', headers: { ...ts, origin: 'https://ailleurs.example', 'content-type': 'application/json' }, body: '{}' });
    expect(other.status).toBe(403);
  });
});

describe('Postuler avec une consigne', () => {
  test('la consigne part dans remarques_utilisateur.txt avant le lancement, et l’ordre se lit dans l’état', async () => {
    await post('/api/dequeue', { slug: 'beta' });
    const r = await post('/api/run', { slugs: ['beta'], consigne: '  insiste sur le tracking GTM  ' });
    expect(r.added).toEqual(['beta']);
    const file = readFileSync(join(career, 'applications', 'beta', 'remarques_utilisateur.txt'), 'utf8');
    expect(file).toMatch(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\] Consigne de candidature : insiste sur le tracking GTM\n$/);
    const s = await get('/api/state');
    expect(s.orders.beta).toMatchObject({ consigne: 'insiste sur le tracking GTM' });
    expect(typeof s.orders.beta.at).toBe('string');
  });

  test('une offre refusée n’écrit aucune consigne', async () => {
    const r = await post('/api/run', { slugs: ['sent'], consigne: 'rien' });
    expect(r.refused.map((x: any) => x.slug)).toEqual(['sent']);
    expect(existsSync(join(career, 'applications', 'sent', 'remarques_utilisateur.txt'))).toBe(false);
  });
});

describe('entreprises full remote (onglet du cockpit)', () => {
  test('la liste du radar se lit, un poste se met au tableau une fois (même id), et l’offre ne se cache pas même écartée', async () => {
    writeFileSync(join(career, 'remote_companies.json'), JSON.stringify({ _meta: { at: '2026-11-08T12:00:00Z', rule: 'full : au moins 3 postes dont 90 % remote' }, companies: { 'ashby:posthog': { name: 'PostHog', ats: 'ashby', slug: 'posthog', careers: 'https://jobs.ashbyhq.com/posthog', kind: 'full', total: 40, remote: 40, hybrid: 0, source: 'manuel', first_seen: '2026-11-08T09:00:00Z', last_read: '2026-11-08T11:00:00Z' } } }));
    writeFileSync(join(career, 'remote_company_jobs.json'), JSON.stringify({ companies: { 'ashby:posthog': { read_at: '2026-11-08T11:00:00Z', others: 12, jobs: [{ id: 'ATS-AS-ph1', title: 'Developer Marketer, Sales', location: 'Remote (EMEA)', link: 'https://jobs.ashbyhq.com/posthog/ph1', posted: '2026-09-29', remote: true, target: false, first_seen: '2026-11-08T09:00:00Z' }] } } }));
    const v = await get('/api/remote-companies');
    expect(v.companies.map((c: any) => [c.key, c.kind, c.jobs.length, c.jobs[0].onBoard])).toEqual([['ashby:posthog', 'full', 1, null]]);
    expect(await post('/api/remote-companies/add', { key: 'ashby:posthog', id: 'nope' })).toMatchObject({ ok: false });
    const r = await post('/api/remote-companies/add', { key: 'ashby:posthog', id: 'ATS-AS-ph1' });
    expect(r).toMatchObject({ ok: true, slug: 'posthog' });
    const board = JSON.parse(readFileSync(join(career, 'pending_gold_jobs.json'), 'utf8')) as any[];
    expect(board.filter((j) => j.id === 'ATS-AS-ph1')).toHaveLength(1);
    expect(board.find((j) => j.id === 'ATS-AS-ph1')).toMatchObject({ status: 'PENDING_VALIDATION', source: 'Entreprise full remote (Ashby)', company: 'PostHog' });
    expect(await post('/api/remote-companies/add', { key: 'ashby:posthog', id: 'ATS-AS-ph1' })).toMatchObject({ ok: true, note: 'déjà au tableau' });
    expect((await get('/api/remote-companies')).companies[0].jobs[0].onBoard).toBe('posthog');
    expect((await get('/api/state')).offers.some((o: any) => o.id === 'ATS-AS-ph1')).toBe(true);
  });

  test('l’état porte l’historique de la sélection (onglet « Sélectionnées »)', async () => {
    mkdirSync(join(career, 'selection'), { recursive: true });
    writeFileSync(join(career, 'selection', '2026-11-07.json'), JSON.stringify({ date: '2026-11-07', created_at: '2026-11-07T07:00:00Z', status: 'prete', per_day: 2, shortlist: ['acme'], launched: [], picks: [{ key: 'acme', slug: 'acme', title: 'Growth Ops', company: 'Acme', link: '', source: 'LinkedIn', location: 'Paris', date_published: '2026-11-06', salary_annual_eur: null, reasons: [], notes: [], core: null }], answers: {}, finished_at: '2026-11-07T07:30:00Z', notes: [] }));
    const s = await get('/api/state');
    expect(s.selection.history.map((d: any) => [d.date, d.picks.map((p: any) => p.slug)])).toEqual([['2026-11-07', ['acme']]]);
  });
});
