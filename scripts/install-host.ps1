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
$taskInstall = Join-Path $env:LOCALAPPDATA 'jobform-agent/native'
$taskManifest = Join-Path $taskInstall 'host.json'
if (-not $ExtensionId) {
    . (Join-Path $PSScriptRoot 'resolve-extension-id.ps1')
    $ExtensionId = Get-JobFormExtensionId -ExtensionPath (Join-Path $PSScriptRoot '../dist/extension') `
        -ChromeUserData (Join-Path $env:LOCALAPPDATA 'Google/Chrome/User Data') -SavedManifest $taskManifest
}
if (-not $NodePath) {
    $taskNodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($taskNodeCommand) { $NodePath = $taskNodeCommand.Source }
    else { $NodePath = Join-Path $env:LOCALAPPDATA 'Programs/nodejs/node.exe' }
}
$taskNode = (Resolve-Path -LiteralPath $NodePath).Path
$taskHost = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../companion/native-host.mjs')).Path
if (($taskNode + $taskHost) -match '[%\r\n!"]') { throw 'Install paths must not contain quotes, percent signs, exclamation marks, or newlines.' }
New-Item -ItemType Directory -Force -Path $taskInstall | Out-Null
$taskLauncher = Join-Path $taskInstall 'host.cmd'
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
Write-Output "Native host registered for $ExtensionId. Normal extension reloads do not require running this installer again."
