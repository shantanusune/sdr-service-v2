package com.sdr.v2.backend.web.dto;

import java.util.Map;

public record ServiceInfoDto(
        String hostKey,
        String hostName,
        String serviceKey,
        String state,
        String mqttTopic,
        Map<String, Object> config
) {
}
