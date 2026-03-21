package com.sdr.v2.backend.domain;

import java.time.Instant;
import java.util.Map;

public record DetectionEvent(
        String eventId,
        String machineId,
        String deviceId,
        Instant detectedAt,
        String type,
        String severity,
        double confidence,
        Map<String, Object> evidence
) {
}
