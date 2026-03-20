ARG UPSTREAM_VERSION="latest"

FROM node:22-bookworm

# Install Bun (required by openclaw at runtime) and sudo (needed by openclaw tool executor)
RUN curl -fsSL https://bun.sh/install | bash && \
    apt-get update && \
    apt-get install -y --no-install-recommends sudo && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

ARG UPSTREAM_VERSION
RUN npm install -g openclaw@${UPSTREAM_VERSION}

# Make json5 (openclaw dependency) resolvable by plain require('json5')
ENV NODE_PATH=/usr/local/lib/node_modules

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

# Install gohttpserver (web-based file manager) - static binary from GitHub releases
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then GHS_ARCH="amd64"; \
    elif [ "$ARCH" = "arm64" ]; then GHS_ARCH="arm64"; \
    else echo "Unsupported architecture: $ARCH" && exit 1; fi && \
    TARBALL="gohttpserver_1.3.0_linux_${GHS_ARCH}.tar.gz" && \
    curl -fsSL "https://github.com/codeskyblue/gohttpserver/releases/download/1.3.0/${TARBALL}" \
      -o "/tmp/${TARBALL}" && \
    EXPECTED=$(curl -fsSL "https://github.com/codeskyblue/gohttpserver/releases/download/1.3.0/gohttpserver_1.3.0_checksums.txt" \
      | grep "${TARBALL}" | awk '{print $1}') && \
    ACTUAL=$(sha256sum "/tmp/${TARBALL}" | awk '{print $1}') && \
    [ "$EXPECTED" = "$ACTUAL" ] || (echo "Checksum mismatch for ${TARBALL}" && exit 1) && \
    tar -xz -C /usr/local/bin --strip-components=0 -f "/tmp/${TARBALL}" gohttpserver && \
    chmod +x /usr/local/bin/gohttpserver && \
    rm "/tmp/${TARBALL}"

# Expose gateway, bridge, terminal, setup wizard, and file manager ports
EXPOSE 18789 18790 7681 8080 8888

# Health check for DappNode monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:18789/health || exit 1

# Run as root (no-new-privileges prevents privilege escalation via gosu/sudo)
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["openclaw", "gateway", "--allow-unconfigured"]
