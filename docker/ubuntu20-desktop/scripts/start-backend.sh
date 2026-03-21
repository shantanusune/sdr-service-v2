#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace/sdr-services-v2}"
BACKEND_DIR="${WORKSPACE_DIR}/backend-service"

for _ in $(seq 1 60); do
  if [[ -d "${BACKEND_DIR}" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "backend-service directory not found at ${BACKEND_DIR}" >&2
  exit 1
fi

cd "${BACKEND_DIR}"

export APP_ZMQ_ENDPOINT="${APP_ZMQ_ENDPOINT:-tcp://127.0.0.1:5555}"
export APP_SECURITY_AUTH_ENABLED="${APP_SECURITY_AUTH_ENABLED:-false}"
export APP_DETECTION_IQ_DUMP_DIR="${APP_DETECTION_IQ_DUMP_DIR:-${WORKSPACE_DIR}/data/iq-dumps}"

mkdir -p "${WORKSPACE_DIR}/data/iq-dumps" "${WORKSPACE_DIR}/data/ml-models" "${WORKSPACE_DIR}/data/rfml"

echo "Starting backend-service with APP_ZMQ_ENDPOINT=${APP_ZMQ_ENDPOINT}"
exec ./gradlew --no-daemon bootRun
