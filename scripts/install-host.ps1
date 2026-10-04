param(
    [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$NodePath,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$taskRegistry = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.jobform.agent'
if ($Uninstall) {
    if (Test-Path -LiteralPath $taskRegistry) { Remove-Item -LiteralPath $taskRegistry }
    Write-Output 'Chrome native-host registration removed. Local files and login remain intact.'
    exit
}
if (-not $ExtensionId) { throw 'Provide the unpacked extension ID with -ExtensionId.' }
if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }
$taskNode = (Resolve-Path -LiteralPath $NodePath).Path
$taskHost = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../companion/native-host.mjs')).Path
if (($taskNode + $taskHost) -match '[%\r\n!"]') { throw 'Install paths must not contain quotes, percent signs, exclamation marks, or newlines.' }
$taskInstall = Join-Path $env:LOCALAPPDATA 'jobform-agent/native'
New-Item -ItemType Directory -Force -Path $taskInstall | Out-Null
$taskLauncher = Join-Path $taskInstall 'host.cmd'
$taskManifest = Join-Path $taskInstall 'host.json'
$taskCommand = '@echo off' + "`r`n" + '@chcp 65001 >nul' + "`r`n" + '"' + $taskNode + '" "' + $taskHost + '" "%~1"' + "`r`n"
[System.IO.File]::WriteAllText($taskLauncher, $taskCommand, [System.Text.UTF8Encoding]::new($false))
@{
    name = 'com.jobform.agent'
    description = 'Job Form Agent local companion'
    path = $taskLauncher
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json | Set-Content -LiteralPath $taskManifest -Encoding utf8
New-Item -Path $taskRegistry -Force | Out-Null
Set-Item -LiteralPath $taskRegistry -Value $taskManifest
Write-Output 'Native host installed for this Chrome extension ID. Reload the extension.'
