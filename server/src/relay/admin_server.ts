import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { UiautoClient } from '../platforms/weixin/uiauto_client.js';
import { UiautoVmClient } from '../platforms/weixin/uiauto_vm_client.js';
import { WeixinAccountStore } from '../platforms/weixin/account_store.js';
import { DEFAULT_ILINK_BOT_TYPE, officialQrLogin, type OfficialQrLoginCredentials } from '../platforms/weixin/official/login.js';
import {
  DEFAULT_AGENDA_ENTRY_FORMAT,
  DEFAULT_AGENDA_SYSTEM_PROMPT,
  DEFAULT_AGENDA_USER_PROMPT_TEMPLATE,
  formatAgendaEntryText,
  normalizeAgendaParser,
  normalizeUiautoAccounts,
  normalizeWechatTransport,
  normalizeModelApi,
  saveTavernRelayConfig,
  type TavernAgendaEntry,
  type TavernUiautoAccountConfig,
  type TavernBotConfig,
  type TavernModelApiConfig,
  type TavernRelayConfig,
  type TavernTaskConfig,
} from './config.js';
import { parseAgendaInput } from './agenda_parser.js';
import { renderRelayAdminHtml } from './admin_ui.js';
import type { RelayEvent } from './protocol.js';
import type { TavernFileConnector } from './tavern_connector.js';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode') as {
  toDataURL(text: string, options?: Record<string, unknown>): Promise<string>;
};

interface OpenClawLoginSession {
  id: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  qrcode: string;
  qrcodeImageContent: string;
  qrcodeDataUrl: string;
  account?: OfficialQrLoginCredentials;
  error?: string;
  done: boolean;
}

const openClawLoginSessions = new Map<string, OpenClawLoginSession>();

interface AgendaContextAttachment {
  name: string;
  type: string;
  size: number;
  data_url?: string;
  text?: string;
}

export interface RelayAdminServerOptions {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateDir: string;
  triggerTask: (task: TavernTaskConfig) => Promise<RelayEvent>;
  onConfigChanged?: () => void;
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
    sendHtml(res, renderRelayAdminHtml());
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
  if (req.method === 'POST' && url.pathname === '/api/channel-mode') {
    const body = await readJson(req);
    const mode = String(body.mode || '').trim().toLowerCase();
    const transport = mode === 'uiauto' || mode === 'uiauto_vm' ? 'uiauto' : 'openclaw';
    applyGlobalWechatTransport(options.config, transport);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, {
      ok: true,
      mode: transport === 'uiauto' ? 'uiauto' : 'openclaw',
      wechat_transport: transport,
      bots: options.config.bots,
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/openclaw-login/start') {
    const body = await readJson(req);
    const session = startOpenClawLogin({
      stateDir: options.stateDir,
      botType: String(body.bot_type || DEFAULT_ILINK_BOT_TYPE).trim() || DEFAULT_ILINK_BOT_TYPE,
      timeoutSeconds: Number.parseInt(String(body.timeout_seconds || '480'), 10) || 480,
      onAccount: (account) => {
        bindOpenClawAccountToBot(options.config, account.account_id);
        saveTavernRelayConfig(options.config);
        options.onConfigChanged?.();
      },
    });
    sendJson(res, 200, publicOpenClawLoginSession(session));
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/openclaw-login/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const session = openClawLoginSessions.get(id);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'OpenClaw login session not found.' });
      return;
    }
    sendJson(res, 200, publicOpenClawLoginSession(session));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/model-api') {
    const body = await readJson(req);
    options.config.model_api = normalizeModelApi({
      enabled: body.enabled === true || body.enabled === 'true' || body.enabled === 'on',
      name: String(body.name || '').trim(),
      base_url: String(body.base_url || '').trim(),
      api_key: String(body.api_key || options.config.model_api.api_key || '').trim(),
      model: String(body.model || '').trim(),
      temperature: Number.parseFloat(String(body.temperature ?? '0.1')),
      top_p: Number.parseFloat(String(body.top_p ?? '1')),
      timeout_ms: Number.parseInt(String(body.timeout_ms ?? '60000'), 10),
      protocol: 'openai_chat_completions',
    }, options.config.model_api);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, model_api: publicModelApiConfig(options.config) });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/model-api/models') {
    const body = await readJson(req);
    const modelApi = normalizeModelApi({
      ...options.config.model_api,
      enabled: true,
      name: String(body.name || options.config.model_api.name || '').trim(),
      base_url: String(body.base_url || options.config.model_api.base_url || '').trim(),
      api_key: String(body.api_key || options.config.model_api.api_key || '').trim(),
      model: String(body.model || options.config.model_api.model || '').trim(),
      timeout_ms: Number.parseInt(String(body.timeout_ms ?? options.config.model_api.timeout_ms ?? '60000'), 10),
      protocol: 'openai_chat_completions',
    }, options.config.model_api);
    if (!modelApi.base_url) {
      sendJson(res, 400, { ok: false, error: 'Base URL is required before loading models.' });
      return;
    }
    const models = await listModelApiModels(modelApi);
    sendJson(res, 200, { ok: true, models });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/agenda/parser') {
    const body = await readJson(req);
    options.config.agenda.parser = normalizeAgendaParser({
      enabled: body.enabled !== false && body.enabled !== 'false',
      timezone: String(body.timezone || '').trim(),
      entry_format: String(body.entry_format || DEFAULT_AGENDA_ENTRY_FORMAT).trim(),
      system_prompt: String(body.system_prompt || DEFAULT_AGENDA_SYSTEM_PROMPT).trim(),
      user_prompt_template: String(body.user_prompt_template || DEFAULT_AGENDA_USER_PROMPT_TEMPLATE).trim(),
    }, options.config.agenda.parser);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, parser: options.config.agenda.parser });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/agenda/parse') {
    const body = await readJson(req);
    const result = await parseAgendaInput({ config: options.config, text: String(body.text || '') });
    if (body.save_entries === true && result.entries.length) {
      options.config.agenda.entries = mergeAgendaEntries(options.config.agenda.entries, result.entries);
      saveTavernRelayConfig(options.config);
    }
    sendJson(res, 200, {
      ok: true,
      source: result.source,
      entries: result.entries,
      saved_entries: options.config.agenda.entries,
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/agenda/context-chat') {
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    const attachments = normalizeContextAttachments(body.attachments);
    if (!text && attachments.length === 0) {
      sendJson(res, 400, { ok: false, error: 'Text or attachment is required.' });
      return;
    }
    const reply = await callAgendaContextModel(options.config, text, attachments);
    sendJson(res, 200, { ok: true, reply, attachments });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/agenda/entries') {
    const body = await readJson(req);
    const entry = normalizeAgendaEntry(body);
    options.config.agenda.entries = mergeAgendaEntries(options.config.agenda.entries, [entry]);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, entry, entries: options.config.agenda.entries });
    return;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/agenda/entries/')) {
    const id = decodeURIComponent(url.pathname.split('/')[4] || '');
    options.config.agenda.entries = options.config.agenda.entries.filter((entry) => entry.id !== id);
    saveTavernRelayConfig(options.config);
    sendJson(res, 200, { ok: true, entries: options.config.agenda.entries });
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
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true, bot });
    return;
  }
  if (req.method === 'POST' && (url.pathname === '/api/uiauto-accounts' || url.pathname === '/api/alt-wechat-accounts')) {
    const body = await readJson(req);
    const account = normalizeUiautoAccount(body);
    const existingIndex = options.config.uiauto_accounts.findIndex((item) => item.id === account.id);
    if (existingIndex >= 0) {
      options.config.uiauto_accounts[existingIndex] = { ...options.config.uiauto_accounts[existingIndex], ...account };
    } else {
      options.config.uiauto_accounts.push(account);
    }
    options.config.uiauto_accounts = normalizeUiautoAccounts(options.config.uiauto_accounts, []);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true, account });
    return;
  }
  if (req.method === 'POST' && /^\/api\/(?:uiauto|alt-wechat)-accounts\//u.test(url.pathname) && url.pathname.endsWith('/check')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const account = options.config.uiauto_accounts.find((item) => item.id === id);
    if (!account) {
      sendJson(res, 404, { ok: false, error: 'UIAuto account not found.' });
      return;
    }
    const client = createUiautoClient(account, options.stateDir);
    const device = await client.checkDevice();
    sendJson(res, device.ok ? 200 : 400, { ok: device.ok, account_id: account.id, device });
    return;
  }
  if (req.method === 'GET' && /^\/api\/(?:uiauto|alt-wechat)-accounts\//u.test(url.pathname) && url.pathname.endsWith('/sessions')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const account = options.config.uiauto_accounts.find((item) => item.id === id);
    if (!account) {
      sendJson(res, 404, { ok: false, error: 'UIAuto account not found.' });
      return;
    }
    const response = await fetch(`${String(account.worker_base_url || 'http://127.0.0.1:8795').replace(/\/+$/u, '')}/sessions`);
    const payload = await response.json() as { ok?: boolean; sessions?: unknown[]; error?: string };
    if (!response.ok || payload.ok === false) {
      sendJson(res, 400, { ok: false, error: payload.error || response.statusText });
      return;
    }
    const sessions = Array.isArray(payload.sessions)
      ? payload.sessions.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    if (account.owner_contact_name && !sessions.includes(account.owner_contact_name)) {
      sessions.unshift(account.owner_contact_name);
    }
    sendJson(res, 200, { ok: true, account_id: account.id, sessions });
    return;
  }
  if (req.method === 'DELETE' && /^\/api\/(?:uiauto|alt-wechat)-accounts\//u.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    options.config.uiauto_accounts = options.config.uiauto_accounts.filter((account) => account.id !== id);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && /^\/api\/wechat-accounts\//u.test(url.pathname) && url.pathname.endsWith('/bind')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const body = await readJson(req);
    const store = new WeixinAccountStore({ rootDir: path.join(options.stateDir, 'weixin', 'accounts') });
    if (!store.loadAccount(id)) {
      sendJson(res, 404, { ok: false, error: 'OpenClaw account not found.' });
      return;
    }
    const botId = String(body.bot_id || 'default').trim() || 'default';
    const bot = bindOpenClawAccountToBot(options.config, id, botId);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true, account_id: id, bot });
    return;
  }
  if (req.method === 'DELETE' && /^\/api\/wechat-accounts\//u.test(url.pathname)) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    const store = new WeixinAccountStore({ rootDir: path.join(options.stateDir, 'weixin', 'accounts') });
    const deleted = store.deleteAccount(id);
    for (const bot of options.config.bots) {
      if (bot.wechat_account_id === id) {
        bot.wechat_account_id = '';
        bot.wechat_token = '';
        bot.wechat_base_url = '';
      }
    }
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true, account_id: id, deleted });
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
    options.onConfigChanged?.();
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
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true, task });
    return;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/tasks/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    options.config.tasks = options.config.tasks.filter((task) => task.id !== id);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/bots/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3] || '');
    options.config.bots = options.config.bots.filter((bot) => bot.id !== id);
    saveTavernRelayConfig(options.config);
    options.onConfigChanged?.();
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
    uiauto_accounts: config.uiauto_accounts,
    uiauto_state: await readUiautoState(path.join(stateDir, 'relay', 'state.json')),
    delivery: config.delivery,
    tasks: config.tasks,
    model_api: publicModelApiConfig(config),
    agenda: config.agenda,
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
    date_key: String(body.date_key || existingTask?.date_key || '').trim() || undefined,
    created_at: existingTask?.created_at || String(body.created_at || '').trim() || new Date().toISOString(),
    timezone: String(body.timezone || 'Asia/Shanghai').trim(),
    intent: String(body.intent || '温和提醒，仅供参考').trim(),
    task,
    suggested_first_step: String(body.suggested_first_step || '').trim(),
    followups: normalizeFollowups(body),
    delivery_channel: body.delivery_channel === 'tavern' ? 'tavern' : 'wechat',
    wechat_transport: normalizeWechatTransport(body.wechat_transport ?? existingTask?.wechat_transport),
    target_character: String(body.target_character || '').trim() || undefined,
    conversation_id: String(body.conversation_id || '').trim() || undefined,
    language: String(body.language || '').trim() || undefined,
  };
}

function startOpenClawLogin({
  stateDir,
  botType,
  timeoutSeconds,
  onAccount,
}: {
  stateDir: string;
  botType: string;
  timeoutSeconds: number;
  onAccount?: (account: OfficialQrLoginCredentials) => void;
}): OpenClawLoginSession {
  const id = `openclaw_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const session: OpenClawLoginSession = {
    id,
    status: 'starting',
    startedAt: now,
    updatedAt: now,
    qrcode: '',
    qrcodeImageContent: '',
    qrcodeDataUrl: '',
    done: false,
  };
  openClawLoginSessions.set(id, session);
  const accountStore = new WeixinAccountStore({ rootDir: path.join(stateDir, 'weixin', 'accounts') });
  void officialQrLogin({
    accountStore,
    accountsDir: accountStore.rootDir,
    botType,
    timeoutSeconds: Math.max(60, Math.min(900, timeoutSeconds)),
    onQrCode: async ({ qrcode, qrcodeImageContent }) => {
      session.qrcode = qrcode;
      session.qrcodeImageContent = qrcodeImageContent;
      session.qrcodeDataUrl = await qrImageDataUrl(qrcode, qrcodeImageContent);
      session.status = 'wait';
      session.updatedAt = new Date().toISOString();
    },
    onStatus: ({ status }) => {
      session.status = status;
      session.updatedAt = new Date().toISOString();
    },
  }).then((account) => {
    session.done = true;
    session.updatedAt = new Date().toISOString();
    if (account) {
      session.status = 'confirmed';
      session.account = account;
      onAccount?.(account);
      return;
    }
    session.status = 'expired';
    session.error = 'OpenClaw login timed out or returned no credentials.';
  }).catch((error: unknown) => {
    session.done = true;
    session.status = 'error';
    session.updatedAt = new Date().toISOString();
    session.error = error instanceof Error ? error.message : String(error);
  });
  return session;
}

async function qrImageDataUrl(qrcode: string, qrcodeImageContent: string): Promise<string> {
  const content = String(qrcodeImageContent || '').trim();
  if (/^data:/u.test(content)) {
    return content;
  }
  if (/^<svg[\s>]/iu.test(content)) {
    return `data:image/svg+xml;base64,${Buffer.from(content, 'utf8').toString('base64')}`;
  }
  return QRCode.toDataURL(content || qrcode, {
    type: 'image/png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

function publicOpenClawLoginSession(session: OpenClawLoginSession): Record<string, unknown> {
  return {
    ok: true,
    id: session.id,
    status: session.status,
    started_at: session.startedAt,
    updated_at: session.updatedAt,
    qrcode: session.qrcode,
    qrcode_image: session.qrcodeDataUrl,
    done: session.done,
    error: session.error,
    account: session.account ? {
      account_id: session.account.account_id,
      base_url: session.account.base_url,
      user_id: session.account.user_id,
      has_token: Boolean(session.account.token),
    } : undefined,
  };
}

function publicModelApiConfig(config: TavernRelayConfig): Record<string, unknown> {
  return {
    ...config.model_api,
    api_key: undefined,
    has_api_key: Boolean(config.model_api.api_key),
  };
}

async function listModelApiModels(modelApi: TavernModelApiConfig): Promise<Array<Record<string, unknown>>> {
  if (!modelApi.base_url) {
    throw new Error('Base URL is required before loading models.');
  }
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch().');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), modelApi.timeout_ms ?? 60_000);
  try {
    const response = await fetchImpl(modelListUrl(modelApi.base_url), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(modelApi.api_key ? { Authorization: `Bearer ${modelApi.api_key}` } : {}),
      },
    });
    const payload = await response.json() as {
      data?: Array<{ id?: unknown; owned_by?: unknown; created?: unknown }>;
      models?: Array<{ id?: unknown; name?: unknown } | string>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(modelApiErrorMessage(response.status, payload.error?.message || response.statusText));
    }
    const rawModels = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    const seen = new Set<string>();
    return rawModels
      .map((item) => {
        if (typeof item === 'string') {
          return { id: item };
        }
        const id = String(item.id || item.name || '').trim();
        return {
          id,
          owned_by: item.owned_by ? String(item.owned_by) : undefined,
          created: item.created,
        };
      })
      .filter((item) => {
        const id = String(item.id || '').trim();
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  } finally {
    clearTimeout(timer);
  }
}

function modelListUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/u, '');
  if (trimmed.endsWith('/models')) {
    return trimmed;
  }
  if (trimmed.endsWith('/chat/completions')) {
    return `${trimmed.slice(0, -'/chat/completions'.length)}/models`;
  }
  return `${trimmed}/models`;
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

function normalizeContextAttachments(raw: unknown): AgendaContextAttachment[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .slice(0, 6)
    .map((item): AgendaContextAttachment | null => {
      const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const name = String(source.name || '').trim().slice(0, 180);
      const type = String(source.type || 'application/octet-stream').trim().slice(0, 120);
      const size = Number(source.size || 0);
      const dataUrl = String(source.data_url || '').trim();
      const text = String(source.text || '').trim();
      if (!name) {
        return null;
      }
      return {
        name,
        type,
        size: Number.isFinite(size) && size >= 0 ? size : 0,
        data_url: dataUrl.startsWith('data:') && dataUrl.length <= 8_000_000 ? dataUrl : undefined,
        text: text ? text.slice(0, 24_000) : undefined,
      };
    })
    .filter((item): item is AgendaContextAttachment => Boolean(item));
}

async function callAgendaContextModel(
  config: TavernRelayConfig,
  text: string,
  attachments: AgendaContextAttachment[],
): Promise<string> {
  if (!config.model_api.enabled || !config.model_api.base_url || !config.model_api.model) {
    throw new Error('Model API is not configured.');
  }
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js runtime does not provide fetch().');
  }
  const attachmentSummary = attachments.length
    ? attachments.map((file, index) => `${index + 1}. ${file.name} (${file.type || 'unknown'}, ${file.size || 0} bytes)`).join('\n')
    : 'None';
  const textBodies = attachments
    .filter((file) => file.text)
    .map((file) => `\n[${file.name}]\n${file.text}`)
    .join('\n');
  const prompt = [
    '请把用户提供的行程上下文整理成可执行、可保存的日程理解。',
    '如果里面包含明确日期和事项，请用“x月x日，用户/角色约定事项：……”格式列出候选项。',
    '如果信息不够明确，请先指出缺失内容，不要编造日期。',
    '',
    `用户输入：${text || '(无文字输入)'}`,
    '',
    `附件：\n${attachmentSummary}`,
    textBodies ? `\n文本附件内容：${textBodies}` : '',
  ].join('\n');
  const imageParts = attachments
    .filter((file) => file.data_url && /^image\//i.test(file.type))
    .map((file) => ({ type: 'image_url', image_url: { url: file.data_url } }));
  const userContent = imageParts.length
    ? [{ type: 'text', text: prompt }, ...imageParts]
    : prompt;
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
          { role: 'system', content: '你是一个后台日程上下文整理助手，输出简洁、可核对、不要自动保存。' },
          { role: 'user', content: userContent },
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

function mergeAgendaEntries(existing: TavernAgendaEntry[], incoming: TavernAgendaEntry[]): TavernAgendaEntry[] {
  const byKey = new Map<string, TavernAgendaEntry>();
  for (const entry of existing) {
    byKey.set(agendaEntryKey(entry), entry);
  }
  for (const entry of incoming) {
    byKey.set(agendaEntryKey(entry), entry);
  }
  return Array.from(byKey.values())
    .sort((a, b) => String(a.date_key || a.date_text).localeCompare(String(b.date_key || b.date_text)));
}

function normalizeAgendaEntry(body: Record<string, unknown>): TavernAgendaEntry {
  const dateText = String(body.date_text || '').trim();
  const item = String(body.item || '').trim();
  if (!dateText || !item) {
    throw new Error('date_text and item are required.');
  }
  const owner = body.owner === 'character' ? 'character' : 'user';
  const entry = {
    id: String(body.id || `agenda_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`).trim(),
    date_text: dateText,
    date_key: String(body.date_key || '').trim() || undefined,
    owner,
    item,
    text: '',
    source_text: String(body.source_text || '').trim() || undefined,
    created_at: String(body.created_at || '').trim() || new Date().toISOString(),
  } satisfies TavernAgendaEntry;
  entry.text = String(body.text || formatAgendaEntryText(entry)).trim();
  return entry;
}

function agendaEntryKey(entry: TavernAgendaEntry): string {
  return [entry.date_key || entry.date_text, entry.owner, entry.item].join('\u0000');
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
    wechat_transport: normalizeWechatTransport(body.wechat_transport),
    target_character: String(body.target_character || config.default_target.target_character || '').trim(),
    conversation_id: String(body.conversation_id || config.default_target.conversation_id || '').trim(),
    language: String(body.language || config.default_target.language || 'zh-CN').trim(),
  };
}

function applyGlobalWechatTransport(
  config: TavernRelayConfig,
  transport: NonNullable<TavernBotConfig['wechat_transport']>,
): void {
  if (!config.bots.length) {
    config.bots.push({
      id: 'default',
      enabled: true,
      name: 'Default',
      wechat_scope_id: config.wechat.default_scope_id,
      wechat_transport: transport,
      target_character: config.default_target.target_character,
      conversation_id: config.default_target.conversation_id,
      language: config.default_target.language,
    });
    return;
  }
  for (const bot of config.bots) {
    bot.wechat_transport = transport;
  }
}

function bindOpenClawAccountToBot(
  config: TavernRelayConfig,
  accountId: string,
  botId = 'default',
): TavernBotConfig {
  const normalizedBotId = String(botId || 'default').trim() || 'default';
  let bot = config.bots.find((item) => item.id === normalizedBotId)
    ?? config.bots.find((item) => item.wechat_transport === 'openclaw' || item.wechat_transport === 'auto')
    ?? config.bots[0];
  if (!bot) {
    bot = {
      id: normalizedBotId,
      enabled: true,
      name: normalizedBotId === 'default' ? 'Default' : normalizedBotId,
      wechat_scope_id: config.wechat.default_scope_id,
      target_character: config.default_target.target_character,
      conversation_id: config.default_target.conversation_id,
      language: config.default_target.language,
    };
    config.bots.push(bot);
  }
  bot.enabled = bot.enabled !== false;
  bot.wechat_transport = 'openclaw';
  bot.wechat_account_id = accountId;
  bot.wechat_token = '';
  bot.wechat_base_url = '';
  if (!bot.wechat_scope_id) {
    bot.wechat_scope_id = config.wechat.default_scope_id;
  }
  return bot;
}

function normalizeUiautoAccount(body: Record<string, unknown>): TavernUiautoAccountConfig {
  const id = String(body.id || '').trim();
  if (!id) {
    throw new Error('uiauto account id is required.');
  }
  const ownerContactName = String(body.owner_contact_name || '').trim();
  if (!ownerContactName) {
    throw new Error('owner_contact_name is required.');
  }
  const pollIntervalMs = Number.parseInt(String(body.poll_interval_ms ?? '1000'), 10);
  return {
    id,
    enabled: body.enabled !== false && body.enabled !== 'false',
    worker_base_url: String(body.worker_base_url || 'http://127.0.0.1:8795').trim() || 'http://127.0.0.1:8795',
    owner_contact_name: ownerContactName,
    bot_id: String(body.bot_id || 'default').trim() || 'default',
    target_character: String(body.target_character || '').trim() || undefined,
    conversation_id: String(body.conversation_id || '').trim() || undefined,
    language: String(body.language || '').trim() || undefined,
    poll_interval_ms: Number.isFinite(pollIntervalMs) ? Math.max(500, Math.min(60_000, pollIntervalMs)) : 1_000,
  };
}

function createUiautoClient(account: TavernUiautoAccountConfig, _stateDir: string): UiautoClient {
  return new UiautoVmClient(account);
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

async function readUiautoState(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as { uiauto?: Record<string, unknown>; altWechat?: Record<string, unknown> };
    if (parsed.uiauto && typeof parsed.uiauto === 'object') {
      return parsed.uiauto;
    }
    return parsed.altWechat && typeof parsed.altWechat === 'object' ? parsed.altWechat : {};
  } catch {
    return {};
  }
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
  const allowed = new Set(['outbox', 'failed', 'deferred', 'sent', 'processed']);
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
