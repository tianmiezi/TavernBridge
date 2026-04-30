export const PROTOCOL = 'codex_tavern_event';
export const SCHEMA_VERSION = '1.0';

export type RelayEventType = 'user_reply' | 'scheduled_task';

export interface RelayTarget {
  target_character: string;
  conversation_id: string;
  language: string;
}

export interface RelayEvent {
  protocol: typeof PROTOCOL;
  schema_version: typeof SCHEMA_VERSION;
  event_id: string;
  bot_id?: string;
  created_at: string;
  type: RelayEventType;
  intent: string;
  target_character: string;
  conversation_id: string;
  language: string;
  task?: string;
  suggested_first_step?: string;
  tone?: string[];
  max_length_chars?: number;
  forbidden?: string[];
  user_reply?: {
    text: string;
    received_at: string;
    source: 'wechat';
    external_scope_id: string;
  };
  delivery_channel: 'wechat' | 'tavern';
  wechat_scope_id?: string;
  metadata?: Record<string, unknown>;
}

export function makeEventId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]+/gu, '_').slice(0, 48) || 'event';
  return `${safePrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function nowIso(timeZone = 'Asia/Shanghai'): string {
  return localIso(new Date(), timeZone);
}

export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function localHourMinute(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function localIso(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  const offsetMinutes = timeZoneOffsetMinutes(date, timeZone, {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  });
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${formatOffset(offsetMinutes)}`;
}

function timeZoneOffsetMinutes(
  date: Date,
  timeZone: string,
  local: { year: number; month: number; day: number; hour: number; minute: number; second: number },
): number {
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((localAsUtc - date.getTime()) / 60_000);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}
