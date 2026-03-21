package com.sdr.v2.backend.service;

import com.sdr.v2.backend.domain.DeviceState;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DeviceRegistryService {

    private final Map<String, DeviceState> devices = new ConcurrentHashMap<>();

    public void updateFromRaw(String machineId,
                              String deviceId,
                              int deviceType,
                              long centerFreqHz,
                              long sampleRateHz,
                              String status) {
        String key = machineId + "/" + deviceId;
        String type = switch (deviceType) {
            case 1 -> "HACKRF";
            case 0 -> "RTLSDR";
            default -> "UNKNOWN";
        };

        devices.put(key, new DeviceState(
                machineId,
                deviceId,
                type,
                status,
                centerFreqHz,
                sampleRateHz,
                Instant.now()
        ));
    }

    public void updateStatus(String machineId, String deviceId, String status) {
        String key = machineId + "/" + deviceId;
        DeviceState current = devices.get(key);
        if (current == null) {
            devices.put(key, new DeviceState(machineId, deviceId, "UNKNOWN", status, 0L, 0L, Instant.now()));
            return;
        }
        devices.put(key, new DeviceState(
                current.machineId(),
                current.deviceId(),
                current.deviceType(),
                status,
                current.centerFreqHz(),
                current.sampleRateHz(),
                Instant.now()
        ));
    }

    public Collection<DeviceState> list() {
        return devices.values();
    }
}
