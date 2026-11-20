<#
.SYNOPSIS
  L'icône « Cockpit » du Bureau : démarre le cockpit s'il ne tourne pas (sans fenêtre), puis
  ouvre la page dans sa fenêtre d'application (Chrome --app dans son propre dossier .local\cockpit\app-window-<port>,
  sinon Edge) ; si elle est déjà ouverte, elle revient devant.
.DESCRIPTION
  Si http://127.0.0.1:<Port>/ répond déjà (cockpit lancé par l'icône, par cockpit.cmd ou par la
  tâche de session d'install-cockpit.ps1) avec un code à jour, la page s'ouvre tout de suite. Si
  le code du cockpit (integrations\cockpit) a changé depuis son démarrage (.local\cockpit\
  running-<Port>.json), il est arrêté et relancé : une mise à jour prend effet au clic suivant,
  sans toucher aux runs Archon, qui sont des processus à part. Sinon bun est lancé
  caché depuis le dossier du harness, sa sortie va dans .local\cockpit\cockpit.log, et la page
  s'ouvre dès que le cockpit répond (30 s au plus ; au-delà, une boîte dit où lire l'erreur).
  Le cockpit reste ensuite en marche jusqu'à la fermeture de la session Windows.
.PARAMETER CareerDir
  Le dossier carrière (défaut : .local\career du harness), ou le dossier carrière
  d'un autre candidat (new-candidate.ps1 crée son icône avec le bon dossier et le bon port).
.PARAMETER Port
  Le port du cockpit (défaut 8766).
#>
param(
  [string] $CareerDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path '.local\career'),
  [int] $Port = 8766
)
$ErrorActionPreference = 'Stop'
$Harness = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Url = "http://127.0.0.1:$Port/"
$LogDir = Join-Path $Harness '.local\cockpit'
# Un journal par cockpit : celui d'Antoine (8766) garde son nom, un autre candidat a le sien.
$Log = Join-Path $LogDir $(if ($Port -eq 8766) { 'cockpit.log' } else { "cockpit-$Port.log" })

function Test-Cockpit {
  try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Show-Problem([string] $Text) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($Text, 'Cockpit candidatures', 'OK', 'Warning') | Out-Null
}

# Le journal de l'icône est à part : cockpit.log est tenu ouvert par le cockpit (redirection), on n'y écrit pas d'ici.
$IconLog = Join-Path $LogDir "icone-$Port.log"
function Note([string] $Text) {
  try { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null; Add-Content -Path $IconLog -Value "$(Get-Date -Format o) $Text" -ErrorAction SilentlyContinue } catch {}
}

function Stop-Cockpit {
  # Le pid vient du fichier écrit par le cockpit ; sans lui (ancienne version), le processus qui écoute le port.
  $stamp = Join-Path $LogDir "running-$Port.json"
  $pids = @()
  if (Test-Path $stamp) { try { $pids += [int](Get-Content $stamp -Raw | ConvertFrom-Json).pid } catch {} }
  try { $pids += @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | ForEach-Object { [int]$_.OwningProcess }) } catch {}
  foreach ($p in ($pids | Sort-Object -Unique)) {
    if ($p -gt 0) { Note "arrêt du processus $p"; Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Test-Cockpit) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 300 }
}

function Test-Stale {
  # Vrai si un fichier du cockpit (ou chrome.json, le profil Chrome qu'il résout au démarrage) est plus récent
  # que le démarrage noté, ou si rien n'est noté (ancienne version).
  $stamp = Join-Path $LogDir "running-$Port.json"
  if (-not (Test-Path $stamp)) { return $true }
  try { $started = [DateTime]::Parse((Get-Content $stamp -Raw | ConvertFrom-Json).started).ToUniversalTime() } catch { return $true }
  $files = @(Get-ChildItem $PSScriptRoot -File -Include *.ts,*.html,*.ico -Recurse) + @(Get-Item (Join-Path $LogDir 'chrome.json') -ErrorAction SilentlyContinue)
  $newest = $files | Where-Object { $_ } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  return ($newest -and $newest.LastWriteTimeUtc -gt $started)
}

try {
  if ((Test-Cockpit) -and (Test-Stale)) {
    Note "cockpit redémarré par l'icône : code mis à jour"
    Stop-Cockpit
  }

  if (-not (Test-Cockpit)) {
    $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
    if (-not $bun -and (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe")) { $bun = "$env:USERPROFILE\.bun\bin\bun.exe" }
    if (-not $bun) { Show-Problem "bun est introuvable : installe-le (https://bun.sh), puis reclique sur l'icône."; exit 1 }
    if (-not (Test-Path (Join-Path $CareerDir 'pending_gold_jobs.json'))) { Show-Problem "Tableau introuvable :`n$CareerDir\pending_gold_jobs.json"; exit 1 }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    # Un PowerShell caché porte bun ; la commande passe encodée, sans souci de guillemets ni d'espaces.
    $command = "& '$bun' 'integrations\cockpit\cockpit.ts' --career-dir '$CareerDir' --port $Port --no-open *>> '$Log'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $Harness -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
    Note "cockpit lancé ($bun)"
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Cockpit)) {
      if ((Get-Date) -gt $deadline) {
        $tail = if (Test-Path $Log) { (Get-Content $Log -Tail 12) -join "`n" } else { '(journal vide)' }
        Show-Problem "Le cockpit ne répond pas sur $Url après 30 s.`n`nJournal : $Log`n`n$tail"
        exit 1
      }
      Start-Sleep -Milliseconds 500
    }
  }
} catch {
  Note "échec : $($_.Exception.Message)"
  Show-Problem "L'icône n'a pas pu lancer le cockpit :`n$($_.Exception.Message)`n`nJournal : $IconLog"
  exit 1
}

# La fenêtre du cockpit est une application à part : Chrome en mode application dans son propre dossier
# (.local\cockpit\app-window-<port>), jamais dans le profil d'Antoine. Ouvrir --app dans un profil Chrome
# fermé (« Antoine Bis ») rouvrait aussi ses onglets de la dernière fois : une fenêtre Chrome à côté.
# Les annonces, elles, s'ouvrent toujours dans « Antoine Bis » (POST /api/open, chrome.json).
# Barre des tâches : la fenêtre et l'icône « Cockpit » du Bureau portent le même identifiant d'application
# (System.AppUserModel.ID = Harness.Cockpit.<port>) ; Windows range donc la fenêtre sous l'icône épinglée au lieu
# d'en ajouter une, et épingler la fenêtre elle-même relance ce script. Si elle est déjà ouverte, elle revient devant.
$AppDir = Join-Path $LogDir "app-window-$Port"
$AppId = "Harness.Cockpit.$Port"
$Icon = Join-Path $PSScriptRoot 'cockpit-v2.ico'
$Relaunch = "`"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Port $Port -CareerDir `"$CareerDir`""

try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
namespace CockpitShell {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropKey { public Guid fmtid; public uint pid; public PropKey(Guid g, uint p) { fmtid = g; pid = p; } }
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVar { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PropKey k);
    [PreserveSig] int GetValue(ref PropKey k, out PropVar v);
    [PreserveSig] int SetValue(ref PropKey k, ref PropVar v);
    [PreserveSig] int Commit();
  }
  public static class Taskbar {
    static readonly Guid Fmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropStore ps);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVar v);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

    static void Set(IPropStore ps, uint pid, string value) {
      PropKey k = new PropKey(Fmt, pid);
      PropVar v = new PropVar();
      v.vt = 31; // VT_LPWSTR
      v.p = Marshal.StringToCoTaskMemUni(value);
      try { ps.SetValue(ref k, ref v); } finally { PropVariantClear(ref v); }
    }

    // Les fenêtres visibles de Chrome (classe Chrome_WidgetWin_1, avec un titre) des processus donnés.
    public static IntPtr[] Windows(uint[] pids) {
      List<IntPtr> found = new List<IntPtr>();
      List<uint> set = new List<uint>(pids);
      EnumWindows(delegate (IntPtr h, IntPtr l) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (!set.Contains(pid) || !IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
        StringBuilder c = new StringBuilder(64); GetClassName(h, c, 64);
        if (c.ToString() == "Chrome_WidgetWin_1") found.Add(h);
        return true;
      }, IntPtr.Zero);
      return found.ToArray();
    }

    public static void Front(IntPtr h) { if (IsIconic(h)) ShowWindowAsync(h, 9); SetForegroundWindow(h); }

    public static bool TagWindow(IntPtr h, string appId, string relaunch, string icon, string name) {
      Guid iid = typeof(IPropStore).GUID;
      IPropStore ps;
      if (SHGetPropertyStoreForWindow(h, ref iid, out ps) != 0 || ps == null) return false;
      try {
        Set(ps, 2, relaunch);   // RelaunchCommand
        Set(ps, 3, icon);       // RelaunchIconResource
        Set(ps, 4, name);       // RelaunchDisplayNameResource
        Set(ps, 5, appId);      // ID, en dernier
        return true;
      } finally { Marshal.ReleaseComObject(ps); }
    }

    public static string ShortcutId(string lnk) {
      object link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
      try {
        ((IPersistFile)link).Load(lnk, 0);
        PropKey k = new PropKey(Fmt, 5); PropVar v;
        if (((IPropStore)link).GetValue(ref k, out v) != 0) return "";
        try { return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : ""; } finally { PropVariantClear(ref v); }
      } finally { Marshal.ReleaseComObject(link); }
    }

    public static void TagShortcut(string lnk, string appId) {
      object link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
      try {
        ((IPersistFile)link).Load(lnk, 2); // STGM_READWRITE
        IPropStore ps = (IPropStore)link;
        Set(ps, 5, appId);
        ps.Commit();
        ((IPersistFile)link).Save(lnk, true);
      } finally { Marshal.ReleaseComObject(link); }
    }
  }
}
'@ -ErrorAction Stop
  $Shell = $true
} catch { $Shell = $false; Note "barre des tâches : aide Windows indisponible ($($_.Exception.Message))" }

# Les icônes du cockpit (ce port) sur le Bureau et dans la barre des tâches reçoivent l'identifiant, une fois.
if ($Shell) {
  $places = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'))
  $wsh = New-Object -ComObject WScript.Shell
  foreach ($lnkPath in @($places | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Filter *.lnk -File -ErrorAction SilentlyContinue })) {
    try {
      $l = $wsh.CreateShortcut($lnkPath.FullName)
      $mine = ($l.Arguments -like '*cockpit-launch.ps1*') -and (($l.Arguments -match "-Port\s+$Port\b") -or ($Port -eq 8766 -and $l.Arguments -notmatch '-Port'))
      # Une épingle faite sur la fenêtre Chrome elle-même (chrome.exe --app=http://127.0.0.1:<port>/) relance désormais ce script.
      if (-not $mine -and $lnkPath.DirectoryName -like '*User Pinned\TaskBar' -and ($l.Arguments -like "*127.0.0.1:$Port*" -or $l.Arguments -like "*app-window-$Port*")) {
        $l.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Port $Port -CareerDir `"$CareerDir`""
        $l.WorkingDirectory = $Harness
        $l.IconLocation = "$Icon,0"
        $l.WindowStyle = 7
        $l.Save()
        $mine = $true
        Note "épingle Chrome du cockpit redirigée vers l'icône : $($lnkPath.FullName)"
      }
      if ($mine -and [CockpitShell.Taskbar]::ShortcutId($lnkPath.FullName) -ne $AppId) {
        [CockpitShell.Taskbar]::TagShortcut($lnkPath.FullName, $AppId)
        Note "identifiant de barre des tâches posé sur $($lnkPath.FullName)"
      }
    } catch { Note "raccourci $($lnkPath.FullName) : $($_.Exception.Message)" }
  }
}

function Get-AppPids {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction Stop |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($AppDir) -and -not $_.CommandLine.Contains('--type=') } |
      ForEach-Object { [uint32]$_.ProcessId })
  } catch { return @() }
}
function Get-AppWindows {
  $pids = Get-AppPids
  if ($pids.Count -eq 0) { return @() }
  if ($Shell) { return @([CockpitShell.Taskbar]::Windows([uint32[]]$pids)) }
  return @($pids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).MainWindowHandle } | Where-Object { $_ -and $_ -ne [IntPtr]::Zero })
}
function Set-AppTag($windows) {
  if (-not $Shell) { return }
  foreach ($h in $windows) { try { [CockpitShell.Taskbar]::TagWindow($h, $AppId, $Relaunch, "$Icon,0", 'Cockpit') | Out-Null } catch {} }
}

$open = Get-AppWindows
if ($open.Count -gt 0) {
  Set-AppTag $open
  if ($Shell) { [CockpitShell.Taskbar]::Front($open[0]) }
  Note "fenêtre du cockpit remise devant"
  exit 0
}

# Chrome (machine, puis utilisateur), sinon Edge, sinon le navigateur par défaut.
$Chrome = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ } |
  ForEach-Object { Join-Path $_ 'Google\Chrome\Application\chrome.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$AppArgs = @("--user-data-dir=`"$AppDir`"", "--app=$Url", '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble', '--hide-crash-restore-bubble')
try {
  if ($Chrome) { Start-Process -FilePath $Chrome -ArgumentList $AppArgs } else { Start-Process -FilePath 'msedge' -ArgumentList $AppArgs }
  Note "fenêtre du cockpit ouverte ($AppDir)"
} catch { Start-Process $Url; exit 0 }

# La fenêtre met un instant à paraître : on lui pose l'identifiant dès qu'elle est là (10 s au plus),
# puis une seconde fois, Chrome pouvant le réécrire en finissant de l'ouvrir.
$deadline = (Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 250
  $open = Get-AppWindows
} while ($open.Count -eq 0 -and (Get-Date) -lt $deadline)
Set-AppTag $open
Start-Sleep -Milliseconds 1500
Set-AppTag (Get-AppWindows)
