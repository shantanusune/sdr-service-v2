#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace/sdr-services-v2}"
NATIVE_DIR="${WORKSPACE_DIR}/native-sdr"
BUILD_DIR="${NATIVE_DIR}/build"

for _ in $(seq 1 60); do
  if [[ -d "${NATIVE_DIR}" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -d "${NATIVE_DIR}" ]]; then
  echo "native-sdr directory not found at ${NATIVE_DIR}" >&2
  exit 1
fi

mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

cmake ..
cmake --build . -j"$(nproc)"

SDR_DRIVER="${SDR_DRIVER:-hackrf}"
SDR_DEVICE_ID="${SDR_DEVICE_ID:-${SDR_DRIVER}_0}"
SDR_FREQ_HZ="${SDR_FREQ_HZ:-2400000000}"
SDR_SR_HZ="${SDR_SR_HZ:-10000000}"
SDR_GAIN_DB="${SDR_GAIN_DB:-}"
SDR_INDEX="${SDR_INDEX:-0}"
SDR_SERIAL="${SDR_SERIAL:-}"
SDR_ZMQ_ENDPOINT="${SDR_ZMQ_ENDPOINT:-tcp://0.0.0.0:5555}"
SDR_HARD_RESET_ON_STOP="${SDR_HARD_RESET_ON_STOP:-false}"

args=(
  --driver "${SDR_DRIVER}"
  --device-id "${SDR_DEVICE_ID}"
  --freq "${SDR_FREQ_HZ}"
  --sr "${SDR_SR_HZ}"
  --zmq "${SDR_ZMQ_ENDPOINT}"
)

if [[ "${SDR_DRIVER}" == "rtl" ]]; then
  args+=(--index "${SDR_INDEX}")
fi

if [[ -n "${SDR_SERIAL}" ]]; then
  args+=(--serial "${SDR_SERIAL}")
fi

if [[ -n "${SDR_GAIN_DB}" ]]; then
  args+=(--gain "${SDR_GAIN_DB}")
fi

if [[ "${SDR_HARD_RESET_ON_STOP}" == "true" ]]; then
  args+=(--hard-reset-on-stop)
fi

echo "Starting native_sdr with args: ${args[*]}"
exec ./native_sdr "${args[@]}"
