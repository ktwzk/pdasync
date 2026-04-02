import { createSyncServer } from "./sync-server.js";
import { VIDEO_COUNT, VIDEO_DURATION_MS, VIDEO_FPS } from "./sync-common.js";

const port = Number.parseInt(process.env.PORT || "8081", 10);
const host = process.env.HOST || "0.0.0.0";
const upstreamUrl = process.env.UPSTREAM_URL || "";

(async () => {
  await createSyncServer({
    port,
    host,
    serverLabel: "local",
    durationMs: VIDEO_DURATION_MS,
    fps: VIDEO_FPS,
    videoCount: VIDEO_COUNT,
    startDelayMs: 10000,
    upstreamUrl: upstreamUrl || undefined,
    upstreamSyncIntervalMs: 5000
  });
})().catch((err) => {
  console.error("Failed to start local server:", err);
  process.exit(1);
});
