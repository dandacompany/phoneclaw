---
name: phoneclaw-session-memory
description: "PhoneClaw EP07 - Session Memory. Uses the Claude Code SDK session resume feature and per-chat CLAUDE.md files so the Agent can remember previous conversation context and apply different personalities/instructions for each chat."
---

# EP07: PhoneClaw Session Memory

Build a **session memory** system that allows the Agent to remember previous conversations and apply different personalities and instructions per chat.

## Overview

PhoneClaw's session memory is built on two pillars:

1. **Session Resume** - Carries over prior conversation context via the Claude Code SDK `resume` option.
2. **Per-Chat CLAUDE.md** - A `CLAUDE.md` file in each chat folder customizes the Agent's personality, expertise, and response style.

### Session Flow

```
1. New message received
2. Look up existing sessionId from DB (sessions table)
3. Pass resume: sessionId when calling Claude Code query()
4. Agent responds with previous conversation context included
5. Save new sessionId to DB
```

### Data Structure

```
data/
  phoneclaw.db          # sessions table: chat_folder -> session_id

chats/
  study-group/
    CLAUDE.md           # Agent customization for this chat
    logs/               # Log directory
  personal/
    CLAUDE.md           # Agent settings with a different personality
    logs/
```

## Dependencies

- **EP01~EP06 must be completed**: In particular, the `getSession()` and `setSession()` functions in `db.ts` and the session integration logic in `local-runner.ts` are required.

## Step-by-Step Instructions

### Step 1: Verify DB Session Store

The following functions should already be implemented in `src/db.ts`:

```typescript
// src/db.ts (existing code - for reference)

// Session table schema (inside createSchema)
// CREATE TABLE IF NOT EXISTS sessions (
//   chat_folder TEXT PRIMARY KEY,
//   session_id TEXT NOT NULL
// );

export function getSession(chatFolder: string): string | undefined {
  const row = db.prepare('SELECT session_id FROM sessions WHERE chat_folder = ?').get(chatFolder) as {
    session_id: string;
  } | undefined;
  return row?.session_id;
}

export function setSession(chatFolder: string, sessionId: string): void {
  db.prepare('INSERT OR REPLACE INTO sessions (chat_folder, session_id) VALUES (?, ?)').run(chatFolder, sessionId);
}
```

### Step 2: Verify Local Runner Session Resume Logic

Check how sessions are resumed in `src/agent/local-runner.ts`. Key code:

```typescript
// src/agent/local-runner.ts (existing code - for reference)

// 1. Look up existing session
const existingSessionId = input.sessionId || getSession(chat.folder);

// 2. Pass resume option when calling query()
for await (const message of query({
  prompt: input.prompt,
  options: {
    cwd: chatDir,
    resume: existingSessionId,   // <-- Key: resume previous session
    appendSystemPrompt: systemAppend,
    // ...
  },
})) {
  // 3. Obtain new sessionId from init message
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
  // ...
}

// 4. Save new sessionId
if (sessionId) {
  setSession(chat.folder, sessionId);
}
```

### Step 3: Per-Chat CLAUDE.md System

When a chat is registered, `chats/{folder}/CLAUDE.md` is automatically created (see EP05 `registerChat()`).
The contents of this file are appended to the Agent's `appendSystemPrompt`.

```typescript
// Inside src/agent/local-runner.ts (existing code - for reference)
let systemAppend = `Your name is ${BOT_NAME}. Respond to Telegram messages in Korean. Keep your responses concise and natural.`;
if (fs.existsSync(claudeMdPath)) {
  systemAppend += '\n\n' + fs.readFileSync(claudeMdPath, 'utf-8');
}
```

### Step 4: CLAUDE.md Customization Guide

Edit the `CLAUDE.md` in each chat folder to configure Agent behavior differently per chat.

#### Default Template

Default content auto-generated when a chat is registered:

```markdown
# {Chat Name}

AI assistant settings for this chat.
```

#### Customization Example 1: Study Group

```markdown
# Study Group

## Role
You are a mentor helping with AI/ML learning. Answer group members' questions kindly and in detail.

## Response Rules
- Always include explanations when providing code examples
- Explain difficult concepts using analogies
- Recommend relevant learning resources (documentation, papers)
- Add follow-up questions to encourage discussion among group members

## Expertise
- Python, PyTorch, Transformers
- LLM fine-tuning and prompt engineering
- MLOps
```

#### Customization Example 2: Workflow Automation Channel

```markdown
# Workflow Automation

## Role
You are an expert who helps with n8n workflows and automation setup.

## Response Rules
- Always provide specific n8n node names and configuration values
- When errors occur, guide through debugging steps in order
- Emphasize the use of environment variables for security-sensitive items (API keys, tokens)

## Available Tools
- Use WebSearch to look up the latest n8n documentation
- Use schedule_task to schedule recurring tasks
```

#### Customization Example 3: Personal Assistant

```markdown
# Personal Assistant

## Role
You are Dante's personal AI assistant. You handle schedule management, reminders, and information lookup.

## Response Style
- Do not use formal speech (use casual tone)
- Keep it concise, focus on key points
- Emojis are OK

## Frequently Used Tasks
- Daily morning 9 AM news summary (schedule_task cron "0 9 * * *")
- Weekly review reminder (schedule_task cron "0 18 * * 5")
```

## Session Memory Detailed Behavior

### Session Lifecycle

| Stage | Description |
|-------|-------------|
| Chat registration | No record in `sessions` table (sessionId = undefined) |
| First message | `resume: undefined` -> new session created -> sessionId saved |
| Subsequent messages | `resume: existingSessionId` -> resumes previous conversation |
| Session expiration | If Claude Code cannot find the session, a new session is automatically created |

### How to Reset a Session

To reset a specific chat's session, delete it directly from the DB:

```bash
# Delete a specific chat's session from SQLite
sqlite3 data/phoneclaw.db "DELETE FROM sessions WHERE chat_folder = 'study-group';"
```

Or reset all sessions:

```bash
sqlite3 data/phoneclaw.db "DELETE FROM sessions;"
```

### Combined Effect of Session + CLAUDE.md

| Feature | Session Resume | CLAUDE.md |
|---------|---------------|-----------|
| Remember previous conversations | O | X |
| Agent personality settings | X | O |
| Specify expertise area | X | O |
| Control response style | X | O |
| Maintain conversation context | O | X |
| Persistence | Session ID-based (may expire) | File-based (permanent) |

### Important Notes

1. **Session size limit**: Claude Code sessions are limited by the context window size. Very long conversations may have older portions truncated.
2. **CLAUDE.md size**: Since it is added to `appendSystemPrompt`, an overly long file reduces the context available for actual conversation. Recommended to keep under 500 characters.
3. **CLAUDE.md path**: The `chats/{folder}/CLAUDE.md` files are managed as relative paths from the project root.

## Verification

```bash
# Type check
npx tsc --noEmit

# Verify DB sessions table
sqlite3 data/phoneclaw.db ".schema sessions"

# List sessions
sqlite3 data/phoneclaw.db "SELECT * FROM sessions;"

# Check CLAUDE.md files in chat folders
ls -la chats/*/CLAUDE.md
```
