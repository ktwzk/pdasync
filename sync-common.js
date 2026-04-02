export const VIDEO_COUNT = 80;
export const VIDEO_FPS = 30;
export const VIDEO_DURATION_MS = 3 * 60 * 1000;
export const SYNC_INTERVALS_MS = {
  startup: 1000,
  steady: 3000,
  reconnect: 1500
};

export const CORRECTION_THRESHOLDS_MS = {
  ignore: 15,
  rate: 80,
  seek: 120
};

export function monotonicNowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

export function epochNowMs() {
  return Date.now();
}

export function createInitialShowState(options = {}) {
  const nowEpochMs = epochNowMs();
  const startDelayMs = options.startDelayMs ?? 5000;

  return {
    durationMs: options.durationMs ?? VIDEO_DURATION_MS,
    fps: options.fps ?? VIDEO_FPS,
    videoCount: options.videoCount ?? VIDEO_COUNT,
    showStartEpochMs: options.showStartEpochMs ?? nowEpochMs + startDelayMs,
    generatedAtEpochMs: nowEpochMs
  };
}

export function getLoopTimeMs(showState, serverNowEpochMs) {
  const elapsedMs = Math.max(0, serverNowEpochMs - showState.showStartEpochMs);
  return elapsedMs % showState.durationMs;
}

export function buildClientConfig(showState, extras = {}) {
  return {
    ...showState,
    sync: {
      intervalsMs: SYNC_INTERVALS_MS,
      correctionThresholdsMs: CORRECTION_THRESHOLDS_MS
    },
    ...extras
  };
}
