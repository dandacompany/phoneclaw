import { createSdkMcpServer, tool } from '@anthropic-ai/claude-code';
import { z } from 'zod';

export interface McpToolCallbacks {
  sendMessage: (chatId: string, text: string) => Promise<void>;
  scheduleTask?: (data: {
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    chatId: string;
    chatFolder: string;
  }) => Promise<string>;
  listTasks?: (chatFolder: string) => string;
  updateTaskStatus?: (taskId: string, status: 'active' | 'paused') => Promise<void>;
  cancelTask?: (taskId: string) => Promise<void>;
  savePersona?: (chatFolder: string, content: string) => void;
  saveMemory?: (chatFolder: string, entry: string) => void;
  recallMemory?: (chatFolder: string, keyword: string) => string;
  updateLongTermMemory?: (chatFolder: string, content: string) => void;
}

export function createPhoneClawMcpServer(chatId: string, chatFolder: string, callbacks: McpToolCallbacks) {
  return createSdkMcpServer({
    name: 'phoneclaw',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        '실행 중 사용자에게 즉시 메시지를 보냅니다. 진행 상황 업데이트나 여러 메시지를 보낼 때 사용하세요.',
        { text: z.string().describe('보낼 메시지 텍스트') },
        async (args) => {
          await callbacks.sendMessage(chatId, args.text);
          return { content: [{ type: 'text' as const, text: '메시지 전송 완료.' }] };
        },
      ),

      tool(
        'schedule_task',
        `예약 작업을 등록합니다. cron/interval/once 타입 지원.
- cron: "0 9 * * *" (매일 오전 9시)
- interval: "3600000" (1시간마다, 밀리초)
- once: "2026-02-01T15:30:00" (1회, 로컬 시간)`,
        {
          prompt: z.string().describe('작업 실행 시 Agent에게 전달할 프롬프트'),
          schedule_type: z.enum(['cron', 'interval', 'once']),
          schedule_value: z.string().describe('스케줄 값'),
        },
        async (args) => {
          if (!callbacks.scheduleTask) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          const taskId = await callbacks.scheduleTask({
            prompt: args.prompt,
            scheduleType: args.schedule_type,
            scheduleValue: args.schedule_value,
            chatId,
            chatFolder,
          });
          return { content: [{ type: 'text' as const, text: `작업 예약 완료 (ID: ${taskId})` }] };
        },
      ),

      tool(
        'list_tasks',
        '현재 채팅의 예약 작업 목록을 조회합니다.',
        {},
        async () => {
          if (!callbacks.listTasks) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }] };
          }
          const list = callbacks.listTasks(chatFolder);
          return { content: [{ type: 'text' as const, text: list || '예약된 작업이 없습니다.' }] };
        },
      ),

      tool(
        'pause_task',
        '예약 작업을 일시 정지합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'paused');
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 일시정지.` }] };
        },
      ),

      tool(
        'resume_task',
        '일시정지된 작업을 재개합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'active');
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 재개.` }] };
        },
      ),

      tool(
        'cancel_task',
        '예약 작업을 취소하고 삭제합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.cancelTask) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.cancelTask(args.task_id);
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 취소됨.` }] };
        },
      ),

      // === 페르소나 도구 ===

      tool(
        'save_persona',
        '봇의 페르소나(성격, 이름, 이모지 등)와 사용자 컨텍스트를 PERSONA.md에 저장합니다. 상견례(bootstrap) 대화 후 호출하세요.',
        { content: z.string().describe('PERSONA.md에 저장할 마크다운 내용') },
        async (args) => {
          if (!callbacks.savePersona) {
            return { content: [{ type: 'text' as const, text: '페르소나 시스템이 활성화되지 않았습니다.' }], isError: true };
          }
          callbacks.savePersona(chatFolder, args.content);
          return { content: [{ type: 'text' as const, text: '페르소나가 저장되었습니다.' }] };
        },
      ),

      // === 메모리 도구 ===

      tool(
        'save_memory',
        '대화 중 중요한 사실이나 사용자 요청을 오늘의 일일 메모리에 기록합니다.',
        { entry: z.string().describe('기억할 내용') },
        async (args) => {
          if (!callbacks.saveMemory) {
            return { content: [{ type: 'text' as const, text: '메모리 시스템이 활성화되지 않았습니다.' }], isError: true };
          }
          callbacks.saveMemory(chatFolder, args.entry);
          return { content: [{ type: 'text' as const, text: '메모리에 기록되었습니다.' }] };
        },
      ),

      tool(
        'recall_memory',
        '키워드로 과거 대화 기억을 검색합니다. 최근 30일 일지와 장기 기억에서 찾습니다.',
        { keyword: z.string().describe('검색 키워드') },
        async (args) => {
          if (!callbacks.recallMemory) {
            return { content: [{ type: 'text' as const, text: '메모리 시스템이 활성화되지 않았습니다.' }], isError: true };
          }
          const result = callbacks.recallMemory(chatFolder, args.keyword);
          return { content: [{ type: 'text' as const, text: result }] };
        },
      ),

      tool(
        'update_long_term_memory',
        '장기 기억(MEMORY.md)을 업데이트합니다. 자주 반복되는 중요한 사실을 큐레이션하세요.',
        { content: z.string().describe('MEMORY.md에 저장할 전체 마크다운 내용') },
        async (args) => {
          if (!callbacks.updateLongTermMemory) {
            return { content: [{ type: 'text' as const, text: '메모리 시스템이 활성화되지 않았습니다.' }], isError: true };
          }
          callbacks.updateLongTermMemory(chatFolder, args.content);
          return { content: [{ type: 'text' as const, text: '장기 기억이 업데이트되었습니다.' }] };
        },
      ),
    ],
  });
}
