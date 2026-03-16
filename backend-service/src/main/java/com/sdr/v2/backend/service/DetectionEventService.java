package com.sdr.v2.backend.service;

import com.sdr.v2.backend.config.AppProperties;
import com.sdr.v2.backend.domain.DetectionEvent;
import com.sdr.v2.backend.domain.RawIqFrame;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DetectionEventService {

    private final AppProperties props;
    private final List<DetectionEvent> events = new ArrayList<>();
    private final ConcurrentHashMap<String, Long> cooldownByDevice = new ConcurrentHashMap<>();

    public DetectionEventService(AppProperties props) {
        this.props = props;
    }

    public synchronized void onIqFrame(RawIqFrame frame) {
        if (!props.getDetection().isIqEnabled()) {
            return;
        }

        byte[] data = frame.payload();
        if (data == null || data.length < 8) {
            return;
        }

        if (!isInConfiguredBands(frame.centerFreqHz())) {
            return;
        }

        double energy = averageAbs(data, frame.iqFormat());
        if (energy < props.getDetection().getDetectionThreshold()) {
            return;
        }

        String deviceKey = frame.machineId() + "/" + frame.deviceId();
        long now = System.currentTimeMillis();
        long until = cooldownByDevice.getOrDefault(deviceKey, 0L);
        if (now < until) {
            return;
        }

        HashMap<String, Object> evidence = new HashMap<>();
        evidence.put("avgAbsEnergy", energy);
        evidence.put("sampleRateHz", frame.sampleRateHz());
        evidence.put("centerFreqHz", frame.centerFreqHz());
        evidence.put("iqFormat", frame.iqFormat());

        events.add(0, new DetectionEvent(
                "evt-" + UUID.randomUUID(),
                frame.machineId(),
                frame.deviceId(),
                Instant.now(),
                "drone_iq_activity",
                "WARN",
                Math.min(1.0, energy),
                evidence
        ));

        while (events.size() > 1000) {
            events.remove(events.size() - 1);
        }

        cooldownByDevice.put(deviceKey, now + props.getDetection().getDetectionCooldownMs());
    }

    public synchronized List<DetectionEvent> list() {
        return List.copyOf(events);
    }

    private boolean isInConfiguredBands(long centerFreqHz) {
        List<String> bands = props.getDetection().getBands();
        if (bands == null || bands.isEmpty()) {
            return true;
        }

        for (String band : bands) {
            long[] range = parseBand(band);
            if (range == null) {
                continue;
            }
            if (centerFreqHz >= range[0] && centerFreqHz <= range[1]) {
                return true;
            }
        }
        return false;
    }

    private static long[] parseBand(String band) {
        if (band == null) {
            return null;
        }
        String[] p = band.trim().split("-");
        if (p.length != 2) {
            return null;
        }
        try {
            long start = Long.parseLong(p[0].trim());
            long end = Long.parseLong(p[1].trim());
            if (start > end) {
                long tmp = start;
                start = end;
                end = tmp;
            }
            return new long[]{start, end};
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static double averageAbs(byte[] payload, int iqFormat) {
        int samples = Math.min(payload.length, 8192);
        if ((samples & 1) != 0) {
            samples -= 1;
        }
        if (samples <= 0) {
            return 0;
        }

        double sum = 0.0;
        for (int i = 0; i < samples; i++) {
            float v;
            if (iqFormat == 1) {
                v = payload[i] / 128.0f;
            } else {
                v = ((payload[i] & 0xFF) - 127.5f) / 128.0f;
            }
            sum += Math.abs(v);
        }
        return sum / samples;
    }
}
