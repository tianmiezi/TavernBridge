import path from 'node:path';
import type { UiautoClient, UiautoInboundMessage, UiautoPollResult } from '../platforms/weixin/uiauto_client.js';
import { UiautoVmClient } from '../platforms/weixin/uiauto_vm_client.js';
import { WeixinSendError, WeixinTextClient, type WeixinInboundText } from '../platforms/weixin/text_client.js';
import { TypingStatus } from '../platforms/weixin/official/types.js';
import { startRelayAdminServer } from './admin_server.js';
import { loadTavernRelayConfig, type TavernUiautoAccountConfig, type TavernBotConfig, type TavernRelayConfig, type TavernTaskConfig } from './config.js';
import { localDateKey, makeEventId, nowIso, PROTOCOL, SCHEMA_VERSION, type RelayEvent } from './protocol.js';
import { dueTasks, markTaskEmitted } from './scheduler.js';
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

interface UiautoInboundBuffer {
  runtime: UiautoRuntime;
  bot: TavernBotConfig;
  target: string;
  messages: UiautoInboundMessage[];
  dueAt: number;
}

interface UiautoRuntime {
  account: TavernUiautoAccountConfig;
  client: UiautoClient;
  nextPollAt: number;
}

interface OpenclawTypingKeepalive {
  timer: ReturnType<typeof setInterval>;
  expiresAt: number;
  weixin: WeixinTextClient;
  target: string;
}

const openclawTypingKeepalives = new Map<string, OpenclawTypingKeepalive>();

export async function runRelayService(options: RelayServiceOptions): Promise<void> {
  const stateDir = path.resolve(options.stateDir);
  const config = loadTavernRelayConfig({ stateDir });
  syncDeliveryEnv(config);
  const connector = new TavernFileConnector(config.connector_dir, config.poll_interval_ms);
  const stateStore = new RelayStateStore(path.join(stateDir, 'relay', 'state.json'));
  let runtimes = createBotRuntimes(config, stateDir);
  let uiautoRuntimes = createUiautoRuntimes(config, stateDir);

  await connector.ensureReady();
  startBotRuntimes(runtimes);

  let stopping = false;
  const inboundBuffers = new Map<string, InboundBuffer>();
  const uiautoInboundBuffers = new Map<string, UiautoInboundBuffer>();
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });

  log(`connector_dir=${config.connector_dir}`);
  log(`bots=${runtimes.map((runtime) => `${runtime.bot.id}:${runtime.weixin.config.accountId || 'no-account'}`).join(', ')}`);
  if (uiautoRuntimes.length) {
    log(`uiauto=${uiautoRuntimes.map((runtime) => `${runtime.account.id}:${uiautoRuntimeLabel(runtime.account)}`).join(', ')}`);
  }
  await startRelayAdminServer({
    config,
    connector,
    stateDir,
    onConfigChanged: () => {
      stopAllOpenclawTypingKeepalives();
      runtimes = createBotRuntimes(config, stateDir);
      uiautoRuntimes = createUiautoRuntimes(config, stateDir);
      startBotRuntimes(runtimes);
      log(`reloaded bots=${runtimes.map((runtime) => `${runtime.bot.id}:${runtime.weixin.config.accountId || 'no-account'}`).join(', ')}`);
      if (uiautoRuntimes.length) {
        log(`reloaded uiauto=${uiautoRuntimes.map((runtime) => `${runtime.account.id}:${uiautoRuntimeLabel(runtime.account)}`).join(', ')}`);
      }
    },
    triggerTask: async (task) => {
      const bot = botForTask(config, runtimes, task);
      const uiautoRuntime = uiautoRuntimeForBotId(uiautoRuntimes, task.bot_id || bot?.id || '');
      if (shouldUseUiautoTransport(task, bot, uiautoRuntime) && task.delivery_channel !== 'tavern') {
        const uiautoBot = botForUiauto(config, uiautoRuntime.account);
        const event = buildTaskEvent(config, uiautoBot, task, { uiautoAccount: uiautoRuntime.account });
        await connector.writeEvent(event);
        const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
        if (reply?.body) {
          await sendReplyToUiauto({ config, connector, client: uiautoRuntime.client, reply });
        }
        log(`manual task ${task.id} [${uiautoRuntime.account.id}/${uiautoBot.id}] -> ${event.event_id}`);
        return event;
      }
      const runtime = runtimeForTask(runtimes, task);
      const event = buildTaskEvent(config, runtime.bot, task);
      await connector.writeEvent(event);
      if (event.delivery_channel === 'wechat' && event.wechat_scope_id) {
        startOpenclawTypingKeepalive({
          weixin: runtime.weixin,
          target: event.wechat_scope_id,
          responseTimeoutMs: config.response_timeout_ms,
          reason: `manual_task:${task.id}`,
        });
      }
      log(`manual task ${task.id} [${runtime.bot.id}] -> ${event.event_id}`);
      return event;
    },
  });

  while (!stopping) {
    await emitDueTasks({ config, connector, stateStore, runtimes, uiautoRuntimes });
    await emitDueFollowups({ config, connector, stateStore, runtimes, uiautoRuntimes });
    await deliverReadyOutboxReplies({ config, connector, stateStore, runtimes, uiautoRuntimes });
    await deliverDeferredUiautoReplies({ config, connector, uiautoRuntimes });
    await pollUiautoAccounts({ config, connector, stateStore, runtimes, uiautoRuntimes, uiautoInboundBuffers });
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
    await flushDueUiautoInboundBuffers({ buffers: uiautoInboundBuffers, config, connector, uiautoRuntimes });
    await sleep(relayLoopSleepMs(config, uiautoRuntimes));
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
  }).filter((runtime) => runtime.weixin.config.enabled);
}

function startBotRuntimes(runtimes: BotRuntime[]): void {
  for (const runtime of runtimes) {
    runtime.weixin.start();
    runtime.syncCursor = runtime.weixin.loadSyncCursor();
  }
}

function startOpenclawTypingKeepalive({
  weixin,
  target,
  responseTimeoutMs,
  reason,
}: {
  weixin: WeixinTextClient;
  target: string;
  responseTimeoutMs: number;
  reason: string;
}): void {
  const normalizedTarget = String(target ?? '').trim();
  if (!normalizedTarget) {
    return;
  }
  const key = openclawTypingKeepaliveKey(weixin, normalizedTarget);
  const maxMsFromEnv = Number(process.env.WEIXIN_TYPING_KEEPALIVE_MAX_MS);
  const maxMs = Number.isFinite(maxMsFromEnv) && maxMsFromEnv > 0
    ? maxMsFromEnv
    : Math.max(60_000, responseTimeoutMs + 60_000);
  const expiresAt = Date.now() + maxMs;
  const current = openclawTypingKeepalives.get(key);
  if (current) {
    current.expiresAt = Math.max(current.expiresAt, expiresAt);
    return;
  }

  const intervalMsFromEnv = Number(process.env.WEIXIN_TYPING_KEEPALIVE_INTERVAL_MS);
  const intervalMs = Number.isFinite(intervalMsFromEnv) && intervalMsFromEnv > 0
    ? intervalMsFromEnv
    : 5_000;
  const tick = () => {
    const active = openclawTypingKeepalives.get(key);
    if (!active) {
      return;
    }
    if (Date.now() >= active.expiresAt) {
      stopOpenclawTypingKeepalive(weixin, normalizedTarget);
      return;
    }
    void weixin.sendTypingStatus(normalizedTarget, TypingStatus.TYPING).catch((error) => {
      log(`typing keepalive failed -> ${normalizedTarget}: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  const timer = setInterval(tick, Math.max(1_000, intervalMs));
  openclawTypingKeepalives.set(key, { timer, expiresAt, weixin, target: normalizedTarget });
  log(`typing keepalive start -> ${normalizedTarget} (${reason})`);
  tick();
}

function stopOpenclawTypingKeepalive(weixin: WeixinTextClient, target: string): void {
  const normalizedTarget = String(target ?? '').trim();
  if (!normalizedTarget) {
    return;
  }
  const key = openclawTypingKeepaliveKey(weixin, normalizedTarget);
  const active = openclawTypingKeepalives.get(key);
  if (!active) {
    return;
  }
  clearInterval(active.timer);
  openclawTypingKeepalives.delete(key);
  void weixin.sendTypingStatus(normalizedTarget, TypingStatus.CANCEL).catch(() => {
    // best effort only
  });
  log(`typing keepalive stop -> ${normalizedTarget}`);
}

function stopAllOpenclawTypingKeepalives(): void {
  for (const active of [...openclawTypingKeepalives.values()]) {
    stopOpenclawTypingKeepalive(active.weixin, active.target);
  }
}

function openclawTypingKeepaliveKey(weixin: WeixinTextClient, target: string): string {
  return `${weixin.config.accountId ?? 'default'}:${target}`;
}

function createUiautoRuntimes(config: TavernRelayConfig, stateDir: string): UiautoRuntime[] {
  return config.uiauto_accounts
    .filter((account) => account.enabled !== false)
    .map((account) => ({
      account,
      client: createUiautoClient(account, stateDir),
      nextPollAt: 0,
    }));
}

function createUiautoClient(account: TavernUiautoAccountConfig, stateDir: string): UiautoClient {
  void stateDir;
  return new UiautoVmClient(account);
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
    wechat_transport: 'auto',
    target_character: config.default_target.target_character,
    conversation_id: config.default_target.conversation_id,
    language: config.default_target.language,
  }];
}

function runtimeForTask(runtimes: BotRuntime[], task: TavernTaskConfig): BotRuntime {
  const runtime = runtimeForBotId(runtimes, task.bot_id || '') ?? runtimes[0] ?? null;
  if (!runtime) {
    throw new Error(`No OpenClaw runtime for task ${task.id}.`);
  }
  return runtime;
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

function uiautoRuntimeForBotId(uiautoRuntimes: UiautoRuntime[], botId: string): UiautoRuntime | null {
  return uiautoRuntimes.find((runtime) => runtime.account.bot_id === botId) ?? null;
}

function uiautoRuntimeForAccountId(uiautoRuntimes: UiautoRuntime[], accountId: string): UiautoRuntime | null {
  return uiautoRuntimes.find((runtime) => runtime.account.id === accountId) ?? null;
}

function relayLoopSleepMs(config: TavernRelayConfig, uiautoRuntimes: UiautoRuntime[]): number {
  const uiautoIntervals = uiautoRuntimes
    .map((runtime) => runtime.account.poll_interval_ms)
    .filter((value): value is number => Number.isFinite(value) && value > 0);
  const interval = uiautoIntervals.length ? Math.min(config.wechat_poll_interval_ms, ...uiautoIntervals) : config.wechat_poll_interval_ms;
  return Math.max(500, interval);
}

function targetForBot(config: TavernRelayConfig, bot: TavernBotConfig) {
  return {
    target_character: bot.target_character || config.default_target.target_character,
    conversation_id: bot.conversation_id || config.default_target.conversation_id,
    language: bot.language || config.default_target.language,
  };
}

function botForUiauto(config: TavernRelayConfig, account: TavernUiautoAccountConfig): TavernBotConfig {
  const matched = config.bots.find((bot) => bot.id === account.bot_id);
  if (matched) {
    return matched;
  }
  return {
    id: account.bot_id || 'default',
    enabled: true,
    name: account.bot_id || 'Default',
    target_character: config.default_target.target_character,
    conversation_id: config.default_target.conversation_id,
    language: config.default_target.language,
  };
}

async function pollUiautoAccounts({
  config,
  connector,
  stateStore,
  runtimes,
  uiautoRuntimes,
  uiautoInboundBuffers,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
  uiautoRuntimes: UiautoRuntime[];
  uiautoInboundBuffers: Map<string, UiautoInboundBuffer>;
}): Promise<void> {
  if (!uiautoRuntimes.length) {
    return;
  }
  const now = Date.now();
  for (const runtime of uiautoRuntimes) {
    if (runtime.nextPollAt > now) {
      continue;
    }
    runtime.nextPollAt = now + Math.max(1_000, runtime.account.poll_interval_ms ?? config.wechat_poll_interval_ms);
    const state = stateStore.read();
    const accountState = state.uiauto[runtime.account.id];
    let result: UiautoPollResult;
    try {
      result = await runtime.client.pollOnce(accountState);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.uiauto[runtime.account.id] = {
        recentSignatures: accountState?.recentSignatures ?? [],
        lastScanAt: new Date().toISOString(),
        lastError: message,
        deviceOnline: false,
        ownerContactName: runtime.account.owner_contact_name,
      };
      stateStore.write(state);
      log(`uiauto poll failed [${runtime.account.id}]: ${message}`);
      continue;
    }
    state.uiauto[runtime.account.id] = result.state;
    stateStore.write(state);
    for (const message of result.messages) {
      const bot = botForUiauto(config, runtime.account);
      log(`inbound uiauto ${message.messageId} [${runtime.account.id}/${bot.id}] <- ${message.externalScopeId}: ${preview(message.text)}`);
      cancelPendingFollowupsForTarget({ stateStore, botId: bot.id, target: message.externalScopeId });
      await enqueueUiautoInbound({ buffers: uiautoInboundBuffers, message, config, connector, runtime, bot });
    }
  }
}

async function emitDueTasks({
  config,
  connector,
  stateStore,
  runtimes,
  uiautoRuntimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
  uiautoRuntimes: UiautoRuntime[];
}): Promise<void> {
  const state = stateStore.read();
  const dueEntries = dueTasks(config, state);
  stateStore.write(state);
  if (!dueEntries.length) {
    return;
  }
  for (const dueEntry of dueEntries) {
    const task = dueEntry.task;
    const bot = botForTask(config, runtimes, task);
    const uiautoRuntime = uiautoRuntimeForBotId(uiautoRuntimes, task.bot_id || bot?.id || '');
    if (shouldUseUiautoTransport(task, bot, uiautoRuntime) && task.delivery_channel !== 'tavern') {
      const uiautoBot = botForUiauto(config, uiautoRuntime.account);
      const event = buildTaskEvent(config, uiautoBot, task, { uiautoAccount: uiautoRuntime.account });
      await connector.writeEvent(event);
      const latestState = stateStore.read();
      markTaskEmitted(latestState, dueEntry);
      stateStore.write(latestState);
      log(`scheduled task ${task.id} [${uiautoRuntime.account.id}/${uiautoBot.id}] due ${dueEntry.scheduledTime} -> ${event.event_id}`);
      continue;
    }
    let runtime: BotRuntime;
    try {
      runtime = runtimeForTask(runtimes, task);
    } catch (error) {
      log(`skip task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const event = buildTaskEvent(config, runtime.bot, task);
    await connector.writeEvent(event);
    if (event.delivery_channel === 'wechat' && event.wechat_scope_id) {
      startOpenclawTypingKeepalive({
        weixin: runtime.weixin,
        target: event.wechat_scope_id,
        responseTimeoutMs: config.response_timeout_ms,
        reason: `scheduled_task:${task.id}`,
      });
    }
    const latestState = stateStore.read();
    markTaskEmitted(latestState, dueEntry);
    stateStore.write(latestState);
    log(`scheduled task ${task.id} [${runtime.bot.id}] due ${dueEntry.scheduledTime} -> ${event.event_id}`);
  }
}

async function emitDueFollowups({
  config,
  connector,
  stateStore,
  runtimes,
  uiautoRuntimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
  uiautoRuntimes: UiautoRuntime[];
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
    const uiautoRuntime = uiautoRuntimeForBotId(uiautoRuntimes, pending.bot_id || task?.bot_id || '');
    const followup = task?.followups?.[pending.step_index];
    if (!task || (!runtime && !uiautoRuntime) || task.enabled === false || !followup?.enabled || !followup.task.trim()) {
      delete state.pendingFollowups[key];
      stateStore.write(state);
      continue;
    }

    const bot = runtime?.bot ?? botForUiauto(config, uiautoRuntime!.account);
    const event = buildFollowupEvent(config, bot, task, followup, pending, uiautoRuntime ? { uiautoAccount: uiautoRuntime.account } : undefined);
    await connector.writeEvent(event);
    if (runtime && event.delivery_channel === 'wechat' && pending.target) {
      startOpenclawTypingKeepalive({
        weixin: runtime.weixin,
        target: pending.target,
        responseTimeoutMs: config.response_timeout_ms,
        reason: `followup:${task.id}:${pending.step_index + 1}`,
      });
    }
    log(`followup task ${task.id}[${pending.step_index + 1}] [${runtime?.bot.id ?? uiautoRuntime?.account.bot_id ?? '(unknown)'}] -> ${event.event_id}`);
    const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
    delete state.pendingFollowups[key];
    stateStore.write(state);

    if (reply?.body && event.delivery_channel === 'wechat' && uiautoRuntime) {
      await sendReplyToUiauto({ config, connector, client: uiautoRuntime.client, reply });
      scheduleNextFollowup({ stateStore, botId: uiautoRuntime.account.bot_id, task, sourceEventId: event.event_id, target: pending.target, stepIndex: pending.step_index + 1 });
    } else if (reply?.body && event.delivery_channel === 'wechat' && pending.target && runtime) {
      syncDeliveryEnv(config);
      await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target: pending.target });
      scheduleNextFollowup({ stateStore, botId: runtime.bot.id, task, sourceEventId: event.event_id, target: pending.target, stepIndex: pending.step_index + 1 });
    }
  }
}

async function deliverReadyOutboxReplies({
  config,
  connector,
  stateStore,
  runtimes,
  uiautoRuntimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  stateStore: RelayStateStore;
  runtimes: BotRuntime[];
  uiautoRuntimes: UiautoRuntime[];
}): Promise<void> {
  const replies = await connector.listReadyReplies();
  const maxPerLoop = Math.max(1, Number(process.env.WEIXIN_READY_PER_LOOP ?? (uiautoRuntimes.length ? 5 : 1)));
  let attempted = 0;
  for (const reply of replies) {
    if (attempted >= maxPerLoop) {
      return;
    }
    if (reply.deliveryChannel && reply.deliveryChannel !== 'wechat') {
      log(`archive tavern-only reply ${reply.eventId}: delivery_channel=${reply.deliveryChannel}`);
      await connector.markReplySent(reply);
      continue;
    }
    const uiautoRuntime = uiautoRuntimeForReply(config, uiautoRuntimes, reply);
    if (uiautoRuntime) {
      attempted += 1;
      const sent = await sendReplyToUiauto({ config, connector, client: uiautoRuntime.client, reply });
      if (sent) {
        scheduleFollowupAfterDeliveredReply({
          config,
          stateStore,
          reply,
          botId: uiautoRuntime.account.bot_id,
          target: uiautoRuntime.account.owner_contact_name,
        });
      }
      continue;
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
    const sent = await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target });
    if (sent) {
      scheduleFollowupAfterDeliveredReply({ config, stateStore, reply, botId: runtime.bot.id, target });
    }
  }
}

function uiautoRuntimeForReply(
  config: TavernRelayConfig,
  uiautoRuntimes: UiautoRuntime[],
  reply: TavernReply,
): UiautoRuntime | null {
  if (!uiautoRuntimes.length) {
    return null;
  }
  if (reply.deliveryChannel && reply.deliveryChannel !== 'wechat') {
    return null;
  }
  if (reply.uiautoAccountId) {
    return uiautoRuntimes.find((runtime) => runtime.account.id === reply.uiautoAccountId) ?? null;
  }
  const bot = botForReply(config, reply);
  const botId = reply.botId || bot?.id || 'default';
  const transport = normalizeReplyWechatTransport(reply.wechatTransport) ?? bot?.wechat_transport ?? 'auto';
  if (transport === 'openclaw') {
    return null;
  }
  if (reply.source === 'wechat_uiauto_account' || transport === 'uiauto' || transport === 'auto') {
    return uiautoRuntimes.find((runtime) => runtime.account.bot_id === botId)
      ?? (uiautoRuntimes.length === 1 ? uiautoRuntimes[0] : null);
  }
  return null;
}

function botForReply(config: TavernRelayConfig, reply: TavernReply): TavernBotConfig | null {
  const botId = reply.botId || 'default';
  return config.bots.find((bot) => bot.id === botId)
    ?? config.bots.find((bot) => bot.id === 'default')
    ?? config.bots[0]
    ?? null;
}

function normalizeReplyWechatTransport(value: string): TavernBotConfig['wechat_transport'] | null {
  if (value === 'openclaw' || value === 'uiauto' || value === 'auto') {
    return value;
  }
  if (value === 'alt_wechat' || value === 'windows_wxauto' || value === 'uiauto_vm') {
    return 'uiauto';
  }
  return null;
}

async function deliverDeferredUiautoReplies({
  config,
  connector,
  uiautoRuntimes,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  uiautoRuntimes: UiautoRuntime[];
}): Promise<void> {
  if (!uiautoRuntimes.length) {
    return;
  }
  const replies = await connector.listDeferredReplies();
  const maxRetries = Math.max(0, Number(process.env.WEIXIN_DEFERRED_UIAUTO_PER_LOOP ?? process.env.WEIXIN_DEFERRED_ALT_PER_LOOP ?? 1));
  let attempted = 0;
  for (const reply of replies) {
    if (attempted >= maxRetries) {
      return;
    }
    const uiautoRuntime = uiautoRuntimeForReply(config, uiautoRuntimes, reply);
    if (!uiautoRuntime) {
      continue;
    }
    if (reply.status && reply.status !== 'ok') {
      await connector.markReplyFailed(reply);
      continue;
    }
    if (!reply.body) {
      await connector.markReplyFailed(reply);
      continue;
    }
    log(`retry deferred uiauto reply ${reply.eventId} [${uiautoRuntime.account.id}]`);
    attempted += 1;
    await sendReplyToUiauto({ config, connector, client: uiautoRuntime.client, reply });
  }
}

function botForTask(config: TavernRelayConfig, runtimes: BotRuntime[], task: TavernTaskConfig): TavernBotConfig | null {
  const runtime = runtimeForBotId(runtimes, task.bot_id || '');
  if (runtime) {
    return runtime.bot;
  }
  return config.bots.find((bot) => bot.id === (task.bot_id || '')) ?? null;
}

function shouldUseUiautoTransport(
  task: TavernTaskConfig,
  bot: TavernBotConfig | null,
  uiautoRuntime: UiautoRuntime | null,
): uiautoRuntime is UiautoRuntime {
  if (!uiautoRuntime) {
    return false;
  }
  const transport = task.wechat_transport ?? bot?.wechat_transport ?? 'auto';
  if (transport === 'openclaw') {
    return false;
  }
  if (transport === 'uiauto') {
    return true;
  }
  return true;
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
  startOpenclawTypingKeepalive({
    weixin: runtime.weixin,
    target: inbound.externalScopeId,
    responseTimeoutMs: config.response_timeout_ms,
    reason: `inbound:${event.event_id}`,
  });
  try {
    const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
    if (reply?.body) {
      syncDeliveryEnv(config);
      await sendReplyToWeixin({ connector, weixin: runtime.weixin, reply, target: inbound.externalScopeId });
    }
  } finally {
    stopOpenclawTypingKeepalive(runtime.weixin, inbound.externalScopeId);
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

async function handleUiautoInbound({
  message,
  config,
  connector,
  runtime,
  bot,
}: {
  message: UiautoInboundMessage;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtime: UiautoRuntime;
  bot: TavernBotConfig;
}): Promise<void> {
  const event = buildUiautoReplyEvent(config, runtime.account, bot, message);
  await connector.writeEvent(event);
  const reply = await connector.waitForReply(event.event_id, config.response_timeout_ms);
  if (reply?.body) {
    await sendReplyToUiauto({ config, connector, client: runtime.client, reply });
  }
}

async function enqueueUiautoInbound({
  buffers,
  message,
  config,
  connector,
  runtime,
  bot,
}: {
  buffers: Map<string, UiautoInboundBuffer>;
  message: UiautoInboundMessage;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  runtime: UiautoRuntime;
  bot: TavernBotConfig;
}): Promise<void> {
  const waitMs = Math.max(0, config.wechat.inbound_merge_window_ms ?? 0);
  if (waitMs <= 0) {
    await handleUiautoInbound({ message, config, connector, runtime, bot });
    return;
  }
  const key = `${runtime.account.id}:${bot.id}:${message.externalScopeId}`;
  const current = buffers.get(key);
  if (current) {
    current.messages.push(message);
    current.dueAt = Date.now() + waitMs;
    return;
  }
  buffers.set(key, {
    runtime,
    bot,
    target: message.externalScopeId,
    messages: [message],
    dueAt: Date.now() + waitMs,
  });
}

async function flushDueUiautoInboundBuffers({
  buffers,
  config,
  connector,
  uiautoRuntimes,
}: {
  buffers: Map<string, UiautoInboundBuffer>;
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  uiautoRuntimes: UiautoRuntime[];
}): Promise<void> {
  const now = Date.now();
  const due = [...buffers.entries()]
    .filter(([, buffer]) => buffer.dueAt <= now)
    .sort(([, a], [, b]) => a.dueAt - b.dueAt);
  for (const [key, buffer] of due) {
    buffers.delete(key);
    const runtime = uiautoRuntimeForAccountId(uiautoRuntimes, buffer.runtime.account.id) ?? buffer.runtime;
    await handleUiautoInbound({
      message: mergeUiautoInboundMessages(buffer.messages),
      config,
      connector,
      runtime,
      bot: buffer.bot,
    });
  }
}

function mergeUiautoInboundMessages(messages: UiautoInboundMessage[]): UiautoInboundMessage {
  if (messages.length === 1) {
    return messages[0];
  }
  const first = messages[0];
  const last = messages[messages.length - 1];
  return {
    ...last,
    externalScopeId: first.externalScopeId,
    messageId: messages.map((message) => message.messageId).join('+'),
    receivedAt: last.receivedAt,
    signature: messages.map((message) => message.signature).join('+'),
    text: messages.map((message) => message.text.trim()).filter(Boolean).join('\n'),
    attachments: messages.flatMap((message) => message.attachments ?? []),
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
}): Promise<boolean> {
  try {
    await weixin.sendText(target, reply.body);
    await connector.markReplySent(reply);
    log(`sent outbox reply ${reply.eventId} -> ${target}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof WeixinSendError && error.code === -2) {
      log(`deferred outbox reply ${reply.eventId} -> ${target}: ${message}`);
      if (error.remainingText.trim()) {
        await connector.markReplyDeferredWithBody(reply, error.remainingText);
      } else {
        await connector.markReplyDeferred(reply);
      }
      return false;
    }
    log(`failed outbox reply ${reply.eventId} -> ${target}: ${message}`);
    await connector.markReplyFailed(reply);
    return false;
  } finally {
    stopOpenclawTypingKeepalive(weixin, target);
  }
}

async function sendReplyToUiauto({
  config,
  connector,
  client,
  reply,
}: {
  config: TavernRelayConfig;
  connector: TavernFileConnector;
  client: UiautoClient;
  reply: TavernReply;
}): Promise<boolean> {
  try {
    if (reply.status && reply.status !== 'ok') {
      log(`skip uiauto reply ${reply.eventId}: status=${reply.status} error=${reply.error || '(none)'}`);
      await connector.markReplyFailed(reply);
      return false;
    }
    if (!reply.body.trim()) {
      log(`skip uiauto reply ${reply.eventId}: empty body`);
      await connector.markReplyFailed(reply);
      return false;
    }
    const messages = splitDeliveryMessages(reply.body, config);
    if (!messages.length) {
      log(`skip uiauto reply ${reply.eventId}: no deliverable messages`);
      await connector.markReplyFailed(reply);
      return false;
    }
    for (let index = 0; index < messages.length; index += 1) {
      try {
        await client.sendText(messages[index]);
      } catch (error) {
        const remaining = messages.slice(index).join('\n');
        const message = error instanceof Error ? error.message : String(error);
        log(`deferred uiauto reply ${reply.eventId} -> ${client.account.owner_contact_name}: ${message}`);
        if (remaining.trim()) {
          await connector.markReplyDeferredWithBody(reply, remaining);
        } else {
          await connector.markReplyDeferred(reply);
        }
        return false;
      }
      if (index < messages.length - 1) {
        await sleep(Math.max(0, config.delivery.send_interval_ms ?? 0));
      }
    }
    await connector.markReplySent(reply);
    log(`sent uiauto reply ${reply.eventId} -> ${client.account.owner_contact_name}${messages.length > 1 ? ` (${messages.length} messages)` : ''}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`failed uiauto reply ${reply.eventId} -> ${client.account.owner_contact_name}: ${message}`);
    await connector.markReplyFailed(reply);
    return false;
  }
}

function splitDeliveryMessages(text: string, config: Pick<TavernRelayConfig, 'delivery'>): string[] {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return [];
  }
  if (config.delivery.message_mode === 'single') {
    return [normalized];
  }
  const lines = normalized.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [normalized];
  }
  const looksLikeShortWechatMessages = lines.every((line) => line.length <= 120 && !line.includes('|'));
  return looksLikeShortWechatMessages ? lines : [normalized];
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
      agenda_context: agendaContext(config),
    },
  };
}

function buildUiautoReplyEvent(
  config: TavernRelayConfig,
  account: TavernUiautoAccountConfig,
  bot: TavernBotConfig,
  inbound: UiautoInboundMessage,
): RelayEvent {
  const target = targetForBot(config, bot);
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId('uiauto_reply'),
    bot_id: bot.id,
    created_at: nowIso(),
    type: 'user_reply',
    intent: 'reply_to_user',
    target_character: account.target_character ?? bot.target_character ?? target.target_character,
    conversation_id: account.conversation_id ?? bot.conversation_id ?? target.conversation_id,
    language: account.language ?? bot.language ?? target.language,
    user_reply: {
      text: inbound.text,
      received_at: inbound.receivedAt,
      source: 'wechat_uiauto_account',
      external_scope_id: inbound.externalScopeId,
    },
    attachments: inbound.attachments,
    delivery_channel: 'wechat',
    wechat_scope_id: inbound.externalScopeId,
    metadata: {
      bot_id: bot.id,
      source: 'wechat_uiauto_account',
      uiauto_account_id: account.id,
      uiauto_platform: 'uiauto_vm',
      worker_base_url: account.worker_base_url,
      owner_contact_name: account.owner_contact_name,
      message_id: inbound.messageId,
      attachments: inbound.attachments,
      agenda_context: agendaContext(config),
    },
  };
}

function buildTaskEvent(
  config: TavernRelayConfig,
  bot: TavernBotConfig,
  task: TavernTaskConfig,
  options: { uiautoAccount?: TavernUiautoAccountConfig } = {},
): RelayEvent {
  const target = targetForBot(config, bot);
  const transport = task.wechat_transport ?? bot.wechat_transport ?? (options.uiautoAccount ? 'uiauto' : 'openclaw');
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(task.id),
    bot_id: bot.id,
    created_at: nowIso(task.timezone ?? 'Asia/Shanghai'),
    ttl_seconds: Math.max(0, config.schedule_grace_minutes ?? 30) * 60,
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
      wechat_transport: transport,
      uiauto_account_id: options.uiautoAccount?.id,
      uiauto_platform: options.uiautoAccount ? 'uiauto_vm' : undefined,
      task_type: task.type ?? 'scheduled_task',
      timezone: task.timezone ?? 'Asia/Shanghai',
      scheduled_time: task.time,
      schedule_mode: task.schedule_mode ?? 'fixed',
      random_window_start: task.random_window_start,
      random_window_end: task.random_window_end,
      agenda_context: agendaContext(config),
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
  options: { uiautoAccount?: TavernUiautoAccountConfig } = {},
): RelayEvent {
  const target = targetForBot(config, bot);
  const transport = task.wechat_transport ?? bot.wechat_transport ?? (options.uiautoAccount ? 'uiauto' : 'openclaw');
  return {
    protocol: PROTOCOL,
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(`${task.id}_followup_${pending.step_index + 1}`),
    bot_id: bot.id,
    created_at: nowIso(task.timezone ?? 'Asia/Shanghai'),
    ttl_seconds: Math.max(0, config.schedule_grace_minutes ?? 30) * 60,
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
      wechat_transport: transport,
      uiauto_account_id: options.uiautoAccount?.id,
      uiauto_platform: options.uiautoAccount ? 'uiauto_vm' : undefined,
      task_type: 'followup',
      followup_step: pending.step_index + 1,
      source_event_id: pending.source_event_id,
      timezone: task.timezone ?? 'Asia/Shanghai',
      scheduled_time: task.time,
      agenda_context: agendaContext(config),
    },
  };
}

function agendaContext(config: TavernRelayConfig): Record<string, unknown> {
  const entries = config.agenda?.entries ?? [];
  return {
    entry_format: config.agenda?.parser?.entry_format,
    entries: entries.map((entry) => ({
      date_text: entry.date_text,
      date_key: entry.date_key,
      owner: entry.owner,
      item: entry.item,
      text: entry.text,
    })),
  };
}

function scheduleFollowupAfterDeliveredReply({
  config,
  stateStore,
  reply,
  botId,
  target,
}: {
  config: TavernRelayConfig;
  stateStore: RelayStateStore;
  reply: TavernReply;
  botId: string;
  target: string;
}): void {
  if (reply.rawEventType !== 'scheduled_task' || !reply.taskId || !target) {
    return;
  }
  const task = config.tasks.find((item) => item.id === reply.taskId);
  if (!task || task.enabled === false) {
    return;
  }
  const nextStepIndex = reply.taskType === 'followup'
    ? Math.max(0, reply.followupStep ?? 0)
    : 0;
  scheduleNextFollowup({
    stateStore,
    botId,
    task,
    sourceEventId: reply.eventId,
    target,
    stepIndex: nextStepIndex,
  });
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

function uiautoRuntimeLabel(account: TavernUiautoAccountConfig): string {
  return account.worker_base_url || 'uiauto-worker';
}
