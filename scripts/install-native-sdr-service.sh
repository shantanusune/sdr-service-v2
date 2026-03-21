#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer currently supports Linux only (systemd)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNNER="${ROOT_DIR}/scripts/run-native-sdr-host.sh"

if [[ ! -x "${RUNNER}" ]]; then
  echo "Runner script is missing or not executable: ${RUNNER}" >&2
  exit 1
fi

SERVICE_NAME="${SERVICE_NAME:-sdr-native.service}"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
ENV_FILE="${ENV_FILE:-/etc/default/sdr-native}"

SUDO_BIN="${SUDO_BIN:-sudo}"
if [[ "${EUID}" -eq 0 ]]; then
  SUDO_BIN=""
fi

${SUDO_BIN} tee "${SERVICE_PATH}" >/dev/null <<EOF
[Unit]
Description=SDR Native Capture Service (OS/ARCH aware)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-${ENV_FILE}
ExecStart=${RUNNER}
WorkingDirectory=${ROOT_DIR}
Restart=always
RestartSec=2
User=root
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

if [[ ! -f "${ENV_FILE}" ]]; then
  ${SUDO_BIN} tee "${ENV_FILE}" >/dev/null <<'EOF'
# SDR native runtime defaults
SDR_DRIVER=auto
SDR_DEVICE_ID=
SDR_INDEX=0
SDR_SERIAL=
SDR_FREQ_HZ=2400000000
SDR_SR_HZ=10000000
SDR_GAIN_DB=
SDR_ZMQ_ENDPOINT=tcp://127.0.0.1:5555
SDR_HARD_RESET_ON_STOP=false
AUTO_FALLBACK_DRIVER=hackrf
NATIVE_JOBS=
NATIVE_SKIP_BUILD=false
EOF
fi

${SUDO_BIN} systemctl daemon-reload
${SUDO_BIN} systemctl enable "${SERVICE_NAME}"

if [[ "${1:-}" == "--start" ]]; then
  ${SUDO_BIN} systemctl restart "${SERVICE_NAME}"
fi

echo "Installed ${SERVICE_NAME}"
echo "Service file: ${SERVICE_PATH}"
echo "Environment file: ${ENV_FILE}"
echo "Start now: sudo systemctl start ${SERVICE_NAME}"
echo "Status: sudo systemctl status ${SERVICE_NAME}"
