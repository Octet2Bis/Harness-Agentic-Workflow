// Ajoute au bot Telegram (telegram_bots_service.js) un interrupteur pour l'ancien radar :
// le fichier Workspace/career/ancien_radar_coupe present => plus de scan d'offres toutes les 15 min
// (live_job_scraper.autoScanAndNotify). Le scan quotidien des entreprises remote, les trois bots et la
// commande manuelle de scan restent. Decision d'Antoine, 2026-11-11 : « Couper le scan d'offres ».
// Usage : node ancien-radar-interrupteur.cjs <chemin de telegram_bots_service.js>
// Idempotent ; ligne introuvable => rien n'est change ; copie de l'original a cote (.bak).
const fs = require('node:fs');
const file = process.argv[2];
const OLD = 'if (now - lastJobScanAt >= 15 * 60 * 1000) {';
const NEW = "if (now - lastJobScanAt >= 15 * 60 * 1000 && !fs.existsSync(path.join(CAREER_DIR, 'ancien_radar_coupe'))) {";
if (!file || !fs.existsSync(file)) { console.error(`fichier introuvable : ${file}`); process.exit(1); }
const s = fs.readFileSync(file, 'utf8');
if (s.includes(NEW)) { console.log('interrupteur deja en place'); process.exit(0); }
const n = s.split(OLD).length - 1;
if (n !== 1) { console.error(`ligne du scan trouvee ${n} fois (1 attendue) : rien n'est change`); process.exit(1); }
const bak = `${file}.avant-interrupteur-ancien-radar.bak`;
if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
fs.writeFileSync(file, s.replace(OLD, NEW));
console.log(`interrupteur ajoute (original : ${bak})`);
