# S8-H1 — process-TREE memory sampler (Windows).
#
# Sampling only the worker's own Node RSS would be wrong and dangerously
# optimistic: Chromium runs as CHILD processes (browser + zygote + one renderer
# per page), and their memory is what actually pushes the container over its
# limit. This walks the descendant tree of $RootPid and reports the total.
#
# Emits one CSV line per sample:  unixMs,totalBytes,procCount,chromiumBytes
#
#   powershell -File sample-tree-memory.ps1 -RootPid 1234 -IntervalMs 500

param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [int]$IntervalMs = 500
)

$ErrorActionPreference = 'Stop'

while ($true) {
  try {
    $all = Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, WorkingSetSize, Name
  } catch {
    break
  }

  $byParent = @{}
  $byId = @{}
  foreach ($p in $all) {
    $pid_ = [int]$p.ProcessId
    $ppid = [int]$p.ParentProcessId
    $byId[$pid_] = $p
    if (-not $byParent.ContainsKey($ppid)) {
      $byParent[$ppid] = New-Object System.Collections.ArrayList
    }
    [void]$byParent[$ppid].Add($pid_)
  }

  if (-not $byId.ContainsKey($RootPid)) { break }   # worker exited — stop sampling

  $stack = New-Object System.Collections.Stack
  $stack.Push($RootPid)
  $seen = @{}
  $total = [int64]0
  $chromium = [int64]0
  $count = 0

  while ($stack.Count -gt 0) {
    $id = [int]$stack.Pop()
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true

    if ($byId.ContainsKey($id)) {
      $proc = $byId[$id]
      $ws = [int64]$proc.WorkingSetSize
      $total += $ws
      $count++
      if ($proc.Name -match 'chrome') { $chromium += $ws }
    }
    if ($byParent.ContainsKey($id)) {
      foreach ($child in $byParent[$id]) { $stack.Push($child) }
    }
  }

  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Write-Output "$ts,$total,$count,$chromium"

  Start-Sleep -Milliseconds $IntervalMs
}
