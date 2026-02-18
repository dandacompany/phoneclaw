---
name: phoneclaw-admin-commands
description: "EP10 - PhoneClaw Telegram Admin Commands Implementation"
---

# EP10: Telegram Admin Commands (phoneclaw-admin-commands)

## Overview

Implements admin commands for the Telegram bot. Controls the bot through admin-only commands: `/register`, `/unregister`, `/status`, `/chats`, and `/tasks`. Uses the `AdminCommandCallbacks` interface to cleanly separate the Telegram channel layer from the business logic (index.ts).

## Dependencies

- **EP01~EP10 must be completed**: Project scaffold, database, Telegram channel, Agent Runner, and multi-chat support must all be implemented.
- `ADMIN_USER_IDS` and `BOT_NAME` constants must be defined in `src/config.ts`.
- `RegisteredChat` interface must be defined in `src/types.ts`.
- `grammy` package must be installed.

## Step-by-Step Instructions

### Step 1: Verify Admin Configuration

Confirm the following exists in `src/config.ts`:

```typescript
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
```

Set the admin Telegram User ID in the `.env` file:
```
ADMIN_USER_IDS=6367628385
```

If `ADMIN_USER_IDS` is empty, all users are treated as admins.

### Step 2: Implement AdminCommandCallbacks Interface and Commands in `src/channel/telegram.ts`

The file must contain the following interface and command handlers:

```typescript
import { Bot } from 'grammy';

import { BOT_NAME, TRIGGER_PATTERN, ADMIN_USER_IDS } from '../config.js';
import { logger } from '../logger.js';
import type { Channel, OnInboundMessage, OnChatMetadata, RegisteredChat } from '../types.js';

export interface AdminCommandCallbacks {
  register: (chatId: string, name: string, folder: string, requiresTrigger: boolean) => void;
  unregister: (chatId: string) => void;
  getStatus: () => string;
  getChats: () => string;
  getTasks: () => string;
}

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredChats: () => Record<string, RegisteredChat>;
  adminCommands?: AdminCommandCallbacks;
}

function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.length === 0 || ADMIN_USER_IDS.includes(userId);
}
```

**Register admin commands inside the connect() method:**

```typescript
    // === Admin Commands (EP10) ===
    if (this.opts.adminCommands) {
      const admin = this.opts.adminCommands;

      // /register - Register the current chat
      this.bot.command('register', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin privileges required.');
          return;
        }

        const chatId = `tg:${ctx.chat.id}`;
        const chatType = ctx.chat.type;
        const chatName =
          chatType === 'private'
            ? ctx.from?.first_name || 'private'
            : (ctx.chat as { title?: string }).title || 'unknown';

        // Generate folder name: lowercase, remove special characters
        const folder = chatName
          .toLowerCase()
          .replace(/[^a-z0-9가-힣]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 30) || `chat-${ctx.chat.id}`;

        // Groups require trigger, private chats do not
        const requiresTrigger = chatType !== 'private';

        try {
          admin.register(chatId, chatName, folder, requiresTrigger);
          ctx.reply(
            `Chat registered!\nID: \`${chatId}\`\nName: ${chatName}\nFolder: ${folder}\nTrigger: ${requiresTrigger ? `@${BOT_NAME} mention required` : 'Responds to all messages'}`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          ctx.reply(`Registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      // /unregister - Unregister the current chat
      this.bot.command('unregister', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin privileges required.');
          return;
        }

        const chatId = `tg:${ctx.chat.id}`;
        try {
          admin.unregister(chatId);
          ctx.reply('Chat has been unregistered.');
        } catch (err) {
          ctx.reply(`Unregistration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      // /status - Check bot status
      this.bot.command('status', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin privileges required.');
          return;
        }
        ctx.reply(admin.getStatus());
      });

      // /chats - List registered chats
      this.bot.command('chats', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin privileges required.');
          return;
        }
        ctx.reply(admin.getChats());
      });

      // /tasks - List scheduled tasks
      this.bot.command('tasks', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin privileges required.');
          return;
        }
        ctx.reply(admin.getTasks());
      });
    }
```

### Step 3: Connect adminCommands Callbacks in `src/index.ts`

Pass the `adminCommands` callbacks when creating the `TelegramChannel` inside the `main()` function:

```typescript
  channel = new TelegramChannel(TELEGRAM_BOT_TOKEN, {
    onMessage: (_chatId: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatId: string, timestamp: string, name?: string) =>
      storeChatMetadata(chatId, timestamp, name),
    registeredChats: () => registeredChats,
    adminCommands: {
      register: (chatId, name, folder, requiresTrigger) =>
        registerChat(chatId, name, folder, requiresTrigger),
      unregister: (chatId) => unregisterChat(chatId),
      getStatus: () => {
        const chatCount = Object.keys(registeredChats).length;
        const tasks = getAllTasks();
        const activeTasks = tasks.filter((t) => t.status === 'active').length;
        return [
          `${BOT_NAME} Status`,
          `Mode: local`,
          `Registered chats: ${chatCount}`,
          `Scheduled tasks: ${activeTasks}/${tasks.length} active`,
          `Uptime: ${process.uptime().toFixed(0)}s`,
        ].join('\n');
      },
      getChats: () => {
        const entries = Object.values(registeredChats);
        if (entries.length === 0) return 'No registered chats.';
        return entries
          .map((c) => `- ${c.name} (${c.chatId})\n  Folder: ${c.folder}, Trigger: ${c.requiresTrigger ? 'required' : 'not required'}`)
          .join('\n');
      },
      getTasks: () => {
        const tasks = getAllTasks();
        if (tasks.length === 0) return 'No scheduled tasks.';
        return tasks
          .map((t) => `- [${t.id.slice(0, 8)}] ${t.prompt.slice(0, 40)}...\n  ${t.scheduleType}: ${t.scheduleValue} (${t.status})`)
          .join('\n');
      },
    },
  });
```

## Command Summary

| Command | Description | Admin Only |
|---------|-------------|:----------:|
| `/chatid` | Check the current chat ID | No |
| `/ping` | Check bot online status | No |
| `/register` | Register the current chat with the bot | Yes |
| `/unregister` | Unregister the current chat | Yes |
| `/status` | Bot status info (mode, chat count, task count, uptime) | Yes |
| `/chats` | List registered chats | Yes |
| `/tasks` | List scheduled tasks | Yes |

## Core Operating Principles

1. **Admin Authentication**:
   - Set comma-separated Telegram User IDs in the `ADMIN_USER_IDS` environment variable
   - If empty, admin commands are allowed for all users (for development convenience)
   - The `isAdmin()` function checks permissions before each command execution

2. **Callback Pattern (Separation of Concerns)**:
   - `telegram.ts` handles only Telegram API interactions
   - Actual business logic (`registerChat`, `unregisterChat`, etc.) is implemented in `index.ts`
   - Loosely coupled through the `AdminCommandCallbacks` interface
   - This pattern allows the same callbacks to be reused for other channels (Slack, Discord, etc.)

3. **`/register` Auto-Configuration**:
   - Automatically generates folder name from chat name
   - Private chats: `requiresTrigger = false` (responds to all messages)
   - Group chats: `requiresTrigger = true` (`@BotName` mention required)

4. **`/status` Dashboard Information**:
   - Bot name, execution mode (local)
   - Number of registered chats
   - Active/total scheduled tasks
   - Process uptime

## Verification

1. Confirm TypeScript compilation:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. Verify that the `AdminCommandCallbacks` interface is exported from `src/channel/telegram.ts`

3. Verify that the `adminCommands` object is passed to the `TelegramChannel` constructor in `src/index.ts`

4. Confirm all 5 commands are registered:
   - `/register`, `/unregister`, `/status`, `/chats`, `/tasks`

5. Verify that each admin command includes an `isAdmin()` permission check

6. Run tests:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
