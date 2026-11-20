#!/usr/bin/env bun
/**
 * Génère `harness.json`, le contrat machine du dépôt, depuis les YAML, le registre et
 * l'inventaire des cas d'usage. Usage : bun scripts/gates/build-harness.ts [--check] [--root=<dossier>]
 * `--check` n'écrit rien et échoue si le fichier diverge (R5).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Workflow, allNodes, isJudgeNode, loadHarness, registryId, rootFromArgs } from './lib.ts';

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const h = loadHarness(rootFromArgs(argv));

/** Le premier paragraphe de `description:`, déplié sur une ligne. */
const purpose = (wf: Workflow): string =>
  String(wf.doc.description ?? '').split(/\r?\n\s*\r?\n/)[0]!.replace(/\s*\r?\n\s*/g, ' ').trim();

/**
 * Les nœuds d'un workflow et de ceux qu'il compose (`include:`, `workflow:`), récursivement :
 * un système qui inclut un bloc jugé a un juge, un sous-run qui attend l'humain est une pause.
 */
const byId = new Map([...h.blocks, ...h.systems].map((w) => [w.id, w]));
function composedNodes(wf: Workflow, seen = new Set<string>()): ReturnType<typeof allNodes> {
  if (seen.has(wf.id)) return [];
  seen.add(wf.id);
  const own = allNodes(wf.nodes);
  const nested = own.flatMap((n) => {
    const target = byId.get(String(n.include ?? n.workflow ?? ''));
    return target ? composedNodes(target, seen) : [];
  });
  return [...own, ...nested];
}

const entry = (wf: Workflow) => {
  const nodes = composedNodes(wf);
  return {
    id: wf.id,
    purpose: purpose(wf),
    status: h.registry.get(registryId(wf)) ?? 'ABSENT DU REGISTRE',
    // Nœuds script dans un corps de boucle (le contrôle déterministe), compositions comprises.
    check_scripts: nodes.filter((n) => typeof n.script === 'string' && nodes.some((l) => l.loop_group?.nodes?.includes(n))).length,
    judge: nodes.some(isJudgeNode),
    human_gate: nodes.some((n) => typeof n.wait === 'object' && n.wait !== null),
    fixtures: wf.fixtures,
    run: `archon workflow run ${wf.id}`,
  };
};

const useCasesPath = join(h.root, 'use-cases', 'README.md');
const useCases = existsSync(useCasesPath) ? (readFileSync(useCasesPath, 'utf8').match(/^### UC-\d+/gm) ?? []).length : 0;

const harness = {
  description: 'Contrat machine du harness. Généré par scripts/gates/build-harness.ts — ne pas éditer.',
  runtime: ['bun >= 1.2.21', 'archon (CLI)'],
  entrypoints: {
    humain: 'AGENTS.md',
    regles: 'RULES.md',
    procedures: 'MECHANICS.md',
    posture: 'POSTURE.md',
    cas_d_usage: 'use-cases/README.md',
    registre: '.archon/workflows/blocks/REGISTRY.md',
  },
  // Les portes de scripts/gates.sh, dans l'ordre ; verify-block.sh enchaîne validate.ts
  // (limité au workflow vérifié et au dépôt), les tests des règles des blocs, archon validate,
  // archon workflow test et fixture-outcomes.ts.
  gates: [
    'bun scripts/gates/test-gates-can-fail.ts',
    'bun scripts/gates/validate.ts',
    'bun scripts/gates/build-harness.ts --check',
    'bun test scripts',
    'scripts/verify-block.sh --all',
  ],
  blocks: h.blocks.filter((b) => registryId(b) !== 'template').map(entry),
  systems: h.systems.map(entry),
  use_cases: useCases,
};

const content = `${JSON.stringify(harness, null, 2)}\n`;
const file = join(h.root, 'harness.json');
const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
// Une copie Windows peut porter des fins de ligne CRLF : elles ne font pas une divergence.
if (current?.replace(/\r\n/g, '\n') === content) {
  console.log('✓ harness.json à jour');
} else if (CHECK) {
  // Même forme que validate.ts (« R<n> <fichier> : <motif> ») : le méta-test cherche cette ligne.
  console.error('R5 harness.json : généré divergent\n  → bun scripts/gates/build-harness.ts\n\n✗ 1 violation(s)');
  process.exitCode = 1;
} else {
  writeFileSync(file, content);
  console.log('écrit harness.json');
}
