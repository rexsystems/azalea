$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webRepo = Join-Path (Split-Path -Parent $repoRoot) "azalea-web"

if (-not (Test-Path $webRepo)) {
    Write-Error "azalea-web not found at $webRepo. Clone https://github.com/rexsystems/azalea-web next to lilacssh"
}

function Set-Link($linkPath) {
    if (Test-Path $linkPath) {
        $item = Get-Item $linkPath -Force
        if ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink") {
            Remove-Item $linkPath -Force
        } elseif ($item.LinkType -eq $null -and $item.PSIsContainer) {
            # Real folder: try removing stale copy (may fail if locked)
            try {
                Remove-Item $linkPath -Recurse -Force -ErrorAction Stop
            } catch {
                Write-Warning "Could not replace $linkPath (in use). Close IDE/terminals and retry, or use apps/azalea-web."
                return $false
            }
        }
    }
    New-Item -ItemType Junction -Path $linkPath -Target $webRepo | Out-Null
    Write-Host "Linked $linkPath -> $webRepo"
    return $true
}

$primary = Join-Path $repoRoot "apps\web"
$fallback = Join-Path $repoRoot "apps\azalea-web"

if (-not (Set-Link $primary)) {
    Set-Link $fallback | Out-Null
}
