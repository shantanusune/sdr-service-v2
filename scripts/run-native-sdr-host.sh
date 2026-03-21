#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NATIVE_DIR="${ROOT_DIR}/native-sdr"

if [[ ! -d "${NATIVE_DIR}" ]]; then
  echo "native-sdr directory not found: ${NATIVE_DIR}" >&2
  exit 1
fi

print_usage() {
  cat <<'EOF'
Usage: run-native-sdr-host.sh [script options] [native_sdr args]

Script options:
  --help-script   Show this help and exit
  --print-target  Print resolved target (linux|darwin + x86_64|arm64) and exit
  --skip-build    Skip cmake configure/build and run existing native_sdr binary
  --dry-run       Print resolved native_sdr command without executing it
  --              Treat remaining args as native_sdr args

Examples:
  ./scripts/run-native-sdr-host.sh
  SDR_DRIVER=auto ./scripts/run-native-sdr-host.sh
  NATIVE_SKIP_BUILD=true ./scripts/run-native-sdr-host.sh -- --help
  ./scripts/run-native-sdr-host.sh --skip-build -- --help
EOF
}

detect_target() {
  local os_raw arch_raw os arch
  os_raw="$(uname -s)"
  arch_raw="$(uname -m)"

  case "${os_raw}" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *)
      echo "Unsupported OS: ${os_raw}" >&2
      return 1
      ;;
  esac

  case "${arch_raw}" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Unsupported CPU architecture: ${arch_raw}" >&2
      return 1
      ;;
  esac

  echo "${os}-${arch}"
}

detect_driver_auto() {
  local fallback="${AUTO_FALLBACK_DRIVER:-hackrf}"

  if command -v lsusb >/dev/null 2>&1; then
    if lsusb 2>/dev/null | grep -Eqi 'hackrf|1d50:6089'; then
      echo "hackrf"
      return 0
    fi
    if lsusb 2>/dev/null | grep -Eqi 'rtl|realtek|0bda:2838'; then
      echo "rtl"
      return 0
    fi
  fi

  echo "${fallback}"
}

SCRIPT_HELP=0
DRY_RUN=0
SKIP_BUILD=0
PRINT_TARGET=0
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help-script)
      SCRIPT_HELP=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --print-target)
      PRINT_TARGET=1
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        PASSTHROUGH_ARGS+=("$1")
        shift
      done
      break
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      ;;
  esac
  shift
done

if [[ "${NATIVE_SKIP_BUILD:-false}" == "true" ]]; then
  SKIP_BUILD=1
fi

TARGET_TRIPLE="$(detect_target)"

if [[ "${SCRIPT_HELP}" -eq 1 ]]; then
  print_usage
  exit 0
fi

if [[ "${PRINT_TARGET}" -eq 1 ]]; then
  echo "${TARGET_TRIPLE}"
  exit 0
fi

BUILD_DIR="${NATIVE_DIR}/build/${TARGET_TRIPLE}"
JOBS="${NATIVE_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
BINARY="${BUILD_DIR}/native_sdr"

mkdir -p "${BUILD_DIR}"
cd "${BUILD_DIR}"

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  if ! command -v cmake >/dev/null 2>&1; then
    echo "cmake not found. Install cmake or run with --skip-build if binary already exists." >&2
    exit 1
  fi
  cmake ../..
  cmake --build . -j"${JOBS}"
fi

if [[ ! -x "${BINARY}" ]]; then
  echo "native_sdr binary not found or not executable: ${BINARY}" >&2
  echo "Run without --skip-build after installing build dependencies." >&2
  exit 1
fi

DRIVER="${SDR_DRIVER:-auto}"
if [[ "${DRIVER}" == "auto" ]]; then
  DRIVER="$(detect_driver_auto)"
fi

DEVICE_ID="${SDR_DEVICE_ID:-${DRIVER}_0}"
FREQ_HZ="${SDR_FREQ_HZ:-2400000000}"
SR_HZ="${SDR_SR_HZ:-10000000}"
GAIN_DB="${SDR_GAIN_DB:-}"
INDEX="${SDR_INDEX:-0}"
SERIAL="${SDR_SERIAL:-}"
ZMQ_ENDPOINT="${SDR_ZMQ_ENDPOINT:-tcp://127.0.0.1:5555}"
HARD_RESET_ON_STOP="${SDR_HARD_RESET_ON_STOP:-false}"

args=(
  --driver "${DRIVER}"
  --device-id "${DEVICE_ID}"
  --freq "${FREQ_HZ}"
  --sr "${SR_HZ}"
  --zmq "${ZMQ_ENDPOINT}"
)

if [[ "${DRIVER}" == "rtl" ]]; then
  args+=(--index "${INDEX}")
fi

if [[ -n "${SERIAL}" ]]; then
  args+=(--serial "${SERIAL}")
fi

if [[ -n "${GAIN_DB}" ]]; then
  args+=(--gain "${GAIN_DB}")
fi

if [[ "${HARD_RESET_ON_STOP}" == "true" ]]; then
  args+=(--hard-reset-on-stop)
fi

if [[ ${#PASSTHROUGH_ARGS[@]} -gt 0 ]]; then
  args+=("${PASSTHROUGH_ARGS[@]}")
fi

echo "OS/ARCH target: ${TARGET_TRIPLE}"
echo "Launching native_sdr: ${args[*]}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Dry run only: ${BINARY} ${args[*]}"
  exit 0
fi

exec "${BINARY}" "${args[@]}"
