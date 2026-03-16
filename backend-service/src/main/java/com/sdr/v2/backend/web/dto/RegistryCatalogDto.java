package com.sdr.v2.backend.web.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record RegistryCatalogDto(
        Map<String, Object> broker,
        Map<String, Object> websocket,
        List<HostCatalog> hosts,
        Instant generatedAt
) {
    public record HostCatalog(
            Long id,
            String hostKey,
            String hostName,
            String ipAddress,
            String state,
            Instant lastSeenAt,
            List<ServiceCatalog> services,
            List<DeviceCatalog> devices,
            List<DataSourceCatalog> dataSources,
            List<TopicCatalog> topics
    ) {
    }

    public record ServiceCatalog(
            String serviceKey,
            String displayName,
            String state,
            String topic,
            Map<String, Object> config
    ) {
    }

    public record DeviceCatalog(
            Long id,
            String deviceKey,
            String deviceType,
            String serialNumber,
            String state,
            Instant lastSeenAt,
            Map<String, Object> meta
    ) {
    }

    public record DataSourceCatalog(
            Long id,
            String sourceKey,
            String sourceType,
            String displayName,
            String state,
            String mqttTopic,
            String wsEndpoint,
            String wsPath,
            Map<String, Object> capabilities
    ) {
    }

    public record TopicCatalog(
            Long id,
            String topic,
            String direction,
            boolean enabled
    ) {
    }
}
