#!/usr/bin/env bash
# DeckPilot installer — one-command install, idempotent, makes `deckpilot`
# available on PATH from any directory. Works both inside a cloned repo and
# bootstrapped from the GitHub raw URL via `curl | bash`.
#
# Usage:
#   ./install.sh                       install for current user via `npm link`
#   ./install.sh --system              install system-wide via /usr/local/bin (uses sudo)
#   ./install.sh --update              fast-path: fetch + build only (auto-detected on re-run)
#   ./install.sh --reinstall           force the full install path even on an existing install
#   ./install.sh --install-deps        install missing system deps without the y/N prompt
#   ./install.sh --no-install-deps     never install system deps; just print the command
#   ./install.sh --skip-doctor         skip the final `deckpilot doctor` verification
#   ./install.sh --uninstall           remove the symlink + (if bootstrapped) the clone
#   ./install.sh --no-build            skip the TypeScript build (dev relink)
#   ./install.sh --quiet               less chatty
#   ./install.sh --log <path>          override the install log location
#
# Remote install (Ubuntu/Debian/Fedora/Arch/openSUSE/macOS/WSL):
#   curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
#
# Env vars:
#   DECKPILOT_INSTALL_DIR    where to clone the repo when bootstrapping
#                            (default: $HOME/.deckpilot/repo)
#   DECKPILOT_REPO_URL       primary git URL to clone (default: the official repo)
#   DECKPILOT_REPO_MIRRORS   comma-separated additional mirrors to try on clone failure
#   DECKPILOT_REF            git ref to check out (default: main)
#   DECKPILOT_INSTALL_LOG    where to write the install log
#                            (default: $HOME/.deckpilot/install.log)
#
# Re-running is safe — by default it switches into an update fast-path
# (fetch + rebuild only) when an existing install is detected.

set -euo pipefail

# Bumped on every release of the installer. Printed at the top of every run so
# users can confirm what they're actually executing (CDN cache misses are real).
INSTALL_SCRIPT_VERSION="0.14.4"

# NOTE: do NOT redirect bash's own stdin here. Under `curl ... | bash`, bash IS
# reading the script from stdin. Redirecting stdin at the top would make bash
# EOF on its next read and exit, dropping curl's outbound writes (curl error 23
# "Failure writing output to destination"). Stdin isolation for child processes
# happens at the bottom of the script by wrapping the main flow in a subshell
# with `</dev/null` — see "# ---------- main ----------".

# ---------- argument parsing ----------

MODE="user"
SKIP_BUILD=0
QUIET=0
ACTION="install"
FORCE_INSTALL_DEPS=""   # "" / "yes" / "no"
SKIP_DOCTOR=0
FORCE_UPDATE=0          # set by --update; auto-detected too
FORCE_REINSTALL=0       # set by --reinstall

while [ $# -gt 0 ]; do
  case "$1" in
    --system)          MODE="system"; shift ;;
    --uninstall)       ACTION="uninstall"; shift ;;
    --no-build)        SKIP_BUILD=1; shift ;;
    --quiet)           QUIET=1; shift ;;
    --update)          FORCE_UPDATE=1; shift ;;
    --reinstall)       FORCE_REINSTALL=1; shift ;;
    --install-deps)    FORCE_INSTALL_DEPS="yes"; shift ;;
    --no-install-deps) FORCE_INSTALL_DEPS="no"; shift ;;
    --skip-doctor)     SKIP_DOCTOR=1; shift ;;
    --log)
      shift
      [ -n "${1:-}" ] || { echo "--log requires a path argument" >&2; exit 2; }
      DECKPILOT_INSTALL_LOG="$1"; shift
      ;;
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

DEFAULT_REPO_URL="https://github.com/marinoscar/deckpilot.git"
DEFAULT_REF="main"
DEFAULT_INSTALL_DIR="$HOME/.deckpilot/repo"
DEFAULT_LOG="$HOME/.deckpilot/install.log"

REPO_URL="${DECKPILOT_REPO_URL:-$DEFAULT_REPO_URL}"
REF="${DECKPILOT_REF:-$DEFAULT_REF}"
SYSTEM_LINK="/usr/local/bin/deckpilot"
LOG="${DECKPILOT_INSTALL_LOG:-$DEFAULT_LOG}"
DECKPILOT_HOME_DIR="$HOME/.deckpilot"

# Detect whether this script lives inside a real deckpilot checkout. If yes,
# use it. Otherwise (curl | bash, or running outside the repo), clone into
# $DECKPILOT_INSTALL_DIR and treat that as the source of truth.
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
if [ -f "$SCRIPT_PATH" ]; then
  CANDIDATE_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
else
  CANDIDATE_DIR=""
fi

if [ -n "$CANDIDATE_DIR" ] \
   && [ -f "$CANDIDATE_DIR/package.json" ] \
   && grep -q '"name": "deckpilot"' "$CANDIDATE_DIR/package.json" 2>/dev/null; then
  REPO_DIR="$CANDIDATE_DIR"
  BOOTSTRAP=0
else
  REPO_DIR="${DECKPILOT_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
  BOOTSTRAP=1
fi

# IS_UPDATE is computed AFTER preflight, once we know whether deckpilot is
# already linked. Initialised here so set -u is happy.
IS_UPDATE=0

# Rollback state — set during destructive steps so the ERR trap knows what
# to undo. Empty when nothing to undo.
ROLLBACK_KIND=""    # "fresh" | "update" | ""
ROLLBACK_SHA=""     # previous HEAD SHA when ROLLBACK_KIND=update

# ---------- colors + helpers ----------

if [ -t 1 ]; then
  G="$(printf '\033[32m')"; R="$(printf '\033[31m')"; Y="$(printf '\033[33m')"
  B="$(printf '\033[1m')"; D="$(printf '\033[2m')"; X="$(printf '\033[0m')"
else
  G=""; R=""; Y=""; B=""; D=""; X=""
fi

say()  { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
ok()   { [ "$QUIET" -eq 1 ] || printf '%s✓%s %s\n' "$G" "$X" "$*"; log_line "OK: $*"; }
warn() { printf '%s!%s %s\n' "$Y" "$X" "$*" >&2; log_line "WARN: $*"; }
die()  { printf '%s✗%s %s\n' "$R" "$X" "$*" >&2; log_line "DIE: $*"; exit 1; }
step() { [ "$QUIET" -eq 1 ] || printf '%s· %s%s\n' "$B" "$*" "$X"; log_line "STEP: $*"; }
note() { [ "$QUIET" -eq 1 ] || printf '%s  %s%s\n' "$D" "$*" "$X"; }

# ---------- logging plumbing ----------

ensure_log() {
  mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
  # Truncate per-run so the log reflects only the current attempt.
  : >"$LOG" 2>/dev/null || true
}

log_line() {
  # No-op if the log file isn't writable — never let logging kill the install.
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG" 2>/dev/null || true
}

# Run a command with stdout+stderr appended to the log. The command's own exit
# code is propagated. Used for noisy steps (npm ci, npm run build) where the
# user doesn't want a wall of output but we want a record for support.
run_logged() {
  local label=$1; shift
  printf '\n--- %s ---\n' "$label" >>"$LOG" 2>/dev/null || true
  "$@" >>"$LOG" 2>&1
}

# Retry a command N times with linear backoff. Used for clone + npm ci.
retry() {
  local attempts=${1:-3}; shift
  local i=0
  until "$@"; do
    i=$((i + 1))
    if [ "$i" -ge "$attempts" ]; then
      return 1
    fi
    sleep "$((i * 2))"
  done
}

# ---------- rollback trap ----------

rollback_on_error() {
  local exit_code=$?
  # Disable the trap so we don't recurse.
  trap - ERR
  if [ "$exit_code" -eq 0 ]; then return 0; fi
  case "$ROLLBACK_KIND" in
    fresh)
      if [ -n "$REPO_DIR" ] && [ -d "$REPO_DIR" ]; then
        warn "Install failed — removing partial clone at $REPO_DIR"
        rm -rf "$REPO_DIR" 2>/dev/null || true
      fi
      ;;
    update)
      if [ -n "$ROLLBACK_SHA" ] && [ -d "$REPO_DIR/.git" ]; then
        warn "Update failed — rolling back $REPO_DIR to $ROLLBACK_SHA"
        (cd "$REPO_DIR" && git reset --hard "$ROLLBACK_SHA") >>"$LOG" 2>&1 || true
      fi
      ;;
  esac
  warn "Install log: $LOG"
}

# ---------- platform detection ----------

detect_os() {
  case "$(uname -s 2>/dev/null)" in
    Linux)
      if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        echo wsl
      else
        echo linux
      fi
      ;;
    Darwin) echo macos ;;
    *)      echo unknown ;;
  esac
}

detect_pm() {
  # macOS: brew unconditionally if present (xcode otherwise — not handled).
  if [ "$(detect_os)" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      echo brew
    else
      echo unknown
    fi
    return
  fi
  # Linux: order matters when multiple are available. apt wins on Debian-likes.
  local pm
  for pm in apt-get apt dnf pacman zypper; do
    if command -v "$pm" >/dev/null 2>&1; then
      # Normalise apt-get → apt.
      case "$pm" in
        apt-get) echo apt ;;
        *)       echo "$pm" ;;
      esac
      return
    fi
  done
  echo unknown
}

# Map (package-manager, logical-dep) → distro package name(s).
# Logical deps used: libreoffice, poppler, git.
# Echoes space-separated package names, OR a special marker for brew casks.
pm_pkgname() {
  local pm=$1 dep=$2
  case "$pm:$dep" in
    apt:libreoffice)     echo libreoffice ;;
    dnf:libreoffice)     echo libreoffice ;;
    pacman:libreoffice)  echo libreoffice-fresh ;;
    zypper:libreoffice)  echo libreoffice ;;
    brew:libreoffice)    echo "CASK:libreoffice" ;;
    apt:poppler)         echo poppler-utils ;;
    dnf:poppler)         echo poppler-utils ;;
    pacman:poppler)      echo poppler ;;
    zypper:poppler)      echo poppler-tools ;;
    brew:poppler)        echo poppler ;;
    apt:git)             echo git ;;
    dnf:git)             echo git ;;
    pacman:git)          echo git ;;
    zypper:git)          echo git ;;
    brew:git)            echo git ;;
    *)                   return 1 ;;
  esac
}

# Returns the exact one-liner the user (or this script) should run to install
# the given logical deps. Used both for hint-only mode and for the actual
# install call.
pm_install_cmd() {
  local pm=$1; shift
  local pkgs=""
  local cask_pkgs=""
  local dep pkg
  for dep in "$@"; do
    if ! pkg=$(pm_pkgname "$pm" "$dep"); then
      echo "# Unknown package mapping for $dep on $pm" >&2
      continue
    fi
    case "$pkg" in
      CASK:*) cask_pkgs="$cask_pkgs ${pkg#CASK:}" ;;
      *)      pkgs="$pkgs $pkg" ;;
    esac
  done
  # Strip leading whitespace.
  pkgs="${pkgs# }"
  cask_pkgs="${cask_pkgs# }"

  case "$pm" in
    apt)
      printf 'sudo apt-get update && sudo apt-get install -y %s' "$pkgs"
      ;;
    dnf)
      printf 'sudo dnf install -y %s' "$pkgs"
      ;;
    pacman)
      printf 'sudo pacman -Sy --noconfirm %s' "$pkgs"
      ;;
    zypper)
      printf 'sudo zypper --non-interactive install %s' "$pkgs"
      ;;
    brew)
      if [ -n "$cask_pkgs" ] && [ -n "$pkgs" ]; then
        printf 'brew install --cask %s && brew install %s' "$cask_pkgs" "$pkgs"
      elif [ -n "$cask_pkgs" ]; then
        printf 'brew install --cask %s' "$cask_pkgs"
      else
        printf 'brew install %s' "$pkgs"
      fi
      ;;
    *)
      printf '# Unknown package manager — install manually: %s%s' "$pkgs" "${cask_pkgs:+ (casks: $cask_pkgs)}"
      ;;
  esac
}

# Actually run the install command for the given deps via the detected PM.
# Caller is responsible for consent.
pm_install() {
  local pm=$1; shift
  local cmd
  cmd=$(pm_install_cmd "$pm" "$@")
  step "Running: $cmd"
  # Stream output so the user sees sudo password prompts in real time.
  /bin/bash -c "$cmd"
}

# ---------- preflight ----------

preflight_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "Node is not installed. On Ubuntu/WSL:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  Or use nvm:
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    nvm install 22"
  fi
  command -v npm >/dev/null 2>&1 || die "npm is not installed. Reinstall Node from https://nodejs.org/"
  local v major
  v="$(node --version | sed 's/^v//')"
  major="${v%%.*}"
  if [ "$major" -lt 20 ]; then
    die "Node $v is too old. DeckPilot needs Node ≥ 20. Try 'nvm install 22'."
  fi
  ok "Node $v"
}

preflight_git() {
  if [ "$BOOTSTRAP" -eq 1 ] && ! command -v git >/dev/null 2>&1; then
    die "git is not installed (needed for bootstrap clone). On Ubuntu/WSL: sudo apt-get install -y git"
  fi
}

# Require ≥600MB free in the install dir's parent. node_modules alone is ~400MB.
preflight_disk() {
  local target check_dir avail_kb avail_mb
  target="$REPO_DIR"
  check_dir="$(dirname "$target")"
  # If the parent doesn't exist yet, walk up until we find one that does.
  while [ ! -d "$check_dir" ] && [ "$check_dir" != "/" ]; do
    check_dir="$(dirname "$check_dir")"
  done
  # df -k is portable across linux/macos. Tail -1 picks the data row.
  avail_kb="$(df -k "$check_dir" 2>/dev/null | tail -1 | awk '{ print $4 }')"
  if [ -z "$avail_kb" ] || ! [ "$avail_kb" -eq "$avail_kb" ] 2>/dev/null; then
    # df failed or returned non-numeric — skip this check rather than block.
    note "(disk-space check skipped — df unavailable)"
    return 0
  fi
  avail_mb=$((avail_kb / 1024))
  if [ "$avail_mb" -lt 600 ]; then
    die "Need ≥ 600 MB free in $check_dir, but only ${avail_mb} MB available."
  fi
  ok "Disk: ${avail_mb} MB free in $check_dir"
}

# Curl -sI github.com with a 5s timeout. Network outages exit before any
# destructive step.
preflight_network() {
  if ! command -v curl >/dev/null 2>&1; then
    note "(network check skipped — curl unavailable)"
    return 0
  fi
  if curl -sSI --max-time 5 https://github.com >/dev/null 2>&1; then
    ok "Network: github.com reachable"
  else
    die "Cannot reach https://github.com (5s timeout). Check connectivity / proxy / DNS."
  fi
}

# Detect LibreOffice + poppler. Returns a list of missing logical deps via
# the global MISSING_DEPS array.
MISSING_DEPS=()
preflight_deps() {
  MISSING_DEPS=()
  local has_office=0 has_pdftoppm=0
  if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
    has_office=1
  fi
  if command -v pdftoppm >/dev/null 2>&1; then
    has_pdftoppm=1
  fi
  if [ "$has_office" -eq 1 ] && [ "$has_pdftoppm" -eq 1 ]; then
    ok "Visual pipeline deps present (LibreOffice + pdftoppm)"
    return 0
  fi
  if [ "$has_office" -eq 0 ]; then MISSING_DEPS+=("libreoffice"); fi
  if [ "$has_pdftoppm" -eq 0 ]; then MISSING_DEPS+=("poppler"); fi
  warn "Missing visual-pipeline deps: ${MISSING_DEPS[*]}"
}

# ---------- deps install ----------

# Prompt y/N for consent. Returns 0 (yes) / 1 (no). Skips the prompt and
# returns 0 when --install-deps was passed; returns 1 immediately when
# --no-install-deps was passed; in non-interactive contexts (no TTY) returns 1
# (so we degrade to printing the command).
consent_to_install_deps() {
  case "$FORCE_INSTALL_DEPS" in
    yes) return 0 ;;
    no)  return 1 ;;
  esac
  if [ ! -t 0 ]; then
    return 1
  fi
  local ans
  printf 'Install %s now? [y/N] ' "${MISSING_DEPS[*]}"
  read -r ans || return 1
  case "$ans" in
    y|Y|yes|YES) return 0 ;;
    *)           return 1 ;;
  esac
}

deps_install_or_hint() {
  [ "${#MISSING_DEPS[@]}" -gt 0 ] || return 0
  step "System dependencies"

  local os pm cmd
  os="$(detect_os)"
  pm="$(detect_pm)"
  cmd="$(pm_install_cmd "$pm" "${MISSING_DEPS[@]}")"

  note "Detected OS: $os · package manager: $pm"
  note "These deps power vision-driven template extraction (template create --from <pptx>)"
  note "and the visual critique loop. DeckPilot still installs without them — the"
  note "affected features fall back to shallow paths or disable themselves."

  if [ "$pm" = "unknown" ]; then
    warn "Couldn't detect your package manager."
    note "Install LibreOffice + poppler manually for the affected features to work."
    return 0
  fi

  if consent_to_install_deps; then
    if pm_install "$pm" "${MISSING_DEPS[@]}"; then
      ok "System deps installed."
      MISSING_DEPS=()
    else
      warn "Dep install failed. Continuing without — features that need them will degrade."
      note "You can retry manually: $cmd"
    fi
  else
    warn "Skipped system-dep install."
    note "To enable later, run:"
    note "  $cmd"
  fi
}

# ---------- bootstrap ----------

# Try each mirror in turn; retry per mirror with backoff. Sets a global so
# update mode can record the previous SHA for rollback.
clone_with_fallback() {
  local target="$REPO_DIR"
  local ref="$REF"
  local mirrors_csv="${DECKPILOT_REPO_MIRRORS:-}"
  local urls=()
  urls+=("$REPO_URL")
  if [ -n "$mirrors_csv" ]; then
    # POSIX-safe CSV split (avoid mapfile / readarray for bash 3.2 compat).
    local IFS=','
    local m
    for m in $mirrors_csv; do
      [ -n "$m" ] && urls+=("$m")
    done
  fi

  local url
  for url in "${urls[@]}"; do
    step "Cloning $url@$ref → $target"
    if retry 3 git clone --depth=1 --branch "$ref" "$url" "$target" >>"$LOG" 2>&1; then
      ok "Cloned from $url"
      return 0
    fi
    warn "Clone from $url failed after 3 attempts; trying next mirror (if any)."
    # Make sure a partial clone doesn't block the next try.
    rm -rf "$target" 2>/dev/null || true
  done
  die "All clone targets failed. Check connectivity / DECKPILOT_REPO_URL / DECKPILOT_REPO_MIRRORS."
}

bootstrap() {
  if [ "$BOOTSTRAP" -eq 0 ]; then
    return 0
  fi
  mkdir -p "$(dirname "$REPO_DIR")"
  if [ -d "$REPO_DIR/.git" ]; then
    # An existing bootstrap clone — fetch + reset rather than re-clone.
    ROLLBACK_SHA="$(cd "$REPO_DIR" && git rev-parse HEAD 2>/dev/null || true)"
    ROLLBACK_KIND="update"
    step "Updating existing clone at $REPO_DIR (ref: $REF)"
    if retry 3 bash -c "cd '$REPO_DIR' && git fetch --depth=1 origin '$REF' && git checkout -q '$REF' && git reset --hard origin/'$REF'" >>"$LOG" 2>&1; then
      ok "Updated."
    else
      die "Could not update $REPO_DIR. Run with --reinstall to wipe + re-clone."
    fi
  else
    if [ -e "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
      die "$REPO_DIR exists and is not a git checkout. Set DECKPILOT_INSTALL_DIR or remove it."
    fi
    ROLLBACK_KIND="fresh"
    clone_with_fallback
  fi
}

# ---------- update-vs-fresh detection ----------

# After preflight + (optional) bootstrap, decide whether to switch into the
# update fast-path. The trigger: a working `deckpilot` command already exists
# pointing at REPO_DIR. Skipped when --reinstall is set.
detect_update_mode() {
  if [ "$FORCE_REINSTALL" -eq 1 ]; then
    IS_UPDATE=0
    return
  fi
  if [ "$FORCE_UPDATE" -eq 1 ]; then
    IS_UPDATE=1
    return
  fi
  # BOOTSTRAP=0 means we're running from inside an existing checkout. If the
  # binary is on PATH and points at this checkout, treat as update.
  if [ "$BOOTSTRAP" -eq 0 ] && command -v deckpilot >/dev/null 2>&1; then
    IS_UPDATE=1
    return
  fi
  # BOOTSTRAP=1 case with an existing clone is handled in bootstrap() already
  # (sets ROLLBACK_KIND=update). The link step is idempotent so re-linking is
  # cheap; keep IS_UPDATE=0 there so the user still sees a full flow.
  IS_UPDATE=0
}

# ---------- build ----------

build() {
  # In update mode, skip `npm ci` when the lockfile hasn't changed since the
  # previous HEAD. Saves ~10s on every no-op update.
  local need_install=1
  if [ "$IS_UPDATE" -eq 1 ] && [ -n "$ROLLBACK_SHA" ] && [ -d "$REPO_DIR/.git" ]; then
    if (cd "$REPO_DIR" && git diff --quiet "$ROLLBACK_SHA" HEAD -- package-lock.json) 2>/dev/null; then
      need_install=0
      note "(package-lock unchanged — skipping npm ci)"
    fi
  fi

  if [ "$need_install" -eq 1 ]; then
    step "Installing npm deps"
    if [ -f "$REPO_DIR/package-lock.json" ]; then
      if ! retry 2 bash -c "cd '$REPO_DIR' && npm ci" >>"$LOG" 2>&1; then
        die "npm ci failed. See $LOG for details."
      fi
    else
      if ! retry 2 bash -c "cd '$REPO_DIR' && npm install" >>"$LOG" 2>&1; then
        die "npm install failed. See $LOG for details."
      fi
    fi
    ok "Dependencies installed"
  fi

  if [ "$SKIP_BUILD" -eq 1 ]; then
    warn "Skipping build (--no-build)"
    return
  fi
  step "Building TypeScript"
  if ! run_logged "npm run build" bash -c "cd '$REPO_DIR' && npm run build"; then
    die "Build failed. See $LOG for details."
  fi
  ok "Build complete"

  step "Generating oclif manifest"
  if run_logged "npx oclif manifest" bash -c "cd '$REPO_DIR' && npx oclif manifest"; then
    ok "Manifest ready"
  else
    warn "oclif manifest skipped (non-fatal)"
  fi
}

# ---------- link ----------

link_user() {
  step "Linking globally (npm link)"
  local link_log
  link_log="$(mktemp)"
  if ! (cd "$REPO_DIR" && npm link) >"$link_log" 2>&1; then
    cat "$link_log" >&2
    cat "$link_log" >>"$LOG" 2>/dev/null || true
    rm -f "$link_log"
    warn "npm link failed. Falling back to a direct symlink."
    fallback_symlink && return 0
    die "Could not install the \`deckpilot\` binary. See output above."
  fi
  cat "$link_log" >>"$LOG" 2>/dev/null || true
  rm -f "$link_log"

  local prefix
  prefix="$(npm prefix -g)"
  if [ ! -e "$prefix/bin/deckpilot" ]; then
    warn "npm link reported success but $prefix/bin/deckpilot is missing."
    warn "Falling back to a direct symlink."
    fallback_symlink && return 0
    die "Could not install the \`deckpilot\` binary."
  fi
  ok "Linked into $prefix/bin/deckpilot"
  ensure_path_for_npm_bin "$prefix/bin"
}

# Last-resort symlink when `npm link` won't cooperate (npm-as-root + nvm
# combinations in WSL have been seen to silently no-op). Drops a direct
# symlink into the npm-global bin dir, matching what `npm link` would do.
fallback_symlink() {
  local prefix bin_dir
  prefix="$(npm prefix -g 2>/dev/null)"
  if [ -z "$prefix" ]; then
    warn "Could not determine npm global prefix; cannot fall back."
    return 1
  fi
  bin_dir="$prefix/bin"
  mkdir -p "$bin_dir"
  ln -sf "$REPO_DIR/bin/run.js" "$bin_dir/deckpilot"
  chmod +x "$REPO_DIR/bin/run.js"
  ok "Linked $bin_dir/deckpilot → $REPO_DIR/bin/run.js (direct symlink fallback)"
  ensure_path_for_npm_bin "$bin_dir"
  return 0
}

# If the npm global bin dir isn't on PATH, offer to append it to the user's
# shell rc. Supports bash, zsh, fish (best-effort). Non-interactive runs just
# print the export line.
ensure_path_for_npm_bin() {
  local bin_dir=$1
  command -v deckpilot >/dev/null 2>&1 && return 0

  warn "$bin_dir is not on your PATH yet."
  warn "Add the following to your shell rc:"
  printf '\n    %sexport PATH="%s:$PATH"%s\n\n' "$B" "$bin_dir" "$X"

  if [ ! -t 0 ] || [ -z "${BASH_VERSION:-${ZSH_VERSION:-}}" ]; then
    warn "Non-interactive — not editing your shell rc automatically."
    return 0
  fi

  # Identify the best candidate rc files in order of likelihood.
  local rc rcs=()
  [ -n "${ZSH_VERSION:-}" ] && rcs+=("$HOME/.zshrc")
  [ -n "${BASH_VERSION:-}" ] && rcs+=("$HOME/.bashrc")
  if [ -d "$HOME/.config/fish" ]; then
    rcs+=("$HOME/.config/fish/config.fish")
  fi

  local target=""
  for rc in "${rcs[@]}"; do
    if [ -f "$rc" ] || [ -w "$(dirname "$rc")" ]; then
      target="$rc"
      break
    fi
  done
  [ -n "$target" ] || target="$HOME/.bashrc"

  printf 'Append PATH update to %s now? [Y/n] ' "$target"
  local ans
  if read -r ans && { [ -z "$ans" ] || [ "$ans" = "y" ] || [ "$ans" = "Y" ]; }; then
    if grep -Fqs "$bin_dir" "$target" 2>/dev/null; then
      ok "$target already references $bin_dir"
    else
      mkdir -p "$(dirname "$target")"
      case "$target" in
        *config.fish)
          printf '\n# added by deckpilot install.sh\nset -gx PATH %s $PATH\n' "$bin_dir" >>"$target"
          ;;
        *)
          printf '\n# added by deckpilot install.sh\nexport PATH="%s:$PATH"\n' "$bin_dir" >>"$target"
          ;;
      esac
      ok "Appended to $target — open a new shell or run: source $target"
    fi
  fi
}

link_system() {
  step "Linking system-wide → $SYSTEM_LINK"
  sudo ln -sf "$REPO_DIR/bin/run.js" "$SYSTEM_LINK"
  sudo chmod +x "$REPO_DIR/bin/run.js"
  ok "Linked $SYSTEM_LINK → $REPO_DIR/bin/run.js"
}

# ---------- uninstall ----------

do_uninstall() {
  step "Uninstalling DeckPilot"
  (cd "$REPO_DIR" 2>/dev/null && npm unlink -g deckpilot 2>/dev/null) || true
  # Fallback: nuke any global symlink even if npm link state is gone.
  local prefix
  prefix="$(npm prefix -g 2>/dev/null || true)"
  [ -n "$prefix" ] && [ -L "$prefix/bin/deckpilot" ] && rm -f "$prefix/bin/deckpilot"
  if [ -L "$SYSTEM_LINK" ]; then
    sudo rm -f "$SYSTEM_LINK"
    ok "Removed $SYSTEM_LINK"
  fi
  if [ "$BOOTSTRAP" -eq 1 ] && [ -d "$REPO_DIR/.git" ]; then
    rm -rf "$REPO_DIR"
    ok "Removed bootstrap checkout at $REPO_DIR"
  fi
  ok "Done."
  exit 0
}

# ---------- verify ----------

smoke_version() {
  step "Smoke test"
  if ! command -v deckpilot >/dev/null 2>&1; then
    warn "deckpilot not yet on PATH in this shell — open a new shell and run: deckpilot doctor"
    return
  fi
  if deckpilot --version >/dev/null 2>&1; then
    ok "$(deckpilot --version)"
  else
    warn "deckpilot --version failed; try: deckpilot doctor"
  fi
}

# Run `deckpilot doctor` and stream its output. Doctor's own exit code is
# treated as advisory — we never fail the install on it (the user got useful
# info, that's the whole point).
run_doctor() {
  [ "$SKIP_DOCTOR" -eq 1 ] && { note "(--skip-doctor — verification skipped)"; return; }
  command -v deckpilot >/dev/null 2>&1 || { note "(doctor skipped — deckpilot not on PATH)"; return; }
  step "Running deckpilot doctor"
  # Use `|| true` so doctor's non-zero exit doesn't trip the ERR trap.
  deckpilot doctor 2>&1 | tee -a "$LOG" || true
}

# ---------- main ----------

# Always announce which installer is running. This is intentionally before any
# other output so a stale CDN cache is obvious at a glance.
printf '%sDeckPilot installer%s v%s\n' "$B" "$X" "$INSTALL_SCRIPT_VERSION"

ensure_log
log_line "argv: $*"
log_line "REPO_URL=$REPO_URL REF=$REF REPO_DIR=$REPO_DIR BOOTSTRAP=$BOOTSTRAP MODE=$MODE"
log_line "platform: os=$(detect_os) pm=$(detect_pm)"

trap rollback_on_error ERR

# Run the entire main flow inside a subshell whose stdin is /dev/null. Under
# `curl ... | bash`, bash itself is reading the script body from stdin (the
# curl pipe). Children of bash inherit that stdin; if any child reads from
# it, those bytes are stolen from the script bash is still trying to read and
# bash EOFs and exits silently. Wrapping the work in `( … ) </dev/null` gives
# every child a closed stdin without touching bash's own script-reading stdin.
# The exception: the consent prompt + the PATH-append prompt explicitly
# redirect /dev/tty when they need user input, since stdin here is /dev/null.
(
  if [ "$ACTION" = "uninstall" ]; then
    do_uninstall
  fi

  step "Preflight"
  preflight_node
  preflight_git
  preflight_disk
  preflight_network
  preflight_deps

  # Offer to install missing deps BEFORE bootstrap so a y/N can complete
  # before we start downloading the world.
  if [ "${#MISSING_DEPS[@]}" -gt 0 ]; then
    deps_install_or_hint
  fi

  bootstrap

  detect_update_mode
  if [ "$IS_UPDATE" -eq 1 ]; then
    step "Update mode (existing install detected)"
    note "Skipping link step. Re-run with --reinstall to force the full path."
  fi

  build

  if [ "$IS_UPDATE" -eq 0 ]; then
    case "$MODE" in
      user)   link_user ;;
      system) link_system ;;
    esac
  fi

  smoke_version
  run_doctor

  say ""
  if [ "$IS_UPDATE" -eq 1 ]; then
    say "${B}DeckPilot updated.${X}"
  else
    say "${B}DeckPilot is ready.${X}"
  fi
  [ "$BOOTSTRAP" -eq 1 ] && say "  Source checkout: ${B}$REPO_DIR${X}"
  say "  Install log:     ${B}$LOG${X}"
  say "  Try: ${B}deckpilot${X}            # open the menu"
  say "       ${B}deckpilot auth login${X} # if you haven't authenticated Copilot CLI yet"
  say ""
  say "${D}To update:    ./install.sh --update     (or just re-run this script)${X}"
  say "${D}To uninstall: ./install.sh --uninstall${X}"
) </dev/null

# Clear the trap on clean exit so a subsequent failure (during shell teardown)
# can't accidentally trigger rollback.
trap - ERR
