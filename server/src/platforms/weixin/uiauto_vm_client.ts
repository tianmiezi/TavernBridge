import crypto from 'node:crypto';
import type { TavernUiautoAccountConfig } from '../../relay/config.js';
import type { UiautoAccountState } from '../../relay/state_store.js';
import type {
  UiautoClient,
  UiautoInboundMessage,
  UiautoPollResult,
  UiautoRuntimeCheck,
} from './uiauto_client.js';

const MAX_RECENT_SIGNATURES = 100;
const DEFAULT_WORKER_BASE_URL = 'http://127.0.0.1:8795';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

interface WorkerHealth {
  ok?: boolean;
  state?: string;
  error?: string;
  backend?: string;
  version?: string;
  details?: unknown;
  wechat?: unknown;
  native?: unknown;
  last_error?: string;
  last_contact?: string;
}

interface WorkerMessage {
  text?: unknown;
  sender?: unknown;
  type?: unknown;
  time?: unknown;
  signature?: unknown;
  message_id?: unknown;
  received_at?: unknown;
}

interface WorkerPollResponse {
  ok?: boolean;
  messages?: WorkerMessage[];
  scanned_at?: string;
  error?: string;
  state?: string;
}

export class UiautoVmClient implements UiautoClient {
  constructor(readonly account: TavernUiautoAccountConfig) {}

  async checkDevice(): Promise<UiautoRuntimeCheck> {
    try {
      const health = await this.request<WorkerHealth>('/health?deep=1', { method: 'GET' });
      return {
        ok: health.ok === true,
        state: String(health.state || (health.ok ? 'ready' : 'unavailable')),
        error: String(health.error || health.last_error || '').trim() || undefined,
        details: {
          backend: health.backend,
          version: health.version,
          worker_base_url: this.workerBaseUrl(),
          last_contact: health.last_contact,
          wechat: health.wechat,
          native: health.native,
          details: health.details,
        },
      };
    } catch (error) {
      return {
        ok: false,
        state: 'worker-offline',
        error: error instanceof Error ? error.message : String(error),
        details: { worker_base_url: this.workerBaseUrl() },
      };
    }
  }

  async pollOnce(previousState: UiautoAccountState | undefined): Promise<UiautoPollResult> {
    const state = normalizeAccountState(previousState);
    const now = new Date().toISOString();
    const ownerContactName = this.ownerContactName();
    if (!ownerContactName) {
      state.deviceOnline = false;
      state.lastError = 'owner_contact_name is required for uiauto_vm. Configure the real main-account remark, not a test chat.';
      state.lastScanAt = now;
      return { messages: [], state };
    }
    if (state.ownerContactName && state.ownerContactName !== ownerContactName) {
      state.recentSignatures = [];
      state.lastMessageSignature = undefined;
      state.lastScanAt = undefined;
    }
    state.ownerContactName = ownerContactName;
    try {
      const payload = await this.request<WorkerPollResponse>('/poll', {
        method: 'POST',
        body: JSON.stringify({
          account_id: this.account.id,
          owner_contact_name: ownerContactName,
          recent_signatures: state.recentSignatures,
          bot_id: this.account.bot_id,
          target_character: this.account.target_character,
          conversation_id: this.account.conversation_id,
          language: this.account.language,
        }),
      });
      if (payload.ok === false) {
        state.deviceOnline = false;
        state.lastError = String(payload.error || payload.state || 'UIAuto worker poll failed');
        state.lastScanAt = now;
        return { messages: [], state };
      }

      const messages = normalizeWorkerMessages(this.account, payload.messages ?? [], state.recentSignatures);
      const signatures = messages.map((message) => message.signature);
      state.recentSignatures = [...signatures, ...state.recentSignatures]
        .filter(Boolean)
        .filter((signature, index, list) => list.indexOf(signature) === index)
        .slice(0, MAX_RECENT_SIGNATURES);
      state.lastMessageSignature = signatures[0] || state.lastMessageSignature;
      state.deviceOnline = true;
      state.lastError = '';
      state.lastScanAt = payload.scanned_at || now;
      return { messages, state };
    } catch (error) {
      state.deviceOnline = false;
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastScanAt = now;
      return { messages: [], state };
    }
  }

  async sendText(text: string): Promise<void> {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return;
    }
    const ownerContactName = this.ownerContactName();
    if (!ownerContactName) {
      throw new Error('owner_contact_name is required for uiauto_vm. Configure the real main-account remark, not a test chat.');
    }
    const payload = await this.request<{ ok?: boolean; error?: string }>('/send-text', {
      method: 'POST',
      body: JSON.stringify({
        account_id: this.account.id,
        owner_contact_name: ownerContactName,
        bot_id: this.account.bot_id,
        target_character: this.account.target_character,
        conversation_id: this.account.conversation_id,
        language: this.account.language,
        text: normalized,
      }),
    });
    if (payload.ok === false) {
      throw new Error(payload.error || 'UIAuto worker send-text failed');
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.workerBaseUrl()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
          ...(init.headers ?? {}),
        },
      });
      const payload = await response.json().catch(() => ({})) as T & { error?: string };
      if (!response.ok) {
        throw new Error(String(payload.error || response.statusText || `HTTP ${response.status}`));
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`UIAuto worker request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms: ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private workerBaseUrl(): string {
    const value = String(this.account.worker_base_url || DEFAULT_WORKER_BASE_URL).replace(/\/+$/u, '');
    try {
      const url = new URL(value);
      if (url.hostname === '0.0.0.0') {
        throw new Error('0.0.0.0 is only a VM listen address. Use the VM IP shown by start-uiauto-worker, for example http://172.x.x.x:8795.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('0.0.0.0')) {
        throw error;
      }
    }
    return value;
  }

  private ownerContactName(): string {
    return String(this.account.owner_contact_name || '').trim();
  }
}

function normalizeWorkerMessages(
  account: TavernUiautoAccountConfig,
  rawMessages: WorkerMessage[],
  recentSignatures: string[],
): UiautoInboundMessage[] {
  const seen = new Set(recentSignatures);
  const messages: UiautoInboundMessage[] = [];
  for (const raw of rawMessages) {
    const text = String(raw.text || '').trim();
    if (!text) {
      continue;
    }
    const signature = String(raw.signature || signatureFor(account, text, String(raw.time || raw.sender || '')));
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    messages.push({
      accountId: account.id,
      externalScopeId: account.owner_contact_name,
      text,
      messageId: String(raw.message_id || `uiauto_${signature.slice(0, 16)}`),
      receivedAt: String(raw.received_at || new Date().toISOString()),
      signature,
      attachments: [],
    });
  }
  return messages.slice(-5);
}

function signatureFor(account: TavernUiautoAccountConfig, text: string, hint: string): string {
  return crypto
    .createHash('sha256')
    .update(`${account.id}:${account.owner_contact_name}:${text}:${hint}`)
    .digest('hex');
}

function normalizeAccountState(state: UiautoAccountState | undefined): UiautoAccountState {
  return {
    recentSignatures: Array.isArray(state?.recentSignatures) ? state.recentSignatures.slice(0, MAX_RECENT_SIGNATURES) : [],
    lastScanAt: state?.lastScanAt,
    lastError: state?.lastError,
    deviceOnline: state?.deviceOnline === true,
    lastScreenshotPath: state?.lastScreenshotPath,
    lastDumpPath: state?.lastDumpPath,
    lastMessageSignature: state?.lastMessageSignature,
    ownerContactName: state?.ownerContactName,
  };
}
