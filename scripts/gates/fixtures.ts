/**
 * Violations connues. Chaque fixture altère une copie du dépôt ; la porte désignée doit
 * alors échouer en citant la règle (ou le texte `expect`). Une porte qui n'a jamais échoué
 * n'a jamais été prouvée. Chaque porte de gates.sh a au moins une violation connue :
 *   validate → validate.ts · build → build-harness.ts --check · unit → bun test scripts ·
 *   archon → archon validate · verify → verify-block.sh <workflow> (validate.ts limité à ce
 *   workflow et au dépôt, tests des règles des blocs, archon validate, archon workflow test,
 *   fixture-outcomes.ts).
 * Pour une porte qui lance `bun test`, `expect` nomme le test qui doit tomber
 * (« (fail) <describe> > <test> ») : un autre test rouge ne prouve rien.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fixture {
  name: string;
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
  gate: 'validate' | 'build' | 'unit' | 'archon' | 'verify';
  /** Pour les portes `archon` et `verify` : le workflow visé. */
  workflow?: string;
  /** Texte attendu dans la sortie de la porte (défaut : la règle) ; une liste : chacun d'eux. */
  expect?: string | string[];
  apply: (root: string) => void;
}

const RESEARCH = join('.archon', 'workflows', 'blocks', 'research', 'research.yaml');
const RESEARCH_VERDICT = join('.archon', 'workflows', 'blocks', 'research', 'scripts', 'verdict.ts');
const RESEARCH_REJECTED = join('.archon', 'workflows', 'blocks', 'research', 'fixtures', 'rejected.stubs.yaml');
const DELIVERABLE_RULES = join('.archon', 'workflows', 'blocks', '.shared', 'deliverable-checks.ts');
const REGISTRY = join('.archon', 'workflows', 'blocks', 'REGISTRY.md');
const TRIGGER = join('triggers', 'board-listener.schedule.json');
const LANDING_CHECK = join('.archon', 'workflows', 'blocks', 'landing-page', 'scripts', 'check.ts');
const RESEARCH_FIXTURES = join('.archon', 'workflows', 'blocks', 'research', 'fixtures');
const SHARED = join('.archon', 'workflows', 'blocks', '.shared');
const IMPLEMENT_UNCONVERGED = join('.archon', 'workflows', 'blocks', 'implement', 'fixtures', 'unconverged.stubs.yaml');
const RESEARCH_UNCONVERGED = join(RESEARCH_FIXTURES, 'unconverged.stubs.yaml');
const TEMPLATE = join('.archon', 'workflows', 'blocks', 'template', 'block-template.yaml');
const TEMPLATE_CHECK = join('.archon', 'workflows', 'blocks', 'template', 'scripts', 'check.ts');
const TEMPLATE_UNCONVERGED = join('.archon', 'workflows', 'blocks', 'template', 'fixtures', 'unconverged.stubs.yaml');
const RESEARCH_CHECK = join('.archon', 'workflows', 'blocks', 'research', 'scripts', 'check.ts');
const APPLY_SUBMIT = join('.archon', 'workflows', 'blocks', 'apply-submit', 'apply-submit.yaml');
/** Un stub de juge favorable, ajouté à une fixture : le dry-run le prend, la fixture reste verte. */
const JUDGE_STUB = 'judge:\n  approved: true\n  reason: "stub: approved"\n  findings: []\n';

/** Passe la ligne `research` du registre de VERIFIED à PROUVÉ. */
function proveResearch(root: string): void {
  const file = join(root, REGISTRY);
  const lines = readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('| `research` |'));
  if (i < 0 || !lines[i]!.includes('VERIFIED')) throw new Error('fixture : ligne research VERIFIED introuvable');
  lines[i] = lines[i]!.replace('VERIFIED', 'PROUVÉ');
  writeFileSync(file, lines.join('\n'));
}

/** Remplace `needle` par `replacement` dans un fichier ; échoue si `needle` est absent (la fixture serait creuse). */
function edit(root: string, rel: string, needle: string, replacement: string): void {
  const file = join(root, rel);
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.includes(needle)) throw new Error(`fixture : « ${needle} » absent de ${rel}`);
  writeFileSync(file, text.replace(needle, replacement));
}

/** Comme `edit`, pour chaque occurrence. */
function editAll(root: string, rel: string, needle: string, replacement: string): void {
  const file = join(root, rel);
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.includes(needle)) throw new Error(`fixture : « ${needle} » absent de ${rel}`);
  writeFileSync(file, text.replaceAll(needle, replacement));
}

export const fixtures: Fixture[] = [
  { name: 'no-check', rule: 'R1', gate: 'validate',
    apply: (r) => edit(r, RESEARCH, '          script: check\n          runtime: bun\n', '          bash: "true"\n') },
  { name: 'check-untested', rule: 'R1', gate: 'validate',
    apply: (r) => {
      rmSync(join(r, '.archon', 'workflows', 'blocks', 'research', 'scripts', 'check.test.ts'));
      rmSync(join(r, '.archon', 'workflows', 'blocks', '.shared', 'deliverable-checks.test.ts'));
    } },
  { name: 'judge-shared-context', rule: 'R2', gate: 'validate',
    apply: (r) => edit(r, RESEARCH, '    context: fresh\n', '') },
  { name: 'judge-can-write', rule: 'R2', gate: 'validate',
    apply: (r) => edit(r, RESEARCH, 'allowed_tools: [Read, Glob, Grep]', 'allowed_tools: [Read, Glob, Grep, Write, Bash]') },
  { name: 'generic-check-broken', rule: 'R1', gate: 'unit', expect: '(fail) generic checks > pass on a conforming file',
    apply: (r) => edit(r, join('scripts', 'check.ts'), 'includes(String(arg).toLowerCase()) ? null :', 'includes(String(arg).toLowerCase()) && false ? null :') },
  { name: 'block-rule-broken', rule: 'R1', gate: 'verify', workflow: 'research', expect: '(fail) evaluateDeliverable > refuse un livrable trop court',
    apply: (r) => edit(r, DELIVERABLE_RULES, 'if (body.length < rules.minChars) {', 'if (body.length < 0) {') },
  { name: 'judge-is-author', rule: 'R2', gate: 'validate',
    apply: (r) => {
      const dir = join(r, '.archon', 'workflows', 'blocks', 'research', 'commands');
      writeFileSync(join(dir, 'judge.md'), readFileSync(join(dir, 'work.md'), 'utf8'));
    } },
  { name: 'proven-without-proof', rule: 'R3', gate: 'validate',
    apply: (r) => proveResearch(r) },
  { name: 'fixture-outcome-undeclared', rule: 'R3', gate: 'validate', expect: 'attendu',
    apply: (r) => edit(r, RESEARCH_REJECTED, '# attendu: ok=false status=rejected\n', '') },
  { name: 'verdict-skipped-on-reject', rule: 'R3', gate: 'verify', workflow: 'research', expect: '✘ blocks/research/fixtures/rejected.stubs.yaml',
    apply: (r) => edit(r, RESEARCH, '    depends_on: [produce, judge]\n', '    depends_on: [produce, judge]\n    when: "$judge.output.approved == true"\n') },
  { name: 'loop-can-exhaust', rule: 'R1', gate: 'validate',
    apply: (r) => edit(r, RESEARCH, ' || [ "$t" -ge 4 ]', '') },
  // Le compteur ne compte plus : tries reste à 1, la boucle s'épuise et le run finit `failed`.
  // Les fixtures stubbent le contrôle : seul le test de io.ts (verify-block.sh, étape 1) le voit.
  { name: 'tries-never-counts', rule: 'R1', gate: 'verify', workflow: 'research', expect: '(fail) nextTry > compte à partir du tour précédent',
    apply: (r) => edit(r, join(SHARED, 'io.ts'), '  return Number.isFinite(n) && n > 0 ? n + 1 : 1;\n', '  return 1;\n') },
  // Le contrôle émet une constante : tries ne compte plus, la boucle s'épuise en échec.
  // Les fixtures stubbent le contrôle et `bun test` ne lance pas son `import.meta.main`.
  { name: 'tries-hard-coded', rule: 'R1', gate: 'validate', expect: 'doit émettre « tries: nextTry(process.env.INPUTS_TRIES) »',
    apply: (r) => edit(r, TEMPLATE_CHECK, '    tries: nextTry(process.env.INPUTS_TRIES),\n', '    tries: 1,\n') },
  // Le compteur est calculé mais jamais émis : `tries` manque à la sortie, `-ge` compare du vide
  // et la boucle s'épuise en échec. Seule la propriété dans emit({ … }) compte.
  { name: 'tries-not-emitted', rule: 'R1', gate: 'validate', expect: '(lu : « tries = nextTry(process.env.INPUTS_TRIES) »)',
    apply: (r) => {
      edit(r, TEMPLATE_CHECK, '    tries: nextTry(process.env.INPUTS_TRIES),\n', '');
      edit(r, TEMPLATE_CHECK, '  const result = evaluateDeliverable(', '  const tries = nextTry(process.env.INPUTS_TRIES);\n  void tries;\n  const result = evaluateDeliverable(');
    } },
  // Un second plafond plus bas, ou un arrêt sur ok=false : la boucle s'arrête sans réessayer.
  { name: 'extra-stop-too-wide', rule: 'R1', gate: 'validate',
    expect: [
      `R1 ${RESEARCH} : boucle « produce » : un seul test « -ge », le plafond`,
      `R1 ${TEMPLATE} : boucle « produce » : arrêt en trop « [ "$ok" = false ] »`,
    ],
    apply: (r) => {
      edit(r, RESEARCH, '|| [ "$t" -ge 4 ]', '|| [ "$t" -ge 4 ] || [ "$t" -ge 1 ]');
      edit(r, TEMPLATE, '[ "$ok" = true ] ||', '[ "$ok" = true ] || [ "$ok" = false ] ||');
    } },
  // Un arrêt sur un champ hors de la liste (CV joint) : la boucle s'arrête au premier tour où
  // le CV est joint, champs encore rouges, sans réessayer.
  { name: 'extra-stop-unlisted-field', rule: 'R1', gate: 'validate', expect: 'arrêt en trop « [ "$e" = true ] » (champ « attached »)',
    apply: (r) => edit(r, APPLY_SUBMIT, 'e=$check_prefill.output.submitted_early;', 'e=$check_prefill.output.attached;') },
  // Une instruction glissée avant les tests réécrit le compteur : le plafond est atteint d'emblée.
  { name: 'until-reassigns', rule: 'R1', gate: 'validate', expect: 'seules des affectations « v=$<nœud>.output.<champ> », une par variable (« t=1 »',
    apply: (r) => edit(r, RESEARCH, 't=$check.output.tries; [', 't=$check.output.tries; t=1; [') },
  { name: 'until-and-instead-of-or', rule: 'R1', gate: 'validate', expect: 'par « && » : il faut « || »',
    apply: (r) => edit(r, RESEARCH, '[ "$ok" = true ] || [ "$t" -ge 4 ]', '[ "$ok" = true ] && [ "$t" -ge 4 ]') },
  { name: 'tries-not-from-loop-prev', rule: 'R1', gate: 'validate', expect: 'le contrôle doit lier tries: "$LOOP_PREV.check.output.tries"',
    apply: (r) => edit(r, RESEARCH, '            tries: "$LOOP_PREV.check.output.tries"\n', '            tries: "$INPUTS.out"\n') },
  { name: 'io-untested', rule: 'R1', gate: 'validate', expect: 'règles importées sans test : .shared/io.ts',
    apply: (r) => rmSync(join(r, SHARED, 'io.test.ts')) },
  { name: 'verdict-needs-judge', rule: 'R3', gate: 'validate',
    apply: (r) => edit(r, RESEARCH, '    trigger_rule: none_failed_min_one_success\n', '') },
  // implement n'a pas de juge : `unconverged` est sa seule issue négative.
  { name: 'missing-unconverged-fixture', rule: 'R3', gate: 'validate', expect: '« implement » VERIFIED : il faut une fixture qui rend status=unconverged',
    apply: (r) => rmSync(join(r, IMPLEMENT_UNCONVERGED)) },
  { name: 'judge-runs-on-red-checks', rule: 'R3', gate: 'verify', workflow: 'research', expect: '✘ blocks/research/fixtures/unconverged.stubs.yaml',
    apply: (r) => edit(r, RESEARCH, '    when: "$produce.output.ok == true"\n', '') },
  // Le juge perd son `when` et la fixture unconverged reçoit un stub de juge : le dry-run
  // passe, l'issue reste unconverged (verdict.ts lit produced.ok) ; seule la règle statique le voit.
  { name: 'judge-without-when', rule: 'R3', gate: 'validate', expect: 'le juge doit porter when: "$produce.output.ok == true" (lu : rien)',
    apply: (r) => {
      edit(r, RESEARCH, '    when: "$produce.output.ok == true"\n', '');
      appendFileSync(join(r, RESEARCH_UNCONVERGED), JUDGE_STUB);
    } },
  { name: 'unconverged-stubs-judge', rule: 'R3', gate: 'validate', expect: 'fixture status=unconverged qui stubbe le juge (judge)',
    apply: (r) => appendFileSync(join(r, TEMPLATE_UNCONVERGED), JUDGE_STUB) },
  // Le même, juge renommé : un juge se reconnaît à `command: judge`, pas à son id.
  { name: 'unconverged-stubs-renamed-judge', rule: 'R3', gate: 'validate', expect: 'fixture status=unconverged qui stubbe le juge (critic)',
    apply: (r) => {
      edit(r, TEMPLATE, '  - id: judge\n    command: judge\n', '  - id: critic\n    command: judge\n');
      edit(r, TEMPLATE, '    depends_on: [produce, judge]\n', '    depends_on: [produce, critic]\n');
      editAll(r, TEMPLATE, '"$judge.output.', '"$critic.output.');
      appendFileSync(join(r, TEMPLATE_UNCONVERGED), JUDGE_STUB.replace(/^judge:/, 'critic:'));
    } },
  // Le stub du contrôle EST le dernier tour (le dry-run n'exécute pas until_bash) : `tries: 1`
  // décrit une boucle qui réessaierait, pas des contrôles rouges au plafond.
  { name: 'unconverged-below-cap', rule: 'R3', gate: 'validate', expect: "fixture status=unconverged dont le stub du contrôle n'est pas le dernier tour : « check » : ok: false, tries: 1 (attendu ok: false, tries: 8",
    apply: (r) => edit(r, IMPLEMENT_UNCONVERGED, '  tries: 8\n', '  tries: 1\n') },
  // VERIFIED = verify-block.sh vert : il passe aussi par validate.ts (étape 0). Le cas trouvé en
  // revue : compteur constant, juge sans `when`, stub de juge dans la fixture unconverged. Les
  // fixtures restent vertes ; seules les règles statiques le voient.
  { name: 'verify-skips-static-rules', rule: 'R3', gate: 'verify', workflow: 'research',
    expect: [
      `R1 ${RESEARCH}#check : le contrôle « check » doit émettre « tries: nextTry(process.env.INPUTS_TRIES) »`,
      `R3 ${RESEARCH}#judge : le juge doit porter when:`,
      `R3 ${RESEARCH_UNCONVERGED} : fixture status=unconverged qui stubbe le juge (judge)`,
    ],
    apply: (r) => {
      edit(r, RESEARCH_CHECK, '    tries: nextTry(process.env.INPUTS_TRIES),\n', '    tries: 1,\n');
      edit(r, RESEARCH, '    when: "$produce.output.ok == true"\n', '');
      appendFileSync(join(r, RESEARCH_UNCONVERGED), JUDGE_STUB);
    } },
  // Un emit précoce sans compteur (livrable absent) : Archon confronte la sortie à
  // output_format, où tries est exigé ; le contrôle échoue, la boucle aussi, sans verdict.
  // Les fixtures stubbent le contrôle : seule la règle statique le voit.
  { name: 'emit-without-tries', rule: 'R1', gate: 'validate', expect: `R1 ${TEMPLATE}#check : le contrôle « check » doit émettre « tries: nextTry(process.env.INPUTS_TRIES) » dans l'objet passé à emit({ … }) (nextTry importé de .shared/io.ts) dans chacun de ses appels emit : 1 appel(s) emit sur 2 sans tries`,
    apply: (r) => edit(r, TEMPLATE_CHECK, '  const result = evaluateDeliverable(readDeliverable(artifactsDir()), RULES);\n',
      "  const body = readDeliverable(artifactsDir());\n  if (body === null) emit({ ok: false, problems: ['missing'], summary: '', deliverable: null });\n  const result = evaluateDeliverable(body, RULES);\n") },
  // verify-block.sh <système> vérifie aussi les règles statiques des blocs qu'il inclut : ils
  // tournent dans le même run. Le compteur constant de research rougit research-report.
  { name: 'system-hides-block-violation', rule: 'R3', gate: 'verify', workflow: 'research-report',
    expect: `R1 ${RESEARCH}#check : le contrôle « check » doit émettre « tries: nextTry(process.env.INPUTS_TRIES) »`,
    apply: (r) => edit(r, RESEARCH_CHECK, '    tries: nextTry(process.env.INPUTS_TRIES),\n', '    tries: 1,\n') },
  { name: 'unconverged-reported-as-rejected', rule: 'R3', gate: 'verify', workflow: 'research', expect: 'issue attendue non obtenue',
    apply: (r) => edit(r, RESEARCH_VERDICT, '} else if (!produced.ok) {', '} else if (false) {') },
  { name: 'verdict-ignores-judge', rule: 'R3', gate: 'verify', workflow: 'research', expect: 'issue attendue non obtenue',
    apply: (r) => edit(r, RESEARCH_VERDICT, 'const ok = produced.ok && approved;', 'const ok = produced.ok;') },
  { name: 'until-ignores-check', rule: 'R1', gate: 'validate', expect: 'ne lit pas le verdict du contrôle',
    apply: (r) => edit(r, RESEARCH, "until_bash: 'ok=$check.output.ok;", "until_bash: 'ok=$work.output.summary;") },
  { name: 'untested-shared-import', rule: 'R1', gate: 'validate', expect: 'règles importées sans test',
    apply: (r) => {
      writeFileSync(join(r, SHARED, 'nouvelles-checks.ts'), 'export const rule = (s: string): boolean => s.length > 0;\n');
      // guillemets doubles, sans `.ts` : la forme que l'ancienne détection laissait passer
      edit(r, LANDING_CHECK, "import { existsSync, readFileSync } from 'node:fs';", 'import { existsSync, readFileSync } from \'node:fs\';\nimport { rule } from "../../.shared/nouvelles-checks";\nvoid rule;');
    } },
  { name: 'judge-without-tools', rule: 'R2', gate: 'validate', expect: 'allowed_tools',
    apply: (r) => edit(r, RESEARCH, '    allowed_tools: [Read, Glob, Grep]', '    # allowed_tools retiré') },
  { name: 'judge-with-mcp', rule: 'R2', gate: 'validate', expect: 'serveur MCP',
    apply: (r) => edit(r, RESEARCH, '    model: large\n    depends_on: [produce]\n', '    model: large\n    mcp: .archon/mcp/browser.json\n    depends_on: [produce]\n') },
  { name: 'verified-without-fixture', rule: 'R3', gate: 'validate', expect: 'sans aucune fixture',
    apply: (r) => {
      const dir = join(r, RESEARCH_FIXTURES);
      for (const f of readdirSync(dir)) rmSync(join(dir, f));
    } },
  { name: 'proof-without-facts', rule: 'R3', gate: 'validate', expect: 'les trois faits',
    apply: (r) => {
      proveResearch(r);
      mkdirSync(join(r, '.archon', 'workflows', 'blocks', 'proofs'), { recursive: true });
      writeFileSync(join(r, '.archon', 'workflows', 'blocks', 'proofs', 'research.md'), `# Preuve — research\n\n${'Un long récit sans les trois faits. '.repeat(10)}\n`);
    } },
  { name: 'name-mismatch', rule: 'R5', gate: 'validate', expect: 'name « research2 »',
    apply: (r) => edit(r, RESEARCH, 'name: research\n', 'name: research2\n') },
  { name: 'stray-workflow', rule: 'R5', gate: 'validate', expect: 'workflow hors blocks',
    apply: (r) => writeFileSync(join(r, '.archon', 'workflows', 'egare.yaml'), 'name: egare\ndescription: x\nnodes:\n  - id: a\n    bash: "true"\n') },
  { name: 'registry-duplicate', rule: 'R5', gate: 'validate', expect: 'plusieurs lignes',
    apply: (r) => appendFileSync(join(r, REGISTRY), '\n| `research` | doublon | PROUVÉ | 2026-01-01 | — | — |\n') },
  { name: 'trigger-overlap', rule: 'R6', gate: 'validate', expect: 'overlap',
    apply: (r) => edit(r, TRIGGER, '"overlap": "skip"', '"overlap": "allow"') },
  { name: 'registry-orphan', rule: 'R5', gate: 'validate',
    apply: (r) => appendFileSync(join(r, REGISTRY), '\n| `fantome` | bloc qui n\'existe pas | DRAFT | 2026-01-01 | — | — |\n') },
  { name: 'registry-missing-row', rule: 'R5', gate: 'validate',
    apply: (r) => {
      const file = join(r, REGISTRY);
      const before = readFileSync(file, 'utf8').split('\n');
      const after = before.filter((l) => !l.startsWith('| `report` |'));
      if (after.length === before.length) throw new Error('fixture : ligne « report » absente du registre');
      writeFileSync(file, after.join('\n'));
    } },
  { name: 'harness-edited', rule: 'R5', gate: 'build',
    apply: (r) => appendFileSync(join(r, 'harness.json'), '// retouche à la main\n') },
  { name: 'trigger-unknown-workflow', rule: 'R6', gate: 'validate',
    apply: (r) => edit(r, TRIGGER, '"workflowName": "board-listener"', '"workflowName": "inexistant"') },
  { name: 'pointer-names-directory', rule: 'R4', gate: 'validate', expect: 'jamais un dossier',
    apply: (r) => edit(r, RESEARCH, '    default: deliverable.md\n', '    default: deliverable\n') },
  { name: 'pointer-built-by-hand', rule: 'R4', gate: 'validate', expect: 'artifactPointer',
    apply: (r) => appendFileSync(join(r, RESEARCH_VERDICT), "\nconst handMade = { type: 'archon_artifact', run_id: 'x', path: 'deliverable.md' };\nvoid handMade;\n") },
  { name: 'missing-command', rule: 'R4', gate: 'archon', workflow: 'research', expect: 'nope-command',
    apply: (r) => edit(r, RESEARCH, '    command: judge\n', '    command: nope-command\n') },
  { name: 'missing-include', rule: 'R4', gate: 'archon', workflow: 'research-report', expect: 'bloc-fantome',
    apply: (r) => edit(r, join('.archon', 'workflows', 'systems', 'research-report', 'research-report.yaml'), '    include: research\n', '    include: bloc-fantome\n') },
  { name: 'cycle', rule: 'R4', gate: 'archon', workflow: 'research', expect: 'Cycle',
    apply: (r) => edit(r, RESEARCH, '    model: large\n    depends_on: [produce]\n', '    model: large\n    depends_on: [produce, verdict]\n') },
];
