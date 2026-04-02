import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FONT } from "./font-bitmaps.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.join(__dirname, "videos");
const COUNT = Number.parseInt(process.env.COUNT || "80", 10);
const DURATION_SECONDS = Number.parseInt(process.env.DURATION_SECONDS || "180", 10);
const FPS = Number.parseInt(process.env.FPS || "30", 10);
const WIDTH = 1080;
const HEIGHT = 1080;
const PIXEL_SIZE = 3;
const FRAME_SIZE = WIDTH * HEIGHT * PIXEL_SIZE;

function runFfmpeg(outputPath) {
  const args = [
    "-y",
    "-f", "rawvideo",
    "-pixel_format", "rgb24",
    "-video_size", `${WIDTH}x${HEIGHT}`,
    "-framerate", String(FPS),
    "-i", "-",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-g", String(FPS),
    "-keyint_min", String(FPS),
    "-sc_threshold", "0",
    "-preset", process.env.X264_PRESET || "veryfast",
    "-crf", process.env.CRF || "20",
    outputPath
  ];

  const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";

  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });

  return { child, completion };
}

function drawRect(buffer, x, y, width, height, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(WIDTH, x + width);
  const y1 = Math.min(HEIGHT, y + height);

  for (let yy = y0; yy < y1; yy += 1) {
    let offset = (yy * WIDTH + x0) * PIXEL_SIZE;
    for (let xx = x0; xx < x1; xx += 1) {
      buffer[offset] = color[0];
      buffer[offset + 1] = color[1];
      buffer[offset + 2] = color[2];
      offset += PIXEL_SIZE;
    }
  }
}

function drawGlyph(buffer, glyph, x, y, scale, color) {
  for (let row = 0; row < glyph.length; row += 1) {
    for (let col = 0; col < glyph[row].length; col += 1) {
      if (glyph[row][col] === "1") {
        drawRect(buffer, x + (col * scale), y + (row * scale), scale, scale, color);
      }
    }
  }
}

function measureText(text, scale) {
  return (text.length * (5 * scale + scale)) - scale;
}

function drawText(buffer, text, x, y, scale, color) {
  let cursor = x;

  for (const rawChar of text) {
    const char = rawChar.toUpperCase();
    const glyph = FONT[char] || FONT[" "];
    drawGlyph(buffer, glyph, cursor, y, scale, color);
    cursor += 6 * scale;
  }
}

function centerTextX(text, scale) {
  return Math.floor((WIDTH - measureText(text, scale)) / 2);
}

function msLabel(frameIndex) {
  const totalMs = Math.round((frameIndex * 1000) / FPS);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const centis = Math.floor((totalMs % 1000) / 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function frameLabel(frameIndex) {
  return `F${String(frameIndex).padStart(6, "0")}`;
}

function slotLabel(slot) {
  return `VIDEO ${slot}`;
}

function createBaseFrame(slot) {
  const base = Buffer.alloc(FRAME_SIZE, 0);
  const frameColor = [255, 255, 255];
  const softFrameColor = [24, 24, 24];

  drawRect(base, 0, 0, WIDTH, HEIGHT, [0, 0, 0]);
  drawRect(base, 38, 38, WIDTH - 76, 4, frameColor);
  drawRect(base, 38, HEIGHT - 42, WIDTH - 76, 4, frameColor);
  drawRect(base, 38, 38, 4, HEIGHT - 76, frameColor);
  drawRect(base, WIDTH - 42, 38, 4, HEIGHT - 76, frameColor);
  drawRect(base, 46, 46, WIDTH - 92, HEIGHT - 92, softFrameColor);
  drawText(base, slotLabel(slot), 72, 72, 10, [255, 255, 255]);

  return base;
}

async function writeFrame(stream, frameBuffer) {
  if (stream.write(frameBuffer)) {
    return;
  }

  await new Promise((resolve) => stream.once("drain", resolve));
}

async function generateVideo(slot) {
  const fileName = `${String(slot).padStart(2, "0")}.mp4`;
  const outputPath = path.join(OUTPUT_DIR, fileName);
  const totalFrames = DURATION_SECONDS * FPS;
  const baseFrame = createBaseFrame(slot);
  const frameBuffer = Buffer.allocUnsafe(FRAME_SIZE);
  const { child, completion } = runFfmpeg(outputPath);

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    baseFrame.copy(frameBuffer);

    const timeText = msLabel(frameIndex);
    const frameText = frameLabel(frameIndex);
    const scale = 16;
    const x = centerTextX(timeText, scale);
    const frameX = centerTextX(frameText, 14);

    drawText(frameBuffer, timeText, x, 430, scale, [255, 255, 255]);
    drawText(frameBuffer, frameText, frameX, 560, 14, [255, 255, 255]);

    await writeFrame(child.stdin, frameBuffer);
  }

  child.stdin.end();
  await completion;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const slots = [];
  for (let slot = 1; slot <= COUNT; slot += 1) {
    const fileName = `${String(slot).padStart(2, "0")}.mp4`;
    const exists = await fs.access(path.join(OUTPUT_DIR, fileName)).then(() => true).catch(() => false);
    if (!exists) slots.push(slot);
  }

  if (slots.length === 0) {
    console.log("All videos already exist.");
    return;
  }

  console.log(`Generating ${slots.length} videos (${slots.length < COUNT ? `${COUNT - slots.length} skipped` : "none skipped"})`);

  const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "4", 10);
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    const batch = slots.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (slot) => {
      const startedAt = Date.now();
      console.log(`Generating ${slot}/${COUNT}`);
      await generateVideo(slot);
      const elapsedMs = Date.now() - startedAt;
      console.log(`Finished ${String(slot).padStart(2, "0")} in ${elapsedMs} ms`);
    }));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
