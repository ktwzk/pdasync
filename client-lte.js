import { resolveLtePassword } from "/lte-passwords.js";

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const preloader = document.getElementById("preloader");
const playButton = document.getElementById("playButton");
const statusText = document.getElementById("statusText");
const blackScreen = document.getElementById("blackScreen");
const hudLeft = document.getElementById("hudLeft");
const hudRight = document.getElementById("hudRight");

const params = new URLSearchParams(window.location.search);
const debug = params.get("debug") === "1";
const rawSlot = params.get("slot") || "";

if (debug) {
  document.body.classList.add("debug");
}

const state = {
  ws: null,
  connected: false,
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
  readyToPlay: false,
  disconnectedByPriority: false
};

function resolveSlot(input) {
  const numeric = Number.parseInt(input, 10);
  if (Number.isFinite(numeric) && numeric >= 1) {
    return numeric;
  }
  return resolveLtePassword(input);
}

function setStatus(text) {
  statusText.textContent = text;
}

function computeWsUrl(slot) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?slot=${encodeURIComponent(slot)}&mode=lte`;
}

function getEstimatedServerNowMs() {
  return performance.timeOrigin + performance.now() + state.offsetEstimateMs;
}

function getTargetTimeSeconds() {
  if (!state.showConfig) return null;
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
  if (targetTime == null) return;

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

function requestTimesync() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

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

  if (!Number.isFinite(clientSentAtMs) || !Number.isFinite(serverNowEpochMs)) return;

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

function connect(slot) {
  const wsUrl = computeWsUrl(slot);
  setStatus("Connecting…");

  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.connected = true;
    state.bestRttMs = Infinity;
    setStatus("Syncing…");
    requestTimesync();
    ws.send(JSON.stringify({ type: "get-state" }));

    const timesyncInterval = setInterval(() => {
      if (state.ws?.readyState === WebSocket.OPEN) {
        requestTimesync();
      } else {
        clearInterval(timesyncInterval);
      }
    }, 1000);
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

      if (!state.readyToPlay) {
        state.readyToPlay = true;
        showPlayButton();
      }
      return;
    }

    if (message.type === "timesync-reply") {
      handleTimesyncReply(message);
      return;
    }

    if (message.type === "error" && message.code === "SLOT_TAKEN") {
      showBlackScreen();
      return;
    }
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    if (!state.disconnectedByPriority) {
      setTimeout(() => {
        if (!state.connected && !state.disconnectedByPriority) {
          connect(slot);
        }
      }, 1500);
    }
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

function showPlayButton() {
  preloader.classList.add("hidden");
  playButton.classList.add("visible");
}

function showBlackScreen() {
  state.disconnectedByPriority = true;
  blackScreen.classList.add("visible");
  overlay.classList.add("hidden");
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  try {
    window.close();
  } catch {
  }
}

async function startPlayback() {
  if (state.playbackUnlocked) return;

  state.playbackUnlocked = true;
  overlay.classList.add("hidden");

  try {
    video.src = `/videos/${String(state.slot).padStart(2, "0")}.mp4`;
    video.muted = true;
    video.playsInline = true;

    const playPromise = video.play();
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Stream timeout (60s)")), 60000);
    });
    await Promise.race([playPromise, timeout]);

    if ("wakeLock" in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request("screen");
      } catch {
      }
    }

    maybeCorrectPlayback();
  } catch (error) {
    state.playbackUnlocked = false;
    setStatus(`Failed: ${error.message || error}`);
    playButton.classList.remove("visible");
    preloader.classList.remove("hidden");
  }
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

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && state.playbackUnlocked) {
    if ("wakeLock" in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request("screen");
      } catch {
      }
    }
    maybeCorrectPlayback();
  }
});

video.addEventListener("loadedmetadata", () => {
  maybeCorrectPlayback();
});

video.addEventListener("ended", () => {
  maybeCorrectPlayback();
  void video.play().catch(() => {});
});

playButton.addEventListener("click", () => {
  void startPlayback();
});

setInterval(() => {
  maybeCorrectPlayback();
  tickHud();
}, 250);

(async () => {
  const resolvedSlot = resolveSlot(rawSlot);
  if (resolvedSlot === null) {
    setStatus("Invalid slot");
    return;
  }

  state.slot = resolvedSlot;
  connect(resolvedSlot);
})();
