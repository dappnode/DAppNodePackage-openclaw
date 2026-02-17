#!/bin/bash
set -e

# Ensure the openclaw data directory exists
OPENCLAW_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"

# Create required subdirectories and set ownership
mkdir -p "$OPENCLAW_DIR/canvas" "$OPENCLAW_DIR/cron" "$OPENCLAW_DIR/workspace" "$OPENCLAW_DIR/sessions"

# ---------------------------------------------------------------------------
# Config is managed exclusively by the setup wizard (port 8080).
# The entrypoint does NOT generate openclaw.json.
# ---------------------------------------------------------------------------

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
