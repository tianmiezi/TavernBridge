import fs from 'node:fs';
import path from 'node:path';

export interface RelayState {
  emittedTasks: Record<string, string>;
  pendingFollowups: Record<string, PendingFollowup>;
  randomTaskTimes: Record<string, string>;
  uiauto: Record<string, UiautoAccountState>;
}

export interface UiautoAccountState {
  recentSignatures: string[];
  lastScanAt?: string;
  lastError?: string;
  deviceOnline?: boolean;
  lastScreenshotPath?: string;
  lastDumpPath?: string;
  lastMessageSignature?: string;
  ownerContactName?: string;
}

export interface PendingFollowup {
  id: string;
  bot_id?: string;
  task_id: string;
  task_date_key: string;
  source_event_id: string;
  step_index: number;
  due_at: string;
  target: string;
}

export class RelayStateStore {
  constructor(readonly filePath: string) {}

  read(): RelayState {
    if (!fs.existsSync(this.filePath)) {
      return defaultRelayState();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<RelayState> & { altWechat?: unknown };
      return {
        emittedTasks: parsed.emittedTasks && typeof parsed.emittedTasks === 'object'
          ? parsed.emittedTasks
          : {},
        pendingFollowups: parsed.pendingFollowups && typeof parsed.pendingFollowups === 'object'
          ? parsed.pendingFollowups as Record<string, PendingFollowup>
          : {},
        randomTaskTimes: parsed.randomTaskTimes && typeof parsed.randomTaskTimes === 'object'
          ? parsed.randomTaskTimes as Record<string, string>
          : {},
        uiauto: normalizeUiautoState(parsed.uiauto ?? parsed.altWechat),
      };
    } catch {
      return defaultRelayState();
    }
  }

  write(state: RelayState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}

function defaultRelayState(): RelayState {
  return { emittedTasks: {}, pendingFollowups: {}, randomTaskTimes: {}, uiauto: {} };
}

function normalizeUiautoState(raw: unknown): Record<string, UiautoAccountState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, UiautoAccountState> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const item = value && typeof value === 'object' ? value as Partial<UiautoAccountState> : {};
    result[id] = {
      recentSignatures: Array.isArray(item.recentSignatures)
        ? item.recentSignatures.map((signature) => String(signature)).filter(Boolean).slice(0, 100)
        : [],
      lastScanAt: item.lastScanAt ? String(item.lastScanAt) : undefined,
      lastError: item.lastError ? String(item.lastError) : undefined,
      deviceOnline: item.deviceOnline === true,
      lastScreenshotPath: item.lastScreenshotPath ? String(item.lastScreenshotPath) : undefined,
      lastDumpPath: item.lastDumpPath ? String(item.lastDumpPath) : undefined,
      lastMessageSignature: item.lastMessageSignature ? String(item.lastMessageSignature) : undefined,
      ownerContactName: item.ownerContactName ? String(item.ownerContactName) : undefined,
    };
  }
  return result;
}
