# Getting Started with OpenClaw on DappNode

Welcome to OpenClaw, your self-hosted AI agent gateway!

## Quick Start

1. **Run the Setup Wizard**: The easiest way to get started is through the built-in wizard:
   ```
   http://gateway.openclaw.public.dappnode:8080
   ```
   It will walk you through choosing an AI provider, entering your API key, and optionally connecting messaging apps like Telegram or Discord.

2. **Access the Web UI**: Once configured, open the main interface:
   ```
   http://gateway.openclaw.public.dappnode:18789
   ```

3. **Set Your Gateway Token**: For security, set a gateway access token in the setup wizard or environment variables.

## Features

### Web Interface
- Chat with AI models directly in your browser
- Canvas mode for visual interactions
- Session management and history

### Terminal Access
Need to troubleshoot or run commands inside the container? OpenClaw includes a built-in web terminal:
```
http://gateway.openclaw.public.dappnode:7681
```
This opens a full Bash shell in your browser -- no SSH needed. You can use it to:
- Check logs and debug issues
- Inspect configuration files
- Install additional tools
- Run one-off commands

You can also access it from the **Terminal** link in your DappNode package dashboard.

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

### Using the built-in terminal
If you need to inspect the container directly, open the web terminal at:

```
http://gateway.openclaw.public.dappnode:7681
```

From there you can run commands like:
- `cat /home/node/.openclaw/openclaw.json` -- View the current configuration
- `ls /home/node/.openclaw/` -- List data files
- `curl -sf http://localhost:18789/health` -- Test the health endpoint

## Support

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [GitHub Issues](https://github.com/dappnode/DAppNodePackage-openclaw/issues)
- [DappNode Discord](https://discord.gg/dappnode)
