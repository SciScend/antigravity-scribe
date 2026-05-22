#!/bin/bash
set -e

# Change to project root relative to script
cd "$(dirname "$0")/.."

# Load workspace-specific environment variables if .env exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Rebuild the extension
npm run package

PROFILE_HOME="${ANTIGRAVITY_PROFILE_DIR:-$HOME}"
HOME="$PROFILE_HOME" \
  antigravity-ide \
  --extensions-dir="$PROFILE_HOME/.antigravity-ide/extensions" \
  --install-extension ./antigravity-scribe-*.vsix

# Run repomix - rebuild context
repomix

echo "✓ Context Updated & Extension Installed — reload Antigravity window"