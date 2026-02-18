---
name: phoneclaw-session-memory
description: "PhoneClaw EP07 - 대화 기억(세션 메모리). Claude Code SDK의 session resume 기능과 채팅별 CLAUDE.md를 활용하여 Agent가 이전 대화 맥락을 기억하고, 채팅별로 다른 성격/지시사항을 적용할 수 있도록 구성합니다."
---

# EP07: PhoneClaw Session Memory

Agent가 이전 대화를 기억하고, 채팅별로 다른 성격과 지시사항을 적용할 수 있는 **세션 메모리** 시스템을 구성합니다.

## 개요

PhoneClaw의 세션 메모리는 두 가지 축으로 구성됩니다:

1. **Session Resume** - Claude Code SDK의 `resume` 옵션을 통해 이전 대화 컨텍스트를 이어받습니다.
2. **채팅별 CLAUDE.md** - 각 채팅 폴더에 `CLAUDE.md`를 작성하여 Agent의 성격, 전문 분야, 응답 스타일을 커스터마이징합니다.

### 세션 흐름

```
1. 새 메시지 수신
2. DB에서 기존 sessionId 조회 (sessions 테이블)
3. Claude Code query() 실행 시 resume: sessionId 전달
4. Agent가 이전 대화 맥락을 포함하여 응답
5. 새 sessionId를 DB에 저장
```

### 데이터 구조

```
data/
  phoneclaw.db          # sessions 테이블: chat_folder -> session_id

chats/
  study-group/
    CLAUDE.md           # 이 채팅의 Agent 커스터마이징
    logs/               # 로그 디렉토리
  personal/
    CLAUDE.md           # 다른 성격의 Agent 설정
    logs/
```

## 의존성

- **EP01~EP06 완료 필수**: 특히 `db.ts`의 `getSession()`, `setSession()` 함수와 `local-runner.ts`의 세션 연동 로직이 필요합니다.

## 단계별 지시

### Step 1: DB 세션 저장소 확인

`src/db.ts`에 이미 다음 함수들이 구현되어 있어야 합니다:

```typescript
// src/db.ts (기존 코드 - 확인용)

// 세션 테이블 스키마 (createSchema 내부)
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

### Step 2: Local Runner 세션 Resume 로직 확인

`src/agent/local-runner.ts`에서 세션이 어떻게 resume되는지 확인합니다. 핵심 코드:

```typescript
// src/agent/local-runner.ts (기존 코드 - 확인용)

// 1. 기존 세션 조회
const existingSessionId = input.sessionId || getSession(chat.folder);

// 2. query() 실행 시 resume 옵션으로 전달
for await (const message of query({
  prompt: input.prompt,
  options: {
    cwd: chatDir,
    resume: existingSessionId,   // <-- 핵심: 이전 세션 이어받기
    appendSystemPrompt: systemAppend,
    // ...
  },
})) {
  // 3. 초기화 메시지에서 새 sessionId 획득
  if (message.type === 'system' && message.subtype === 'init') {
    sessionId = message.session_id;
  }
  // ...
}

// 4. 새 sessionId 저장
if (sessionId) {
  setSession(chat.folder, sessionId);
}
```

### Step 3: 채팅별 CLAUDE.md 시스템

채팅 등록 시 `chats/{folder}/CLAUDE.md`가 자동 생성됩니다 (EP05 `registerChat()` 참고).
이 파일의 내용이 Agent의 `appendSystemPrompt`에 추가됩니다.

```typescript
// src/agent/local-runner.ts 내부 (기존 코드 - 확인용)
let systemAppend = `당신의 이름은 ${BOT_NAME}입니다. Telegram 메시지에 한국어로 응답하세요. 간결하고 자연스럽게 대화하세요.`;
if (fs.existsSync(claudeMdPath)) {
  systemAppend += '\n\n' + fs.readFileSync(claudeMdPath, 'utf-8');
}
```

### Step 4: CLAUDE.md 커스터마이징 가이드

각 채팅 폴더의 `CLAUDE.md`를 편집하여 Agent 동작을 채팅별로 다르게 설정할 수 있습니다.

#### 기본 템플릿

채팅 등록 시 자동 생성되는 기본 내용:

```markdown
# {채팅 이름}

이 채팅의 AI 비서 설정입니다.
```

#### 커스터마이징 예시 1: 스터디 그룹

```markdown
# 스터디 그룹

## 역할
당신은 AI/ML 학습을 돕는 멘토입니다. 그룹원들의 질문에 친절하고 상세하게 답변하세요.

## 응답 규칙
- 코드 예제를 포함할 때는 반드시 설명을 추가하세요
- 어려운 개념은 비유를 들어 설명하세요
- 관련 학습 리소스(문서, 논문)를 추천하세요
- 그룹원 간 토론을 유도하는 질문을 덧붙이세요

## 전문 분야
- Python, PyTorch, Transformers
- LLM 파인튜닝 및 프롬프트 엔지니어링
- MLOps
```

#### 커스터마이징 예시 2: 업무 자동화 채널

```markdown
# 업무 자동화

## 역할
n8n 워크플로우와 자동화 설정을 도와주는 전문가입니다.

## 응답 규칙
- 항상 n8n 노드 이름과 설정값을 구체적으로 안내하세요
- 에러 발생 시 디버깅 순서를 단계별로 안내하세요
- 보안 관련 사항(API 키, 토큰)은 환경변수 사용을 강조하세요

## 사용 가능 도구
- WebSearch로 최신 n8n 문서를 검색할 수 있습니다
- schedule_task로 정기 작업을 예약할 수 있습니다
```

#### 커스터마이징 예시 3: 개인 비서

```markdown
# 개인 비서

## 역할
단테의 개인 AI 비서입니다. 일정 관리, 리마인더, 정보 검색을 담당합니다.

## 응답 스타일
- 존댓말 사용하지 않기 (반말)
- 간결하게, 핵심만
- 이모지 사용 OK

## 자주 사용하는 작업
- 매일 아침 9시 뉴스 요약 (schedule_task cron "0 9 * * *")
- 주간 리뷰 리마인더 (schedule_task cron "0 18 * * 5")
```

## 세션 메모리 동작 상세

### 세션 라이프사이클

| 단계 | 설명 |
|------|------|
| 채팅 등록 | `sessions` 테이블에 레코드 없음 (sessionId = undefined) |
| 첫 메시지 | `resume: undefined` -> 새 세션 생성 -> sessionId 저장 |
| 이후 메시지 | `resume: existingSessionId` -> 이전 대화 이어받기 |
| 세션 만료 | Claude Code가 세션을 찾지 못하면 새 세션 자동 생성 |

### 세션 초기화 방법

특정 채팅의 세션을 초기화하려면 DB에서 직접 삭제합니다:

```bash
# SQLite에서 특정 채팅의 세션 삭제
sqlite3 data/phoneclaw.db "DELETE FROM sessions WHERE chat_folder = 'study-group';"
```

또는 전체 세션 초기화:

```bash
sqlite3 data/phoneclaw.db "DELETE FROM sessions;"
```

### 세션 + CLAUDE.md 조합 효과

| 기능 | Session Resume | CLAUDE.md |
|------|---------------|-----------|
| 이전 대화 기억 | O | X |
| Agent 성격 설정 | X | O |
| 전문 분야 지정 | X | O |
| 응답 스타일 제어 | X | O |
| 대화 맥락 유지 | O | X |
| 영구성 | 세션 ID 기반 (만료 가능) | 파일 기반 (영구) |

### 주의사항

1. **세션 크기 제한**: Claude Code의 세션은 컨텍스트 윈도우 크기에 제한됩니다. 매우 긴 대화는 오래된 부분이 잘릴 수 있습니다.
2. **CLAUDE.md 크기**: `appendSystemPrompt`에 추가되므로 너무 길면 실제 대화에 할당되는 컨텍스트가 줄어듭니다. 500자 이내를 권장합니다.
3. **CLAUDE.md 경로**: `chats/{folder}/CLAUDE.md` 파일은 프로젝트 루트 기준 상대 경로로 관리됩니다.

## 검증

```bash
# 타입 체크
npx tsc --noEmit

# DB 세션 테이블 확인
sqlite3 data/phoneclaw.db ".schema sessions"

# 세션 목록 조회
sqlite3 data/phoneclaw.db "SELECT * FROM sessions;"

# 채팅 폴더의 CLAUDE.md 확인
ls -la chats/*/CLAUDE.md
```
