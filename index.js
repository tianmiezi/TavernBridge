import { extension_settings } from "../../../extensions.js";
import {
    Generate,
    chat,
    characters,
    eventSource,
    event_types,
    getCurrentChatId,
    saveSettingsDebounced,
    selectCharacterById,
    sendMessageAsUser,
    this_chid,
} from "../../../../script.js";

const EXT_ID = "codex_tavern_bridge";
const PROTOCOL = "codex_tavern_event";
const REPLY_PROTOCOL = "codex_tavern_reply";
const MAX_LOG_ITEMS = 50;
const EXTENSION_RELATIVE_PATH = "public/scripts/extensions/third-party/CodexTavernBridge";
const RUNNER_HEARTBEAT_MS = 10000;
const RUNNER_RESTORE_DELAY_MS = 1500;

const DEFAULT_SETTINGS = {
    enabled: true,
    bridgeUrl: "http://127.0.0.1:8787",
    botId: "default",
    autoConnect: true,
    autoSwitchCharacter: true,
    requireTargetCharacter: false,
    blockDuplicateEvents: true,
    keepAwake: true,
    generateAfterInbound: true,
    autoSendCharacterReplies: true,
    outboundRegex: "",
    outboundRegexFlags: "",
    outboundRegexGroup: 1,
    blockWhenRegexMisses: true,
    state: {
        processedEventIds: [],
        lastEventAt: "",
        lastReplyAt: "",
        logs: [],
    },
};

let sse = null;
let isProcessing = false;
let generationEventsBound = false;
let autoSendTimer = null;
let lastAutoSentSignature = "";
let lastBridgeReplySignature = "";
let suppressAutoSendUntil = 0;
let wakeLock = null;
let sseGeneration = 0;
let wakeLockLogShown = false;
let wakeLockWarnShown = false;
let bridgeOwnerToken = null;
let runnerHeartbeatTimer = null;
let runnerHeartbeatInFlight = false;
let runnerWorker = null;
let runnerWorkerUrl = "";
let runnerRestoreTimer = null;
let bridgeManuallyDisconnected = false;

function keepaliveParams() {
    return new URLSearchParams(window.location.search || "");
}

function isKeepalivePage() {
    return keepaliveParams().get("ctb_keepalive") === "1";
}

function isBridgeConnected() {
    return Boolean(sse && sse.readyState === EventSource.OPEN);
}

function cloneDefaults(value) {
    return JSON.parse(JSON.stringify(value));
}

function settings() {
    extension_settings[EXT_ID] = extension_settings[EXT_ID] || cloneDefaults(DEFAULT_SETTINGS);
    extension_settings[EXT_ID] = {
        ...cloneDefaults(DEFAULT_SETTINGS),
        ...extension_settings[EXT_ID],
        state: {
            ...cloneDefaults(DEFAULT_SETTINGS.state),
            ...(extension_settings[EXT_ID].state || {}),
        },
    };
    return extension_settings[EXT_ID];
}

function notify(message, type = "info") {
    console[type === "error" ? "error" : "log"](`[Codex 酒馆桥接] ${message}`);
    if (window.toastr?.[type]) {
        window.toastr[type](message, "Codex 酒馆桥接");
    }
}

function sourceLabel(source) {
    const labels = {
        manual: "手动输入",
        bridge: "桥接服务",
    };
    return labels[source] || source;
}

function setStatus(message, tone = "") {
    const el = document.getElementById("ctb_status");
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
}

function appendLog(entry) {
    const cfg = settings();
    cfg.state.logs.unshift({ at: new Date().toISOString(), ...entry });
    cfg.state.logs = cfg.state.logs.slice(0, MAX_LOG_ITEMS);
    saveSettingsDebounced();
    renderLog();
}

function renderLog() {
    const list = document.getElementById("ctb_log");
    if (!list) return;

    list.innerHTML = "";
    const logs = settings().state.logs || [];

    if (!logs.length) {
        const empty = document.createElement("div");
        empty.className = "ctb-empty";
        empty.textContent = "暂无桥接事件。";
        list.appendChild(empty);
        return;
    }

    for (const item of logs.slice(0, 12)) {
        const row = document.createElement("div");
        row.className = `ctb-log-row ctb-log-${item.level || "info"}`;

        const title = document.createElement("div");
        title.className = "ctb-log-title";
        title.textContent = `${item.event_id || "事件"} - ${item.message || "已处理"}`;

        const meta = document.createElement("div");
        meta.className = "ctb-log-meta";
        meta.textContent = item.at;

        row.append(title, meta);
        list.appendChild(row);
    }
}

function saveInputValue(id, key, transform = value => value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
        settings()[key] = transform(el.type === "checkbox" ? el.checked : el.value);
        saveSettingsDebounced();
    });
}

function randomId(prefix = "ctb") {
    if (window.crypto?.randomUUID) {
        return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function tavernClientId() {
    const key = `${EXT_ID}_client_id`;
    let value = window.sessionStorage?.getItem(key);
    if (!value) {
        value = randomId("tavern");
        window.sessionStorage?.setItem(key, value);
    }
    return value;
}

function ownerToken() {
    const key = `${EXT_ID}_owner_token`;
    bridgeOwnerToken = bridgeOwnerToken || window.sessionStorage?.getItem(key) || randomId("owner");
    window.sessionStorage?.setItem(key, bridgeOwnerToken);
    return bridgeOwnerToken;
}

function bridgeOwnerKey(botId) {
    return `${EXT_ID}_owner_${botKey(botId)}`;
}

function botKey(botId) {
    return String(botId || "default").trim() || "default";
}

function readBridgeOwner(botId) {
    try {
        const raw = window.localStorage?.getItem(bridgeOwnerKey(botId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeBridgeOwner(botId) {
    const owner = {
        client_id: tavernClientId(),
        owner_token: ownerToken(),
        claimed_at: new Date().toISOString(),
    };
    window.localStorage?.setItem(bridgeOwnerKey(botId), JSON.stringify(owner));
    return owner;
}

function isCurrentBridgeOwner(botId) {
    const owner = readBridgeOwner(botId);
    return owner?.client_id === tavernClientId() && owner?.owner_token === ownerToken();
}

function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function nestedEvent(envelope) {
    return isObject(envelope.event) ? envelope.event : {};
}

function normalizeInbound(raw) {
    const envelope = raw?.event?.protocol === PROTOCOL ? raw.event : raw;
    if (!isObject(envelope)) {
        throw new Error("载荷必须是 JSON 对象。");
    }

    if (envelope.protocol !== PROTOCOL) {
        throw new Error(`不支持的协议：${envelope.protocol || "缺失"}`);
    }

    const evt = nestedEvent(envelope);
    const target = isObject(envelope.target) ? envelope.target : {};
    const task = isObject(envelope.task) ? envelope.task : {};
    const delivery = isObject(envelope.delivery) ? envelope.delivery : {};
    const userReply = isObject(envelope.user_reply) ? envelope.user_reply : {};

    const type = String(evt.type || envelope.type || "");
    const userMessage = String(
        userReply.text ||
        envelope.user_message ||
        envelope.message ||
        envelope.text ||
        "",
    );

    const normalized = {
        raw: envelope,
        protocol: envelope.protocol,
        schema_version: String(envelope.schema_version || "1.0"),
        event_id: String(envelope.event_id || ""),
        bot_id: String(envelope.bot_id || envelope.metadata?.bot_id || ""),
        created_at: String(envelope.created_at || ""),
        ttl_seconds: Number(envelope.ttl_seconds || 0),
        type,
        intent: String(evt.intent || envelope.intent || ""),
        priority: String(evt.priority || envelope.priority || "normal"),
        reason: String(evt.reason || envelope.reason || ""),
        target_character: String(target.tavern_character || envelope.target_character || ""),
        conversation_id: String(target.conversation_id || envelope.conversation_id || ""),
        language: String(target.language || envelope.language || "zh-CN"),
        task_title: String(task.title || envelope.task || envelope.task_title || ""),
        task_status: String(task.status || envelope.task_status || ""),
        task_subject: String(task.subject || envelope.subject || ""),
        duration_minutes: Number(task.duration_minutes || envelope.duration_minutes || 0),
        suggested_first_step: String(task.suggested_first_step || envelope.suggested_first_step || ""),
        user_context: isObject(envelope.user_context) ? envelope.user_context : {},
        metadata: isObject(envelope.metadata) ? envelope.metadata : {},
        attachments: Array.isArray(envelope.attachments) ? envelope.attachments.filter(isObject) : [],
        user_message: userMessage,
        delivery_channel: String(delivery.channel || envelope.delivery_channel || "wechat"),
        fallback_channel: String(delivery.fallback_channel || envelope.fallback_channel || "tavern"),
        reply_to_event_id: String(userReply.reply_to_event_id || envelope.reply_to_event_id || ""),
        require_user_reply: Boolean(delivery.require_user_reply || envelope.require_user_reply),
    };

    validateInbound(normalized);
    return normalized;
}

function validateInbound(event) {
    const required = ["event_id", "created_at", "type"];
    const missing = required.filter(key => !event[key]);
    if (missing.length) {
        throw new Error(`缺少必填字段：${missing.join(", ")}`);
    }

    if (Number.isNaN(Date.parse(event.created_at))) {
        throw new Error("created_at 必须是可解析的 ISO 时间戳。");
    }

    if (event.ttl_seconds > 0) {
        const ageMs = Date.now() - Date.parse(event.created_at);
        if (ageMs > event.ttl_seconds * 1000) {
            throw new Error(`事件已超过 TTL 有效期（${event.ttl_seconds} 秒）。`);
        }
    }

    if (settings().requireTargetCharacter && !event.target_character) {
        throw new Error("当前设置要求必须提供 target_character。");
    }
}

function ensureNotDuplicate(event) {
    const cfg = settings();
    const ids = cfg.state.processedEventIds || [];
    if (settings().blockDuplicateEvents && ids.includes(event.event_id)) {
        throw new Error(`重复的 event_id：${event.event_id}`);
    }
}

function rememberProcessed(event) {
    const cfg = settings();
    const ids = cfg.state.processedEventIds || [];
    ids.unshift(event.event_id);
    cfg.state.processedEventIds = Array.from(new Set(ids)).slice(0, 500);
    cfg.state.lastEventAt = new Date().toISOString();
    saveSettingsDebounced();
}

function findCharacterIndex(targetName) {
    const expected = String(targetName || "").trim().toLowerCase();
    if (!expected) return -1;
    return characters.findIndex(character => String(character?.name || "").trim().toLowerCase() === expected);
}

async function prepareTarget(event) {
    if (!settings().autoSwitchCharacter || !event.target_character) return;

    const index = findCharacterIndex(event.target_character);
    if (index < 0) {
        if (settings().requireTargetCharacter) {
            throw new Error(`找不到目标角色：${event.target_character}`);
        }

        appendLog({
            level: "warn",
            event_id: event.event_id,
            message: `找不到目标角色，已改用当前卡：${event.target_character}`,
        });
        return;
    }

    if (String(this_chid) !== String(index)) {
        await selectCharacterById(index, { switchMenu: false });
    }
}

function renderInboundMessage(event) {
    return renderCompactInboundMessage(event);
}

function renderCompactInboundMessage(event) {
    const lines = [
        "[微信桥接事件]",
        `本地时间: ${formatLocalTime(event.created_at)}`,
        `事件: ${eventLabel(event)}`,
    ];

    if (event.user_message) {
        lines.push(`用户消息: ${event.user_message}`);
    }

    if (event.attachments?.length) {
        for (const attachment of event.attachments) {
            const type = String(attachment.type || "附件");
            const text = String(attachment.text || attachment.local_path || "").trim();
            lines.push(`附件: ${type}${text ? ` - ${text}` : ""}`);
        }
    }

    if (event.task_title) {
        lines.push(`日程内容: ${event.task_title}`);
    }

    if (event.suggested_first_step) {
        lines.push(`消息判断逻辑: ${event.suggested_first_step}`);
    }

    if (event.intent && event.intent !== "reply_to_user") {
        lines.push(`参考情绪: ${event.intent}`);
    }

    const extra = compactEventHint(event);
    if (extra) {
        lines.push(`补充: ${extra}`);
    }

    return lines.join("\n");
}

function compactEventHint(event) {
    const metadata = event.metadata || {};
    if (metadata.task_type === "followup") {
        return `这是第 ${metadata.followup_step || 1} 次未回复后续提醒；用户在上一条消息后没有及时回复。`;
    }
    if (event.type === "scheduled_task") {
        return `自动日程触发${metadata.scheduled_time ? `，计划时间 ${metadata.scheduled_time}` : ""}。`;
    }
    if (event.type === "user_reply") {
        return "来自微信用户的实时回复，按当前对话关系自然回应。";
    }
    return "";
}

function eventLabel(event) {
    if (event.metadata?.task_type === "followup") return "未回复后续提醒";
    if (event.type === "scheduled_task") return "自动日程";
    if (event.type === "user_reply") return "微信用户回复";
    return event.type || "桥接事件";
}

function formatLocalTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value || "");
    }
    return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).format(date);
}

function latestCharacterEntryAfter(startIndex) {
    for (let index = chat.length - 1; index >= startIndex; index -= 1) {
        const message = chat[index];
        if (message && !message.is_user && !message.is_system) {
            return { index, message };
        }
    }
    return null;
}

function latestCharacterMessageAfter(startIndex) {
    return latestCharacterEntryAfter(startIndex)?.message || null;
}

function sanitizeRegexFlags(flags) {
    return String(flags || "").replace(/[^dgimsuvy]/g, "");
}

function applyOutboundFilter(rawText) {
    const cfg = settings();
    const source = String(rawText || "").trim();
    const taggedMessages = extractWechatMessages(source);
    if (taggedMessages) {
        return {
            ok: true,
            text: taggedMessages,
            matched: true,
            reason: "",
        };
    }

    const pattern = String(cfg.outboundRegex || "").trim();

    if (!pattern) {
        if (cfg.blockWhenRegexMisses) {
            return {
                ok: false,
                text: "",
                matched: false,
                reason: "没有找到 <message> 正文。",
            };
        }

        return {
            ok: true,
            text: source,
            matched: false,
            reason: "",
        };
    }

    let regex;
    try {
        regex = new RegExp(pattern, sanitizeRegexFlags(cfg.outboundRegexFlags));
    } catch (error) {
        return {
            ok: false,
            text: "",
            matched: false,
            reason: `出站正则无效：${error.message}`,
        };
    }

    const groupIndex = Number.isInteger(Number(cfg.outboundRegexGroup))
        ? Number(cfg.outboundRegexGroup)
        : 1;
    const matches = collectRegexMatches(regex, source, groupIndex);
    if (!matches.length) {
        return {
            ok: !cfg.blockWhenRegexMisses,
            text: cfg.blockWhenRegexMisses ? "" : source,
            matched: false,
            reason: "出站正则没有匹配到内容。",
        };
    }

    const extracted = matches.join("\n");

    return {
        ok: String(extracted).trim().length > 0,
        text: String(extracted).trim(),
        matched: true,
        reason: String(extracted).trim() ? "" : "出站正则匹配结果为空。",
    };
}

function collectRegexMatches(regex, source, groupIndex) {
    const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
    const globalRegex = new RegExp(regex.source, flags);
    const values = [];
    for (const match of source.matchAll(globalRegex)) {
        const value = String(match[groupIndex] ?? match[0] ?? "").trim();
        if (value) values.push(value);
    }
    return values;
}

function extractWechatMessages(rawText) {
    const source = String(rawText || "").trim();
    const contentBlock = extractLastTaggedBlock(source, "content");
    const contentScoped = extractTaggedBlocks(contentBlock, "message")
        .map(value => value.trim())
        .filter(Boolean);
    if (contentScoped.length) {
        return contentScoped.join("\n");
    }

    const withoutThinking = source
        .replace(/<thinking>[\s\S]*?<\/thinking>/giu, "")
        .replace(/<think>[\s\S]*?<\/think>/giu, "");
    const messages = extractTaggedBlocks(withoutThinking, "message")
        .map(value => value.trim())
        .filter(Boolean);
    return messages.length ? messages.join("\n") : "";
}

function extractLastTaggedBlock(text, tagName) {
    const source = String(text || "");
    const openTag = `<${tagName}>`;
    const closeTag = `</${tagName}>`;
    const openIndex = source.toLowerCase().lastIndexOf(openTag);
    if (openIndex < 0) return "";
    const contentStart = openIndex + openTag.length;
    const closeIndex = source.toLowerCase().indexOf(closeTag, contentStart);
    if (closeIndex < 0) return "";
    return source.slice(contentStart, closeIndex);
}

function extractTaggedBlocks(text, tagName) {
    const source = String(text || "");
    const lower = source.toLowerCase();
    const openTag = `<${tagName.toLowerCase()}>`;
    const closeTag = `</${tagName.toLowerCase()}>`;
    const blocks = [];
    let searchFrom = 0;
    while (searchFrom < source.length) {
        const closeIndex = lower.indexOf(closeTag, searchFrom);
        if (closeIndex < 0) break;
        const openIndex = lower.lastIndexOf(openTag, closeIndex);
        if (openIndex >= searchFrom) {
            blocks.push(source.slice(openIndex + openTag.length, closeIndex));
        }
        searchFrom = closeIndex + closeTag.length;
    }
    return blocks;
}

async function postReplyToBridge(event, result, rawReply, status = "ok", error = "") {
    const baseUrl = settings().bridgeUrl.replace(/\/+$/, "");
    if (!baseUrl) return;

    try {
        await fetch(`${baseUrl}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                protocol: REPLY_PROTOCOL,
                schema_version: "1.0",
                event_id: event.event_id,
                bot_id: event.bot_id || settings().botId || "",
                reply_to_event_id: event.reply_to_event_id,
                created_at: new Date().toISOString(),
                status,
                error,
                target_character: event.target_character,
                delivery_channel: event.delivery_channel,
                text: result?.text || "",
                raw_text: rawReply || "",
                filter: {
                    matched: Boolean(result?.matched),
                    regex_enabled: Boolean(settings().outboundRegex),
                    reason: result?.reason || "",
                },
                raw_event: event.raw,
            }),
        });
    } catch (bridgeError) {
        appendLog({
            level: "warn",
            event_id: event.event_id,
            message: `回复回传失败：${bridgeError.message || bridgeError}`,
        });
    }
}

async function sendLatestCharacterToBridge(source = "manual") {
    if (!isBridgeConnected()) {
        throw new Error("桥接未连接，已阻止发送到微信。");
    }

    const latest = latestCharacterEntryAfter(0);
    const rawReply = String(latest?.message?.mes || "").trim();
    if (!rawReply) {
        throw new Error("没有可发送的角色消息。");
    }

    const signature = `${latest.index}:${rawReply}`;
    if (source === "auto" && signature === lastAutoSentSignature) {
        return "";
    }
    if (source === "auto" && signature === lastBridgeReplySignature) {
        return "";
    }

    const filtered = applyOutboundFilter(rawReply);
    if (!filtered.ok) {
        throw new Error(filtered.reason || "出站过滤器没有得到可发送正文。");
    }

    const event = {
        event_id: `manual_tavern_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`,
        bot_id: settings().botId || "default",
        reply_to_event_id: "",
        target_character: characters?.[this_chid]?.name || "",
        delivery_channel: "wechat",
        raw: { source },
    };

    await postReplyToBridge(event, filtered, rawReply);
    lastAutoSentSignature = signature;
    settings().state.lastReplyAt = new Date().toISOString();
    saveSettingsDebounced();
    appendLog({ level: "ok", event_id: event.event_id, message: source === "auto" ? "已自动发送角色回复" : "已发送上一条角色回复" });
    return filtered.text;
}

function scheduleAutoSendLatest() {
    const cfg = settings();
    if (!cfg.enabled || !cfg.autoSendCharacterReplies || !isBridgeConnected() || isProcessing || Date.now() < suppressAutoSendUntil) {
        return;
    }
    if (autoSendTimer) {
        clearTimeout(autoSendTimer);
    }
    autoSendTimer = setTimeout(async () => {
        autoSendTimer = null;
        if (isProcessing || !settings().autoSendCharacterReplies || !isBridgeConnected() || Date.now() < suppressAutoSendUntil) {
            return;
        }
        try {
            const sent = await sendLatestCharacterToBridge("auto");
            if (sent) {
                notify("角色回复已自动交给微信桥。", "success");
            }
        } catch (error) {
            appendLog({
                level: "warn",
                event_id: "auto_send",
                message: error.message || String(error),
            });
        }
    }, 600);
}

function bindGenerationEvents() {
    if (generationEventsBound || !eventSource || !event_types) {
        return;
    }

    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, scheduleAutoSendLatest);
    }
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, scheduleAutoSendLatest);
    }
    generationEventsBound = true;
}

async function handleCodexEvent(rawPayload, source = "manual") {
    if (!settings().enabled) {
        throw new Error("扩展已关闭。");
    }

    if (isProcessing) {
        throw new Error("上一个 Codex 事件仍在处理中。");
    }

    const processingGeneration = sseGeneration;
    isProcessing = true;
    suppressAutoSendUntil = Date.now() + 15000;
    setStatus("正在处理入站事件...", "busy");

    let event;
    try {
        event = normalizeInbound(rawPayload);
        ensureNotDuplicate(event);
        appendLog({ level: "info", event_id: event.event_id, message: `已接收：${sourceLabel(source)}` });

        await prepareTarget(event);

        const tavernMessage = renderInboundMessage(event);
        const startIndex = chat.length;
        await sendMessageAsUser(tavernMessage);

        if (!settings().generateAfterInbound) {
            rememberProcessed(event);
            appendLog({ level: "ok", event_id: event.event_id, message: "已插入酒馆，未触发生成" });
            setStatus("就绪", "ok");
            return { event, reply: "" };
        }

        const generated = await Generate("normal", { automatic_trigger: true });
        const latest = latestCharacterMessageAfter(startIndex);
        const rawReply = String(latest?.mes || generated || "").trim();

        if (!rawReply) {
            throw new Error("酒馆生成没有产生角色消息。");
        }

        const filtered = applyOutboundFilter(rawReply);
        if (!filtered.ok) {
            if (source === "bridge" && (!isBridgeConnected() || processingGeneration !== sseGeneration)) {
                rememberProcessed(event);
                appendLog({ level: "warn", event_id: event.event_id, message: "桥接已断开，未回传被拦截回复" });
                setStatus("桥接已断开，未回传回复", "error");
                return { event, reply: "", rawReply, blocked: true, disconnected: true };
            }
            await postReplyToBridge(event, filtered, rawReply, "blocked", filtered.reason);
            rememberProcessed(event);
            appendLog({
                level: "warn",
                event_id: event.event_id,
                message: filtered.reason || "出站正文已被拦截",
            });
            setStatus("回复已被出站过滤器拦截", "error");
            return { event, reply: "", rawReply, blocked: true };
        }

        rememberProcessed(event);
        const latestEntry = latestCharacterEntryAfter(startIndex);
        if (latestEntry) {
            lastBridgeReplySignature = `${latestEntry.index}:${rawReply}`;
        }
        settings().state.lastReplyAt = new Date().toISOString();
        saveSettingsDebounced();

        if (source === "bridge" && (!isBridgeConnected() || processingGeneration !== sseGeneration)) {
            appendLog({ level: "warn", event_id: event.event_id, message: "桥接已断开，未回传生成回复" });
            setStatus("桥接已断开，未回传回复", "error");
            return { event, reply: "", rawReply, disconnected: true };
        }

        await postReplyToBridge(event, filtered, rawReply);
        suppressAutoSendUntil = Date.now() + 15000;
        appendLog({
            level: "ok",
            event_id: event.event_id,
            message: filtered.matched ? "已生成并过滤回复" : "已生成回复",
        });
        setStatus("就绪", "ok");
        return { event, reply: filtered.text, rawReply };
    } catch (error) {
        const message = error.message || String(error);
        appendLog({ level: "error", event_id: event?.event_id || rawPayload?.event_id || "", message });
        if (event && (source !== "bridge" || (isBridgeConnected() && processingGeneration === sseGeneration))) {
            await postReplyToBridge(event, { text: "", reason: message }, "", "error", message);
        }
        setStatus(`错误：${message}`, "error");
        throw error;
    } finally {
        isProcessing = false;
    }
}

async function checkBridgeHealth(baseUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await fetch(`${baseUrl}/health`, {
            cache: "no-store",
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function bridgeBaseUrl() {
    return settings().bridgeUrl.replace(/\/+$/, "");
}

function currentChatId() {
    try {
        return getCurrentChatId?.() || "";
    } catch {
        return "";
    }
}

function runnerHeartbeatPayload(reason = "timer", connected = Boolean(sse)) {
    const cfg = settings();
    const character = characters?.[this_chid] || {};
    return {
        bot_id: botKey(cfg.botId || "default"),
        client_id: tavernClientId(),
        owner_token: ownerToken(),
        reason,
        connected,
        processing: Boolean(isProcessing),
        visible: document.visibilityState === "visible",
        visibility_state: document.visibilityState,
        focused: document.hasFocus(),
        wake_lock: Boolean(wakeLock),
        character: character.name || "",
        character_id: String(this_chid ?? ""),
        chat_id: currentChatId(),
        last_event_at: cfg.state.lastEventAt || "",
        last_reply_at: cfg.state.lastReplyAt || "",
        href: window.location.href,
        user_agent: navigator.userAgent,
    };
}

async function postRunnerHeartbeat(reason = "timer", options = {}) {
    const baseUrl = bridgeBaseUrl();
    if (!baseUrl) return;
    const connected = options.connected ?? Boolean(sse);
    if (runnerHeartbeatInFlight && connected !== false && !options.beacon) return;
    const payload = runnerHeartbeatPayload(reason, connected);

    if (options.beacon && navigator.sendBeacon) {
        try {
            navigator.sendBeacon(`${baseUrl}/runner/heartbeat`, JSON.stringify(payload));
            return;
        } catch {}
    }

    runnerHeartbeatInFlight = true;
    try {
        await fetch(`${baseUrl}/runner/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: Boolean(options.keepalive),
        });
    } catch {
        // The SSE error handler owns visible connection status; heartbeat misses are just liveness hints.
    } finally {
        runnerHeartbeatInFlight = false;
    }
}

function startRunnerWorker() {
    if (runnerWorker || !window.Worker || !window.Blob || !window.URL) return;
    try {
        const source = `
            let timer = null;
            const beat = () => postMessage({ type: "tick", at: Date.now() });
            self.onmessage = event => {
                if (event.data?.type === "start") {
                    clearInterval(timer);
                    timer = setInterval(beat, event.data.interval || ${RUNNER_HEARTBEAT_MS});
                    beat();
                }
                if (event.data?.type === "stop") {
                    clearInterval(timer);
                    timer = null;
                    close();
                }
            };
        `;
        runnerWorkerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        runnerWorker = new Worker(runnerWorkerUrl);
        runnerWorker.onmessage = () => {
            if (sse) {
                void postRunnerHeartbeat("worker");
            }
        };
        runnerWorker.postMessage({ type: "start", interval: RUNNER_HEARTBEAT_MS });
    } catch {
        stopRunnerWorker();
    }
}

function stopRunnerWorker() {
    if (runnerWorker) {
        try {
            runnerWorker.postMessage({ type: "stop" });
            runnerWorker.terminate();
        } catch {}
        runnerWorker = null;
    }
    if (runnerWorkerUrl) {
        URL.revokeObjectURL(runnerWorkerUrl);
        runnerWorkerUrl = "";
    }
}

function startRunnerKeepalive() {
    stopRunnerKeepalive(false);
    void requestWakeLock();
    void postRunnerHeartbeat("start");
    runnerHeartbeatTimer = setInterval(() => {
        if (sse) {
            void postRunnerHeartbeat("timer");
        }
    }, RUNNER_HEARTBEAT_MS);
    startRunnerWorker();
}

function stopRunnerKeepalive(sendOffline = true) {
    if (runnerHeartbeatTimer) {
        clearInterval(runnerHeartbeatTimer);
        runnerHeartbeatTimer = null;
    }
    if (runnerRestoreTimer) {
        clearTimeout(runnerRestoreTimer);
        runnerRestoreTimer = null;
    }
    stopRunnerWorker();
    if (sendOffline) {
        void postRunnerHeartbeat("stop", { connected: false, keepalive: true });
    }
}

function restoreRunnerSoon(reason = "restore") {
    if (bridgeManuallyDisconnected) return;
    if (runnerRestoreTimer) clearTimeout(runnerRestoreTimer);
    runnerRestoreTimer = setTimeout(() => {
        runnerRestoreTimer = null;
        if (sse) {
            void requestWakeLock();
            void postRunnerHeartbeat(reason);
            return;
        }
        if (settings().autoConnect && navigator.onLine !== false) {
            void connectBridge({ claim: false });
        }
    }, RUNNER_RESTORE_DELAY_MS);
}

function adminUrlFromBridgeUrl() {
    try {
        const url = new URL(bridgeBaseUrl());
        url.port = "8790";
        return url.origin;
    } catch {
        return "http://127.0.0.1:8790";
    }
}

async function openBridgeLocalTarget(target) {
    const baseUrl = bridgeBaseUrl();
    const response = await fetch(`${baseUrl}/local/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `local open HTTP ${response.status}`);
    }
    return data;
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    return false;
}

async function connectBridgeWithBackendCheck() {
    try {
        await checkBridgeHealth(bridgeBaseUrl());
    } catch (error) {
        const message = error.name === "AbortError"
            ? "后端未响应，请先确认本地服务已启动。"
            : `后端未响应：${error.message || error}`;
        setStatus(message, "error");
        notify("后端未在线。可先打开扩展文件夹，运行 start-bridge.bat。", "error");
        appendLog({ level: "warn", event_id: "backend", message });
        return;
    }
    await connectBridge({ claim: true });
}

async function openAdminUi() {
    const url = adminUrlFromBridgeUrl();
    window.open(url, "_blank", "noopener,noreferrer");
    notify(`已打开管理页：${url}`, "success");
}

async function clearRelayQueue(queue) {
    const response = await fetch(`${adminUrlFromBridgeUrl()}/api/clear`, {
        method: "POST",
        body: JSON.stringify({ queue }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `clear ${queue} HTTP ${response.status}`);
    }
    return Number(data.cleared || 0);
}

async function clearPendingOutboundOnDisconnect() {
    try {
        const [outbox, deferred] = await Promise.all([
            clearRelayQueue("outbox"),
            clearRelayQueue("deferred"),
        ]);
        if (outbox || deferred) {
            appendLog({ level: "warn", event_id: "disconnect", message: `已清理断开后的待发送队列：待发 ${outbox}，延迟 ${deferred}` });
        }
    } catch (error) {
        appendLog({ level: "warn", event_id: "disconnect", message: `断开后清理待发送队列失败：${error.message || error}` });
    }
}

async function openLocalTargetWithFallback(target) {
    try {
        await openBridgeLocalTarget(target);
        notify("已请求系统打开扩展文件夹。", "success");
    } catch {
        await copyText(EXTENSION_RELATIVE_PATH).catch(() => false);
        notify(`后端未在线，无法让系统打开文件夹。已复制扩展相对路径：${EXTENSION_RELATIVE_PATH}`, "error");
    }
}

async function claimBridgeOwner(baseUrl, botId) {
    const owner = writeBridgeOwner(botId);
    const response = await fetch(`${baseUrl}/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            bot_id: botId,
            client_id: owner.client_id,
            owner_token: owner.owner_token,
        }),
    });
    if (!response.ok) {
        throw new Error(`owner HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.ok === false) {
        throw new Error(data.error || "owner claim failed");
    }
    return owner;
}

async function connectBridge(options = {}) {
    bridgeManuallyDisconnected = false;
    const cfg = settings();
    const botId = botKey(cfg.botId || "default");
    const shouldClaim = options.claim !== false;
    if (sse) {
        sse.close();
        sse = null;
    }
    const connectionGeneration = ++sseGeneration;

    const baseUrl = cfg.bridgeUrl.replace(/\/+$/, "");
    if (!baseUrl) {
        setStatus("桥接 URL 为空", "error");
        return;
    }

    setStatus("正在连接桥接...", "busy");
    try {
        const health = await checkBridgeHealth(baseUrl);
        appendLog({
            level: "info",
            event_id: "bridge",
            message: `健康检查通过，客户端数：${health.clients ?? 0}`,
        });
    } catch (error) {
        const message = error.name === "AbortError"
            ? "桥接服务无响应，请确认 server 已启动。"
            : `无法访问桥接服务：${error.message || error}`;
        setStatus(message, "error");
        appendLog({ level: "error", event_id: "bridge", message });
        return;
    }

    try {
        if (shouldClaim || !readBridgeOwner(botId) || isCurrentBridgeOwner(botId)) {
            await claimBridgeOwner(baseUrl, botId);
        } else {
            setStatus("已有其他酒馆窗口接管此 Bot ID，点击连接可接管", "error");
            return;
        }
    } catch (error) {
        const message = `接管桥接失败：${error.message || error}`;
        setStatus(message, "error");
        appendLog({ level: "error", event_id: "bridge_owner", message });
        return;
    }

    const botParam = encodeURIComponent(botId);
    const clientParam = encodeURIComponent(tavernClientId());
    const streamParam = encodeURIComponent(randomId("stream"));
    const ownerParam = encodeURIComponent(ownerToken());
    const currentSse = new EventSource(`${baseUrl}/events?client=tavern&bot_id=${botParam}&client_id=${clientParam}&owner_token=${ownerParam}&stream_id=${streamParam}`);
    sse = currentSse;

    currentSse.onopen = () => {
        if (sse !== currentSse || sseGeneration !== connectionGeneration) return;
        setStatus(`桥接已连接：${cfg.botId || "default"}`, "ok");
        startRunnerKeepalive();
    };
    currentSse.onerror = () => {
        if (sse !== currentSse || sseGeneration !== connectionGeneration) return;
        setStatus("桥接断开或无法访问", "error");
        currentSse.close();
        sse = null;
        stopRunnerKeepalive(false);
        void postRunnerHeartbeat("sse_error", { connected: false, keepalive: true });
        restoreRunnerSoon("sse_error");
    };
    currentSse.addEventListener("replaced", () => {
        if (sse !== currentSse || sseGeneration !== connectionGeneration) return;
        currentSse.close();
        sse = null;
        stopRunnerKeepalive();
        releaseWakeLock();
        bridgeManuallyDisconnected = true;
        setStatus("已被另一个同 Bot ID 的酒馆页面接管", "error");
    });
    currentSse.onmessage = async message => {
        if (sse !== currentSse || sseGeneration !== connectionGeneration) return;
        void postRunnerHeartbeat("message");
        try {
            const payload = JSON.parse(message.data);
            const inbound = payload?.kind === "event" ? payload.event : payload;
            await handleCodexEvent(inbound, "bridge");
        } catch (error) {
            notify(error.message || String(error), "error");
        }
    };
}

function disconnectBridge(reason = "桥接已断开", tone = "", options = {}) {
    bridgeManuallyDisconnected = options.manual !== false;
    sseGeneration += 1;
    if (sse) {
        sse.close();
        sse = null;
    }
    stopRunnerKeepalive();
    releaseWakeLock();
    if (bridgeManuallyDisconnected) {
        void clearPendingOutboundOnDisconnect();
    }
    setStatus(reason, tone);
}

async function requestWakeLock() {
    if (wakeLock || !settings().keepAwake || !("wakeLock" in navigator) || document.visibilityState !== "visible") {
        return;
    }
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
            wakeLock = null;
        });
        if (!wakeLockLogShown) {
            wakeLockLogShown = true;
            appendLog({ level: "info", event_id: "wake_lock", message: "前端保活已启用" });
        }
    } catch (error) {
        if (!wakeLockWarnShown) {
            wakeLockWarnShown = true;
            appendLog({ level: "warn", event_id: "wake_lock", message: `前端保活不可用：${error.message || error}` });
        }
    }
}

function releaseWakeLock() {
    if (!wakeLock) return;
    void wakeLock.release().catch(() => {});
    wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        restoreRunnerSoon("visible");
    } else if (sse) {
        void postRunnerHeartbeat("hidden");
    }
});

window.addEventListener("focus", () => restoreRunnerSoon("focus"));
window.addEventListener("online", () => restoreRunnerSoon("online"));
window.addEventListener("pageshow", () => restoreRunnerSoon("pageshow"));
window.addEventListener("pagehide", () => {
    if (sse) {
        void postRunnerHeartbeat("pagehide", { beacon: true, connected: false });
    }
});
window.addEventListener("beforeunload", () => {
    if (sse) {
        void postRunnerHeartbeat("beforeunload", { beacon: true, connected: false });
    }
});

window.addEventListener("storage", event => {
    const botId = botKey(settings().botId || "default");
    if (event.key !== bridgeOwnerKey(botId) || !sse) return;
    if (!isCurrentBridgeOwner(botId)) {
        disconnectBridge("已被另一个同 Bot ID 的酒馆页面接管", "error");
    }
});

function settingsHtml() {
    return `
<div id="codex_tavern_bridge_settings" class="codex-tavern-bridge-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Codex 酒馆桥接</b>
      <div id="ctb_status" class="ctb-status">就绪</div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label"><input id="ctb_enabled" type="checkbox"> 启用扩展</label>
      <div class="ctb-grid">
        <label for="ctb_bridge_url">桥接地址</label>
        <input id="ctb_bridge_url" class="text_pole" type="text">
        <label for="ctb_bot_id">Bot ID</label>
        <input id="ctb_bot_id" class="text_pole" type="text" placeholder="default">
        <label for="ctb_outbound_regex">出站正文正则</label>
        <input id="ctb_outbound_regex" class="text_pole" type="text" placeholder="<ctb>([\\s\\S]*?)</ctb>">
      </div>
      <div class="ctb-help">发送正文优先提取所有 &lt;message&gt;...&lt;/message&gt;；没有匹配时才使用下面配置的出站正则。</div>
      <div class="ctb-row">
        <label class="checkbox_label ctb-tip" data-tip="打开酒馆页面时自动尝试连接桥接。若已有其他窗口接管同一个 Bot ID，不会主动抢占。"><input id="ctb_auto_connect" type="checkbox"> 自动连接桥接</label>
        <label class="checkbox_label ctb-tip" data-tip="连接成功后在当前酒馆页面维持 SSE、heartbeat 与浏览器 Wake Lock；不会另开专用窗口。"><input id="ctb_keep_awake" type="checkbox"> 前端保活</label>
        <label class="checkbox_label ctb-tip" data-tip="入站事件带 target_character 时，先切换到同名角色卡，再把消息交给酒馆生成。"><input id="ctb_auto_switch" type="checkbox"> 自动切换角色</label>
        <label class="checkbox_label ctb-tip" data-tip="开启后，入站事件必须能找到目标角色；找不到或未提供 target_character 就报错，避免消息落到误开的聊天。"><input id="ctb_require_target" type="checkbox"> 必须指定目标角色</label>
        <label class="checkbox_label ctb-tip" data-tip="入站指微信消息或定时任务经桥接服务进入酒馆。开启后，插件会插入该消息并自动触发角色生成回复。"><input id="ctb_generate" type="checkbox"> 入站后自动生成</label>
        <label class="checkbox_label ctb-tip" data-tip="角色生成结束后，自动提取 <message> 标签正文并回传给桥接服务，由后端发到微信。"><input id="ctb_auto_send_character" type="checkbox"> 角色回复自动发微信</label>
        <label class="checkbox_label ctb-tip" data-tip="没有找到 <message> 正文，也没有命中出站正文正则时，阻止整段原文被发到微信。"><input id="ctb_block_regex_miss" type="checkbox"> 正则未命中时拦截</label>
      </div>
      <div class="ctb-row">
        <button id="ctb_connect" class="menu_button">检测并连接桥接</button>
        <button id="ctb_disconnect" class="menu_button">断开连接</button>
        <button id="ctb_send_latest" class="menu_button">发送上一条角色回复</button>
      </div>
      <div class="ctb-launch-panel">
        <div class="ctb-launch-title">本地入口</div>
        <div class="ctb-help">连接按钮会先检测后端；需要维护时打开控制台或扩展文件夹。</div>
        <div class="ctb-row">
          <button id="ctb_open_admin" class="menu_button">打开控制台</button>
          <button id="ctb_open_extension_folder" class="menu_button">打开扩展文件夹</button>
        </div>
      </div>
      <div id="ctb_log" class="ctb-log"></div>
    </div>
  </div>
</div>`;
}

function bindSettingsUi() {
    const cfg = settings();
    $("#ctb_enabled").prop("checked", cfg.enabled);
    $("#ctb_bridge_url").val(cfg.bridgeUrl);
    $("#ctb_bot_id").val(cfg.botId);
    $("#ctb_outbound_regex").val(cfg.outboundRegex);
    $("#ctb_auto_connect").prop("checked", cfg.autoConnect);
    $("#ctb_keep_awake").prop("checked", cfg.keepAwake);
    $("#ctb_auto_switch").prop("checked", cfg.autoSwitchCharacter);
    $("#ctb_require_target").prop("checked", cfg.requireTargetCharacter);
    $("#ctb_generate").prop("checked", cfg.generateAfterInbound);
    $("#ctb_auto_send_character").prop("checked", cfg.autoSendCharacterReplies);
    $("#ctb_block_regex_miss").prop("checked", cfg.blockWhenRegexMisses);

    saveInputValue("ctb_enabled", "enabled");
    saveInputValue("ctb_bridge_url", "bridgeUrl");
    saveInputValue("ctb_bot_id", "botId", value => String(value || "default").trim() || "default");
    saveInputValue("ctb_outbound_regex", "outboundRegex");
    saveInputValue("ctb_auto_connect", "autoConnect");
    saveInputValue("ctb_keep_awake", "keepAwake", value => {
        if (!value) releaseWakeLock();
        if (value && sse) void requestWakeLock();
        return value;
    });
    saveInputValue("ctb_auto_switch", "autoSwitchCharacter");
    saveInputValue("ctb_require_target", "requireTargetCharacter");
    saveInputValue("ctb_generate", "generateAfterInbound");
    saveInputValue("ctb_auto_send_character", "autoSendCharacterReplies");
    saveInputValue("ctb_block_regex_miss", "blockWhenRegexMisses");

    $("#ctb_connect").on("click", () => connectBridgeWithBackendCheck());
    $("#ctb_disconnect").on("click", () => disconnectBridge());
    $("#ctb_open_admin").on("click", () => openAdminUi());
    $("#ctb_open_extension_folder").on("click", () => openLocalTargetWithFallback("extension"));
    $("#ctb_send_latest").on("click", async () => {
        try {
            await sendLatestCharacterToBridge();
            notify("上一条角色回复已交给微信桥。", "success");
        } catch (error) {
            notify(error.message || String(error), "error");
        }
    });

    renderLog();
}

async function init() {
    settings();
    const container = document.getElementById("extensions_settings");
    if (!container) return;

    if (!document.getElementById("codex_tavern_bridge_settings")) {
        container.insertAdjacentHTML("beforeend", settingsHtml());
    }

    bindSettingsUi();
    bindGenerationEvents();

    window.CodexTavernBridge = {
        handleEvent: handleCodexEvent,
        validateEvent: payload => normalizeInbound(payload),
        filterReply: applyOutboundFilter,
        sendLatest: sendLatestCharacterToBridge,
        connect: () => connectBridge({ claim: true }),
        disconnect: disconnectBridge,
        settings,
    };

    const params = keepaliveParams();
    if (params.get("ctb_bot_id")) {
        settings().botId = botKey(params.get("ctb_bot_id"));
        saveSettingsDebounced();
    }
    if (isKeepalivePage() || params.get("ctb_auto_connect") === "1") {
        settings().autoConnect = true;
        settings().keepAwake = true;
        saveSettingsDebounced();
        appendLog({ level: "info", event_id: "keepalive", message: "当前酒馆页面已作为内部保活页面接入" });
    }
    if (settings().autoConnect || params.get("ctb_auto_connect") === "1" || isKeepalivePage()) {
        connectBridge({ claim: false });
    }
}

jQuery(init);

export { handleCodexEvent };

