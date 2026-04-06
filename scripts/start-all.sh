#!/bin/bash
# Gaia Control Center — one-click start all bots + dashboards
# Usage: ./scripts/start-all.sh

set -e

GAIA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PERSONA_DIR="${PERSONA_BOT_DIR:-$HOME/本地文档/claude code/对话服务/persona-bot}"

echo "🚀 Starting Gaia Control Center..."

# Check if PM2 is running
if ! command -v pm2 &>/dev/null && ! npx pm2 --version &>/dev/null; then
  echo "❌ PM2 not found. Install: npm i -g pm2"
  exit 1
fi

# Try resurrect first (restores saved process list)
pm2 resurrect 2>/dev/null || true

# Check what's already running
RUNNING=$(pm2 jlist 2>/dev/null | node -e "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(d.filter(p=>p.pm2_env.status==='online').map(p=>p.name).join(','));
" 2>/dev/null || echo "")

start_if_missing() {
  local name=$1
  if echo "$RUNNING" | grep -q "$name"; then
    echo "  ✅ $name already running"
  else
    shift
    pm2 start "$@" 2>/dev/null
    echo "  🟢 $name started"
  fi
}

# Bots
start_if_missing "gaia-bot" "$GAIA_DIR/ecosystem.config.cjs"
start_if_missing "persona-bot" "$PERSONA_DIR/ecosystem.config.cjs"

# Dashboards
start_if_missing "control-center" "$GAIA_DIR/scripts/launcher.cjs" --name control-center --cwd "$GAIA_DIR"
start_if_missing "gaia-dashboard" "$GAIA_DIR/scripts/gaia-dashboard.cjs" --name gaia-dashboard --cwd "$GAIA_DIR"
start_if_missing "persona-dashboard" "$PERSONA_DIR/scripts/gaia-dashboard.cjs" --name persona-dashboard --cwd "$PERSONA_DIR"

# Save state
pm2 save --force 2>/dev/null

echo ""
echo "════════════════════════════════════════"
echo "  Gaia Control Center: http://localhost:3400"
echo "  gaia-bot dashboard:  http://localhost:3456"
echo "  persona-bot dashboard: http://localhost:3457"
echo "════════════════════════════════════════"
echo ""

# Open browser
open http://localhost:3400 2>/dev/null || xdg-open http://localhost:3400 2>/dev/null || true
