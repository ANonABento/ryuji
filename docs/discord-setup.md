# Discord Setup

How to create a Discord bot and connect it to Ryuji.

## 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it "Ryuji" (or whatever you want)
4. Go to **Bot** tab in the sidebar

## 2. Configure the Bot

1. Click **Reset Token** to generate a bot token
2. Copy the token — you'll need it for `.env`
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message text)
   - **Server Members Intent** (optional)

## 3. Generate an Invite Link

1. Go to **OAuth2 > URL Generator** in the sidebar
2. Select scopes: `bot`
3. Select permissions:
   - Send Messages
   - Read Message History
   - Read Messages/View Channels
   - Embed Links
   - Attach Files
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## 4. Configure Ryuji

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
```

## 5. Run

```bash
npm run discord
```

You should see:
```
Starting Discord bot...
Discord: logged in as Ryuji#1234
```

## 6. Test

In your Discord server:
```
!ryuji hello
!ryuji what can you do?
```

## Customizing

### Change the prefix

Edit `src/discord/bot.ts`:
```typescript
const BOT_PREFIX = "!ryuji";  // change this
```

### DM support

The bot already listens for DMs. Just message it directly — no prefix needed (planned).

### Per-channel behavior

Each Discord user gets their own session ID (`discord-{userId}`), so memory is per-user. Channel-specific behavior is planned.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot doesn't respond | Check Message Content Intent is enabled |
| "Missing permissions" | Re-invite with correct permissions |
| Bot is slow | Normal — `claude --print` takes a few seconds |
| 2000 char limit | Messages are auto-split at newlines |
