import fs from 'node:fs';
import path from 'node:path';

export interface RelayState {
  emittedTasks: Record<string, string>;
  pendingFollowups: Record<string, PendingFollowup>;
  randomTaskTimes: Record<string, string>;
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
      return { emittedTasks: {}, pendingFollowups: {}, randomTaskTimes: {} };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<RelayState>;
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
      };
    } catch {
      return { emittedTasks: {}, pendingFollowups: {}, randomTaskTimes: {} };
    }
  }

  write(state: RelayState): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}
