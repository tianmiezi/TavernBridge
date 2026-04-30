import fs from 'node:fs/promises';
import path from 'node:path';
import type { RelayEvent } from './protocol.js';

export interface TavernReply {
  filePath: string;
  eventId: string;
  botId: string;
  body: string;
  status: string;
  error: string;
  wechatScopeId: string;
}

export class TavernFileConnector {
  constructor(
    readonly connectorDir: string,
    readonly pollIntervalMs = 1_000,
  ) {}

  get inboxDir(): string {
    return path.join(this.connectorDir, 'inbox');
  }

  get outboxDir(): string {
    return path.join(this.connectorDir, 'outbox');
  }

  get sentDir(): string {
    return path.join(this.outboxDir, 'sent');
  }

  get failedDir(): string {
    return path.join(this.outboxDir, 'failed');
  }

  get deferredDir(): string {
    return path.join(this.outboxDir, 'deferred');
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.inboxDir, { recursive: true });
    await fs.mkdir(this.outboxDir, { recursive: true });
    await fs.mkdir(this.sentDir, { recursive: true });
    await fs.mkdir(this.failedDir, { recursive: true });
    await fs.mkdir(this.deferredDir, { recursive: true });
  }

  async writeEvent(event: RelayEvent): Promise<string> {
    await this.ensureReady();
    const filePath = path.join(this.inboxDir, `${event.event_id}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(event, null, 2)}\n`, 'utf8');
    return filePath;
  }

  async waitForReply(eventId: string, timeoutMs: number): Promise<TavernReply | null> {
    const deadline = Date.now() + timeoutMs;
    const candidates = [
      path.join(this.outboxDir, `${eventId}.txt`),
      path.join(this.outboxDir, `${eventId}.json`),
    ];

    while (Date.now() <= deadline) {
      for (const candidate of candidates) {
        const reply = await readResponse(candidate);
        if (reply?.body) {
          return reply;
        }
      }
      await sleep(this.pollIntervalMs);
    }
    return null;
  }

  async waitForResponse(eventId: string, timeoutMs: number): Promise<string | null> {
    const reply = await this.waitForReply(eventId, timeoutMs);
    return reply?.body ?? null;
  }

  async listReadyReplies(): Promise<TavernReply[]> {
    return this.listRepliesFromDir(this.outboxDir);
  }

  async listDeferredReplies(): Promise<TavernReply[]> {
    return this.listRepliesFromDir(this.deferredDir);
  }

  private async listRepliesFromDir(dir: string): Promise<TavernReply[]> {
    await this.ensureReady();
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const replies: TavernReply[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || (!entry.name.endsWith('.json') && !entry.name.endsWith('.txt'))) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      try {
        const reply = await readResponse(filePath);
        if (reply) {
          replies.push(reply);
        }
      } catch {
        await moveReply(filePath, this.failedDir);
      }
    }
    return replies;
  }

  async markReplySent(reply: TavernReply): Promise<void> {
    await moveReply(reply.filePath, this.sentDir);
  }

  async markReplyFailed(reply: TavernReply): Promise<void> {
    await moveReply(reply.filePath, this.failedDir);
  }

  async markReplyDeferred(reply: TavernReply): Promise<void> {
    await moveReply(reply.filePath, this.deferredDir);
  }

  async markReplyDeferredWithBody(reply: TavernReply, body: string): Promise<void> {
    await rewriteReplyBody(reply, body);
    await moveReply(reply.filePath, this.deferredDir);
  }
}

async function rewriteReplyBody(reply: TavernReply, body: string): Promise<void> {
  if (reply.filePath.endsWith('.json')) {
    const raw = await fs.readFile(reply.filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.text = body;
    if ('body' in parsed) {
      parsed.body = body;
    }
    await fs.writeFile(reply.filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return;
  }
  await fs.writeFile(reply.filePath, `${body.trim()}\n`, 'utf8');
}

async function readResponse(filePath: string): Promise<TavernReply | null> {
  try {
    const raw = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/u, '');
    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const body = normalizeDeliveryText(parsed.body ?? parsed.text ?? parsed.message ?? parsed.content);
      const eventId = normalizeText(parsed.event_id) ?? path.basename(filePath, path.extname(filePath));
      const rawEvent = typeof parsed.raw_event === 'object' && parsed.raw_event ? parsed.raw_event as Record<string, unknown> : {};
      return {
        filePath,
        eventId,
        botId: normalizeText(parsed.bot_id ?? rawEvent.bot_id) ?? '',
        body: body ?? '',
        status: normalizeText(parsed.status) ?? '',
        error: normalizeText(parsed.error) ?? '',
        wechatScopeId: normalizeText(parsed.wechat_scope_id ?? rawEvent.wechat_scope_id) ?? '',
      };
    }
    const body = normalizeDeliveryText(raw);
    return {
      filePath,
      eventId: path.basename(filePath, path.extname(filePath)),
      botId: '',
      body: body ?? '',
      status: 'ok',
      error: '',
      wechatScopeId: '',
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeDeliveryText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const ctbText = extractTaggedBodies(text, 'ctb');
  if (ctbText) {
    return ctbText;
  }

  const messageText = extractWechatMessages(text);
  if (messageText) {
    return messageText;
  }

  return text;
}

function extractTaggedBodies(text: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'giu');
  const bodies: string[] = [];
  for (const match of text.matchAll(regex)) {
    const body = normalizeText(match[1]);
    if (body) {
      bodies.push(body);
    }
  }
  return bodies.length ? bodies.join('\n') : null;
}

function extractWechatMessages(text: string): string | null {
  const contentBlocks = extractTaggedBlockList(text, 'content');
  const contentMessages = contentBlocks
    .flatMap((block) => extractTaggedBlockList(block, 'message'))
    .map((value) => value.trim())
    .filter(Boolean);
  if (contentMessages.length) {
    return contentMessages.join('\n');
  }

  const withoutThinking = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/giu, '')
    .replace(/<think>[\s\S]*?<\/think>/giu, '');
  const messages = extractTaggedBlockList(withoutThinking, 'message')
    .map((value) => value.trim())
    .filter(Boolean);
  return messages.length ? messages.join('\n') : null;
}

function extractTaggedBlockList(text: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'giu');
  return Array.from(text.matchAll(regex), (match) => String(match[1] ?? ''));
}

async function moveReply(filePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const parsed = path.parse(filePath);
  const target = path.join(targetDir, `${parsed.name}.${Date.now()}${parsed.ext}`);
  await fs.rename(filePath, target).catch(async () => {
    await fs.copyFile(filePath, target);
    await fs.unlink(filePath);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
