import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiSend, buildMail, chooseTransport, currentSlot, mimeMessage, parseConfig, parseState, pickOffers, readEnv, smtpSend, zoneOf } from './mail.ts';
import { run } from './mail-vm.ts';

const IDF = ['paris', 'ile-de-france', 'boulogne-billancourt', 'saint-denis', '92'];
const cfg = parseConfig(JSON.stringify({ to: 'test@example.org', nom: 'Camille', priorite_lieux: IDF, exclure_titre: ['stagiaire', 'commercial'] }));

const row = (link: string, title: string, location: string, at = '2026-11-20T10:00:00Z', extra: Record<string, unknown> = {}) => ({ link, title, company: 'ASO', location, source: 'LinkedIn (Live 24h)', date_published: '2026-11-20', description: 'Pilotage des bénévoles <b>du Tour</b>.', radar: { run: 'r', at }, ...extra });

describe('créneaux (heure de Paris)', () => {
  test('avant 8 h : pas de créneau ; 9 h → 08 ; 19 h → 18', () => {
    expect(currentSlot(new Date('2026-11-20T06:30:00Z'), [8, 18])).toBe(''); // 7 h 30 à Paris
    expect(currentSlot(new Date('2026-11-20T08:00:00Z'), [8, 18])).toBe('2026-11-20T08'); // 9 h
    expect(currentSlot(new Date('2026-11-20T18:10:00Z'), [8, 18])).toBe('2026-11-20T18'); // 19 h 10
  });
  test("l'heure d'été est respectée", () => {
    expect(currentSlot(new Date('2026-07-01T06:05:00Z'), [8, 18])).toBe('2026-07-01T08');
  });
});

describe('choix et tri des offres', () => {
  test('Paris / IDF en tête, puis France, puis étranger ; exclues et déjà envoyées écartées', () => {
    const board = [
      row('https://x/1', 'Volunteer Manager', 'London, England, United Kingdom'),
      row('https://x/2', 'Chargée de projet événementiel', 'Lyon, Auvergne-Rhône-Alpes, France'),
      row('https://x/3', 'Coordinatrice des bénévoles', 'Boulogne-Billancourt, Île-de-France, France'),
      row('https://x/4', 'Stagiaire événementiel', 'Paris, France'),
      row('https://x/5', 'Chef de projet événementiel', 'Paris, Île-de-France, France'),
      row('https://x/6', 'Responsable événementiel', ''),
    ];
    const state = parseState(JSON.stringify({ sent: { 'https://x/5': '2026-11-19T08:00:00Z' } }));
    const got = pickOffers(board, state, cfg);
    expect(got.map((o) => o.key)).toEqual(['https://x/3', 'https://x/2', 'https://x/6', 'https://x/1']);
    expect(got.map((o) => o.zone)).toEqual(['idf', 'france', 'inconnu', 'etranger']);
  });
  test('le code département seul compte comme IDF, pas un nombre dans un mot', () => {
    expect(zoneOf('Nanterre (92)', '', IDF)).toBe('idf');
    expect(zoneOf('Marseille 13092', '', IDF)).toBe('france');
  });
  test('trouvée avant la fenêtre gardée : jamais renvoyée', () => {
    const got = pickOffers([row('https://x/1', 'Event coordinator', 'Paris', '2026-08-01T00:00:00Z')], parseState(null), cfg, '2026-09-21T00:00:00Z');
    expect(got).toEqual([]);
  });
});

describe('mail', () => {
  test('sujet, groupes, HTML échappé', () => {
    const offers = pickOffers([row('https://x/1', 'Event <Manager>', 'Paris, France'), row('https://x/2', 'Volunteer Manager', 'Dublin, Ireland')], parseState(null), cfg);
    const m = buildMail(offers, cfg, new Date('2026-11-20T08:00:00Z'));
    expect(m.subject).toContain('2 nouvelles offres (1 à Paris / IDF)');
    expect(m.html).toContain('Event &lt;Manager&gt;');
    expect(m.html.indexOf('Paris et Île-de-France')).toBeLessThan(m.html.indexOf('étranger'));
    expect(m.text).toContain('https://x/2');
    const mime = mimeMessage('radar@example.org', 'Radar de Camille', 'test@example.org', m, new Date('2026-11-20T08:00:00Z'));
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('multipart/alternative');
  });
});

describe('clés et transport', () => {
  test('lues par nom, seulement MAIL_/BREVO_/RESEND_', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mail-'));
    writeFileSync(join(dir, 'a.env'), 'ADZUNA_APP_KEY=zzz\nMAIL_SMTP_USER=moi@gmail.com\nMAIL_SMTP_PASS="abcd efgh"\n');
    const env = readEnv([join(dir, 'a.env')], {});
    expect(env).toEqual({ MAIL_SMTP_USER: 'moi@gmail.com', MAIL_SMTP_PASS: 'abcd efgh' });
    expect(chooseTransport(env, 'auto')).toBe('smtp');
    expect(chooseTransport({ BREVO_API_KEY: 'k' }, 'auto')).toBe('brevo');
    expect(chooseTransport({ BREVO_API_KEY: 'k' }, 'resend')).toBeNull();
    expect(chooseTransport({}, 'auto')).toBeNull();
  });
  test('Brevo : requête attendue, erreur HTTP remontée', async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response('{}', { status: 201 });
    };
    const m = { subject: 's', text: 't', html: 'h' };
    await apiSend('brevo', { BREVO_API_KEY: 'k', MAIL_FROM: 'radar@example.org' }, 'test@example.org', 'Radar', m, ok);
    expect(calls[0]!.url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(JSON.parse(calls[0]!.body).to).toEqual([{ email: 'test@example.org' }]);
    const ko = async () => new Response('nope', { status: 401 });
    await expect(apiSend('resend', { RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' }, 'x@y.z', 'R', m, ko)).rejects.toThrow('HTTP 401');
  });
});

/** Un faux serveur SMTP en clair : note les commandes et le message reçu. */
function fakeSmtp(authOk = true): Promise<{ port: number; log: string[]; data: () => string; close: () => void }> {
  const log: string[] = [];
  let data = '';
  const server = createServer((sock) => {
    let inData = false;
    let buf = '';
    let n = 0;
    sock.write('220 faux SMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 OK reçu\r\n');
          } else data += `${line}\n`;
          continue;
        }
        log.push(line.startsWith('AUTH') || /^[A-Za-z0-9+/=]+$/.test(line) ? line.split(' ')[0]! : line);
        n++;
        if (line.startsWith('EHLO')) sock.write('250-faux\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (n === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (n === 4) sock.write(authOk ? '235 OK\r\n' : '535 mauvais mot de passe\r\n');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 OK\r\n');
        else if (line === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      ok({ port, log, data: () => data, close: () => server.close() });
    }),
  );
}

describe('SMTP (faux serveur)', () => {
  test('authentifie puis envoie le message', async () => {
    const srv = await fakeSmtp();
    const env = { MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(srv.port), MAIL_SMTP_TLS: 'none', MAIL_SMTP_USER: 'moi@gmail.com', MAIL_SMTP_PASS: 'secret' };
    await smtpSend(env, 'test@example.org', 'Subject: x\r\n\r\nbonjour\r\n.ligne qui commence par un point\r\n', 5000);
    srv.close();
    expect(srv.log).toEqual(['EHLO radar.local', 'AUTH', 'bW9pQGdtYWlsLmNvbQ==', 'c2VjcmV0', 'MAIL FROM:<moi@gmail.com>', 'RCPT TO:<test@example.org>', 'DATA']);
    expect(srv.data()).toContain('bonjour');
    expect(srv.data()).toContain('..ligne qui commence');
  });
  test('mot de passe refusé : erreur claire', async () => {
    const srv = await fakeSmtp(false);
    const env = { MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(srv.port), MAIL_SMTP_TLS: 'none', MAIL_SMTP_USER: 'u', MAIL_SMTP_PASS: 'p' };
    await expect(smtpSend(env, 'x@y.z', 'Subject: x\r\n\r\nb\r\n', 5000)).rejects.toThrow('535');
    srv.close();
  });
});

describe('mail-vm (bout en bout, faux serveur)', () => {
  test('un mail au créneau, rien ensuite, nouvelle offre au créneau suivant', async () => {
    const career = mkdtempSync(join(tmpdir(), 'cand-'));
    writeFileSync(join(career, 'alertes_mail.json'), JSON.stringify({ to: 'test@example.org', nom: 'Camille', priorite_lieux: IDF }));
    writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([row('https://x/1', 'Volunteer Manager', 'Paris, France')]));
    const srv = await fakeSmtp();
    const env = { MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(srv.port), MAIL_SMTP_TLS: 'none', MAIL_SMTP_USER: 'u@x.fr', MAIL_SMTP_PASS: 'p' };
    const base = { career, envFiles: [], dryRun: false, out: '', force: false };
    expect(await run({ ...base, now: new Date('2026-11-20T06:00:00Z') }, env)).toContain('hors créneau');
    expect(await run({ ...base, now: new Date('2026-11-20T07:05:00Z') }, env)).toContain('envoyé (smtp)');
    expect(await run({ ...base, now: new Date('2026-11-20T07:20:00Z') }, env)).toContain('hors créneau');
    writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([row('https://x/1', 'Volunteer Manager', 'Paris, France'), row('https://x/2', 'Event coordinator', 'Lille, France', '2026-11-20T12:00:00Z')]));
    const second = await run({ ...base, now: new Date('2026-11-20T17:01:00Z') }, env);
    srv.close();
    expect(second).toContain('1 nouvelle offre');
    const state = JSON.parse(readFileSync(join(career, 'mail_alerts.json'), 'utf8'));
    expect(Object.keys(state.sent).sort()).toEqual(['https://x/1', 'https://x/2']);
    expect(state.last_slot).toBe('2026-11-20T18');
  });
  test('sans clés : rien marqué, offres en attente', async () => {
    const career = mkdtempSync(join(tmpdir(), 'cand-'));
    writeFileSync(join(career, 'alertes_mail.json'), JSON.stringify({ to: 'test@example.org' }));
    writeFileSync(join(career, 'pending_gold_jobs.json'), JSON.stringify([row('https://x/1', 'Volunteer Manager', 'Paris')]));
    const out = await run({ career, envFiles: [], dryRun: false, out: '', force: false, now: new Date('2026-11-20T08:00:00Z') }, {});
    expect(out).toContain('pas de clés');
    expect(await run({ career, envFiles: [], dryRun: false, out: '', force: false, now: new Date('2026-11-20T08:20:00Z') }, {})).toContain('pas de clés');
  });
});
