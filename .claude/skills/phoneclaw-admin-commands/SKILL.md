---
name: phoneclaw-admin-commands
description: "EP10 - PhoneClaw Telegram 관리 명령어 구현"
---

# EP10: Telegram 관리 명령어 (phoneclaw-admin-commands)

## 개요

Telegram 봇의 관리 명령어를 구현합니다. 관리자만 사용할 수 있는 `/register`, `/unregister`, `/status`, `/chats`, `/tasks` 명령어를 통해 봇을 제어합니다. `AdminCommandCallbacks` 인터페이스를 통해 Telegram 채널 계층과 비즈니스 로직(index.ts)을 깔끔하게 분리합니다.

## 의존성

- **EP01~EP10 완료 필수**: 프로젝트 스캐폴드, 데이터베이스, Telegram 채널, Agent Runner, 다중 채팅 지원이 모두 구현되어 있어야 합니다.
- `src/config.ts`에 `ADMIN_USER_IDS`, `BOT_NAME` 상수가 정의되어 있어야 합니다.
- `src/types.ts`에 `RegisteredChat` 인터페이스가 정의되어 있어야 합니다.
- `grammy` 패키지가 설치되어 있어야 합니다.

## 단계별 지시

### 1단계: 관리자 설정 확인

`src/config.ts`에 다음이 있는지 확인합니다:

```typescript
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
```

`.env` 파일에 관리자 Telegram User ID를 설정합니다:
```
ADMIN_USER_IDS=6367628385
```

`ADMIN_USER_IDS`가 비어있으면 모든 사용자가 관리자로 취급됩니다.

### 2단계: `src/channel/telegram.ts`에 AdminCommandCallbacks 인터페이스 및 명령어 구현

파일에 다음 인터페이스와 명령어 핸들러가 포함되어 있어야 합니다:

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

**connect() 메서드 안에 관리 명령어 등록:**

```typescript
    // === 관리 명령어 (EP10) ===
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
```

### 3단계: `src/index.ts`에서 adminCommands 콜백 연결

`main()` 함수 내 `TelegramChannel` 생성 시 `adminCommands` 콜백을 전달합니다:

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
          `${BOT_NAME} 상태`,
          `모드: local`,
          `등록 채팅: ${chatCount}개`,
          `예약 작업: ${activeTasks}/${tasks.length}개 활성`,
          `업타임: ${process.uptime().toFixed(0)}초`,
        ].join('\n');
      },
      getChats: () => {
        const entries = Object.values(registeredChats);
        if (entries.length === 0) return '등록된 채팅이 없습니다.';
        return entries
          .map((c) => `- ${c.name} (${c.chatId})\n  폴더: ${c.folder}, 트리거: ${c.requiresTrigger ? '필요' : '불필요'}`)
          .join('\n');
      },
      getTasks: () => {
        const tasks = getAllTasks();
        if (tasks.length === 0) return '예약 작업이 없습니다.';
        return tasks
          .map((t) => `- [${t.id.slice(0, 8)}] ${t.prompt.slice(0, 40)}...\n  ${t.scheduleType}: ${t.scheduleValue} (${t.status})`)
          .join('\n');
      },
    },
  });
```

## 명령어 요약

| 명령어 | 설명 | 관리자 전용 |
|--------|------|:-----------:|
| `/chatid` | 현재 채팅의 ID 확인 | X |
| `/ping` | 봇 온라인 상태 확인 | X |
| `/register` | 현재 채팅을 봇에 등록 | O |
| `/unregister` | 현재 채팅 등록 해제 | O |
| `/status` | 봇 상태 정보 (모드, 채팅 수, 작업 수, 업타임) | O |
| `/chats` | 등록된 채팅 목록 | O |
| `/tasks` | 예약 작업 목록 | O |

## 핵심 동작 원리

1. **관리자 인증**:
   - `ADMIN_USER_IDS` 환경변수에 쉼표로 구분된 Telegram User ID 설정
   - 비어있으면 모든 사용자에게 관리 명령어 허용 (개발 편의)
   - `isAdmin()` 함수로 각 명령어 실행 전 권한 확인

2. **Callback Pattern (관심사 분리)**:
   - `telegram.ts`는 Telegram API 상호작용만 담당
   - 실제 비즈니스 로직 (`registerChat`, `unregisterChat` 등)은 `index.ts`에 구현
   - `AdminCommandCallbacks` 인터페이스를 통해 느슨하게 결합
   - 이 패턴 덕분에 다른 채널(Slack, Discord 등)에도 동일한 콜백 재사용 가능

3. **`/register` 자동 설정**:
   - 채팅 이름에서 폴더명 자동 생성
   - 개인 채팅: `requiresTrigger = false` (모든 메시지 응답)
   - 그룹 채팅: `requiresTrigger = true` (`@BotName` 멘션 필요)

4. **`/status` 대시보드 정보**:
   - 봇 이름, 실행 모드 (local)
   - 등록된 채팅 수
   - 활성/전체 예약 작업 수
   - 프로세스 업타임

## 검증

1. TypeScript 컴파일 확인:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. `src/channel/telegram.ts`에서 `AdminCommandCallbacks` 인터페이스가 export되는지 확인

3. `src/index.ts`에서 `adminCommands` 객체가 `TelegramChannel` 생성자에 전달되는지 확인

4. 다음 5개 명령어가 모두 등록되어 있는지 확인:
   - `/register`, `/unregister`, `/status`, `/chats`, `/tasks`

5. 각 관리 명령어에 `isAdmin()` 권한 검사가 포함되어 있는지 확인

6. 테스트 실행:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
