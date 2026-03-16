package com.sdr.v2.backend.web.dto;

import java.time.Instant;

public record HostDto(
        Long id,
        String hostKey,
        String hostName,
        String ipAddress,
        String osName,
        String osVersion,
        String arch,
        String agentVersion,
        String state,
        Instant lastSeenAt
) {
}
