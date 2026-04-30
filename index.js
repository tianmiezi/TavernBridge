import { extension_settings } from "../../../extensions.js";
import {
    Generate,
    chat,
    characters,
    eventSource,
    event_types,
    saveSettingsDebounced,
    selectCharacterById,
    sendMessageAsUser,
    this_chid,
} from "../../../../script.js";

const EXT_ID = "codex_tavern_bridge";
const PROTOCOL = "codex_tavern_event";
const REPLY_PROTOCOL = "codex_tavern_reply";
const MAX_LOG_ITEMS = 50;
const LEGACY_TEMPLATE_MARKERS = [
    "[Codex 自动化事件]",
    "[Codex Automation Event]",
    "metadata_json:",
    "{{json}}",
];

const DEFAULT_SETTINGS = {
    enabled: true,
    bridgeUrl: "http://127.0.0.1:8787",
    botId: "default",
    autoConnect: false,
    autoSwitchCharacter: true,
    requireTargetCharacter: false,
    blockDuplicateEvents: true,
    generateAfterInbound: true,
    autoSendCharacterReplies: true,
    outboundRegex: "",
    outboundRegexFlags: "",
    outboundRegexGroup: 1,
    blockWhenRegexMisses: true,
    inboundTemplate: "",
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
    if (LEGACY_TEMPLATE_MARKERS.some(marker => String(extension_settings[EXT_ID].inboundTemplate || "").includes(marker))) {
        extension_settings[EXT_ID].inboundTemplate = "";
        saveSettingsDebounced();
    }
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

function compactMetadata(event) {
    return {
        event_id: event.event_id,
        bot_id: event.bot_id,
        created_at: event.created_at,
        type: event.type,
        intent: event.intent,
        priority: event.priority,
        reason: event.reason,
        target_character: event.target_character,
        conversation_id: event.conversation_id,
        task: {
            title: event.task_title,
            status: event.task_status,
            subject: event.task_subject,
            duration_minutes: event.duration_minutes || undefined,
            suggested_first_step: event.suggested_first_step,
        },
        user_context: event.user_context,
        user_message: event.user_message,
        delivery_channel: event.delivery_channel,
        reply_to_event_id: event.reply_to_event_id,
    };
}

function renderInboundMessage(event) {
    const customTemplate = String(settings().inboundTemplate || "").trim();
    if (!customTemplate) {
        return renderCompactInboundMessage(event);
    }

    const values = {
        event_id: event.event_id,
        bot_id: event.bot_id,
        created_at: event.created_at,
        local_time: formatLocalTime(event.created_at),
        event_label: eventLabel(event),
        bot_id: event.bot_id,
        type: event.type,
        intent: event.intent,
        priority: event.priority,
        reason: event.reason,
        target_character: event.target_character,
        conversation_id: event.conversation_id,
        task_title: event.task_title,
        task_status: event.task_status,
        task_subject: event.task_subject,
        suggested_first_step: event.suggested_first_step,
        user_message: event.user_message,
        delivery_channel: event.delivery_channel,
        reply_to_event_id: event.reply_to_event_id,
        json: JSON.stringify(compactMetadata(event), null, 2),
    };

    return customTemplate
        .replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
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
    if (!cfg.enabled || !cfg.autoSendCharacterReplies || isProcessing || Date.now() < suppressAutoSendUntil) {
        return;
    }
    if (autoSendTimer) {
        clearTimeout(autoSendTimer);
    }
    autoSendTimer = setTimeout(async () => {
        autoSendTimer = null;
        if (isProcessing || !settings().autoSendCharacterReplies || Date.now() < suppressAutoSendUntil) {
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
        if (event) {
            await postReplyToBridge(event, { text: "", reason: message }, "", "error", message);
        }
        setStatus(`错误：${message}`, "error");
        throw error;
    } finally {
        isProcessing = false;
    }
}

function parseManualJson() {
    const textarea = document.getElementById("ctb_manual_payload");
    if (!textarea) throw new Error("找不到手动 JSON 输入框。");
    return JSON.parse(textarea.value);
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

async function connectBridge() {
    const cfg = settings();
    if (sse) {
        sse.close();
        sse = null;
    }

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

    const botParam = encodeURIComponent(String(cfg.botId || "default").trim() || "default");
    sse = new EventSource(`${baseUrl}/events?client=tavern&bot_id=${botParam}`);

    sse.onopen = () => setStatus(`桥接已连接：${cfg.botId || "default"}`, "ok");
    sse.onerror = () => setStatus("桥接断开或无法访问", "error");
    sse.onmessage = async message => {
        try {
            const payload = JSON.parse(message.data);
            const inbound = payload?.kind === "event" ? payload.event : payload;
            await handleCodexEvent(inbound, "bridge");
        } catch (error) {
            notify(error.message || String(error), "error");
        }
    };
}

function disconnectBridge() {
    if (sse) {
        sse.close();
        sse = null;
    }
    setStatus("桥接已断开", "");
}

function samplePayload() {
    return {
        protocol: PROTOCOL,
        schema_version: "1.0",
        event_id: `evt_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}_study_001`,
        bot_id: settings().botId || "default",
        created_at: new Date().toISOString(),
        ttl_seconds: 900,
        type: "study_reminder",
        intent: "gentle_nudge",
        target_character: "",
        conversation_id: "daily_study_checkin",
        language: "zh-CN",
        task: "学习 Python 45 分钟",
        suggested_first_step: "打开昨天的笔记，先复习列表和字典",
        delivery_channel: "wechat",
    };
}
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
        <label for="ctb_outbound_flags">正则标志</label>
        <input id="ctb_outbound_flags" class="text_pole" type="text" placeholder="i">
        <label for="ctb_outbound_group">捕获组编号</label>
        <input id="ctb_outbound_group" class="text_pole" type="number" min="0" max="20">
      </div>
      <div class="ctb-help">发送正文优先提取所有 &lt;message&gt;...&lt;/message&gt;；没有匹配时才使用下面配置的出站正则。</div>
      <div class="ctb-row">
        <label class="checkbox_label"><input id="ctb_auto_connect" type="checkbox"> 自动连接桥接</label>
        <label class="checkbox_label"><input id="ctb_auto_switch" type="checkbox"> 自动切换角色</label>
        <label class="checkbox_label"><input id="ctb_require_target" type="checkbox"> 必须指定目标角色</label>
        <label class="checkbox_label"><input id="ctb_generate" type="checkbox"> 入站后自动生成</label>
        <label class="checkbox_label"><input id="ctb_auto_send_character" type="checkbox"> 角色回复自动发微信</label>
        <label class="checkbox_label"><input id="ctb_block_regex_miss" type="checkbox"> 正则未命中时拦截</label>
      </div>
      <label for="ctb_inbound_template">入站消息模板</label>
      <textarea id="ctb_inbound_template" class="text_pole ctb-template" spellcheck="false"></textarea>
      <div class="ctb-row">
        <button id="ctb_connect" class="menu_button">连接桥接</button>
        <button id="ctb_disconnect" class="menu_button">断开连接</button>
        <button id="ctb_load_sample" class="menu_button">载入示例</button>
        <button id="ctb_validate" class="menu_button">校验 JSON</button>
        <button id="ctb_run_manual" class="menu_button">手动运行事件</button>
        <button id="ctb_send_latest" class="menu_button">发送上一条角色回复</button>
      </div>
      <textarea id="ctb_manual_payload" class="text_pole ctb-payload" spellcheck="false"></textarea>
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
    $("#ctb_outbound_flags").val(cfg.outboundRegexFlags);
    $("#ctb_outbound_group").val(cfg.outboundRegexGroup);
    $("#ctb_auto_connect").prop("checked", cfg.autoConnect);
    $("#ctb_auto_switch").prop("checked", cfg.autoSwitchCharacter);
    $("#ctb_require_target").prop("checked", cfg.requireTargetCharacter);
    $("#ctb_generate").prop("checked", cfg.generateAfterInbound);
    $("#ctb_auto_send_character").prop("checked", cfg.autoSendCharacterReplies);
    $("#ctb_block_regex_miss").prop("checked", cfg.blockWhenRegexMisses);
    $("#ctb_inbound_template").val(cfg.inboundTemplate);
    $("#ctb_manual_payload").val(JSON.stringify(samplePayload(), null, 2));

    saveInputValue("ctb_enabled", "enabled");
    saveInputValue("ctb_bridge_url", "bridgeUrl");
    saveInputValue("ctb_bot_id", "botId", value => String(value || "default").trim() || "default");
    saveInputValue("ctb_outbound_regex", "outboundRegex");
    saveInputValue("ctb_outbound_flags", "outboundRegexFlags");
    saveInputValue("ctb_outbound_group", "outboundRegexGroup", value => Number(value || 1));
    saveInputValue("ctb_auto_connect", "autoConnect");
    saveInputValue("ctb_auto_switch", "autoSwitchCharacter");
    saveInputValue("ctb_require_target", "requireTargetCharacter");
    saveInputValue("ctb_generate", "generateAfterInbound");
    saveInputValue("ctb_auto_send_character", "autoSendCharacterReplies");
    saveInputValue("ctb_block_regex_miss", "blockWhenRegexMisses");
    saveInputValue("ctb_inbound_template", "inboundTemplate");

    $("#ctb_connect").on("click", connectBridge);
    $("#ctb_disconnect").on("click", disconnectBridge);
    $("#ctb_load_sample").on("click", () => $("#ctb_manual_payload").val(JSON.stringify(samplePayload(), null, 2)));
    $("#ctb_validate").on("click", () => {
        try {
            normalizeInbound(parseManualJson());
            notify("JSON 事件有效。", "success");
        } catch (error) {
            notify(error.message || String(error), "error");
        }
    });
    $("#ctb_run_manual").on("click", async () => {
        try {
            await handleCodexEvent(parseManualJson(), "manual");
            notify("手动事件已处理。", "success");
        } catch (error) {
            notify(error.message || String(error), "error");
        }
    });
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
        connect: connectBridge,
        disconnect: disconnectBridge,
        settings,
    };

    if (settings().autoConnect) {
        connectBridge();
    }
}

jQuery(init);

export { handleCodexEvent };

