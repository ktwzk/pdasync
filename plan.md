# Multi-Device Video Sync System Plan

## Goal

Build a browser-based system that synchronizes playback of 80 different videos across 80 Android phones so that, at any moment, all devices display the same frame index on a shared global timeline.

Primary target:

- Wi-Fi LAN clients should typically remain within 1-3 frames at 30 fps.
- LTE clients are supported with lower precision requirements.
- Drift must not accumulate over 8-10 hours of continuous looping playback.

## Confirmed Constraints

- Each device plays one preassigned video.
- All videos have identical duration, frame count, fps, and encoding parameters.
- Videos are static and never change at runtime.
- No audio.
- Devices are Android phones without root.
- Some devices may be absent.
- Devices may join and leave asynchronously.
- Device identity is determined by the browser URL, for example `client.html?slot=32`.
- Multiple devices may open the same slot and show the same video.
- One startup tap is acceptable and required to unlock autoplay and fullscreen.
- Devices should recover automatically from temporary network loss and resynchronize.
- Android sleep prevention will be configured at OS level, but browser-side mitigations should still be used when available.

## Non-Goals For V1

- Perfect frame-locked synchronization over LTE.
- WebRTC transport.
- Segmented playback / MSE pipeline.
- Dynamic content replacement during playback.
- Full operator UI beyond minimal control endpoints.

## Core Design Decisions

1. Use one pre-cached MP4 file per slot in v1.
2. Do not use segmented playback in v1.
3. Use a Local Server as the main authority for LAN clients.
4. Use a Global Server for LTE clients and optional upstream coordination.
5. LAN playback must continue even if internet connectivity is lost.
6. Synchronization should be based on server time estimation, not on a 30 Hz broadcast loop.
7. Drift should be corrected with sparse, bounded interventions:
   - ignore tiny errors
   - use temporary playbackRate correction for medium errors
   - use seek for larger errors

## Architecture

### Global Server

- Internet-reachable authority for show timeline metadata.
- Serves LTE clients directly.
- Can provide upstream reference time to the Local Server.

### Local Server

- Runs on a laptop or machine inside the local Wi-Fi network.
- Acts as the authority for LAN clients.
- Periodically synchronizes with the Global Server when internet is available.
- Must continue serving LAN clients autonomously if upstream internet disappears.

### Clients

- Browser-based Android clients.
- Opened with a slot-specific URL.
- Cache the assigned video ahead of time via Service Worker / Cache Storage.
- Estimate server time via repeated timesync exchanges.
- Continue playback locally during disconnects and resynchronize on reconnect.

## Network Model

- LAN clients connect to the Local Server by default.
- LTE clients connect to the Global Server.
- LAN clients may optionally fall back to the Global Server if Local Server is unavailable, but this is not the primary operating mode.
- The Local Server must not depend on constant internet connectivity for real-time playback decisions.

## Time Model

The cross-server show timeline is defined by:

- `showStartEpochMs`
- `durationMs`

Playback position is computed as:

- `targetTimeMs = (serverNowEpochMs - showStartEpochMs) % durationMs`

The browser client estimates `serverNowEpochMs` from periodic time sync samples and local high-resolution time (`performance.timeOrigin + performance.now()`).

## Time Synchronization Strategy

Do not use a fixed 30 Hz sync broadcast as the primary synchronization mechanism.

Instead:

1. The client sends periodic timesync requests every 2-5 seconds.
2. The server replies with server epoch time.
3. The client collects multiple samples.
4. The client filters by low RTT samples.
5. The client estimates server time offset relative to local `performance.now()`.

For LAN:

- higher sync frequency during startup
- reduced frequency after stabilization

For LTE:

- lower sync frequency
- more tolerance for jitter and asymmetry

## Playback Correction Rules

At 30 fps, use the following baseline thresholds:

- error `< 15 ms`: ignore
- error `15-80 ms`: adjust `playbackRate` temporarily, e.g. `0.985-1.015`
- error `> 80-120 ms`: seek
- after reconnect / tab restore / fullscreen restore: immediate resync against current target time

The client should avoid constant rate hunting and should only intervene when error exceeds meaningful thresholds.

## Looping

Do not use `video.loop` as the source of truth.

The loop position must always be derived from the global timeline:

- `targetTimeMs = (serverNowEpochMs - showStartEpochMs) % durationMs`

## Disconnect / Reconnect Behavior

On disconnect:

- continue local playback using the current media clock

On reconnect:

- refresh time offset estimate
- recompute target time
- use rate correction or seek depending on the measured error

This allows temporary network loss without freezing playback.

## Slot Assignment

- Each device is assigned by URL parameter `slot`.
- Example: `client.html?slot=32`
- Slot `32` maps to video file `videos/32.mp4`
- Duplicate clients for the same slot are allowed.
- The system does not require all 80 slots to be online.

## Fullscreen / Hidden Mode

- Minimal startup overlay only.
- One user tap should:
  - unlock video playback
  - request fullscreen
  - request screen wake lock if available
  - optionally lock orientation if useful
- After successful unlock, UI should remain hidden.

## Android / Browser Requirements

Preferred baseline:

- Android 10+
- current Chrome / Chromium-based browser
- support for:
  - Fullscreen API
  - Service Worker
  - Cache Storage
  - `performance.now()`

Preferred but optional:

- Screen Wake Lock API
- kiosk / pinned mode at device level

Operational recommendations:

- disable battery optimization for the browser if possible
- keep auto-sleep disabled in Android settings
- use one stable browser version across all devices
- use kiosk or screen pinning if operationally available

## Video Encoding Requirements

For v1:

- H.264
- `1080x1080`
- `30 fps`
- CFR
- no audio
- identical duration and frame count across all files
- recommended GOP:
  - `-g 30`
  - `-keyint_min 30`
  - `-sc_threshold 0`

These settings help make seeking more predictable without introducing segmented playback complexity.

## Recommended Video Length

Practical guidance:

- 3 minutes is a strong baseline for testing and likely production use.
- 5-10 minutes is often still fine if file sizes remain reasonable.
- The limiting factor is more often file size, caching behavior, and browser stability than synchronization logic itself.

For the first implementation, use 3-minute loops.

## Deliverables

- `plan.md`
- `server-local.js`
- `server-global.js`
- `client.html`
- `client.js`
- `sw.js`
- `generate-test-videos.*`

## Implementation Plan

1. Write the approved PRD and implementation plan into `plan.md`.
2. Build a generator that creates 80 synthetic test videos:
   - `1080x1080`
   - `30 fps`
   - 3 minutes
   - centered timestamp with milliseconds
   - frame index
   - slot / video ID in the corner
3. Implement the Local Server:
   - WebSocket endpoint
   - deterministic shared timeline
   - control endpoints if needed
   - optional upstream sync support
4. Implement the Global Server:
   - same timeline model
   - serves external clients
   - supports upstream time reference for Local Server
5. Implement the browser client:
   - slot routing
   - service worker registration
   - pre-cache behavior
   - startup unlock
   - fullscreen
   - wake lock
   - timesync sampling
   - drift correction
   - reconnect handling
6. Validate with multiple local browser tabs first.
7. Validate on several Android devices in one LAN.
8. Validate separate LTE behavior with relaxed expectations.
9. Run a long soak test to verify no drift accumulation over 8-10 hours.

## MVP Scope

The first working version should prioritize:

- deterministic shared time model
- pre-cached single-file playback
- Local Server + Global Server skeleton
- slot-based client playback
- reconnect and resync behavior
- practical Android browser stability

Do not add segmented playback unless v1 proves insufficient.

## Implementation Prompt

Build a production-ready browser-based multi-device video sync system for Android phones.

Requirements:

- 80 devices total.
- Each device plays its own preassigned video file.
- All videos have identical duration, fps, frame count, and encoding params.
- Videos are pre-cached on devices and never change during runtime.
- Device identity is defined by URL query param `slot`, for example `/client.html?slot=32`.
- Multiple devices may open the same slot.
- Some devices may be absent at any time.
- Devices may join and leave asynchronously.
- Main target is Wi-Fi LAN synchronization; LTE clients are supported with lower sync guarantees.
- One startup tap is allowed and should unlock autoplay/fullscreen.
- System must run for 8-10 hours without accumulating drift.

Architecture:

- A Local Server is the main authority for LAN clients.
- A Global Server is used for LTE clients and as an optional upstream reference.
- LAN playback must continue even if internet connectivity is lost.
- Clients connect over WebSocket.
- Do not use segmented playback in v1.
- Do not use `video.loop` as the source of truth.

Time model:

- Use a shared timeline defined by:
  - `showStartEpochMs`
  - `durationMs`
- Current playback position is:
  - `targetTimeMs = (serverNowEpochMs - showStartEpochMs) % durationMs`
- Client must estimate server time from periodic time sync messages, not from frequent 30 Hz broadcast ticks.
- Use repeated time sync sampling and RTT filtering to estimate clock offset.
- LAN and LTE may use different sync intervals and correction thresholds.

Client sync behavior:

- Compare `targetTime` with `video.currentTime`.
- If error is very small, ignore it.
- If error is moderate, temporarily adjust `playbackRate`.
- If error is large, seek.
- On reconnect, immediately recompute target time and resync.
- During network loss, continue local playback and recover gracefully when connection returns.

Client UX:

- Minimal hidden-mode UI.
- On first tap:
  - unlock playback
  - request fullscreen
  - request screen wake lock if supported
- Handle reconnect, visibility changes, and fullscreen restoration where possible.

Video requirements:

- H.264
- `1080x1080`
- `30 fps` CFR
- no audio
- identical frame count and duration across all videos
- recommend GOP = 30 for predictable seek behavior

Deliverables:

- `server-local.js`
- `server-global.js`
- `client.html`
- `client.js`
- `sw.js`
- `generate-test-videos.*` script to create 80 synthetic 3-minute test videos with:
  - centered timestamp with milliseconds
  - frame index
  - video id in the corner

Focus on:

- deterministic time model
- practical browser stability on Android
- reconnect and long-run drift resistance
- simplicity over premature complexity
