package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.service.WsEndpointBuilder;
import com.sdr.v2.backend.web.dto.RegistryCatalogDto;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/catalog")
public class RegistryCatalogController {

    private final RegistryStateService registry;
    private final WsEndpointBuilder ws;

    public RegistryCatalogController(RegistryStateService registry, WsEndpointBuilder ws) {
        this.registry = registry;
        this.ws = ws;
    }

    @GetMapping
    public RegistryCatalogDto catalog(HttpServletRequest request) {
        return registry.catalog(ws.buildWsBaseUrl(request));
    }

    @GetMapping("/hosts/{hostId}")
    public RegistryCatalogDto.HostCatalog hostCatalog(@PathVariable long hostId, HttpServletRequest request) {
        RegistryCatalogDto.HostCatalog host = registry.hostCatalog(hostId, ws.buildWsBaseUrl(request));
        if (host == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Host not found");
        }
        return host;
    }
}
