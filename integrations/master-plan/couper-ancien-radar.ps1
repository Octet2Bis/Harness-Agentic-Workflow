<#
.SYNOPSIS
  Coupe (ou remet) le scan d'offres de l'ancien radar, loge dans le bot Telegram de la VM
  (Couper-ancien-radar.cmd sur le Bureau). Decision d'Antoine, 2026-11-11 : « Couper le scan d'offres ».
.DESCRIPTION
  1. Ajoute au bot (telegram_bots_service.js, sur la VM et dans la copie de Master Plan du PC, pour
     qu'un sync_to_vm.ps1 ne l'enleve pas) un interrupteur : le fichier Workspace/career/ancien_radar_coupe
     present => plus de scan d'offres toutes les 15 min. Copie de l'original a cote (.bak).
  2. Verifie la syntaxe (node --check), pose l'interrupteur sur la VM, redemarre une fois telegram-bots
     (pm2), et montre son etat. Syntaxe fausse => l'original est remis, rien n'est redemarre.
  Les trois bots, le scan quotidien des entreprises remote et la commande manuelle de scan restent.
  Retour arriere : -Remettre (enleve l'interrupteur ; le scan reprend en une seconde, sans redemarrage).
  Rapport : Bureau\rapport-ancien-radar.txt (sans l'adresse de la VM).
#>
param([switch] $Remettre, [string] $MasterPlan = "$env:USERPROFILE\Desktop\Master Plan")
$ErrorActionPreference = 'Continue'
$Assistant = Join-Path $MasterPlan '02_Assistant_Personnel'
$PcBot     = Join-Path $Assistant '02_Automatisation\telegram_bots_service.js'
$Patch     = Join-Path $PSScriptRoot 'ancien-radar-interrupteur.cjs'
$SshKey    = Join-Path $env:USERPROFILE '.ssh\oracle_arm_key'
$Report    = Join-Path $env:USERPROFILE 'Desktop\rapport-ancien-radar.txt'
$Remote    = '/home/ubuntu/master-plan-runtime/02_Assistant_Personnel'
$VmBot     = "$Remote/02_Automatisation/telegram_bots_service.js"
$Switch    = "$Remote/Workspace/career/ancien_radar_coupe"
$log = New-Object System.Collections.Generic.List[string]
$VmIp = $env:MASTER_PLAN_VM_IP
if (-not $VmIp) {
  $sync = Join-Path $Assistant '02_Automatisation\sync_to_vm.ps1'
  if (Test-Path $sync) { $m = Select-String -Path $sync -Pattern '^\s*\$VmIp\s*=\s*"([^"]+)"' | Select-Object -First 1; if ($m) { $VmIp = $m.Matches[0].Groups[1].Value } }
}
function Save { $text = $log -join "`r`n"; if ($VmIp) { $text = $text.Replace($VmIp, '<VM>') }; Set-Content -Path $Report -Value $text -Encoding UTF8 }
function Say([string] $msg) { Write-Host $msg -ForegroundColor Cyan; $log.Add("== $msg") }
function Note([string[]] $lines) { foreach ($l in $lines) { $s = "$l"; if ($VmIp) { $s = $s.Replace($VmIp, '<VM>') }; Write-Host $s; $log.Add($s) } }
function Fail([string] $msg) { Write-Host $msg -ForegroundColor Red; $log.Add("ECHEC : $msg"); Save; Read-Host 'Entree pour fermer'; exit 1 }

if (-not $VmIp) { Fail 'Adresse de la VM introuvable (sync_to_vm.ps1 ou MASTER_PLAN_VM_IP).' }
if (-not (Test-Path $SshKey)) { Fail "Cle SSH introuvable : $SshKey" }
$opts = @('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', '-i', $SshKey)
function Vm([string] $cmd) { ssh @opts "ubuntu@$VmIp" $cmd 2>&1 | ForEach-Object { "$_" } }

if ($Remettre) {
  Say 'Remise du scan d''offres de l''ancien radar'
  Note (Vm "rm -f $Switch && echo 'interrupteur enleve : le scan reprend (toutes les 15 min)'")
  Save; Read-Host 'TERMINE. Entree pour fermer'; exit 0
}

Say '1/4 La VM repond-elle ?'
$probe = Vm "echo ok; test -f $VmBot && echo bot-present; pm2 describe telegram-bots 2>/dev/null | grep -E 'status' | head -1"
Note $probe
if (($probe | Select-Object -First 1) -ne 'ok') { Fail 'La VM ne repond pas en SSH (allumee ? cle ?).' }
if (-not ($probe -contains 'bot-present')) { Fail "Bot introuvable sur la VM : $VmBot" }

Say '2/4 Copie de Master Plan sur le PC (pour qu''un sync_to_vm ne l''enleve pas)'
$bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
if ((Test-Path $PcBot) -and (Test-Path $bun)) { Note (& $bun $Patch $PcBot 2>&1 | ForEach-Object { "$_" }) }
else { Note 'copie du PC ou bun absent : seule la VM est modifiee (ne pas relancer sync_to_vm.ps1 avant de me le dire)' }

Say '3/4 Interrupteur sur la VM'
scp @opts $Patch "ubuntu@${VmIp}:/tmp/ancien-radar-interrupteur.cjs"
if ($LASTEXITCODE -ne 0) { Fail 'scp a echoue.' }
$patched = Vm "node /tmp/ancien-radar-interrupteur.cjs $VmBot && node --check $VmBot && echo syntaxe-ok"
Note $patched
if (-not ($patched -contains 'syntaxe-ok')) {
  Note (Vm "test -f $VmBot.avant-interrupteur-ancien-radar.bak && cp $VmBot.avant-interrupteur-ancien-radar.bak $VmBot && echo 'original remis'")
  Fail 'Le bot n''a pas pu etre modifie proprement : original remis, rien redemarre.'
}
Note (Vm "touch $Switch && echo 'interrupteur pose : ancien_radar_coupe'")

Say '4/4 Redemarrage du bot (une fois) et etat'
Note (Vm "pm2 restart telegram-bots >/dev/null && sleep 10 && pm2 describe telegram-bots | grep -E 'status|restarts|uptime' | head -3 && pm2 logs telegram-bots --lines 12 --nostream --raw 2>&1 | grep -E 'JOB_RADAR|REMOTE_SCANNER|FATAL|Error|DAEMON' | tail -6")
$log.Add('Retour arriere : powershell -File integrations\master-plan\couper-ancien-radar.ps1 -Remettre')
Save
Read-Host 'TERMINE (rapport : Bureau\rapport-ancien-radar.txt). Entree pour fermer'
