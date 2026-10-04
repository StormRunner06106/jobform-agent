param([Parameter(Mandatory=$true)][string]$CodexPath)
$ErrorActionPreference = 'Stop'
$taskCodex = (Resolve-Path -LiteralPath $CodexPath).Path
$taskPreviousCodexHome = $env:CODEX_HOME
try {
    $env:CODEX_HOME = Join-Path $env:LOCALAPPDATA 'jobform-agent/codex'
    New-Item -ItemType Directory -Force -Path $env:CODEX_HOME | Out-Null
    & $taskCodex login
    if ($LASTEXITCODE -ne 0) { throw 'Codex login did not complete.' }
} finally { $env:CODEX_HOME = $taskPreviousCodexHome }
