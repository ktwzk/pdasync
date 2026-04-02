import fs, { promises as fsAsync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  buildClientConfig,
  createInitialShowState,
  epochNowMs,
  getLoopTimeMs,
  monotonicNowMs
} from "./sync-common.js";
import { resolveLtePassword, getAllPasswords } from "./lte-passwords.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mp4": "video/mp4",
  ".webmanifest": "application/manifest+json"
};

const IN_MEMORY_EXTENSIONS = new Set([".html", ".js", ".css", ".json"]);

async function loadStaticCache(rootDir) {
  const cache = new Map();
  const entries = await fsAsync.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IN_MEMORY_EXTENSIONS.has(ext)) continue;
    const filePath = path.join(rootDir, entry.name);
    try {
      const content = await fsAsync.readFile(filePath);
      cache.set(entry.name, { content, contentType: STATIC_TYPES[ext] || "application/octet-stream" });
    } catch {
    }
  }
  return cache;
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.slice(6).split("-", 2);
  let start;
  let end;

  if (rawStart === "") {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || suffixLength > size) {
      return "invalid";
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd === "" ? size - 1 : Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return "invalid";
    }
  }

  if (start < 0 || end < start || start >= size) {
    return "invalid";
  }

  end = Math.min(end, size - 1);
  return { start, end };
}

function buildStateMessage(state, serverLabel, extras = {}) {
  return {
    type: "state",
    role: serverLabel,
    serverNowEpochMs: epochNowMs(),
    config: buildClientConfig(state.showState, extras)
  };
}

function sendStateMessage(ws, state, serverLabel, extras = {}) {
  ws.send(JSON.stringify(buildStateMessage(state, serverLabel, extras)));
}

function broadcastShowState(wss, state, serverLabel) {
  const payload = JSON.stringify(buildStateMessage(state, serverLabel, {}));
  for (const client of wss.clients) {
    if (client.readyState !== client.OPEN) {
      continue;
    }
    const message = client.assignedSlot != null
      ? payload.replace(/"assignedSlot":null/, `"assignedSlot":${client.assignedSlot}`)
      : payload;
    client.send(message);
  }
}

function findSlotConnection(wss, slot) {
  for (const client of wss.clients) {
    if (client.assignedSlot === slot && client.readyState === client.OPEN) {
      return client;
    }
  }
  return null;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function safeFilePath(rootDir, reqPath) {
  const normalized = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(rootDir, `.${normalized}`);
  return resolved.startsWith(rootDir) ? resolved : null;
}

async function syncFromUpstream(upstreamUrl, state, wss, serverLabel, logger) {
  try {
    const response = await fetch(`${upstreamUrl.replace(/\/$/, "")}/api/state`, {
      headers: {
        "Cache-Control": "no-cache"
      }
    });

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const upstream = await response.json();

    if (!Number.isFinite(upstream.showStartEpochMs)) {
      throw new Error("Invalid upstream showStartEpochMs");
    }

    state.showState = {
      durationMs: upstream.durationMs,
      fps: upstream.fps,
      videoCount: upstream.videoCount,
      showStartEpochMs: upstream.showStartEpochMs,
      generatedAtEpochMs: epochNowMs()
    };
    broadcastShowState(wss, state, serverLabel);
    state.upstreamStatus = {
      ok: true,
      lastSyncAtMs: Date.now(),
      upstreamUrl
    };
    logger(`upstream sync ok: ${upstreamUrl}`);
  } catch (error) {
    state.upstreamStatus = {
      ok: false,
      lastSyncAtMs: Date.now(),
      upstreamUrl,
      error: String(error.message || error)
    };
    logger(`upstream sync failed: ${state.upstreamStatus.error}`);
  }
}

function createStaticHandler(rootDir, state, wss, serverLabel, staticCache) {
  return async (req, res) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (reqUrl.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        role: serverLabel,
        nowMonoMs: monotonicNowMs(),
        nowEpochMs: epochNowMs()
      });
    }

    if (reqUrl.pathname === "/api/state") {
      const nowEpochMs = epochNowMs();
      return sendJson(res, 200, {
        role: serverLabel,
        nowMonoMs: monotonicNowMs(),
        nowEpochMs,
        loopTimeMs: getLoopTimeMs(state.showState, nowEpochMs),
        upstreamStatus: state.upstreamStatus,
        ...state.showState
      });
    }

    if (req.method === "POST" && reqUrl.pathname === "/api/control/restart") {
      const authHeader = req.headers.authorization || "";
      const expectedToken = process.env.CONTROL_TOKEN || "";
      if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
        return sendJson(res, 401, { error: "unauthorized" });
      }
      state.showState = createInitialShowState({
        durationMs: state.showState.durationMs,
        fps: state.showState.fps,
        videoCount: state.showState.videoCount,
        startDelayMs: 5000
      });
      broadcastShowState(wss, state, serverLabel);
      return sendJson(res, 200, {
        ok: true,
        restarted: true,
        showStartEpochMs: state.showState.showStartEpochMs
      });
    }

    if (reqUrl.pathname === "/api/ping") {
      return sendJson(res, 200, { ok: true, nowEpochMs: epochNowMs() });
    }

    if (reqUrl.pathname === "/api/control/words") {
      return sendJson(res, 200, {
        passwords: getAllPasswords()
      });
    }

    if (reqUrl.pathname === "/api/status") {
      const slots = [];
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN && client.assignedSlot != null) {
          slots.push({
            slot: client.assignedSlot,
            type: client.connectionType || "lte",
            deviceId: client.deviceId || null,
            connectedAt: client.connectedAt || null
          });
        }
      }
      const slotStats = {};
      for (const [slot, data] of Object.entries(lteDevices.slots)) {
        slotStats[slot] = {
          totalConnections: data.totalConnections,
          uniqueDevices: data.uniqueDevices.size,
          lastSeen: data.lastSeen
        };
      }
      return sendJson(res, 200, { slots, lteStats: slotStats });
    }

    const targetPath = reqUrl.pathname === "/" ? "/client.html" : reqUrl.pathname;
    const fileName = path.basename(targetPath);

    if (staticCache.has(fileName)) {
      const { content, contentType } = staticCache.get(fileName);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache"
      });
      res.end(content);
      return;
    }

    const filePath = safeFilePath(rootDir, targetPath);

    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let stats;
    try {
      stats = await fsAsync.stat(filePath);
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (!stats.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = STATIC_TYPES[ext] || "application/octet-stream";
    const cacheControl = ext === ".mp4" ? "public, max-age=31536000, immutable" : "no-cache";

    if (ext !== ".mp4") {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl
      });
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
      stream.pipe(res);
      return;
    }

    const range = parseRangeHeader(req.headers.range, stats.size);

    if (range === "invalid") {
      res.writeHead(416, {
        "Content-Range": `bytes */${stats.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl
      });
      res.end();
      return;
    }

    if (range) {
      const { start, end } = range;
      res.writeHead(206, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Content-Length": end - start + 1
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", () => {
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "Accept-Ranges": "bytes",
      "Content-Length": stats.size
    });
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
    stream.pipe(res);
  };
}

function handleSocketConnection(ws, req, state, wss, serverLabel) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const rawSlot = reqUrl.searchParams.get("slot") || "";
  const isLte = reqUrl.searchParams.get("mode") === "lte" || reqUrl.pathname.includes("client-lte");
  const connectionType = isLte ? "lte" : "local";

  let slot = null;
  const numericSlot = Number.parseInt(rawSlot, 10);
  if (Number.isFinite(numericSlot) && numericSlot >= 1 && numericSlot <= state.showState.videoCount) {
    slot = numericSlot;
  } else {
    const resolvedSlot = resolveLtePassword(rawSlot);
    if (resolvedSlot !== null && resolvedSlot <= state.showState.videoCount) {
      slot = resolvedSlot;
    }
  }

  if (slot !== null) {
    const existing = findSlotConnection(wss, slot);
    if (existing) {
      const existingType = existing.connectionType || "lte";
      if (connectionType === "local" && existingType === "lte") {
        existing.send(JSON.stringify({
          type: "error",
          code: "SLOT_TAKEN",
          message: `Slot ${slot} taken by local connection`
        }));
        existing.close(4001, "Slot taken by local connection");
      } else if (connectionType === "local" && existingType === "local") {
        existing.send(JSON.stringify({
          type: "error",
          code: "SLOT_TAKEN",
          message: `Slot ${slot} taken by newer local connection`
        }));
        existing.close(4001, "Slot taken by newer local connection");
      } else if (connectionType === "lte" && existingType === "lte") {
        existing.send(JSON.stringify({
          type: "error",
          code: "SLOT_TAKEN",
          message: `Slot ${slot} taken by newer LTE connection`
        }));
        existing.close(4001, "Slot taken by newer LTE connection");
      } else {
        ws.send(JSON.stringify({
          type: "error",
          code: "SLOT_TAKEN",
          message: `Slot ${slot} already connected`
        }));
        ws.close(4001, `Slot ${slot} already connected`);
        return;
      }
    }
  }

  ws.assignedSlot = slot;
  ws.connectionType = connectionType;
  ws.connectedAt = Date.now();

  ws.send(JSON.stringify({
    type: "hello",
    role: serverLabel,
    serverNowMonoMs: monotonicNowMs(),
    config: buildClientConfig(state.showState, {
      assignedSlot: slot
    })
  }));

  ws.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({
        type: "error",
        code: "INVALID_JSON"
      }));
      return;
    }

    if (message.type === "timesync") {
      ws.send(JSON.stringify({
        type: "timesync-reply",
        id: message.id ?? null,
        clientSentAtMs: message.clientSentAtMs ?? null,
        serverNowEpochMs: epochNowMs()
      }));
      return;
    }

    if (message.type === "get-state") {
      sendStateMessage(ws, state, serverLabel, {
        assignedSlot: slot
      });
      return;
    }

    if (message.type === "device-id" && connectionType === "lte" && slot !== null) {
      ws.deviceId = message.deviceId;
      recordLteConnection(slot, message.deviceId);
      return;
    }

    if (message.type === "client-status") {
      return;
    }

    ws.send(JSON.stringify({
      type: "error",
      code: "UNKNOWN_MESSAGE",
      receivedType: message.type
    }));
  });
}

export async function createSyncServer(options) {
  const rootDir = options.rootDir ?? __dirname;
  const port = options.port;
  const host = options.host ?? "0.0.0.0";
  const serverLabel = options.serverLabel;
  const staticCache = await loadStaticCache(rootDir);

  const dataDir = process.env.DATA_DIR ?? rootDir;
  const lteDevicesPath = path.join(dataDir, "lte-devices.json");
  let lteDevices = { devices: {}, slots: {} };
  try {
    const raw = await fsAsync.readFile(lteDevicesPath, "utf-8");
    const parsed = JSON.parse(raw);
    lteDevices.devices = parsed.devices || {};
    lteDevices.slots = {};
    for (const [slot, data] of Object.entries(parsed.slots || {})) {
      lteDevices.slots[slot] = {
        totalConnections: data.totalConnections || 0,
        uniqueDevices: new Set(Array.isArray(data.uniqueDevices) ? data.uniqueDevices : []),
        lastSeen: data.lastSeen || null
      };
    }
  } catch {
  }

  const state = {
    showState: createInitialShowState({
      durationMs: options.durationMs,
      fps: options.fps,
      videoCount: options.videoCount,
      startDelayMs: options.startDelayMs
    }),
    upstreamStatus: null
  };

  const logger = (message) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${serverLabel}] ${message}`);
  };

  function saveLteDevices() {
    const serializable = {
      devices: lteDevices.devices,
      slots: {}
    };
    for (const [slot, data] of Object.entries(lteDevices.slots)) {
      serializable.slots[slot] = {
        totalConnections: data.totalConnections,
        uniqueDevices: Array.from(data.uniqueDevices),
        lastSeen: data.lastSeen
      };
    }
    void fsAsync.writeFile(lteDevicesPath, JSON.stringify(serializable, null, 2));
  }

  function recordLteConnection(slot, deviceId) {
    if (!lteDevices.devices[deviceId]) {
      lteDevices.devices[deviceId] = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        slots: [],
        connections: 0
      };
    }
    const device = lteDevices.devices[deviceId];
    device.lastSeen = Date.now();
    device.connections += 1;
    if (!device.slots.includes(slot)) {
      device.slots.push(slot);
    }

    if (!lteDevices.slots[slot]) {
      lteDevices.slots[slot] = {
        totalConnections: 0,
        uniqueDevices: new Set(),
        lastSeen: null
      };
    }
    const slotData = lteDevices.slots[slot];
    slotData.totalConnections += 1;
    slotData.uniqueDevices.add(deviceId);
    slotData.lastSeen = Date.now();
    saveLteDevices();
    logger(`lte device ${deviceId.slice(0, 8)}… slot=${slot} (conn=${slotData.totalConnections}, unique=${slotData.uniqueDevices.size})`);
  }

  const httpServer = http.createServer();
  httpServer.maxHeadersCount = 20;
  httpServer.headersTimeout = 10000;
  httpServer.requestTimeout = 30000;
  httpServer.timeout = 0;
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 1024 });
  httpServer.on("request", createStaticHandler(rootDir, state, wss, serverLabel, staticCache));

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    handleSocketConnection(ws, req, state, wss, serverLabel);
  });

  const pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);

  function shutdown() {
    clearInterval(pingInterval);
    if (options.upstreamSyncTimer) clearInterval(options.upstreamSyncTimer);
    for (const client of wss.clients) {
      client.close(1001, "Server shutting down");
    }
    httpServer.close(() => {
      logger("shut down complete");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  httpServer.listen(port, host, () => {
    logger(`listening on http://${host}:${port}`);
    logger(`showStartEpochMs=${state.showState.showStartEpochMs}`);
  });

  if (options.upstreamUrl) {
    let syncing = false;
    const runSync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        await syncFromUpstream(options.upstreamUrl, state, wss, serverLabel, logger);
      } finally {
        syncing = false;
      }
    };
    runSync();
    state.upstreamSyncTimer = setInterval(runSync, options.upstreamSyncIntervalMs ?? 5000);
  }

  return {
    httpServer,
    wss,
    state
  };
}
