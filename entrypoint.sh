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
    cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "port": 18789,
    "bind": "lan",
    "controlUi": {
      "dangerouslyAllowHostHeaderOriginFallback": true,
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    },
    "auth": {
      "token": "${OPENCLAW_GATEWAY_TOKEN:-openclaw}"
    }
  }
}
EOF
else
    node -e "
const fs = require('fs');
const configPath = '$CONFIG_FILE';
const envToken = process.env.OPENCLAW_GATEWAY_TOKEN || 'openclaw';
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const gw = (config.gateway = config.gateway || {});
  const cui = (gw.controlUi = gw.controlUi || {});
  const auth = (gw.auth = gw.auth || {});
  let changed = false;

  // DAppNode gateway settings
  if (gw.port !== 18789) { gw.port = 18789; changed = true; }
  if (gw.bind !== 'lan') { gw.bind = 'lan'; changed = true; }
  if (!('dangerouslyAllowHostHeaderOriginFallback' in cui) && !('allowedOrigins' in cui)) {
    cui.dangerouslyAllowHostHeaderOriginFallback = true;
    changed = true;
  }
  if (!('allowInsecureAuth' in cui)) { cui.allowInsecureAuth = true; changed = true; }
  if (!('dangerouslyDisableDeviceAuth' in cui)) { cui.dangerouslyDisableDeviceAuth = true; changed = true; }
  if (auth.token !== envToken) { auth.token = envToken; changed = true; }

  // Migrate legacy channel keys that openclaw doctor --fix cannot fully resolve in one pass:
  //   streamMode (string) → streaming (string)
  //   streaming (boolean) → streaming (string: true→\"partial\", false→\"off\")
  //   discord.botToken → discord.token  (Telegram keeps botToken; Discord uses token)
  //   discord guild channel: allow (bool) → enabled (bool)
  const channels = config.channels || {};
  for (const [chName, ch] of Object.entries(channels)) {
    if (!ch || typeof ch !== 'object') continue;
    // streamMode → streaming string
    if ('streamMode' in ch) {
      ch.streaming = ch.streamMode;
      delete ch.streamMode;
      changed = true;
    }
    // boolean streaming → string
    if (typeof ch.streaming === 'boolean') {
      ch.streaming = ch.streaming ? 'partial' : 'off';
      changed = true;
    }
    // Discord: botToken is not valid — migrate to token (plain string)
    if (chName === 'discord' && 'botToken' in ch) {
      if (!ch.token) ch.token = ch.botToken;
      delete ch.botToken;
      changed = true;
    }
    // discord guild channel: allow (bool) → enabled (bool)
    if (ch.guilds && typeof ch.guilds === 'object') {
      for (const guild of Object.values(ch.guilds)) {
        if (guild && guild.channels && typeof guild.channels === 'object') {
          for (const chan of Object.values(guild.channels)) {
            if (chan && 'allow' in chan) {
              chan.enabled = chan.allow;
              delete chan.allow;
              changed = true;
            }
          }
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Updated OpenClaw config for DAppNode HTTP deployment');
  }
} catch(e) { console.warn('Could not update openclaw.json:', e.message); }
" || true
fi

# ---------------------------------------------------------------------------
# Run doctor --fix for any remaining migrations not handled above
# ---------------------------------------------------------------------------
echo "Running openclaw doctor --fix..."
OPENCLAW_STATE_DIR="$OPENCLAW_DIR" openclaw doctor --fix || true

# ---------------------------------------------------------------------------
# Ensure WhatsApp plugin is installed (from npm, no interactive prompts)
# ---------------------------------------------------------------------------
echo "Ensuring WhatsApp plugin is installed..."
if ! OPENCLAW_STATE_DIR="$OPENCLAW_DIR" openclaw plugins list 2>/dev/null | grep -q "@openclaw/whatsapp"; then
    OPENCLAW_STATE_DIR="$OPENCLAW_DIR" openclaw plugins install @openclaw/whatsapp || true
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

# ---------------------------------------------------------------------------
# Start gohttpserver (web-based file manager) in the background on port 8888
# No application-level auth: access is controlled at the DAppNode network level,
# consistent with the ttyd terminal which also relies on DAppNode access control.
# ---------------------------------------------------------------------------
echo "Starting gohttpserver file manager on port 8888..."
gohttpserver \
    --port 8888 \
    --root "$OPENCLAW_DIR" \
    --upload \
    --delete &
GOHTTPSERVER_PID=$!
echo "gohttpserver started (PID: ${GOHTTPSERVER_PID})"

# Execute the main command (runs as root; no-new-privileges prevents gosu/sudo)
if [ -n "$EXTRA_OPTS" ]; then
    exec "$@" $EXTRA_OPTS
else
    exec "$@"
fi
