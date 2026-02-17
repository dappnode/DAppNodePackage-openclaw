#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 8080;
const CONFIG_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const CONFIG_FILE = path.join(CONFIG_DIR, "openclaw.json");
const HTML_FILE = path.join(__dirname, "index.html");

const OLLAMA_CANDIDATES = [
  "http://ollama.ollama-nvidia-openwebui.dappnode:11434",
  "http://ollama.ollama-amd-openwebui.dappnode:11434",
  "http://ollama.ollama-cpu-openwebui.dappnode:11434",
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
    } catch {}
  }
  return { reachable: false, url: null, models: [] };
}

const server = http.createServer(async (req, res) => {
  // CORS for same-origin page
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  // Save config
  if (req.method === "POST" && url.pathname === "/api/config") {
    try {
      const body = await readBody(req);
      JSON.parse(body);
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, body, "utf-8");
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

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Setup wizard running at http://0.0.0.0:${PORT}`);
});
