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

    // /chatid - 채팅 등록에 필요한 ID 확인
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

    // /ping - 봇 상태 확인
    this.bot.command('ping', (ctx) => {
      ctx.reply(`${BOT_NAME} is online.`);
    });

    // === 관리 명령어 (EP11) ===
    if (this.opts.adminCommands) {
      const admin = this.opts.adminCommands;

      // /register - 현재 채팅을 등록
      this.bot.command('register', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('관리자 권한이 필요합니다.');
          return;
        }

        const chatId = `tg:${ctx.chat.id}`;
        const chatType = ctx.chat.type;
        const chatName =
          chatType === 'private'
            ? ctx.from?.first_name || 'private'
            : (ctx.chat as { title?: string }).title || 'unknown';

        // 폴더명 생성: 소문자, 특수문자 제거
        const folder = chatName
          .toLowerCase()
          .replace(/[^a-z0-9가-힣]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 30) || `chat-${ctx.chat.id}`;

        // 그룹은 트리거 필요, 1:1은 트리거 불필요
        const requiresTrigger = chatType !== 'private';

        try {
          admin.register(chatId, chatName, folder, requiresTrigger);
          ctx.reply(
            `채팅 등록 완료!\nID: \`${chatId}\`\nName: ${chatName}\nFolder: ${folder}\nTrigger: ${requiresTrigger ? `@${BOT_NAME} 멘션 필요` : '모든 메시지 응답'}`,
            { parse_mode: 'Markdown' },
          );
        } catch (err) {
          ctx.reply(`등록 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      // /unregister - 현재 채팅 등록 해제
      this.bot.command('unregister', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('관리자 권한이 필요합니다.');
          return;
        }

        const chatId = `tg:${ctx.chat.id}`;
        try {
          admin.unregister(chatId);
          ctx.reply('채팅 등록이 해제되었습니다.');
        } catch (err) {
          ctx.reply(`해제 실패: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      // /status - 봇 상태 확인
      this.bot.command('status', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('관리자 권한이 필요합니다.');
          return;
        }
        ctx.reply(admin.getStatus());
      });

      // /chats - 등록된 채팅 목록
      this.bot.command('chats', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('관리자 권한이 필요합니다.');
          return;
        }
        ctx.reply(admin.getChats());
      });

      // /tasks - 예약 작업 목록
      this.bot.command('tasks', (ctx) => {
        const userId = ctx.from?.id.toString() || '';
        if (!isAdmin(userId)) {
          ctx.reply('관리자 권한이 필요합니다.');
          return;
        }
        ctx.reply(admin.getTasks());
      });
    }

    // 텍스트 메시지 처리
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

      // @bot_username 멘션을 트리거 패턴으로 변환
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

      // 채팅 메타데이터 저장 (모든 채팅)
      this.opts.onChatMetadata(chatId, timestamp, chatName);

      // 등록된 채팅만 메시지 전달
      const chat = this.opts.registeredChats()[chatId];
      if (!chat) {
        logger.debug({ chatId, chatName }, '미등록 채팅 메시지 무시');
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

      logger.info({ chatId, chatName, sender: senderName }, 'Telegram 메시지 수신');
    });

    // 비텍스트 메시지 플레이스홀더 저장
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

    this.bot.on('message:photo', (ctx) => storeNonText(ctx, '[사진]'));
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[동영상]'));
    this.bot.on('message:voice', (ctx) => storeNonText(ctx, '[음성 메시지]'));
    this.bot.on('message:audio', (ctx) => storeNonText(ctx, '[오디오]'));
    this.bot.on('message:document', (ctx) => {
      const name = ctx.message.document?.file_name || 'file';
      storeNonText(ctx, `[문서: ${name}]`);
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[스티커 ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[위치]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[연락처]'));

    // 에러 핸들러
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram 봇 오류');
    });

    // 폴링 시작
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram 봇 연결 완료',
          );
          console.log(`\n  Telegram 봇: @${botInfo.username}`);
          console.log(`  /chatid - 채팅 ID 확인`);
          console.log(`  /register - 현재 채팅 등록`);
          console.log(`  /ping - 상태 확인\n`);
          resolve();
        },
      });
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram 봇 미초기화');
      return;
    }

    try {
      const numericId = chatId.replace(/^tg:/, '');

      // Telegram 4096자 제한 - 필요 시 분할 전송
      const MAX_LENGTH = 4096;
      if (text.length <= MAX_LENGTH) {
        await this.bot.api.sendMessage(numericId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await this.bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ chatId, length: text.length }, 'Telegram 메시지 전송');
    } catch (err) {
      logger.error({ chatId, err }, 'Telegram 메시지 전송 실패');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram 봇 중지');
    }
  }

  async setTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = chatId.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ chatId, err }, 'Telegram 타이핑 인디케이터 실패');
    }
  }
}
