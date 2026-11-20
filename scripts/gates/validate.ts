#!/usr/bin/env bun
/**
 * Porte des règles R1, R2, R3, R5, R6 (RULES.md), et du complément de R4 sur les pointeurs
 * d'artefact ; le reste de R4 est `archon validate` (verify-block.sh).
 * Usage : bun scripts/gates/validate.ts [--root=<dossier>] [--workflow=<name>]...
 * Sortie : une ligne par violation `R<n> <fichier> : <motif>`, code 1 s'il y en a.
 * `--workflow=<name>` (le `name:` du YAML, répétable ; verify-block.sh <name>, étape 0) ne
 * garde que les violations de ces workflows, des blocs qu'ils incluent (`include:`, de proche
 * en proche : ils tournent dans le même run) et de tout le dépôt (registre orphelin,
 * déclencheurs, workflow égaré…) : un chantier voisin ne fait pas rougir le bloc qu'on vérifie.
 * Les sous-runs `workflow:` (board-listener → pipeline…) sont des runs à part, hors de cette
 * vérification : verify-block.sh <enfant> les vérifie.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { type Node, type Workflow, allNodes, isJudgeNode, loadHarness, readFixture, registryId, returnsOf, rootFromArgs } from './lib.ts';

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
const OVERLAPS = new Set(['skip', 'queue']);
/**
 * Les champs du contrôle qu'un arrêt de plus peut comparer à `true` dans until_bash, et
 * rien d'autre : `submitted_early` (apply-submit, envoi prématuré : réessayer renverrait).
 * Un autre champ (`attached`, `filled`…) arrêterait la boucle au premier tour où il est vrai.
 */
const EXTRA_STOPS = new Set(['submitted_early']);

const argv = process.argv.slice(2);
const h = loadHarness(rootFromArgs(argv));
const workflows = [...h.blocks, ...h.systems];
const only = new Set(argv.filter((a) => a.startsWith('--workflow=')).map((a) => a.slice('--workflow='.length)));
const unknown = [...only].filter((name) => !workflows.some((w) => w.id === name));
if (unknown.length) {
  console.error(`workflow inconnu : ${unknown.join(', ')} (noms : ${workflows.map((w) => w.id).join(', ')})`);
  process.exit(2);
}
/** `only` et les workflows qu'ils incluent (`include:`), de proche en proche ; pas les `workflow:`. */
const scoped = new Set<string>();
const reach = (name: string): void => {
  if (scoped.has(name)) return;
  scoped.add(name);
  const wf = workflows.find((w) => w.id === name);
  for (const n of wf ? allNodes(wf.nodes) : []) if (typeof n.include === 'string') reach(n.include);
};
for (const name of only) reach(name);
const byFolder = new Map(workflows.map((w) => [registryId(w), w]));
/** Chaque violation, et le workflow dont elle parle (null : tout le dépôt). */
const errors: { line: string; about: string | null }[] = [];
/** `about` défaut : le workflow dont le dossier contient `where` ; sinon la violation vaut pour tout le dépôt. */
const err = (rule: string, where: string, msg: string, about?: Workflow): void => {
  const owner = about ?? workflows.find((w) => where.startsWith(w.dir + sep));
  errors.push({ line: `${rule} ${relative(h.root, where) || where} : ${msg}`, about: owner?.id ?? null });
};

/** Le contrôle d'une boucle : le nœud script dont until_bash lit `$<id>.output.ok`. */
const loopCheck = (loop: Node): Node | undefined => {
  const until = loop.loop_group?.until_bash ?? '';
  return (loop.loop_group?.nodes ?? []).find((s) => typeof s.script === 'string' && until.includes(`$${s.id}.output.ok`));
};

/**
 * Les clés de stub des juges d'un workflow, ses inclusions comprises : Archon préfixe un nœud
 * de haut niveau inclus par `<include>__` (include-expander.ts), et laisse nu un id de corps
 * de boucle.
 */
function judgeStubKeys(wf: Workflow, seen: ReadonlySet<string> = new Set()): { key: string; top: boolean }[] {
  if (seen.has(wf.id)) return [];
  const inner = new Set([...seen, wf.id]);
  const own = allNodes(wf.nodes).filter(isJudgeNode).map((n) => ({ key: String(n.id), top: wf.nodes.includes(n) }));
  const included = wf.nodes.filter((n) => typeof n.include === 'string').flatMap((inc) => {
    const child = workflows.find((w) => w.id === inc.include);
    return child ? judgeStubKeys(child, inner).map((j) => ({ key: j.top ? `${inc.id}__${j.key}` : j.key, top: j.top })) : [];
  });
  return [...own, ...included];
}

function checkTests(block: Workflow, scriptName: string): string | null {
  const scriptPath = join(block.dir, 'scripts', `${scriptName}.ts`);
  if (!existsSync(scriptPath)) return `script « ${scriptName} » introuvable (scripts/${scriptName}.ts)`;
  if (existsSync(join(block.dir, 'scripts', `${scriptName}.test.ts`))) return null;
  const source = readFileSync(scriptPath, 'utf8');
  // Toute importation de modules partagés (guillemets simples ou doubles, avec ou sans `.ts`,
  // `import()` compris) ; une importation de types seuls n'apporte aucune règle.
  const shared = [...new Set([...source.matchAll(/^(?!\s*import\s+type\b).*?(?:from|import)\s*\(?\s*['"]\.\.\/\.\.\/\.shared\/([\w-]+?)(?:\.ts)?['"]/gm)]
    .map((m) => m[1]!))];
  // `io` (liaisons, sortie, compteur `nextTry`) a son test, exigé comme les autres, mais ne
  // porte aucune règle du contrôle : l'importer seul ne teste rien de ce que vérifie le contrôle.
  if (shared.filter((m) => m !== 'io').length === 0) return `contrôle « ${scriptName} » sans test (ni scripts/${scriptName}.test.ts, ni règle importée de .shared/)`;
  const untested = shared.filter((m) => !existsSync(join(block.dir, '..', '.shared', `${m}.test.ts`)));
  if (untested.length) return `règles importées sans test : ${untested.map((m) => `.shared/${m}.ts`).join(', ')}`;
  return null;
}

/**
 * La condition d'arrêt d'une boucle : la dernière instruction de `until_bash`, des tests
 * `[ … ]` reliés par `||` ou `&&` (`ref` absent : un test illisible). Avant elle, seules des
 * affectations `v=$<nœud>.output.<champ>`, une par variable : toute autre instruction (`t=1`,
 * une réaffectation, un test isolé) va dans `stray`, car elle peut fausser ce que lisent les
 * tests. Une variable est remplacée par ce qu'elle lit ; `$check.output.ok` lu en direct vaut
 * tel quel.
 */
interface UntilTest { text: string; ref?: string; op?: string; value?: string }
function parseUntil(until: string): { tests: UntilTest[]; joins: string[]; stray: string[] } {
  const statements = until.split(/;|\n/).map((s) => s.trim()).filter(Boolean);
  const vars = new Map<string, string>();
  const stray: string[] = [];
  for (const s of statements.slice(0, -1)) {
    const m = /^([A-Za-z_]\w*)=(["']?)\$\{?([A-Za-z0-9_-]+\.output\.\w+)\}?\2$/.exec(s);
    if (!m) stray.push(`« ${s} » n'est pas une affectation « v=$<nœud>.output.<champ> »`);
    else if (vars.has(m[1]!)) stray.push(`« ${s} » réaffecte « ${m[1]} »`);
    else vars.set(m[1]!, m[3]!);
  }
  const parts = (statements.at(-1) ?? '').split(/\s*(\|\||&&)\s*/);
  const tests = parts.filter((_, i) => i % 2 === 0).map((text): UntilTest => {
    const m = /^\[\s+"?\$\{?([A-Za-z0-9_.-]+?)\}?"?\s+(==?|-ge)\s+"?(\w+)"?\s+\]$/.exec(text);
    return m ? { text, ref: vars.get(m[1]!) ?? m[1]!, op: m[2]!, value: m[3]! } : { text };
  });
  return { tests, joins: parts.filter((_, i) => i % 2 === 1), stray };
}

/** Le source d'un script sans ses commentaires (`/* … *\/`, `// …` hors `://`). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Les plages `[début, fin)` des arguments de chaque appel `emit( … )` (chaînes sautées). */
function emitArgs(code: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of code.matchAll(/\bemit\s*\(/g)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i]!;
      if (c === "'" || c === '"' || c === '`') {
        for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      } else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push([start, i - 1]);
  }
  return out;
}

/**
 * Le contrôle d'une boucle compte ses tours avec le compteur partagé : il importe `nextTry`
 * de `.shared/io.ts`, émet `tries: nextTry(process.env.INPUTS_TRIES)` dans l'objet passé à
 * `emit({ … })`, et ne donne à `tries` aucune autre valeur : ni `tries: 1` (la boucle
 * s'épuiserait en échec), ni `tries = …` (une variable que rien n'oblige à émettre).
 */
function checkCounter(block: Workflow, scriptName: string): string | null {
  const scriptPath = join(block.dir, 'scripts', `${scriptName}.ts`);
  if (!existsSync(scriptPath)) return null; // checkTests le signale
  const code = codeOf(readFileSync(scriptPath, 'utf8'));
  const wanted = 'nextTry(process.env.INPUTS_TRIES)';
  const form = `« tries: ${wanted} » dans l'objet passé à emit({ … }) (nextTry importé de .shared/io.ts)`;
  if (!/import\s*\{[^}]*\bnextTry\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.shared\/io(?:\.ts)?['"]/.test(code)
    || /\b(?:function\s+nextTry|(?:const|let|var)\s+nextTry)\b/.test(code)) {
    return `le contrôle « ${scriptName} » doit émettre ${form} : nextTry n'y vient pas de .shared/io.ts`;
  }
  // Toute valeur donnée à `tries` (propriété ou affectation), hors annotations de type. Seule
  // la propriété exacte, dans un objet émis, compte ; toute affectation est une autre valeur.
  const emitted = emitArgs(code);
  const exact: number[] = [];
  const others: string[] = [];
  for (const m of code.matchAll(/(?:^|[^\w$.])tries\s*(:(?!\s*(?:number|string|unknown)\b)|=(?![=>]))\s*([^,;}\n]*)/gm)) {
    const value = m[2]!.trim();
    const inEmit = emitted.some(([a, b]) => m.index! >= a && m.index! < b);
    if (m[1] === ':' && inEmit && value.replace(/\s+/g, '') === wanted) exact.push(m.index!);
    else others.push(`« tries${m[1] === ':' ? ':' : ' ='} ${value} »${m[1] === ':' && !inEmit ? ' hors de emit' : ''}`);
  }
  if (exact.length === 0 || others.length) {
    return `le contrôle « ${scriptName} » doit émettre ${form}${others.length ? `, sans autre valeur (lu : ${others.join(', ')})` : ''} : sans le compteur, tries ne compte pas et la boucle s'épuise en échec`;
  }
  // Chaque appel emit({ … }) porte le compteur : Archon confronte la sortie à output_format, où
  // tries est exigé ; un emit précoce sans lui (livrable absent…) fait échouer le contrôle.
  const bare = emitted.filter(([a, b]) => !exact.some((i) => i >= a && i < b)).length;
  if (bare) {
    return `le contrôle « ${scriptName} » doit émettre ${form} dans chacun de ses appels emit : ${bare} appel(s) emit sur ${emitted.length} sans tries : Archon confronte la sortie à output_format, où tries est exigé, et le contrôle échoue, la boucle aussi, sans verdict typé`;
  }
  return null;
}

// ── R1 : chaque bloc a une boucle agent ⇄ script, et le script est testé ─────────────
for (const block of h.blocks) {
  const loops = allNodes(block.nodes).filter((n) => n.loop_group);
  if (loops.length === 0) {
    err('R1', block.yamlPath, 'aucune loop_group : le code ne reprend pas le travail de l\'agent');
    continue;
  }
  for (const loop of loops) {
    const body = loop.loop_group?.nodes ?? [];
    const scripts = body.filter((n) => typeof n.script === 'string');
    if (scripts.length === 0) {
      err('R1', block.yamlPath, `boucle « ${loop.id} » sans nœud script : aucun contrôle déterministe`);
      continue;
    }
    const until = loop.loop_group?.until_bash ?? '';
    const check = loopCheck(loop);
    if (!check) {
      err('R1', block.yamlPath, `boucle « ${loop.id} » : until_bash ne lit pas le verdict du contrôle ($<contrôle>.output.ok)`);
    }
    // La boucle rend toujours la main : elle s'arrête quand le contrôle passe OU quand son
    // compteur `tries` atteint le plafond, jamais par épuisement de max_iterations (nœud
    // `failed`, rejoué par Archon quand un run reprend après une pause humaine, et aucun
    // verdict typé). Forme attendue, dans un ordre ou dans l'autre :
    //   ok=$check.output.ok; t=$check.output.tries; [ "$ok" = true ] || [ "$t" -ge N ]
    // Un seul test `-ge`, le plafond. Un autre arrêt s'ajoute par `||` et compare à `true` un
    // champ du contrôle de la liste EXTRA_STOPS (apply-submit : `[ "$e" = true ]`, envoi
    // prématuré) : `[ "$ok" = false ]`, `[ "$t" -ge 1 ]` ou `[ "$attached" = true ]`
    // arrêteraient la boucle avant qu'elle ne réessaie.
    const max = Number(loop.loop_group?.max_iterations);
    const n = Number.isFinite(max) ? max : 'N';
    const id = check?.id ?? '<contrôle>';
    const where = `boucle « ${loop.id} » :`;
    const { tests, joins, stray } = parseUntil(until);
    if (stray.length) {
      err('R1', block.yamlPath, `${where} until_bash : avant la chaîne de tests, seules des affectations « v=$<nœud>.output.<champ> », une par variable (${stray.join(' ; ')}) : une autre instruction fausse ce que lisent les tests`);
    }
    const isOk = (t: UntilTest): boolean => !!check && t.op !== '-ge' && t.ref === `${check.id}.output.ok` && t.value === 'true';
    const okTest = tests.find(isOk);
    const caps = tests.filter((t) => t.op === '-ge');
    const capTest = caps[0];
    const fmt = (t: UntilTest): string => `« ${t.text} »`;
    if (!capTest) {
      err('R1', block.yamlPath, `${where} until_bash doit aussi s'arrêter au plafond, par le compteur du contrôle (« t=$<contrôle>.output.tries; … || [ "$t" -ge ${n} ] », N = max_iterations) : une boucle épuisée finit en échec, sans verdict typé`);
    } else if (caps.length > 1) {
      err('R1', block.yamlPath, `${where} un seul test « -ge », le plafond (lu : ${caps.map(fmt).join(', ')}) : un second plafond arrête la boucle avant qu'elle ne réessaie, ou après son épuisement`);
    } else if (Number(capTest.value) !== max) {
      err('R1', block.yamlPath, `${where} le plafond lu est ${fmt(capTest)}, max_iterations vaut ${loop.loop_group?.max_iterations === undefined ? 'rien' : String(loop.loop_group.max_iterations)} : il faut « [ "$t" -ge ${n} ] », sinon la boucle s'épuise en échec ou s'arrête avant son dernier tour`);
    } else if (!(check ? [check] : scripts).some((s) => capTest.ref === `${s.id}.output.tries`)) {
      err('R1', block.yamlPath, `${where} le plafond compare « $${capTest.ref} », qui ne vient pas du compteur du contrôle (« t=$${id}.output.tries; … [ "$t" -ge ${n} ] ») : la boucle s'épuiserait en échec`);
    }
    if (check && capTest && joins.some((j) => j !== '||')) {
      err('R1', block.yamlPath, `${where} until_bash relie le test de ok et le plafond par « ${joins.find((j) => j !== '||')} » : il faut « || » (« [ "$ok" = true ] || [ "$t" -ge ${n} ] »), sinon des contrôles rouges au plafond n'arrêtent pas la boucle, qui s'épuise en échec`);
    } else if (check && capTest && !okTest) {
      err('R1', block.yamlPath, `${where} until_bash doit finir par « [ "$ok" = true ] || [ "$t" -ge ${n} ] » (ok=$${id}.output.ok, t=$${id}.output.tries) : sinon la boucle tourne ou s'arrête sans le verdict du contrôle`);
    }
    for (const t of check ? tests.filter((x) => x.op !== '-ge' && !isOk(x)) : []) {
      if (!t.ref) {
        err('R1', block.yamlPath, `${where} test illisible ${fmt(t)} dans until_bash : la chaîne finale ne relie par « || » que des tests « [ "$v" = true ] » et le plafond « [ "$t" -ge ${n} ] »`);
        continue;
      }
      const field = check && t.ref.startsWith(`${check.id}.output.`) ? t.ref.slice(`${check.id}.output.`.length) : null;
      if (!field || !EXTRA_STOPS.has(field) || t.value !== 'true') {
        err('R1', block.yamlPath, `${where} arrêt en trop ${fmt(t)}${field && !EXTRA_STOPS.has(field) ? ` (champ « ${field} »)` : ''} : un autre arrêt ne compare à true qu'un champ autorisé du contrôle (${[...EXTRA_STOPS].join(', ')} : « e=$${id}.output.submitted_early; … || [ "$e" = true ] ») ; sinon la boucle s'arrête avant d'avoir réessayé, ou sans le verdict du contrôle`);
      }
    }
    // Le compteur avance d'un tour à l'autre : le contrôle lit le `tries` du tour précédent.
    if (check) {
      const tries = (check.with as Record<string, unknown> | undefined)?.tries;
      const wanted = `$LOOP_PREV.${check.id}.output.tries`;
      if (tries !== wanted) {
        err('R1', `${block.yamlPath}#${check.id}`, `le contrôle doit lier tries: "${wanted}" (lu : ${tries === undefined ? 'rien' : JSON.stringify(tries)}) : sans le tour précédent, tries ne compte pas et la boucle s'épuise en échec`);
      }
      // … et l'avance lui-même : `tries: nextTry(process.env.INPUTS_TRIES)`, jamais une constante.
      const counter = checkCounter(block, String(check.script));
      if (counter) err('R1', `${block.yamlPath}#${check.id}`, counter);
    }
    for (const s of scripts) {
      const problem = checkTests(block, String(s.script));
      if (problem) err('R1', block.yamlPath, problem);
    }
  }
}

// ── R2 : le juge est en contexte vierge, en lecture seule, et n'est pas l'auteur ─────
for (const wf of [...h.blocks, ...h.systems]) {
  for (const node of allNodes(wf.nodes)) {
    if (!isJudgeNode(node)) continue;
    const where = `${wf.yamlPath}#${node.id}`;
    if (node.context !== 'fresh') err('R2', where, 'le juge doit avoir context: fresh');
    if (node.mutates_checkout !== false) err('R2', where, 'le juge doit déclarer mutates_checkout: false');
    const tools = Array.isArray(node.allowed_tools) ? (node.allowed_tools as string[]) : null;
    // `allowed_tools` ne borne que les outils intégrés : un serveur MCP ajoute les siens
    // (mcp__<serveur>__*), et seul le fournisseur Claude applique la liste.
    if (node.mcp !== undefined) err('R2', where, 'le juge ne déclare aucun serveur MCP (mcp:) : ses outils échapperaient à allowed_tools');
    const provider = node.provider ?? wf.doc.provider;
    if (provider !== undefined && provider !== 'claude') err('R2', where, `fournisseur « ${String(provider)} » : seul claude applique allowed_tools au juge`);
    if (!tools) err('R2', where, 'le juge doit lister allowed_tools (lecture seule)');
    else {
      const writers = tools.filter((t) => !READ_ONLY_TOOLS.has(t));
      if (writers.length) err('R2', where, `outils d'écriture ou shell chez le juge : ${writers.join(', ')}`);
    }
    const judgeName = String(node.command ?? 'judge');
    const commandsDir = join(wf.dir, 'commands');
    const judgeMd = join(commandsDir, `${judgeName}.md`);
    if (!existsSync(judgeMd)) {
      err('R2', where, `prompt du juge introuvable : commands/${judgeName}.md`);
      continue;
    }
    // Celui qui écrit ne se note pas : le prompt du juge diffère de tous les autres prompts du workflow.
    const judgeText = readFileSync(judgeMd, 'utf8').trim();
    const others = existsSync(commandsDir) ? readdirSync(commandsDir).filter((f) => f.endsWith('.md') && f !== `${judgeName}.md`) : [];
    const twin = others.find((f) => readFileSync(join(commandsDir, f), 'utf8').trim() === judgeText);
    if (twin) err('R2', where, `le juge réutilise le prompt de l'agent (commands/${twin}) : celui qui écrit ne se note pas`);
  }
}

// ── R3 : « vérifié » et « prouvé » se prouvent ────────────────────────────────────────
for (const wf of [...h.blocks, ...h.systems]) {
  const id = registryId(wf);
  const status = h.registry.get(id);
  // Chaque fixture qui se termine dit ce qu'elle doit rendre (fixture-outcomes.ts l'asserte),
  // ou pourquoi rien n'y tourne pour de vrai.
  const outcomeField = returnsOf(wf.doc).outcome;
  const returned = new Set<unknown>();
  const statuses = new Set<unknown>();
  let asserted = 0;
  for (const name of wf.fixtures) {
    const fx = readFixture(join(wf.dir, 'fixtures', `${name}.stubs.yaml`));
    if (fx.attendu.size) asserted++;
    const own = fx.attendu.get('');
    if (own && outcomeField in own) returned.add(own[outcomeField]);
    if (own && 'status' in own) statuses.add(own.status);
    if (fx.expect === 'completed' && fx.attendu.size === 0 && !fx.exempt) {
      err('R3', join(wf.dir, 'fixtures', `${name}.stubs.yaml`), 'ni « # attendu: champ=valeur » ni « # sans-attendu: raison » : l\'issue de la fixture n\'est pas déclarée');
    }
    // Contrôles rouges au plafond : le juge est sauté. Un nœud atteint sans stub fait échouer
    // le dry-run (« Missing reachable stub ») ; sans stub de juge, la fixture prouve donc qu'il
    // n'a pas tourné. Un stub de juge masquerait un juge qui tourne sur des contrôles rouges.
    // Les juges sont ceux de R2 (isJudgeNode : `command: judge` compris, quel que soit l'id).
    if (wf.kind === 'block' && own?.status === 'unconverged') {
      const fixturePath = join(wf.dir, 'fixtures', `${name}.stubs.yaml`);
      const judges = judgeStubKeys(wf).map((j) => j.key).filter((k) => k in fx.stubs);
      if (judges.length) {
        err('R3', fixturePath, `fixture status=unconverged qui stubbe le juge (${judges.join(', ')}) : le juge doit y être sauté, et seul un stub absent le prouve`);
      }
      // Le dry-run ne joue qu'un tour et n'exécute pas until_bash : le stub du contrôle EST le
      // dernier tour. Il dit donc des contrôles rouges (`ok: false`) au plafond
      // (`tries` = max_iterations) ; `tries: 1` décrirait une boucle qui réessaierait encore.
      const loops = allNodes(wf.nodes).filter((n) => n.loop_group).flatMap((loop) => {
        const check = loopCheck(loop);
        return check ? [{ loop, check, stub: (fx.stubs[String(check.id)] ?? {}) as Record<string, unknown> }] : [];
      });
      const atCap = loops.some(({ loop, stub }) => stub.ok === false && Number(stub.tries) === Number(loop.loop_group?.max_iterations));
      if (loops.length && !atCap) {
        const read = loops.map(({ loop, check, stub }) => `« ${String(check.id)} » : ok: ${JSON.stringify(stub.ok) ?? 'rien'}, tries: ${JSON.stringify(stub.tries) ?? 'rien'} (attendu ok: false, tries: ${String(loop.loop_group?.max_iterations)}, max_iterations de « ${String(loop.id)} »)`);
        err('R3', fixturePath, `fixture status=unconverged dont le stub du contrôle n'est pas le dernier tour : ${read.join(' ; ')} : le dry-run ne joue qu'un tour, ce stub doit dire des contrôles rouges au plafond`);
      }
    }
  }
  if (status === undefined) continue; // R5 signale l'absence de ligne
  if (status === '?') err('R3', h.registryPath, `« ${id} » : statut illisible (GABARIT | DRAFT | VERIFIED | PROUVÉ)`, wf);
  if (status === 'PROUVÉ') {
    const proof = join(wf.dir, '..', 'proofs', `${id}.md`);
    const text = existsSync(proof) ? readFileSync(proof, 'utf8') : '';
    if (text.trim().length < 200) err('R3', h.registryPath, `« ${id} » PROUVÉ sans preuve substantielle (${relative(h.root, proof)}, ≥ 200 caractères)`, wf);
    else {
      // Les trois faits de MECHANICS.md § 2, chacun sous son titre (blocks/proofs/README.md).
      const missing = ['Contrôles', 'Juge', 'Run réel'].filter((t) => !new RegExp(`^## ${t}\\s*$`, 'm').test(text));
      if (missing.length) err('R3', proof, `preuve sans ${missing.map((t) => `« ## ${t} »`).join(', ')} : les trois faits (contrôles, refus du juge, run réel) sont exigés`, wf);
    }
  }
  if (status === 'VERIFIED' || status === 'PROUVÉ' || status === 'GABARIT') {
    if (wf.fixtures.length === 0) err('R3', h.registryPath, `« ${id} » ${status} sans aucune fixture`, wf);
    else if (asserted === 0) err('R3', h.registryPath, `« ${id} » ${status} sans aucune fixture dont l'issue est assertée (# attendu)`, wf);
    // Un bloc prouve son issue positive ; un bloc jugé prouve aussi que le refus du juge rend
    // ${outcomeField}=false. Sans juge (implement), l'issue négative est `unconverged` (contrôles rouges au plafond, fixture exigée).
    if (wf.kind === 'block' && !returned.has(true)) {
      err('R3', h.registryPath, `« ${id} » ${status} : il faut une fixture qui rend ${outcomeField}=true (# attendu: ${outcomeField}=true)`, wf);
    }
    if (wf.kind === 'block' && allNodes(wf.nodes).some(isJudgeNode) && !returned.has(false)) {
      err('R3', h.registryPath, `« ${id} » ${status} : bloc jugé sans fixture qui rend ${outcomeField}=false (# attendu: ${outcomeField}=false)`, wf);
    }
    // Tout bloc, jugé ou non, prouve qu'il rend la main au plafond avec une issue typée.
    if (wf.kind === 'block' && !statuses.has('unconverged')) {
      err('R3', h.registryPath, `« ${id} » ${status} : il faut une fixture qui rend status=unconverged (# attendu: … status=unconverged) : des contrôles rouges au plafond rendent une issue typée, jamais un run en échec`, wf);
    }
  }
}

// ── R3 (suite) : le juge ne tourne que sur des contrôles verts ───────────────────────
// Un juge qui dépend de la boucle porte `when: "$<boucle>.output.ok == true"` : sans lui, il
// jugerait un livrable aux contrôles rouges, et un refus (ou une erreur du modèle) remplacerait
// l'issue `unconverged`.
for (const block of h.blocks) {
  const loops = allNodes(block.nodes).filter((n) => n.loop_group);
  for (const judge of allNodes(block.nodes).filter(isJudgeNode)) {
    const deps = Array.isArray(judge.depends_on) ? (judge.depends_on as unknown[]).map(String) : [];
    for (const loop of loops.filter((l) => deps.includes(String(l.id)))) {
      const wanted = `$${loop.id}.output.ok == true`;
      const when = typeof judge.when === 'string' ? judge.when.replace(/\s+/g, ' ').trim() : undefined;
      if (when !== wanted) {
        err('R3', `${block.yamlPath}#${judge.id}`, `le juge doit porter when: "${wanted}" (lu : ${judge.when === undefined ? 'rien' : JSON.stringify(judge.when)}) : sans lui, il juge des contrôles rouges et l'issue unconverged disparaît`);
      }
    }
  }
}

// ── R3 (suite) : un bloc rend toujours son verdict typé ──────────────────────────────
// Le nœud `returns` d'un bloc tourne aussi quand le juge est sauté (contrôles rouges au
// plafond : `unconverged`) ; il ne tourne pas sur un nœud en échec (une liaison ne lit jamais
// un producteur en échec), d'où none_failed_min_one_success plutôt que all_done.
for (const block of h.blocks) {
  const returns = returnsOf(block.doc).node;
  const node = allNodes(block.nodes).find((n) => n.id === returns);
  if (!node) continue;
  if (node.trigger_rule !== 'none_failed_min_one_success') {
    err('R3', `${block.yamlPath}#${returns}`, 'le verdict doit tourner même quand le juge est sauté (trigger_rule: none_failed_min_one_success, dépendant de la boucle) : sinon des contrôles rouges au plafond ne rendent aucune issue typée');
  }
}

// ── R4 (suite) : un pointeur d'artefact nomme un fichier régulier ────────────────────
// Archon vérifie chaque pointeur `archon_artifact` au moment où il est produit, à l'exécution
// seulement : `path` doit être un fichier régulier non vide des artefacts du run, et un
// dossier (ou un fichier absent) fait tomber le nœud en échec de contrat — hors de portée de
// `archon validate` et des fixtures (premier run réel, 2026-10-22 : « does not refer to a
// regular file »). Ici : dans chaque prompt, le `path` déclaré finit par un nom de fichier,
// directement ou par une entrée dont la valeur par défaut en est un ; dans chaque script, un
// pointeur passe par artifactPointer() de .shared/io.ts, qui refuse un dossier.
const fileLike = (name: string): boolean => /^[^.\s][^/\\]*\.[A-Za-z0-9]+$/.test(name);
for (const wf of workflows) {
  const inputs = (wf.doc.inputs ?? {}) as Record<string, { default?: unknown } | undefined>;
  const commandsDir = join(wf.dir, 'commands');
  const prompts = existsSync(commandsDir) ? readdirSync(commandsDir).filter((f) => f.endsWith('.md')) : [];
  for (const prompt of prompts) {
    const where = join(commandsDir, prompt);
    for (const m of readFileSync(where, 'utf8').matchAll(/"type":\s*"archon_artifact"[^}]*?"path":\s*"([^"]*)"/g)) {
      const value = m[1]!;
      const last = value.replace(/\\/g, '/').split('/').pop() ?? '';
      const ref = /^\$INPUTS\.(\w+)$/.exec(last);
      if (ref) {
        const def = inputs[ref[1]!]?.default;
        const defName = typeof def === 'string' ? (def.replace(/\\/g, '/').split('/').pop() ?? '') : '';
        if (!fileLike(defName)) {
          err('R4', where, `le pointeur archon_artifact nomme « ${value} », dont la valeur par défaut (« ${String(def ?? '')} ») n'est pas un fichier : Archon exige un fichier régulier non vide, jamais un dossier (nommer le fichier, « ${value}/<nom>.<ext> », ou une entrée dont la valeur par défaut est un fichier)`);
        }
      } else if (!fileLike(last)) {
        err('R4', where, `le pointeur archon_artifact nomme « ${value} », qui ne finit pas par un nom de fichier (<nom>.<ext>) : Archon exige un fichier régulier non vide, jamais un dossier`);
      }
    }
  }
}
const scriptDirs = [
  ...workflows.map((w) => join(w.dir, 'scripts')),
  join(h.root, '.archon', 'workflows', 'blocks', '.shared'),
  join(h.root, '.archon', 'workflows', 'systems', '.shared'),
];
for (const dir of scriptDirs) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'io.ts')) {
    const where = join(dir, f);
    if (/\btype:\s*['"]archon_artifact['"]\s*,/.test(readFileSync(where, 'utf8'))) {
      err('R4', where, 'construit un pointeur archon_artifact à la main : passer par artifactPointer(<fichier>) de .shared/io.ts, qui refuse un dossier (Archon exige un fichier régulier non vide)');
    }
  }
}

// ── R5 : le registre nomme chaque bloc et système, et rien d'autre ──────────────────
const known = new Set([...h.blocks, ...h.systems].map(registryId));
for (const wf of [...h.blocks, ...h.systems]) {
  if (!h.registry.has(registryId(wf))) err('R5', h.registryPath, `« ${registryId(wf)} » n'a pas de ligne dans le registre`, wf);
}
for (const id of h.registry.keys()) {
  if (!known.has(id)) err('R5', h.registryPath, `ligne orpheline « ${id} » : aucun dossier blocks/${id} ni systems/${id}`);
}
for (const id of new Set(h.registryDuplicates)) err('R5', h.registryPath, `« ${id} » a plusieurs lignes : un seul statut par bloc ou système`, byFolder.get(id));
// Le dossier (clé du registre) et le nom lancé (`name:`, harness.json, déclencheurs) ne divergent pas.
for (const wf of [...h.blocks, ...h.systems]) {
  const folder = registryId(wf);
  const expected = folder === 'template' ? 'block-template' : folder;
  if (wf.id !== expected) err('R5', wf.yamlPath, `name « ${wf.id} » ≠ dossier « ${folder} » (attendu : name: ${expected})`);
  if (basename(wf.yamlPath) !== `${expected}.yaml`) err('R5', wf.yamlPath, `fichier « ${basename(wf.yamlPath)} » : attendu ${expected}.yaml`);
}
for (const path of h.strayWorkflows) err('R5', path, 'workflow hors blocks/<id>/<id>.yaml et systems/<id>/<id>.yaml : Archon le chargerait sans qu\'aucune porte ne le vérifie');

// ── R6 : tableaux à états fermés (testés), déclencheurs qui lancent des workflows connus ─
const names = new Set([...h.blocks, ...h.systems].map((w) => w.id));
for (const t of h.triggers) {
  if (!t.doc) {
    err('R6', t.path, `JSON invalide : ${t.error}`);
    continue;
  }
  const binding = (t.doc.binding ?? {}) as Record<string, unknown>;
  const launch = (binding.launch ?? {}) as Record<string, unknown>;
  if (!names.has(String(launch.workflowName))) err('R6', t.path, `workflow inconnu « ${String(launch.workflowName)} »`);
  if (!OVERLAPS.has(String(binding.overlap))) err('R6', t.path, `overlap doit valoir skip ou queue (lu : ${String(binding.overlap)})`);
}
for (const test of ['board.test.ts', 'pending.test.ts', 'career.test.ts']) {
  const path = join(h.root, '.archon', 'workflows', 'systems', '.shared', test);
  if (!existsSync(path)) err('R6', path, 'les transitions d\'état (tableau, offres) doivent être testées à l\'unité');
}

// `--workflow=<name>` : les violations de ces workflows, des blocs qu'ils incluent et de tout le
// dépôt ; celles des autres workflows sont comptées, pas imprimées (`bun scripts/gates/validate.ts` les liste).
const kept = errors.filter((e) => only.size === 0 || e.about === null || scoped.has(e.about));
const elsewhere = errors.length - kept.length;
const included = [...scoped].filter((name) => !only.has(name));
const scope = only.size ? ` (${[...only].join(', ')}${included.length ? `, les blocs inclus ${included.join(', ')},` : ''} et tout le dépôt)` : '';
const note = elsewhere ? `\n(${elsewhere} violation(s) d'autres workflows, hors de cette vérification : bun scripts/gates/validate.ts)` : '';
if (kept.length) {
  console.error(kept.map((e) => e.line).join('\n'));
  console.error(`\n✗ ${kept.length} violation(s)${scope}${note}`);
  process.exitCode = 1;
} else if (only.size) {
  console.log(`✓ R1 R2 R3 R4(pointeurs) R5 R6${scope}${note}`);
} else {
  console.log(`✓ R1 R2 R3 R4(pointeurs) R5 R6 : ${h.blocks.length} bloc(s), ${h.systems.length} système(s), ${h.triggers.length} déclencheur(s), registre cohérent`);
}
