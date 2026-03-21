package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.LegacyUiService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class LegacyApiController {

    private final LegacyUiService legacy;

    public LegacyApiController(LegacyUiService legacy) {
        this.legacy = legacy;
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        return legacy.me();
    }

    @GetMapping("/machines")
    public List<Map<String, Object>> machines() {
        return legacy.machines();
    }

    @GetMapping("/devices")
    public List<Map<String, Object>> devices() {
        return legacy.devices();
    }

    @GetMapping("/devices/{deviceId}/status")
    public Map<String, Object> status(@PathVariable String deviceId) {
        return legacy.deviceStatus(deviceId);
    }

    @PostMapping("/devices/{deviceId}/control")
    public void control(@PathVariable String deviceId, @RequestBody(required = false) Map<String, Object> body) {
        legacy.controlDevice(deviceId, body == null ? Map.of() : body);
    }

    @GetMapping("/dashboards")
    public List<Map<String, Object>> dashboards() {
        return legacy.listDashboards();
    }

    @PostMapping("/dashboards")
    public Map<String, Object> createDashboard(@RequestBody Map<String, Object> dashboard) {
        return legacy.createDashboard(dashboard);
    }

    @PutMapping("/dashboards/{id}")
    public Map<String, Object> updateDashboard(@PathVariable String id, @RequestBody Map<String, Object> dashboard) {
        return legacy.updateDashboard(id, dashboard);
    }

    @DeleteMapping("/dashboards/{id}")
    public void deleteDashboard(@PathVariable String id) {
        legacy.deleteDashboard(id);
    }

    @PostMapping("/captures")
    public Map<String, Object> createCapture(@RequestBody Map<String, Object> req) {
        return legacy.createCapture(req);
    }

    @GetMapping("/captures")
    public List<Map<String, Object>> listCaptures() {
        return legacy.listCaptures();
    }

    @PostMapping("/analysis/jobs")
    public Map<String, Object> createAnalysis(@RequestBody Map<String, Object> req) {
        return legacy.createAnalysisJob(req);
    }

    @GetMapping("/rfml/samples")
    public List<Map<String, Object>> rfmlSamples() {
        return legacy.listRfmlSamples();
    }

    @PostMapping("/rfml/labels")
    public Map<String, Object> labelRfmlSample(@RequestBody Map<String, Object> req) {
        return legacy.labelRfmlSample(req);
    }

    @PostMapping("/rfml/train")
    public Map<String, Object> trainRfmlModel(@RequestBody(required = false) Map<String, Object> req) {
        return legacy.trainRfmlModel(req == null ? Map.of() : req);
    }

    @GetMapping("/rfml/models")
    public List<Map<String, Object>> rfmlModels() {
        return legacy.listRfmlModels();
    }

    @PostMapping("/rfml/models/load")
    public Map<String, Object> loadRfmlModel(@RequestBody Map<String, Object> req) {
        return legacy.loadRfmlModel(req);
    }
}
