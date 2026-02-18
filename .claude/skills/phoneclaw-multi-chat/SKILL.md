---
name: phoneclaw-multi-chat
description: "EP09 - PhoneClaw 다중 채팅 지원 구현"
---

# EP09: 다중 채팅 지원 (phoneclaw-multi-chat)

## 개요

PhoneClaw 봇이 여러 Telegram 채팅(개인 DM, 그룹)을 동시에 관리할 수 있도록 합니다. 각 채팅은 고유한 폴더를 가지며, 독립적인 CLAUDE.md 설정과 로그를 유지합니다. `registerChat`으로 채팅을 등록하고 `unregisterChat`으로 해제하며, 등록 정보는 SQLite DB에 영구 저장됩니다.

## 의존성

- **EP01~EP08 완료 필수**: 프로젝트 스캐폴드, 데이터베이스, Telegram 채널, Agent Runner가 구현되어 있어야 합니다.
- `src/types.ts`에 `RegisteredChat` 인터페이스가 정의되어 있어야 합니다.
- `src/db.ts`에 `setRegisteredChat`, `removeRegisteredChat`, `getAllRegisteredChats` 함수가 존재해야 합니다.
- `src/config.ts`에 `CHATS_DIR` 상수가 정의되어 있어야 합니다.

## 단계별 지시

### 1단계: 타입 확인

`src/types.ts`에 다음 인터페이스가 있는지 확인합니다:

```typescript
export interface RegisteredChat {
  chatId: string;
  name: string;
  folder: string;
  requiresTrigger: boolean;
  addedAt: string;
}
```

### 2단계: DB 함수 확인

`src/db.ts`에 다음 함수들이 있는지 확인합니다:

```typescript
export function setRegisteredChat(chat: RegisteredChat): void {
  db.prepare(`
    INSERT OR REPLACE INTO registered_chats (chat_id, name, folder, requires_trigger, added_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(chat.chatId, chat.name, chat.folder, chat.requiresTrigger ? 1 : 0, chat.addedAt);
}

export function removeRegisteredChat(chatId: string): void {
  db.prepare('DELETE FROM registered_chats WHERE chat_id = ?').run(chatId);
}

export function getAllRegisteredChats(): Record<string, RegisteredChat> {
  const rows = db.prepare('SELECT * FROM registered_chats').all() as Array<{
    chat_id: string; name: string; folder: string; requires_trigger: number; added_at: string;
  }>;
  const result: Record<string, RegisteredChat> = {};
  for (const row of rows) {
    result[row.chat_id] = {
      chatId: row.chat_id,
      name: row.name,
      folder: row.folder,
      requiresTrigger: row.requires_trigger === 1,
      addedAt: row.added_at,
    };
  }
  return result;
}
```

### 3단계: `src/index.ts`에 다중 채팅 로직 구현

`src/index.ts`에 다음 함수들과 상태 관리 코드가 포함되어 있어야 합니다:

**상태 변수** (파일 상단):
```typescript
let registeredChats: Record<string, RegisteredChat> = {};
```

**loadState() 함수에서 채팅 로드**:
```typescript
function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('last_agent_timestamp 손상, 초기화');
    lastAgentTimestamp = {};
  }
  registeredChats = getAllRegisteredChats();
  logger.info({ chatCount: Object.keys(registeredChats).length }, '상태 로드 완료');
}
```

**registerChat 함수**:
```typescript
function registerChat(chatId: string, name: string, folder: string, requiresTrigger: boolean): void {
  const chat: RegisteredChat = {
    chatId,
    name,
    folder,
    requiresTrigger,
    addedAt: new Date().toISOString(),
  };
  registeredChats[chatId] = chat;
  setRegisteredChat(chat);

  // 채팅 폴더 생성
  const chatDir = path.join(CHATS_DIR, folder);
  fs.mkdirSync(path.join(chatDir, 'logs'), { recursive: true });

  // 기본 CLAUDE.md 생성
  const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\n이 채팅의 AI 비서 설정입니다.\n`);
  }

  logger.info({ chatId, name, folder }, '채팅 등록 완료');
}
```

**unregisterChat 함수**:
```typescript
function unregisterChat(chatId: string): void {
  delete registeredChats[chatId];
  removeRegisteredChat(chatId);
  logger.info({ chatId }, '채팅 등록 해제');
}
```

**main() 함수에서 폴더 생성**:
```typescript
async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  // ...
}
```

## 핵심 동작 원리

1. **채팅 등록 흐름**:
   - Telegram `/register` 명령 -> `registerChat()` 호출
   - 인메모리 `registeredChats` 객체에 추가 + DB에 영구 저장
   - `chats/{folder}/` 디렉토리 생성 (하위 `logs/` 포함)
   - `CLAUDE.md` 기본 파일 생성 (채팅별 Agent 설정)

2. **채팅 해제 흐름**:
   - Telegram `/unregister` 명령 -> `unregisterChat()` 호출
   - 인메모리 객체에서 삭제 + DB에서 삭제
   - 폴더는 삭제하지 않음 (로그 보존)

3. **채팅별 독립 관리**:
   - 각 채팅은 고유한 `folder`를 가짐 (폴더명 = 채팅 이름 기반 정규화)
   - 채팅별 CLAUDE.md로 Agent 동작을 개별 설정 가능
   - 채팅별 `lastAgentTimestamp`로 메시지 커서 독립 관리
   - `requiresTrigger`: 그룹 채팅은 `@BotName` 멘션 필요, 1:1은 모든 메시지 응답

4. **폴더명 생성 규칙** (telegram.ts의 `/register` 핸들러):
   - 채팅 이름을 소문자로 변환
   - 알파벳, 숫자, 한글 외 문자를 `-`로 치환
   - 앞뒤 `-` 제거, 최대 30자
   - 폴더명이 비면 `chat-{chatId}` 사용

5. **크래시 복구**:
   - 앱 재시작 시 `loadState()`에서 `getAllRegisteredChats()`로 DB에서 복원
   - `recoverPendingMessages()`로 미처리 메시지 재확인

## 디렉토리 구조 예시

```
chats/
  dante-private/
    CLAUDE.md          # 이 채팅의 Agent 설정
    logs/              # 실행 로그
  my-team-group/
    CLAUDE.md
    logs/
```

## 검증

1. TypeScript 컴파일 확인:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. `src/index.ts`에서 `registerChat`, `unregisterChat` 함수가 정의되어 있는지 확인

3. `registerChat` 호출 시 다음이 수행되는지 확인:
   - `registeredChats` 객체에 추가
   - `setRegisteredChat(chat)` DB 저장
   - `chats/{folder}/logs/` 디렉토리 생성
   - `CLAUDE.md` 파일 생성

4. `unregisterChat` 호출 시 다음이 수행되는지 확인:
   - `registeredChats` 객체에서 삭제
   - `removeRegisteredChat(chatId)` DB 삭제

5. 테스트 실행:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
