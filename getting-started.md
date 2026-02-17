# OpenClaw

Self-hosted AI gateway for DappNode

---

## Quick Links

- **[Open Setup Wizard](http://gateway.openclaw.public.dappnode:8080)** — Pick your AI provider, enter your API key, and start chatting in minutes.
- **[Web UI](http://gateway.openclaw.public.dappnode:18789)** — Chat with AI models in your browser.
- **[Terminal](http://gateway.openclaw.public.dappnode:7681)** — Shell access inside the container.

---

## Quick Start

1. **Run the Setup Wizard** — Click the link above or visit `:8080`. Choose a provider (OpenAI, Anthropic, Ollama, etc.), enter your API key, and pick a model.
2. **Open the Web UI** — Go to `:18789` and start a conversation with your AI.
3. **Connect messaging apps** — Optionally add Telegram, Discord, or other bots in the wizard so you can chat from any device.

> **Using Ollama?** Install an Ollama package on your DappNode first, then the wizard will auto-detect it.

---

## Supported Channels

Telegram · Discord · Slack · WhatsApp · Matrix · Web UI

---

## API Access

OpenClaw exposes an OpenAI-compatible API at `http://gateway.openclaw.public.dappnode:18789/api`. Use your gateway token for authentication.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **Gateway not reachable** | Check the container is running. Verify ports 18789/8080 are not blocked. |
| **API key errors** | Re-enter your key in the wizard. Confirm your provider account has credits. |
| **Bot not responding** | Verify bot tokens and permissions. Check logs via the terminal. |
| **Debug from terminal** | Open the web terminal and run: `openclaw doctor` |

---