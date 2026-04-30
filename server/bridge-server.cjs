#!/usr/bin/env node

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const host = process.env.CTB_HOST || "127.0.0.1";
const port = Number(process.env.CTB_PORT || 8787);
const protocol = "codex_tavern_event";
const connectorDir = path.resolve(process.env.CTB_CONNECTOR_DIR || path.join(os.homedir(), ".codexbridge-weixin", "tavern-connector"));
const inboxDir = path.join(connectorDir, "inbox");
const outboxDir = path.join(connectorDir, "outbox");
const processedDir = path.join(inboxDir, "processed");
const pollMs = Math.max(500, Number(process.env.CTB_FILE_POLL_MS || 1000));
const clients = new Map();
const replies = [];
const seenFiles = new Set();

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
    const botId = String(event.bot_id || event.metadata?.bot_id || "").trim();
    const allClients = Array.from(clients.values());
    const targetClients = botId
        ? allClients.filter(client => client.bot_id === botId)
        : allClients;
    const fallbackClients = botId && targetClients.length === 0
        ? allClients.filter(client => !client.bot_id)
        : [];
    for (const client of [...targetClients, ...fallbackClients]) {
        sseWrite(client, payload);
    }
}

async function ensureConnectorDirs() {
    await fsp.mkdir(inboxDir, { recursive: true });
    await fsp.mkdir(outboxDir, { recursive: true });
    await fsp.mkdir(processedDir, { recursive: true });
}

async function pollInboxOnce() {
    if (!clients.size) return;
    await ensureConnectorDirs();
    const entries = await fsp.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(inboxDir, entry.name);
        if (seenFiles.has(filePath)) continue;
        try {
            const raw = await fsp.readFile(filePath, "utf8");
            const event = validateEvent(JSON.parse(raw));
            seenFiles.add(filePath);
            broadcastEvent(event);
            await moveProcessed(filePath, entry.name);
            console.log(`[file:event] ${entry.name} ${event.event_id} -> ${clients.size} tavern client(s)`);
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
        sendJson(res, 200, {
            ok: true,
            clients: clients.size,
            client_bots: Array.from(clients.values()).map(client => ({
                id: client.id,
                bot_id: client.bot_id,
                connected_at: client.connected_at,
            })),
            replies: replies.length,
            connector_dir: connectorDir,
            inbox_dir: inboxDir,
            outbox_dir: outboxDir,
            now: new Date().toISOString(),
        });
        return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
        const id = randomUUID();
        const bot_id = String(url.searchParams.get("bot_id") || url.searchParams.get("bot") || "").trim();
        res.writeHead(200, corsHeaders({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        }));
        res.write(": connected\n\n");
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25000);
        clients.set(id, { id, bot_id, res, connected_at: new Date().toISOString() });
        req.on("close", () => {
            clearInterval(heartbeat);
            clients.delete(id);
        });
        return;
    }

    if (req.method === "POST" && (url.pathname === "/event" || url.pathname === "/inbound")) {
        try {
            const payload = await readJson(req);
            const event = validateEvent(payload);
            broadcastEvent(event);
            sendJson(res, 202, {
                ok: true,
                accepted: true,
                event_id: event.event_id,
                tavern_clients: clients.size,
            });
            console.log(`[event] ${event.event_id} -> ${clients.size} tavern client(s)`);
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
