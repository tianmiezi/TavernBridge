import fs from 'node:fs';
import path from 'node:path';

export type WechatTransport = 'auto' | 'openclaw' | 'uiauto';

export interface TavernTaskConfig {
  id: string;
  bot_id?: string;
  enabled?: boolean;
  schedule_mode?: 'fixed' | 'daily_random';
  time: string;
  random_window_start?: string;
  random_window_end?: string;
  days?: number[];
  date_key?: string;
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
  wechat_transport?: WechatTransport;
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

export interface TavernModelApiConfig {
  enabled?: boolean;
  protocol: 'openai_chat_completions';
  name?: string;
  base_url: string;
  api_key?: string;
  model: string;
  temperature?: number;
  top_p?: number;
  timeout_ms?: number;
}

export interface TavernAgendaParserConfig {
  enabled?: boolean;
  timezone: string;
  system_prompt: string;
  user_prompt_template: string;
  entry_format: string;
}

export interface TavernAgendaEntry {
  id: string;
  date_text: string;
  date_key?: string;
  owner: 'user' | 'character';
  item: string;
  text: string;
  source_text?: string;
  created_at?: string;
}

export interface TavernAgendaConfig {
  parser: TavernAgendaParserConfig;
  entries: TavernAgendaEntry[];
}

export interface TavernUiautoAccountConfig {
  id: string;
  enabled?: boolean;
  worker_base_url?: string;
  owner_contact_name: string;
  bot_id: string;
  target_character?: string;
  conversation_id?: string;
  language?: string;
  poll_interval_ms?: number;
}

export interface TavernRelayConfig {
  config_path?: string;
  connector_dir: string;
  response_timeout_ms: number;
  schedule_grace_minutes: number;
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
  uiauto_accounts: TavernUiautoAccountConfig[];
  tasks: TavernTaskConfig[];
  model_api: TavernModelApiConfig;
  agenda: TavernAgendaConfig;
}

export interface TavernBotConfig {
  id: string;
  enabled?: boolean;
  name?: string;
  wechat_account_id?: string;
  wechat_token?: string;
  wechat_base_url?: string;
  wechat_scope_id?: string;
  wechat_transport?: WechatTransport;
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
    return { ...defaultConfig, config_path: resolvedPath };
  }

  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/u, '')) as Partial<TavernRelayConfig> & {
    alt_wechat_accounts?: unknown;
  };
  return {
    ...defaultConfig,
    ...raw,
    config_path: resolvedPath,
    connector_dir: path.resolve(String(raw.connector_dir ?? defaultConfig.connector_dir)),
    response_timeout_ms: normalizeBoundedInteger(raw.response_timeout_ms, defaultConfig.response_timeout_ms, 1_000, 10 * 60_000),
    poll_interval_ms: normalizeBoundedInteger(raw.poll_interval_ms, defaultConfig.poll_interval_ms, 100, 60_000),
    wechat_poll_interval_ms: normalizeBoundedInteger(raw.wechat_poll_interval_ms, defaultConfig.wechat_poll_interval_ms, 500, 60_000),
    schedule_grace_minutes: normalizeBoundedInteger(raw.schedule_grace_minutes, defaultConfig.schedule_grace_minutes, 0, 24 * 60),
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
    uiauto_accounts: normalizeUiautoAccounts(raw.uiauto_accounts ?? raw.alt_wechat_accounts, defaultConfig.uiauto_accounts),
    tasks: normalizeTasks(raw.tasks),
    model_api: normalizeModelApi(raw.model_api, defaultConfig.model_api),
    agenda: normalizeAgenda(raw.agenda, defaultConfig.agenda),
  };
}

export function saveTavernRelayConfig(config: TavernRelayConfig): void {
  const filePath = resolveTavernRelayConfigPath(config.config_path ?? process.env.TAVERN_RELAY_CONFIG);
  const serializable = {
    connector_dir: config.connector_dir,
    response_timeout_ms: config.response_timeout_ms,
    schedule_grace_minutes: config.schedule_grace_minutes,
    poll_interval_ms: config.poll_interval_ms,
    wechat_poll_interval_ms: config.wechat_poll_interval_ms,
    delivery: config.delivery,
    default_target: config.default_target,
    wechat: config.wechat,
    bots: config.bots,
    uiauto_accounts: config.uiauto_accounts,
    tasks: config.tasks,
    model_api: config.model_api,
    agenda: config.agenda,
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
    schedule_grace_minutes: normalizeBoundedInteger(process.env.TAVERN_SCHEDULE_GRACE_MINUTES, 30, 0, 24 * 60),
    poll_interval_ms: 1_000,
    wechat_poll_interval_ms: 2_000,
    delivery: {
      message_mode: process.env.WEIXIN_SPLIT_LOGICAL_MESSAGES === '0' ? 'single' : 'split',
      send_interval_ms: Number.parseInt(String(process.env.WEIXIN_SEND_INTERVAL_MS ?? '800'), 10) || 800,
    },
    default_target: {
      target_character: 'default_character',
      conversation_id: 'default_conversation',
      language: 'zh-CN',
    },
    wechat: {
      default_scope_id: process.env.WEIXIN_DEFAULT_SCOPE_ID ?? '',
      inbound_merge_window_ms: Number.parseInt(String(process.env.WEIXIN_INBOUND_MERGE_WINDOW_MS ?? '3500'), 10) || 3_500,
    },
    bots: [],
    uiauto_accounts: [],
    tasks: [],
    model_api: {
      enabled: false,
      protocol: 'openai_chat_completions',
      name: 'custom-compatible',
      base_url: process.env.TAVERN_MODEL_BASE_URL ?? '',
      api_key: process.env.TAVERN_MODEL_API_KEY ?? '',
      model: process.env.TAVERN_MODEL_NAME ?? '',
      temperature: 0.1,
      top_p: 1,
      timeout_ms: 60_000,
    },
    agenda: {
      parser: {
        enabled: true,
        timezone: 'Asia/Shanghai',
        entry_format: DEFAULT_AGENDA_ENTRY_FORMAT,
        system_prompt: DEFAULT_AGENDA_SYSTEM_PROMPT,
        user_prompt_template: DEFAULT_AGENDA_USER_PROMPT_TEMPLATE,
      },
      entries: [],
    },
  };
}

export const DEFAULT_AGENDA_ENTRY_FORMAT = 'x月x日，用户/角色约定事项：……';

export const DEFAULT_AGENDA_SYSTEM_PROMPT = [
  '你是 CodexTavernBridge 的日程解析器。',
  '任务：把用户或角色闲聊中提到的约定、安排、计划，解析为后端可保存的日程条目。',
  '只输出 JSON，不要输出解释。',
  'JSON 结构：{"entries":[{"date_text":"x月x日","owner":"user|character","item":"事项内容"}]}',
  'owner 规则：用户自己的安排用 user，角色自己的安排或角色与用户约定要做的事用 character。',
  '忽略没有明确日期的闲聊。日期只保留 x月x日，不要擅自补充复杂时间。',
].join('\n');

export const DEFAULT_AGENDA_USER_PROMPT_TEMPLATE = [
  '当前日期：{{today}}',
  '时区：{{timezone}}',
  '目标格式：{{format}}',
  '',
  '请解析下面文本里的日程安排：',
  '{{input}}',
].join('\n');

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
        wechat_transport: normalizeWechatTransport(bot.wechat_transport),
        target_character: String(bot.target_character || '').trim(),
        conversation_id: String(bot.conversation_id || '').trim(),
        language: String(bot.language || '').trim(),
      };
    })
    .filter((bot) => bot.id);
}

function normalizeTasks(raw: unknown): TavernTaskConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item): TavernTaskConfig | null => {
      const task = item && typeof item === 'object' ? item as Partial<TavernTaskConfig> : {};
      if (!task.id || !task.task) {
        return null;
      }
      return {
        ...task,
        id: String(task.id).trim(),
        time: String(task.time || '20:00').trim(),
        task: String(task.task).trim(),
        date_key: String(task.date_key || '').trim() || undefined,
        wechat_transport: normalizeWechatTransport(task.wechat_transport),
      };
    })
    .filter((task): task is TavernTaskConfig => Boolean(task));
}

export function normalizeWechatTransport(raw: unknown): WechatTransport {
  if (raw === 'openclaw') {
    return 'openclaw';
  }
  if (raw === 'uiauto' || raw === 'alt_wechat' || raw === 'windows_wxauto') {
    return 'uiauto';
  }
  return 'auto';
}

export function normalizeUiautoAccounts(
  raw: unknown,
  fallback: TavernUiautoAccountConfig[] = [],
): TavernUiautoAccountConfig[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return raw
    .map((item, index): TavernUiautoAccountConfig | null => {
      const account = item && typeof item === 'object' ? item as Partial<TavernUiautoAccountConfig> : {};
      const id = String(account.id || '').trim() || `uiauto_${index + 1}`;
      const ownerContactName = String(account.owner_contact_name || '').trim();
      if (!id) {
        return null;
      }
      return {
        id,
        enabled: account.enabled !== false,
        worker_base_url: String(account.worker_base_url || 'http://127.0.0.1:8795').trim() || 'http://127.0.0.1:8795',
        owner_contact_name: ownerContactName,
        bot_id: String(account.bot_id || 'default').trim() || 'default',
        target_character: String(account.target_character || '').trim() || undefined,
        conversation_id: String(account.conversation_id || '').trim() || undefined,
        language: String(account.language || '').trim() || undefined,
        poll_interval_ms: normalizeBoundedInteger(account.poll_interval_ms, 1_000, 500, 60_000),
      };
    })
    .filter((account): account is TavernUiautoAccountConfig => Boolean(account));
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

export function normalizeModelApi(
  raw: Partial<TavernModelApiConfig> | undefined,
  fallback: TavernModelApiConfig,
): TavernModelApiConfig {
  const timeout = normalizeNonNegativeInteger(raw?.timeout_ms, fallback.timeout_ms ?? 60_000);
  const temperature = Number.parseFloat(String(raw?.temperature ?? fallback.temperature ?? 0.1));
  const topP = Number.parseFloat(String(raw?.top_p ?? fallback.top_p ?? 1));
  return {
    enabled: raw?.enabled === true,
    protocol: 'openai_chat_completions',
    name: String(raw?.name || fallback.name || 'custom-compatible').trim(),
    base_url: String(raw?.base_url || fallback.base_url || '').trim(),
    api_key: String(raw?.api_key || fallback.api_key || '').trim(),
    model: String(raw?.model || fallback.model || '').trim(),
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.1,
    top_p: Number.isFinite(topP) ? Math.max(0.1, Math.min(1, topP)) : 1,
    timeout_ms: timeout || 60_000,
  };
}

export function normalizeAgenda(
  raw: Partial<TavernAgendaConfig> | undefined,
  fallback: TavernAgendaConfig,
): TavernAgendaConfig {
  return {
    parser: normalizeAgendaParser(raw?.parser, fallback.parser),
    entries: normalizeAgendaEntries(raw?.entries),
  };
}

export function normalizeAgendaParser(
  raw: Partial<TavernAgendaParserConfig> | undefined,
  fallback: TavernAgendaParserConfig,
): TavernAgendaParserConfig {
  return {
    enabled: raw?.enabled !== false,
    timezone: String(raw?.timezone || fallback.timezone || 'Asia/Shanghai').trim(),
    system_prompt: String(raw?.system_prompt || fallback.system_prompt || DEFAULT_AGENDA_SYSTEM_PROMPT).trim(),
    user_prompt_template: String(raw?.user_prompt_template || fallback.user_prompt_template || DEFAULT_AGENDA_USER_PROMPT_TEMPLATE).trim(),
    entry_format: String(raw?.entry_format || fallback.entry_format || DEFAULT_AGENDA_ENTRY_FORMAT).trim(),
  };
}

export function normalizeAgendaEntries(raw: unknown): TavernAgendaEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item): TavernAgendaEntry | null => {
      const entry = item && typeof item === 'object' ? item as Partial<TavernAgendaEntry> : {};
      const itemText = String(entry.item || '').trim();
      const dateText = String(entry.date_text || '').trim();
      const owner = entry.owner === 'character' ? 'character' : 'user';
      if (!itemText || !dateText) {
        return null;
      }
      return {
        id: String(entry.id || `agenda_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`).trim(),
        date_text: dateText,
        date_key: String(entry.date_key || '').trim() || undefined,
        owner,
        item: itemText,
        text: String(entry.text || formatAgendaEntryText({ date_text: dateText, owner, item: itemText })).trim(),
        source_text: String(entry.source_text || '').trim() || undefined,
        created_at: String(entry.created_at || '').trim() || undefined,
      };
    })
    .filter((entry): entry is TavernAgendaEntry => Boolean(entry));
}

export function formatAgendaEntryText(entry: Pick<TavernAgendaEntry, 'date_text' | 'owner' | 'item'>): string {
  const ownerText = entry.owner === 'character' ? '角色' : '用户';
  return `${entry.date_text}，${ownerText}约定事项：${entry.item}`;
}

function normalizeNonNegativeInteger(rawValue: unknown, fallback: number): number {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeBoundedInteger(rawValue: unknown, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}
