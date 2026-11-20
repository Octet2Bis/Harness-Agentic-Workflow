#!/usr/bin/env bun
/**
 * Un faux `sync_pending.ps1 -Direction pull` pour cockpit.test.ts : à chaque appel, il ajoute au
 * tableau du PC (`FAKE_PULL_BOARD`) une offre « venue de la VM », comme la fusion le ferait, et
 * compte ses passages dans `FAKE_PULL_COUNT`. Il échoue comme scp quand le fichier
 * `FAKE_PULL_FAIL_FILE` existe.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (process.env.FAKE_PULL_FAIL_FILE && existsSync(process.env.FAKE_PULL_FAIL_FILE)) {
  console.error('scp a échoué (pull : lecture de pending_gold_jobs.json sur la VM).');
  process.exit(1);
}
const countPath = process.env.FAKE_PULL_COUNT!;
const n = (existsSync(countPath) ? Number(readFileSync(countPath, 'utf8')) : 0) + 1;
writeFileSync(countPath, String(n));
const boardPath = process.env.FAKE_PULL_BOARD!;
const rows = JSON.parse(readFileSync(boardPath, 'utf8')) as Record<string, unknown>[];
rows.push({ slug: `vm-${n}`, company: `VM ${n}`, title: 'Head of Growth', link: '', status: 'PENDING_VALIDATION', match_score: 95, date_published: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), source: 'LinkedIn (Live 24h)' }); // d'hier : la règle des 7 jours ne l'écarte pas du tri
writeFileSync(boardPath, JSON.stringify(rows));
console.log('VM -> PC : Workspace/career (pending_gold_jobs.json fusionné offre par offre)\nOK (pull).');
