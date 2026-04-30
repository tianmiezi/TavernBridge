import fs from 'node:fs';
import path from 'node:path';

export interface TavernTaskConfig {
  id: string;
  bot_id?: string;
  enabled?: boolean;
  schedule_mode?: 'fixed' | 'daily_random';
  time: string;
  random_window_start?: string;
  random_window_end?: string;
  days?: number[];
  created_at?: string;
  timezone?: string;
  type?: string;
  intent?: string;
  task: string;
  suggested_first_step?: string;
  tone?: string[];
  max_length_chars?: number;
  forbidden?: string[];
  delivery_channel?: 'wechat' | 'tavern';
  wechat_scope_id?: string;
  target_character?: string;
  conversation_id?: string;
  language?: string;
  followups?: TavernFollowupConfig[];
}

export interface TavernFollowupConfig {
  enabled?: boolean;
  delay_minutes: number;
  task: string;
  suggested_first_step?: string;
  intent?: string;
}

export interface TavernRelayConfig {
  config_path?: string;
  connector_dir: string;
  response_timeout_ms: number;
  poll_interval_ms: number;
  wechat_poll_interval_ms: number;
  delivery: {
    message_mode: 'split' | 'single';
    send_interval_ms: number;
  };
  default_target: {
    target_character: string;
    conversation_id: string;
    language: string;
  };
  wechat: {
    default_scope_id: string;
    inbound_merge_window_ms: number;
  };
  bots: TavernBotConfig[];
  tasks: TavernTaskConfig[];
}

export interface TavernBotConfig {
  id: string;
  enabled?: boolean;
  name?: string;
  wechat_account_id?: string;
  wechat_token?: string;
  wechat_base_url?: string;
  wechat_scope_id?: string;
  target_character?: string;
  conversation_id?: string;
  language?: string;
}

export function loadTavernRelayConfig({
  stateDir,
  configPath = process.env.TAVERN_RELAY_CONFIG,
}: {
  stateDir: string;
  configPath?: string | null;
}): TavernRelayConfig {
  const defaultConfig = defaultTavernRelayConfig(stateDir);
  const resolvedPath = resolveTavernRelayConfigPath(configPath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      ...defaultConfig,
      config_path: resolvedPath,
    };
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/u, '')) as Partial<TavernRelayConfig>;
  return {
    ...defaultConfig,
    ...raw,
    config_path: resolvedPath,
    connector_dir: path.resolve(String(raw.connector_dir ?? defaultConfig.connector_dir)),
    default_target: {
      ...defaultConfig.default_target,
      ...(raw.default_target ?? {}),
    },
    delivery: normalizeDelivery(raw.delivery, defaultConfig.delivery),
    wechat: {
      ...defaultConfig.wechat,
      ...(raw.wechat ?? {}),
      inbound_merge_window_ms: normalizeNonNegativeInteger(
        raw.wechat?.inbound_merge_window_ms,
        defaultConfig.wechat.inbound_merge_window_ms,
      ),
    },
    bots: normalizeBots(raw.bots, defaultConfig),
    tasks: Array.isArray(raw.tasks) ? raw.tasks : defaultConfig.tasks,
  };
}

export function saveTavernRelayConfig(config: TavernRelayConfig): void {
  const filePath = resolveTavernRelayConfigPath(config.config_path ?? process.env.TAVERN_RELAY_CONFIG);
  const serializable = {
    connector_dir: config.connector_dir,
    response_timeout_ms: config.response_timeout_ms,
    poll_interval_ms: config.poll_interval_ms,
    wechat_poll_interval_ms: config.wechat_poll_interval_ms,
    delivery: config.delivery,
    default_target: config.default_target,
    wechat: config.wechat,
    bots: config.bots,
    tasks: config.tasks,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
  config.config_path = filePath;
}

function resolveTavernRelayConfigPath(configPath?: string | null): string {
  return path.resolve(configPath || path.join(process.cwd(), 'config', 'tavern-relay.config.json'));
}

export function defaultTavernRelayConfig(stateDir: string): TavernRelayConfig {
  return {
    connector_dir: path.join(stateDir, 'tavern-connector'),
    response_timeout_ms: 120_000,
    poll_interval_ms: 1_000,
    wechat_poll_interval_ms: 2_000,
    delivery: {
      message_mode: process.env.WEIXIN_SPLIT_LOGICAL_MESSAGES === '0' ? 'single' : 'split',
      send_interval_ms: Number.parseInt(String(process.env.WEIXIN_SEND_INTERVAL_MS ?? '6000'), 10) || 6000,
    },
    default_target: {
      target_character: 'girlfriend_study_partner',
      conversation_id: 'daily_study_checkin',
      language: 'zh-CN',
    },
    wechat: {
      default_scope_id: process.env.WEIXIN_DEFAULT_SCOPE_ID ?? '',
      inbound_merge_window_ms: Number.parseInt(String(process.env.WEIXIN_INBOUND_MERGE_WINDOW_MS ?? '10000'), 10) || 10_000,
    },
    bots: [],
    tasks: [],
  };
}

function normalizeBots(raw: unknown, fallback: TavernRelayConfig): TavernBotConfig[] {
  if (!Array.isArray(raw)) {
    return fallback.bots;
  }
  return raw
    .map((item, index) => {
      const bot = item && typeof item === 'object' ? item as Partial<TavernBotConfig> : {};
      const id = String(bot.id || '').trim() || `bot_${index + 1}`;
      return {
        id,
        enabled: bot.enabled !== false,
        name: String(bot.name || id).trim(),
        wechat_account_id: String(bot.wechat_account_id || '').trim(),
        wechat_token: String(bot.wechat_token || '').trim(),
        wechat_base_url: String(bot.wechat_base_url || '').trim(),
        wechat_scope_id: String(bot.wechat_scope_id || '').trim(),
        target_character: String(bot.target_character || '').trim(),
        conversation_id: String(bot.conversation_id || '').trim(),
        language: String(bot.language || '').trim(),
      };
    })
    .filter((bot) => bot.id);
}

function normalizeDelivery(
  raw: Partial<TavernRelayConfig['delivery']> | undefined,
  fallback: TavernRelayConfig['delivery'],
): TavernRelayConfig['delivery'] {
  const mode = raw?.message_mode === 'single' ? 'single' : raw?.message_mode === 'split' ? 'split' : fallback.message_mode;
  const interval = Number.parseInt(String(raw?.send_interval_ms ?? fallback.send_interval_ms), 10);
  return {
    message_mode: mode,
    send_interval_ms: Number.isFinite(interval) && interval >= 0 ? interval : fallback.send_interval_ms,
  };
}

function normalizeNonNegativeInteger(rawValue: unknown, fallback: number): number {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
