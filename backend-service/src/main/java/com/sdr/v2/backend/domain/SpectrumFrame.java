package com.sdr.v2.backend.domain;

public record SpectrumFrame(
        String machineId,
        String deviceId,
        long timestampNs,
        long sequence,
        long centerFreqHz,
        long sampleRateHz,
        int nfft,
        float binHz,
        float[] binsDb,
        float peakDb,
        long peakHz
) {
}
