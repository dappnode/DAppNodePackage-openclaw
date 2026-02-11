# Getting Started with OpenClaw on DappNode

Welcome to OpenClaw, your self-hosted AI agent gateway!

## Quick Start

1. **Access the Web UI**: After installation, click the "UI" link in DappNode or navigate to:
   ```
   http://gateway.openclaw.public.dappnode:18789
   ```

2. **Configure an LLM Provider**: You need at least one AI model provider configured:
   - **OpenAI**: Get your API key from [platform.openai.com](https://platform.openai.com/api-keys)
   - **Anthropic Claude**: Get your API key from [console.anthropic.com](https://console.anthropic.com/)
   - **Google Gemini**: Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
   - **Local with Ollama**: Connect to your Ollama instance for free local models

3. **Set Your Gateway Token**: For security, set a gateway access token in the environment variables.

## Features

### Web Interface
- Chat with AI models directly in your browser
- Canvas mode for visual interactions
- Session management and history

### Messaging Integrations
Configure bots to chat with AI through:
- **Telegram**: Add your bot token from @BotFather
- **Discord**: Create a bot at Discord Developer Portal
- **Slack**: Configure a Slack app with bot tokens
- **WhatsApp**: Use Twilio for WhatsApp integration
- **Matrix**: Connect to your Matrix homeserver

### API Access
OpenClaw exposes an OpenAI-compatible API at:
```
http://gateway.openclaw.public.dappnode:18789/api
```

Use your gateway token for authentication.

## Environment Variables

All configuration is done through environment variables. Access them in DappNode's package config:

| Variable | Description |
|----------|-------------|
| `OPENCLAW_GATEWAY_TOKEN` | Secret token for API access |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |

See the full list in the DappNode package configuration panel.

## Backup & Restore

Your OpenClaw data is automatically backed up by DappNode. The backup includes:
- Configuration files
- Conversation history
- Session data

## Troubleshooting

### Gateway not accessible
- Check that the container is running in DappNode
- Verify no firewall is blocking ports 18789/18790
- Check container logs for errors

### API key errors
- Verify your API key is correctly entered
- Check your provider account has available credits
- Ensure the API key has the required permissions

### Bot not responding
- Verify bot tokens are correctly configured
- Check that the bot has proper permissions in the chat platform
- Review logs for connection errors

## Support

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [GitHub Issues](https://github.com/dappnode/DAppNodePackage-openclaw-generic/issues)
- [DappNode Discord](https://discord.gg/dappnode)
