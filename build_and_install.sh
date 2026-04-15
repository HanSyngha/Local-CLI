#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# build_and_install.sh
# Builds local-cli-agent and installs it globally
# ──────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Check Node.js version ──────────────────────
REQUIRED_NODE_MAJOR=20
NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

if [[ -z "$NODE_VERSION" ]]; then
  error "Node.js is not installed. See UPDATE_NODE.txt for install instructions."
  exit 1
fi

if (( NODE_VERSION < REQUIRED_NODE_MAJOR )); then
  error "Node.js v${REQUIRED_NODE_MAJOR}+ is required (found v${NODE_VERSION}). See UPDATE_NODE.txt."
  exit 1
fi

info "Node.js v$(node --version | sed 's/v//') detected — OK"

# ── Move to script directory ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Working directory: $SCRIPT_DIR"

# ── Install dependencies ───────────────────────
info "Installing dependencies..."
if ! npm install; then
  error "npm install failed."
  exit 1
fi

# ── Build ──────────────────────────────────────
info "Building project..."
if ! npm run build; then
  error "Build failed. Fix the errors above and try again."
  exit 1
fi

# ── Global install ─────────────────────────────
info "Installing globally..."
if ! npm install -g .; then
  error "Global install failed. Try running with sudo or check npm prefix permissions."
  exit 1
fi

# ── Verify ─────────────────────────────────────
if command -v local-cli &>/dev/null; then
  info "Done! Run the app with: ${GREEN}local-cli${NC}"
else
  warn "Installed, but 'local-cli' not found in PATH."
  warn "Add npm's global bin to your PATH:"
  warn "  export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
fi
