# Telegram

Open **Telegram** in the damndots sidebar. Settings belong to the server currently selected in the dashboard.

1. Create a bot using [BotFather](https://t.me/BotFather) and copy its token.
2. Enter the token, your numeric Telegram user ID, and the Dot to connect. A bot username is not a user ID. You can obtain your own ID from a Telegram user-info bot.
3. Open your bot in Telegram and press **Start**. Enable the connection and save.
4. Use **Check connection** and **Send test message** to verify the connection.

Only the configured user in their private chat can submit messages. Group chats and other users are ignored. The token is encrypted in the server database and never returned to the dashboard. No public webhook or additional listening port is needed. Only one process may poll a bot; disable any old Telegram bridge or webhook first.

Incoming text uses the Dot's existing chat. Enable **Mirror desktop messages** to copy Codex/dashboard messages to Telegram, and **Mirror Dot replies** to copy replies regardless of where the request was sent. Telegram messages are not echoed back. Long replies are split into safe-sized messages. A connection starts with new chat activity; it does not replay the entire chat history. Photo and voice inputs are not supported yet.

Update offsets and delivery progress are persisted. Rate-limited deliveries retry. If a send was interrupted and its delivery cannot be confirmed, the dashboard shows an uncertain delivery count and does not automatically resend it. Check Telegram before manually resending a message.

**Disconnect** stops polling and removes the saved token. It preserves Dot chat history. The connection runs inside the normal damndots server and follows its start/stop lifecycle.

## Migrating the older standalone Python bridge

Stop the old bridge and the damndots server, back up the server data directory, then run from the repository root:

```sh
node --import tsx scripts/migrate-telegram-bridge.ts --data-dir /path/to/dots-data --legacy-dir /path/to/dots-telegram
```

The migration reads `bot.token` and `state.json`, encrypts the token using the server's existing signing key, and preserves the owner, Dot, Telegram update offset, and delivered message receipts. It refuses to replace an already configured dashboard connection. Restart damndots afterwards; leave the old poller disabled.
