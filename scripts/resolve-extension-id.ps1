function Get-JobFormExtensionId {
    param(
        [string]$ExtensionPath,
        [string]$ChromeUserData,
        [string]$SavedManifest
    )
    $taskIds = @()
    $taskExpectedPath = [System.IO.Path]::GetFullPath($ExtensionPath).TrimEnd('\', '/')
    if (Test-Path -LiteralPath $ChromeUserData) {
        $taskProfiles = Get-ChildItem -LiteralPath $ChromeUserData -Directory |
            Where-Object { $_.Name -eq 'Default' -or $_.Name -match '^Profile \d+$' }
        foreach ($taskProfile in $taskProfiles) {
            foreach ($taskFilename in @('Secure Preferences', 'Preferences')) {
                $taskPreferences = Join-Path $taskProfile.FullName $taskFilename
                if (-not (Test-Path -LiteralPath $taskPreferences)) { continue }
                try {
                    $taskData = Get-Content -LiteralPath $taskPreferences -Raw | ConvertFrom-Json
                    foreach ($taskEntry in $taskData.extensions.settings.PSObject.Properties) {
                        if ($taskEntry.Name -notmatch '^[a-p]{32}$' -or -not $taskEntry.Value.path) { continue }
                        if (-not [System.IO.Path]::IsPathRooted($taskEntry.Value.path)) { continue }
                        $taskInstalledPath = [System.IO.Path]::GetFullPath($taskEntry.Value.path).TrimEnd('\', '/')
                        if ($taskInstalledPath -ieq $taskExpectedPath) { $taskIds += $taskEntry.Name }
                    }
                } catch { continue } # Chrome may be writing a profile; try the other file.
            }
        }
    }
    $taskIds = @($taskIds | Sort-Object -Unique)
    if ($taskIds.Count -eq 1) { return $taskIds[0] }
    if ($taskIds.Count -gt 1) { throw 'Multiple extension IDs match this checkout. Run once with -ExtensionId to choose one.' }
    if (Test-Path -LiteralPath $SavedManifest) {
        try {
            $taskSaved = Get-Content -LiteralPath $SavedManifest -Raw | ConvertFrom-Json
            $taskOrigins = @($taskSaved.allowed_origins)
            if ($taskSaved.name -eq 'com.jobform.agent' -and $taskOrigins.Count -eq 1 -and
                $taskOrigins[0] -cmatch '^chrome-extension://([a-p]{32})/$') {
                return $Matches[1]
            }
        } catch { } # Missing or invalid saved settings require initial discovery.
    }
    throw 'Load dist/extension in Chrome first, then rerun this script. For a custom Chrome profile location, pass -ExtensionId once.'
}
