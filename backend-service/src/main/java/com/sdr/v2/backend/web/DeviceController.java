package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.LegacyUiService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

    private final LegacyUiService legacy;

    public DeviceController(LegacyUiService legacy) {
        this.legacy = legacy;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return legacy.devices();
    }
}
