# Discord Setup

How to create a Discord bot and connect it to Ryuji.

## 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it "Ryuji" (or whatever you want)
4. Go to **Bot** tab in the sidebar

## 2. Configure the Bot

1. Click **Reset Token** to generate a bot token
2. Copy the token — you'll need it next
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required)

## 3. Generate an Invite Link

1. Go to **OAuth2 > URL Generator** in the sidebar
2. Select scopes: `bot`
3. Select permissions:
   - View Channels
   - Send Messages
   - Send Messages in Threads
   - Read Message History
   - Attach Files
   - Add Reactions
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## 4. Configure Ryuji

In Claude Code:
```bash
/ryuji:configure <your_bot_token>
```

This saves the token to `~/.claude/channels/ryuji/.env`.

## 5. Start with Ryuji Channel

```bash
claude --channels plugin:ryuji
```

You should see in stderr:
```
Ryuji Discord: logged in as Ryuji#1234
```

## 6. Pair Your Discord Account

1. DM the bot `!pair` on Discord
2. You'll get a 5-letter pairing code
3. In Claude Code: `/ryuji:access pair <code>`
4. Lock down: `/ryuji:access policy allowlist`

## 7. Test

In your Discord server:
```
hey ryuji, what's up?
remember my name is Ben
what do you know about me?
```

## Always-On Setup (tmux)

Since Channels requires Claude Code to be running:

```bash
# Start a tmux session
tmux new -s ryuji

# Run Claude Code with Ryuji
claude --channels plugin:ryuji

# Detach: Ctrl+B, then D
# Reattach later: tmux attach -t ryuji
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond | Check Message Content Intent is enabled |
| "No DISCORD_TOKEN" | Run `/ryuji:configure <token>` |
| Not receiving messages | Check allowlist with `/ryuji:access list` |
| Permission prompts block | Reply to the DM with `yes <code>` or `no <code>` |
| Bot is slow | Normal — Claude Code processes sequentially |
