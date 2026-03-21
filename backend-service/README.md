# backend-service

Monolithic SDR backend for v2 with end-to-end flow:

- ZMQ ingest from `native-sdr` (`meta/*`, `<device>/rawfeed`, optional `<device>/spectrum`)
- IQ-first detection
- FFT generation for live spectrum feeds
- In-memory registry/catalog APIs compatible with existing observability UI
- WebSocket binary streaming (`/ws/stream/<machine>/<device>/(spectrum|rawfeed)`)

## Main APIs

Registry/UI compatibility:

- `GET /api/datasources`
- `GET /api/datasources/streamable`
- `GET /api/datasources/host/{hostId}`
- `GET /api/hosts`
- `GET /api/hosts/{id}`
- `GET /api/hosts/{id}/devices`
- `GET /api/catalog`
- `GET /api/catalog/hosts/{hostId}`
- `GET /api/services`

Legacy UI compatibility:

- `GET /api/me`
- `GET /api/machines`
- `GET /api/devices`
- `GET /api/devices/{deviceId}/status`
- `POST /api/devices/{deviceId}/control`
- `GET/POST/PUT/DELETE /api/dashboards...`
- `GET/POST /api/captures`
- `POST /api/analysis/jobs`

Events and health:

- `GET /api/events`
- `DELETE /api/events`
- `GET /health`

Streaming:

- `WS /ws/stream/{machineIp}/{deviceId}/spectrum`
- `WS /ws/stream/{machineIp}/{deviceId}/rawfeed`
- `SSE /api/v1/stream/spectrum` (compatibility stream)

## Run

```bash
./gradlew bootRun
```

## Key environment variables

- `APP_ZMQ_ENDPOINT` (default `tcp://127.0.0.1:5555`)
- `APP_SECURITY_AUTH_ENABLED` (`false` by default)
- `KEYCLOAK_ISSUER_URI` (required only if auth is enabled)
- `APP_DETECTION_IQ_DUMP_ENABLED` (`true` by default)
- `APP_DETECTION_IQ_DUMP_DIR` (default `./data/iq-dumps`)
- `APP_DETECTION_IQ_DUMP_MAX_BYTES` (default `131072`)
- `APP_DETECTION_IQ_DUMP_MAX_FILES` (default `2000`)

Detection events now include IQ dump metadata in `evidence` when dump is enabled:
- `iqDumpPath`
- `iqDumpBytes`
- `iqFrameBytes`
- `iqDumpTruncated`
