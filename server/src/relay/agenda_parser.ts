import {
  formatAgendaEntryText,
  type TavernAgendaEntry,
  type TavernRelayConfig,
} from './config.js';
import { localDateKey } from './protocol.js';

export interface AgendaParseResult {
  entries: TavernAgendaEntry[];
  source: 'model' | 'local';
  raw_model_output?: string;
}

interface ModelAgendaEntry {
  date_text?: unknown;
  owner?: unknown;
  item?: unknown;
}

export async function parseAgendaInput({
  config,
  text,
  now = new Date(),
}: {
  config: TavernRelayConfig;
  text: string;
  now?: Date;
}): Promise<AgendaParseResult> {
  const input = String(text || '').trim();
  if (!input) {
    return { entries: [], source: 'local' };
  }

  if (canUseModel(config)) {
    try {
      const raw = await callAgendaModel({ config, input, now });
      const entries = normalizeModelEntries(raw, input, config, now);
      if (entries.length) {
        return { entries, source: 'model', raw_model_output: raw };
      }
    } catch {
      // Fall back to local parsing so a bad model setting does not block manual entry.
    }
  }

  return { entries: parseAgendaLocally(input, config, now), source: 'local' };
}

export function parseAgendaLocally(text: string, config: TavernRelayConfig, now = new Date()): TavernAgendaEntry[] {
  const entries: TavernAgendaEntry[] = [];
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.length ? lines : [text]) {
    const direct = /(?<month>\d{1,2})\s*月\s*(?<day>\d{1,2})\s*日[，,\s]*(?<owner>用户|角色)?(?:约定事项|日程|安排|事项)?[:：]?\s*(?<item>.+)$/u.exec(line);
    if (direct?.groups) {
      const ownerText = direct.groups.owner || inferOwner(line);
      entries.push(makeAgendaEntry({
        month: Number(direct.groups.month),
        day: Number(direct.groups.day),
        owner: ownerText === '角色' ? 'character' : 'user',
        item: direct.groups.item,
        sourceText: line,
        config,
        now,
      }));
      continue;
    }

    const loose = /(?<month>\d{1,2})\s*月\s*(?<day>\d{1,2})\s*日(?<item>.+)$/u.exec(line);
    if (loose?.groups) {
      entries.push(makeAgendaEntry({
        month: Number(loose.groups.month),
        day: Number(loose.groups.day),
        owner: inferOwner(line) === '角色' ? 'character' : 'user',
        item: loose.groups.item.replace(/^[，,：:\s]+/u, ''),
        sourceText: line,
        config,
        now,
      }));
    }
  }
  return entries;
}

function canUseModel(config: TavernRelayConfig): boolean {
  return Boolean(
    config.model_api.enabled
    && config.model_api.base_url
    && config.model_api.model
    && config.agenda.parser.enabled,
  );
}

async function callAgendaModel({
  config,
  input,
  now,
}: {
  config: TavernRelayConfig;
  input: string;
  now: Date;
}): Promise<string> {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch().');
  }
  const parser = config.agenda.parser;
  const timezone = parser.timezone || 'Asia/Shanghai';
  const today = localDateKey(now, timezone);
  const prompt = parser.user_prompt_template
    .replaceAll('{{today}}', today)
    .replaceAll('{{timezone}}', timezone)
    .replaceAll('{{format}}', parser.entry_format)
    .replaceAll('{{input}}', input);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.model_api.timeout_ms ?? 60_000);
  try {
    const response = await fetchImpl(chatCompletionsUrl(config.model_api.base_url), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.model_api.api_key ? { Authorization: `Bearer ${config.model_api.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: config.model_api.model,
        temperature: config.model_api.temperature ?? 0.1,
        top_p: config.model_api.top_p ?? 1,
        messages: [
          { role: 'system', content: parser.system_prompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
    if (!response.ok) {
      throw new Error(modelApiErrorMessage(response.status, payload.error?.message || response.statusText));
    }
    return String(payload.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

function modelApiErrorMessage(status: number, message: string): string {
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key/i.test(message)) {
    return '模型服务鉴权失败，请检查 Base URL 是否指向正确服务商，以及 API Key 是否有效。';
  }
  return message || `Model API HTTP ${status}`;
}

function normalizeModelEntries(raw: string, sourceText: string, config: TavernRelayConfig, now: Date): TavernAgendaEntry[] {
  const jsonText = extractJson(raw);
  const parsed = JSON.parse(jsonText) as { entries?: ModelAgendaEntry[] };
  if (!Array.isArray(parsed.entries)) {
    return [];
  }
  return parsed.entries
    .map((entry) => {
      const match = /(?<month>\d{1,2})\s*月\s*(?<day>\d{1,2})\s*日/u.exec(String(entry.date_text || ''));
      const item = String(entry.item || '').trim();
      if (!match?.groups || !item) {
        return null;
      }
      return makeAgendaEntry({
        month: Number(match.groups.month),
        day: Number(match.groups.day),
        owner: entry.owner === 'character' ? 'character' : 'user',
        item,
        sourceText,
        config,
        now,
      });
    })
    .filter((entry): entry is TavernAgendaEntry => Boolean(entry));
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*(?<json>[\s\S]*?)```/u.exec(text);
  if (fenced?.groups?.json) {
    return fenced.groups.json.trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function makeAgendaEntry({
  month,
  day,
  owner,
  item,
  sourceText,
  config,
  now,
}: {
  month: number;
  day: number;
  owner: 'user' | 'character';
  item: string;
  sourceText: string;
  config: TavernRelayConfig;
  now: Date;
}): TavernAgendaEntry {
  const dateText = `${month}月${day}日`;
  const entry = {
    id: `agenda_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    date_text: dateText,
    date_key: inferDateKey(month, day, config.agenda.parser.timezone || 'Asia/Shanghai', now),
    owner,
    item: item.trim(),
    text: '',
    source_text: sourceText,
    created_at: new Date().toISOString(),
  };
  entry.text = formatAgendaEntryText(entry);
  return entry;
}

function inferDateKey(month: number, day: number, timeZone: string, now: Date): string | undefined {
  const currentYear = Number(localDateKey(now, timeZone).slice(0, 4));
  const date = new Date(Date.UTC(currentYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferOwner(text: string): '用户' | '角色' {
  return /角色|你自己|你的|陪我|一起|我们/u.test(text) ? '角色' : '用户';
}
