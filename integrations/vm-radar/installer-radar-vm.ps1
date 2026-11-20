<#
.SYNOPSIS
  Installe ou met a jour le radar unifie sur la VM, en un double-clic (Installer-radar-VM.cmd).
  Idempotent : relance-le apres chaque mise a jour du harness.
.DESCRIPTION
  1. Verifie la cle SSH, la VM et le modele local.
  2. Empaquette le harness de ce PC (.archon, integrations ; jamais .local) et la graine du dossier
     carriere (tableau, tris, reglages du radar ; jamais master_profile.md ni applications/).
  3. Envoie le tout dans ~/radar-unifie sur la VM, avec les cles : le fichier
     .local\secrets.env du harness est copie tel quel (scp), jamais lu ni affiche.
  4. Lance install-vm.sh sur la VM (service a part, cron toutes les 15 min, premier cycle de 3 offres).
     Le bot Telegram, l'ancien radar et ~/master-plan-runtime ne sont pas touches.
  5. Rapatrie le premier resultat sur le PC (pull_radar_vm.ps1).
  Rapport : Bureau\rapport-radar-vm.txt (sans l'adresse de la VM).
#>
param([string] $CareerDir = '')
$ErrorActionPreference = 'Continue'
$Harness   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Tout vient du harness depuis la migration du 2026-11-13 : données dans .local\career, clés dans .local\secrets.env.
$Career    = if ($CareerDir) { $CareerDir } else { Join-Path $Harness '.local\career' }
$Secrets   = Join-Path $Harness '.local\secrets.env'
$SshKey    = Join-Path $env:USERPROFILE '.ssh\oracle_arm_key'
$Report    = Join-Path $env:USERPROFILE 'Desktop\rapport-radar-vm.txt'
$Work      = Join-Path ([System.IO.Path]::GetTempPath()) 'radar-vm-install'
$Root      = '/home/ubuntu/radar-unifie'
$log = New-Object System.Collections.Generic.List[string]
# L'adresse de la VM : $env:MASTER_PLAN_VM_IP, sinon .local\vm.json du harness (écrit par la migration, jamais versionné).
$VmIp = $env:MASTER_PLAN_VM_IP
$VmFile = Join-Path $Harness '.local\vm.json'
if (-not $VmIp -and (Test-Path $VmFile)) { try { $VmIp = (Get-Content $VmFile -Raw | ConvertFrom-Json).ip } catch { } }

function Save { $text = $log -join "`r`n"; if ($VmIp) { $text = $text.Replace($VmIp, '<VM>') }; Set-Content -Path $Report -Value $text -Encoding UTF8 }
function Say([string] $msg) { Write-Host $msg -ForegroundColor Cyan; $log.Add("== $msg") }
function Note([string[]] $lines) { foreach ($l in $lines) { $s = "$l"; if ($VmIp) { $s = $s.Replace($VmIp, '<VM>') }; Write-Host $s; $log.Add($s) } }
function Fail([string] $msg) { Write-Host $msg -ForegroundColor Red; $log.Add("ECHEC : $msg"); Save; Read-Host 'Entree pour fermer'; exit 1 }

if (-not $VmIp) { Fail 'Adresse de la VM introuvable : .local\vm.json absent (lance Migrer-vers-Harness) ou MASTER_PLAN_VM_IP.' }
if (-not (Test-Path $SshKey)) { Fail "Cle SSH introuvable : $SshKey" }
if (-not (Test-Path (Join-Path $Harness 'integrations\vm-radar\radar-vm.ts'))) { Fail "Harness incomplet : $Harness" }
if (-not (Test-Path (Join-Path $Career 'pending_gold_jobs.json'))) { Fail "Dossier carriere introuvable : $Career" }
$opts = @('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'LogLevel=ERROR', '-i', $SshKey)
function Vm([string] $cmd) { ssh @opts "ubuntu@$VmIp" $cmd 2>&1 | ForEach-Object { "$_" } }

Say '1/5 La VM repond-elle ?'
$probe = Vm "echo ok; df -h /home/ubuntu | tail -1; free -m | sed -n 2p; (ollama list 2>/dev/null | grep -i qwen) || echo 'pas de modele qwen'"
Note $probe
if (($probe | Select-Object -First 1) -ne 'ok') { Fail 'La VM ne repond pas en SSH (allumee ? cle ?).' }

Say '2/5 Paquets du harness et de la graine carriere'
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$seed = @('pending_gold_jobs.json', 'triage', 'postings', 'triage_local', 'criteres.json', 'career_taxonomy.json', 'job_sources.json', 'source_state.json', 'radar_universe.json', 'radar_boards_learned.json', 'linkedin_cursor_state.json') | Where-Object { Test-Path (Join-Path $Career $_) }
# Chemins d'archive relatifs : un tar GNU lirait « C: » comme un hote distant.
Push-Location $Work
try {
  tar --exclude=.local --exclude=node_modules -czf harness.tgz -C "$Harness" .archon integrations
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Paquet du harness impossible.' }
  tar -czf seed.tgz -C "$Career" @seed
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Paquet de la graine impossible.' }
  # Les autres candidats du radar de la VM (alertes mail) : chaque .local\career-<id> dont candidat.json dit "vm": true.
  # Seulement leurs reglages et leur tableau ; jamais master_profile.md ni applications\.
  $candFiles = @()
  foreach ($d in (Get-ChildItem -Directory (Join-Path $Harness '.local') -Filter 'career-*' -ErrorAction SilentlyContinue)) {
    $cj = Join-Path $d.FullName 'candidat.json'
    $isVm = $false
    if (Test-Path $cj) { try { $isVm = [bool]((Get-Content $cj -Raw | ConvertFrom-Json).vm) } catch { } }
    if (-not $isVm) { continue }
    foreach ($f in @('candidat.json', 'criteres.json', 'career_taxonomy.json', 'job_sources.json', 'alertes_mail.json', 'pending_gold_jobs.json')) {
      if (Test-Path (Join-Path $d.FullName $f)) { $candFiles += "$($d.Name)/$f" }
    }
  }
  if ($candFiles.Count -gt 0) {
    tar -czf candidats.tgz -C (Join-Path $Harness '.local') @candFiles
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Paquet des autres candidats impossible.' }
  }
} finally { Pop-Location }
Note @("harness : $([math]::Round((Get-Item (Join-Path $Work 'harness.tgz')).Length / 1MB, 1)) Mo", "graine : $($seed -join ', ') ($([math]::Round((Get-Item (Join-Path $Work 'seed.tgz')).Length / 1MB, 1)) Mo)")
$candNames = @($candFiles | ForEach-Object { ($_ -split '/')[0] -replace '^career-', '' } | Select-Object -Unique)
Note "autres candidats (alertes mail) : $(if ($candNames.Count) { $candNames -join ', ' } else { 'aucun' })"

Say '3/5 Envoi sur la VM (~/radar-unifie)'
Note (Vm "mkdir -p $Root && rm -rf $Root/harness.new $Root/career.seed $Root/candidats.seed && mkdir -p $Root/harness.new $Root/career.seed && echo pret")
$packs = @((Join-Path $Work 'harness.tgz'), (Join-Path $Work 'seed.tgz'))
if (Test-Path (Join-Path $Work 'candidats.tgz')) { $packs += (Join-Path $Work 'candidats.tgz') }
scp @opts @packs "ubuntu@${VmIp}:$Root/"
if ($LASTEXITCODE -ne 0) { Fail 'scp a echoue (paquets).' }
# Toutes les cles (radar et bot du radar) : .local\secrets.env du harness, jamais versionne, copie tel quel.
if (Test-Path $Secrets) {
  scp @opts "$Secrets" "ubuntu@${VmIp}:$Root/secrets.env"
  if ($LASTEXITCODE -ne 0) { Fail 'scp a echoue (cles).' }
  Note 'cles : .local\secrets.env du harness copie tel quel dans ~/radar-unifie/secrets.env (jamais affiche)'
} else {
  Note 'cles : .local\secrets.env absent, la VM garde ses cles actuelles'
}
Note (Vm "cd $Root && tar xzf harness.tgz -C harness.new && tar xzf seed.tgz -C career.seed && (if [ -f candidats.tgz ]; then mkdir -p candidats.seed && tar xzf candidats.tgz -C candidats.seed; fi) && rm -f harness.tgz seed.tgz candidats.tgz && cp harness.new/integrations/vm-radar/install-vm.sh install-vm.sh && sed -i 's/\r$//' install-vm.sh && echo deballe")

Say '4/5 Installation et premier cycle (quelques minutes : toutes les sources, puis 3 offres triees par le 7B)'
$install = Vm "bash $Root/install-vm.sh"
Note $install
if (-not ($install -match '^== fin')) { Fail "install-vm.sh n'est pas alle au bout (voir le rapport)." }

Say '5/5 Premier rapatriement sur le PC'
# Sans 2>&1 : le script tourne en mode Stop, une ligne d'erreur d'ssh redirigee l'arreterait.
try { Note (& (Join-Path $PSScriptRoot 'pull_radar_vm.ps1') -CareerDir $Career | ForEach-Object { "$_" }); Note 'rapatriement : ok' } catch { Note "rapatriement : $($_.Exception.Message)" }
Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
$log.Add('TERMINE')
Save
Write-Host 'Termine. Rapport sur le Bureau : rapport-radar-vm.txt. Dis-le a Claude dans le fil.' -ForegroundColor Green
Read-Host 'Entree pour fermer'
