<#
.SYNOPSIS
  Captures one app window to a PNG, for README/marketing shots.

.DESCRIPTION
  Window capture rather than in-app capture: a Flank space window composites a
  chrome view over separate WebContentsViews, so nothing inside the app can
  photograph the whole stack (webContents.capturePage() sees one view only).

  Runs DPI-aware so the capture is true physical pixels — on a scaled display
  an unaware process would get a blurry upscale of the virtualized desktop.
  Captures the DWM frame bounds (excludes the invisible resize border), and
  masks the Windows 11 rounded corners to transparency so the shot has no
  wallpaper stuck in its corners.

.EXAMPLE
  .\tools\capture-window.ps1 -TitleLike 'Flank' -Out docs\images\manager.png
#>
param(
  [Parameter(Mandatory = $true)][string]$TitleLike,
  [Parameter(Mandatory = $true)][string]$Out,
  # Editors and chats hold the project name in their title bars; without this
  # a title match alone can pick the wrong window.
  [string]$ProcessName = 'electron',
  [int]$CornerRadius = 8,
  [int]$DelayMs = 700
)

Add-Type -AssemblyName System.Drawing

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT val, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public const int ExtendedFrameBounds = 9;
  delegate bool EnumProc(IntPtr h, IntPtr p);

  /// Every visible top-level window of a process, by name. Process.MainWindowTitle
  /// is no use here: Flank runs all its windows in one process and that property
  /// reports only one of them.
  public static List<object[]> WindowsOf(string processName) {
    var pids = new HashSet<int>();
    foreach (var p in Process.GetProcessesByName(processName)) pids.Add(p.Id);
    var hits = new List<object[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      var title = new StringBuilder(512);
      GetWindowTextW(h, title, 512);
      if (title.Length > 0) hits.Add(new object[] { h, title.ToString() });
      return true;
    }, IntPtr.Zero);
    return hits;
  }
}
'@

[void][WinCap]::SetProcessDPIAware()

$candidates = [WinCap]::WindowsOf($ProcessName)
$match = $candidates | Where-Object { $_[1] -like "*$TitleLike*" } | Select-Object -First 1
if (-not $match) {
  $seen = ($candidates | ForEach-Object { "'" + $_[1] + "'" }) -join ', '
  throw "No visible $ProcessName window titled '*$TitleLike*'. Saw: $seen"
}
$handle = [IntPtr]$match[0]

[void][WinCap]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds $DelayMs

$rect = New-Object WinCap+RECT
$hr = [WinCap]::DwmGetWindowAttribute($handle, [WinCap]::ExtendedFrameBounds, [ref]$rect, 16)
if ($hr -ne 0) { throw "DwmGetWindowAttribute failed (0x{0:X})" -f $hr }

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "Window reported an empty rect." }

$shot = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($shot)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $shot.Size)
$g.Dispose()

# Re-draw through a rounded-rectangle clip so the corners end up transparent
# instead of holding whatever the window was sitting on top of.
$masked = New-Object System.Drawing.Bitmap $width, $height
$mg = [System.Drawing.Graphics]::FromImage($masked)
$mg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$d = $CornerRadius * 2
$pathShape = New-Object System.Drawing.Drawing2D.GraphicsPath
$pathShape.AddArc(0, 0, $d, $d, 180, 90)
$pathShape.AddArc($width - $d - 1, 0, $d, $d, 270, 90)
$pathShape.AddArc($width - $d - 1, $height - $d - 1, $d, $d, 0, 90)
$pathShape.AddArc(0, $height - $d - 1, $d, $d, 90, 90)
$pathShape.CloseFigure()
$mg.SetClip($pathShape)
$mg.DrawImage($shot, 0, 0)
$mg.Dispose()

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$masked.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$masked.Dispose()
$shot.Dispose()

"Saved $Out ({0}x{1})" -f $width, $height
