package com.sdr.v2.backend.domain;

import java.time.Instant;

public record DeviceState(
        String machineId,
        String deviceId,
        String deviceType,
        String status,
        long centerFreqHz,
        long sampleRateHz,
        Instant lastSeen
) {
}
