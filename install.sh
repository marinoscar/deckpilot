#!/usr/bin/env bash
# DeckPilot installer — one-command install, idempotent, makes `deckpilot`
# available on PATH from any directory.
#
# Usage:
#   ./install.sh                 install for current user via `npm link`
#   ./install.sh --system        install system-wide via /usr/local/bin (uses sudo)
#   ./install.sh --uninstall     remove
#   ./install.sh --no-build      skip the build step (faster re-link during dev)
#   ./install.sh --quiet         less chatty
#
# Re-running is safe.

set -euo pipefail

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
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SYSTEM_LINK="/usr/local/bin/deckpilot"

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
  command -v node >/dev/null 2>&1 || die "Node is not installed. Try: nvm install 22  (or brew install node, apt install nodejs)"
  command -v npm  >/dev/null 2>&1 || die "npm is not installed. Reinstall Node from https://nodejs.org/"
  local v
  v="$(node --version | sed 's/^v//')"
  local major="${v%%.*}"
  if [ "$major" -lt 20 ]; then
    die "Node $v is too old. DeckPilot needs Node ≥ 20. Try: nvm install 22"
  fi
  ok "Node $v"
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
  (cd "$REPO_DIR" && npm link) >/dev/null
  local prefix
  prefix="$(npm prefix -g)"
  ok "Linked into $prefix/bin/deckpilot"

  if ! command -v deckpilot >/dev/null 2>&1; then
    local bin_dir="$prefix/bin"
    warn "$bin_dir is not on your PATH yet."
    warn "Add this line to your shell rc (~/.bashrc or ~/.zshrc):"
    printf '\n    %sexport PATH="%s:$PATH"%s\n\n' "$B" "$bin_dir" "$X"
    if [ -n "${BASH_VERSION:-}" ] || [ -n "${ZSH_VERSION:-}" ]; then
      local rc="$HOME/.bashrc"
      [ -n "${ZSH_VERSION:-}" ] && rc="$HOME/.zshrc"
      printf 'Append it to %s now? [Y/n] ' "$rc"
      read -r ans
      if [ -z "$ans" ] || [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
        if ! grep -Fqs "$bin_dir" "$rc" 2>/dev/null; then
          printf '\n# added by deckpilot install.sh\nexport PATH="%s:$PATH"\n' "$bin_dir" >> "$rc"
          ok "Appended to $rc — open a new shell or run: source $rc"
        else
          ok "$rc already references $bin_dir"
        fi
      fi
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
  (cd "$REPO_DIR" && npm unlink -g deckpilot 2>/dev/null) || true
  if [ -L "$SYSTEM_LINK" ]; then
    sudo rm -f "$SYSTEM_LINK"
    ok "Removed $SYSTEM_LINK"
  fi
  ok "Done. (Node modules in this repo were left intact — delete the repo if you want them gone.)"
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
if [ "$ACTION" = "uninstall" ]; then
  do_uninstall
fi

preflight
build

case "$MODE" in
  user)   link_user ;;
  system) link_system ;;
esac

smoke

say ""
say "${B}DeckPilot is ready.${X}"
say "  Try: ${B}deckpilot doctor${X}     # preflight diagnostics"
say "       ${B}deckpilot auth login${X} # if you haven't authenticated Copilot CLI yet"
say "       ${B}deckpilot${X}            # enter the chat loop"
say ""
say "${D}To uninstall: ./install.sh --uninstall${X}"
