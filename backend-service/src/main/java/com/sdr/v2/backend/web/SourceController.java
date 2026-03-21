package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.service.WsEndpointBuilder;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/sources")
public class SourceController {

    private final RegistryStateService registry;
    private final WsEndpointBuilder ws;

    public SourceController(RegistryStateService registry, WsEndpointBuilder ws) {
        this.registry = registry;
        this.ws = ws;
    }

    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest request) {
        return registry.listStreamableDataSources(ws.buildWsBaseUrl(request)).stream()
                .map(ds -> Map.<String, Object>of(
                        "sourceKey", ds.sourceKey(),
                        "displayName", ds.displayName(),
                        "state", ds.state(),
                        "wsEndpoint", ds.wsEndpoint(),
                        "wsPath", ds.wsPath(),
                        "mqttTopic", ds.mqttTopic(),
                        "detectionMode", "IQ-first"
                ))
                .toList();
    }
}
