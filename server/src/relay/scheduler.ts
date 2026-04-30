import type { TavernRelayConfig, TavernTaskConfig } from './config.js';
import { localDateKey, localHourMinute } from './protocol.js';
import type { RelayState } from './state_store.js';

export function dueTasks(config: TavernRelayConfig, state: RelayState, now = new Date()): TavernTaskConfig[] {
  const due: TavernTaskConfig[] = [];
  for (const task of config.tasks) {
    if (task.enabled === false) {
      continue;
    }
    const timeZone = task.timezone || 'Asia/Shanghai';
    if (Array.isArray(task.days) && task.days.length > 0 && !task.days.includes(localWeekday(now, timeZone))) {
      continue;
    }
    const scheduledTime = effectiveScheduledTime(task, state, now, timeZone);
    if (!scheduledTime) {
      continue;
    }
    const taskStateKey = `${task.bot_id || 'default'}:${task.id}`;
    const key = `${taskStateKey}:${localDateKey(now, timeZone)}`;
    if (state.emittedTasks[taskStateKey] === key) {
      continue;
    }
    if (wasCreatedAfterTodaysScheduledTime(task, now, timeZone, scheduledTime)) {
      continue;
    }
    if (localHourMinute(now, timeZone) !== scheduledTime) {
      continue;
    }
    state.emittedTasks[taskStateKey] = key;
    due.push(task);
  }
  return due;
}

function effectiveScheduledTime(task: TavernTaskConfig, state: RelayState, now: Date, timeZone: string): string | null {
  if (task.schedule_mode !== 'daily_random') {
    return isHourMinute(task.time) ? task.time : null;
  }

  const dateKey = localDateKey(now, timeZone);
  const taskStateKey = `${task.bot_id || 'default'}:${task.id}`;
  const randomKey = `${taskStateKey}:${dateKey}`;
  state.randomTaskTimes ??= {};
  const existing = state.randomTaskTimes[randomKey];
  const currentMinute = toMinuteOfDay(localHourMinute(now, timeZone));
  if (isHourMinute(existing)) {
    const existingMinute = toMinuteOfDay(existing);
    const emittedKey = `${taskStateKey}:${dateKey}`;
    const alreadyEmitted = state.emittedTasks[taskStateKey] === emittedKey;
    if (
      alreadyEmitted ||
      currentMinute === null ||
      (existingMinute !== null && existingMinute >= currentMinute)
    ) {
      return existing;
    }
  }

  const start = isHourMinute(task.random_window_start) ? task.random_window_start : isHourMinute(task.time) ? task.time : '09:00';
  const end = isHourMinute(task.random_window_end) ? task.random_window_end : start;
  const startMinute = toMinuteOfDay(start);
  const endMinute = toMinuteOfDay(end);
  if (startMinute === null || endMinute === null) {
    return null;
  }
  const lower = Math.min(startMinute, endMinute);
  const upper = Math.max(startMinute, endMinute);
  const createdMinute = createdMinuteForToday(task, now, timeZone);
  if (createdMinute !== null && createdMinute >= upper) {
    return null;
  }
  const effectiveLower = Math.max(
    lower,
    createdMinute === null ? lower : createdMinute + 1,
    currentMinute === null ? lower : currentMinute + 1,
  );
  if (effectiveLower > upper) {
    return null;
  }
  const pickedMinute = randomInt(effectiveLower, upper);
  const picked = fromMinuteOfDay(pickedMinute);
  state.randomTaskTimes[randomKey] = picked;
  return picked;
}

function wasCreatedAfterTodaysScheduledTime(task: TavernTaskConfig, now: Date, timeZone: string, scheduledTime: string): boolean {
  const createdMinute = createdMinuteForToday(task, now, timeZone);
  if (createdMinute === null) {
    return false;
  }
  const scheduledMinute = toMinuteOfDay(scheduledTime);
  return scheduledMinute !== null && createdMinute > scheduledMinute;
}

function createdMinuteForToday(task: TavernTaskConfig, now: Date, timeZone: string): number | null {
  if (!task.created_at) {
    return null;
  }
  const createdAt = new Date(task.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }
  if (localDateKey(createdAt, timeZone) !== localDateKey(now, timeZone)) {
    return null;
  }
  return toMinuteOfDay(localHourMinute(createdAt, timeZone));
}

function localWeekday(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[String(weekday)] ?? 0;
}

function isHourMinute(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/u.test(value);
}

function toMinuteOfDay(value: string): number | null {
  if (!isHourMinute(value)) {
    return null;
  }
  const [hour, minute] = value.split(':').map((part) => Number(part));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function fromMinuteOfDay(value: number): string {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.floor(value)));
  const hour = String(Math.floor(bounded / 60)).padStart(2, '0');
  const minute = String(bounded % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function randomInt(min: number, max: number): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (upper <= lower) {
    return lower;
  }
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}
