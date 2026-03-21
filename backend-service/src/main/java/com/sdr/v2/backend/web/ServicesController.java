package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.web.dto.ServiceInfoDto;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/services")
public class ServicesController {

    private final RegistryStateService registry;

    public ServicesController(RegistryStateService registry) {
        this.registry = registry;
    }

    @GetMapping
    public List<ServiceInfoDto> services() {
        return registry.listServices();
    }
}
