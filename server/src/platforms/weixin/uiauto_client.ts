import type { TavernUiautoAccountConfig } from '../../relay/config.js';
import type { RelayAttachment } from '../../relay/protocol.js';
import type { UiautoAccountState } from '../../relay/state_store.js';

export interface UiautoInboundMessage {
  accountId: string;
  externalScopeId: string;
  text: string;
  messageId: string;
  receivedAt: string;
  signature: string;
  attachments: RelayAttachment[];
}

export interface UiautoPollResult {
  messages: UiautoInboundMessage[];
  state: UiautoAccountState;
}

export interface UiautoRuntimeCheck {
  ok: boolean;
  state: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface UiautoClient {
  readonly account: TavernUiautoAccountConfig;
  checkDevice(): Promise<UiautoRuntimeCheck>;
  pollOnce(previousState: UiautoAccountState | undefined): Promise<UiautoPollResult>;
  sendText(text: string): Promise<void>;
}
