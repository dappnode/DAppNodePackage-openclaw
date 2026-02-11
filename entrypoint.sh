#!/bin/bash
set -e

# Ensure the openclaw data directory exists
OPENCLAW_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"

# Create required subdirectories and set ownership
mkdir -p "$OPENCLAW_DIR/canvas" "$OPENCLAW_DIR/cron" "$OPENCLAW_DIR/workspace" "$OPENCLAW_DIR/sessions"

# ---------------------------------------------------------------------------
# Discover which Ollama instance is reachable (nvidia → amd → cpu)
# ---------------------------------------------------------------------------
OLLAMA_CANDIDATES=(
    "http://ollama.ollama-nvidia-openwebui.dappnode:11434"
    "http://ollama.ollama-amd-openwebui.dappnode:11434"
    "http://ollama.ollama-cpu-openwebui.dappnode:11434"
)

OLLAMA_URL=""
echo "Probing Ollama endpoints..."
for candidate in "${OLLAMA_CANDIDATES[@]}"; do
    if curl -sf --connect-timeout 5 --max-time 10 "${candidate}/api/tags" >/dev/null 2>&1; then
        OLLAMA_URL="$candidate"
        echo "  ✔ Found Ollama at ${candidate}"
        break
    else
        echo "  ✘ ${candidate} not reachable"
    fi
done

if [ -z "$OLLAMA_URL" ]; then
    echo "WARNING: No Ollama endpoint reachable. Config will not be generated."
    echo "The gateway will start but model calls will fail until Ollama is available."
fi

# ---------------------------------------------------------------------------
# Generate openclaw.json only when an Ollama endpoint was discovered
# ---------------------------------------------------------------------------
CONFIG_FILE="$OPENCLAW_DIR/openclaw.json"

if [ -n "$OLLAMA_URL" ]; then
    echo "Writing ${CONFIG_FILE} ..."
    cat > "$CONFIG_FILE" <<EOCFG
{
  "meta": {
    "lastTouchedVersion": "2026.2.1",
    "lastTouchedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
  },
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "${OLLAMA_URL}/v1",
        "apiKey": "ollama-local",
        "api": "openai-responses",
        "models": [
          {
            "id": "qwen3-coder-next:q8_0",
            "name": "Qwen3 Coder Next Q8",
            "reasoning": true,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 256000,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3-coder-next:q8_0"
      },
      "workspace": "/home/node/.openclaw/workspace",
      "compaction": {
        "mode": "safeguard"
      },
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      }
    }
  },
  "tools": {
    "profile": "full",
    "exec": {
      "security": "full",
      "ask": "off",
      "timeoutSec": 3600
    },
    "elevated": {
      "enabled": true
    }
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "bash": true,
    "config": true,
    "debug": true,
    "useAccessGroups": false
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "channels": {
    "telegram": {
      "dmPolicy": "pairing",
      "allowFrom": [
        "13047866",
        ""
      ],
      "groupPolicy": "allowlist",
      "streamMode": "partial",
      "actions": {
        "deleteMessage": false
      }
    }
  },
  "gateway": {
    "controlUi": {
      "enabled": true,
      "allowInsecureAuth": true
    }
  },
  "plugins": {
    "entries": {
      "telegram": {
        "enabled": true
      }
    }
  }
}
EOCFG
    echo "Config written."
fi

# Execute the main command (runs as root; no-new-privileges prevents gosu/sudo)
if [ -n "$EXTRA_OPTS" ]; then
    exec "$@" $EXTRA_OPTS
else
    exec "$@"
fi
