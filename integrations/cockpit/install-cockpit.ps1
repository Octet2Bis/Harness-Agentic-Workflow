<#
.SYNOPSIS
  Le cockpit toujours prêt : une tâche planifiée « Cockpit candidatures » le démarre à
  l'ouverture de session Windows, sans fenêtre, et l'icône « Cockpit » du Bureau (cockpit-launch.ps1)
  ouvre la page, en lançant le cockpit s'il ne tourne pas. Rien d'autre n'est touché (pas de
  service, pas de registre). L'icône seule suffit ; la tâche évite juste l'attente au premier clic.
.DESCRIPTION
  La tâche lance `bun integrations\cockpit\cockpit.ts --career-dir <CareerDir> --port <Port> --no-open`
  depuis le dossier du harness, redémarre le cockpit s'il tombe (3 essais à 1 min) et écrit son
  journal dans .local\cockpit\cockpit.log (`.local\` n'est jamais versionné). Elle tourne avec ta
  session, à ton nom, seulement quand tu es connecté.
  À lancer une fois, depuis PowerShell :  integrations\cockpit\install-cockpit.ps1
  Pour tout retirer :                      integrations\cockpit\install-cockpit.ps1 -Uninstall
.PARAMETER CareerDir
  Le dossier carrière (défaut : .local\career du harness).
.PARAMETER Port
  Le port du cockpit (défaut 8766, celui du raccourci et de cockpit.cmd).
#>
param(
  [switch] $Uninstall,
  [string] $CareerDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path '.local\career'),
  [int] $Port = 8766
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Cockpit candidatures'
$Harness  = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Desktop  = [Environment]::GetFolderPath('Desktop')
$Shortcut = Join-Path $Desktop 'Cockpit.lnk'
$OldUrl   = Join-Path $Desktop 'Cockpit candidatures.url'
$Url      = "http://127.0.0.1:$Port/"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Path $Shortcut, $OldUrl -ErrorAction SilentlyContinue
  Write-Host "Tâche « $TaskName » et icône retirées. Le cockpit en cours, s'il y en a un, s'arrête à la fermeture de sa fenêtre."
  exit 0
}

$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { throw 'bun introuvable sur le PATH : installe-le (https://bun.sh) ou ouvre un nouveau PowerShell.' }
if (-not (Test-Path (Join-Path $CareerDir 'pending_gold_jobs.json'))) { throw "Tableau introuvable : $CareerDir\pending_gold_jobs.json (passe -CareerDir)." }
$Script = Join-Path $Harness 'integrations\cockpit\cockpit.ts'
$LogDir = Join-Path $Harness '.local\cockpit'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'cockpit.log'

# PowerShell caché porte bun : pas de fenêtre noire ; la sortie va dans le journal.
$Command  = "& '$bun' '$Script' --career-dir '$CareerDir' --port $Port --no-open *>> '$Log'"
$Action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$Command`"" -WorkingDirectory $Harness
$Trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Cockpit local du plan carrière (harness) : $Url" -Force | Out-Null

# L'icône « Cockpit » : PowerShell caché lance cockpit-launch.ps1 (démarre si besoin, puis ouvre la page).
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
$lnk.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments        = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Harness 'integrations\cockpit\cockpit-launch.ps1')`" -Port $Port -CareerDir `"$CareerDir`""
$lnk.WorkingDirectory = $Harness
$lnk.IconLocation     = "$(Join-Path $Harness 'integrations\cockpit\cockpit-v2.ico'),0"
$lnk.WindowStyle      = 7
$lnk.Description      = 'Cockpit candidatures : lance le cockpit et ouvre la page'
$lnk.Save()
Remove-Item -Path $OldUrl -ErrorAction SilentlyContinue

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
try {
  Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 | Out-Null
  Write-Host "Cockpit en route : $Url (tâche « $TaskName », journal $Log). Icône : $Shortcut"
  # La fenêtre d'application du cockpit, comme l'icône (cockpit-launch.ps1 : son propre dossier Chrome, jamais une fenêtre Chrome à côté).
  $lnkArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', (Join-Path $PSScriptRoot 'cockpit-launch.ps1'), '-Port', $Port, '-CareerDir', $CareerDir)
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList ($lnkArgs | ForEach-Object { if ("$_" -match ' ') { "`"$_`"" } else { "$_" } })
} catch {
  Write-Host "La tâche est enregistrée mais le cockpit ne répond pas encore sur $Url. Regarde $Log ; sinon lance cockpit.cmd pour voir l'erreur." -ForegroundColor Yellow
}
