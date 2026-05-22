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
EXTENSIONS_DIR="$PROFILE_HOME/.antigravity-ide/extensions"
VSIX=$(ls ./antigravity-scribe-*.vsix | head -1)

EXT_DIR=$(unzip -p "$VSIX" extension/package.json | python3 -c "
import sys, json; p = json.load(sys.stdin)
print(f\"{p['publisher']}.{p['name']}-{p['version']}\")")

rm -rf "$EXTENSIONS_DIR/$EXT_DIR"
mkdir -p "$EXTENSIONS_DIR/$EXT_DIR"
unzip -q "$VSIX" "extension/*" -d "$EXTENSIONS_DIR/$EXT_DIR"
mv "$EXTENSIONS_DIR/$EXT_DIR/extension/"* "$EXTENSIONS_DIR/$EXT_DIR/"
rm -rf "$EXTENSIONS_DIR/$EXT_DIR/extension"

# Run repomix - rebuild context
repomix

echo "✓ Installed: $EXT_DIR — reload Antigravity window (Ctrl+Shift+P → Developer: Reload Window)"