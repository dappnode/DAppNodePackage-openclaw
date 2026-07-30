#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

function deepMerge(base, override) {
  if (typeof base !== "object" || base === null || Array.isArray(base)) return override;
  if (typeof override !== "object" || override === null || Array.isArray(override)) return override;
  const result = Object.assign({}, base);
  for (const key of Object.keys(override)) {
    result[key] = deepMerge(base[key], override[key]);
  }
  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTelegramStreaming(entry) {
  if (!isObject(entry)) return;

  const legacyStreaming = entry.streaming;
  const streaming = isObject(legacyStreaming) ? legacyStreaming : {};

  if ("streaming" in entry && !isObject(legacyStreaming)) {
    if (typeof legacyStreaming === "boolean") {
      streaming.mode = legacyStreaming ? "partial" : "off";
    } else if (legacyStreaming != null) {
      streaming.mode = String(legacyStreaming);
    }
    entry.streaming = streaming;
  }
  if ("streamMode" in entry) {
    if (!streaming.mode) streaming.mode = entry.streamMode;
    delete entry.streamMode;
  }
  if ("chunkMode" in entry) {
    if (!("chunkMode" in streaming)) streaming.chunkMode = entry.chunkMode;
    delete entry.chunkMode;
  }
  if ("draftChunk" in entry) {
    const preview = isObject(streaming.preview) ? streaming.preview : {};
    if (!("chunk" in preview)) preview.chunk = entry.draftChunk;
    streaming.preview = preview;
    delete entry.draftChunk;
  }
  if ("blockStreaming" in entry) {
    const block = isObject(streaming.block) ? streaming.block : {};
    if (!("enabled" in block)) block.enabled = entry.blockStreaming;
    streaming.block = block;
    delete entry.blockStreaming;
  }
  if ("blockStreamingCoalesce" in entry) {
    const block = isObject(streaming.block) ? streaming.block : {};
    if (!("coalesce" in block)) block.coalesce = entry.blockStreamingCoalesce;
    streaming.block = block;
    delete entry.blockStreamingCoalesce;
  }
  if (Object.keys(streaming).length > 0) entry.streaming = streaming;
}

function normalizeOpenClawConfig(config) {
  const telegram = config && config.channels && config.channels.telegram;
  normalizeTelegramStreaming(telegram);
  if (telegram && isObject(telegram.accounts)) {
    for (const account of Object.values(telegram.accounts)) {
      normalizeTelegramStreaming(account);
    }
  }
  return config;
}

const PORT = 8080;
const CONFIG_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const CONFIG_FILE = path.join(CONFIG_DIR, "openclaw.json");
const HTML_FILE = path.join(__dirname, "index.html");
const NEXUS_AUTHGEAR_ENDPOINT = (process.env.NEXUS_AUTHGEAR_ENDPOINT || "https://nexus-auth.dappnode.com").replace(/\/+$/, "");
const NEXUS_AUTHGEAR_CLIENT_ID = process.env.NEXUS_AUTHGEAR_CLIENT_ID || "986265c5bcad52f7";
const NEXUS_CONTROL_PLANE_URL = (process.env.NEXUS_CONTROL_PLANE_URL || "https://nexus-cp.dappnode.com").replace(/\/+$/, "");
const NEXUS_API_KEY_NAME = process.env.NEXUS_API_KEY_NAME || "OpenClaw DAppNode";
const NEXUS_AUTH_RESULT_TTL = 10 * 60 * 1000;

const OLLAMA_CANDIDATES = [
  "http://ollama.ollama-nvidia-openwebui.dappnode:11434",
  "http://ollama.ollama-amd-openwebui.dappnode:11434",
  "http://ollama.ollama-cpu-openwebui.dappnode:11434",
  "http://ollama-nvidia.dappnode:11434",
  "http://ollama-amd.dappnode:11434",
  "http://ollama-cpu.dappnode:11434",
  "http://localhost:11434",
];

const nexusAuthStates = new Map();
const nexusAuthResults = new Map();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(bytes) {
  return base64Url(crypto.randomBytes(bytes));
}

function firstHeaderValue(value) {
  return String(value || "").split(",")[0].trim();
}

function requestOrigin(req) {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host || "openclaw.dappnode:8080";
  return `${proto}://${host}`;
}

function nexusRedirectUri(req) {
  return process.env.NEXUS_AUTH_REDIRECT_URI || `${requestOrigin(req)}/nexus/auth/callback`;
}

function sanitizeReturnTo(value) {
  if (!value || value.length > 2000 || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function withReturnParams(returnTo, params) {
  const out = new URL(sanitizeReturnTo(returnTo), "http://openclaw.dappnode");
  for (const [key, value] of Object.entries(params)) {
    if (value) out.searchParams.set(key, value);
  }
  return `${out.pathname}${out.search}${out.hash}`;
}

function pruneNexusAuthMaps() {
  const now = Date.now();
  for (const [id, value] of nexusAuthStates) {
    if (value.expiresAt < now) nexusAuthStates.delete(id);
  }
  for (const [id, value] of nexusAuthResults) {
    if (value.expiresAt < now) nexusAuthResults.delete(id);
  }
}

async function exchangeNexusCode(code, state) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: NEXUS_AUTHGEAR_CLIENT_ID,
    code,
    redirect_uri: state.redirectUri,
    code_verifier: state.codeVerifier,
  });

  const resp = await fetch(`${NEXUS_AUTHGEAR_ENDPOINT}/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!resp.ok) {
    throw new Error(data.error_description || data.error || `Authgear token exchange failed (${resp.status})`);
  }
  if (!data.access_token) throw new Error("Authgear did not return an access token");
  return data.access_token;
}

async function createNexusApiKey(accessToken) {
  const resp = await fetch(`${NEXUS_CONTROL_PLANE_URL}/user/apikeys`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: NEXUS_API_KEY_NAME,
      pii_mode: "balanced",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!resp.ok) {
    throw new Error(data.error?.message || data.message || `Nexus API key creation failed (${resp.status})`);
  }
  if (!data.raw_key) throw new Error("Nexus did not return a raw API key");
  return data.raw_key;
}

async function probeOllama() {
  for (const url of OLLAMA_CANDIDATES) {
    try {
      const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map((m) => m.name);
        return { reachable: true, url, models };
      }
    } catch { }
  }
  return { reachable: false, url: null, models: [] };
}

const server = http.createServer(async (req, res) => {
  // CORS for same-origin page
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Start Nexus Authgear login. The callback URI must be authorized in the
  // Authgear application. For the DAppNode setup wizard this is normally:
  // http://openclaw.dappnode:8080/nexus/auth/callback
  // Set NEXUS_AUTH_REDIRECT_URI only when serving the wizard through a proxy.
  if (req.method === "GET" && url.pathname === "/nexus/auth/start") {
    pruneNexusAuthMaps();
    const stateId = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
    const redirectUri = nexusRedirectUri(req);
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") || "/");

    nexusAuthStates.set(stateId, {
      codeVerifier,
      redirectUri,
      returnTo,
      expiresAt: Date.now() + NEXUS_AUTH_RESULT_TTL,
    });

    const authUrl = new URL(`${NEXUS_AUTHGEAR_ENDPOINT}/oauth2/authorize`);
    authUrl.searchParams.set("client_id", NEXUS_AUTHGEAR_CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "openid email profile offline_access");
    authUrl.searchParams.set("state", stateId);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("prompt", "login");

    res.writeHead(302, { "Location": authUrl.toString() });
    res.end();
    return;
  }

  // Finish Nexus Authgear login, create a user API key through Nexus control
  // plane, and stash it for one same-origin fetch by the wizard UI.
  if (req.method === "GET" && url.pathname === "/nexus/auth/callback") {
    pruneNexusAuthMaps();
    const stateId = url.searchParams.get("state") || "";
    const state = nexusAuthStates.get(stateId);
    const fallbackReturnTo = state ? state.returnTo : "/";
    const fail = (message) => {
      res.writeHead(302, { "Location": withReturnParams(fallbackReturnTo, { nexus_auth: "error", nexus_message: message }) });
      res.end();
    };

    if (url.searchParams.get("error")) {
      fail(url.searchParams.get("error_description") || "Nexus login was cancelled");
      return;
    }
    if (!state || state.expiresAt < Date.now()) {
      fail("Nexus login expired. Please try again.");
      return;
    }
    nexusAuthStates.delete(stateId);

    const code = url.searchParams.get("code") || "";
    if (!code) {
      fail("Nexus login did not return an authorization code.");
      return;
    }

    try {
      const accessToken = await exchangeNexusCode(code, state);
      const apiKey = await createNexusApiKey(accessToken);
      const resultId = randomBase64Url(24);
      nexusAuthResults.set(resultId, {
        apiKey,
        expiresAt: Date.now() + NEXUS_AUTH_RESULT_TTL,
      });
      res.writeHead(302, { "Location": withReturnParams(state.returnTo, { nexus_auth: "connected", nexus_result: resultId }) });
      res.end();
    } catch (error) {
      console.error("Nexus login failed:", error.message);
      fail(error.message || "Nexus login failed");
    }
    return;
  }

  // Serve the wizard HTML
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/nexus" || url.pathname === "/nexus/")) {
    try {
      const html = fs.readFileSync(HTML_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Failed to load wizard page");
    }
    return;
  }

  // Consume the one-time Nexus API key result generated by /nexus/auth/callback.
  if (req.method === "POST" && url.pathname === "/api/nexus/auth/result") {
    try {
      pruneNexusAuthMaps();
      const body = await readBody(req);
      const incoming = JSON.parse(body || "{}");
      const id = typeof incoming.id === "string" ? incoming.id : "";
      const result = id ? nexusAuthResults.get(id) : null;
      if (!result || result.expiresAt < Date.now()) {
        json(res, 404, { error: "Nexus login result expired. Please log in again." });
        return;
      }
      nexusAuthResults.delete(id);
      json(res, 200, { apiKey: result.apiKey });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return;
  }

  // Read existing config
  if (req.method === "GET" && url.pathname === "/api/config") {
    try {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      json(res, 404, { error: "No config file found" });
    }
    return;
  }

  // Save config (deep-merge with existing so non-wizard settings are preserved)
  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const body = await readBody(req);
      const incoming = normalizeOpenClawConfig(JSON.parse(body));
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { }
      const merged = normalizeOpenClawConfig(deepMerge(existing, incoming));
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
      json(res, 200, { ok: true, path: CONFIG_FILE });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return;
  }

  // Full-replace config (used for provider removal — deep-merge can't delete keys)
  if (req.method === "PUT" && url.pathname === "/api/config") {
    try {
      const body = await readBody(req);
      const incoming = normalizeOpenClawConfig(JSON.parse(body));
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(incoming, null, 2), "utf-8");
      json(res, 200, { ok: true, path: CONFIG_FILE });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return;
  }

  // Proxy Nexus model list (avoids CORS from browser)
  if (req.method === "GET" && url.pathname === "/api/nexus/models") {
    const apiKey = url.searchParams.get("apiKey") || "";
    if (!apiKey) {
      json(res, 400, { error: "apiKey required" });
      return;
    }
    try {
      const resp = await fetch("https://nexus-api.dappnode.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      const text = await resp.text();
      if (!resp.ok) {
        json(res, resp.status, { error: `Nexus API returned ${resp.status}: ${text.slice(0, 200)}` });
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(text);
    } catch (err) {
      json(res, 502, { error: err.message });
    }
    return;
  }

  // Probe Ollama
  if (req.method === "GET" && url.pathname === "/api/ollama/probe") {
    const result = await probeOllama();
    json(res, 200, result);
    return;
  }

  // Check if WhatsApp is linked (creds file exists for any account)
  if (req.method === "GET" && url.pathname === "/api/whatsapp/linked") {
    const credsDir = path.join(CONFIG_DIR, "credentials", "whatsapp");
    let linked = false;
    try {
      const accounts = fs.readdirSync(credsDir);
      linked = accounts.some(account =>
        fs.existsSync(path.join(credsDir, account, "creds.json"))
      );
    } catch {}
    json(res, 200, { linked });
    return;
  }

  // WhatsApp QR login — SSE stream from `openclaw channels login --channel whatsapp`
  if (req.method === "GET" && url.pathname === "/api/whatsapp/login-stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const child = spawn("openclaw", ["channels", "login", "--channel", "whatsapp"], {
      env: { ...process.env, OPENCLAW_STATE_DIR: CONFIG_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const sendMsg = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    const cleanAnsi = (text) => text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    // WhatsApp QR data from baileys: `1@base64,base64,base64` or bare multi-segment base64
    const QR_PATTERN = /(?:^|\n)(\d+@[A-Za-z0-9+/=,]{40,}|[A-Za-z0-9+/=]{20,}(?:,[A-Za-z0-9+/=]{20,}){2,})/m;

    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(QR_PATTERN);
      if (match) {
        sendMsg({ type: "qr", qr: match[1].trim() });
      } else {
        sendMsg({ type: "log", data: cleanAnsi(text) });
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      sendMsg({ type: "done", code });
      res.end();
    });
    req.on("close", () => child.kill());
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Setup wizard running at http://0.0.0.0:${PORT}`);
});
