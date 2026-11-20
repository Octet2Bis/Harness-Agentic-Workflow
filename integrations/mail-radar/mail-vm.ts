#!/usr/bin/env bun
/**
 * Les alertes mail d'un candidat, sur la VM, après chaque cycle de son radar (cycle.sh, verrou à
 * part) : aux heures de `alertes_mail.json` (heure de Paris, 8 h et 18 h par défaut), UN mail
 * récapitulatif de toutes les offres entrées au tableau depuis le dernier envoi, Paris / IDF en
 * tête. Pas de mail quand il n'y a rien de nouveau. Jamais deux fois la même offre
 * (`mail_alerts.json`). Zéro Claude, zéro modèle.
 *
 *   bun mail-vm.ts --career ~/radar-unifie/candidats/camille [--env-file <fichier>]…
 *     [--dry-run [--out apercu.html]] [--now <ISO>] [--force]
 *
 * Coupé sans bruit (code 0) sans `alertes_mail.json`, avec `actif: false`, ou sans clés d'envoi.
 * Un envoi raté n'est pas marqué : il est retenté au cycle suivant (15 min).
 * `--force` envoie tout de suite, hors créneau (essai).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_FILE, STATE_FILE, apiSend, buildMail, chooseTransport, currentSlot, mimeMessage, parseConfig, parseState, pickOffers, readEnv, smtpSend, writeJsonAtomic } from './mail.ts';

const KEEP_SENT_DAYS = 60;

interface Args {
  career: string;
  envFiles: string[];
  dryRun: boolean;
  out: string;
  now: Date;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { career: '', envFiles: [], dryRun: false, out: '', now: new Date(), force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} : valeur manquante`);
      return v;
    };
    if (k === '--career') a.career = resolve(next());
    else if (k === '--env-file') a.envFiles.push(resolve(next()));
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--out') a.out = resolve(next());
    else if (k === '--now') a.now = new Date(next());
    else if (k === '--force') a.force = true;
    else throw new Error(`option inconnue : ${k}`);
  }
  if (a.career === '') throw new Error('--career est obligatoire');
  if (Number.isNaN(a.now.getTime())) throw new Error('--now : date illisible');
  return a;
}

export async function run(a: Args, env = readEnv(a.envFiles)): Promise<string> {
  const stamp = `[mail ${a.now.toISOString()}]`;
  const cfgPath = join(a.career, CONFIG_FILE);
  if (!existsSync(cfgPath)) return `${stamp} pas de ${CONFIG_FILE} : alertes mail coupées`;
  const cfg = parseConfig(readFileSync(cfgPath, 'utf8'));
  if (!cfg.actif) return `${stamp} alertes mail coupées (actif: false)`;
  const statePath = join(a.career, STATE_FILE);
  const state = parseState(existsSync(statePath) ? readFileSync(statePath, 'utf8') : null);
  const slot = currentSlot(a.now, cfg.heures);
  if (!a.force && (slot === '' || slot === state.last_slot)) return `${stamp} hors créneau (prochain : ${cfg.heures.map((h) => `${h} h`).join(', ')})`;
  const boardPath = join(a.career, 'pending_gold_jobs.json');
  const board = existsSync(boardPath) ? (JSON.parse(readFileSync(boardPath, 'utf8').replace(/^﻿/, '') || '[]') as unknown[]) : [];
  const cutoff = new Date(a.now.getTime() - KEEP_SENT_DAYS * 86_400_000).toISOString();
  const all = pickOffers(Array.isArray(board) ? board : [], state, cfg, cutoff);
  const offers = all.slice(0, cfg.max_par_mail);
  if (offers.length === 0) {
    if (!a.dryRun) writeJsonAtomic(statePath, { ...state, last_slot: slot || state.last_slot });
    return `${stamp} créneau ${slot} : rien de nouveau, pas de mail`;
  }
  const mail = buildMail(offers, cfg, a.now);
  if (a.dryRun) {
    if (a.out !== '') writeFileSync(a.out, mail.html, 'utf8');
    return `${stamp} essai : « ${mail.subject} » à ${cfg.to} (${offers.length} offre(s)${a.out ? `, aperçu ${a.out}` : ''}) — rien envoyé`;
  }
  const transport = chooseTransport(env, cfg.transport);
  if (transport === null) return `${stamp} pas de clés d'envoi (MAIL_SMTP_USER + MAIL_SMTP_PASS, BREVO_API_KEY ou RESEND_API_KEY) : ${offers.length} offre(s) en attente`;
  try {
    if (transport === 'smtp') await smtpSend(env, cfg.to, mimeMessage(env.MAIL_FROM || env.MAIL_SMTP_USER || '', cfg.from_name, cfg.to, mail, a.now));
    else await apiSend(transport, env, cfg.to, cfg.from_name, mail);
  } catch (err) {
    const msg = (err as Error).message.slice(0, 240);
    writeJsonAtomic(statePath, { ...state, last_error: `${a.now.toISOString()} ${msg}` });
    throw new Error(`envoi ${transport} raté (retenté au prochain cycle) : ${msg}`);
  }
  const at = a.now.toISOString();
  const sent: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.sent)) if (v >= cutoff) sent[k] = v;
  for (const o of offers) sent[o.key] = at;
  writeJsonAtomic(statePath, { sent, last_slot: slot || state.last_slot, last_sent_at: at, last_error: '' });
  const rest = all.length - offers.length;
  return `${stamp} envoyé (${transport}) : « ${mail.subject} » à ${cfg.to}${rest > 0 ? ` ; ${rest} offre(s) au prochain créneau` : ''}`;
}

if (import.meta.main) {
  try {
    console.log(await run(parseArgs(process.argv.slice(2))));
  } catch (err) {
    console.error(`mail-vm : ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
