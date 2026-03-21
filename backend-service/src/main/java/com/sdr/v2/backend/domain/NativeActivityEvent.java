package com.sdr.v2.backend.domain;

import java.time.Instant;
import java.util.Map;

public record NativeActivityEvent(
        String machineId,
        String topic,
        Instant ts,
        Map<String, Object> payload
) {
}
