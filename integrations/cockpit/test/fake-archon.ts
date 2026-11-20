#!/usr/bin/env bun
/**
 * Un faux `archon` pour cockpit.test.ts : il tient ses runs dans le fichier JSON `FAKE_ARCHON_STATE`
 * et répond aux seules commandes que le cockpit envoie (runs, run --detach, get, logs,
 * approve/reject/respond), avec les formes de sortie d'Archon. Une recherche de décideurs finit tout
 * de suite (decideurs.json et son verdict dans les artefacts). Une relève career-radar finit tout
 * de suite (rapport écrit, une offre ajoutée au tableau), sauf si le fichier FAKE_RADAR_LIVE_FILE
 * existe : le run reste vivant (étape `screen` en cours) tant que le fichier est là.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const statePath = process.env.FAKE_ARCHON_STATE!;
const read = (): { runs: Record<string, unknown>[]; calls: string[][] } => JSON.parse(readFileSync(statePath, 'utf8'));
const write = (s: unknown): void => writeFileSync(statePath, JSON.stringify(s, null, 2));
const argv = process.argv.slice(2);
const s = read();
s.calls.push(argv);
const sub = argv.slice(0, 2).join(' ');
const input = (name: string): string => {
  const i = argv.findIndex((a, k) => a === '--input' && argv[k + 1]?.startsWith(`${name}=`));
  return i >= 0 ? argv[i + 1]!.slice(name.length + 1) : '';
};
/** Le rapport que le vrai système écrit à la fin d'une relève, et l'offre qu'il a ajoutée au tableau. */
function finishRadar(run: Record<string, unknown>): void {
  const careerDir = String((run.metadata as { inputs: { career_dir: string } }).inputs.career_dir);
  const n = Number(process.env.FAKE_RADAR_ADDED ?? '1');
  const slug = `radar-${String(run.id).replace(/^radar-/, '')}`;
  if (n > 0) {
    const boardPath = join(careerDir, 'pending_gold_jobs.json');
    const board = JSON.parse(readFileSync(boardPath, 'utf8')) as Record<string, unknown>[];
    board.push({ id: `R-${slug}`, slug, company: `Relevée ${slug}`, title: 'Growth Ops', link: '', status: 'PENDING_VALIDATION', match_score: 70, source: 'Remotive', date_published: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) });
    writeFileSync(boardPath, JSON.stringify(board));
  }
  writeFileSync(join(careerDir, 'last_radar_report.json'), JSON.stringify({
    at: new Date().toISOString(),
    sources: [
      { name: 'linkedin', status: '200', count: 12, duration_ms: 1840 },
      { name: 'remotive', status: 'OK', count: 4, duration_ms: 610 },
      { name: 'adzuna', status: 'clé absente (ADZUNA_APP_KEY)', count: 0, duration_ms: 1 },
      { name: 'jooble', status: 'attente (prochain appel dans 12 min)', count: 0, duration_ms: 1 },
      { name: 'wttj', status: 'erreur réseau', count: 0, duration_ms: 15000 },
    ],
    raw_count: 16, qualified_count: 3, added: n, added_slugs: n > 0 ? [slug] : [], rejected_count: 13,
  }, null, 2));
  run.status = 'completed';
  run.nodes = [{ nodeId: 'collect', state: 'completed' }, { nodeId: 'screen', state: 'completed' }, { nodeId: 'record', state: 'completed' }];
}

if (sub === 'workflow runs') {
  // Une relève laissée vivante finit quand FAKE_RADAR_LIVE_FILE a disparu.
  const liveFile = process.env.FAKE_RADAR_LIVE_FILE ?? '';
  for (const run of s.runs) if (run.workflow_name === 'career-radar' && run.status === 'running' && (liveFile === '' || !existsSync(liveFile))) finishRadar(run);
  console.log(JSON.stringify(s.runs));
} else if (sub === 'workflow run' && argv[2] === 'career-radar') {
  const id = `radar-${s.calls.filter((c) => c[1] === 'run' && c[2] === 'career-radar').length}`;
  const run: Record<string, unknown> = { id, status: 'running', workflow_name: 'career-radar', started_at: new Date().toISOString(), output_root: join(process.env.FAKE_ARCHON_ROOT!, id),
    metadata: { inputs: { career_dir: input('career_dir'), sources: input('sources'), env_file: input('env_file') } },
    nodes: [{ nodeId: 'collect', state: 'completed' }, { nodeId: 'screen', state: 'running' }, { nodeId: 'record', state: 'pending' }] };
  const liveFile = process.env.FAKE_RADAR_LIVE_FILE ?? '';
  if (liveFile === '' || !existsSync(liveFile)) finishRadar(run);
  s.runs.push(run);
  console.log(`Started 'career-radar' in the background.\nRun id: ${id}\nTrack it with: archon workflow get ${id}`);
} else if (sub === 'workflow run' && argv[2] === 'interview-prep') {
  const slug = input('application').split(/[\\/]/).pop()!;
  const id = `int-${slug}`;
  const root = join(process.env.FAKE_ARCHON_ROOT!, id);
  mkdirSync(join(root, 'artifacts', 'runs', id), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'runs', id, 'interview-prep.md'), `# Préparation d'entretien — ${slug} (étape : ${input('stage')})\n`);
  s.runs.push({ id, status: 'completed', workflow_name: 'interview-prep', started_at: new Date().toISOString(), output_root: root,
    metadata: { inputs: { application: input('application'), profile: input('profile'), stage: input('stage') } },
    nodes: [{ nodeId: 'produce', state: 'completed' }, { nodeId: 'judge', state: 'completed' }, { nodeId: 'verdict', state: 'completed' }] });
  console.log(`Started 'interview-prep' in the background.\nRun id: ${id}\nTrack it with: archon workflow get ${id}`);
} else if (sub === 'workflow run' && argv[2] === 'decision-makers') {
  // Les décideurs trouvés, et le verdict que le vrai bloc écrit à côté ; le run finit tout de suite.
  const slug = input('application').split(/[\\/]/).pop()!;
  const id = `dm-${slug}`;
  const dir = join(process.env.FAKE_ARCHON_ROOT!, id, 'artifacts', 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'decideurs.json'), JSON.stringify({
    company: slug, job_title: 'Growth Ops', domain: `${slug}.example`, language: 'fr',
    people: [{ name: 'Claire Martin', role: 'Head of Growth', why: 'dirige l’équipe du poste', source: `https://${slug}.example/equipe`, evidence: 'Claire Martin, Head of Growth' }],
    searches: [`${slug} "Growth"`],
    linkedin_note: { to: 'Claire Martin', text: `Bonjour Claire, je postule au poste Growth Ops chez ${slug}.` },
    email: { to: 'Claire Martin', subject: 'Growth Ops', body: 'Bonjour Claire, …' },
    sources: [`https://${slug}.example/equipe`], notes: [],
  }));
  writeFileSync(join(dir, 'decideurs.verdict.json'), JSON.stringify({ ok: true, status: 'verified', summary: 'ok', problems: [], findings: [] }));
  s.runs.push({ id, status: 'completed', workflow_name: 'decision-makers', started_at: new Date().toISOString(), output_root: join(process.env.FAKE_ARCHON_ROOT!, id),
    metadata: { inputs: { application: input('application'), profile: input('profile') } },
    nodes: [{ nodeId: 'produce', state: 'completed' }, { nodeId: 'judge', state: 'completed' }, { nodeId: 'verdict', state: 'completed' }] });
  console.log(`Started 'decision-makers' in the background.\nRun id: ${id}\nTrack it with: archon workflow get ${id}`);
} else if (sub === 'workflow run' && argv[2] === 'career-triage') {
  // Le vrai système écrit <career>/triage/<clé>.json à la fin ; ici tout de suite, décision selon la clé (FAKE_TRIAGE_<clé>).
  const key = input('key');
  const careerDir = input('career_dir');
  const id = `tri-${key}`;
  const decision = process.env[`FAKE_TRIAGE_${key}`] ?? 'retenue';
  if (decision !== 'none') {
    mkdirSync(join(careerDir, 'triage'), { recursive: true });
    writeFileSync(join(careerDir, 'triage', `${key}.json`), JSON.stringify({
      key, id: '', slug: key, company: '', title: '', link: '', decision, reasons: decision === 'ecartee' ? ['Langue exigée : italien courant (critère : français, anglais)'] : [], notes: [],
      salary_annual_eur: null, languages_required: [], posting_full: true, block_status: 'verified', attempts: 1, run_id: id, at: new Date().toISOString(),
      criteria_hash: process.env.FAKE_TRIAGE_HASH ?? '',
    }, null, 2));
  }
  s.runs.push({ id, status: 'completed', workflow_name: 'career-triage', started_at: new Date().toISOString(), output_root: join(process.env.FAKE_ARCHON_ROOT!, id),
    metadata: { inputs: { career_dir: careerDir, key } },
    nodes: [{ nodeId: 'load', state: 'completed' }, { nodeId: 'triage__verdict', state: 'completed' }, { nodeId: 'record', state: 'completed' }] });
  console.log(`Started 'career-triage' in the background.\nRun id: ${id}\nTrack it with: archon workflow get ${id}`);
} else if (sub === 'workflow run') {
  const slug = input('slug');
  const id = `run-${slug}`;
  const root = join(process.env.FAKE_ARCHON_ROOT!, id);
  mkdirSync(join(root, 'artifacts', 'runs', id, 'application'), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'runs', id, 'application', 'CV.md'), `# CV — pour ${slug}\n`);
  s.runs.push({ id, status: 'paused', workflow_name: 'career-apply', started_at: new Date().toISOString(), output_root: root,
    metadata: { inputs: { slug, career_dir: input('career_dir'), mode: input('mode') } },
    browser_profile: process.env.HARNESS_BROWSER_PROFILE ?? null,
    nodes: [{ nodeId: 'load', state: 'completed' }, { nodeId: 'tailor__verdict', state: 'completed' }, { nodeId: 'submit__go', state: 'waiting' }] });
  console.log(`Started 'career-apply' in the background.\nRun id: ${id}\nTrack it with: archon workflow get ${id}`);
} else if (sub === 'workflow get') {
  const run = s.runs.find((r) => r.id === argv[2]);
  if (!run) { console.log(JSON.stringify({ ok: false, error: 'not found' })); process.exitCode = 1; }
  else console.log(JSON.stringify({ ...run, leave_behind: { artifactFiles: ['application/CV.md'] } }));
} else if (sub === 'workflow logs') {
  console.log(`[load] completed\n[submit__go] waiting for attention (${argv[2]})`);
} else if (sub === 'workflow cancel' || sub === 'workflow abandon') {
  const run = s.runs.find((r) => r.id === argv[2]) as Record<string, unknown> | undefined;
  if (run) { run.status = 'cancelled'; console.log(`Cancelled ${argv[2]}`); } else { console.error(`run ${argv[2]} not found`); process.exitCode = 1; }
} else if (sub === 'workflow approve' || sub === 'workflow reject' || sub === 'workflow respond') {
  const id = argv[2];
  const run = s.runs.find((r) => r.id === id) as Record<string, unknown> | undefined;
  if (run) { run.status = 'completed'; run.nodes = [{ nodeId: 'load', state: 'completed' }, { nodeId: 'submit__go', state: 'completed' }, { nodeId: 'record', state: 'completed' }]; }
  console.log(`Responded to ${id}`);
} else {
  console.error(`fake archon: commande inconnue ${argv.join(' ')}`);
  process.exitCode = 2;
}
write(s);
