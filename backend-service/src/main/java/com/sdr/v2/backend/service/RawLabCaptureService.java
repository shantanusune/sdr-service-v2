package com.sdr.v2.backend.service;

import com.sdr.v2.backend.domain.RawIqFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class RawLabCaptureService {

    private static final Logger log = LoggerFactory.getLogger(RawLabCaptureService.class);

    private static final int MIN_CAPTURE_SECONDS = 1;
    private static final int MAX_CAPTURE_SECONDS = 60;
    private static final int MAX_CAPTURES = 200;
    private static final long MAX_CAPTURE_FILE_BYTES = 512L * 1024L * 1024L;
    private static final int MAX_SUMMARY_FRAMES = 6000;
    private static final int MIN_COMPLEX_SAMPLES = 128;
    private static final int MAX_COMPLEX_SAMPLES = 2048;
    private static final long WIFI_24_START_HZ = 2_400_000_000L;
    private static final long WIFI_24_END_HZ = 2_483_500_000L;

    private static final String STATUS_PENDING = "pending";
    private static final String STATUS_CAPTURING = "capturing";
    private static final String STATUS_COMPLETE = "complete";
    private static final String STATUS_FAILED = "failed";

    private static final String ANALYSIS_ENERGY = "energy_profile";
    private static final String ANALYSIS_BURST = "burst_activity";
    private static final String ANALYSIS_HOPPING = "frequency_hopping";
    private static final String ANALYSIS_OCCUPANCY = "bandwidth_occupancy";
    private static final String ANALYSIS_PROTOCOL = "protocol_hints";

    private static final Set<String> DEFAULT_ANALYSES = Set.of(
            ANALYSIS_ENERGY,
            ANALYSIS_BURST,
            ANALYSIS_HOPPING,
            ANALYSIS_OCCUPANCY,
            ANALYSIS_PROTOCOL
    );

    private final LinkedHashMap<String, CaptureRecord> capturesById = new LinkedHashMap<>();
    private final Path captureDir = Path.of("./data/raw-captures");

    public synchronized Map<String, Object> createCapture(Map<String, Object> request) {
        long nowMs = System.currentTimeMillis();
        finalizeExpiredLocked(nowMs);

        String deviceId = asString(request.get("deviceId"), "unknown");
        int requestedSeconds = firstInt(
                request.get("seconds"),
                request.get("durationSec"),
                request.get("duration"),
                5
        );
        int durationSec = clampInt(requestedSeconds, MIN_CAPTURE_SECONDS, MAX_CAPTURE_SECONDS);
        String captureId = "cap-" + UUID.randomUUID();
        Path filePath = captureDir.resolve(captureId + "_" + sanitizeForFile(deviceId) + ".iq").toAbsolutePath().normalize();

        CaptureRecord c = new CaptureRecord(
                captureId,
                deviceId,
                nowMs,
                durationSec,
                nowMs + (durationSec * 1000L),
                filePath
        );
        capturesById.put(captureId, c);
        trimCapturesLocked();
        return toCaptureMap(c);
    }

    public synchronized List<Map<String, Object>> listCaptures() {
        finalizeExpiredLocked(System.currentTimeMillis());
        return capturesById.values().stream()
                .sorted(Comparator.comparingLong((CaptureRecord c) -> c.createdAtMs).reversed())
                .map(this::toCaptureMap)
                .collect(Collectors.toList());
    }

    public synchronized Map<String, Object> createAnalysisJob(Map<String, Object> request) {
        finalizeExpiredLocked(System.currentTimeMillis());
        String captureId = asString(request.get("captureId"), "");
        CaptureRecord c = capturesById.get(captureId);

        if (c == null) {
            return Map.of(
                    "jobId", "job-" + UUID.randomUUID(),
                    "captureId", captureId,
                    "status", STATUS_FAILED,
                    "error", "capture not found"
            );
        }

        if (c.summaries.isEmpty()) {
            return Map.of(
                    "jobId", "job-" + UUID.randomUUID(),
                    "captureId", captureId,
                    "status", STATUS_FAILED,
                    "error", "capture has no IQ frames yet"
            );
        }

        Set<String> analyses = parseAnalyses(request.get("analyses"));
        Map<String, Object> result = analyzeCaptureLocked(c, analyses);
        c.latestAnalysis = result;

        return Map.of(
                "jobId", "job-" + UUID.randomUUID(),
                "captureId", captureId,
                "status", STATUS_COMPLETE,
                "requestedAnalyses", new ArrayList<>(analyses),
                "result", result
        );
    }

    public synchronized void onIqFrame(RawIqFrame frame) {
        if (frame == null || frame.payload() == null || frame.payload().length < 2) {
            return;
        }

        long nowMs = System.currentTimeMillis();
        finalizeExpiredLocked(nowMs);

        for (CaptureRecord c : capturesById.values()) {
            if (!isActive(c)) {
                continue;
            }
            if (!c.deviceId.equals(frame.deviceId())) {
                continue;
            }
            appendFrameLocked(c, frame, nowMs);
        }
    }

    private void appendFrameLocked(CaptureRecord c, RawIqFrame frame, long nowMs) {
        if (nowMs >= c.endsAtMs) {
            finalizeCaptureLocked(c, nowMs);
            return;
        }

        if (STATUS_PENDING.equals(c.status)) {
            c.status = STATUS_CAPTURING;
            c.startedAtMs = nowMs;
        }

        ensureCaptureDir();

        byte[] payload = frame.payload();
        long remaining = Math.max(0L, MAX_CAPTURE_FILE_BYTES - c.fileSizeBytes);
        int writeBytes = (int) Math.min(remaining, payload.length);
        if (writeBytes > 0) {
            try {
                if (c.outputStream == null) {
                    c.outputStream = Files.newOutputStream(
                            c.filePath,
                            StandardOpenOption.CREATE,
                            StandardOpenOption.TRUNCATE_EXISTING,
                            StandardOpenOption.WRITE);
                }
                c.outputStream.write(payload, 0, writeBytes);
            } catch (IOException e) {
                c.status = STATUS_FAILED;
                c.error = "failed writing capture file: " + e.getMessage();
                c.completedAtMs = nowMs;
                closeCaptureStreamLocked(c);
                log.warn("Failed writing IQ capture {}", c.captureId, e);
                return;
            }
            c.fileSizeBytes += writeBytes;
        }
        if (writeBytes < payload.length) {
            c.truncated = true;
        }

        c.frameCount += 1;
        c.lastUpdatedMs = nowMs;

        FrameSummary summary = summarizeFrame(frame);
        if (summary != null) {
            c.summaries.add(summary);
            if (c.summaries.size() > MAX_SUMMARY_FRAMES) {
                c.summaries.remove(0);
                c.summaryTruncated = true;
            }
        }

        if (nowMs >= c.endsAtMs) {
            finalizeCaptureLocked(c, nowMs);
        }
    }

    private void ensureCaptureDir() {
        try {
            Files.createDirectories(captureDir);
        } catch (IOException e) {
            log.warn("Failed to create capture directory {}", captureDir, e);
        }
    }

    private static FrameSummary summarizeFrame(RawIqFrame frame) {
        byte[] payload = frame.payload();
        int availableComplexSamples = payload.length / 2;
        int complexSamples = Math.min(availableComplexSamples, MAX_COMPLEX_SAMPLES);
        if (complexSamples < MIN_COMPLEX_SAMPLES) {
            return null;
        }

        double[] iSamples = new double[complexSamples];
        double[] qSamples = new double[complexSamples];

        double absSum = 0.0;
        double powerSum = 0.0;
        double powerSqSum = 0.0;
        int zeroCrossings = 0;
        int zeroCrossComparisons = 0;
        double prevI = 0.0;
        double prevQ = 0.0;

        for (int i = 0; i < complexSamples; i++) {
            int idx = i * 2;
            double iVal = decode(payload[idx], frame.iqFormat());
            double qVal = decode(payload[idx + 1], frame.iqFormat());

            iSamples[i] = iVal;
            qSamples[i] = qVal;

            absSum += Math.abs(iVal) + Math.abs(qVal);
            double power = (iVal * iVal) + (qVal * qVal);
            powerSum += power;
            powerSqSum += power * power;

            if (i > 0) {
                if (crossesZero(prevI, iVal)) {
                    zeroCrossings++;
                }
                if (crossesZero(prevQ, qVal)) {
                    zeroCrossings++;
                }
                zeroCrossComparisons += 2;
            }

            prevI = iVal;
            prevQ = qVal;
        }

        int nfft = highestPowerOfTwoAtMost(complexSamples);
        if (nfft < MIN_COMPLEX_SAMPLES) {
            return null;
        }

        double[] re = new double[nfft];
        double[] im = new double[nfft];
        for (int i = 0; i < nfft; i++) {
            double w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (nfft - 1));
            re[i] = iSamples[i] * w;
            im[i] = qSamples[i] * w;
        }

        fft(re, im);

        int bins = nfft / 2;
        if (bins <= 0) {
            return null;
        }

        double[] powerBins = new double[bins];
        double specPowerSum = 0.0;
        double logSpecPowerSum = 0.0;
        double peakPower = 1e-12;
        int peakIndex = 0;

        for (int k = 0; k < bins; k++) {
            double p = (re[k] * re[k]) + (im[k] * im[k]) + 1e-12;
            powerBins[k] = p;
            specPowerSum += p;
            logSpecPowerSum += Math.log(p);
            if (p > peakPower) {
                peakPower = p;
                peakIndex = k;
            }
        }

        double specMean = specPowerSum / bins;
        double spectralFlatness = Math.exp(logSpecPowerSum / bins) / Math.max(1e-12, specMean);
        double peakToMeanDb = 10.0 * Math.log10(peakPower / Math.max(1e-12, specMean));

        double avgAbs = absSum / (complexSamples * 2.0);
        double avgPower = powerSum / complexSamples;
        double rms = Math.sqrt(Math.max(0.0, avgPower));
        double powerVariance = Math.max(0.0, (powerSqSum / complexSamples) - (avgPower * avgPower));
        double zeroCrossRate = zeroCrossComparisons == 0 ? 0.0 : ((double) zeroCrossings / zeroCrossComparisons);

        double binHz = (frame.sampleRateHz() > 0) ? ((double) frame.sampleRateHz() / nfft) : 0.0;
        long peakFreqHz = frame.centerFreqHz();
        if (binHz > 0.0) {
            peakFreqHz = frame.centerFreqHz() + Math.round(peakIndex * binHz);
        }

        double occupiedBandwidthHz = 0.0;
        if (binHz > 0.0) {
            double lowTarget = specPowerSum * 0.05;
            double highTarget = specPowerSum * 0.95;
            int lowIdx = 0;
            int highIdx = bins - 1;
            double cumulative = 0.0;
            boolean lowSet = false;

            for (int i = 0; i < bins; i++) {
                cumulative += powerBins[i];
                if (!lowSet && cumulative >= lowTarget) {
                    lowIdx = i;
                    lowSet = true;
                }
                if (cumulative >= highTarget) {
                    highIdx = i;
                    break;
                }
            }

            int occupiedBins = Math.max(1, highIdx - lowIdx + 1);
            occupiedBandwidthHz = occupiedBins * binHz;
        }

        return new FrameSummary(
                frame.timestampNs(),
                frame.centerFreqHz(),
                frame.sampleRateHz(),
                frame.iqFormat(),
                payload.length,
                avgAbs,
                rms,
                powerVariance,
                zeroCrossRate,
                spectralFlatness,
                occupiedBandwidthHz,
                peakToMeanDb,
                peakFreqHz
        );
    }

    private Map<String, Object> analyzeCaptureLocked(CaptureRecord c, Set<String> analyses) {
        List<FrameSummary> frames = c.summaries;
        int n = frames.size();

        double meanRms = frames.stream().mapToDouble(FrameSummary::rms).average().orElse(0.0);
        double minRms = frames.stream().mapToDouble(FrameSummary::rms).min().orElse(0.0);
        double maxRms = frames.stream().mapToDouble(FrameSummary::rms).max().orElse(0.0);
        double meanAbs = frames.stream().mapToDouble(FrameSummary::avgAbs).average().orElse(0.0);
        double meanFlatness = frames.stream().mapToDouble(FrameSummary::spectralFlatness).average().orElse(0.0);
        double meanOccupiedBwHz = frames.stream().mapToDouble(FrameSummary::occupiedBandwidthHz).average().orElse(0.0);
        double p90OccupiedBwHz = percentile(frames.stream().mapToDouble(FrameSummary::occupiedBandwidthHz).sorted().toArray(), 0.90);

        double baselineRms = percentile(frames.stream().mapToDouble(FrameSummary::rms).sorted().toArray(), 0.25);
        double burstThreshold = Math.max(1e-9, baselineRms * 1.8);
        long burstFrames = frames.stream().filter(f -> f.rms() >= burstThreshold).count();
        double burstRatio = n == 0 ? 0.0 : ((double) burstFrames / n);

        HopStats hop = computeHopStats(frames);

        ProtocolHint hint = inferProtocolHint(frames, burstRatio, hop, meanFlatness, meanOccupiedBwHz);
        List<Map<String, Object>> bands = detectBands(frames, hint.label());

        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("captureId", c.captureId);
        result.put("sampledFrames", n);
        result.put("durationSec", c.durationSec);
        result.put("droneScore", round1(hint.confidence() * 100.0));
        result.put("dominantLabel", hint.label());
        result.put("detectedBands", bands);
        result.put("analysesRun", new ArrayList<>(analyses));

        if (analyses.contains(ANALYSIS_ENERGY)) {
            result.put("energyProfile", Map.of(
                    "meanRms", round6(meanRms),
                    "minRms", round6(minRms),
                    "maxRms", round6(maxRms),
                    "meanAbs", round6(meanAbs),
                    "baselineRms", round6(baselineRms)
            ));
        }

        if (analyses.contains(ANALYSIS_BURST)) {
            result.put("burstActivity", Map.of(
                    "burstFrames", burstFrames,
                    "burstRatio", round4(burstRatio),
                    "burstThresholdRms", round6(burstThreshold)
            ));
        }

        if (analyses.contains(ANALYSIS_HOPPING)) {
            result.put("frequencyHopping", Map.of(
                    "hopCount", hop.hopCount(),
                    "maxHopHz", round1(hop.maxHopHz()),
                    "avgHopHz", round1(hop.avgHopHz()),
                    "hopRatePerMinute", round2(hop.hopRatePerMinute())
            ));
        }

        if (analyses.contains(ANALYSIS_OCCUPANCY)) {
            result.put("bandwidthOccupancy", Map.of(
                    "meanOccupiedBandwidthHz", round1(meanOccupiedBwHz),
                    "p90OccupiedBandwidthHz", round1(p90OccupiedBwHz),
                    "meanSpectralFlatness", round4(meanFlatness)
            ));
        }

        if (analyses.contains(ANALYSIS_PROTOCOL)) {
            result.put("protocolHints", Map.of(
                    "label", hint.label(),
                    "confidence", round4(hint.confidence()),
                    "in24GHzBand", hint.in24GHzBand(),
                    "scores", Map.of(
                            "controlLinkScore", round4(hint.controlLinkScore()),
                            "digitalVideoScore", round4(hint.digitalVideoScore()),
                            "fhssScore", round4(hint.fhssScore()),
                            "unknownScore", round4(hint.unknownScore())
                    )
            ));
        }

        return result;
    }

    private static HopStats computeHopStats(List<FrameSummary> frames) {
        if (frames.size() < 2) {
            return new HopStats(0, 0.0, 0.0, 0.0);
        }

        int hops = 0;
        double maxHopHz = 0.0;
        double hopHzSum = 0.0;
        long firstTs = frames.get(0).timestampNs();
        long lastTs = firstTs;

        FrameSummary prev = frames.get(0);
        for (int i = 1; i < frames.size(); i++) {
            FrameSummary cur = frames.get(i);
            if (cur.timestampNs() > 0) {
                lastTs = cur.timestampNs();
            }
            if (prev.timestampNs() <= 0 || cur.timestampNs() <= 0) {
                prev = cur;
                continue;
            }

            long dtNs = cur.timestampNs() - prev.timestampNs();
            if (dtNs <= 0 || dtNs > 2_500_000_000L) {
                prev = cur;
                continue;
            }

            double hopHz = Math.abs((double) cur.peakFreqHz() - prev.peakFreqHz());
            if (hopHz >= 300_000.0) {
                hops++;
                hopHzSum += hopHz;
                if (hopHz > maxHopHz) {
                    maxHopHz = hopHz;
                }
            }
            prev = cur;
        }

        double avgHopHz = hops == 0 ? 0.0 : hopHzSum / hops;
        double durationSec = Math.max(0.5, (lastTs - firstTs) / 1_000_000_000.0);
        double hopRatePerMinute = (hops / durationSec) * 60.0;
        return new HopStats(hops, maxHopHz, avgHopHz, hopRatePerMinute);
    }

    private static ProtocolHint inferProtocolHint(List<FrameSummary> frames,
                                                  double burstRatio,
                                                  HopStats hop,
                                                  double meanFlatness,
                                                  double meanOccupiedBwHz) {
        boolean in24Band = frames.stream().anyMatch(f -> f.centerFreqHz() >= WIFI_24_START_HZ && f.centerFreqHz() <= WIFI_24_END_HZ);
        double bwMHz = meanOccupiedBwHz / 1_000_000.0;

        double controlLinkScore = clamp01((0.4 * closenessScore(bwMHz, 7.0, 6.0))
                + (0.25 * clamp01((meanFlatness - 0.25) / 0.5))
                + (0.20 * clamp01((burstRatio - 0.04) / 0.35))
                + (0.15 * clamp01((hop.hopRatePerMinute() - 2.0) / 25.0)));
        if (!in24Band) {
            controlLinkScore *= 0.25;
        }

        double digitalVideoScore = clamp01((0.45 * clamp01((bwMHz - 12.0) / 20.0))
                + (0.35 * clamp01((meanFlatness - 0.30) / 0.5))
                + (0.20 * clamp01((0.30 - burstRatio) / 0.30)));
        if (!in24Band) {
            digitalVideoScore *= 0.25;
        }

        double fhssScore = clamp01((0.40 * clamp01((hop.hopRatePerMinute() - 8.0) / 60.0))
                + (0.35 * clamp01((hop.avgHopHz() - 350_000.0) / 2_500_000.0))
                + (0.25 * clamp01((6.0 - bwMHz) / 6.0)));
        if (!in24Band) {
            fhssScore *= 0.2;
        }

        double unknownScore = clamp01(Math.max(0.25, 1.0 - Math.max(controlLinkScore, Math.max(digitalVideoScore, fhssScore))));

        String label = "unknown_iq_activity";
        double confidence = unknownScore;
        if (digitalVideoScore >= controlLinkScore && digitalVideoScore >= fhssScore && digitalVideoScore >= unknownScore) {
            label = "digital_video_link";
            confidence = digitalVideoScore;
        } else if (fhssScore >= controlLinkScore && fhssScore >= unknownScore) {
            label = "fhss_control_suspected";
            confidence = fhssScore;
        } else if (controlLinkScore >= unknownScore) {
            label = "wifi_control_link";
            confidence = controlLinkScore;
        } else if (in24Band) {
            label = "unknown_2_4ghz";
            confidence = unknownScore;
        }

        return new ProtocolHint(label, confidence, controlLinkScore, digitalVideoScore, fhssScore, unknownScore, in24Band);
    }

    private static List<Map<String, Object>> detectBands(List<FrameSummary> frames, String labelPrefix) {
        if (frames.isEmpty()) {
            return List.of();
        }

        final long bucketHz = 5_000_000L;
        HashMap<Long, Integer> counts = new HashMap<>();
        for (FrameSummary f : frames) {
            long bucket = Math.round((double) f.peakFreqHz() / bucketHz);
            counts.merge(bucket, 1, Integer::sum);
        }

        int total = frames.size();
        return counts.entrySet().stream()
                .sorted(Map.Entry.<Long, Integer>comparingByValue().reversed())
                .limit(4)
                .map(e -> {
                    long center = e.getKey() * bucketHz;
                    long startHz = center - (bucketHz / 2);
                    long endHz = center + (bucketHz / 2);
                    double confidence = (double) e.getValue() / total;
                    return Map.<String, Object>of(
                            "startHz", startHz,
                            "endHz", endHz,
                            "label", labelPrefix,
                            "confidence", round4(confidence)
                    );
                })
                .collect(Collectors.toList());
    }

    private void finalizeExpiredLocked(long nowMs) {
        for (CaptureRecord c : capturesById.values()) {
            if (isActive(c) && nowMs >= c.endsAtMs) {
                finalizeCaptureLocked(c, nowMs);
            }
        }
    }

    private void finalizeCaptureLocked(CaptureRecord c, long nowMs) {
        if (!isActive(c)) {
            return;
        }
        c.completedAtMs = nowMs;
        if (c.frameCount == 0) {
            c.status = STATUS_FAILED;
            if (c.error == null) {
                c.error = "capture ended without IQ frames";
            }
        } else {
            c.status = STATUS_COMPLETE;
        }
        closeCaptureStreamLocked(c);
    }

    private static boolean isActive(CaptureRecord c) {
        return STATUS_PENDING.equals(c.status) || STATUS_CAPTURING.equals(c.status);
    }

    private void trimCapturesLocked() {
        while (capturesById.size() > MAX_CAPTURES) {
            String oldestId = capturesById.keySet().iterator().next();
            CaptureRecord removed = capturesById.remove(oldestId);
            if (removed != null) {
                closeCaptureStreamLocked(removed);
                try {
                    Files.deleteIfExists(removed.filePath);
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static void closeCaptureStreamLocked(CaptureRecord c) {
        if (c.outputStream == null) {
            return;
        }
        try {
            c.outputStream.close();
        } catch (IOException ignored) {
        } finally {
            c.outputStream = null;
        }
    }

    private Map<String, Object> toCaptureMap(CaptureRecord c) {
        LinkedHashMap<String, Object> out = new LinkedHashMap<>();
        out.put("captureId", c.captureId);
        out.put("deviceId", c.deviceId);
        out.put("timestamp", c.createdAtMs);
        out.put("duration", c.durationSec);
        out.put("status", c.status);
        out.put("fileSize", c.fileSizeBytes);
        out.put("frameCount", c.frameCount);
        out.put("startedAt", c.startedAtMs);
        out.put("completedAt", c.completedAtMs);
        out.put("truncated", c.truncated);
        out.put("summaryTruncated", c.summaryTruncated);
        out.put("capturePath", c.filePath.toString());
        out.put("sampleSummaries", c.summaries.size());
        if (c.error != null) {
            out.put("error", c.error);
        }
        if (c.latestAnalysis != null) {
            out.put("analysis", c.latestAnalysis);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Set<String> parseAnalyses(Object raw) {
        if (!(raw instanceof List<?> list) || list.isEmpty()) {
            return new LinkedHashSet<>(DEFAULT_ANALYSES);
        }
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (Object v : list) {
            if (v instanceof String s && DEFAULT_ANALYSES.contains(s)) {
                out.add(s);
            }
        }
        if (out.isEmpty()) {
            out.addAll(DEFAULT_ANALYSES);
        }
        return out;
    }

    private static String asString(Object raw, String fallback) {
        if (raw instanceof String s && !s.isBlank()) {
            return s.trim();
        }
        return fallback;
    }

    private static int asInt(Object raw, int fallback) {
        if (raw instanceof Number n) {
            return n.intValue();
        }
        if (raw instanceof String s) {
            try {
                return Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static int firstInt(Object primary, Object secondary, Object tertiary, int fallback) {
        int p = asInt(primary, Integer.MIN_VALUE);
        if (p != Integer.MIN_VALUE) {
            return p;
        }
        int s = asInt(secondary, Integer.MIN_VALUE);
        if (s != Integer.MIN_VALUE) {
            return s;
        }
        int t = asInt(tertiary, Integer.MIN_VALUE);
        if (t != Integer.MIN_VALUE) {
            return t;
        }
        return fallback;
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String sanitizeForFile(String input) {
        if (input == null || input.isBlank()) {
            return "unknown";
        }
        return input.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static double decode(byte value, int iqFormat) {
        if (iqFormat == 1) {
            return value / 128.0;
        }
        return ((value & 0xFF) - 127.5) / 128.0;
    }

    private static boolean crossesZero(double prev, double curr) {
        return (prev >= 0 && curr < 0) || (prev < 0 && curr >= 0);
    }

    private static int highestPowerOfTwoAtMost(int value) {
        int p2 = 1;
        while ((p2 << 1) <= value) {
            p2 <<= 1;
        }
        return p2;
    }

    private static void fft(double[] re, double[] im) {
        int n = re.length;
        for (int i = 1, j = 0; i < n; i++) {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) {
                j ^= bit;
            }
            j ^= bit;
            if (i < j) {
                double tr = re[i];
                re[i] = re[j];
                re[j] = tr;
                double ti = im[i];
                im[i] = im[j];
                im[j] = ti;
            }
        }

        for (int len = 2; len <= n; len <<= 1) {
            double ang = -2.0 * Math.PI / len;
            double wlenRe = Math.cos(ang);
            double wlenIm = Math.sin(ang);
            for (int i = 0; i < n; i += len) {
                double wRe = 1.0;
                double wIm = 0.0;
                for (int j = 0; j < len / 2; j++) {
                    int u = i + j;
                    int v = i + j + (len / 2);

                    double vr = (re[v] * wRe) - (im[v] * wIm);
                    double vi = (re[v] * wIm) + (im[v] * wRe);

                    re[v] = re[u] - vr;
                    im[v] = im[u] - vi;
                    re[u] = re[u] + vr;
                    im[u] = im[u] + vi;

                    double nextRe = (wRe * wlenRe) - (wIm * wlenIm);
                    double nextIm = (wRe * wlenIm) + (wIm * wlenRe);
                    wRe = nextRe;
                    wIm = nextIm;
                }
            }
        }
    }

    private static double percentile(double[] sorted, double q) {
        if (sorted == null || sorted.length == 0) {
            return 0.0;
        }
        if (sorted.length == 1) {
            return sorted[0];
        }
        double clamped = clamp01(q);
        double pos = clamped * (sorted.length - 1);
        int lo = (int) Math.floor(pos);
        int hi = (int) Math.ceil(pos);
        if (lo == hi) {
            return sorted[lo];
        }
        double t = pos - lo;
        return sorted[lo] * (1.0 - t) + sorted[hi] * t;
    }

    private static double closenessScore(double value, double center, double halfWidth) {
        if (halfWidth <= 0.0) {
            return 0.0;
        }
        return clamp01(1.0 - (Math.abs(value - center) / halfWidth));
    }

    private static double clamp01(double value) {
        if (value < 0.0) {
            return 0.0;
        }
        if (value > 1.0) {
            return 1.0;
        }
        return value;
    }

    private static double round6(double v) {
        return Math.round(v * 1_000_000.0) / 1_000_000.0;
    }

    private static double round4(double v) {
        return Math.round(v * 10_000.0) / 10_000.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private static double round1(double v) {
        return Math.round(v * 10.0) / 10.0;
    }

    private static final class CaptureRecord {
        private final String captureId;
        private final String deviceId;
        private final long createdAtMs;
        private final int durationSec;
        private final long endsAtMs;
        private final Path filePath;

        private String status = STATUS_PENDING;
        private String error;
        private long startedAtMs;
        private long completedAtMs;
        private long lastUpdatedMs;
        private long frameCount;
        private long fileSizeBytes;
        private boolean truncated;
        private boolean summaryTruncated;
        private final ArrayList<FrameSummary> summaries = new ArrayList<>();
        private Map<String, Object> latestAnalysis;
        private OutputStream outputStream;

        private CaptureRecord(String captureId,
                              String deviceId,
                              long createdAtMs,
                              int durationSec,
                              long endsAtMs,
                              Path filePath) {
            this.captureId = captureId;
            this.deviceId = deviceId;
            this.createdAtMs = createdAtMs;
            this.durationSec = durationSec;
            this.endsAtMs = endsAtMs;
            this.filePath = filePath;
        }
    }

    private record FrameSummary(long timestampNs,
                                long centerFreqHz,
                                long sampleRateHz,
                                int iqFormat,
                                int frameBytes,
                                double avgAbs,
                                double rms,
                                double powerVariance,
                                double zeroCrossRate,
                                double spectralFlatness,
                                double occupiedBandwidthHz,
                                double peakToMeanDb,
                                long peakFreqHz) {
    }

    private record HopStats(int hopCount, double maxHopHz, double avgHopHz, double hopRatePerMinute) {
    }

    private record ProtocolHint(String label,
                                double confidence,
                                double controlLinkScore,
                                double digitalVideoScore,
                                double fhssScore,
                                double unknownScore,
                                boolean in24GHzBand) {
    }
}
