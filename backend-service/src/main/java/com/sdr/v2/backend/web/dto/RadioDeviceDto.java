package com.sdr.v2.backend.web.dto;

import java.time.Instant;
import java.util.Map;

public record RadioDeviceDto(
        Long id,
        Long hostId,
        String hostKey,
        String deviceKey,
        String deviceType,
        String serialNumber,
        String state,
        Instant lastSeenAt,
        Map<String, Object> meta
) {
}
