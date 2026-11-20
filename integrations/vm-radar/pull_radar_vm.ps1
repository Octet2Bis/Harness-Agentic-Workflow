<#
.SYNOPSIS
  Rapatrie sur le PC ce que le radar unifié de la VM a produit (~/radar-unifie/career) :
  tableau (fusionné offre par offre), tris du modèle local, annonces lues, état du cycle.
  Appelé à la fin de sync_pending.ps1 -Direction pull (le rafraîchissement du cockpit, toutes
  les 5 minutes) ; sans radar unifié sur la VM, ne fait rien.
.DESCRIPTION
  1. Les réglages du candidat partent du PC (source de vérité) vers la VM : criteres.json,
     career_taxonomy.json, job_sources.json (un changement de critères fait retrier la VM), et
     entreprises_full_remote.json s'il existe (entreprises suivies à la main), et tes avis de l'onglet
     Signaux (signals_feedback.json : la VM en tire les directions).
  2. Sur la VM, un paquet : le tableau, l'état, les entreprises full remote et leurs postes
     (remote_companies.json, remote_company_jobs.json), les signaux d'entreprises (company_signals.json,
     signals_status.json), et les tris / annonces / questions modifiés
     depuis le dernier rapatriement (marque vm_radar_pull.json du PC, heure de la VM ; tout la première fois).
  3. scp du paquet, extraction dans un dossier temporaire, merge_radar_vm.ts (sous le verrou
     du tableau du PC). Rien d'autre : pas de .secrets, pas de pm2, l'ancien radar non touché.
.NOTES
  L'adresse de la VM vient de $env:MASTER_PLAN_VM_IP, sinon de la ligne $VmIp de sync_to_vm.ps1.
#>
param(
  # Le dossier carrière : celui du harness (.local\career, migré de Master Plan le 2026-11-13).
  [string] $CareerDir = ''
)
$ErrorActionPreference = 'Stop'
$Harness      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalCareer  = if ($CareerDir) { $CareerDir } else { Join-Path $Harness '.local\career' }
$SshKey       = Join-Path $env:USERPROFILE '.ssh\oracle_arm_key'
$Remote       = '/home/ubuntu/radar-unifie/career'
$Merge        = Join-Path $PSScriptRoot 'merge_radar_vm.ts'
$Mark         = Join-Path $LocalCareer 'vm_radar_pull.json'
$Work         = Join-Path ([System.IO.Path]::GetTempPath()) 'radar-vm-pull'
# L'adresse de la VM : $env:MASTER_PLAN_VM_IP, sinon .local\vm.json du harness (écrit par la migration, jamais versionné).
$VmIp = $env:MASTER_PLAN_VM_IP
$VmFile = Join-Path $Harness '.local\vm.json'
if (-not $VmIp -and (Test-Path $VmFile)) { try { $VmIp = (Get-Content $VmFile -Raw | ConvertFrom-Json).ip } catch { } }
if (-not $VmIp) { throw 'Adresse de la VM introuvable : définir MASTER_PLAN_VM_IP.' }
$opts = @('-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15', '-i', $SshKey)

$Root = '/home/ubuntu/radar-unifie'
$present = ssh @opts "ubuntu@$VmIp" "test -f $Remote/pending_gold_jobs.json && mkdir -p $Root/incoming && echo oui"
if ($present -ne 'oui') { Write-Host 'Radar unifié absent de la VM : rien à rapatrier.'; exit 0 }

# 1. Les réglages du PC vers la VM : déposés à côté, puis mis en place d'un coup (mv) s'ils ont changé,
#    pour qu'un cycle en cours ne lise jamais un fichier à moitié écrit.
$conf = @('criteres.json', 'career_taxonomy.json', 'job_sources.json', 'entreprises_full_remote.json', 'radar_bot.json', 'signals_feedback.json') | ForEach-Object { Join-Path $LocalCareer $_ } | Where-Object { Test-Path $_ }
if ($conf.Count -gt 0) {
  scp @opts @conf "ubuntu@${VmIp}:$Root/incoming/"
  if ($LASTEXITCODE -ne 0) { throw 'scp a échoué (réglages vers la VM).' }
}

# 2. Le paquet sur la VM : tableau, état, et ce qui a changé depuis la dernière marque (10 min de marge).
$since = 0
if (Test-Path $Mark) { try { $since = [int64] (Get-Content $Mark -Raw | ConvertFrom-Json).vm_epoch } catch { $since = 0 } }
$find = if ($since -gt 0) { "-newermt @$($since - 600)" } else { '' }
# Pas de guillemets doubles dans la commande distante : PowerShell 5.1 les passe mal à ssh.exe.
$remoteCmd = "for f in $Root/incoming/*; do [ -f `$f ] || continue; if cmp -s `$f $Remote/`$(basename `$f); then rm -f `$f; else mv -f `$f $Remote/; fi; done; " +
  "cd $Remote && now=`$(date -u +%s) && { echo pending_gold_jobs.json; [ -f vm_radar_status.json ] && echo vm_radar_status.json; ls remote_companies.json remote_company_jobs.json company_signals.json signals_status.json 2>/dev/null; find triage postings triage_local -type f $find 2>/dev/null; } | tar czf /tmp/radar-pull.tgz -T - && echo `$now"
$vmEpoch = ssh @opts "ubuntu@$VmIp" $remoteCmd | Select-Object -Last 1
if ($LASTEXITCODE -ne 0 -or -not ($vmEpoch -match '^\d+$')) { throw 'Paquet impossible sur la VM.' }

# 3. Rapatriement et fusion (sous le verrou du tableau du PC).
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force -Path (Join-Path $Work 'x') | Out-Null
scp @opts "ubuntu@${VmIp}:/tmp/radar-pull.tgz" (Join-Path $Work 'radar-pull.tgz')
if ($LASTEXITCODE -ne 0) { throw 'scp a échoué (paquet du radar).' }
# Chemins relatifs : un tar GNU (Git pour Windows) lirait « C: » comme un hôte distant.
Push-Location $Work
try { tar -xzf radar-pull.tgz -C x } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Extraction du paquet impossible.' }
bun $Merge "$LocalCareer" (Join-Path $Work 'x')
if ($LASTEXITCODE -ne 0) { throw 'Fusion impossible : la copie du PC est restée telle quelle.' }
@{ vm_epoch = [int64] $vmEpoch; pc_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') } | ConvertTo-Json | Set-Content -Path $Mark -Encoding UTF8
Remove-Item -Recurse -Force $Work
Write-Host 'OK (radar unifié).'
