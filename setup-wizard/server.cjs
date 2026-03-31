#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
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

const PORT = 8080;
const CONFIG_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const CONFIG_FILE = path.join(CONFIG_DIR, "openclaw.json");
const HTML_FILE = path.join(__dirname, "index.html");

const OLLAMA_CANDIDATES = [
  "http://ollama.ollama-nvidia-openwebui.dappnode:11434",
  "http://ollama.ollama-amd-openwebui.dappnode:11434",
  "http://ollama.ollama-cpu-openwebui.dappnode:11434",
  "http://ollama-nvidia.dappnode:11434",
  "http://ollama-amd.dappnode:11434",
  "http://ollama-cpu.dappnode:11434",
  "http://localhost:11434",
];

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

  // Serve the wizard HTML
  if (req.method === "GET" && url.pathname === "/") {
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
      const incoming = JSON.parse(body);
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")); } catch { }
      const merged = deepMerge(existing, incoming);
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
      const incoming = JSON.parse(body);
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(incoming, null, 2), "utf-8");
      json(res, 200, { ok: true, path: CONFIG_FILE });
    } catch (err) {
      json(res, 400, { error: err.message });
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
      stdio: ["pipe", "pipe", "pipe"],
    });

    const send = (text) => {
      // Strip ANSI escape codes before sending to browser
      const clean = text
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .replace(/\x1b\][^\x07]*\x07/g, "");
      res.write(`data: ${JSON.stringify(clean)}\n\n`);
    };

    // Clack uses raw-mode stdin; auto-confirm the "Use local plugin path" prompt with \r
    let promptAnswered = false;
    let buf = "";
    const onData = (chunk) => {
      const text = chunk.toString();
      buf += text;
      if (buf.length > 512) buf = buf.slice(-512);
      if (!promptAnswered && buf.includes("Install WhatsApp plugin")) {
        promptAnswered = true;
        child.stdin.write("\r");
      }
      send(text);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
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
