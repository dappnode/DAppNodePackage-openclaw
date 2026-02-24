#!/bin/bash
set -e

# Ensure the openclaw data directory exists
OPENCLAW_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"

# Create required subdirectories and set ownership
mkdir -p "$OPENCLAW_DIR/canvas" "$OPENCLAW_DIR/cron" "$OPENCLAW_DIR/workspace" "$OPENCLAW_DIR/sessions"

# ---------------------------------------------------------------------------
# Ensure gateway config has controlUi origin setting (required for non-loopback)
# ---------------------------------------------------------------------------
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating default OpenClaw config..."
    cat > "$CONFIG_FILE" << 'EOF'
{
  "gateway": {
    "bind": "lan",
    "port": 18789,
    "controlUi": {
      "dangerouslyAllowHostHeaderOriginFallback": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  }
}
EOF
else
    node -e "
const fs = require('fs');
const JSON5 = require('/app/node_modules/json5');
const configPath = '$CONFIG_FILE';
try {
  const config = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
  const cui = ((config.gateway = config.gateway || {}).controlUi = config.gateway.controlUi || {});
  const gw = config.gateway;
  let changed = false;
  if (!('bind' in gw)) { gw.bind = 'lan'; changed = true; }
  if (!('port' in gw)) { gw.port = 18789; changed = true; }
  if (!('dangerouslyAllowHostHeaderOriginFallback' in cui) && !('allowedOrigins' in cui)) {
    cui.dangerouslyAllowHostHeaderOriginFallback = true;
    changed = true;
  }
  if (!('allowInsecureAuth' in cui)) {
    cui.allowInsecureAuth = true;
    changed = true;
  }
  if (!('dangerouslyDisableDeviceAuth' in cui)) {
    cui.dangerouslyDisableDeviceAuth = true;
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Updated OpenClaw config for DAppNode HTTP deployment');
  }
} catch(e) { console.warn('Could not update openclaw.json:', e.message); }
" || true
fi

# ---------------------------------------------------------------------------
# Start setup wizard web UI in the background on port 8080
# ---------------------------------------------------------------------------
echo "Starting setup wizard on port 8080..."
node /app/setup-wizard/server.cjs &
WIZARD_PID=$!
echo "Setup wizard started (PID: ${WIZARD_PID})"

# ---------------------------------------------------------------------------
# Start ttyd (web terminal) in the background on port 7681
# ---------------------------------------------------------------------------
echo "Starting ttyd web terminal on port 7681..."
ttyd \
    --port 7681 \
    --interface 0.0.0.0 \
    --writable \
    /bin/bash -c "cd /home/node/.openclaw && exec /bin/bash -l" &
TTYD_PID=$!
echo "ttyd started (PID: ${TTYD_PID})"

# Execute the main command (runs as root; no-new-privileges prevents gosu/sudo)
if [ -n "$EXTRA_OPTS" ]; then
    exec "$@" $EXTRA_OPTS
else
    exec "$@"
fi
