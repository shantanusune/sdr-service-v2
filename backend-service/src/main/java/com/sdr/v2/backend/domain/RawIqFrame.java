package com.sdr.v2.backend.domain;

public record RawIqFrame(
        String machineId,
        String deviceId,
        long timestampNs,
        long sequence,
        long centerFreqHz,
        long sampleRateHz,
        int iqFormat,
        byte[] payload
) {
}
