# SDR Services V2

`SDR Services V2` is a consolidated, IQ-first SDR stack for drone detection with full UI compatibility.

## Folders

- `ui`: Observability frontend (migrated from current platform) with Keycloak auth and full menu set.
- `native-sdr`: Native C capture service for RTL-SDR/HackRF publishing ZMQ metadata and IQ rawfeed frames.
- `backend-service`: Monolithic bridge + analyzer + registry API layer with websocket live spectrum feeds.
- `contracts`: Cross-service topic/frame contract docs.

## End-to-End Data Flow

1. `native-sdr` publishes over ZMQ:
   - `meta/host`, `meta/service`, `meta/devices`, `meta/topics`, `meta/usb`
   - `<deviceId>/rawfeed` (`RDSD` header + IQ bytes)
2. `backend-service` ingests ZMQ and:
   - updates registry state (hosts/devices/datasources/topics/services)
   - runs IQ-first detection
   - computes FFT and serves live spectrum websocket frames
3. `ui` consumes backend APIs and websocket feeds for dashboards, devices, map, and live spectrum.

## Contract

- Topic and frame contract: `contracts/rdsd-v1.md`

## Quick Start

1. Start native capture:

```bash
cd native-sdr
mkdir -p build && cd build
cmake ..
cmake --build . -j
./native_sdr --driver rtl --device-id rtl_0 --index 0 --freq 2400000000 --sr 2560000 --zmq tcp://127.0.0.1:5555
```

Or use the OS/ARCH-aware host launcher (builds to `native-sdr/build/<os>-<arch>` and auto-selects driver when `SDR_DRIVER=auto`):

```bash
./scripts/run-native-sdr-host.sh
```

2. Start backend:

```bash
cd backend-service
./gradlew bootRun
```

3. Start UI:

```bash
cd ui
cp .env.example .env
npm install
npm run dev
```

Default backend URL: `http://localhost:8090`

## Host Native Service (OS/ARCH Aware)

For host deployments, use the launcher + systemd installer:

```bash
# Install native dependencies for your OS (HackRF/RTL-SDR/ZeroMQ/toolchain)
./scripts/install-native-sdr-deps.sh

# Runs native service directly on this machine (Linux/macOS, x86_64/arm64)
./scripts/run-native-sdr-host.sh

# Linux only: install as persistent systemd service
./scripts/install-native-sdr-service.sh --start
```

Useful runner flags:

- `--print-target` to verify resolved machine target
- `--skip-build` to run an existing binary without cmake
- `--dry-run` to print command only
- `--help-script` to view launcher usage

Dependency installer options:

- `./scripts/install-native-sdr-deps.sh --dry-run`
- `./scripts/install-native-sdr-deps.sh --no-update`

Key runtime envs (from shell or `/etc/default/sdr-native`):

- `SDR_DRIVER=auto|hackrf|rtl`
- `AUTO_FALLBACK_DRIVER=hackrf|rtl` (used if autodetect cannot identify USB device)
- `SDR_FREQ_HZ=2400000000`
- `SDR_SR_HZ=10000000`
- `SDR_GAIN_DB=<optional>`
- `SDR_INDEX=0` (RTL)
- `SDR_SERIAL=<optional>`
- `SDR_ZMQ_ENDPOINT=tcp://127.0.0.1:5555`
- `SDR_HARD_RESET_ON_STOP=true|false`
- `NATIVE_SKIP_BUILD=true|false` (default `false`)

## Docker (Ubuntu 20 Desktop + Full Stack)

This repo includes a single-container Ubuntu 20 desktop runtime that starts:

- `native-sdr` (compiled on container startup)
- `backend-service` (`./gradlew bootRun`)
- `ui` (Vite dev server)

It also exposes a browser desktop using noVNC.

### Build

```bash
docker compose build
```

### Run (without USB passthrough)

```bash
docker compose up -d
```

### Run (with HackRF/RTL-SDR USB passthrough on Linux hosts)

```bash
docker compose -f docker-compose.yml -f docker-compose.usb.yml up -d
```

### Endpoints

- Desktop (noVNC): `http://localhost:6080`
- UI: `http://localhost:5173`
- Backend API: `http://localhost:8090`
- Native ZMQ PUB: `tcp://localhost:5555`

### Persistence

Persistent Docker volumes are configured for:

- `sdr_v2_data` -> `./data` (IQ dumps, RFML labels, trained models)
- `sdr_v2_gradle` -> Gradle cache
- `sdr_v2_npm` -> npm cache
- `sdr_v2_ui_node_modules` -> UI node_modules

### Runtime configuration

You can override startup envs in shell or `.env` before `docker compose up`:

- `DOCKER_PLATFORM=linux/amd64` (default; image is amd64)
- `SDR_DRIVER=hackrf|rtl`
- `SDR_DEVICE_ID=hackrf_0|rtl_0`
- `SDR_INDEX=0` (RTL-SDR index)
- `SDR_SERIAL=<serial>` (optional)
- `SDR_FREQ_HZ=2400000000`
- `SDR_SR_HZ=10000000`
- `SDR_GAIN_DB=32` (optional)
- `SDR_HARD_RESET_ON_STOP=true|false`
- `VITE_MOCK_AUTH=true|false`
- `VITE_MOCK_API=true|false`

### Notes on macOS/Windows

Direct `/dev/bus/usb` passthrough is a Linux Docker host feature. On macOS/Windows Docker Desktop, SDR USB devices are not directly attachable to Linux containers. For real hardware capture, run this stack on a Linux host (or Linux VM with USB passthrough).
