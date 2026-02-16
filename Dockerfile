ARG UPSTREAM_VERSION="latest"

FROM node:22-bookworm

# Install Bun (required for build scripts) and sudo (needed by openclaw tool executor)
RUN curl -fsSL https://bun.sh/install | bash && \
    apt-get update && \
    apt-get install -y --no-install-recommends sudo && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY openclaw/package.json openclaw/pnpm-lock.yaml openclaw/pnpm-workspace.yaml openclaw/.npmrc ./
COPY openclaw/ui/package.json ./ui/package.json
COPY openclaw/patches ./patches
COPY openclaw/scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY openclaw/ .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Install ttyd (web terminal) - static binary from GitHub releases
# ttyd is not available in bookworm repos, so we download the pre-built binary
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then TTYD_ARCH="x86_64"; \
    elif [ "$ARCH" = "arm64" ]; then TTYD_ARCH="aarch64"; \
    else echo "Unsupported architecture: $ARCH" && exit 1; fi && \
    curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" \
      -o /usr/local/bin/ttyd && \
    chmod +x /usr/local/bin/ttyd

# Copy setup wizard
COPY setup-wizard/ /app/setup-wizard/

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose gateway, bridge, terminal, and setup wizard ports
EXPOSE 18789 18790 7681 8080

# Health check for DappNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:18789/health || exit 1

# Run as root (no-new-privileges prevents privilege escalation via gosu/sudo)
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789", "--allow-unconfigured"]
