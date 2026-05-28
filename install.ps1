# DeckPilot installer for Windows (PowerShell 5.1+ / PowerShell 7+).
#
# Mirrors install.sh: downloads the repo (zip tarball, no git required),
# builds, links the `deckpilot` command, offers to install LibreOffice +
# poppler (the visual-pipeline deps), then runs `deckpilot doctor` to
# verify the install end-to-end. Re-running it auto-detects existing
# installs and switches into a fast update path.
#
# Usage:
#   .\install.ps1                       install for the current user via `npm link`
#   .\install.ps1 -System               install system-wide (requires admin)
#   .\install.ps1 -Update               fast-path: refresh + build only
#   .\install.ps1 -Reinstall            force full install path even on an existing install
#   .\install.ps1 -InstallDeps          install missing system deps without prompt
#   .\install.ps1 -NoInstallDeps        never auto-install system deps; just print the command
#   .\install.ps1 -SkipDoctor           skip the final `deckpilot doctor` verification
#   .\install.ps1 -Uninstall            remove the symlink + (if bootstrapped) the install dir
#   .\install.ps1 -NoBuild              skip the TypeScript build
#   .\install.ps1 -Quiet                less chatty
#   .\install.ps1 -Log <path>           override the install log location
#
# Remote install:
#   iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex
#
# Environment variables:
#   DECKPILOT_INSTALL_DIR     where to extract when bootstrapping (default $HOME\.deckpilot\repo)
#   DECKPILOT_REPO_URL        primary GitHub https URL (used to derive the zip URL)
#   DECKPILOT_REPO_MIRRORS    comma-separated fallback https URLs
#   DECKPILOT_REF             git ref to fetch (branch, tag, or SHA; default main)
#   DECKPILOT_INSTALL_LOG     override the install log path

[CmdletBinding()]
param(
    [switch] $System,
    [switch] $Uninstall,
    [switch] $Update,
    [switch] $Reinstall,
    [switch] $InstallDeps,
    [switch] $NoInstallDeps,
    [switch] $SkipDoctor,
    [switch] $NoBuild,
    [switch] $Quiet,
    [string] $Log
)

$ErrorActionPreference = 'Stop'

$INSTALL_SCRIPT_VERSION = '0.14.8'

# ---------- globals ----------

$DefaultRepoUrl = 'https://github.com/marinoscar/deckpilot.git'
$DefaultRef = 'main'
$DefaultInstallDir = Join-Path $HOME '.deckpilot\repo'
$DefaultLog = Join-Path $HOME '.deckpilot\install.log'

$RepoUrl = if ($env:DECKPILOT_REPO_URL) { $env:DECKPILOT_REPO_URL } else { $DefaultRepoUrl }
$Ref = if ($env:DECKPILOT_REF) { $env:DECKPILOT_REF } else { $DefaultRef }
$InstallLog = if ($Log) { $Log } elseif ($env:DECKPILOT_INSTALL_LOG) { $env:DECKPILOT_INSTALL_LOG } else { $DefaultLog }
$DeckpilotHomeDir = Join-Path $HOME '.deckpilot'

# Detect whether this script lives inside an existing checkout.
$ScriptPath = $MyInvocation.MyCommand.Path
$CandidateDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { '' }

$IsLocalCheckout = $false
if ($CandidateDir -and (Test-Path (Join-Path $CandidateDir 'package.json'))) {
    $pkg = Get-Content (Join-Path $CandidateDir 'package.json') -Raw
    if ($pkg -match '"name"\s*:\s*"deckpilot"') {
        $IsLocalCheckout = $true
    }
}

if ($IsLocalCheckout) {
    $RepoDir = $CandidateDir
    $Bootstrap = $false
} else {
    $RepoDir = if ($env:DECKPILOT_INSTALL_DIR) { $env:DECKPILOT_INSTALL_DIR } else { $DefaultInstallDir }
    $Bootstrap = $true
}

$IsUpdate = $false
$RollbackKind = ''       # 'fresh' | 'update' | ''
$RollbackBackupDir = ''  # for update mode: full path to the .backup dir to restore on failure
$OldLockHash = ''        # SHA1 of the previous package-lock.json; used to skip npm ci on no-op updates
$MissingDeps = @()

# ---------- output helpers ----------
#
# NOTE: this file is saved as UTF-8 *with BOM* so PowerShell 5.1 reads
# Unicode characters in the strings (·, ✓, ✗) correctly. Without the BOM,
# PS 5.1 falls back to Windows-1252 and renders them as garbage.

function Write-Step($msg) {
    if (-not $Quiet) { Write-Host "· $msg" -ForegroundColor White }
    Add-LogLine "STEP: $msg"
}
function Write-Ok($msg) {
    if (-not $Quiet) { Write-Host "✓ $msg" -ForegroundColor Green }
    Add-LogLine "OK: $msg"
}
function Write-Warn($msg) {
    Write-Host "! $msg" -ForegroundColor Yellow
    Add-LogLine "WARN: $msg"
}
function Write-Die($msg) {
    Write-Host "✗ $msg" -ForegroundColor Red
    Add-LogLine "DIE: $msg"
    throw $msg
}
function Write-Note($msg) {
    if (-not $Quiet) { Write-Host "  $msg" -ForegroundColor DarkGray }
}

# ---------- logging plumbing ----------

function Initialize-Log {
    $logDir = Split-Path -Parent $InstallLog
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Set-Content -Path $InstallLog -Value '' -Force
}

function Add-LogLine($msg) {
    try {
        $ts = (Get-Date).ToString('HH:mm:ss')
        Add-Content -Path $InstallLog -Value "[$ts] $msg" -ErrorAction SilentlyContinue
    } catch {
        # Never let logging break the install.
    }
}

# Run a script-block. Captures stdout, stderr, AND ErrorRecord objects
# (which is how PowerShell wraps native-command stderr in PS 5.1). Writes
# the full output to the install log. Throws on non-zero $LASTEXITCODE.
#
# CRITICAL: temporarily relaxes $ErrorActionPreference to 'Continue' so a
# native command's harmless stderr (e.g. `npm warn allow-scripts ...`)
# doesn't tear down the whole script. We rely solely on $LASTEXITCODE to
# tell us whether the command actually failed. With the default 'Stop',
# PowerShell 5.1 treats ANY native stderr as a terminating
# NativeCommandError, even for successful runs with exit code 0.
function Invoke-Logged($label, [scriptblock] $block) {
    Add-LogLine "--- $label ---"
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $captured = & $block 2>&1
        foreach ($item in $captured) {
            $text = if ($item -is [System.Management.Automation.ErrorRecord]) {
                $item.Exception.Message
            } else {
                "$item"
            }
            if ($text) { Add-Content -Path $InstallLog -Value $text -ErrorAction SilentlyContinue }
        }
    } finally {
        $ErrorActionPreference = $prevPref
    }
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "$label failed with exit code $LASTEXITCODE"
    }
}

function Invoke-Retry([int] $Attempts, [scriptblock] $Block) {
    $i = 0
    while ($true) {
        try {
            & $Block
            return
        } catch {
            $i++
            if ($i -ge $Attempts) { throw }
            Start-Sleep -Seconds ($i * 2)
        }
    }
}

# ---------- package manager detection ----------

function Get-PackageManager {
    $pms = @()
    if (Get-Command winget -ErrorAction SilentlyContinue) { $pms += 'winget' }
    if (Get-Command scoop  -ErrorAction SilentlyContinue) { $pms += 'scoop' }
    if (Get-Command choco  -ErrorAction SilentlyContinue) { $pms += 'choco' }
    return $pms
}

function Get-InstallCommand($pm, $dep) {
    switch ("${pm}:$dep") {
        'winget:libreoffice' { return 'winget install --id TheDocumentFoundation.LibreOffice --silent' }
        'scoop:libreoffice'  { return 'scoop bucket add extras; scoop install libreoffice' }
        'choco:libreoffice'  { return 'choco install -y libreoffice-fresh' }
        'winget:poppler'     { return $null }
        'scoop:poppler'      { return 'scoop install poppler' }
        'choco:poppler'      { return 'choco install -y poppler' }
        default              { return $null }
    }
}

function Get-DepsInstallPlan($pms, $deps) {
    $commands = @()
    $usedPms = @()
    $skipped = @()
    foreach ($dep in $deps) {
        $matched = $false
        foreach ($pm in $pms) {
            $cmd = Get-InstallCommand $pm $dep
            if ($cmd) {
                $commands += $cmd
                $usedPms += $pm
                $matched = $true
                break
            }
        }
        if (-not $matched) { $skipped += $dep }
    }
    return @{ commands = $commands; usedPms = ($usedPms | Select-Object -Unique); skipped = $skipped }
}

# ---------- rollback ----------

function Invoke-Rollback {
    switch ($RollbackKind) {
        'fresh' {
            if ($RepoDir -and (Test-Path $RepoDir)) {
                Write-Warn "Install failed - removing partial install at $RepoDir"
                Remove-Item -Recurse -Force $RepoDir -ErrorAction SilentlyContinue
            }
        }
        'update' {
            if ($script:RollbackBackupDir -and (Test-Path $script:RollbackBackupDir)) {
                Write-Warn "Update failed - restoring previous install from $($script:RollbackBackupDir)"
                if (Test-Path $RepoDir) { Remove-Item -Recurse -Force $RepoDir -ErrorAction SilentlyContinue }
                Rename-Item -Path $script:RollbackBackupDir -NewName (Split-Path -Leaf $RepoDir) -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Warn "Install log: $InstallLog"
}

# ---------- preflight ----------

function Test-Preflight-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Die "Node is not installed. On Windows, install with: winget install OpenJS.NodeJS.LTS (or scoop install nodejs-lts)"
    }
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Die "npm is not installed. Reinstall Node from https://nodejs.org/"
    }
    $v = (node --version).TrimStart('v')
    $major = [int]($v.Split('.')[0])
    if ($major -lt 20) {
        Write-Die "Node $v is too old. DeckPilot needs Node >= 20. Install with: winget install OpenJS.NodeJS.LTS"
    }
    Write-Ok "Node $v"
}

function Test-Preflight-Disk {
    $target = $RepoDir
    $check = Split-Path -Parent $target
    while ($check -and -not (Test-Path $check)) { $check = Split-Path -Parent $check }
    if (-not $check) { return }
    try {
        $drive = (Get-Item $check).PSDrive
        $availMb = [int]($drive.Free / 1MB)
        if ($availMb -lt 600) {
            Write-Die "Need >= 600 MB free on drive $($drive.Name): only $availMb MB available."
        }
        Write-Ok "Disk: $availMb MB free on drive $($drive.Name):"
    } catch {
        Write-Note "(disk-space check skipped: $($_.Exception.Message))"
    }
}

function Test-Preflight-Network {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Head -Uri 'https://github.com' -TimeoutSec 5
        Write-Ok "Network: github.com reachable"
    } catch {
        Write-Die "Cannot reach https://github.com (5s timeout). Check connectivity / proxy / DNS. Error: $($_.Exception.Message)"
    }
}

function Test-Preflight-Deps {
    $script:MissingDeps = @()
    $hasOffice = $false
    foreach ($name in @('soffice', 'libreoffice', 'soffice.exe')) {
        if (Get-Command $name -ErrorAction SilentlyContinue) { $hasOffice = $true; break }
    }
    if (-not $hasOffice) {
        foreach ($p in @(
            'C:\Program Files\LibreOffice\program\soffice.exe',
            'C:\Program Files (x86)\LibreOffice\program\soffice.exe'
        )) {
            if (Test-Path $p) { $hasOffice = $true; break }
        }
    }
    $hasPdftoppm = [bool] (Get-Command pdftoppm -ErrorAction SilentlyContinue)
    if (-not $hasPdftoppm) {
        if (Test-Path 'C:\ProgramData\chocolatey\bin\pdftoppm.exe') { $hasPdftoppm = $true }
    }

    if ($hasOffice -and $hasPdftoppm) {
        Write-Ok "Visual pipeline deps present (LibreOffice + pdftoppm)"
        return
    }
    if (-not $hasOffice)    { $script:MissingDeps += 'libreoffice' }
    if (-not $hasPdftoppm)  { $script:MissingDeps += 'poppler' }
    Write-Warn "Missing visual-pipeline deps: $($script:MissingDeps -join ', ')"
}

# ---------- deps install ----------

function Get-Consent {
    if ($InstallDeps)   { return $true }
    if ($NoInstallDeps) { return $false }
    if (-not [Environment]::UserInteractive) { return $false }
    if (-not $Host.UI.RawUI) { return $false }
    $reply = Read-Host "Install $($script:MissingDeps -join ', ') now? [y/N]"
    return ($reply -match '^[yY]')
}

function Install-Or-Hint-Deps {
    if ($script:MissingDeps.Count -eq 0) { return }
    Write-Step "System dependencies"
    $pms = Get-PackageManager
    if ($pms.Count -eq 0) {
        Write-Warn "No supported package manager found (winget / scoop / choco)."
        Write-Note "Install winget (Windows 11 has it) or scoop (https://scoop.sh) and re-run with -InstallDeps."
        Write-Note "Manual installs:"
        Write-Note "  LibreOffice: https://www.libreoffice.org/download/download/"
        Write-Note "  poppler:     https://github.com/oschwartz10612/poppler-windows/releases (unzip + add bin to PATH)"
        return
    }
    Write-Note "Detected package manager(s): $($pms -join ', ')"

    $plan = Get-DepsInstallPlan $pms $script:MissingDeps

    if ($plan.skipped.Count -gt 0) {
        Write-Warn "No installer mapping for: $($plan.skipped -join ', ')"
        Write-Note "If you don't have scoop or chocolatey, install one of them, then re-run."
        Write-Note "Quick scoop install (PowerShell):"
        Write-Note "  Set-ExecutionPolicy RemoteSigned -Scope CurrentUser"
        Write-Note "  iwr -useb get.scoop.sh | iex"
    }
    if ($plan.commands.Count -eq 0) {
        return
    }
    Write-Note "Plan:"
    foreach ($c in $plan.commands) { Write-Note "  $c" }
    Write-Note "These deps power vision-driven template extraction and the visual critique loop."
    Write-Note "DeckPilot still installs without them - affected features fall back."

    if (Get-Consent) {
        foreach ($c in $plan.commands) {
            Write-Step "Running: $c"
            try {
                Invoke-Expression $c
            } catch {
                Write-Warn "Command failed: $($_.Exception.Message)"
            }
        }
        Test-Preflight-Deps
    } else {
        Write-Warn "Skipped system-dep install."
        Write-Note "To enable later, run:"
        foreach ($c in $plan.commands) { Write-Note "  $c" }
    }
}

# ---------- bootstrap (zip download path; no git required) ----------

# Derive the owner/repo from the repo URL (handles both git+https and plain
# https forms). Returns "owner/repo".
function Get-RepoSlug([string]$Url) {
    # Strip .git suffix and protocol noise.
    $u = $Url.TrimEnd('/')
    if ($u.EndsWith('.git')) { $u = $u.Substring(0, $u.Length - 4) }
    # Match the trailing /<owner>/<repo>.
    if ($u -match 'github\.com[/:]([^/]+/[^/]+)$') {
        return $Matches[1]
    }
    return $null
}

# Build the GitHub archive URL for the given ref. Handles branches, tags
# (refs/tags/<tag>), and SHAs (7-40 hex chars). GitHub also accepts plain
# branch / tag names under /archive/<name>.zip but the explicit refs paths
# are unambiguous.
function Get-ArchiveUrl([string]$Slug, [string]$Ref) {
    if ($Ref -match '^[0-9a-f]{7,40}$') {
        return "https://github.com/$Slug/archive/$Ref.zip"
    }
    if ($Ref -match '^refs/(heads|tags)/') {
        return "https://github.com/$Slug/archive/$Ref.zip"
    }
    return "https://github.com/$Slug/archive/refs/heads/$Ref.zip"
}

function Get-ArchiveCandidates {
    $candidates = @()
    $urls = @($RepoUrl)
    if ($env:DECKPILOT_REPO_MIRRORS) {
        foreach ($m in $env:DECKPILOT_REPO_MIRRORS -split ',') {
            $m = $m.Trim()
            if ($m) { $urls += $m }
        }
    }
    foreach ($u in $urls) {
        $slug = Get-RepoSlug $u
        if ($slug) {
            $candidates += (Get-ArchiveUrl $slug $Ref)
        }
    }
    return $candidates
}

function Invoke-DownloadAndExtract {
    $target = $RepoDir
    $candidates = Get-ArchiveCandidates
    if ($candidates.Count -eq 0) {
        Write-Die "Could not derive a GitHub archive URL from RepoUrl=$RepoUrl. Set DECKPILOT_REPO_URL to a github.com URL."
    }

    $tmpRoot = Join-Path $env:TEMP "deckpilot-install-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
    try {
        foreach ($url in $candidates) {
            $zipPath = Join-Path $tmpRoot 'archive.zip'
            $extractDir = Join-Path $tmpRoot 'extract'
            Write-Step "Downloading $url"
            try {
                Invoke-Retry 3 {
                    if (Test-Path $zipPath) { Remove-Item -Force $zipPath -ErrorAction SilentlyContinue }
                    # Invoke-WebRequest uses Schannel (Windows cert store) which
                    # accepts the corporate root CA that intercepts HTTPS in many
                    # enterprises. This is why the zip path works on corp boxes
                    # where Git for Windows' OpenSSL bundle fails TLS verify.
                    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zipPath -TimeoutSec 60
                }
            } catch {
                Add-LogLine "download $url failed: $($_.Exception.Message)"
                Write-Warn "Download from $url failed; trying next mirror (if any)."
                continue
            }

            try {
                if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue }
                New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
                Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
            } catch {
                Write-Warn "Extract from $url failed: $($_.Exception.Message); trying next mirror (if any)."
                continue
            }

            # GitHub puts everything under a single top-level dir named
            # <repo>-<ref-without-prefix>. Move that to $target.
            $inner = Get-ChildItem $extractDir | Where-Object PSIsContainer | Select-Object -First 1
            if (-not $inner) {
                Write-Warn "Zip from $url had unexpected contents; trying next mirror (if any)."
                continue
            }

            if (Test-Path $target) { Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue }
            $parent = Split-Path -Parent $target
            if ($parent -and -not (Test-Path $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            Move-Item -Path $inner.FullName -Destination $target
            Write-Ok "Downloaded + extracted from $url"
            return
        }
        Write-Die "All download targets failed. Check connectivity / DECKPILOT_REPO_URL / DECKPILOT_REPO_MIRRORS."
    } finally {
        Remove-Item -Recurse -Force $tmpRoot -ErrorAction SilentlyContinue
    }
}

function Get-LockHash([string]$dir) {
    $lock = Join-Path $dir 'package-lock.json'
    if (Test-Path $lock) {
        return (Get-FileHash $lock -Algorithm SHA1).Hash
    }
    return ''
}

function Invoke-Bootstrap {
    if (-not $Bootstrap) { return }

    $parent = Split-Path -Parent $RepoDir
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path $RepoDir) {
        # Existing install. Snapshot for rollback + needs-install detection.
        $script:OldLockHash = Get-LockHash $RepoDir
        $backupDir = "$RepoDir.backup"
        if (Test-Path $backupDir) { Remove-Item -Recurse -Force $backupDir -ErrorAction SilentlyContinue }
        # Rename rather than copy — fast and avoids doubling disk usage.
        Rename-Item -Path $RepoDir -NewName (Split-Path -Leaf $backupDir)
        $script:RollbackBackupDir = $backupDir
        $script:RollbackKind = 'update'
        Write-Step "Updating $RepoDir (ref: $Ref)"
        Invoke-DownloadAndExtract
        # Preserve node_modules from the previous install — Move is cheap.
        $oldNm = Join-Path $backupDir 'node_modules'
        if (Test-Path $oldNm) {
            $newNm = Join-Path $RepoDir 'node_modules'
            if (-not (Test-Path $newNm)) {
                try {
                    Move-Item -Path $oldNm -Destination $newNm
                    Write-Note "(preserved node_modules from previous install)"
                } catch {
                    # Non-fatal — npm ci will repopulate.
                }
            }
        }
    } else {
        $script:RollbackKind = 'fresh'
        Invoke-DownloadAndExtract
    }
}

# ---------- update detection ----------

function Test-IsUpdateMode {
    if ($Reinstall) { $script:IsUpdate = $false; return }
    if ($Update)    { $script:IsUpdate = $true; return }
    if (-not $Bootstrap -and (Get-Command deckpilot -ErrorAction SilentlyContinue)) {
        $script:IsUpdate = $true
        return
    }
    if ($script:RollbackKind -eq 'update') {
        $script:IsUpdate = $true
        return
    }
    $script:IsUpdate = $false
}

# ---------- build ----------

function Invoke-Build {
    $needInstall = $true
    if ($IsUpdate -and $script:OldLockHash) {
        $newHash = Get-LockHash $RepoDir
        if ($newHash -and ($newHash -eq $script:OldLockHash)) {
            $needInstall = $false
            Write-Note "(package-lock unchanged - skipping npm ci)"
        }
    }

    if ($needInstall) {
        Write-Step "Installing npm deps"
        Push-Location $RepoDir
        try {
            $cmd = if (Test-Path 'package-lock.json') { 'npm ci' } else { 'npm install' }
            Invoke-Retry 2 { Invoke-Logged $cmd { Invoke-Expression $cmd } }
            Write-Ok "Dependencies installed"
        } finally { Pop-Location }
    }

    if ($NoBuild) {
        Write-Warn "Skipping build (-NoBuild)"
        return
    }
    Write-Step "Building TypeScript"
    Push-Location $RepoDir
    try {
        Invoke-Logged 'npm run build' { npm run build }
        Write-Ok "Build complete"
        Write-Step "Generating oclif manifest"
        try {
            Invoke-Logged 'npx oclif manifest' { npx oclif manifest }
            Write-Ok "Manifest ready"
        } catch {
            Write-Warn "oclif manifest skipped (non-fatal)"
        }
    } finally { Pop-Location }
}

# ---------- link ----------

function Invoke-LinkUser {
    Write-Step "Linking globally (npm link)"
    Push-Location $RepoDir
    try {
        Invoke-Logged 'npm link' { npm link }
    } finally { Pop-Location }

    $prefix = (npm prefix -g).Trim()
    $expected = Join-Path $prefix 'deckpilot.cmd'
    if (-not ((Test-Path $expected) -or (Test-Path (Join-Path $prefix 'deckpilot.ps1')))) {
        Write-Warn "npm link reported success but $prefix\deckpilot.cmd is missing."
        Write-Warn "You may need to add the npm global bin to PATH manually:"
        Write-Note "  $prefix"
        return
    }
    Write-Ok "Linked into $prefix\deckpilot.cmd"
    Test-PathContains $prefix
}

function Invoke-LinkSystem {
    Write-Step "Linking system-wide (requires admin)"
    Push-Location $RepoDir
    try {
        Invoke-Logged 'npm link (system)' { npm link }
        Write-Ok "Linked via npm."
    } finally { Pop-Location }
}

function Test-PathContains($bin) {
    $entries = $env:Path -split ';'
    $found = $false
    foreach ($e in $entries) {
        if (($e -ieq $bin) -or ($e.TrimEnd('\') -ieq $bin.TrimEnd('\'))) {
            $found = $true; break
        }
    }
    if ($found) { return }
    Write-Warn "$bin is not on your PATH in this session."
    Write-Note "Add it permanently via:"
    # PowerShell quoting: backtick-quote escapes a literal " inside a
    # double-quoted string; backtick-dollar suppresses subexpression eval.
    # $bin IS interpolated so the user copy-pastes the actual path.
    Write-Note "  [Environment]::SetEnvironmentVariable('Path', `"`$([Environment]::GetEnvironmentVariable('Path','User'));$bin`", 'User')"
    Write-Note "Or open a new shell - npm's install of Node typically adds it on first run."
}

# ---------- uninstall ----------

function Invoke-Uninstall {
    Write-Step "Uninstalling DeckPilot"
    if (Test-Path $RepoDir) {
        Push-Location $RepoDir -ErrorAction SilentlyContinue
        try {
            Invoke-Logged 'npm unlink -g' { npm unlink -g deckpilot } 2>$null
        } catch { } finally { Pop-Location -ErrorAction SilentlyContinue }
    }
    $prefix = try { (npm prefix -g).Trim() } catch { $null }
    if ($prefix) {
        foreach ($f in @('deckpilot', 'deckpilot.cmd', 'deckpilot.ps1')) {
            $p = Join-Path $prefix $f
            if (Test-Path $p) { Remove-Item -Force $p; Write-Ok "Removed $p" }
        }
    }
    if ($Bootstrap -and (Test-Path $RepoDir)) {
        Remove-Item -Recurse -Force $RepoDir
        Write-Ok "Removed install dir at $RepoDir"
    }
    Write-Ok "Done."
    # Do NOT call exit here — under `iwr | iex` it terminates the host
    # PowerShell session. `return` only exits this function.
    return
}

# ---------- verify ----------

function Test-Smoke {
    Write-Step "Smoke test"
    $dp = Get-Command deckpilot -ErrorAction SilentlyContinue
    if (-not $dp) {
        Write-Warn "deckpilot not yet on PATH in this shell - open a new shell and run: deckpilot doctor"
        return
    }
    try {
        $v = deckpilot --version
        Write-Ok $v
    } catch {
        Write-Warn "deckpilot --version failed; try: deckpilot doctor"
    }
}

function Invoke-Doctor {
    if ($SkipDoctor) { Write-Note "(-SkipDoctor - verification skipped)"; return }
    if (-not (Get-Command deckpilot -ErrorAction SilentlyContinue)) {
        Write-Note "(doctor skipped - deckpilot not on PATH)"
        return
    }
    Write-Step "Running deckpilot doctor"
    try {
        $output = deckpilot doctor 2>&1
        $output | ForEach-Object { Write-Host $_ }
        $output | ForEach-Object { Add-LogLine $_.ToString() }
    } catch {
        # Doctor's non-zero exit is advisory.
    }
}

# ---------- main ----------

function Invoke-Main {
    Write-Host "DeckPilot installer v$INSTALL_SCRIPT_VERSION" -ForegroundColor White

    Initialize-Log
    Add-LogLine "argv: $($args -join ' ')"
    Add-LogLine "RepoUrl=$RepoUrl Ref=$Ref RepoDir=$RepoDir Bootstrap=$Bootstrap Mode=$(if ($System) {'system'} else {'user'})"

    try {
        if ($Uninstall) {
            Invoke-Uninstall
            return
        }

        Write-Step "Preflight"
        Test-Preflight-Node
        Test-Preflight-Disk
        Test-Preflight-Network
        Test-Preflight-Deps

        if ($MissingDeps.Count -gt 0) {
            Install-Or-Hint-Deps
        }

        Invoke-Bootstrap

        Test-IsUpdateMode
        if ($IsUpdate) {
            Write-Step "Update mode (existing install detected)"
            Write-Note "Skipping link step. Re-run with -Reinstall to force the full path."
        }

        Invoke-Build

        if (-not $IsUpdate) {
            if ($System) { Invoke-LinkSystem } else { Invoke-LinkUser }
        }

        Test-Smoke
        Invoke-Doctor

        # Clean up the rollback backup on success.
        if ($script:RollbackBackupDir -and (Test-Path $script:RollbackBackupDir)) {
            Remove-Item -Recurse -Force $script:RollbackBackupDir -ErrorAction SilentlyContinue
        }

        Write-Host ''
        if ($IsUpdate) {
            Write-Host "DeckPilot updated." -ForegroundColor White
        } else {
            Write-Host "DeckPilot is ready." -ForegroundColor White
        }
        if ($Bootstrap) { Write-Host "  Source:      $RepoDir" }
        Write-Host "  Install log: $InstallLog"
        Write-Host "  Try: deckpilot            # open the menu"
        Write-Host "       deckpilot auth login # if you haven't authenticated Copilot CLI yet"
        Write-Host ''
        Write-Host "To update:    .\install.ps1 -Update     (or just re-run this script)" -ForegroundColor DarkGray
        Write-Host "To uninstall: .\install.ps1 -Uninstall" -ForegroundColor DarkGray
    } catch {
        Invoke-Rollback
        throw
    }
}

Invoke-Main
