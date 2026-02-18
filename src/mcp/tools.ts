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
    ],
  });
}
