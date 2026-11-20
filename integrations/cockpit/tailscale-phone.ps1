<#
.SYNOPSIS
  Ouvre le cockpit à ton téléphone par Tailscale : le réseau privé de tes appareils, jamais Internet.
.DESCRIPTION
  Le cockpit continue d'écouter 127.0.0.1 seulement. Ce script :
    1. vérifie que Tailscale est installé et connecté sur ce PC ;
    2. lance `tailscale serve --bg --https=<HttpsPort> http://127.0.0.1:<Port>` : la page devient
       https://<nom-du-pc>.<ton-réseau>.ts.net (ou :<HttpsPort>), joignable seulement depuis tes
       appareils Tailscale. Jamais `tailscale funnel` (qui, lui, publierait sur Internet) ;
    3. écrit .local\cockpit\remote-<Port>.json : le nom Tailscale du PC et les comptes autorisés.
       Le cockpit le relit tout seul (pas de redémarrage) et refuse en 403 toute requête venue de
       Tailscale d'un compte qui n'est pas dans la liste. Par défaut : le compte connecté sur ce PC.
  Deux cockpits sur le même PC (toi : 8766 sur 443, ta compagne : 8767 sur 8443), chacun avec son
  fichier et ses comptes : chacun n'ouvre que le sien.
  Le PC doit rester allumé, sans veille, et le cockpit lancé (install-cockpit.ps1 le démarre avec Windows).

  Toi :              integrations\cockpit\tailscale-phone.ps1
  Ta compagne :      integrations\cockpit\tailscale-phone.ps1 -Port 8767 -HttpsPort 8443 -AllowUser elle@exemple.fr
  Tout couper :      integrations\cockpit\tailscale-phone.ps1 -Off            (et -Port/-HttpsPort pour l'autre)
.PARAMETER AllowUser
  Les logins Tailscale autorisés (l'adresse du compte). Défaut : le compte connecté sur ce PC.
#>
param(
  [int] $Port = 8766,
  [int] $HttpsPort = 443,
  [string[]] $AllowUser = @(),
  [switch] $Off
)
$ErrorActionPreference = 'Stop'
$Harness = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ConfDir = Join-Path $Harness '.local\cockpit'
$Conf    = Join-Path $ConfDir "remote-$Port.json"

$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts -and (Test-Path "$env:ProgramFiles\Tailscale\tailscale.exe")) { $ts = "$env:ProgramFiles\Tailscale\tailscale.exe" }
if (-not $ts) { throw 'Tailscale introuvable : installe-le depuis https://tailscale.com/download puis connecte-toi.' }

if ($Off) {
  & $ts serve --https=$HttpsPort off 2>&1 | Out-Host
  Remove-Item -Path $Conf -ErrorAction SilentlyContinue
  Write-Host "Cockpit $Port retiré de Tailscale (https $HttpsPort) ; il reste ouvert sur ce PC seulement."
  exit 0
}

$status = & $ts status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') { throw "Tailscale n'est pas connecté sur ce PC (état : $($status.BackendState)). Ouvre Tailscale et connecte-toi." }
$dns = ($status.Self.DNSName).TrimEnd('.')
if (-not $dns) { throw "Pas de nom Tailscale pour ce PC : active MagicDNS dans https://login.tailscale.com/admin/dns" }
if ($AllowUser.Count -eq 0) {
  $me = $status.User."$($status.Self.UserID)".LoginName
  if (-not $me) { throw 'Compte Tailscale de ce PC introuvable : passe -AllowUser <ton login>.' }
  $AllowUser = @($me)
}

try { Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 5 | Out-Null }
catch { Write-Host "Attention : aucun cockpit ne répond sur 127.0.0.1:$Port pour l'instant (icône Cockpit, ou install-cockpit.ps1 -Port $Port)." -ForegroundColor Yellow }

# D'abord la liste des comptes, ensuite l'ouverture : jamais une fenêtre où le cockpit est relayé sans liste.
$hostName = if ($HttpsPort -eq 443) { $dns } else { "${dns}:$HttpsPort" }
New-Item -ItemType Directory -Force -Path $ConfDir | Out-Null
[pscustomobject]@{ hosts = @($hostName); allowUsers = @($AllowUser) } | ConvertTo-Json | Set-Content -Path $Conf -Encoding UTF8

& $ts serve --bg --https=$HttpsPort "http://127.0.0.1:$Port"
if ($LASTEXITCODE -ne 0) {
  throw "tailscale serve a échoué. Si le message parle de HTTPS ou de certificat : active « HTTPS Certificates » dans https://login.tailscale.com/admin/dns puis relance."
}

$served = & $ts serve status --json | ConvertFrom-Json
if ($served.AllowFunnel -and @($served.AllowFunnel.PSObject.Properties | Where-Object { $_.Value }).Count -gt 0) { Write-Host "ATTENTION : Funnel (publication sur Internet) est actif sur ce PC. Coupe-le : tailscale funnel reset" -ForegroundColor Red }

Write-Host ""
Write-Host "Sur le téléphone (Tailscale ouvert, même réseau) : https://$hostName/" -ForegroundColor Green
Write-Host "Comptes autorisés : $($AllowUser -join ', ')   (fichier : $Conf)"
