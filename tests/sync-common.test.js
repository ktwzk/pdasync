import { describe, it, before } from "node:test";
import assert from "node:assert";
import {
  VIDEO_COUNT,
  VIDEO_FPS,
  VIDEO_DURATION_MS,
  SYNC_INTERVALS_MS,
  CORRECTION_THRESHOLDS_MS,
  monotonicNowMs,
  epochNowMs,
  createInitialShowState,
  getLoopTimeMs,
  buildClientConfig
} from "../sync-common.js";

describe("sync-common constants", () => {
  it("has correct video count", () => {
    assert.strictEqual(VIDEO_COUNT, 80);
  });

  it("has correct fps", () => {
    assert.strictEqual(VIDEO_FPS, 30);
  });

  it("has correct duration", () => {
    assert.strictEqual(VIDEO_DURATION_MS, 3 * 60 * 1000);
  });

  it("has sync intervals defined", () => {
    assert.strictEqual(SYNC_INTERVALS_MS.startup, 1000);
    assert.strictEqual(SYNC_INTERVALS_MS.steady, 3000);
    assert.strictEqual(SYNC_INTERVALS_MS.reconnect, 1500);
  });

  it("has correction thresholds defined", () => {
    assert.strictEqual(CORRECTION_THRESHOLDS_MS.ignore, 15);
    assert.strictEqual(CORRECTION_THRESHOLDS_MS.rate, 80);
    assert.strictEqual(CORRECTION_THRESHOLDS_MS.seek, 120);
  });
});

describe("monotonicNowMs", () => {
  it("returns a finite number", () => {
    const result = monotonicNowMs();
    assert.strictEqual(typeof result, "number");
    assert(Number.isFinite(result));
  });

  it("is monotonically increasing", () => {
    const a = monotonicNowMs();
    const b = monotonicNowMs();
    assert(b >= a);
  });
});

describe("epochNowMs", () => {
  it("returns a value close to Date.now()", () => {
    const a = epochNowMs();
    const b = Date.now();
    assert(Math.abs(a - b) < 100);
  });
});

describe("createInitialShowState", () => {
  it("creates state with defaults", () => {
    const state = createInitialShowState();
    assert.strictEqual(state.durationMs, VIDEO_DURATION_MS);
    assert.strictEqual(state.fps, VIDEO_FPS);
    assert.strictEqual(state.videoCount, VIDEO_COUNT);
    assert(Number.isFinite(state.showStartEpochMs));
    assert(Number.isFinite(state.generatedAtEpochMs));
  });

  it("uses custom startDelayMs", () => {
    const state = createInitialShowState({ startDelayMs: 10000 });
    const now = Date.now();
    assert(state.showStartEpochMs > now + 5000);
    assert(state.showStartEpochMs < now + 15000);
  });

  it("uses explicit showStartEpochMs", () => {
    const customEpoch = 1700000000000;
    const state = createInitialShowState({ showStartEpochMs: customEpoch });
    assert.strictEqual(state.showStartEpochMs, customEpoch);
  });

  it("overrides duration and fps", () => {
    const state = createInitialShowState({
      durationMs: 60000,
      fps: 60,
      videoCount: 10
    });
    assert.strictEqual(state.durationMs, 60000);
    assert.strictEqual(state.fps, 60);
    assert.strictEqual(state.videoCount, 10);
  });
});

describe("getLoopTimeMs", () => {
  it("returns 0 when server time equals show start", () => {
    const state = createInitialShowState({ showStartEpochMs: 1000000 });
    const result = getLoopTimeMs(state, 1000000);
    assert.strictEqual(result, 0);
  });

  it("returns elapsed time within first loop", () => {
    const state = createInitialShowState({ showStartEpochMs: 1000000, durationMs: 10000 });
    const result = getLoopTimeMs(state, 1005000);
    assert.strictEqual(result, 5000);
  });

  it("wraps correctly after one loop", () => {
    const state = createInitialShowState({ showStartEpochMs: 1000000, durationMs: 10000 });
    const result = getLoopTimeMs(state, 1015000);
    assert.strictEqual(result, 5000);
  });

  it("wraps correctly after multiple loops", () => {
    const state = createInitialShowState({ showStartEpochMs: 1000000, durationMs: 10000 });
    const result = getLoopTimeMs(state, 1035000);
    assert.strictEqual(result, 5000);
  });

  it("returns 0 for times before show start", () => {
    const state = createInitialShowState({ showStartEpochMs: 1000000, durationMs: 10000 });
    const result = getLoopTimeMs(state, 999000);
    assert.strictEqual(result, 0);
  });
});

describe("buildClientConfig", () => {
  it("includes show state and sync config", () => {
    const state = createInitialShowState();
    const config = buildClientConfig(state);

    assert.strictEqual(config.durationMs, state.durationMs);
    assert.strictEqual(config.fps, state.fps);
    assert.strictEqual(config.videoCount, state.videoCount);
    assert.strictEqual(config.showStartEpochMs, state.showStartEpochMs);
    assert.deepStrictEqual(config.sync.intervalsMs, SYNC_INTERVALS_MS);
    assert.deepStrictEqual(config.sync.correctionThresholdsMs, CORRECTION_THRESHOLDS_MS);
  });

  it("merges extras", () => {
    const state = createInitialShowState();
    const config = buildClientConfig(state, { assignedSlot: 5 });
    assert.strictEqual(config.assignedSlot, 5);
  });
});
