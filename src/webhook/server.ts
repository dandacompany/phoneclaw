import http from 'http';

import { logger } from '../logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { WebhookRequest, WebhookResponse, WebhookServerOpts } from './types.js';

const MAX_BODY_SIZE = 256 * 1024; // 256KB

export class WebhookServer {
  private server: http.Server | null = null;
  private opts: WebhookServerOpts;
  private rateLimiter = new RateLimiter(30, 60000); // 분당 30회

  constructor(opts: WebhookServerOpts) {
    this.opts = opts;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.opts.port, () => {
        logger.info({ port: this.opts.port }, '웹훅 서버 시작');
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('웹훅 서버 중지');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Bearer 토큰 인증
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${this.opts.token}`) {
      this.sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }

    // 레이트 리미팅
    const clientIp = req.socket.remoteAddress || 'unknown';
    if (!this.rateLimiter.check(clientIp)) {
      this.sendJson(res, 429, { ok: false, error: 'Too many requests' });
      return;
    }

    // POST 메소드만 허용
    if (req.method !== 'POST') {
      this.sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }

    // 요청 본문 파싱
    let body: WebhookRequest;
    try {
      body = await this.readBody(req);
    } catch (err) {
      this.sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : 'Bad request' });
      return;
    }

    if (!body.chatId) {
      this.sendJson(res, 400, { ok: false, error: 'chatId is required' });
      return;
    }

    // 라우팅
    const url = req.url || '';
    try {
      if (url === '/hooks/wake') {
        await this.opts.onWake(body.chatId);
        this.sendJson(res, 200, { ok: true, message: 'Heartbeat triggered' });
      } else if (url === '/hooks/message') {
        if (!body.message) {
          this.sendJson(res, 400, { ok: false, error: 'message is required' });
          return;
        }
        await this.opts.onMessage(body.chatId, body.message);
        this.sendJson(res, 200, { ok: true, message: 'Message delivered' });
      } else {
        this.sendJson(res, 404, { ok: false, error: 'Not found' });
      }
    } catch (err) {
      logger.error({ url, err }, '웹훅 처리 오류');
      this.sendJson(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  private readBody(req: http.IncomingMessage): Promise<WebhookRequest> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(raw) as WebhookRequest);
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });

      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: WebhookResponse): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}
