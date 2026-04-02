import { createSyncServer } from "./sync-server.js";
import { VIDEO_COUNT, VIDEO_DURATION_MS, VIDEO_FPS } from "./sync-common.js";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const host = process.env.HOST || "0.0.0.0";

(async () => {
  await createSyncServer({
    port,
    host,
    serverLabel: "global",
    durationMs: VIDEO_DURATION_MS,
    fps: VIDEO_FPS,
    videoCount: VIDEO_COUNT,
    startDelayMs: 15000
  });
})().catch((err) => {
  console.error("Failed to start global server:", err);
  process.exit(1);
});
