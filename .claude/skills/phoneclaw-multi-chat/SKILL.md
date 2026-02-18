---
name: phoneclaw-multi-chat
description: "EP09 - PhoneClaw Multi-Chat Support Implementation"
---

# EP09: Multi-Chat Support (phoneclaw-multi-chat)

## Overview

Enables the PhoneClaw bot to manage multiple Telegram chats (personal DMs, groups) simultaneously. Each chat has a unique folder with independent CLAUDE.md settings and logs. Chats are registered with `registerChat` and unregistered with `unregisterChat`, and registration data is permanently stored in the SQLite DB.

## Dependencies

- **EP01~EP08 must be completed**: Project scaffold, database, Telegram channel, and Agent Runner must be implemented.
- The `RegisteredChat` interface must be defined in `src/types.ts`.
- `setRegisteredChat`, `removeRegisteredChat`, and `getAllRegisteredChats` functions must exist in `src/db.ts`.
- The `CHATS_DIR` constant must be defined in `src/config.ts`.

## Step-by-Step Instructions

### Step 1: Verify Types

Check that the following interface exists in `src/types.ts`:

```typescript
export interface RegisteredChat {
  chatId: string;
  name: string;
  folder: string;
  requiresTrigger: boolean;
  addedAt: string;
}
```

### Step 2: Verify DB Functions

Check that the following functions exist in `src/db.ts`:

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

### Step 3: Implement Multi-Chat Logic in `src/index.ts`

The following functions and state management code must be included in `src/index.ts`:

**State variable** (top of file):
```typescript
let registeredChats: Record<string, RegisteredChat> = {};
```

**Load chats in loadState() function**:
```typescript
function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('last_agent_timestamp corrupted, resetting');
    lastAgentTimestamp = {};
  }
  registeredChats = getAllRegisteredChats();
  logger.info({ chatCount: Object.keys(registeredChats).length }, 'State loaded');
}
```

**registerChat function**:
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

  // Create chat folder
  const chatDir = path.join(CHATS_DIR, folder);
  fs.mkdirSync(path.join(chatDir, 'logs'), { recursive: true });

  // Create default CLAUDE.md
  const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\nAI assistant settings for this chat.\n`);
  }

  logger.info({ chatId, name, folder }, 'Chat registered');
}
```

**unregisterChat function**:
```typescript
function unregisterChat(chatId: string): void {
  delete registeredChats[chatId];
  removeRegisteredChat(chatId);
  logger.info({ chatId }, 'Chat unregistered');
}
```

**Create folders in main() function**:
```typescript
async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CHATS_DIR, { recursive: true });
  // ...
}
```

## Core Behavior

1. **Chat registration flow**:
   - Telegram `/register` command -> calls `registerChat()`
   - Added to in-memory `registeredChats` object + permanently saved to DB
   - `chats/{folder}/` directory created (including `logs/` subdirectory)
   - Default `CLAUDE.md` file created (per-chat Agent settings)

2. **Chat unregistration flow**:
   - Telegram `/unregister` command -> calls `unregisterChat()`
   - Removed from in-memory object + deleted from DB
   - Folder is not deleted (logs are preserved)

3. **Independent per-chat management**:
   - Each chat has a unique `folder` (folder name = normalized from chat name)
   - Agent behavior can be individually configured via per-chat CLAUDE.md
   - Independent message cursor management via per-chat `lastAgentTimestamp`
   - `requiresTrigger`: Group chats require `@BotName` mention; 1:1 chats respond to all messages

4. **Folder name generation rules** (`/register` handler in telegram.ts):
   - Convert chat name to lowercase
   - Replace characters other than alphanumeric and Korean with `-`
   - Remove leading/trailing `-`, max 30 characters
   - If folder name is empty, use `chat-{chatId}`

5. **Crash recovery**:
   - On app restart, `loadState()` restores from DB via `getAllRegisteredChats()`
   - `recoverPendingMessages()` rechecks unprocessed messages

## Directory Structure Example

```
chats/
  dante-private/
    CLAUDE.md          # Agent settings for this chat
    logs/              # Execution logs
  my-team-group/
    CLAUDE.md
    logs/
```

## Verification

1. Verify TypeScript compilation:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. Verify that `registerChat` and `unregisterChat` functions are defined in `src/index.ts`

3. Verify that when `registerChat` is called, the following are performed:
   - Added to `registeredChats` object
   - Saved to DB via `setRegisteredChat(chat)`
   - `chats/{folder}/logs/` directory created
   - `CLAUDE.md` file created

4. Verify that when `unregisterChat` is called, the following are performed:
   - Removed from `registeredChats` object
   - Deleted from DB via `removeRegisteredChat(chatId)`

5. Run tests:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
