#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'EOF'
Usage: install-native-sdr-deps.sh [options]

Installs native build/runtime dependencies for SDR native service:
- ZeroMQ
- RTL-SDR
- HackRF
- build toolchain (cmake, compiler, pkg-config)

Options:
  --help      Show this help and exit
  --dry-run   Print commands without executing
  --no-update Skip package index refresh where applicable
EOF
}

DRY_RUN=0
NO_UPDATE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help)
      print_usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --no-update)
      NO_UPDATE=1
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
  shift
done

run_cmd() {
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "+ $*"
    return 0
  fi
  "$@"
}

run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    run_cmd "$@"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    run_cmd sudo "$@"
    return 0
  fi
  echo "Root privileges are required. Re-run as root or install sudo." >&2
  exit 1
}

install_linux_apt() {
  local packages=(
    build-essential
    cmake
    pkg-config
    libzmq3-dev
    librtlsdr-dev
    rtl-sdr
    libhackrf-dev
    hackrf
    libusb-1.0-0-dev
    usbutils
  )

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_as_root apt-get update
  fi
  run_as_root apt-get install -y "${packages[@]}"
}

install_linux_dnf() {
  local packages=(
    gcc
    gcc-c++
    make
    cmake
    pkgconf-pkg-config
    zeromq-devel
    rtl-sdr-devel
    rtl-sdr
    hackrf-devel
    hackrf
    usbutils
  )

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_as_root dnf makecache
  fi
  run_as_root dnf install -y "${packages[@]}"
}

install_linux_yum() {
  local packages=(
    gcc
    gcc-c++
    make
    cmake
    pkgconfig
    zeromq-devel
    rtl-sdr-devel
    rtl-sdr
    hackrf-devel
    hackrf
    usbutils
  )

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_as_root yum makecache
  fi
  run_as_root yum install -y "${packages[@]}"
}

install_linux_pacman() {
  local packages=(
    base-devel
    cmake
    pkgconf
    zeromq
    rtl-sdr
    hackrf
    usbutils
  )

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_as_root pacman -Sy --noconfirm
  fi
  run_as_root pacman -S --needed --noconfirm "${packages[@]}"
}

install_linux_zypper() {
  local packages=(
    gcc
    gcc-c++
    make
    cmake
    pkg-config
    libzmq-devel
    rtl-sdr-devel
    rtl-sdr
    libhackrf-devel
    hackrf
    usbutils
  )

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_as_root zypper refresh
  fi
  run_as_root zypper --non-interactive install "${packages[@]}"
}

install_macos_brew() {
  local packages=(cmake pkg-config zeromq rtl-sdr hackrf)
  local missing=()
  local p

  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install from https://brew.sh and re-run." >&2
    exit 1
  fi

  for p in "${packages[@]}"; do
    if ! brew list --versions "${p}" >/dev/null 2>&1; then
      missing+=("${p}")
    fi
  done

  if [[ "${#missing[@]}" -eq 0 ]]; then
    echo "All required Homebrew packages already installed."
    return 0
  fi

  if [[ "${NO_UPDATE}" -eq 0 ]]; then
    run_cmd brew update
  fi
  run_cmd brew install "${missing[@]}"
}

OS="$(uname -s)"
case "${OS}" in
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      install_linux_apt
    elif command -v dnf >/dev/null 2>&1; then
      install_linux_dnf
    elif command -v yum >/dev/null 2>&1; then
      install_linux_yum
    elif command -v pacman >/dev/null 2>&1; then
      install_linux_pacman
    elif command -v zypper >/dev/null 2>&1; then
      install_linux_zypper
    else
      echo "Unsupported Linux package manager. Install dependencies manually." >&2
      exit 1
    fi
    ;;
  Darwin)
    install_macos_brew
    ;;
  *)
    echo "Unsupported OS: ${OS}" >&2
    exit 1
    ;;
esac

echo "Native SDR dependencies installed."
