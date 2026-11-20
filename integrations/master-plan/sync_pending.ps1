<#
.SYNOPSIS
  Aller-retour de Workspace/career entre le PC et la VM Oracle, autour d'un tour de career-listener.
  Mêmes scp que pull_from_vm.ps1 / sync_to_vm.ps1 ; rien d'autre (pas de .secrets, pas de pm2).
.DESCRIPTION
  pending_gold_jobs.json n'est jamais écrasé d'un côté par l'autre : les deux copies sont
  fusionnées offre par offre par merge_pending.ts (règle mergeBoards, testée dans
  .archon/workflows/systems/.shared/pending.test.ts). Le PC garde les statuts que le harness
  écrit (un statut posé après un go donné entre deux tours n'est plus perdu), la VM apporte
  ce que le bot écrit (/valider, nouvelles offres).
  `archon trigger fire` rend la main dès que le run du listener est lancé : appelé juste
  après, `push` tourne PENDANT le tour, en même temps que claim, load, record, close et
  settle. merge_pending.ts relit, fusionne et réécrit la copie du PC sous le verrou du tableau
  (pending_gold_jobs.json.lock), que chacun de ces écrivains prend aussi : rien n'est perdu ;
  un statut écrit après la fusion part au push suivant.
.PARAMETER Direction
  pull : VM -> PC (avant le fire).  push : PC -> VM (juste après le fire, donc pendant le
  tour : statuts déjà écrits + applications/).
.NOTES
  L'adresse de la VM vient de $env:MASTER_PLAN_VM_IP, sinon de la ligne $VmIp de sync_to_vm.ps1.
#>
param(
  [ValidateSet('pull', 'push')] [string] $Direction = 'pull',
  # Le dossier carrière : celui du harness (.local\career, migré de Master Plan le 2026-11-13).
  [string] $CareerDir = ''
)
$ErrorActionPreference = 'Stop'
$Harness      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalCareer  = if ($CareerDir) { $CareerDir } else { Join-Path $Harness '.local\career' }
$SshKey       = Join-Path $env:USERPROFILE '.ssh\oracle_arm_key'
$RemoteDir    = '/home/ubuntu/master-plan-runtime/02_Assistant_Personnel/Workspace'
$Merge        = Join-Path $PSScriptRoot 'merge_pending.ts'
$Board        = Join-Path $LocalCareer 'pending_gold_jobs.json'
# Copies de travail hors de Workspace/career : rien de temporaire n'y traîne ni n'est poussé.
$VmCopy       = Join-Path ([System.IO.Path]::GetTempPath()) 'pending_gold_jobs.vm.json'
$PushCopy     = Join-Path ([System.IO.Path]::GetTempPath()) 'pending_gold_jobs.push.json'

# L'adresse de la VM : $env:MASTER_PLAN_VM_IP, sinon .local\vm.json du harness (écrit par la migration, jamais versionné).
$VmIp = $env:MASTER_PLAN_VM_IP
$VmFile = Join-Path $Harness '.local\vm.json'
if (-not $VmIp -and (Test-Path $VmFile)) { try { $VmIp = (Get-Content $VmFile -Raw | ConvertFrom-Json).ip } catch { } }
if (-not $VmIp)              { throw 'Adresse de la VM introuvable : .local\vm.json absent (lance Migrer-vers-Harness) ou MASTER_PLAN_VM_IP.' }
if (-not (Test-Path $SshKey)) { throw "Clé SSH introuvable : $SshKey" }
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'bun introuvable sur le PATH : la fusion de pending_gold_jobs.json en a besoin.' }
New-Item -ItemType Directory -Force -Path $LocalCareer | Out-Null

$scpOpts = @('-o', 'StrictHostKeyChecking=no', '-i', $SshKey)

# La copie de la VM, relue à l'instant, dans un fichier de travail (jamais directement sur celle du PC).
function Get-VmBoard {
  if (Test-Path $VmCopy) { Remove-Item -Force $VmCopy }
  scp @scpOpts "ubuntu@${VmIp}:${RemoteDir}/career/pending_gold_jobs.json" "$VmCopy"
  if ($LASTEXITCODE -ne 0) { throw "scp a échoué ($Direction : lecture de pending_gold_jobs.json sur la VM)." }
}

switch ($Direction) {
  'pull' {
    Write-Host "VM -> PC : Workspace/career (pending_gold_jobs.json fusionné offre par offre)"
    Get-VmBoard
    bun $Merge pull "$Board" "$VmCopy"
    if ($LASTEXITCODE -ne 0) { throw 'Fusion impossible (pull) : la copie du PC est restée telle quelle.' }
    Remove-Item -Force $VmCopy
    try { scp @scpOpts "ubuntu@${VmIp}:${RemoteDir}/career/remarques_utilisateur.txt" "$LocalCareer\" 2>$null } catch { }
    # Le radar unifié de la VM (integrations/vm-radar, 2026-11-08) : son tableau, ses tris et ses annonces.
    # Une panne ici ne casse pas le rafraîchissement habituel : elle est seulement dite.
    $RadarPull = Join-Path $PSScriptRoot '..\vm-radar\pull_radar_vm.ps1'
    if (Test-Path $RadarPull) {
      try { & $RadarPull -CareerDir $LocalCareer } catch { Write-Host "Radar unifié de la VM : $($_.Exception.Message)" }
    }
  }
  'push' {
    Write-Host "PC -> VM : statuts (fusionnés avec la copie de la VM relue à l'instant) + applications/"
    # Relire la VM juste avant d'envoyer : un /valider fait pendant le tour n'est pas écrasé.
    # La fusion prend le verrou du tableau : le tour qui tourne en ce moment ne perd aucune écriture.
    Get-VmBoard
    bun $Merge push "$Board" "$VmCopy" "$PushCopy"
    if ($LASTEXITCODE -ne 0) { throw 'Fusion impossible (push) : rien n''a été envoyé.' }
    scp @scpOpts "$PushCopy" "ubuntu@${VmIp}:${RemoteDir}/career/pending_gold_jobs.json"
    if ($LASTEXITCODE -ne 0) { throw 'scp a échoué (push : pending_gold_jobs.json).' }
    Remove-Item -Force $VmCopy, $PushCopy
    try { scp @scpOpts "$LocalCareer\applications_log.csv" "ubuntu@${VmIp}:${RemoteDir}/career/" 2>$null } catch { }
    if (Test-Path "$LocalCareer\applications") {
      scp @scpOpts -r "$LocalCareer\applications" "ubuntu@${VmIp}:${RemoteDir}/career/"
      if ($LASTEXITCODE -ne 0) { throw 'scp a échoué (push : applications/).' }
    }
  }
}
Write-Host "OK ($Direction)."
