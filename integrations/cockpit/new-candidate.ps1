<#
.SYNOPSIS
  Ajoute un candidat au cockpit : son dossier carrière (hors de Master Plan), son candidat.json,
  ses critères, un profil maître à remplir, un tableau vide et une icône « Cockpit <Nom> » sur le
  Bureau. Le code reste le même pour tous : seul le dossier carrière change.
.DESCRIPTION
  Ne remplace jamais un fichier qui existe déjà (relancer le script ne casse rien). Crée :
    <CareerDir>\candidat.json           id, nom, port (lu par le cockpit)
    <CareerDir>\criteres.json           critères du tri des offres (à compléter)
    <CareerDir>\master_profile.md       profil maître à remplir (CV complet + contact)
    <CareerDir>\pending_gold_jobs.json  tableau des offres, vide
    <CareerDir>\applications\           dossiers de candidature
    Bureau\Cockpit <Nom>.lnk            ouvre son cockpit (cockpit-launch.ps1 -CareerDir …)
  Son profil de navigateur (ses connexions LinkedIn, Welcome to the Jungle…) sera
  .local\browser-profile-<Id> dans le dossier du harness, séparé de celui d'Antoine.
  Exemple :  integrations\cockpit\new-candidate.ps1 -Id camille -Name Camille
.PARAMETER Id
  Identifiant court en minuscules (lettres, chiffres, - et _).
.PARAMETER Name
  Le prénom affiché dans le cockpit et sur l'icône.
.PARAMETER CareerDir
  Son dossier carrière (défaut : Bureau\Carriere-<Name>).
.PARAMETER Port
  Le port de son cockpit (défaut 8767 ; celui d'Antoine est 8766).
#>
param(
  [Parameter(Mandatory = $true)] [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,31}$')] [string] $Id,
  [Parameter(Mandatory = $true)] [string] $Name,
  [string] $CareerDir = '',
  [ValidateRange(1, 65535)] [int] $Port = 8767
)
$ErrorActionPreference = 'Stop'
$Harness = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Desktop = [Environment]::GetFolderPath('Desktop')
if ($CareerDir -eq '') { $CareerDir = Join-Path $Desktop "Carriere-$Name" }
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-IfMissing([string] $Path, [string] $Text) {
  if (Test-Path $Path) { Write-Host "  gardé   $Path"; return }
  [IO.File]::WriteAllText($Path, $Text, $Utf8)
  Write-Host "  créé    $Path"
}

New-Item -ItemType Directory -Force -Path (Join-Path $CareerDir 'applications') | Out-Null
Write-Host "Candidat « $Name » ($Id) dans $CareerDir"

$candidate = [ordered]@{ id = $Id; nom = $Name; port = $Port; acces_telephone = @() } | ConvertTo-Json
Write-IfMissing (Join-Path $CareerDir 'candidat.json') $candidate

$criteria = @'
{
  "langues": ["fr", "en"],
  "salaire_min_annuel": null,
  "salaire_inconnu": "a_verifier",
  "remote": "",
  "offre_age_max_jours": 7,
  "exclure": []
}
'@
Write-IfMissing (Join-Path $CareerDir 'criteres.json') $criteria

$profile = @"
# $Name

## Contact
- E-mail : 
- LinkedIn : https://www.linkedin.com/in/
- Portfolio / site : 
- Ville : 
- Disponibilité : 

## Titre visé


## Résumé


## Expériences
### Poste — Entreprise (début – fin)
- Réalisation chiffrée
- Réalisation chiffrée

## Formation


## Compétences


## Langues

"@
Write-IfMissing (Join-Path $CareerDir 'master_profile.md') $profile
Write-IfMissing (Join-Path $CareerDir 'pending_gold_jobs.json') "[]`n"

$Shortcut = Join-Path $Desktop "Cockpit $Name.lnk"
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
$lnk.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments        = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Harness 'integrations\cockpit\cockpit-launch.ps1')`" -Port $Port -CareerDir `"$CareerDir`""
$lnk.WorkingDirectory = $Harness
$lnk.IconLocation     = "$(Join-Path $Harness 'integrations\cockpit\cockpit-v2.ico'),0"
$lnk.WindowStyle      = 7
$lnk.Description      = "Cockpit candidatures de $Name"
$lnk.Save()
Write-Host "  icône   $Shortcut"
Write-Host ""
Write-Host "À faire : remplir master_profile.md (CV complet, e-mail, LinkedIn, ville, disponibilité) et criteres.json,"
Write-Host "puis se connecter une fois à ses sites dans son profil de navigateur :"
Write-Host "  & `"C:\Program Files\Google\Chrome\Application\chrome.exe`" --user-data-dir=`"$(Join-Path $Harness ".local\browser-profile-$Id")`" https://www.linkedin.com/login"
