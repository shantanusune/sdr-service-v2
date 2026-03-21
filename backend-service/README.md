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

RFML lab:

- `GET /api/rfml/samples` (list completed captures with extracted feature vectors)
- `POST /api/rfml/labels` (annotate capture with label + notes)
- `POST /api/rfml/train` (train prototype softmax model and export artifact)
- `GET /api/rfml/models` (list trained model artifacts from current runtime)
- `POST /api/rfml/models/load` (load artifact into active IQ detector)

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
- `APP_DETECTION_ML_MODEL_PATH` (optional JSON model file path; default uses embedded model)

Detection events now include IQ dump metadata in `evidence` when dump is enabled:
- `iqDumpPath`
- `iqDumpBytes`
- `iqFrameBytes`
- `iqDumpTruncated`

2.4 GHz protocol labeling (heuristic IQ classification) emits detection types:
- `wifi_control_link`
- `digital_video_link`
- `fhss_control_suspected`
- `unknown_2_4ghz`

ML model inference fields in event evidence:
- `mlModelVersion`
- `mlModelSource`
- `mlProbabilityByLabel`

Model file template:
- `config/iq-ml-model-template.json`

## RFML Prototype Flow

1. Capture IQ in Raw Lab (`POST /api/captures`).
2. Analyze capture and generate summary metrics (`POST /api/analysis/jobs`).
3. Label samples (`POST /api/rfml/labels`) with one of:
   - `wifi_control_link`
   - `digital_video_link`
   - `fhss_control_suspected`
   - `drone_iq_activity`
   - `rf_band_activity`
4. Train model (`POST /api/rfml/train`), which writes a model artifact under `./data/ml-models`.
5. Load artifact into active detection (`POST /api/rfml/models/load`) or train with auto-load.
