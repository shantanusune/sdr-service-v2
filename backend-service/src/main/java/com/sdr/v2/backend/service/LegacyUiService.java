package com.sdr.v2.backend.service;

import com.sdr.v2.backend.web.dto.HostDto;
import com.sdr.v2.backend.web.dto.RadioDeviceDto;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class LegacyUiService {

    private final RegistryStateService registry;
    private final RawLabCaptureService rawLab;
    private final RfmlLabService rfmlLab;

    private final CopyOnWriteArrayList<Map<String, Object>> dashboards = new CopyOnWriteArrayList<>();

    public LegacyUiService(RegistryStateService registry, RawLabCaptureService rawLab, RfmlLabService rfmlLab) {
        this.registry = registry;
        this.rawLab = rawLab;
        this.rfmlLab = rfmlLab;
        seedDefaults();
    }

    public Map<String, Object> me() {
        return Map.of(
                "userId", "sdr-v2-user",
                "name", "SDR Operator",
                "email", "operator@sdr.local",
                "roles", List.of("ADMIN", "ANALYST", "VIEWER")
        );
    }

    public List<Map<String, Object>> machines() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (HostDto h : registry.listHosts()) {
            out.add(Map.of(
                    "machineId", h.hostKey(),
                    "name", (h.hostName() == null || h.hostName().isBlank()) ? h.hostKey() : h.hostName(),
                    "siteName", (h.hostName() == null || h.hostName().isBlank()) ? h.hostKey() : h.hostName(),
                    "lat", pseudoLat(h.hostKey()),
                    "lon", pseudoLon(h.hostKey()),
                    "status", machineStatus(h.state())
            ));
        }
        return out;
    }

    public List<Map<String, Object>> devices() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (HostDto h : registry.listHosts()) {
            for (RadioDeviceDto d : registry.listDevicesByHost(h.id())) {
                long cf = extractLong(d.meta(), "state", "centerFreqHz", "centerHz");
                long sr = extractLong(d.meta(), "state", "sampleRateHz", "srHz");
                out.add(Map.of(
                        "deviceId", d.deviceKey(),
                        "machineId", h.hostKey(),
                        "type", d.deviceType(),
                        "lastSeenTs", d.lastSeenAt() == null ? 0L : d.lastSeenAt().toEpochMilli(),
                        "cf", cf,
                        "sr", sr,
                        "online", isOnlineDeviceState(d.state())
                ));
            }
        }
        return out;
    }

    public Map<String, Object> deviceStatus(String deviceId) {
        for (HostDto h : registry.listHosts()) {
            for (RadioDeviceDto d : registry.listDevicesByHost(h.id())) {
                if (!deviceId.equals(d.deviceKey())) {
                    continue;
                }
                long cf = extractLong(d.meta(), "state", "centerFreqHz", "centerHz");
                long sr = extractLong(d.meta(), "state", "sampleRateHz", "srHz");
                return Map.of(
                        "lastSeenTs", d.lastSeenAt() == null ? 0L : d.lastSeenAt().toEpochMilli(),
                        "online", isOnlineDeviceState(d.state()),
                        "cf", cf,
                        "sr", sr,
                        "seq", System.currentTimeMillis() % 100000
                );
            }
        }
        return Map.of(
                "lastSeenTs", 0,
                "online", false,
                "cf", 0,
                "sr", 0,
                "seq", 0
        );
    }

    public void controlDevice(String deviceId, Map<String, Object> control) {
        // Control is accepted as compatibility API surface.
        // Bridgeing control back to native SDR can be added through a future control PUB channel.
    }

    public List<Map<String, Object>> listDashboards() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> d : dashboards) {
            out.add(new LinkedHashMap<>(d));
        }
        return out;
    }

    public Map<String, Object> createDashboard(Map<String, Object> dashboard) {
        String id = "dashboard-" + UUID.randomUUID();
        long now = System.currentTimeMillis();
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("name", dashboard.getOrDefault("name", "Dashboard"));
        out.put("widgets", dashboard.getOrDefault("widgets", List.of()));
        out.put("createdAt", now);
        out.put("updatedAt", now);
        dashboards.add(out);
        return new LinkedHashMap<>(out);
    }

    public Map<String, Object> updateDashboard(String id, Map<String, Object> update) {
        for (int i = 0; i < dashboards.size(); i++) {
            Map<String, Object> current = dashboards.get(i);
            if (!id.equals(current.get("id"))) {
                continue;
            }
            LinkedHashMap<String, Object> merged = new LinkedHashMap<>(current);
            merged.putAll(update);
            merged.put("id", id);
            merged.put("updatedAt", System.currentTimeMillis());
            dashboards.set(i, merged);
            return new LinkedHashMap<>(merged);
        }
        return createDashboard(update);
    }

    public void deleteDashboard(String id) {
        dashboards.removeIf(d -> id.equals(d.get("id")));
    }

    public Map<String, Object> createCapture(Map<String, Object> request) {
        return rawLab.createCapture(request);
    }

    public List<Map<String, Object>> listCaptures() {
        return rawLab.listCaptures();
    }

    public Map<String, Object> createAnalysisJob(Map<String, Object> request) {
        return rawLab.createAnalysisJob(request);
    }

    public List<Map<String, Object>> listRfmlSamples() {
        return rfmlLab.listSamples();
    }

    public Map<String, Object> labelRfmlSample(Map<String, Object> request) {
        return rfmlLab.labelCapture(request);
    }

    public Map<String, Object> trainRfmlModel(Map<String, Object> request) {
        return rfmlLab.trainModel(request);
    }

    public List<Map<String, Object>> listRfmlModels() {
        return rfmlLab.listModels();
    }

    public Map<String, Object> loadRfmlModel(Map<String, Object> request) {
        return rfmlLab.loadModel(request);
    }

    private void seedDefaults() {
        if (!dashboards.isEmpty()) {
            return;
        }
        long now = System.currentTimeMillis();
        dashboards.add(new LinkedHashMap<>(Map.of(
                "id", "default",
                "name", "Main Dashboard",
                "widgets", List.of(),
                "createdAt", now,
                "updatedAt", now
        )));
    }

    private static String machineStatus(String state) {
        if (state == null) {
            return "warning";
        }
        String s = state.toUpperCase();
        if ("OFFLINE".equals(s)) {
            return "offline";
        }
        if ("ERROR".equals(s) || "UNKNOWN".equals(s)) {
            return "warning";
        }
        return "online";
    }

    private static boolean isOnlineDeviceState(String state) {
        if (state == null) {
            return false;
        }
        String s = state.toUpperCase();
        return !("OFFLINE".equals(s) || "ERROR".equals(s) || "UNKNOWN".equals(s));
    }

    @SuppressWarnings("unchecked")
    private static long extractLong(Map<String, Object> meta, String nested, String... keys) {
        Object stateObj = meta == null ? null : meta.get(nested);
        if (!(stateObj instanceof Map<?, ?> stateRaw)) {
            return 0L;
        }
        Map<String, Object> state = (Map<String, Object>) stateRaw;
        for (String key : keys) {
            Object v = state.get(key);
            if (v instanceof Number n) {
                return n.longValue();
            }
            if (v instanceof String s) {
                try {
                    return Long.parseLong(s);
                } catch (NumberFormatException ignored) {
                    // Continue next key.
                }
            }
        }
        return 0L;
    }

    private static double pseudoLat(String key) {
        int h = Math.abs(key.hashCode());
        return -55.0 + ((h % 11000) / 100.0);
    }

    private static double pseudoLon(String key) {
        int h = Math.abs((key + ":lon").hashCode());
        return -170.0 + ((h % 34000) / 100.0);
    }
}
