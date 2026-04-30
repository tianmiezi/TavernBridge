import crypto from 'node:crypto';
import path from 'node:path';
import { WeixinAccountStore } from './account_store.js';
import { loadWeixinConfig, validateWeixinConfig, type WeixinConfig } from './config.js';
import { getUpdates, sendMessage } from './official/api.js';
import { getContextToken, restoreContextTokens, setContextToken } from './official/context_tokens.js';
import { MessageItemType, MessageState, MessageType, type MessageItem, type WeixinMessage } from './official/types.js';

export interface WeixinInboundText {
  externalScopeId: string;
  text: string;
  messageId: string;
  receivedAt: string;
  raw: WeixinMessage;
}

export class WeixinSendError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly remainingText = '',
  ) {
    super(message);
    this.name = 'WeixinSendError';
  }
}

export class WeixinTextClient {
  constructor({
    stateDir,
    accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') }),
    env = process.env,
  }: {
    stateDir: string;
    accountStore?: WeixinAccountStore;
    env?: NodeJS.ProcessEnv | Record<string, unknown>;
  }) {
    this.accountStore = accountStore;
    this.config = loadWeixinConfig({ stateDir, accountStore, env });
  }

  readonly accountStore: WeixinAccountStore;
  readonly config: WeixinConfig;

  start(): void {
    const errors = validateWeixinConfig(this.config);
    if (errors.length) {
      throw new Error(errors.join('; '));
    }
    restoreContextTokens(this.config.accountsDir, this.config.accountId ?? '');
  }

  loadSyncCursor(): string {
    return this.config.accountId ? this.accountStore.loadSyncCursor(this.config.accountId) : '';
  }

  saveSyncCursor(syncCursor: string): void {
    if (this.config.accountId) {
      this.accountStore.saveSyncCursor(this.config.accountId, syncCursor);
    }
  }

  async pollOnce(syncCursor: string): Promise<{ syncCursor: string; events: WeixinInboundText[] }> {
    const response = await getUpdates({
      baseUrl: this.config.baseUrl,
      token: this.config.token,
      get_updates_buf: syncCursor,
    });
    const nextCursor = String(response.get_updates_buf ?? response.sync_buf ?? syncCursor ?? '');
    const messages = Array.isArray(response.msgs) ? response.msgs : [];
    const events = messages
      .map((message) => this.normalizeMessage(message))
      .filter((event): event is WeixinInboundText => Boolean(event));
    return { syncCursor: nextCursor, events };
  }

  async sendText(externalScopeId: string, text: string): Promise<void> {
    const intervalMs = Math.max(0, Number(process.env.WEIXIN_SEND_INTERVAL_MS ?? 3000));
    const retries = Math.max(0, Number(process.env.WEIXIN_SEND_RETRIES ?? 1));
    const messages = splitLogicalMessages(text);
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const message = messages[messageIndex];
      const chunks = splitForWeixin(message, this.config.deliveryLimitBytes || 2048);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        try {
          await sendTextChunkWithRetry({
            config: this.config,
            externalScopeId,
            text: chunk,
            retries,
            retryDelayMs: intervalMs,
          });
        } catch (error) {
          if (error instanceof WeixinSendError) {
            const remaining = [
              chunks.slice(chunkIndex).join(''),
              ...messages.slice(messageIndex + 1),
            ].filter(Boolean).join('\n');
            throw new WeixinSendError(error.code, error.message, remaining);
          }
          throw error;
        }
        await sleep(intervalMs);
      }
    }
  }

  private normalizeMessage(message: WeixinMessage): WeixinInboundText | null {
    const senderId = stringValue(message.from_user_id);
    if (!senderId || senderId === this.config.accountId) {
      return null;
    }
    if (!this.isAllowedSender(senderId)) {
      return null;
    }
    const text = extractText(Array.isArray(message.item_list) ? message.item_list : []);
    if (!text.trim()) {
      return null;
    }
    const contextToken = stringValue(message.context_token);
    if (contextToken) {
      setContextToken(this.config.accountsDir, this.config.accountId ?? '', senderId, contextToken);
    }
    return {
      externalScopeId: senderId,
      text,
      messageId: stringValue(message.message_id) ?? crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      raw: message,
    };
  }

  private isAllowedSender(senderId: string): boolean {
    if (this.config.dmPolicy === 'disabled' || this.config.dmPolicy === 'pairing') {
      return false;
    }
    if (this.config.dmPolicy === 'allowlist') {
      return this.config.allowFrom.includes(senderId);
    }
    return true;
  }
}

async function sendTextChunkWithRetry({
  config,
  externalScopeId,
  text,
  retries,
  retryDelayMs,
}: {
  config: WeixinConfig;
  externalScopeId: string;
  text: string;
  retries: number;
  retryDelayMs: number;
}): Promise<void> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const contextToken = getContextToken(config.accountsDir, config.accountId ?? '', externalScopeId);
    const result = await sendMessage({
      baseUrl: config.baseUrl,
      token: config.token,
      msg: {
        from_user_id: '',
        to_user_id: externalScopeId,
        client_id: `codexbridge-weixin-${crypto.randomUUID()}`,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [{
          type: MessageItemType.TEXT,
          text_item: { text },
        }],
        ...(contextToken ? { context_token: contextToken } : {}),
      },
    });
    const code = Number((result as { errcode?: number }).errcode ?? result.ret ?? 0);
    if (code === 0) {
      return;
    }
    lastError = `WeChat send failed: ${code} ${result.errmsg ?? ''}`.trim();
    if (attempt < retries) {
      await sleep(retryDelayMs);
    }
  }
  throw new WeixinSendError(Number(lastError.match(/-?\d+/u)?.[0] ?? -1), lastError || 'WeChat send failed');
}

function extractText(itemList: MessageItem[]): string {
  for (const item of itemList) {
    if (Number(item?.type) === MessageItemType.TEXT) {
      return stringValue(item?.text_item?.text) ?? '';
    }
  }
  for (const item of itemList) {
    if (Number(item?.type) === MessageItemType.VOICE) {
      return stringValue(item?.voice_item?.text) ?? '';
    }
  }
  return '';
}

function splitForWeixin(text: string, limitBytes: number): string[] {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return [];
  }
  const chunks: string[] = [];
  let current = '';
  for (const char of normalized) {
    if (Buffer.byteLength(current + char, 'utf8') > limitBytes && current) {
      chunks.push(current);
      current = char;
      continue;
    }
    current += char;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function splitLogicalMessages(text: string): string[] {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return [];
  }
  if (process.env.WEIXIN_SPLIT_LOGICAL_MESSAGES !== '1') {
    return [normalized];
  }
  const lines = normalized.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [normalized];
  }
  const looksLikeShortWechatMessages = lines.every((line) => line.length <= 120 && !line.includes('|'));
  return looksLikeShortWechatMessages ? lines : [normalized];
}

function stringValue(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
