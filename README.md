# Multi-Device Video Sync

Browser-based system that synchronizes playback of 80 different videos across 80 Android phones so all devices display the same frame index on a shared global timeline.

## Architecture

```
┌─────────────────┐     upstream sync      ┌─────────────────┐
│  Global Server  │◄──────────────────────►│  Local Server   │
│  (port 8080)    │                        │  (port 8081)    │
│                  │                        │                 │
│  LTE clients ◄───┤                        ├──► LAN clients  │
└─────────────────┘                        └─────────────────┘
```

- **Global Server**: Internet-reachable, serves LTE clients, provides upstream time reference
- **Local Server**: LAN authority, syncs from Global when available, operates independently otherwise
- **Clients**: Android Chrome browsers, connect via WebSocket, estimate server time via NTP-style sync

## Quick Start

### Prerequisites

- Node.js 18+
- ffmpeg (for test video generation)

### Install

```bash
npm install
```

### Generate Test Videos

```bash
npm run generate:test-videos
```

Generates 80 synthetic 3-minute test videos (1080x1080, 30fps, H.264) with visible timestamps and frame counters.

### Start Servers

```bash
# Global server (port 8080)
npm run start:global

# Local server (port 8081) - in another terminal
npm run start:local

# Local server with upstream sync
UPSTREAM_URL=http://localhost:8080 npm run start:local
```

### Open Clients

```
http://localhost:8081/client.html?slot=1
http://localhost:8081/client.html?slot=32
http://localhost:8081/client.html?slot=80&debug=1
http://localhost:8080/client-lte.html?slot=1
http://localhost:8080/client-lte.html?slot=32&debug=1
```

- `client.html` keeps the existing Wi-Fi behavior and waits for the full local cache before playback starts.
- `client-lte.html` starts streaming immediately instead of blocking on a full precache download.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | 8081 (local) / 8080 (global) | Server port |
| `HOST` | 0.0.0.0 | Bind address |
| `UPSTREAM_URL` | (empty) | Global server URL for local server sync |
| `CONTROL_TOKEN` | (empty) | Bearer token for `/api/control/restart` |
| `COUNT` | 80 | Number of test videos to generate |
| `DURATION_SECONDS` | 180 | Test video duration |
| `FPS` | 30 | Test video frame rate |
| `CONCURRENCY` | 4 | Parallel video generation workers |

See `.env.example` for all options.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Server health check |
| `/api/state` | GET | Current show timeline state |
| `/api/control/restart` | POST | Restart show timeline (requires `CONTROL_TOKEN` if set) |
| `/ws?slot=N` | WebSocket | Client sync connection |

## Sync Strategy

1. Client sends periodic `timesync` requests (1s startup, 3s steady state)
2. Server replies with epoch timestamp
3. Client filters by RTT, applies exponential moving average to offset estimate
4. Playback correction: ignore (<15ms), rate adjust (15-120ms), seek (>120ms)

## Video Encoding

All videos must have identical parameters:
- H.264, 1080x1080, 30fps CFR
- No audio
- GOP = 30 (`-g 30 -keyint_min 30 -sc_threshold 0`)
- Identical duration and frame count
