#!/usr/bin/env bash
# DeckPilot installer — one-command install, idempotent, makes `deckpilot`
# available on PATH from any directory. Works both inside a cloned repo and
# bootstrapped from the GitHub raw URL via `curl | bash`.
#
# Usage:
#   ./install.sh                 install for current user via `npm link`
#   ./install.sh --system        install system-wide via /usr/local/bin (uses sudo)
#   ./install.sh --uninstall     remove
#   ./install.sh --no-build      skip the build step (faster re-link during dev)
#   ./install.sh --quiet         less chatty
#
# Remote install (Ubuntu/macOS/WSL):
#   curl -fsSL https://raw.githubusercontent.com/marinoscar/deckpilot/main/install.sh | bash
#
# Env vars:
#   DECKPILOT_INSTALL_DIR   where to clone the repo when bootstrapping
#                           (default: $HOME/.deckpilot/repo)
#   DECKPILOT_REPO_URL      git URL to clone (default: official repo)
#   DECKPILOT_REF           git ref to check out (default: main)
#
# Re-running is safe.

set -euo pipefail

# Bumped on every release of the installer. Printed at the top of every run so
# users can confirm what they're actually executing (CDN cache misses are real).
INSTALL_SCRIPT_VERSION="0.10.0"

# NOTE: do NOT redirect bash's own stdin here. Under `curl ... | bash`, bash IS
# reading the script from stdin. Redirecting stdin at the top would make bash
# EOF on its next read and exit, dropping curl's outbound writes (curl error 23
# "Failure writing output to destination"). Stdin isolation for child processes
# is done at the bottom of the script by wrapping the main flow in a subshell
# with `</dev/null` — see "# ---------- main ----------".

MODE="user"
SKIP_BUILD=0
QUIET=0
ACTION="install"

while [ $# -gt 0 ]; do
  case "$1" in
    --system) MODE="system"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --no-build) SKIP_BUILD=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

DEFAULT_REPO_URL="https://github.com/marinoscar/deckpilot.git"
DEFAULT_REF="main"
DEFAULT_INSTALL_DIR="$HOME/.deckpilot/repo"

REPO_URL="${DECKPILOT_REPO_URL:-$DEFAULT_REPO_URL}"
REF="${DECKPILOT_REF:-$DEFAULT_REF}"
SYSTEM_LINK="/usr/local/bin/deckpilot"

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

# colors
if [ -t 1 ]; then
  G="$(printf '\033[32m')"; R="$(printf '\033[31m')"; Y="$(printf '\033[33m')"
  B="$(printf '\033[1m')"; D="$(printf '\033[2m')"; X="$(printf '\033[0m')"
else
  G=""; R=""; Y=""; B=""; D=""; X=""
fi

say()  { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
ok()   { [ "$QUIET" -eq 1 ] || printf '%s✓%s %s\n' "$G" "$X" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$X" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$R" "$X" "$*" >&2; exit 1; }
step() { [ "$QUIET" -eq 1 ] || printf '%s· %s%s\n' "$B" "$*" "$X"; }

# ---------- preflight ----------
preflight() {
  step "Preflight"
  if ! command -v node >/dev/null 2>&1; then
    die "Node is not installed. On Ubuntu, install Node ≥ 20 with:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  Or use nvm:
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    nvm install 22"
  fi
  command -v npm  >/dev/null 2>&1 || die "npm is not installed. Reinstall Node from https://nodejs.org/"
  local v
  v="$(node --version | sed 's/^v//')"
  local major="${v%%.*}"
  if [ "$major" -lt 20 ]; then
    die "Node $v is too old. DeckPilot needs Node ≥ 20. On Ubuntu, install Node 22 from NodeSource (see above) or 'nvm install 22'."
  fi
  ok "Node $v"

  if [ "$BOOTSTRAP" -eq 1 ] && ! command -v git >/dev/null 2>&1; then
    die "git is not installed (needed for bootstrap clone). On Ubuntu: sudo apt-get install -y git"
  fi
}

# ---------- bootstrap ----------
bootstrap() {
  [ "$BOOTSTRAP" -eq 1 ] || return 0
  step "Bootstrap clone → $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  if [ -d "$REPO_DIR/.git" ]; then
    (cd "$REPO_DIR" && git fetch --depth=1 origin "$REF" && git checkout -q "$REF" && git reset --hard "origin/$REF") >/dev/null
    ok "Updated existing clone at $REPO_DIR (ref: $REF)"
  else
    if [ -e "$REPO_DIR" ] && [ -n "$(ls -A "$REPO_DIR" 2>/dev/null)" ]; then
      die "$REPO_DIR exists and is not a git checkout. Set DECKPILOT_INSTALL_DIR or remove it."
    fi
    git clone --depth=1 --branch "$REF" "$REPO_URL" "$REPO_DIR" >/dev/null 2>&1 \
      || die "git clone failed for $REPO_URL (ref $REF)"
    ok "Cloned $REPO_URL@$REF → $REPO_DIR"
  fi
}

# ---------- build ----------
build() {
  step "Installing npm deps"
  if [ -f "$REPO_DIR/package-lock.json" ]; then
    (cd "$REPO_DIR" && npm ci) >/dev/null
  else
    (cd "$REPO_DIR" && npm install) >/dev/null
  fi
  ok "Dependencies installed"

  if [ "$SKIP_BUILD" -eq 1 ]; then
    warn "Skipping build (--no-build)"
    return
  fi
  step "Building TypeScript"
  (cd "$REPO_DIR" && npm run build) >/dev/null
  ok "Build complete"

  step "Generating oclif manifest"
  (cd "$REPO_DIR" && npx oclif manifest) >/dev/null 2>&1 || warn "oclif manifest skipped"
  ok "Manifest ready"
}

# ---------- link ----------
link_user() {
  step "Linking globally (npm link)"
  # IMPORTANT: don't swallow stdout/stderr. If npm link fails for any reason
  # (peer-dep prompts, EACCES, npm-as-root quirks under WSL/nvm, etc.) the
  # user has to be able to see why. Earlier versions of this script piped
  # `npm link` to /dev/null and a silent abort here left users with no
  # `deckpilot` on PATH and no clue what happened.
  local link_log
  link_log="$(mktemp)"
  if ! (cd "$REPO_DIR" && npm link) >"$link_log" 2>&1; then
    cat "$link_log" >&2
    rm -f "$link_log"
    warn "npm link failed. Falling back to a direct symlink."
    fallback_symlink && return 0
    die "Could not install the \`deckpilot\` binary. See output above."
  fi
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

  if ! command -v deckpilot >/dev/null 2>&1; then
    local bin_dir="$prefix/bin"
    warn "$bin_dir is not on your PATH yet."
    warn "Add this line to your shell rc (~/.bashrc or ~/.zshrc):"
    printf '\n    %sexport PATH="%s:$PATH"%s\n\n' "$B" "$bin_dir" "$X"
    # Only prompt interactively when we actually have a TTY. When invoked via
    # `curl ... | bash`, stdin is the script itself (already exhausted), so
    # `read` returns EOF; combined with `set -e` that was silently killing the
    # script. Skip the prompt entirely in that case and just emit instructions.
    if [ -t 0 ] && { [ -n "${BASH_VERSION:-}" ] || [ -n "${ZSH_VERSION:-}" ]; }; then
      local rc="$HOME/.bashrc"
      [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
      printf 'Append it to %s now? [Y/n] ' "$rc"
      if read -r ans && { [ -z "$ans" ] || [ "$ans" = "y" ] || [ "$ans" = "Y" ]; }; then
        if ! grep -Fqs "$bin_dir" "$rc" 2>/dev/null; then
          printf '\n# added by deckpilot install.sh\nexport PATH="%s:$PATH"\n' "$bin_dir" >> "$rc"
          ok "Appended to $rc — open a new shell or run: source $rc"
        else
          ok "$rc already references $bin_dir"
        fi
      fi
    else
      warn "Non-interactive install; not editing your shell rc automatically."
    fi
  fi
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
  return 0
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
  # Remove the bootstrap clone if this run was piped (or if the default path is used).
  if [ "$BOOTSTRAP" -eq 1 ] && [ -d "$REPO_DIR/.git" ]; then
    rm -rf "$REPO_DIR"
    ok "Removed bootstrap checkout at $REPO_DIR"
  fi
  ok "Done."
  exit 0
}

# ---------- smoke ----------
smoke() {
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

# ---------- main ----------
# Always announce which installer is running. This is intentionally before any
# other output so a stale CDN cache is obvious at a glance.
printf '%sDeckPilot installer%s v%s\n' "$B" "$X" "$INSTALL_SCRIPT_VERSION"

# Run the entire main flow inside a subshell whose stdin is /dev/null. Under
# `curl ... | bash`, bash itself is reading the script body from stdin (the
# curl pipe). Children of bash inherit that stdin; if any child (npm, npx,
# git, …) reads from it, those bytes are stolen from the script bash is still
# trying to read and bash EOFs and exits silently. Wrapping the work in
# `( … ) </dev/null` gives every child a closed stdin without touching bash's
# own script-reading stdin. Functions and arguments are inherited; we don't
# need to mutate the parent shell's state from here.
(
  if [ "$ACTION" = "uninstall" ]; then
    do_uninstall
  fi

  preflight
  bootstrap
  build

  case "$MODE" in
    user)   link_user ;;
    system) link_system ;;
  esac

  smoke

  say ""
  say "${B}DeckPilot is ready.${X}"
  [ "$BOOTSTRAP" -eq 1 ] && say "  Source checkout: ${B}$REPO_DIR${X}"
  say "  Try: ${B}deckpilot doctor${X}     # preflight diagnostics"
  say "       ${B}deckpilot auth login${X} # if you haven't authenticated Copilot CLI yet"
  say "       ${B}deckpilot${X}            # enter the chat loop"
  say ""
  say "${D}To uninstall: curl -fsSL $REPO_URL/raw/$REF/install.sh | bash -s -- --uninstall${X}"
  say "${D}    or from the cloned repo: ./install.sh --uninstall${X}"
) </dev/null
