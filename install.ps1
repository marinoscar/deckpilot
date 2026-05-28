# DeckPilot installer for Windows (PowerShell 5.1+ / PowerShell 7+).
#
# Mirrors install.sh: clones the repo (or uses your local checkout), builds,
# links the `deckpilot` command, offers to install LibreOffice + poppler
# (the visual-pipeline deps), then runs `deckpilot doctor` to verify the
# install end-to-end. Re-running it auto-detects existing installs and
# switches into a fast update path.
#
# Usage:
#   .\install.ps1                       install for the current user via `npm link`
#   .\install.ps1 -System               install system-wide (requires admin)
#   .\install.ps1 -Update               fast-path: fetch + build only
#   .\install.ps1 -Reinstall            force full install path even on an existing install
#   .\install.ps1 -InstallDeps          install missing system deps without prompt
#   .\install.ps1 -NoInstallDeps        never auto-install system deps; just print the command
#   .\install.ps1 -SkipDoctor           skip the final `deckpilot doctor` verification
#   .\install.ps1 -Uninstall            remove the symlink + (if bootstrapped) the clone
#   .\install.ps1 -NoBuild              skip the TypeScript build
#   .\install.ps1 -Quiet                less chatty
#   .\install.ps1 -Log <path>           override the install log location
#
# Remote install:
#   iwr -useb https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.ps1 | iex
#
# Environment variables:
#   DECKPILOT_INSTALL_DIR     where to clone when bootstrapping (default $HOME\.deckpilot\repo)
#   DECKPILOT_REPO_URL        primary git URL to clone
#   DECKPILOT_REPO_MIRRORS    comma-separated fallback mirrors
#   DECKPILOT_REF             git ref to check out (default main)
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

$INSTALL_SCRIPT_VERSION = '0.14.2'

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
$RollbackKind = ''     # 'fresh' | 'update' | ''
$RollbackSha = ''      # previous HEAD SHA when RollbackKind='update'
$MissingDeps = @()

# ---------- output helpers ----------

function Write-Step($msg) {
    if (-not $Quiet) { Write-Host "`u{00B7} $msg" -ForegroundColor White }
    Add-LogLine "STEP: $msg"
}
function Write-Ok($msg) {
    if (-not $Quiet) { Write-Host "`u{2713} $msg" -ForegroundColor Green }
    Add-LogLine "OK: $msg"
}
function Write-Warn($msg) {
    Write-Host "! $msg" -ForegroundColor Yellow
    Add-LogLine "WARN: $msg"
}
function Write-Die($msg) {
    Write-Host "`u{2717} $msg" -ForegroundColor Red
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
    # Truncate per-run.
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

# Run a script-block, redirecting all output to the log. Throws on failure.
function Invoke-Logged($label, [scriptblock] $block) {
    Add-LogLine "--- $label ---"
    & $block 2>&1 | ForEach-Object {
        Add-Content -Path $InstallLog -Value $_.ToString() -ErrorAction SilentlyContinue
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
    # Prefer winget for LibreOffice (built into Windows 11), scoop/choco for poppler.
    $pms = @()
    if (Get-Command winget -ErrorAction SilentlyContinue) { $pms += 'winget' }
    if (Get-Command scoop  -ErrorAction SilentlyContinue) { $pms += 'scoop' }
    if (Get-Command choco  -ErrorAction SilentlyContinue) { $pms += 'choco' }
    return $pms
}

# Map (pm, logical-dep) -> the exact command to install it.
# Logical deps: libreoffice, poppler.
function Get-InstallCommand($pm, $dep) {
    switch ("${pm}:$dep") {
        'winget:libreoffice' { return 'winget install --id TheDocumentFoundation.LibreOffice --silent' }
        'scoop:libreoffice'  { return 'scoop bucket add extras; scoop install libreoffice' }
        'choco:libreoffice'  { return 'choco install -y libreoffice-fresh' }
        'winget:poppler'     { return $null }     # winget does not ship poppler
        'scoop:poppler'      { return 'scoop install poppler' }
        'choco:poppler'      { return 'choco install -y poppler' }
        default              { return $null }
    }
}

function Get-DepsInstallPlan($pms, $deps) {
    # Returns @{ commands = @(...); usedPms = @(...); skipped = @() }
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
                Write-Warn "Install failed — removing partial clone at $RepoDir"
                Remove-Item -Recurse -Force $RepoDir -ErrorAction SilentlyContinue
            }
        }
        'update' {
            if ($RollbackSha -and (Test-Path (Join-Path $RepoDir '.git'))) {
                Write-Warn "Update failed — rolling back $RepoDir to $RollbackSha"
                try {
                    Push-Location $RepoDir
                    Invoke-Logged 'rollback git reset' { git reset --hard $RollbackSha }
                } catch {
                    # nothing else we can do
                } finally {
                    Pop-Location -ErrorAction SilentlyContinue
                }
            }
        }
    }
    Write-Warn "Install log: $InstallLog"
}

# ---------- preflight ----------

function Test-Preflight-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Die "Node is not installed. On Windows, install with: winget install OpenJS.NodeJS.LTS"
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

function Test-Preflight-Git {
    if ($Bootstrap -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Die "git is not installed (needed for bootstrap clone). Install with: winget install Git.Git"
    }
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
    # Test whether we actually have a stdin to read from. In `iwr | iex` the
    # script runs interactively but stdin may still be piped — Host.UI.RawUI is
    # the safer probe.
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
        Write-Note "Install winget (Windows 11 has it) or scoop (https://scoop.sh) and re-run with --install-deps."
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
    Write-Note "DeckPilot still installs without them — affected features fall back."

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

# ---------- bootstrap ----------

function Get-Mirrors {
    $mirrors = @($RepoUrl)
    if ($env:DECKPILOT_REPO_MIRRORS) {
        foreach ($m in $env:DECKPILOT_REPO_MIRRORS -split ',') {
            $m = $m.Trim()
            if ($m) { $mirrors += $m }
        }
    }
    return $mirrors
}

function Invoke-Clone {
    $target = $RepoDir
    $mirrors = Get-Mirrors
    foreach ($url in $mirrors) {
        Write-Step "Cloning $url@$Ref -> $target"
        try {
            Invoke-Retry 3 {
                if (Test-Path $target) { Remove-Item -Recurse -Force $target }
                Invoke-Logged 'git clone' { git clone --depth=1 --branch $Ref $url $target }
            }
            Write-Ok "Cloned from $url"
            return
        } catch {
            Write-Warn "Clone from $url failed after 3 attempts; trying next mirror (if any)."
        }
    }
    Write-Die "All clone targets failed. Check connectivity / DECKPILOT_REPO_URL / DECKPILOT_REPO_MIRRORS."
}

function Invoke-Bootstrap {
    if (-not $Bootstrap) { return }
    $parent = Split-Path -Parent $RepoDir
    if ($parent -and -not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (Test-Path (Join-Path $RepoDir '.git')) {
        Push-Location $RepoDir
        try {
            $script:RollbackSha = (git rev-parse HEAD).Trim()
            $script:RollbackKind = 'update'
            Write-Step "Updating existing clone at $RepoDir (ref: $Ref)"
            Invoke-Retry 3 {
                Invoke-Logged 'git fetch' { git fetch --depth=1 origin $Ref }
                Invoke-Logged 'git checkout' { git checkout -q $Ref }
                Invoke-Logged 'git reset' { git reset --hard "origin/$Ref" }
            }
            Write-Ok "Updated."
        } catch {
            Write-Die "Could not update $RepoDir. Run with -Reinstall to wipe + re-clone."
        } finally {
            Pop-Location
        }
    } else {
        if ((Test-Path $RepoDir) -and (Get-ChildItem $RepoDir -Force | Select-Object -First 1)) {
            Write-Die "$RepoDir exists and is not a git checkout. Set DECKPILOT_INSTALL_DIR or remove it."
        }
        $script:RollbackKind = 'fresh'
        Invoke-Clone
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
    $script:IsUpdate = $false
}

# ---------- build ----------

function Invoke-Build {
    $needInstall = $true
    if ($IsUpdate -and $RollbackSha -and (Test-Path (Join-Path $RepoDir '.git'))) {
        Push-Location $RepoDir
        try {
            git diff --quiet $RollbackSha HEAD -- package-lock.json
            if ($LASTEXITCODE -eq 0) {
                $needInstall = $false
                Write-Note "(package-lock unchanged - skipping npm ci)"
            }
        } catch { } finally { Pop-Location }
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
    # On Windows the "system" install is just npm link with admin privileges;
    # the global prefix gets created under %ProgramData% or %ProgramFiles%
    # depending on how Node was installed. The user just needs npm to be
    # elevated; we shell out to npm and let it handle the placement.
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
    # NOTE: PowerShell quoting — backtick-quote (`") for literal double quotes,
    # backtick-dollar (`$) to suppress subexpression evaluation. $bin IS
    # interpolated so the user copy-pastes the actual path.
    Write-Note "  [Environment]::SetEnvironmentVariable('Path', `"`$([Environment]::GetEnvironmentVariable('Path','User'));$bin`", 'User')"
    Write-Note "Or open a new shell — npm's install of Node typically adds it on first run."
}

# ---------- uninstall ----------

function Invoke-Uninstall {
    Write-Step "Uninstalling DeckPilot"
    Push-Location $RepoDir -ErrorAction SilentlyContinue
    try {
        Invoke-Logged 'npm unlink -g' { npm unlink -g deckpilot } 2>$null
    } catch { } finally { Pop-Location -ErrorAction SilentlyContinue }
    $prefix = try { (npm prefix -g).Trim() } catch { $null }
    if ($prefix) {
        foreach ($f in @('deckpilot', 'deckpilot.cmd', 'deckpilot.ps1')) {
            $p = Join-Path $prefix $f
            if (Test-Path $p) { Remove-Item -Force $p; Write-Ok "Removed $p" }
        }
    }
    if ($Bootstrap -and (Test-Path (Join-Path $RepoDir '.git'))) {
        Remove-Item -Recurse -Force $RepoDir
        Write-Ok "Removed bootstrap checkout at $RepoDir"
    }
    Write-Ok "Done."
    # IMPORTANT: do NOT call `exit` here. When this script is invoked via
    # `iwr | iex`, `exit` terminates the host PowerShell session itself —
    # the user's window closes and they can't see what just happened.
    # Using `return` only exits this function; the caller (Invoke-Main)
    # checks for $Uninstall and returns afterwards.
    return
}

# ---------- verify ----------

function Test-Smoke {
    Write-Step "Smoke test"
    $dp = Get-Command deckpilot -ErrorAction SilentlyContinue
    if (-not $dp) {
        Write-Warn "deckpilot not yet on PATH in this shell — open a new shell and run: deckpilot doctor"
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
    if ($SkipDoctor) { Write-Note "(-SkipDoctor — verification skipped)"; return }
    if (-not (Get-Command deckpilot -ErrorAction SilentlyContinue)) {
        Write-Note "(doctor skipped — deckpilot not on PATH)"
        return
    }
    Write-Step "Running deckpilot doctor"
    try {
        $output = deckpilot doctor 2>&1
        $output | ForEach-Object { Write-Host $_ }
        $output | ForEach-Object { Add-LogLine $_.ToString() }
    } catch {
        # Doctor's non-zero exit is advisory — don't fail the install.
    }
}

# ---------- main ----------

# Wrap the whole flow in a function. Critical for `iwr | iex` callers:
# `exit` at the top level of a script invoked through Invoke-Expression
# terminates the HOST PowerShell session, which makes the window close
# before the user can see any error. Inside a function, `return` only
# exits the function, and uncaught `throw` propagates as a normal error
# without killing the session.

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
        Test-Preflight-Git
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

        Write-Host ''
        if ($IsUpdate) {
            Write-Host "DeckPilot updated." -ForegroundColor White
        } else {
            Write-Host "DeckPilot is ready." -ForegroundColor White
        }
        if ($Bootstrap) { Write-Host "  Source checkout: $RepoDir" }
        Write-Host "  Install log:     $InstallLog"
        Write-Host "  Try: deckpilot            # open the menu"
        Write-Host "       deckpilot auth login # if you haven't authenticated Copilot CLI yet"
        Write-Host ''
        Write-Host "To update:    .\install.ps1 -Update     (or just re-run this script)" -ForegroundColor DarkGray
        Write-Host "To uninstall: .\install.ps1 -Uninstall" -ForegroundColor DarkGray
    } catch {
        Invoke-Rollback
        # Re-throw so the user sees the actual error message. PowerShell
        # surfaces uncaught exceptions but does NOT terminate the session.
        throw
    }
}

Invoke-Main
