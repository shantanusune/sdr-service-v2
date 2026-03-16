package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.service.WsEndpointBuilder;
import com.sdr.v2.backend.web.dto.DataSourceDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/datasources")
public class DataSourcesController {

    private final RegistryStateService registry;
    private final WsEndpointBuilder ws;

    public DataSourcesController(RegistryStateService registry, WsEndpointBuilder ws) {
        this.registry = registry;
        this.ws = ws;
    }

    @GetMapping
    public List<DataSourceDto> list(@RequestParam(required = false) String state, HttpServletRequest request) {
        return registry.listDataSources(state, ws.buildWsBaseUrl(request));
    }

    @GetMapping("/streamable")
    public List<DataSourceDto> streamable(HttpServletRequest request) {
        return registry.listStreamableDataSources(ws.buildWsBaseUrl(request));
    }

    @GetMapping("/host/{hostId}")
    public List<DataSourceDto> byHost(HttpServletRequest request,
                                      @org.springframework.web.bind.annotation.PathVariable long hostId) {
        return registry.listDataSources(null, ws.buildWsBaseUrl(request)).stream()
                .filter(ds -> ds.hostId() != null && ds.hostId() == hostId)
                .toList();
    }
}
