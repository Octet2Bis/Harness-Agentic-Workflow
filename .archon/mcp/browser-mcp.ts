#!/usr/bin/env bun
/**
 * Lance Playwright MCP (le navigateur des agents) sur le profil de navigateur du candidat :
 * HARNESS_BROWSER_PROFILE (posé par le cockpit de chaque candidat), sinon le profil d'origine
 * `.local/browser-profile` (Antoine : runs à la main, career-listener). Chaque candidat garde ainsi
 * ses propres connexions (LinkedIn, Welcome to the Jungle…), jamais celles d'un autre.
 * Le navigateur est Chrome (`--browser chrome`, choix d'Antoine du 2026-10-25) : le profil s'ouvre aussi
 * à la main avec chrome.exe (bouton « Ouvrir dans le navigateur du robot » du cockpit).
 * Lancé par `.archon/mcp/browser.json` depuis le dossier du harness ; stdio passe tel quel.
 */
const profile = (process.env.HARNESS_BROWSER_PROFILE ?? '').trim() || '.local/browser-profile';
const npx = Bun.which('npx') ?? 'npx';
const proc = Bun.spawn([npx, '-y', '@playwright/mcp@0.0.41', '--browser', 'chrome', '--user-data-dir', profile, '--viewport-size', '1280,900'], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => proc.kill());
process.exitCode = await proc.exited;
