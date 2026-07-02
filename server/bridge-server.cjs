#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const host = process.env.CTB_HOST || "127.0.0.1";
const port = Number(process.env.CTB_PORT || 8787);
const adminPort = Number(process.env.WEIXIN_RELAY_ADMIN_PORT || 8790);
const protocol = "codex_tavern_event";
const extensionDir = path.resolve(__dirname, "..");
const startScriptPath = path.join(extensionDir, "start-bridge.bat");
const connectorDir = path.resolve(process.env.CTB_CONNECTOR_DIR || path.join(os.homedir(), ".codexbridge-weixin", "tavern-connector"));
const inboxDir = path.join(connectorDir, "inbox");
const outboxDir = path.join(connectorDir, "outbox");
const processedDir = path.join(inboxDir, "processed");
const pollMs = Math.max(500, Number(process.env.CTB_FILE_POLL_MS || 1000));
const clients = new Map();
const owners = new Map();
const runnerHeartbeats = new Map();
const replacedStreams = new Map();
const replies = [];
const seenFiles = new Set();
const REPLACED_STREAM_TTL_MS = 5 * 60 * 1000;
const RUNNER_HEARTBEAT_TTL_MS = Math.max(15000, Number(process.env.CTB_RUNNER_HEARTBEAT_TTL_MS || 300000));

function botKey(botId) {
    return String(botId || "default").trim() || "default";
}

function streamKey(streamId) {
    return String(streamId || randomUUID()).trim() || randomUUID();
}

function runnerKey(botId, clientId) {
    return `${botKey(botId)}:${String(clientId || "").trim()}`;
}

function pruneRunnerHeartbeats() {
    const now = Date.now();
    for (const [key, heartbeat] of runnerHeartbeats.entries()) {
        if (now - Number(heartbeat.last_seen_ms || 0) > RUNNER_HEARTBEAT_TTL_MS * 2) {
            runnerHeartbeats.delete(key);
        }
    }
}

function runnerHeartbeatForClient(client) {
    return runnerHeartbeats.get(runnerKey(client.bot_id, client.client_id));
}

function isHealthyRunner(client) {
    const heartbeat = runnerHeartbeatForClient(client);
    if (!heartbeat || heartbeat.connected === false) {
        return false;
    }
    return Date.now() - Number(heartbeat.last_seen_ms || 0) <= RUNNER_HEARTBEAT_TTL_MS;
}

function healthyClientsForEvent(event) {
    pruneRunnerHeartbeats();
    const botId = String(event?.bot_id || event?.metadata?.bot_id || "").trim();
    const allClients = Array.from(clients.values());
    const targetClients = botId
        ? allClients.filter(client => client.bot_id === botKey(botId) && isHealthyRunner(client))
        : allClients.filter(isHealthyRunner);
    const fallbackClients = botId && targetClients.length === 0
        ? allClients.filter(client => client.bot_id === "default" && isHealthyRunner(client))
        : [];
    return [...targetClients, ...fallbackClients];
}

function closeBotClients(botId, reason = "A newer Tavern client connected for this bot_id.") {
    for (const [clientId, client] of clients.entries()) {
        if (client.bot_id !== botId) continue;
        try {
            client.res.write(`event: replaced\ndata: ${JSON.stringify({ ok: false, reason })}\n\n`);
            client.res.end();
        } catch {}
        replacedStreams.set(client.stream_id, Date.now() + REPLACED_STREAM_TTL_MS);
        clients.delete(clientId);
    }
}

function pruneReplacedStreams() {
    const now = Date.now();
    for (const [streamId, expiresAt] of replacedStreams.entries()) {
        if (expiresAt <= now) {
            replacedStreams.delete(streamId);
        }
    }
}

function localInfo() {
    return {
        ok: true,
        platform: process.platform,
        extension_dir: extensionDir,
        server_dir: __dirname,
        start_script: startScriptPath,
        admin_url: `http://${host}:${adminPort}`,
        bridge_url: `http://${host}:${port}`,
    };
}

function openLocalTarget(target) {
    const targets = {
        extension: extensionDir,
        server: __dirname,
        start_script: startScriptPath,
    };
    if (target === "admin") {
        openExternal(`http://${host}:${adminPort}`);
        return;
    }
    const resolved = targets[target];
    if (!resolved) {
        throw new Error("Unsupported local target.");
    }
    if (process.platform === "win32" && target === "start_script") {
        spawn("explorer.exe", ["/select,", resolved], { detached: true, stdio: "ignore" }).unref();
        return;
    }
    openExternal(resolved);
}

function openExternal(targetPath) {
    const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    spawn(command, [targetPath], { detached: true, stdio: "ignore" }).unref();
}

function corsHeaders(extra = {}) {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        ...extra,
    };
}

function sendJson(res, status, data) {
    res.writeHead(status, corsHeaders({ "Content-Type": "application/json; charset=utf-8" }));
    res.end(JSON.stringify(data, null, 2));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", chunk => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error("Request body too large."));
                req.destroy();
            }
        });
        req.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(new Error(`Invalid JSON: ${error.message}`));
            }
        });
        req.on("error", reject);
    });
}

function validateEvent(payload) {
    const envelope = payload && payload.event && payload.event.protocol === protocol ? payload.event : payload;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
        throw new Error("Payload must be a JSON object.");
    }
    if (envelope.protocol !== protocol) {
        throw new Error(`Unsupported protocol: ${envelope.protocol || "(missing)"}`);
    }
    if (!envelope.event_id || typeof envelope.event_id !== "string") {
        throw new Error("event_id is required.");
    }
    if (!envelope.created_at || Number.isNaN(Date.parse(envelope.created_at))) {
        throw new Error("created_at must be a parseable timestamp.");
    }
    return envelope;
}

function isExpiredEvent(event) {
    const ttlSeconds = Number(event.ttl_seconds || 0);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        return false;
    }
    return Date.now() - Date.parse(event.created_at) > ttlSeconds * 1000;
}

function sseWrite(client, data) {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastEvent(event) {
    const payload = {
        kind: "event",
        id: randomUUID(),
        received_at: new Date().toISOString(),
        event,
    };
    const targetClients = healthyClientsForEvent(event);
    for (const client of targetClients) {
        sseWrite(client, payload);
    }
    return targetClients.length;
}

async function ensureConnectorDirs() {
    await fsp.mkdir(inboxDir, { recursive: true });
    await fsp.mkdir(outboxDir, { recursive: true });
    await fsp.mkdir(processedDir, { recursive: true });
}

async function pollInboxOnce() {
    await ensureConnectorDirs();
    const entries = await fsp.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(inboxDir, entry.name);
        if (seenFiles.has(filePath)) continue;
        try {
            const raw = await fsp.readFile(filePath, "utf8");
            const event = validateEvent(JSON.parse(raw));
            if (isExpiredEvent(event)) {
                seenFiles.add(filePath);
                await moveProcessed(filePath, entry.name);
                console.log(`[file:expired] ${entry.name} ${event.event_id}`);
                continue;
            }
            const delivered = broadcastEvent(event);
            if (delivered <= 0) {
                continue;
            }
            seenFiles.add(filePath);
            await moveProcessed(filePath, entry.name);
            console.log(`[file:event] ${entry.name} ${event.event_id} -> ${delivered} healthy tavern runner(s)`);
        } catch (error) {
            seenFiles.add(filePath);
            console.error(`[file:error] ${entry.name}: ${error.message || error}`);
        }
    }
}

async function moveProcessed(filePath, fileName) {
    const target = path.join(processedDir, fileName);
    await fsp.rename(filePath, target).catch(async () => {
        await fsp.copyFile(filePath, target);
        await fsp.unlink(filePath);
    });
}

async function writeReplyFile(reply) {
    const eventId = String(reply.event_id || "").trim();
    if (!eventId) return;
    await ensureConnectorDirs();
    const text = String(reply.text || "").trim();
    const rawEvent = reply.raw_event && typeof reply.raw_event === "object" ? reply.raw_event : {};
    const payload = {
        protocol: "codex_tavern_reply",
        schema_version: "1.0",
        event_id: eventId,
        bot_id: reply.bot_id || rawEvent.bot_id || "",
        reply_to_event_id: reply.reply_to_event_id || "",
        created_at: new Date().toISOString(),
        status: reply.status || "ok",
        text,
        error: reply.error || "",
        raw_text: reply.raw_text || "",
        delivery_channel: reply.delivery_channel || rawEvent.delivery_channel || "",
        wechat_scope_id: reply.wechat_scope_id || rawEvent.wechat_scope_id || "",
        raw_event: rawEvent,
    };
    const finalPath = path.join(outboxDir, `${eventId}.json`);
    const tempPath = path.join(outboxDir, `${eventId}.${Date.now()}.tmp`);
    await fsp.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fsp.rename(tempPath, finalPath).catch(async () => {
        await fsp.copyFile(tempPath, finalPath);
        await fsp.unlink(tempPath);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
        pruneRunnerHeartbeats();
        const runnerList = Array.from(runnerHeartbeats.values()).map(runner => ({
            bot_id: runner.bot_id,
            client_id: runner.client_id,
            connected: runner.connected,
            visible: runner.visible,
            focused: runner.focused,
            processing: runner.processing,
            wake_lock: runner.wake_lock,
            character: runner.character,
            chat_id: runner.chat_id,
            updated_at: runner.updated_at,
            age_ms: Date.now() - Number(runner.last_seen_ms || 0),
        }));
        sendJson(res, 200, {
            ok: true,
            clients: clients.size,
            runners: runnerList.length,
            healthy_runners: Array.from(clients.values()).filter(isHealthyRunner).length,
            owners: Array.from(owners.entries()).map(([bot_id, owner]) => ({
                bot_id,
                client_id: owner.client_id,
                updated_at: owner.updated_at,
            })),
            client_bots: Array.from(clients.values()).map(client => ({
                id: client.id,
                bot_id: client.bot_id,
                client_id: client.client_id,
                stream_id: client.stream_id,
                connected_at: client.connected_at,
            })),
            replies: replies.length,
            runner_heartbeat_ttl_ms: RUNNER_HEARTBEAT_TTL_MS,
            runner_bots: runnerList,
            connector_dir: connectorDir,
            inbox_dir: inboxDir,
            outbox_dir: outboxDir,
            now: new Date().toISOString(),
        });
        return;
    }

    if (req.method === "POST" && url.pathname === "/runner/heartbeat") {
        try {
            const body = await readJson(req);
            const bot_id = botKey(body.bot_id || "default");
            const client_id = streamKey(body.client_id);
            const now = Date.now();
            runnerHeartbeats.set(runnerKey(bot_id, client_id), {
                bot_id,
                client_id,
                owner_token: String(body.owner_token || ""),
                reason: String(body.reason || ""),
                connected: body.connected !== false,
                processing: Boolean(body.processing),
                visible: Boolean(body.visible),
                visibility_state: String(body.visibility_state || ""),
                focused: Boolean(body.focused),
                wake_lock: Boolean(body.wake_lock),
                character: String(body.character || ""),
                character_id: String(body.character_id || ""),
                chat_id: String(body.chat_id || ""),
                href: String(body.href || ""),
                user_agent: String(body.user_agent || ""),
                last_event_at: String(body.last_event_at || ""),
                last_reply_at: String(body.last_reply_at || ""),
                updated_at: new Date(now).toISOString(),
                last_seen_ms: now,
            });
            sendJson(res, 200, { ok: true, bot_id, client_id, ttl_ms: RUNNER_HEARTBEAT_TTL_MS });
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/local/info") {
        sendJson(res, 200, localInfo());
        return;
    }

    if (req.method === "POST" && url.pathname === "/local/open") {
        try {
            const body = await readJson(req);
            openLocalTarget(String(body.target || ""));
            sendJson(res, 200, { ok: true, ...localInfo() });
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/owner") {
        try {
            const body = await readJson(req);
            const bot_id = botKey(body.bot_id || "default");
            const client_id = streamKey(body.client_id);
            const owner_token = streamKey(body.owner_token);
            owners.set(bot_id, {
                client_id,
                owner_token,
                updated_at: new Date().toISOString(),
            });
            closeBotClients(bot_id, "A Tavern window claimed ownership for this bot_id.");
            sendJson(res, 200, { ok: true, bot_id, client_id });
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
        const id = randomUUID();
        const bot_id = botKey(url.searchParams.get("bot_id") || url.searchParams.get("bot") || "default");
        const client_id = streamKey(url.searchParams.get("client_id"));
        const stream_id = streamKey(url.searchParams.get("stream_id"));
        const owner_token = String(url.searchParams.get("owner_token") || "").trim();
        const owner = owners.get(bot_id);
        if (owner && owner.owner_token !== owner_token) {
            res.writeHead(204, corsHeaders());
            res.end();
            return;
        }
        if (!owner && owner_token) {
            owners.set(bot_id, {
                client_id,
                owner_token,
                updated_at: new Date().toISOString(),
            });
        }
        pruneReplacedStreams();
        if (replacedStreams.has(stream_id)) {
            const activeClient = Array.from(clients.values()).find(client => (
                client.bot_id === bot_id && client.stream_id !== stream_id
            ));
            if (activeClient) {
                res.writeHead(204, corsHeaders());
                res.end();
                return;
            }
            replacedStreams.delete(stream_id);
        }
        for (const [clientId, client] of clients.entries()) {
            if (client.bot_id === bot_id) {
                try {
                    client.res.write(`event: replaced\ndata: ${JSON.stringify({ ok: false, reason: "A newer Tavern client connected for this bot_id." })}\n\n`);
                    client.res.end();
                } catch {}
                if (client.stream_id !== stream_id) {
                    replacedStreams.set(client.stream_id, Date.now() + REPLACED_STREAM_TTL_MS);
                }
                clients.delete(clientId);
            }
        }
        res.writeHead(200, corsHeaders({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        }));
        res.write(": connected\n\n");
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
        clients.set(id, { id, bot_id, client_id, owner_token, stream_id, res, connected_at: new Date().toISOString() });
        req.on("close", () => {
            clearInterval(heartbeat);
            clients.delete(id);
            const heartbeatEntry = runnerHeartbeats.get(runnerKey(bot_id, client_id));
            if (heartbeatEntry) {
                heartbeatEntry.connected = false;
                heartbeatEntry.updated_at = new Date().toISOString();
            }
        });
        return;
    }

    if (req.method === "POST" && (url.pathname === "/event" || url.pathname === "/inbound")) {
        try {
            const payload = await readJson(req);
            const event = validateEvent(payload);
            if (isExpiredEvent(event)) {
                sendJson(res, 410, { ok: false, error: "Event has expired.", event_id: event.event_id });
                return;
            }
            const delivered = broadcastEvent(event);
            sendJson(res, 202, {
                ok: true,
                accepted: true,
                event_id: event.event_id,
                tavern_clients: delivered,
                connected_clients: clients.size,
            });
            console.log(`[event] ${event.event_id} -> ${delivered} healthy tavern runner(s)`);
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "POST" && url.pathname === "/reply") {
        try {
            const reply = await readJson(req);
            replies.unshift({
                received_at: new Date().toISOString(),
                ...reply,
            });
            replies.splice(100);
            await writeReplyFile(reply);
            sendJson(res, 200, { ok: true, stored: true, event_id: reply.event_id || "" });
            console.log(`[reply] ${reply.event_id || "(no event_id)"} ${reply.status || "ok"}: ${reply.text || reply.error || ""}`);
        } catch (error) {
            sendJson(res, 400, { ok: false, error: error.message });
        }
        return;
    }

    if (req.method === "GET" && url.pathname === "/replies") {
        sendJson(res, 200, { ok: true, replies });
        return;
    }

    sendJson(res, 404, { ok: false, error: "Not found." });
});

server.listen(port, host, () => {
    console.log(`Codex Tavern Bridge listening on http://${host}:${port}`);
    console.log("POST /event or /inbound to push a codex_tavern_event into SillyTavern.");
    console.log(`File connector: ${connectorDir}`);
    console.log(`Polling ${inboxDir} every ${pollMs}ms; writing replies to ${outboxDir}.`);
});

ensureConnectorDirs()
    .then(() => setInterval(() => pollInboxOnce().catch(error => console.error(`[file:poll] ${error.message || error}`)), pollMs))
    .catch(error => console.error(`[file:init] ${error.message || error}`));
