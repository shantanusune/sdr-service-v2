package com.sdr.v2.backend.web.dto;

import java.time.Instant;
import java.util.Map;

public record DataSourceDto(
        Long id,
        String sourceKey,
        String sourceType,
        String displayName,
        String state,
        String mqttTopic,
        Long hostId,
        String hostKey,
        Long deviceId,
        String deviceKey,
        Map<String, Object> capabilities,
        String wsEndpoint,
        String wsPath,
        Instant lastSeenAt
) {
}
