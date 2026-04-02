const overlay = document.getElementById("overlay");
const startButton = document.getElementById("startButton");
const slotLine = document.getElementById("slotLine");
const statusLine = document.getElementById("statusLine");
const video = document.getElementById("video");
const hudLeft = document.getElementById("hudLeft");
const hudRight = document.getElementById("hudRight");

const params = new URLSearchParams(window.location.search);
const rawSlot = params.get("slot") || "1";
const debug = params.get("debug") === "1";
const isLteMode = params.get("mode") === "lte" || window.location.pathname.endsWith("/client-lte.html");
const startupMode = params.get("startup") === "stream" || isLteMode ? "stream" : "cache";

if (debug) {
  document.body.classList.add("debug");
}

if (isLteMode) {
  document.body.classList.add("lte");
  document.title = "Sync Client LTE";
  document.getElementById("clientTitle").textContent = "Video Sync Client LTE";
  startButton.textContent = "Start LTE Stream";
}

const state = {
  ws: null,
  wsUrl: null,
  connected: false,
  reconnectTimer: null,
  timesyncTimer: null,
  slot: null,
  offsetEstimateMs: 0,
  bestRttMs: Infinity,
  syncConfig: null,
  showConfig: null,
  playbackUnlocked: false,
  wakeLock: null,
  syncSampleId: 0,
  lastSyncAtMs: 0,
  lastErrorMs: 0,
  serverRole: "unknown",
  precacheReady: false,
  startupMode
};

import { resolveLtePassword } from "/lte-passwords.js";

function resolveSlot(rawSlot) {
  const numeric = Number.parseInt(rawSlot, 10);
  if (Number.isFinite(numeric) && numeric >= 1) {
    return numeric;
  }

  return resolveLtePassword(rawSlot);
}

function init() {
  const resolvedSlot = resolveSlot(rawSlot);
  if (resolvedSlot === null) {
    setStatus("Invalid slot");
    return;
  }

  state.slot = resolvedSlot;
  slotLine.textContent = `Slot ${resolvedSlot} \u00b7 ${startupMode === "stream" ? "LTE stream" : "Wi-Fi cache"}`;

  if (startupMode === "stream") {
    startButton.textContent = "Start LTE Stream";
  }
}

  state.slot = resolvedSlot;
  slotLine.textContent = `Slot ${resolvedSlot} · ${startupMode === "stream" ? "LTE stream" : "Wi-Fi cache"}`;

  if (startupMode === "stream") {
    startButton.textContent = "Start LTE Stream";
  }
}

function getVideoPath() {
  return `/videos/${String(state.slot).padStart(2, "0")}.mp4`;
}

function setStatus(message) {
  statusLine.textContent = message;
}

function computeWsUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?slot=${encodeURIComponent(state.slot)}`;
}

function getEstimatedServerNowMs() {
  return performance.timeOrigin + performance.now() + state.offsetEstimateMs;
}

function getTargetTimeSeconds() {
  if (!state.showConfig) {
    return null;
  }

  const serverNowMs = getEstimatedServerNowMs();
  const elapsedMs = Math.max(0, serverNowMs - state.showConfig.showStartEpochMs);
  const loopTimeMs = elapsedMs % state.showConfig.durationMs;
  return loopTimeMs / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function maybeCorrectPlayback() {
  if (!state.playbackUnlocked || !state.showConfig || Number.isNaN(video.currentTime)) {
    return;
  }

  const targetTime = getTargetTimeSeconds();

  if (targetTime == null) {
    return;
  }

  const currentTime = video.currentTime;
  let diffSeconds = targetTime - currentTime;
  const durationSeconds = state.showConfig.durationMs / 1000;

  if (diffSeconds > durationSeconds / 2) {
    diffSeconds -= durationSeconds;
  } else if (diffSeconds < -durationSeconds / 2) {
    diffSeconds += durationSeconds;
  }

  const diffMs = diffSeconds * 1000;
  state.lastErrorMs = diffMs;

  const thresholds = state.syncConfig?.correctionThresholdsMs || {
    ignore: 15,
    rate: 80,
    seek: 120
  };

  if (Math.abs(diffMs) < thresholds.ignore) {
    video.playbackRate = 1;
    return;
  }

  if (Math.abs(diffMs) < thresholds.seek) {
    const rateOffset = clamp(diffMs / 1200, -0.015, 0.015);
    video.playbackRate = clamp(1 + rateOffset, 0.985, 1.015);
    return;
  }

  const safeTarget = clamp(targetTime, 0, Math.max(0, durationSeconds - 1 / 30));
  video.currentTime = safeTarget;
  video.playbackRate = 1;
}

function scheduleTimesync(intervalMs) {
  if (state.timesyncTimer) {
    clearInterval(state.timesyncTimer);
  }

  state.timesyncTimer = setInterval(() => {
    requestTimesync();
  }, intervalMs);
}

function requestTimesync() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const id = ++state.syncSampleId;
  state.ws.send(JSON.stringify({
    type: "timesync",
    id,
    clientSentAtMs: performance.now()
  }));
}

function handleTimesyncReply(message) {
  const clientReceivedAtMs = performance.now();
  const clientSentAtMs = Number(message.clientSentAtMs);
  const serverNowEpochMs = Number(message.serverNowEpochMs);

  if (!Number.isFinite(clientSentAtMs) || !Number.isFinite(serverNowEpochMs)) {
    return;
  }

  const rttMs = clientReceivedAtMs - clientSentAtMs;
  const estimatedClientMidpointEpochMs = performance.timeOrigin + clientSentAtMs + rttMs / 2;
  const estimatedOffsetMs = serverNowEpochMs - estimatedClientMidpointEpochMs;

  if (rttMs <= state.bestRttMs + 15) {
    state.offsetEstimateMs = state.offsetEstimateMs === 0
      ? estimatedOffsetMs
      : (state.offsetEstimateMs * 0.8) + (estimatedOffsetMs * 0.2);
    state.bestRttMs = Math.min(state.bestRttMs, rttMs);
  }

  state.lastSyncAtMs = Date.now();
  maybeCorrectPlayback();
}

async function precacheVideo() {
  if (!("caches" in window)) {
    state.precacheReady = true;
    return;
  }

  const cache = await caches.open("video-sync-v1");
  const videoPath = getVideoPath();
  const hit = await cache.match(videoPath, { ignoreSearch: true });

  if (!hit) {
    setStatus("Caching video…");
    await cache.add(videoPath);
  }

  state.precacheReady = true;
}

function configureVideoElement() {
  video.preload = state.startupMode === "stream" ? "metadata" : "auto";
}

async function ensureWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
  } catch (error) {
    if (debug) {
      console.warn("Wake lock failed:", error);
    }
  }
}

async function enterFullscreen() {
  const element = document.documentElement;

  try {
    if (element.requestFullscreen && !document.fullscreenElement) {
      await element.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (error) {
    if (debug) {
      console.warn("Fullscreen failed:", error);
    }
  }
}

async function startPlaybackUnlock() {
  if (state.playbackUnlocked) {
    return;
  }

  state.playbackUnlocked = true;
  setStatus(state.startupMode === "stream" ? "Starting stream…" : "Starting playback…");

  try {
    configureVideoElement();
    if (state.startupMode === "cache") {
      await precacheVideo();
    }
    video.src = getVideoPath();
    video.muted = true;
    video.playsInline = true;

    if (state.startupMode === "stream") {
      const playPromise = video.play();
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Stream timeout (60s)")), 60000);
      });
      await Promise.race([playPromise, timeout]);
    } else {
      await video.play();
    }

    await enterFullscreen();
    await ensureWakeLock();
    overlay.classList.add("hidden");
    maybeCorrectPlayback();
  } catch (error) {
    state.playbackUnlocked = false;
    setStatus(`Startup failed: ${String(error.message || error)}`);
  }
}

function connect() {
  state.wsUrl = computeWsUrl();
  setStatus("Connecting…");
  const ws = new WebSocket(state.wsUrl);
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.connected = true;
    state.bestRttMs = Infinity;
    setStatus("Connected");
    requestTimesync();
    ws.send(JSON.stringify({ type: "get-state" }));
    const interval = state.syncConfig?.intervalsMs?.startup || 1000;
    scheduleTimesync(interval);
  });

  ws.addEventListener("message", (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "hello" || message.type === "state") {
      state.serverRole = message.role || state.serverRole;
      if (message.config) {
        state.showConfig = message.config;
        state.syncConfig = message.config.sync;
      }
      maybeCorrectPlayback();
      return;
    }

    if (message.type === "timesync-reply") {
      handleTimesyncReply(message);
      return;
    }

    if (message.type === "error") {
      if (message.code === "SLOT_TAKEN") {
        setStatus(`Error: ${message.message}`);
      }
      return;
    }
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    setStatus("Disconnected, retrying…");
    if (state.timesyncTimer) {
      clearInterval(state.timesyncTimer);
      state.timesyncTimer = null;
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }
    state.reconnectTimer = setTimeout(connect, 1500);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function tickHud() {
  const targetTime = getTargetTimeSeconds();
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  hudLeft.textContent = [
    `slot=${state.slot}`,
    `server=${state.serverRole}`,
    `connected=${state.connected ? "yes" : "no"}`
  ].join("  ");
  hudRight.textContent = [
    `video=${currentTime.toFixed(3)}s`,
    `target=${targetTime == null ? "n/a" : `${targetTime.toFixed(3)}s`}`,
    `err=${state.lastErrorMs.toFixed(1)}ms`
  ].join("  ");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
  }
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    await ensureWakeLock();
    maybeCorrectPlayback();
  }
});

video.addEventListener("loadedmetadata", () => {
  maybeCorrectPlayback();
});

video.addEventListener("ended", () => {
  maybeCorrectPlayback();
  void video.play().catch((error) => {
    if (debug) {
      console.warn("Video play after ended failed:", error);
    }
  });
});

startButton.addEventListener("click", () => {
  void startPlaybackUnlock();
});

setInterval(() => {
  maybeCorrectPlayback();
  tickHud();
}, 250);

registerServiceWorker();
configureVideoElement();

init();
connect();
