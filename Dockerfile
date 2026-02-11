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

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose gateway and bridge ports
EXPOSE 18789 18790

# Health check for DappNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:18789/health || exit 1

# Run as root (no-new-privileges prevents privilege escalation via gosu/sudo)
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789", "--allow-unconfigured"]
