import path from 'node:path';
import { WeixinSendError, WeixinTextClient, type WeixinInboundText } from '../platforms/weixin/text_client.js';
import { startRelayAdminServer } from './admin_server.js';
import { loadTavernRelayConfig, type TavernBotConfig, type TavernRelayConfig, type TavernTaskConfig } from './config.js';
import { localDateKey, makeEventId, nowIso, PROTOCOL, SCHEMA_VERSION, type RelayEvent } from './protocol.js';
import { dueTasks } from './scheduler.js';
import { RelayStateStore } from './state_store.js';
import { TavernFileConnector, type TavernReply } from './tavern_connector.js';

export interface RelayServiceOptions {
  stateDir: string;
  cwd?: string | null;
}

interface BotRuntime {
  bot: TavernBotConfig;
  weixin: WeixinTextClient;
  syncCursor: string;
}

interface InboundBuffer {
  runtime: BotRuntime;
  target: string;
  events: WeixinInboundText[];
  dueAt: number;
}

export async function runRelayService(options: RelayServiceOptions): Promise<void> {
  const stateDir = path.resolve(options.stateDir);
  const config = loadTavernRelayConfig({ stateDir });
  syncDeliveryEnv(config);
  const connector = new TavernFileConnector(config.connector_dir, config.poll_interval_ms);
  const stateStore = new RelayStateStore(path.join(stateDir, 'relay', 'state.json'));
  const runtimes = createBotRuntimes(config, stateDir);

  await connector.ensureReady();
  for (const runtime of runtimes) {
    runtime.weixin.start();
    runtime.syncCursor = runtime.weixin.loadSyncCursor();
  }

  let stopping = false;
  const inboundBuffers = new Map<string, InboundBuffer>();
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });

  log(`connector_dir=${config.connector_dir}`);
  log(`bots=${runtimes.map((runtime) => `${runtime.bot.id}:${runtime.weixin.config.accountId || 'no-account'}`).join(', ')}`);
  await startRelayAdminServer({
    config,
    connector,
    stateDir,
    triggerTask: async (task) => {
      const runtime = runtimeForTask(runtimes, task);
      const event = buildTaskEvent(config, runtime.bot, task);
      await connector.writeEvent(event);
      log(`manual task ${task.id} [${runtime.bot.id}] -> ${event.event_id}`);
      return event;
    },
  });

  while (!stopping) {
    await emitDueTasks({ config, connector, stateStore, runtimes });
    await emitDueFollowups({ config, connector, stateStore, runtimes });
    await deliverReadyOutboxReplies({ config, connector, runtimes });
    for (const runtime of runtimes) {
      const result = await runtime.weixin.pollOnce(runtime.syncCursor);
      runtime.syncCursor = result.syncCursor;
      runtime.weixin.saveSyncCursor(runtime.syncCursor);
      for (const event of result.events) {
        log(`inbound wechat ${event.messageId} [${runtime.bot.id}] <- ${event.externalScopeId}: ${preview(event.text)}`);
        cancelPendingFollowupsForTarget({ stateStore, botId: runtime.bot.id, target: event.externalScopeId });
        await deliverDeferredReplies({ connector, weixin: runtime.weixin, botId: runtime.bot.id, target: event.externalScopeId });
        await enqueueInbound({ buffers: inboundBuffers, inbound: event, config, connector, runtime });
      }
    }
    await flushDueInboundBuffers({ buffers: inboundBuffers, config, connector, runtimes });
    await sleep(config.wechat_poll_interval_ms);
  }
}

function createBotRuntimes(config: TavernRelayConfig, stateDir: string): BotRuntime[] {
  const bots = activeBots(config);
  return bots.map((bot) => {
    const env = {
      ...process.env,
      ...(bot.wechat_account_id ? { WEIXIN_ACCOUNT_ID: bot.wechat_account_id } : {}),
      ...(bot.wechat_token ? { WEIXIN_TOKEN: bot.wechat_token } : {}),
      ...(bot.wechat_base_url ? { WEIXIN_BASE_URL: bot.wechat_base_url } : {}),
    };
    return {
      bot,
      weixin: new WeixinTextClient({ stateDir, env }),
      syncCursor: '',
    };
  });
}

function activeBots(config: TavernRelayConfig): TavernBotConfig[] {
  const configured = config.bots.filter((bot) => bot.enabled !== false);
  if (configured.length) {
    return configured;
  }
  return [{
    id: 'default',
    enabled: true,
    name: 'Default',
    wechat_scope_id: config.wechat.default_scope_id,
    target_character: config.default_target.target_character,
    conversation_id: config.default_target.conversation_id,
    language: config.default_target.language,
  }];
}

function runtimeForTask(runtimes: BotRuntime[], task: TavernTaskConfig): BotRuntime {
  return runtimeForBotId(runtimes, task.bot_id || '') ?? runtimes[0];
}

function runtimeForBotId(runtimes: BotRuntime[], botId: string): BotRuntime | null {
  if (botId) {
    const matched = runtimes.find((runtime) => runtime.bot.id === botId);
    if (matched) {
      return matched;
    }
  }
  return runtimes[0] ?? null;
}

function targetForBot(config: TavernRelayConfig, bot: TavernBotConfig) {
  return {
    target_character: bot.target_character || config.default_target.target_character,
    conversation_id: bot.conversation_id || config.default_target.conversation_id,
    language: bot.language || config.default_target.language,
  };
}

async function emitDueTasks({
  config,
  connector,
  stateStore,
  runtimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
}): Promise<void> {
  const state = stateStore.read();
  const tasks = dueTasks(config, state);
  stateStore.write(state);
  if (!tasks.length) {
    return;
  }
  for (const task of tasks) {
    const runtime = runtimeForTask(runtimes, task);
    const event = buildTaskEvent(config, runtime.bot, task);
    await connector.writeEvent(event);
    const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
    const target = event.wechat_scope_id || runtime.bot.wechat_scope_id || config.wechat.default_scope_id;
    if (reply?.body && event.delivery_channel === 'wechat' && target) {
      syncDeliveryEnv(config);
      await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target });
      scheduleFirstFollowup({ stateStore, botId: runtime.bot.id, task, event, target });
    }
  }
}

async function emitDueFollowups({
  config,
  connector,
  stateStore,
  runtimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
}): Promise<void> {
  const now = new Date();
  const state = stateStore.read();
  const dueEntries = Object.entries(state.pendingFollowups)
    .filter(([, pending]) => Date.parse(pending.due_at) <= now.getTime())
    .sort(([, a], [, b]) => Date.parse(a.due_at) - Date.parse(b.due_at));
  if (!dueEntries.length) {
    return;
  }

  for (const [key, pending] of dueEntries) {
    const task = config.tasks.find((item) => item.id === pending.task_id);
    const runtime = runtimeForBotId(runtimes, pending.bot_id || task?.bot_id || '');
    const followup = task?.followups?.[pending.step_index];
    if (!task || !runtime || task.enabled === false || !followup?.enabled || !followup.task.trim()) {
      delete state.pendingFollowups[key];
      stateStore.write(state);
      continue;
    }

    const event = buildFollowupEvent(config, runtime.bot, task, followup, pending);
    await connector.writeEvent(event);
    log(`followup task ${task.id}[${pending.step_index + 1}] [${runtime.bot.id}] -> ${event.event_id}`);
    const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
    delete state.pendingFollowups[key];
    stateStore.write(state);

    if (reply?.body && event.delivery_channel === 'wechat' && pending.target) {
      syncDeliveryEnv(config);
      await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target: pending.target });
      scheduleNextFollowup({ stateStore, botId: runtime.bot.id, task, sourceEventId: event.event_id, target: pending.target, stepIndex: pending.step_index + 1 });
    }
  }
}

async function deliverReadyOutboxReplies({
  config,
  connector,
  runtimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtimes: BotRuntime[];
}): Promise<void> {
  const replies = await connector.listReadyReplies();
  const maxPerLoop = Math.max(1, Number(process.env.WEIXIN_READY_PER_LOOP ?? 1));
  let attempted = 0;
  for (const reply of replies) {
    if (attempted >= maxPerLoop) {
      return;
    }
    const runtime = runtimeForBotId(runtimes, reply.botId);
    if (!runtime) {
      log(`skip reply ${reply.eventId}: no runtime for bot=${reply.botId || '(missing)'}`);
      await connector.markReplyFailed(reply);
      continue;
    }
    const target = reply.wechatScopeId || runtime.bot.wechat_scope_id || config.wechat.default_scope_id;
    if (reply.status && reply.status !== 'ok') {
      log(`skip reply ${reply.eventId}: status=${reply.status} error=${reply.error || '(none)'}`);
      await connector.markReplyFailed(reply);
      continue;
    }
    if (!reply.body) {
      log(`skip reply ${reply.eventId}: empty body`);
      await connector.markReplyFailed(reply);
      continue;
    }
    if (!target) {
      log(`skip reply ${reply.eventId}: no WeChat target`);
      await connector.markReplyFailed(reply);
      continue;
    }
    attempted += 1;
    syncDeliveryEnv(config);
    await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target });
  }
}

async function deliverDeferredReplies({
  connector,
  weixin,
  botId,
  target,
}: {
  connector: TavernFileConnector;
  weixin: WeixinTextClient;
  botId: string;
  target: string;
}): Promise<void> {
  const replies = await connector.listDeferredReplies();
  const maxRetries = Math.max(0, Number(process.env.WEIXIN_DEFERRED_PER_INBOUND ?? 1));
  let attempted = 0;
  for (const reply of replies) {
    if (attempted >= maxRetries) {
      return;
    }
    if (reply.wechatScopeId && reply.wechatScopeId !== target) {
      continue;
    }
    if (reply.botId && reply.botId !== botId) {
      continue;
    }
    if (!reply.body) {
      await connector.markReplyFailed(reply);
      continue;
    }
    log(`retry deferred reply ${reply.eventId} -> ${target}`);
    attempted += 1;
    await sendReplyToWeixin({ connector, weixin, reply, target });
  }
}

async function handleInbound({
  inbound,
  config,
  connector,
  runtime,
}: {
  inbound: WeixinInboundText;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtime: BotRuntime;
}): Promise<void> {
  const event = buildUserReplyEvent(config, runtime.bot, inbound);
  await connector.writeEvent(event);
  const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
  if (reply?.body) {
    syncDeliveryEnv(config);
    await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target: inbound.externalScopeId });
  }
}

async function enqueueInbound({
  buffers,
  inbound,
  config,
  connector,
  runtime,
}: {
  buffers: Map<string, InboundBuffer>;
  inbound: WeixinInboundText;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtime: BotRuntime;
}): Promise<void> {
  const waitMs = Math.max(0, config.wechat.inbound_merge_window_ms ?? 0);
  if (waitMs <= 0) {
    await handleInbound({ inbound, config, connector, runtime });
    return;
  }
  const key = `${runtime.bot.id}:${inbound.externalScopeId}`;
  const current = buffers.get(key);
  if (current) {
    current.events.push(inbound);
    current.dueAt = Date.now() + waitMs;
    return;
  }
  buffers.set(key, {
    runtime,
    target: inbound.externalScopeId,
    events: [inbound],
    dueAt: Date.now() + waitMs,
  });
}

async function flushDueInboundBuffers({
  buffers,
  config,
  connector,
  runtimes,
}: {
  buffers: Map<string, InboundBuffer>;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtimes: BotRuntime[];
}): Promise<void> {
  const now = Date.now();
  const due = [...buffers.entries()]
    .filter(([, buffer]) => buffer.dueAt <= now)
    .sort(([, a], [, b]) => a.dueAt - b.dueAt);
  for (const [key, buffer] of due) {
    buffers.delete(key);
    const runtime = runtimeForBotId(runtimes, buffer.runtime.bot.id) ?? buffer.runtime;
    await handleInbound({
      inbound: mergeInboundEvents(buffer.events),
      config,
      connector,
      runtime,
    });
  }
}

function mergeInboundEvents(events: WeixinInboundText[]): WeixinInboundText {
  if (events.length === 1) {
    return events[0];
  }
  const first = events[0];
  const last = events[events.length - 1];
  return {
    ...last,
    externalScopeId: first.externalScopeId,
    messageId: events.map((event) => event.messageId).join('+'),
    receivedAt: last.receivedAt,
    text: events.map((event) => event.text.trim()).filter(Boolean).join('\n'),
  };
}

async function sendReplyToWeixin({
  connector,
  weixin,
  reply,
  target,
}: {
  connector: TavernFileConnector;
  weixin: WeixinTextClient;
  reply: TavernReply;
  target: string;
}): Promise<void> {
  try {
    await weixin.sendText(target, reply.body);
    await connector.markReplySent(reply);
    log(`sent outbox reply ${reply.eventId} -> ${target}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WeixinSendError && error.code === -2) {
      log(`deferred outbox reply ${reply.eventId} -> ${target}: ${message}`);
      if (error.remainingText.trim()) {
        await connector.markReplyDeferredWithBody(reply, error.remainingText);
      } else {
        await connector.markReplyDeferred(reply);
      }
      return;
    }
    log(`failed outbox reply ${reply.eventId} -> ${target}: ${message}`);
    await connector.markReplyFailed(reply);
  }
}

export function syncDeliveryEnv(config: Pick<TavernRelayConfig, 'delivery'>): void {
  process.env.WEIXIN_SPLIT_LOGICAL_MESSAGES = config.delivery.message_mode === 'split' ? '1' : '0';
  process.env.WEIXIN_SEND_INTERVAL_MS = String(config.delivery.send_interval_ms);
}

function buildUserReplyEvent(config: TavernRelayConfig, bot: TavernBotConfig, inbound: WeixinInboundText): RelayEvent {
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId('wechat_reply'),
    bot_id: bot.id,
    created_at: nowIso(),
    type: 'user_reply',
    intent: 'reply_to_user',
    ...targetForBot(config, bot),
    user_reply: {
      text: inbound.text,
      received_at: inbound.receivedAt,
      source: 'wechat',
      external_scope_id: inbound.externalScopeId,
    },
    delivery_channel: 'wechat',
    wechat_scope_id: inbound.externalScopeId,
    metadata: {
      bot_id: bot.id,
      wechat_message_id: inbound.messageId,
    },
  };
}

function buildTaskEvent(config: TavernRelayConfig, bot: TavernBotConfig, task: TavernTaskConfig): RelayEvent {
  const target = targetForBot(config, bot);
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(task.id),
    bot_id: bot.id,
    created_at: nowIso(task.timezone ?? 'Asia/Shanghai'),
    type: 'scheduled_task',
    intent: task.intent ?? 'gentle_nudge',
    target_character: task.target_character ?? target.target_character,
    conversation_id: task.conversation_id ?? target.conversation_id,
    language: task.language ?? target.language,
    task: task.task,
    suggested_first_step: task.suggested_first_step,
    tone: task.tone,
    max_length_chars: task.max_length_chars,
    forbidden: task.forbidden,
    delivery_channel: task.delivery_channel ?? 'wechat',
    wechat_scope_id: task.wechat_scope_id ?? bot.wechat_scope_id ?? config.wechat.default_scope_id,
    metadata: {
      bot_id: bot.id,
      task_id: task.id,
      task_type: task.type ?? 'scheduled_task',
      timezone: task.timezone ?? 'Asia/Shanghai',
      scheduled_time: task.time,
      schedule_mode: task.schedule_mode ?? 'fixed',
      random_window_start: task.random_window_start,
      random_window_end: task.random_window_end,
    },
  };
}

function buildFollowupEvent(
  config: TavernRelayConfig,
  bot: TavernBotConfig,
  task: TavernTaskConfig,
  followup: NonNullable<TavernTaskConfig['followups']>[number],
  pending: {
    source_event_id: string;
    step_index: number;
    target: string;
  },
): RelayEvent {
  const target = targetForBot(config, bot);
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(`${task.id}_followup_${pending.step_index + 1}`),
    bot_id: bot.id,
    created_at: nowIso(task.timezone ?? 'Asia/Shanghai'),
    type: 'scheduled_task',
    intent: followup.intent || task.intent || 'follow_up',
    target_character: task.target_character ?? target.target_character,
    conversation_id: task.conversation_id ?? target.conversation_id,
    language: task.language ?? target.language,
    task: followup.task,
    suggested_first_step: followup.suggested_first_step || task.suggested_first_step,
    tone: task.tone,
    max_length_chars: task.max_length_chars,
    forbidden: task.forbidden,
    delivery_channel: task.delivery_channel ?? 'wechat',
    wechat_scope_id: pending.target,
    metadata: {
      bot_id: bot.id,
      task_id: task.id,
      task_type: 'followup',
      followup_step: pending.step_index + 1,
      source_event_id: pending.source_event_id,
      timezone: task.timezone ?? 'Asia/Shanghai',
      scheduled_time: task.time,
    },
  };
}

function scheduleFirstFollowup({
  stateStore,
  botId,
  task,
  event,
  target,
}: {
  stateStore: RelayStateStore;
  botId: string;
  task: TavernTaskConfig;
  event: RelayEvent;
  target: string;
}): void {
  scheduleNextFollowup({ stateStore, botId, task, sourceEventId: event.event_id, target, stepIndex: 0 });
}

function scheduleNextFollowup({
  stateStore,
  botId,
  task,
  sourceEventId,
  target,
  stepIndex,
}: {
  stateStore: RelayStateStore;
  botId: string;
  task: TavernTaskConfig;
  sourceEventId: string;
  target: string;
  stepIndex: number;
}): void {
  const followup = task.followups?.[stepIndex];
  if (!followup?.enabled || !followup.task.trim() || followup.delay_minutes <= 0) {
    return;
  }
  const timeZone = task.timezone || 'Asia/Shanghai';
  const taskDateKey = localDateKey(new Date(), timeZone);
  const dueAt = new Date(Date.now() + followup.delay_minutes * 60_000).toISOString();
  const state = stateStore.read();
  const id = `${botId}:${task.id}:${taskDateKey}:${target}:${stepIndex}`;
  state.pendingFollowups[id] = {
    id,
    bot_id: botId,
    task_id: task.id,
    task_date_key: taskDateKey,
    source_event_id: sourceEventId,
    step_index: stepIndex,
    due_at: dueAt,
    target,
  };
  stateStore.write(state);
  log(`scheduled followup ${task.id}[${stepIndex + 1}] at ${dueAt}`);
}

function cancelPendingFollowupsForTarget({
  stateStore,
  botId,
  target,
}: {
  stateStore: RelayStateStore;
  botId: string;
  target: string;
}): void {
  const state = stateStore.read();
  let changed = false;
  for (const [key, pending] of Object.entries(state.pendingFollowups)) {
    if (pending.target === target && (!pending.bot_id || pending.bot_id === botId)) {
      delete state.pendingFollowups[key];
      changed = true;
    }
  }
  if (changed) {
    stateStore.write(state);
    log(`cleared pending followups for ${target}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  process.stdout.write(`[weixin-relay] ${message}\n`);
}

function preview(text: string, maxLength = 80): string {
  const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
