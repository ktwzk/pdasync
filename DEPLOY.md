# Video Sync Service Installation

## Linux (systemd)

### Global Server

```bash
sudo cp video-sync-global.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable video-sync-global
sudo systemctl start video-sync-global
```

### Local Server

```bash
sudo cp video-sync-local.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable video-sync-local
sudo systemctl start video-sync-local
```

### View logs

```bash
sudo journalctl -u video-sync-global -f
sudo journalctl -u video-sync-local -f
```

## Docker

### Global only

```bash
docker build -f Dockerfile.global -t video-sync-global .
docker run -d --name global -p 8080:8080 -v $(pwd)/videos:/app/videos video-sync-global
```

### Local only

```bash
docker build -f Dockerfile.local -t video-sync-local .
docker run -d --name local -p 8081:8081 -e UPSTREAM_URL=http://your-vps:8080 -v $(pwd)/videos:/app/videos video-sync-local
```

### Both (docker-compose)

```bash
docker compose up -d
```

## Windows

### Quick start (batch files)

Double-click `start-global.bat` or `start-local.bat`. These auto-restart on crash.

### Install as Windows Service (NSSM)

1. Download [NSSM](https://nssm.cc/download)
2. Install global server:
   ```cmd
   nssm install VideoSyncGlobal "C:\Program Files\nodejs\node.exe" "C:\path\to\server-global.js"
   nssm set VideoSyncGlobal AppDirectory "C:\path\to\video-sync"
   nssm set VideoSyncGlobal AppEnvironmentExtra PORT=8080
   nssm start VideoSyncGlobal
   ```
3. Install local server:
   ```cmd
   nssm install VideoSyncLocal "C:\Program Files\nodejs\node.exe" "C:\path\to\server-local.js"
   nssm set VideoSyncLocal AppDirectory "C:\path\to\video-sync"
   nssm set VideoSyncLocal AppEnvironmentExtra PORT=8081 UPSTREAM_URL=http://localhost:8080
   nssm start VideoSyncLocal
   ```

## Configuration

Edit the `.env.global` and `.env.local` files or set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 8080 (global), 8081 (local) | Server port |
| HOST | 0.0.0.0 | Bind address |
| UPSTREAM_URL | (empty) | Global server URL for local to sync from |
| CONTROL_TOKEN | (empty) | Bearer token for /api/control/restart |
