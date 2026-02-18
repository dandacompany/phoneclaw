---
name: phoneclaw-telegram
description: "PhoneClaw EP02 - Telegram bot connection. Implements a grammy-based Telegram channel for message receiving/sending and command handling."
---

# EP02: Telegram Bot Connection

## Overview

Implements a channel module that connects to the Telegram Bot API using the grammy library.
Implements PhoneClaw's Channel interface to provide the following features:

- Polling connection with Telegram bot token
- `/chatid`, `/ping`, `/register`, `/unregister`, `/status`, `/chats`, `/tasks` commands
- Text message reception and callback delivery
- Non-text message (photo, video, etc.) placeholder storage
- `@botname` mention to trigger pattern conversion
- Admin permission check
- Automatic message splitting for 4096-character limit
- Typing indicator

## Dependencies

- **EP01 must be completed**: `package.json`, `tsconfig.json`, `src/config.ts`, `src/logger.ts`, `src/types.ts` must exist.
- `npm install` must be completed

## Step-by-Step Instructions

### Step 1: Create Channel Directory

```bash
mkdir -p src/channel
```

### Step 2: Create src/channel/telegram.ts

Write `src/channel/telegram.ts` with the following content:

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

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    // /chatid - Check ID needed for chat registration
    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as { title?: string }).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    // /ping - Check bot status
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${BOT_NAME} is online.`);
    });

    // === Admin commands (EP11) ===
    if (this.opts.adminCommands) {
      const admin = this.opts.adminCommands;

      // /register - Register the current chat
      this.bot.command('register', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin permission required.');
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

        // Groups require trigger, 1:1 chats do not
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
          ctx.reply('Admin permission required.');
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
          ctx.reply('Admin permission required.');
          return;
        }
        ctx.reply(admin.getStatus());
      });

      // /chats - List registered chats
      this.bot.command('chats', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin permission required.');
          return;
        }
        ctx.reply(admin.getChats());
      });

      // /tasks - List scheduled tasks
      this.bot.command('tasks', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('Admin permission required.');
          return;
        }
        ctx.reply(admin.getTasks());
      });
    }

    // Handle text messages
    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const chatId = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const senderId = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as { title?: string }).title || chatId;

      // Convert @bot_username mention to trigger pattern
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${BOT_NAME} ${content}`;
        }
      }

      // Store chat metadata (all chats)
      this.opts.onChatMetadata(chatId, timestamp, chatName);

      // Only deliver messages for registered chats
      const chat = this.opts.registeredChats()[chatId];
      if (!chat) {
        logger.debug({ chatId, chatName }, 'Ignoring message from unregistered chat');
        return;
      }

      this.opts.onMessage(chatId, {
        id: msgId,
        chatId,
        senderId,
        senderName,
        content,
        timestamp,
        isFromMe: false,
      });

      logger.info({ chatId, chatName, sender: senderName }, 'Telegram message received');
    });

    // Store non-text message placeholders
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatId = `tg:${ctx.chat.id}`;
      const chat = this.opts.registeredChats()[chatId];
      if (!chat) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name || ctx.from?.username || ctx.from?.id?.toString() || 'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatId, timestamp);
      this.opts.onMessage(chatId, {
        id: ctx.message.message_id.toString(),
        chatId,
        senderId: ctx.from?.id?.toString() || '',
        senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        isFromMe: false,
      });
    };

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[Photo]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, '[Voice message]'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[Audio]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[Document: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    // Error handler
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Start polling
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram Bot: @${botInfo.username}`);
          console.log(`  /chatid - Check chat ID`);
          console.log(`  /register - Register current chat`);
          console.log(`  /ping - Check status\n`);
          resolve();
        },
      });
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = chatId.replace(/^tg:/, '');

      // Telegram 4096-character limit - split if necessary
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ chatId, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ chatId, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = chatId.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ chatId, err }, 'Failed to send typing indicator');
    }
  }
}
```

## Verification

Run a type check to ensure there are no errors:

```bash
npx tsc --noEmit
```

If the type check passes, EP02 is complete.
In the next episode (EP03), we will implement the SQLite database.
