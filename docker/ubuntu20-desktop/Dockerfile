FROM dorowu/ubuntu-desktop-lxde-vnc:focal

USER root

ENV DEBIAN_FRONTEND=noninteractive

RUN rm -f /etc/apt/sources.list.d/google-chrome.list /etc/apt/sources.list.d/google.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    git \
    curl \
    wget \
    ca-certificates \
    gnupg2 \
    software-properties-common \
    unzip \
    usbutils \
    udev \
    python3 \
    python3-pip \
    openjdk-21-jdk \
    libzmq3-dev \
    libhackrf-dev \
    hackrf \
    librtlsdr-dev \
    rtl-sdr \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 for UI build/dev server.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY docker/ubuntu20-desktop/scripts/start-native.sh /usr/local/bin/start-native.sh
COPY docker/ubuntu20-desktop/scripts/start-backend.sh /usr/local/bin/start-backend.sh
COPY docker/ubuntu20-desktop/scripts/start-ui.sh /usr/local/bin/start-ui.sh
COPY docker/ubuntu20-desktop/supervisor/sdr-stack.conf /etc/supervisor/conf.d/sdr-stack.conf

RUN chmod +x /usr/local/bin/start-native.sh /usr/local/bin/start-backend.sh /usr/local/bin/start-ui.sh \
    && mkdir -p /var/log/sdr /workspace/sdr-services-v2 /workspace/sdr-services-v2/data
