package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.web.dto.HostDto;
import com.sdr.v2.backend.web.dto.RadioDeviceDto;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/hosts")
public class HostsController {

    private final RegistryStateService registry;

    public HostsController(RegistryStateService registry) {
        this.registry = registry;
    }

    @GetMapping
    public List<HostDto> list() {
        return registry.listHosts();
    }

    @GetMapping("/{id}")
    public HostDto get(@PathVariable long id) {
        HostDto host = registry.getHost(id);
        if (host == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Host not found");
        }
        return host;
    }

    @GetMapping("/{id}/devices")
    public List<RadioDeviceDto> devices(@PathVariable long id) {
        return registry.listDevicesByHost(id);
    }
}
