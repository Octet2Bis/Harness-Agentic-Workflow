#!/usr/bin/env bash
# install-vm.sh : installe ou met à jour le radar unifié sur la VM (idempotent). Lancé par
# installer-radar-vm.ps1 depuis le PC, après l'envoi du harness et du dossier carrière.
# Service à part : ~/radar-unifie, une ligne cron à lui, rien d'autre. Le bot Telegram (pm2),
# l'ancien radar et ~/master-plan-runtime ne sont pas touchés (l'ancien tableau est lu seulement).
set -euo pipefail
ROOT="$HOME/radar-unifie"
HARNESS="$ROOT/harness"
CAREER="$ROOT/career"
OLD_BOARD="$HOME/master-plan-runtime/02_Assistant_Personnel/Workspace/career/pending_gold_jobs.json"
MODEL="${RADAR_MODEL:-qwen2.5:7b-instruct-q4_0}"
mkdir -p "$ROOT/runs" "$ROOT/logs" "$CAREER"

echo "== bun"
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  if command -v unzip >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash >/dev/null
  else
    # Sans unzip (l'installeur officiel en a besoin) : l'archive de la release, ouverte par python3.
    case "$(uname -m)" in aarch64|arm64) ARCH=aarch64 ;; *) ARCH=x64 ;; esac
    mkdir -p "$HOME/.bun/bin"
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-$ARCH.zip"
    python3 -c "import sys, zipfile; z = zipfile.ZipFile('/tmp/bun.zip'); open(sys.argv[1], 'wb').write(z.read('bun-linux-$ARCH/bun'))" "$HOME/.bun/bin/bun"
    chmod +x "$HOME/.bun/bin/bun"; rm -f /tmp/bun.zip
  fi
fi
BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"
"$BUN" --version

echo "== harness"
if [ -d "$ROOT/harness.new" ]; then
  rm -rf "$ROOT/harness.old"
  if [ -d "$HARNESS" ]; then mv "$HARNESS" "$ROOT/harness.old"; fi
  mv "$ROOT/harness.new" "$HARNESS"
fi
test -f "$HARNESS/integrations/vm-radar/radar-vm.ts" || { echo "harness absent de $HARNESS"; exit 1; }
echo "ok : $HARNESS"

echo "== dossier carrière (graine du PC, une seule fois : ensuite la VM écrit son propre tableau)"
if [ -d "$ROOT/career.seed" ]; then
  if [ ! -f "$CAREER/pending_gold_jobs.json" ]; then cp -a "$ROOT/career.seed/." "$CAREER/"; echo "graine copiée"; else
    # Déjà en service : seuls les réglages du candidat sont repris du PC.
    for f in criteres.json career_taxonomy.json job_sources.json; do [ -f "$ROOT/career.seed/$f" ] && cp "$ROOT/career.seed/$f" "$CAREER/$f"; done
    echo "réglages repris (tableau de la VM gardé)"
  fi
  rm -rf "$ROOT/career.seed"
fi
ls "$CAREER" | head -20

echo "== autres candidats (alertes mail seulement, sans tri ni Claude : un dossier chacun dans ~/radar-unifie/candidats)"
mkdir -p "$ROOT/candidats"
if [ -d "$ROOT/candidats.seed" ]; then
  for d in "$ROOT"/candidats.seed/career-*; do
    [ -d "$d" ] || continue
    id="${d##*/career-}"
    dest="$ROOT/candidats/$id"
    mkdir -p "$dest"
    if [ ! -f "$dest/pending_gold_jobs.json" ]; then cp -a "$d/." "$dest/"; echo "$id : dossier créé"; else
      # Déjà en service : seuls ses réglages sont repris du PC (son tableau et ses envois restent ceux de la VM).
      for f in candidat.json criteres.json career_taxonomy.json job_sources.json alertes_mail.json; do [ -f "$d/$f" ] && cp "$d/$f" "$dest/$f"; done
      echo "$id : réglages repris"
    fi
  done
  rm -rf "$ROOT/candidats.seed"
fi
ls "$ROOT/candidats"

echo "== clés (lues par nom, jamais affichées)"
if [ -f "$ROOT/secrets.env" ]; then chmod 600 "$ROOT/secrets.env"; echo "secrets.env présent ($(grep -c '=' "$ROOT/secrets.env") ligne(s))"; else echo "pas de secrets.env : les sources à clé seront « clé absente »"; fi

echo "== modèle local"
if command -v ollama >/dev/null 2>&1; then
  ollama list | grep -q "$MODEL" || ollama pull "$MODEL" >/dev/null
  ollama list | grep "$MODEL" || echo "modèle $MODEL absent"
else echo "ollama absent : le tri retombera sur les règles"; fi

echo "== cycle (cron toutes les 15 min, un seul à la fois)"
cat > "$ROOT/cycle.sh" <<CYCLE
#!/usr/bin/env bash
# Un cycle du radar unifié (radar-vm.ts) ; flock : jamais deux à la fois ; journal gardé court.
cd "$HARNESS" || exit 1
ENV_ARGS=()
[ -f "$ROOT/secrets.env" ] && ENV_ARGS=(--env-file "$ROOT/secrets.env")
LOG="$ROOT/logs/cycle.log"
flock -n "$ROOT/cycle.lock" "$BUN" "$HARNESS/integrations/vm-radar/radar-vm.ts" --career "$CAREER" --old-board "$OLD_BOARD" --model "$MODEL" "\${ENV_ARGS[@]}" "\$@" >> "\$LOG" 2>&1
code=\$?
# Alertes Telegram du bot du radar (bot à part ; coupées sans jeton RADAR_BOT_TOKEN ni /start) : verrou à part, jamais deux envois.
ALERT_ARGS=("\${ENV_ARGS[@]}")
[ -f "$ROOT/secrets-harness.env" ] && ALERT_ARGS+=(--env-file "$ROOT/secrets-harness.env")
flock -n "$ROOT/alerts.lock" "$BUN" "$HARNESS/integrations/telegram-radar/alert-vm.ts" --career "$CAREER" "\${ALERT_ARGS[@]}" >> "\$LOG" 2>&1 || true
# Signaux d'entreprises (integrations/company-signals, sans Claude) : verrou à part, ses propres cadences (actualité 2 h, YC 24 h…).
flock -n "$ROOT/signals.lock" "$BUN" "$HARNESS/integrations/company-signals/signals-vm.ts" --career "$CAREER" "\${ENV_ARGS[@]}" >> "\$LOG" 2>&1 || true
tail -n 2000 "\$LOG" > "\$LOG.tmp" && mv "\$LOG.tmp" "\$LOG"
# Les autres candidats (integrations/mail-radar) : leur radar sans tri (règles du crible seulement),
# puis le mail récapitulatif aux heures de leur alertes_mail.json. Un verrou et un journal chacun.
for C in "$ROOT"/candidats/*/; do
  C="\${C%/}"; ID="\${C##*/}"
  [ -f "\$C/candidat.json" ] || continue
  CLOG="$ROOT/logs/\$ID.log"
  flock -n "$ROOT/radar-\$ID.lock" "$BUN" "$HARNESS/integrations/vm-radar/radar-vm.ts" --career "\$C" --work "$ROOT/runs-\$ID" --no-triage --keep-runs 10 "\${ENV_ARGS[@]}" >> "\$CLOG" 2>&1 || true
  flock -n "$ROOT/mail-\$ID.lock" "$BUN" "$HARNESS/integrations/mail-radar/mail-vm.ts" --career "\$C" "\${ALERT_ARGS[@]}" >> "\$CLOG" 2>&1 || true
  tail -n 2000 "\$CLOG" > "\$CLOG.tmp" && mv "\$CLOG.tmp" "\$CLOG"
done
exit \$code
CYCLE
chmod +x "$ROOT/cycle.sh"
# Pas de cron sur l'image Oracle minimale : on l'installe (sudo sans mot de passe), sinon une boucle en tâche de fond.
if ! command -v crontab >/dev/null 2>&1; then sudo -n apt-get install -y -qq cron >/dev/null 2>&1 && sudo -n systemctl enable --now cron >/dev/null 2>&1 || true; fi
if command -v crontab >/dev/null 2>&1; then
  ( crontab -l 2>/dev/null | grep -v 'radar-unifie/cycle.sh' || true; echo "*/15 * * * * $ROOT/cycle.sh" ) | crontab -
  crontab -l | grep 'radar-unifie/cycle.sh'
else
  pkill -f '^bash /home/ubuntu/radar-unifie/loop.sh' || true
  printf '#!/usr/bin/env bash\nwhile true; do %s/cycle.sh; sleep 900; done\n' "$ROOT" > "$ROOT/loop.sh"
  setsid nohup bash "$ROOT/loop.sh" > /dev/null 2>&1 < /dev/null &
  echo "pas de cron : boucle en tâche de fond (à relancer après un redémarrage de la VM)"
fi

echo "== signaux d'entreprises : essai de chaque source depuis la VM"
SIG_ENV=()
[ -f "$ROOT/secrets.env" ] && SIG_ENV=(--env-file "$ROOT/secrets.env")
"$BUN" "$HARNESS/integrations/company-signals/signals-vm.ts" --career "$CAREER" --probe "${SIG_ENV[@]}" || echo "essai des signaux impossible"

echo "== premier cycle (3 offres au plus)"
"$ROOT/cycle.sh" --max-triage 3 || true
tail -n 3 "$ROOT/logs/cycle.log"
for C in "$ROOT"/candidats/*/; do [ -f "$C/candidat.json" ] || continue; ID="$(basename "$C")"; echo "-- $ID"; tail -n 3 "$ROOT/logs/$ID.log" 2>/dev/null || true; done
echo "== fin"
