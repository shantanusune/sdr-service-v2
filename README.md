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
