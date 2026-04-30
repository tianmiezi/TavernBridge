import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WeixinAccountStore } from '../platforms/weixin/account_store.js';
import { saveTavernRelayConfig, type TavernBotConfig, type TavernRelayConfig, type TavernTaskConfig } from './config.js';
import type { RelayEvent } from './protocol.js';
import type { TavernFileConnector } from './tavern_connector.js';

export interface RelayAdminServerOptions {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateDir: string;
  triggerTask: (task: TavernTaskConfig) => Promise<RelayEvent>;
}

export async function startRelayAdminServer(options: RelayAdminServerOptions): Promise<http.Server | null> {
  if (process.env.WEIXIN_RELAY_ADMIN === '0') {
    return null;
  }

  const host = process.env.WEIXIN_RELAY_ADMIN_HOST || '127.0.0.1';
  const port = Number(process.env.WEIXIN_RELAY_ADMIN_PORT || 8790);
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, options).catch((error) => {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  process.stdout.write(`[weixin-relay] admin_url=http://${host}:${port}\n`);
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: RelayAdminServerOptions,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    sendHtml(res, renderAppHtml());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, await statusPayload(options));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/replies') {
    const limit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
    sendJson(res, 200, {
      ok: true,
      replies: await listReplyRecords(options.connector, Number.isFinite(limit) ? limit : 50),
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/replies/retry') {
    const body = await readJson(req);
    const result = await retryReplyRecord(options.connector, String(body.queue || ''), String(body.file || ''));
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/clear') {
    const body = await readJson(req);
    const queue = String(body.queue || '');
    if (queue === 'pending_followups') {
      const count = await clearPendingFollowups(path.join(options.stateDir, 'relay', 'state.json'));
      sendJson(res, 200, { ok: true, cleared: count });
      return;
    }
    const count = await clearQueue(options.connector, queue);
    sendJson(res, 200, { ok: true, cleared: count });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/delivery') {
    const body = await readJson(req);
    const mode = body.message_mode === 'single' ? 'single' : body.message_mode === 'split' ? 'split' : options.config.delivery.message_mode;
    const interval = Number.parseInt(String(body.send_interval_ms ?? options.config.delivery.send_interval_ms), 10);
    options.config.delivery = {
      message_mode: mode,
      send_interval_ms: Number.isFinite(interval) && interval >= 0 ? interval : options.config.delivery.send_interval_ms,
    };
    syncDeliveryEnv(options.config);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, delivery: options.config.delivery });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/wechat') {
    const body = await readJson(req);
    const waitMs = Number.parseInt(String(body.inbound_merge_window_ms ?? options.config.wechat.inbound_merge_window_ms), 10);
    options.config.wechat = {
      ...options.config.wechat,
      inbound_merge_window_ms: Number.isFinite(waitMs) && waitMs >= 0 ? waitMs : options.config.wechat.inbound_merge_window_ms,
    };
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, wechat: options.config.wechat });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/bots') {
    const body = await readJson(req);
    const bot = normalizeBot(body, options.config);
    const existingIndex = options.config.bots.findIndex((item) => item.id === bot.id);
    if (existingIndex >= 0) {
      options.config.bots[existingIndex] = { ...options.config.bots[existingIndex], ...bot };
    } else {
      options.config.bots.push(bot);
    }
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, bot });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readJson(req);
    const incomingId = String(body.id || '').trim();
    const existingIndex = incomingId ? options.config.tasks.findIndex((item) => item.id === incomingId) : -1;
    const existingTask = existingIndex >= 0 ? options.config.tasks[existingIndex] : null;
    const task = normalizeTask(body, existingTask);
    if (existingIndex >= 0) {
      options.config.tasks[existingIndex] = { ...options.config.tasks[existingIndex], ...task };
    } else {
      options.config.tasks.push(task);
    }
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, task });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/run')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const task = findTask(options.config, id);
    if (!task) {
      sendJson(res, 404, { ok: false, error: 'Task not found.' });
      return;
    }
    const event = await options.triggerTask(task);
    sendJson(res, 200, { ok: true, event_id: event.event_id });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/tasks/') && url.pathname.endsWith('/toggle')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const task = findTask(options.config, id);
    if (!task) {
      sendJson(res, 404, { ok: false, error: 'Task not found.' });
      return;
    }
    task.enabled = task.enabled === false;
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, task });
    return;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/tasks/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    options.config.tasks = options.config.tasks.filter((task) => task.id !== id);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/bots/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    options.config.bots = options.config.bots.filter((bot) => bot.id !== id);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found.' });
}

async function statusPayload({ config, connector, stateDir }: RelayAdminServerOptions): Promise<Record<string, unknown>> {
  return {
    ok: true,
    now: new Date().toISOString(),
    config_path: config.config_path,
    connector_dir: connector.connectorDir,
    default_target: config.default_target,
    wechat: config.wechat,
    wechat_accounts: listSavedWeixinAccounts(stateDir),
    bots: config.bots,
    delivery: config.delivery,
    tasks: config.tasks,
    random_task_times: await readRandomTaskTimes(path.join(stateDir, 'relay', 'state.json')),
    queues: {
      inbox: await countFiles(connector.inboxDir),
      outbox: await countFiles(connector.outboxDir),
      deferred: await countFiles(connector.deferredDir),
      sent: await countFiles(connector.sentDir),
      failed: await countFiles(connector.failedDir),
      processed: await countFiles(path.join(connector.inboxDir, 'processed')),
      pending_followups: await countPendingFollowups(path.join(stateDir, 'relay', 'state.json')),
    },
  };
}

function normalizeTask(body: Record<string, unknown>, existingTask: TavernTaskConfig | null = null): TavernTaskConfig {
  const id = String(body.id || '').trim() || `task_${Date.now()}`;
  const time = String(body.time || '20:00').trim();
  if (!/^\d{2}:\d{2}$/u.test(time)) {
    throw new Error('time must use HH:mm format.');
  }
  const scheduleMode = body.schedule_mode === 'daily_random' ? 'daily_random' : 'fixed';
  const randomWindowStart = normalizeHourMinute(body.random_window_start, '09:00');
  const randomWindowEnd = normalizeHourMinute(body.random_window_end, '22:30');
  const task = String(body.task || '').trim();
  if (!task) {
    throw new Error('task is required.');
  }
  return {
    id,
    bot_id: String(body.bot_id || existingTask?.bot_id || '').trim() || undefined,
    enabled: body.enabled !== false,
    schedule_mode: scheduleMode,
    time,
    random_window_start: scheduleMode === 'daily_random' ? randomWindowStart : undefined,
    random_window_end: scheduleMode === 'daily_random' ? randomWindowEnd : undefined,
    days: normalizeDays(body.days),
    created_at: existingTask?.created_at || String(body.created_at || '').trim() || new Date().toISOString(),
    timezone: String(body.timezone || 'Asia/Shanghai').trim(),
    intent: String(body.intent || '温和提醒，仅供参考').trim(),
    task,
    suggested_first_step: String(body.suggested_first_step || '').trim(),
    followups: normalizeFollowups(body),
    delivery_channel: body.delivery_channel === 'tavern' ? 'tavern' : 'wechat',
    target_character: String(body.target_character || '').trim() || undefined,
    conversation_id: String(body.conversation_id || '').trim() || undefined,
    language: String(body.language || '').trim() || undefined,
  };
}

function normalizeHourMinute(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/u.test(text) ? text : fallback;
}

function normalizeBot(body: Record<string, unknown>, config: TavernRelayConfig): TavernBotConfig {
  const id = String(body.id || '').trim();
  if (!id) {
    throw new Error('bot id is required.');
  }
  return {
    id,
    enabled: body.enabled !== false,
    name: String(body.name || id).trim(),
    wechat_account_id: String(body.wechat_account_id || '').trim(),
    wechat_scope_id: String(body.wechat_scope_id || config.wechat.default_scope_id || '').trim(),
    target_character: String(body.target_character || config.default_target.target_character || '').trim(),
    conversation_id: String(body.conversation_id || config.default_target.conversation_id || '').trim(),
    language: String(body.language || config.default_target.language || 'zh-CN').trim(),
  };
}

function listSavedWeixinAccounts(stateDir: string): Array<Record<string, unknown>> {
  const store = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  return store.listAccounts().map((id) => {
    const account = store.loadAccount(id);
    return {
      id,
      user_id: account?.user_id || '',
      base_url: account?.base_url || '',
      saved_at: account?.saved_at || '',
      has_token: Boolean(account?.token),
    };
  });
}

function normalizeFollowups(body: Record<string, unknown>): TavernTaskConfig['followups'] {
  if (body.followup_enabled !== true && body.followup_enabled !== 'on' && body.followup_enabled !== 'true') {
    return undefined;
  }
  const delay = Number.parseInt(String(body.followup_delay_minutes || '30'), 10);
  const task = String(body.followup_task || '').trim();
  if (!task) {
    return undefined;
  }
  return [{
    enabled: true,
    delay_minutes: Number.isFinite(delay) && delay > 0 ? delay : 30,
    task,
    suggested_first_step: String(body.followup_suggested_first_step || '').trim(),
    intent: String(body.followup_intent || '稍微担心，仅供参考').trim(),
  }];
}

function normalizeDays(value: unknown): number[] | undefined {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  const days = Array.from(new Set(values
    .map((item) => Number(item))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)));
  return days.length ? days.sort((a, b) => a - b) : undefined;
}

function findTask(config: TavernRelayConfig, id: string): TavernTaskConfig | null {
  return config.tasks.find((task) => task.id === id) ?? null;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

async function countFiles(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).length;
}

async function countPendingFollowups(filePath: string): Promise<number> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { pendingFollowups?: Record<string, unknown> };
    return parsed.pendingFollowups && typeof parsed.pendingFollowups === 'object'
      ? Object.keys(parsed.pendingFollowups).length
      : 0;
  } catch {
    return 0;
  }
}

async function readRandomTaskTimes(filePath: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { randomTaskTimes?: Record<string, string> };
    return parsed.randomTaskTimes && typeof parsed.randomTaskTimes === 'object' ? parsed.randomTaskTimes : {};
  } catch {
    return {};
  }
}

type ReplyQueue = 'outbox' | 'deferred' | 'sent' | 'failed';

interface ReplyRecord {
  queue: ReplyQueue;
  file: string;
  event_id: string;
  status: string;
  error: string;
  text_preview: string;
  size: number;
  updated_at: string;
}

async function listReplyRecords(connector: TavernFileConnector, limit: number): Promise<ReplyRecord[]> {
  const queues: ReplyQueue[] = ['outbox', 'deferred', 'failed', 'sent'];
  const records = (await Promise.all(queues.map(async (queue) => listReplyRecordsFromQueue(connector, queue))))
    .flat()
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  return records.slice(0, Math.max(1, Math.min(limit, 200)));
}

async function listReplyRecordsFromQueue(connector: TavernFileConnector, queue: ReplyQueue): Promise<ReplyRecord[]> {
  const dir = queueDir(connector, queue);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const records: ReplyRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith('.json') && !entry.name.endsWith('.txt'))) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      continue;
    }
    const summary = await summarizeReplyFile(filePath);
    records.push({
      queue,
      file: entry.name,
      event_id: summary.event_id || path.basename(entry.name, path.extname(entry.name)),
      status: summary.status,
      error: summary.error,
      text_preview: preview(summary.text, 90),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
    });
  }
  return records;
}

async function summarizeReplyFile(filePath: string): Promise<{ event_id: string; status: string; error: string; text: string }> {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (filePath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        event_id: String(parsed.event_id || ''),
        status: String(parsed.status || ''),
        error: String(parsed.error || ''),
        text: String(parsed.text ?? parsed.body ?? parsed.message ?? parsed.content ?? ''),
      };
    } catch {
      return { event_id: '', status: 'invalid', error: 'Invalid JSON', text: raw };
    }
  }
  return { event_id: path.basename(filePath, path.extname(filePath)), status: 'ok', error: '', text: raw };
}

async function retryReplyRecord(connector: TavernFileConnector, queue: string, file: string): Promise<{ file: string }> {
  const sourceQueue = queue === 'failed' ? 'failed' : queue === 'deferred' ? 'deferred' : null;
  if (!sourceQueue) {
    throw new Error('Only failed/deferred records can be retried.');
  }
  const safeFile = path.basename(file);
  const source = path.join(queueDir(connector, sourceQueue), safeFile);
  const parsed = path.parse(safeFile);
  const targetName = `${parsed.name}.retry-${Date.now()}${parsed.ext}`;
  const target = path.join(connector.outboxDir, targetName);
  await fs.rename(source, target);
  return { file: targetName };
}

async function clearQueue(connector: TavernFileConnector, queue: string): Promise<number> {
  const allowed = new Set(['failed', 'deferred', 'sent', 'processed']);
  if (!allowed.has(queue)) {
    throw new Error('Queue cannot be cleared.');
  }
  const dir = queue === 'processed' ? path.join(connector.inboxDir, 'processed') : queueDir(connector, queue as ReplyQueue);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    await fs.unlink(path.join(dir, entry.name)).catch(() => {});
    count += 1;
  }
  return count;
}

async function clearPendingFollowups(filePath: string): Promise<number> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { pendingFollowups?: Record<string, unknown> };
    const count = parsed.pendingFollowups && typeof parsed.pendingFollowups === 'object'
      ? Object.keys(parsed.pendingFollowups).length
      : 0;
    parsed.pendingFollowups = {};
    await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return count;
  } catch {
    return 0;
  }
}

function queueDir(connector: TavernFileConnector, queue: ReplyQueue): string {
  if (queue === 'outbox') return connector.outboxDir;
  if (queue === 'deferred') return connector.deferredDir;
  if (queue === 'failed') return connector.failedDir;
  return connector.sentDir;
}

function preview(text: string, maxLength: number): string {
  const normalized = String(text || '').replace(/\s+/gu, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function syncDeliveryEnv(config: Pick<TavernRelayConfig, 'delivery'>): void {
  process.env.WEIXIN_SPLIT_LOGICAL_MESSAGES = config.delivery.message_mode === 'split' ? '1' : '0';
  process.env.WEIXIN_SEND_INTERVAL_MS = String(config.delivery.send_interval_ms);
}

function renderAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Codex Tavern Relay</title>
  <style>
    :root { font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; color: #18212f; background: #f5f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #18212f; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { font-size: 24px; margin: 0; font-weight: 680; letter-spacing: 0; }
    h2 { font-size: 15px; margin: 0 0 12px; font-weight: 680; }
    section { background: #fff; border: 1px solid #dbe2ec; border-radius: 8px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(24, 33, 47, .04); }
    button, input, select, textarea { font: inherit; }
    button { min-height: 36px; border-radius: 6px; border: 1px solid #1f6feb; background: #1f6feb; color: #fff; padding: 8px 12px; cursor: pointer; box-shadow: 0 1px 1px rgba(24, 33, 47, .08); transition: transform .12s ease, box-shadow .12s ease, background .12s ease, border-color .12s ease; }
    button:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(24, 33, 47, .12); }
    button:active { transform: translateY(1px); box-shadow: inset 0 2px 5px rgba(24, 33, 47, .16); }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #b8d7ff; outline-offset: 2px; }
    button.secondary { background: #fff; color: #263445; border-color: #c9d3df; }
    button.ghost { background: #eef4ff; color: #1f4ea3; border-color: #cdddf8; }
    button.soft-blue { background: #e8f2ff; color: #175cd3; border-color: #b8d7ff; }
    button.danger { background: #b42318; border-color: #b42318; }
    input, select { width: 100%; border: 1px solid #c9d3df; border-radius: 6px; padding: 8px 10px; background: #fff; color: #18212f; }
    label { display: grid; gap: 5px; font-size: 12px; color: #596779; }
    .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
    .inline-setting { display: inline-flex; align-items: center; gap: 6px; color: #445468; }
    .inline-setting input { width: 110px; min-height: 32px; padding: 5px 8px; }
    .badge { display: inline-flex; align-items: center; min-height: 28px; border: 1px solid #c9d3df; border-radius: 999px; padding: 4px 10px; background: #fff; font-size: 12px; color: #445468; }
    .summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid #e0e6ef; border-radius: 6px; padding: 10px; background: #fbfcfe; }
    .metric span { display: block; color: #647184; font-size: 12px; }
    .metric b { display: block; font-size: 21px; margin-top: 4px; }
    .form-grid { display: grid; grid-template-columns: 1fr 120px 150px 160px; gap: 10px; align-items: end; }
    .wide { grid-column: 1 / -1; }
    .quick-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .quick-row button { min-height: 30px; padding: 5px 9px; font-size: 12px; }
    .followup-panel { grid-column: 1 / -1; border: 1px solid #d7e3f3; border-radius: 8px; background: #f8fbff; padding: 12px; display: grid; grid-template-columns: 160px 120px 1fr; gap: 10px; align-items: end; }
    .switch-label { display: flex; align-items: center; gap: 8px; min-height: 38px; color: #263445; }
    .switch-label input { width: auto; }
    .days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
    .day-check { display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid #d5dce7; border-radius: 6px; min-height: 36px; background: #fbfcfe; color: #263445; }
    .day-check input { width: auto; }
    .week-wrap { overflow-x: auto; }
    .week { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    .week th { text-align: left; color: #536174; font-size: 12px; padding: 8px; border-bottom: 1px solid #e1e7f0; background: #f7f9fc; position: sticky; top: 0; z-index: 1; }
    .week td { vertical-align: top; height: 220px; padding: 8px; border-right: 1px solid #e8edf4; border-bottom: 1px solid #e8edf4; background: #fcfdff; }
    .week td:last-child, .week th:last-child { border-right: 0; }
    .day-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .day-head button { min-height: 28px; padding: 4px 8px; font-size: 12px; }
    .task-card { border: 1px solid #d9e0ea; border-left: 4px solid #2da44e; border-radius: 6px; background: #fff; padding: 9px; margin-bottom: 8px; transition: border-color .15s, box-shadow .15s, transform .15s; }
    .task-card:hover { border-color: #aebbd0; box-shadow: 0 6px 16px rgba(24, 33, 47, .08); transform: translateY(-1px); }
    .task-card.paused { border-left-color: #8a94a6; opacity: .76; }
    .task-time { font-family: Consolas, "Courier New", monospace; font-size: 12px; color: #0f766e; font-weight: 700; }
    .task-title { margin-top: 5px; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
    .task-meta { margin-top: 6px; color: #6a7688; font-size: 12px; overflow-wrap: anywhere; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .actions button { min-height: 30px; padding: 5px 8px; font-size: 12px; }
    .bot-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 12px; }
    .bot-card { border: 1px solid #dfe6f0; border-radius: 6px; background: #fbfcfe; padding: 10px; }
    .bot-card.paused { opacity: .7; }
    .bot-title { font-weight: 700; color: #263445; overflow-wrap: anywhere; }
    .bot-meta { margin-top: 5px; color: #66768a; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
    .task-switch { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; border: 1px solid #c9d3df; border-radius: 6px; padding: 4px 8px; background: #f7f9fc; color: #263445; cursor: pointer; user-select: none; transition: background .12s ease, border-color .12s ease, transform .12s ease; }
    .task-switch:hover { background: #eef4ff; border-color: #b8d7ff; transform: translateY(-1px); }
    .task-switch:active { transform: translateY(1px); }
    .task-switch input { position: absolute; opacity: 0; pointer-events: none; }
    .task-switch span { width: 34px; height: 18px; border-radius: 999px; background: #a4adbb; position: relative; transition: background .15s ease; }
    .task-switch span::after { content: ""; width: 14px; height: 14px; border-radius: 50%; background: #fff; position: absolute; top: 2px; left: 2px; box-shadow: 0 1px 2px rgba(24, 33, 47, .25); transition: transform .15s ease; }
    .task-switch input:checked + span { background: #2da44e; }
    .task-switch input:checked + span::after { transform: translateX(16px); }
    .records-panel { background: #fff; border: 1px solid #dbe2ec; border-radius: 8px; padding: 0; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(24, 33, 47, .04); overflow: hidden; }
    .records-panel summary { display: flex; align-items: center; gap: 10px; list-style: none; cursor: pointer; padding: 16px; }
    .records-panel summary::-webkit-details-marker { display: none; }
    .records-panel summary::after { content: "收起"; margin-left: auto; color: #647184; font-size: 12px; }
    .records-panel:not([open]) summary::after { content: "展开"; }
    .records-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .records-panel .records-head { margin-bottom: 0; }
    .records-panel > .records-head { padding: 0 16px 10px; }
    .records-head h2 { margin: 0; }
    .records-tools { display: flex; gap: 8px; flex-wrap: wrap; }
    .records { display: grid; gap: 8px; max-height: 360px; overflow-y: auto; padding: 0 16px 16px; scrollbar-width: thin; scrollbar-color: #b6c4d6 #eef2f7; }
    .records::-webkit-scrollbar { width: 9px; }
    .records::-webkit-scrollbar-track { background: #eef2f7; border-radius: 999px; }
    .records::-webkit-scrollbar-thumb { background: #b6c4d6; border-radius: 999px; border: 2px solid #eef2f7; }
    .record { display: grid; grid-template-columns: 88px 1fr auto; gap: 10px; align-items: center; border: 1px solid #e0e6ef; border-radius: 6px; background: #fbfcfe; padding: 9px; }
    .record-queue { font-size: 12px; font-weight: 700; color: #314158; }
    .record-main { min-width: 0; }
    .record-title { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
    .record-preview { margin-top: 3px; color: #66768a; font-size: 12px; overflow-wrap: anywhere; }
    .record-meta { margin-top: 3px; color: #8a94a6; font-size: 12px; }
    .empty { color: #8a94a6; font-size: 12px; padding: 8px 0; }
    .mono { font-family: Consolas, "Courier New", monospace; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (max-width: 900px) { main { padding: 14px; } .summary { grid-template-columns: repeat(3, minmax(0, 1fr)); } .form-grid, .followup-panel { grid-template-columns: 1fr 1fr; } .days { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .summary, .form-grid, .days { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Codex Tavern Relay</h1>
        <div class="toolbar">
          <button class="ghost" id="modeToggle" type="button">发送模式: -</button>
          <label class="inline-setting">入站等待(ms)<input id="mergeWindowMs" type="number" min="0" step="1000"></label>
          <button class="secondary" id="saveMergeWindow" type="button">保存等待</button>
          <span class="badge" id="updated">未刷新</span>
        </div>
      </div>
      <button class="secondary" id="refresh">刷新</button>
    </header>
    <section>
      <h2>队列状态</h2>
      <div class="summary" id="metrics"></div>
    </section>
    <details class="records-panel" open>
      <summary><h2>发送记录</h2></summary>
      <div class="records-head">
        <div class="records-tools">
          <button class="secondary" type="button" data-refresh-records>刷新记录</button>
          <button class="soft-blue" type="button" data-clear-queue="deferred">清延迟</button>
          <button class="soft-blue" type="button" data-clear-queue="failed">清失败</button>
          <button class="secondary" type="button" data-clear-queue="sent">清已发送</button>
          <button class="secondary" type="button" data-clear-queue="processed">清已处理入站</button>
          <button class="secondary" type="button" data-clear-queue="pending_followups">清后续等待</button>
        </div>
      </div>
      <div class="records" id="replyRecords"></div>
    </details>
    <section>
      <h2>机器人绑定</h2>
      <form id="botForm" class="form-grid">
        <label>机器人 ID<input name="id" placeholder="study"></label>
        <label>显示名<input name="name" placeholder="学习提醒"></label>
        <label>微信账号<select name="wechat_account_id" id="botAccountSelect"></select></label>
        <label>启用<select name="enabled"><option value="true">启用</option><option value="false">暂停</option></select></label>
        <label class="wide">微信联系人 / Scope ID<input name="wechat_scope_id" placeholder="o9...@im.wechat"></label>
        <label>酒馆角色<input name="target_character" placeholder="girlfriend_study_partner"></label>
        <label>酒馆会话<input name="conversation_id" placeholder="daily_study_checkin"></label>
        <label>语言<input name="language" value="zh-CN"></label>
        <button type="submit">保存绑定</button>
        <button class="secondary" type="button" id="resetBotForm">清空</button>
      </form>
      <div class="bot-list" id="botList"></div>
    </section>
    <section>
      <h2>新增 / 更新任务</h2>
      <form id="taskForm" class="form-grid">
        <label>任务 ID<input name="id" placeholder="study_mon_2000"></label>
        <label>时间<input name="time" type="time" value="20:00" required></label>
        <label>触发模式<select name="schedule_mode"><option value="fixed">固定时间</option><option value="daily_random">每日随机</option></select></label>
        <label>随机开始<input name="random_window_start" type="time" value="09:00"></label>
        <label>随机结束<input name="random_window_end" type="time" value="22:30"></label>
        <label>时区<input name="timezone" value="Asia/Shanghai"></label>
        <label>机器人<select name="bot_id" id="taskBotSelect"></select></label>
        <label>投递<select name="delivery_channel"><option value="wechat">微信</option><option value="tavern">酒馆</option></select></label>
        <label class="wide">日程内容<input name="task" placeholder="学习 Python 45 分钟" required></label>
        <label class="wide">消息判断逻辑<input name="suggested_first_step" placeholder="结合当前时间、上次对话和用户状态，判断是否轻提醒或收尾"></label>
        <label>参考情绪<input name="intent" value="温和提醒，仅供参考"></label>
        <label class="wide">星期
          <div class="days" id="dayInputs"></div>
          <div class="quick-row">
            <button class="secondary" type="button" data-preset="all">全选</button>
            <button class="secondary" type="button" data-preset="workday">工作日</button>
            <button class="secondary" type="button" data-preset="weekend">周末</button>
            <button class="soft-blue" type="button" data-preset="invert">反选</button>
            <button class="soft-blue" type="button" data-preset="none">清空</button>
          </div>
        </label>
        <div class="followup-panel">
          <label class="switch-label"><input type="checkbox" name="followup_enabled"> 未回复后续提醒</label>
          <label>等待分钟<input name="followup_delay_minutes" type="number" min="1" value="30"></label>
          <label>后续日程内容<input name="followup_task" placeholder="半小时没回复，判断用户可能还没起床，补发一两条"></label>
          <label class="wide">后续消息判断逻辑<input name="followup_suggested_first_step" placeholder="如果用户未回复，结合早起任务判断：可能没醒、忘回、或不方便看手机"></label>
          <label>后续参考情绪<input name="followup_intent" value="稍微担心，仅供参考"></label>
        </div>
        <button type="submit">保存任务</button>
      </form>
    </section>
    <section>
      <h2>一周任务表</h2>
      <div class="week-wrap">
        <table class="week">
          <thead><tr id="weekHead"></tr></thead>
          <tbody><tr id="weekRow"></tr></tbody>
        </table>
      </div>
    </section>
    <section>
      <h2>配置</h2>
      <pre class="mono" id="config"></pre>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const weekdays = [
      { id: 1, label: '周一' },
      { id: 2, label: '周二' },
      { id: 3, label: '周三' },
      { id: 4, label: '周四' },
      { id: 5, label: '周五' },
      { id: 6, label: '周六' },
      { id: 7, label: '周日' },
    ];

    async function api(path, options) {
      const res = await fetch(path, options);
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
      return data;
    }

    function renderDayInputs() {
      $('dayInputs').innerHTML = weekdays.map(day =>
        '<label class="day-check"><input type="checkbox" name="days" value="' + day.id + '" checked>' + day.label + '</label>'
      ).join('');
      $('weekHead').innerHTML = weekdays.map(day =>
        '<th><div class="day-head"><span>' + day.label + '</span><button class="secondary" data-action="new-day" data-day="' + day.id + '">添加</button></div></th>'
      ).join('');
    }

    function botOptions(bots) {
      const items = bots?.length ? bots : [{ id: 'default', name: '默认机器人' }];
      return items.map(bot => '<option value="' + escapeHtml(bot.id) + '">' + escapeHtml(bot.name || bot.id) + ' (' + escapeHtml(bot.id) + ')</option>').join('');
    }

    function accountOptions(accounts) {
      const prefix = '<option value="">使用当前默认账号</option>';
      return prefix + (accounts || []).map(account =>
        '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.id) + (account.user_id ? ' · ' + escapeHtml(account.user_id) : '') + '</option>'
      ).join('');
    }

    async function refresh() {
      const data = await api('/api/status');
      $('updated').textContent = '刷新: ' + new Date().toLocaleTimeString();
      $('modeToggle').dataset.mode = data.delivery?.message_mode || 'split';
      $('modeToggle').textContent = '发送模式: ' + (data.delivery?.message_mode === 'split' ? '按 <message> 分条' : '合并成一条');
      $('mergeWindowMs').value = data.wechat?.inbound_merge_window_ms ?? 10000;
      $('metrics').innerHTML = Object.entries(data.queues).map(([k, v]) =>
        '<div class="metric"><span>' + k + '</span><b>' + v + '</b></div>'
      ).join('');
      $('taskBotSelect').innerHTML = botOptions(data.bots || []);
      $('botAccountSelect').innerHTML = accountOptions(data.wechat_accounts || []);
      renderBotList(data.bots || []);
      renderWeek(data.tasks || []);
      await loadReplyRecords();
      $('config').textContent = JSON.stringify({
        config_path: data.config_path,
        connector_dir: data.connector_dir,
        default_target: data.default_target,
        wechat: data.wechat,
        wechat_accounts: data.wechat_accounts,
        bots: data.bots,
        delivery: data.delivery,
        random_task_times: data.random_task_times,
      }, null, 2);
    }

    function renderBotList(bots) {
      $('botList').innerHTML = bots.length ? bots.map(renderBotCard).join('') : '<div class="empty">暂无机器人绑定。保存一个绑定后，任务里就能从下拉框选择它。</div>';
    }

    function renderBotCard(bot) {
      const id = encodeURIComponent(bot.id);
      return '<div class="bot-card ' + (bot.enabled === false ? 'paused' : '') + '">' +
        '<div class="bot-title">' + escapeHtml(bot.name || bot.id) + ' · ' + escapeHtml(bot.id) + '</div>' +
        '<div class="bot-meta">微信账号: ' + escapeHtml(bot.wechat_account_id || '默认') + '<br>联系人: ' + escapeHtml(bot.wechat_scope_id || '未设置') + '<br>角色: ' + escapeHtml(bot.target_character || '当前角色') + '</div>' +
        '<div class="actions">' +
          '<button class="secondary" data-bot-action="edit" data-id="' + id + '">编辑</button>' +
          '<button class="danger" data-bot-action="delete" data-id="' + id + '">删除</button>' +
        '</div>' +
      '</div>';
    }

    function renderWeek(tasks) {
      const sorted = [...tasks].sort((a, b) => displayTaskTime(a).localeCompare(displayTaskTime(b)));
      $('weekRow').innerHTML = weekdays.map(day => {
        const dayTasks = sorted.filter(task => task.days?.length ? task.days.includes(day.id) : true);
        const body = dayTasks.length ? dayTasks.map(renderTaskCard).join('') : '<div class="empty">无任务</div>';
        return '<td data-day="' + day.id + '">' + body + '</td>';
      }).join('');
    }

    function renderTaskCard(task) {
      const id = encodeURIComponent(task.id);
      const enabled = task.enabled !== false;
      return '<div class="task-card ' + (enabled ? '' : 'paused') + '">' +
        '<div class="task-time">' + escapeHtml(displayTaskTime(task)) + ' · ' + (enabled ? '启用' : '暂停') + '</div>' +
        '<div class="task-title">' + escapeHtml(task.task || '') + '</div>' +
        '<div class="task-meta">' + escapeHtml(task.id || '') + (task.bot_id ? ' · bot=' + escapeHtml(task.bot_id) : '') + '<br>' + escapeHtml(task.intent || '') + renderFollowupMeta(task) + '</div>' +
        '<div class="actions">' +
          '<button class="secondary" data-action="edit" data-id="' + id + '">编辑</button>' +
          '<button class="secondary" data-action="duplicate" data-id="' + id + '">复制</button>' +
          '<label class="task-switch" title="启用或暂停"><input type="checkbox" data-action="toggle-enabled" data-id="' + id + '"' + (enabled ? ' checked' : '') + '><span></span>' + (enabled ? '启用' : '暂停') + '</label>' +
          '<button class="danger" data-action="delete" data-id="' + id + '">删除</button>' +
        '</div>' +
      '</div>';
    }

    function displayTaskTime(task) {
      if (task.schedule_mode === 'daily_random') {
        return (task.random_window_start || '09:00') + '-' + (task.random_window_end || '22:30') + ' 随机';
      }
      return task.time || '--:--';
    }

    function renderFollowupMeta(task) {
      const followup = task.followups?.find(item => item.enabled);
      return followup ? '<br>未回复 ' + escapeHtml(followup.delay_minutes) + ' 分钟后补发' : '';
    }

    async function loadReplyRecords() {
      const data = await api('/api/replies?limit=30');
      const records = data.replies || [];
      $('replyRecords').innerHTML = records.length ? records.map(renderReplyRecord).join('') : '<div class="empty">暂无发送记录</div>';
    }

    function renderReplyRecord(record) {
      const canRetry = record.queue === 'failed' || record.queue === 'deferred';
      const retryButton = canRetry
        ? '<button class="secondary" data-reply-action="retry" data-queue="' + escapeHtml(record.queue) + '" data-file="' + escapeHtml(record.file) + '">重发</button>'
        : '';
      return '<div class="record">' +
        '<div class="record-queue">' + queueLabel(record.queue) + '</div>' +
        '<div class="record-main">' +
          '<div class="record-title">' + escapeHtml(record.event_id || record.file) + '</div>' +
          '<div class="record-preview">' + escapeHtml(record.text_preview || record.error || '') + '</div>' +
          '<div class="record-meta">' + escapeHtml(new Date(record.updated_at).toLocaleString()) + (record.error ? ' · ' + escapeHtml(record.error) : '') + '</div>' +
        '</div>' +
        '<div class="actions">' + retryButton + '</div>' +
      '</div>';
    }

    function queueLabel(queue) {
      return ({ outbox: '待发', deferred: '延迟', failed: '失败', sent: '已发送' })[queue] || queue;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    async function toggleTask(id) { await api('/api/tasks/' + id + '/toggle', { method: 'POST' }); refresh(); }
    async function deleteTask(id) { await api('/api/tasks/' + id, { method: 'DELETE' }); refresh(); }
    async function deleteBot(id) { await api('/api/bots/' + id, { method: 'DELETE' }); refresh(); }
    async function retryReply(queue, file) {
      await api('/api/replies/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue, file }),
      });
      refresh();
    }
    async function clearQueue(queue) {
      if (!window.confirm('确定清理 ' + queue + ' 队列吗？')) return;
      await api('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue }),
      });
      refresh();
    }
    async function toggleDeliveryMode() {
      const current = $('modeToggle').dataset.mode === 'single' ? 'single' : 'split';
      await api('/api/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_mode: current === 'split' ? 'single' : 'split' }),
      });
      refresh();
    }

    async function saveMergeWindow() {
      const value = Number.parseInt($('mergeWindowMs').value || '0', 10);
      await api('/api/wechat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbound_merge_window_ms: Number.isFinite(value) && value >= 0 ? value : 0 }),
      });
      refresh();
    }

    function setField(form, name, value) {
      const field = form.elements.namedItem(name);
      if (field) field.value = value;
    }

    function setChecked(form, name, value) {
      const field = form.elements.namedItem(name);
      if (field) field.checked = Boolean(value);
    }

    async function loadBotForEdit(id) {
      const data = await api('/api/status');
      const bot = (data.bots || []).find(item => item.id === id);
      if (!bot) return;
      const form = $('botForm');
      setField(form, 'id', bot.id || '');
      setField(form, 'name', bot.name || '');
      setField(form, 'wechat_account_id', bot.wechat_account_id || '');
      setField(form, 'enabled', bot.enabled === false ? 'false' : 'true');
      setField(form, 'wechat_scope_id', bot.wechat_scope_id || '');
      setField(form, 'target_character', bot.target_character || '');
      setField(form, 'conversation_id', bot.conversation_id || '');
      setField(form, 'language', bot.language || 'zh-CN');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function loadTaskForEdit(id) {
      const data = await api('/api/status');
      const task = (data.tasks || []).find(item => item.id === id);
      if (!task) return;
      const form = $('taskForm');
      setField(form, 'id', task.id || '');
      setField(form, 'time', task.time || '20:00');
      setField(form, 'schedule_mode', task.schedule_mode || 'fixed');
      setField(form, 'random_window_start', task.random_window_start || '09:00');
      setField(form, 'random_window_end', task.random_window_end || '22:30');
      setField(form, 'timezone', task.timezone || 'Asia/Shanghai');
      setField(form, 'bot_id', task.bot_id || '');
      setField(form, 'intent', task.intent || '温和提醒，仅供参考');
      setField(form, 'task', task.task || '');
      setField(form, 'suggested_first_step', task.suggested_first_step || '');
      setField(form, 'delivery_channel', task.delivery_channel || 'wechat');
      const followup = task.followups?.find(item => item.enabled);
      setChecked(form, 'followup_enabled', Boolean(followup));
      setField(form, 'followup_delay_minutes', followup?.delay_minutes || 30);
      setField(form, 'followup_task', followup?.task || '');
      setField(form, 'followup_suggested_first_step', followup?.suggested_first_step || '');
      setField(form, 'followup_intent', followup?.intent || '稍微担心，仅供参考');
      const selected = task.days?.length ? task.days : weekdays.map(day => day.id);
      form.querySelectorAll('input[name="days"]').forEach(input => { input.checked = selected.includes(Number(input.value)); });
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function duplicateTask(id) {
      await loadTaskForEdit(id);
      const form = $('taskForm');
      const suffix = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      setField(form, 'id', id + '_copy_' + suffix);
      form.elements.namedItem('id')?.focus();
    }

    function selectDays(days) {
      const selected = new Set(days);
      $('taskForm').querySelectorAll('input[name="days"]').forEach(input => {
        input.checked = selected.has(Number(input.value));
      });
    }

    function startTaskForDay(day) {
      const form = $('taskForm');
      form.reset();
      setField(form, 'time', '20:00');
      setField(form, 'schedule_mode', 'fixed');
      setField(form, 'random_window_start', '09:00');
      setField(form, 'random_window_end', '22:30');
      setField(form, 'timezone', 'Asia/Shanghai');
      setField(form, 'bot_id', '');
      setField(form, 'intent', '温和提醒，仅供参考');
      setField(form, 'delivery_channel', 'wechat');
      setField(form, 'followup_delay_minutes', '30');
      setField(form, 'followup_intent', '稍微担心，仅供参考');
      selectDays([Number(day)]);
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.namedItem('task')?.focus();
    }

    $('refresh').onclick = refresh;
    $('modeToggle').onclick = toggleDeliveryMode;
    $('saveMergeWindow').onclick = saveMergeWindow;
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-reply-action]');
      if (!button) return;
      if (button.dataset.replyAction === 'retry') {
        await retryReply(button.dataset.queue, button.dataset.file);
      }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-clear-queue]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      await clearQueue(button.dataset.clearQueue);
    });
    document.addEventListener('click', async (event) => {
      if (event.target.closest('button[data-refresh-records]')) {
        event.preventDefault();
        event.stopPropagation();
        await loadReplyRecords();
      }
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (action === 'delete') await deleteTask(id);
      if (action === 'edit') await loadTaskForEdit(decodeURIComponent(id));
      if (action === 'duplicate') await duplicateTask(decodeURIComponent(id));
      if (action === 'new-day') startTaskForDay(button.dataset.day);
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-bot-action]');
      if (!button) return;
      const id = decodeURIComponent(button.dataset.id);
      if (button.dataset.botAction === 'edit') await loadBotForEdit(id);
      if (button.dataset.botAction === 'delete') {
        if (window.confirm('确定删除机器人绑定 ' + id + ' 吗？')) await deleteBot(encodeURIComponent(id));
      }
    });
    document.addEventListener('change', async (event) => {
      const input = event.target.closest('input[data-action="toggle-enabled"]');
      if (!input) return;
      await toggleTask(input.dataset.id);
    });
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-preset]');
      if (!button) return;
      const preset = button.dataset.preset;
      if (preset === 'all') selectDays([1, 2, 3, 4, 5, 6, 7]);
      if (preset === 'workday') selectDays([1, 2, 3, 4, 5]);
      if (preset === 'weekend') selectDays([6, 7]);
      if (preset === 'invert') {
        $('taskForm').querySelectorAll('input[name="days"]').forEach(input => { input.checked = !input.checked; });
      }
      if (preset === 'none') selectDays([]);
    });

    $('resetBotForm').onclick = () => {
      $('botForm').reset();
      setField($('botForm'), 'language', 'zh-CN');
      setField($('botForm'), 'enabled', 'true');
    };

    $('botForm').onsubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const body = Object.fromEntries(formData.entries());
      body.enabled = body.enabled !== 'false';
      await api('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      event.target.reset();
      setField(event.target, 'language', 'zh-CN');
      setField(event.target, 'enabled', 'true');
      refresh();
    };

    $('taskForm').onsubmit = async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const body = Object.fromEntries(formData.entries());
      body.days = formData.getAll('days').map(Number);
      body.followup_enabled = formData.get('followup_enabled') === 'on';
      await api('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      event.target.reset();
      setField(event.target, 'time', '20:00');
      setField(event.target, 'schedule_mode', 'fixed');
      setField(event.target, 'random_window_start', '09:00');
      setField(event.target, 'random_window_end', '22:30');
      setField(event.target, 'timezone', 'Asia/Shanghai');
      setField(event.target, 'bot_id', 'default');
      setField(event.target, 'intent', '温和提醒，仅供参考');
      setField(event.target, 'followup_delay_minutes', '30');
      setField(event.target, 'followup_intent', '稍微担心，仅供参考');
      setChecked(event.target, 'followup_enabled', false);
      event.target.querySelectorAll('input[name="days"]').forEach(input => { input.checked = true; });
      refresh();
    };

    renderDayInputs();
    refresh();
  </script>
</body>
</html>`;
}
