<#
  OneUp desktop tracker - Windows tray app.

  While you're clocked in to OneUp (and not on a break), and only after you've
  given permission both here and in the app, it notes which program is in
  front (e.g. CapCut) and its window title, plus idle time, and sends that to
  your OneUp account once a minute. No screenshots, no keystrokes, nothing
  you type.

  Runs on the PowerShell that ships with Windows; nothing to install.
  Start it with "Start OneUp Tracker.cmd".

  -TestSeconds N : sample for N seconds, send once, print what was sent, exit
                   (no tray icon). For checking a setup.
#>
param(
  [string]$ConfigPath = (Join-Path $env:APPDATA "OneUpTracker\config.json"),
  [int]$TestSeconds = 0
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SAMPLE_MS = 5000          # how often the program in front is checked
$FLUSH_MS = 60000          # how often activity is sent / status refreshed
$IDLE_MS = 120000          # no keyboard/mouse this long = idle (same as the Chrome tracker)
$CONSENT_TEXT = @"
OneUp would like to track your work while you're clocked in.

WHAT IS RECORDED (only while clocked in and not on a break):
  - the name of the program in front (e.g. CapCut, Photoshop)
  - that program's window title
  - how long you spend in it, and when you're idle (no input for 2 minutes)

NEVER RECORDED:
  - screenshots, screen recording, webcam or microphone
  - keystrokes or anything you type
  - anything outside your clocked-in hours

Your managers and the CEO see it on OneUp's Team page. You can quit this app
or withdraw permission in OneUp (Work tracker page) at any time.
"@

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if (-not ("OneUpWin32" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OneUpWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  public static long IdleMs() {
    LASTINPUTINFO i = new LASTINPUTINFO();
    i.cbSize = (uint)Marshal.SizeOf(i);
    if (!GetLastInputInfo(ref i)) return 0;
    return (long)((uint)Environment.TickCount - i.dwTime);
  }
  public static string Title(IntPtr h) {
    StringBuilder s = new StringBuilder(512);
    GetWindowText(h, s, 512);
    return s.ToString();
  }
}
"@
}

# -- Config --

function Load-Config {
  if (Test-Path $ConfigPath) {
    try { return Get-Content $ConfigPath -Raw | ConvertFrom-Json } catch { }
  }
  return $null
}

function Save-Config($cfg) {
  $dir = Split-Path $ConfigPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $cfg | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
}

# -- Server --

function Call-OneUp($cfg, [string]$action, $segments) {
  $body = @{ action = $action; source = "desktop" }
  if ($segments) { $body.segments = @($segments) }
  $json = $body | ConvertTo-Json -Depth 5 -Compress
  return Invoke-RestMethod -Method Post -Uri ($cfg.appUrl.TrimEnd("/") + "/api/tracker/ext") `
    -Headers @{ Authorization = "Bearer " + $cfg.key } -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 20
}

# -- What's in front right now --

$script:appNames = @{}
function Friendly-AppName([System.Diagnostics.Process]$p) {
  if ($script:appNames.ContainsKey($p.ProcessName)) { return $script:appNames[$p.ProcessName] }
  $name = $p.ProcessName
  try {
    $desc = $p.MainModule.FileVersionInfo.FileDescription
    if ($desc -and $desc.Trim().Length -gt 1) { $name = $desc.Trim() }
  } catch { }
  $script:appNames[$p.ProcessName] = $name
  return $name
}

function Current-State {
  if ([OneUpWin32]::IdleMs() -ge $IDLE_MS) { return @{ kind = "idle" } }
  $h = [OneUpWin32]::GetForegroundWindow()
  if ($h -eq [IntPtr]::Zero) { return @{ kind = "away" } }
  $procId = [uint32]0
  [void][OneUpWin32]::GetWindowThreadProcessId($h, [ref]$procId)
  try { $p = Get-Process -Id $procId } catch { return @{ kind = "away" } }
  # The lock screen is "away", not an app.
  if ($p.ProcessName -in @("LockApp", "LogonUI")) { return @{ kind = "away" } }
  $title = [OneUpWin32]::Title($h)
  if ($title.Length -gt 200) { $title = $title.Substring(0, 200) }
  return @{ kind = "app"; app = (Friendly-AppName $p); title = $title }
}

# -- Segments: one per stretch in the same program/window --

$script:current = $null
$script:queue = New-Object System.Collections.ArrayList
$script:tracking = $false

function Now-Iso { [DateTime]::UtcNow.ToString("o") }

function Close-Current {
  if ($script:current) {
    $seg = $script:current.Clone()
    $seg.end = Now-Iso
    [void]$script:queue.Add($seg)
    $script:current = $null
  }
}

function Sample {
  if (-not $script:tracking) { $script:current = $null; return }
  $s = Current-State
  $c = $script:current
  if ($c -and $c.kind -eq $s.kind -and $c.app -eq $s.app -and $c.title -eq $s.title) { return }
  Close-Current
  $s.start = Now-Iso
  $script:current = $s
}

# Send what's queued, then learn whether we should be tracking.
function Flush($cfg) {
  if ($script:tracking -and $script:current) {
    # Cut the running stretch so recent time is reported; carry it on.
    $carry = $script:current.Clone()
    Close-Current
    $carry.start = Now-Iso
    $script:current = $carry
  }
  $toSend = @($script:queue | Select-Object -First 500)
  $res = if ($toSend.Count -gt 0) { Call-OneUp $cfg "activity" $toSend } else { Call-OneUp $cfg "status" $null }
  if ($toSend.Count -gt 0) { $script:queue.RemoveRange(0, $toSend.Count) }
  $script:tracking = [bool]($res.consent -and $res.clockedIn -and -not $res.onBreak)
  if (-not $script:tracking) { $script:current = $null; $script:queue.Clear() }
  return $res
}

# -- First run: connect + permission --

function Show-Setup($cfg) {
  $f = New-Object Windows.Forms.Form
  $f.Text = "OneUp desktop tracker"
  $f.Size = New-Object Drawing.Size(520, 600)
  $f.StartPosition = "CenterScreen"
  $f.FormBorderStyle = "FixedDialog"
  $f.MaximizeBox = $false
  $f.Font = New-Object Drawing.Font("Segoe UI", 9)

  $info = New-Object Windows.Forms.TextBox
  $info.Multiline = $true; $info.ReadOnly = $true; $info.ScrollBars = "Vertical"
  $info.Text = $CONSENT_TEXT -replace "`n", "`r`n"
  $info.Location = New-Object Drawing.Point(16, 16); $info.Size = New-Object Drawing.Size(472, 260)
  $f.Controls.Add($info)

  $l1 = New-Object Windows.Forms.Label; $l1.Text = "OneUp address (from the Work tracker page)"
  $l1.Location = New-Object Drawing.Point(16, 290); $l1.AutoSize = $true; $f.Controls.Add($l1)
  $url = New-Object Windows.Forms.TextBox; $url.Location = New-Object Drawing.Point(16, 310); $url.Size = New-Object Drawing.Size(472, 24)
  if ($cfg -and $cfg.appUrl) { $url.Text = $cfg.appUrl }
  $f.Controls.Add($url)

  $l2 = New-Object Windows.Forms.Label; $l2.Text = "Your tracker key (mk_...)"
  $l2.Location = New-Object Drawing.Point(16, 346); $l2.AutoSize = $true; $f.Controls.Add($l2)
  $key = New-Object Windows.Forms.TextBox; $key.Location = New-Object Drawing.Point(16, 366); $key.Size = New-Object Drawing.Size(472, 24)
  $f.Controls.Add($key)

  $agree = New-Object Windows.Forms.CheckBox
  $agree.Text = "I've read this and I agree to activity tracking while I'm clocked in."
  $agree.Location = New-Object Drawing.Point(16, 404); $agree.Size = New-Object Drawing.Size(472, 40)
  $f.Controls.Add($agree)

  $autostart = New-Object Windows.Forms.CheckBox
  $autostart.Text = "Start the tracker when Windows starts"
  $autostart.Checked = $true
  $autostart.Location = New-Object Drawing.Point(16, 446); $autostart.AutoSize = $true
  $f.Controls.Add($autostart)

  $err = New-Object Windows.Forms.Label; $err.ForeColor = [Drawing.Color]::Firebrick
  $err.Location = New-Object Drawing.Point(16, 476); $err.Size = New-Object Drawing.Size(472, 36)
  $f.Controls.Add($err)

  $ok = New-Object Windows.Forms.Button; $ok.Text = "Allow and connect"
  $ok.Location = New-Object Drawing.Point(308, 516); $ok.Size = New-Object Drawing.Size(180, 30)
  $f.Controls.Add($ok)
  $no = New-Object Windows.Forms.Button; $no.Text = "Don't allow"
  $no.Location = New-Object Drawing.Point(190, 516); $no.Size = New-Object Drawing.Size(110, 30)
  $no.DialogResult = "Cancel"; $f.Controls.Add($no); $f.CancelButton = $no

  $script:setupResult = $null
  $ok.Add_Click({
    if (-not $agree.Checked) { $err.Text = "Tick the box to give permission, or choose Don't allow."; return }
    $try = [pscustomobject]@{ appUrl = $url.Text.Trim(); key = $key.Text.Trim(); agreed = (Now-Iso) }
    try {
      $res = Call-OneUp $try "status" $null
      $script:setupResult = @{ cfg = $try; name = $res.name; autostart = $autostart.Checked }
      $f.DialogResult = "OK"; $f.Close()
    } catch {
      $err.Text = "Couldn't connect: " + $_.Exception.Message
    }
  })
  [void]$f.ShowDialog()
  return $script:setupResult
}

# -- Start with Windows --

$StartupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "OneUp Tracker.lnk"
function Set-Autostart([bool]$on) {
  if ($on) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($StartupLink)
    $lnk.TargetPath = "powershell.exe"
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
    $lnk.WorkingDirectory = Split-Path $PSCommandPath
    $lnk.Save()
  } elseif (Test-Path $StartupLink) {
    Remove-Item $StartupLink -Force
  }
}

# -- Test mode: sample, send once, report, exit --

if ($TestSeconds -gt 0) {
  $cfg = Load-Config
  if (-not $cfg) { throw "No config at $ConfigPath" }
  $r = Call-OneUp $cfg "status" $null
  $script:tracking = [bool]($r.consent -and $r.clockedIn -and -not $r.onBreak)
  Write-Output ("status: consent={0} clockedIn={1} onBreak={2} -> tracking={3}" -f $r.consent, $r.clockedIn, $r.onBreak, $script:tracking)
  $until = (Get-Date).AddSeconds($TestSeconds)
  while ((Get-Date) -lt $until) { Sample; Start-Sleep -Milliseconds 1000 }
  Close-Current
  $sent = @($script:queue)
  $res = Flush $cfg
  Write-Output ("sent {0} segment(s), server kept {1}" -f $sent.Count, $res.kept)
  $sent | ForEach-Object { Write-Output ("  {0,-5} {1} | {2}" -f $_.kind, $_.app, $_.title) }
  exit 0
}

# -- Tray app --

$mutex = New-Object Threading.Mutex($false, "Local\OneUpDesktopTracker")
if (-not $mutex.WaitOne(0)) { exit 0 }   # already running

$cfg = Load-Config
if (-not $cfg -or -not $cfg.key -or -not $cfg.agreed) {
  $setup = Show-Setup $cfg
  if (-not $setup) { exit 0 }            # "Don't allow": nothing runs, nothing recorded
  $cfg = $setup.cfg
  Save-Config $cfg
  Set-Autostart $setup.autostart
}

$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.SystemIcons]::Information
$tray.Text = "OneUp tracker: connecting..."
$tray.Visible = $true

$menu = New-Object Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("Connecting...")
$statusItem.Enabled = $false
[void]$menu.Items.Add("-")
$openItem = $menu.Items.Add("Open OneUp time clock")
$openItem.Add_Click({ Start-Process ($cfg.appUrl.TrimEnd("/") + "/clock") })
$autoItem = New-Object Windows.Forms.ToolStripMenuItem("Start with Windows")
$autoItem.Checked = (Test-Path $StartupLink)
$autoItem.Add_Click({ $autoItem.Checked = -not $autoItem.Checked; Set-Autostart $autoItem.Checked })
[void]$menu.Items.Add($autoItem)
$disconnect = $menu.Items.Add("Disconnect and quit")
$disconnect.Add_Click({
  if ([Windows.Forms.MessageBox]::Show("Remove this computer's connection to OneUp and stop tracking?", "OneUp tracker", "YesNo") -eq "Yes") {
    if (Test-Path $ConfigPath) { Remove-Item $ConfigPath -Force }
    Set-Autostart $false
    $tray.Visible = $false
    [Windows.Forms.Application]::Exit()
  }
})
$quit = $menu.Items.Add("Quit")
$quit.Add_Click({ $tray.Visible = $false; [Windows.Forms.Application]::Exit() })
$tray.ContextMenuStrip = $menu

$script:lastNote = ""
function Update-Tray($res, $errorText) {
  $text =
    if ($errorText) { "Offline, will retry: $errorText" }
    elseif (-not $res.consent) { "Paused: give permission in OneUp (Work tracker page)" }
    elseif (-not $res.clockedIn) { "Not tracking: you're clocked out" }
    elseif ($res.onBreak) { "Not tracking: you're on a break" }
    else { "Tracking: $($res.name) is clocked in" }
  $statusItem.Text = $text
  $tray.Text = ("OneUp: " + $text).Substring(0, [Math]::Min(63, ("OneUp: " + $text).Length))
  if ($text -ne $script:lastNote -and -not $errorText) {
    $tray.ShowBalloonTip(4000, "OneUp tracker", $text, "Info")
    $script:lastNote = $text
  }
}

$sampleTimer = New-Object Windows.Forms.Timer
$sampleTimer.Interval = $SAMPLE_MS
$sampleTimer.Add_Tick({ try { Sample } catch { } })

$flushTimer = New-Object Windows.Forms.Timer
$flushTimer.Interval = $FLUSH_MS
$flushTimer.Add_Tick({
  try { Update-Tray (Flush $cfg) $null }
  catch { Update-Tray $null $_.Exception.Message }   # offline: the queue is kept and retried
})

try { Update-Tray (Flush $cfg) $null } catch { Update-Tray $null $_.Exception.Message }
$sampleTimer.Start()
$flushTimer.Start()
[Windows.Forms.Application]::Run()

# Quitting: send the last stretch before exiting.
try { Close-Current; if ($script:tracking) { [void](Flush $cfg) } } catch { }
$tray.Dispose()
$mutex.ReleaseMutex()
