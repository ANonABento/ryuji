#!/usr/bin/env bash
# Choomfie installer
# Usage: git clone https://github.com/ANonABento/choomfie.git && cd choomfie && ./install.sh

set -euo pipefail

CHOOMFIE_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
CHOOMFIE_HERMES_HOME="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}"
LEGACY_DATA_DIR="$HOME/.claude/plugins/data/choomfie-inline"

echo "=== Choomfie Installer ==="
echo ""
echo "This installs Choomfie as a Hermes-based personal agent distribution."
echo "The old Claude Code/Bun runtime stays available as: choomfie legacy"
echo ""

missing=()

for bin in git curl; do
  if ! command -v "$bin" &>/dev/null; then
    missing+=("$bin")
  fi
done

if ! command -v uv &>/dev/null; then
  missing+=("uv (https://docs.astral.sh/uv/)")
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing prerequisites:"
  for m in "${missing[@]}"; do
    echo "  - $m"
  done
  echo ""
  echo "Install the above and re-run this script."
  exit 1
fi

echo "[1/6] Prerequisites OK (git, curl, uv)"

echo "[2/6] Installing/updating local Hermes checkout..."
"$CHOOMFIE_DIR/hermes-overlay/scripts/install-hermes.sh" --local

echo "[3/6] Creating Choomfie-Hermes home..."
CHOOMFIE_HERMES_HOME="$CHOOMFIE_HERMES_HOME" "$CHOOMFIE_DIR/hermes-overlay/scripts/sync-overlay.sh"

ENV_FILE="$CHOOMFIE_HERMES_HOME/.env"

echo "[4/6] Checking model/API configuration..."
if grep -Eq '^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|OLLAMA_API_KEY)=' "$ENV_FILE" 2>/dev/null; then
  echo "  Model provider key appears configured in $ENV_FILE"
else
  echo "  No model provider key found yet."
  echo "  Edit: $ENV_FILE"
  echo "  Common choices: OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY"
fi

echo "[5/6] Checking Discord gateway configuration..."
if grep -Eq '^(DISCORD_TOKEN|DISCORD_BOT_TOKEN)=' "$ENV_FILE" 2>/dev/null; then
  echo "  Discord token appears configured in $ENV_FILE"
elif [ -f "$LEGACY_DATA_DIR/.env" ] && grep -q "DISCORD_TOKEN=" "$LEGACY_DATA_DIR/.env"; then
  TOKEN=$(grep "DISCORD_TOKEN=" "$LEGACY_DATA_DIR/.env" | head -1 | cut -d'=' -f2-)
  {
    echo ""
    echo "# Imported from legacy Choomfie installer."
    echo "DISCORD_TOKEN=$TOKEN"
  } >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "  Imported legacy Discord token into $ENV_FILE"
else
  echo "  No Discord token found yet."
  echo "  Edit: $ENV_FILE"
  echo "  Set DISCORD_TOKEN or run Hermes gateway setup after install."
fi

echo "[6/6] Installing commands..."
mkdir -p "$BIN_DIR"
chmod +x "$CHOOMFIE_DIR/bin/choomfie" \
  "$CHOOMFIE_DIR/bin/choomfie-legacy" \
  "$CHOOMFIE_DIR/hermes-overlay/scripts/"*.sh
ln -sf "$CHOOMFIE_DIR/bin/choomfie" "$BIN_DIR/choomfie"
ln -sf "$CHOOMFIE_DIR/bin/choomfie-legacy" "$BIN_DIR/choomfie-legacy"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  fi

  if [ -n "$SHELL_RC" ]; then
    if ! grep -Fq "export PATH=\"$BIN_DIR:\$PATH\"" "$SHELL_RC"; then
      echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
      echo "  Added $BIN_DIR to PATH in $SHELL_RC"
      echo "  Run: source $SHELL_RC"
    else
      echo "  PATH already configured in $SHELL_RC"
    fi
  else
    echo "  Add $BIN_DIR to your PATH manually"
  fi
fi

echo ""
echo "=== Done ==="
echo ""
echo "New default:"
echo "  choomfie              # start Choomfie-Hermes gateway/API"
echo "  choomfie chat         # terminal chat with Choomfie-Hermes"
echo "  choomfie doctor       # check setup"
echo ""
echo "Legacy escape hatch:"
echo "  choomfie legacy       # old Claude Code/Bun runtime"
echo "  choomfie-legacy       # same as above"
echo ""
echo "Before first real run, edit:"
echo "  $ENV_FILE"
