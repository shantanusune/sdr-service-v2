package com.sdr.v2.backend.service;

import com.sdr.v2.backend.config.AppProperties;
import com.sdr.v2.backend.domain.DetectionEvent;
import com.sdr.v2.backend.domain.RawIqFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class DetectionEventService {

    private static final Logger log = LoggerFactory.getLogger(DetectionEventService.class);
    private static final int MAX_EVENTS = 1000;
    private static final int MAX_COMPLEX_SAMPLES = 4096;
    private static final int MAX_FFT_SAMPLES = 1024;
    private static final int MIN_COMPLEX_SAMPLES = 256;
    private static final long WIFI_24_START_HZ = 2_400_000_000L;
    private static final long WIFI_24_END_HZ = 2_483_500_000L;
    private static final long HOP_WINDOW_NS = 3_000_000_000L;
    private static final int MIN_DUMP_BYTES = 1024;
    private static final String IQ_DUMP_EXTENSION = ".iq";
    private static final String EVENT_WIFI_CONTROL_LINK = "wifi_control_link";
    private static final String EVENT_DIGITAL_VIDEO_LINK = "digital_video_link";
    private static final String EVENT_FHSS_CONTROL_SUSPECTED = "fhss_control_suspected";
    private static final String EVENT_UNKNOWN_24_GHZ = "unknown_2_4ghz";

    private final AppProperties props;
    private final List<DetectionEvent> events = new ArrayList<>();
    private final ConcurrentHashMap<String, Long> cooldownByDeviceAndType = new ConcurrentHashMap<>();
    private final HashMap<String, SpectralState> lastSpectralByDevice = new HashMap<>();

    public DetectionEventService(AppProperties props) {
        this.props = props;
    }

    public synchronized void onIqFrame(RawIqFrame frame) {
        if (!props.getDetection().isIqEnabled()) {
            return;
        }

        FrameFeatures features = extractFeatures(frame);
        if (features == null) {
            return;
        }

        if (!isInConfiguredBands(features.centerFreqHz())) {
            return;
        }

        double threshold = props.getDetection().getDetectionThreshold();
        if (features.avgAbsEnergy() < threshold) {
            return;
        }

        String deviceKey = frame.machineId() + "/" + frame.deviceId();
        SpectralState previousState = lastSpectralByDevice.get(deviceKey);
        long sampleTsNs = frame.timestampNs() > 0 ? frame.timestampNs() : System.nanoTime();
        Classification classification = classify(features, threshold, previousState, sampleTsNs);
        lastSpectralByDevice.put(deviceKey, new SpectralState(features.peakFreqHz(), sampleTsNs));

        String cooldownKey = deviceKey + "/" + classification.type();
        long now = System.currentTimeMillis();
        long until = cooldownByDeviceAndType.getOrDefault(cooldownKey, 0L);
        if (now < until) {
            return;
        }

        HashMap<String, Object> evidence = new HashMap<>();
        evidence.put("avgAbsEnergy", features.avgAbsEnergy());
        evidence.put("avgPower", features.avgPower());
        evidence.put("powerVariance", features.powerVariance());
        evidence.put("zeroCrossingRate", features.zeroCrossingRate());
        evidence.put("spectralFlatness", features.spectralFlatness());
        evidence.put("occupiedBandwidthHz", features.occupiedBandwidthHz());
        evidence.put("peakToMeanDb", features.peakToMeanDb());
        evidence.put("peakFreqHz", features.peakFreqHz());
        evidence.put("wifiScore", classification.wifiScore());
        evidence.put("droneScore", classification.droneScore());
        evidence.put("controlLinkScore", classification.controlLinkScore());
        evidence.put("digitalVideoScore", classification.digitalVideoScore());
        evidence.put("fhssScore", classification.fhssScore());
        evidence.put("hopDeltaHz", classification.hopDeltaHz());
        evidence.put("hopRateHzPerSec", classification.hopRateHzPerSec());
        evidence.put("protocolLabel", classification.type());
        evidence.put("sampleRateHz", features.sampleRateHz());
        evidence.put("centerFreqHz", features.centerFreqHz());
        evidence.put("iqFormat", features.iqFormat());
        evidence.put("band24GHz", isWifi24Band(features.centerFreqHz()));

        String eventId = "evt-" + UUID.randomUUID();
        appendIqDumpEvidence(evidence, eventId, frame);

        events.add(0, new DetectionEvent(
                eventId,
                frame.machineId(),
                frame.deviceId(),
                Instant.now(),
                classification.type(),
                classification.severity(),
                clamp01(classification.confidence()),
                evidence
        ));

        while (events.size() > MAX_EVENTS) {
            events.remove(events.size() - 1);
        }

        cooldownByDeviceAndType.put(cooldownKey, now + props.getDetection().getDetectionCooldownMs());
    }

    public synchronized List<DetectionEvent> list() {
        return List.copyOf(events);
    }

    public synchronized int clear() {
        int cleared = events.size();
        events.clear();
        cooldownByDeviceAndType.clear();
        lastSpectralByDevice.clear();
        return cleared;
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

    private static boolean isWifi24Band(long centerFreqHz) {
        return centerFreqHz >= WIFI_24_START_HZ && centerFreqHz <= WIFI_24_END_HZ;
    }

    private static FrameFeatures extractFeatures(RawIqFrame frame) {
        byte[] payload = frame.payload();
        if (payload == null || payload.length < 8) {
            return null;
        }

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

        int nfft = highestPowerOfTwoAtMost(Math.min(complexSamples, MAX_FFT_SAMPLES));
        if (nfft < MIN_COMPLEX_SAMPLES) {
            return null;
        }

        double[] re = new double[nfft];
        double[] im = new double[nfft];
        for (int i = 0; i < nfft; i++) {
            double iVal = iSamples[i];
            double qVal = qSamples[i];
            double w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (nfft - 1));
            re[i] = iVal * w;
            im[i] = qVal * w;
        }

        fft(re, im);

        int bins = nfft / 2;
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

        if (specPowerSum <= 0.0) {
            return null;
        }

        double avgAbsEnergy = absSum / (complexSamples * 2.0);
        double avgPower = powerSum / complexSamples;
        double powerVariance = Math.max(0.0, (powerSqSum / complexSamples) - (avgPower * avgPower));
        double zeroCrossingRate = zeroCrossComparisons == 0
                ? 0.0
                : (double) zeroCrossings / zeroCrossComparisons;

        double specMean = specPowerSum / bins;
        double spectralFlatness = Math.exp(logSpecPowerSum / bins) / specMean;
        double peakToMeanDb = 10.0 * Math.log10(peakPower / specMean);
        double binHz = (frame.sampleRateHz() > 0) ? ((double) frame.sampleRateHz() / nfft) : 0.0;
        long peakFreqHz = frame.centerFreqHz();
        if (binHz > 0.0) {
            peakFreqHz = frame.centerFreqHz() + Math.round(peakIndex * binHz);
        }

        double occupiedBandwidthHz = 0.0;
        if (frame.sampleRateHz() > 0) {
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

        return new FrameFeatures(
                avgAbsEnergy,
                avgPower,
                powerVariance,
                zeroCrossingRate,
                spectralFlatness,
                occupiedBandwidthHz,
                peakToMeanDb,
                peakFreqHz,
                frame.centerFreqHz(),
                frame.sampleRateHz(),
                frame.iqFormat()
        );
    }

    private static Classification classify(FrameFeatures f,
                                           double threshold,
                                           SpectralState previousState,
                                           long sampleTsNs) {
        boolean in24Band = isWifi24Band(f.centerFreqHz());

        double bandwidthMHz = f.occupiedBandwidthHz() / 1_000_000.0;
        double energyScore = clamp01((f.avgAbsEnergy() - threshold) / Math.max(0.05, threshold));
        double flatnessScore = clamp01((f.spectralFlatness() - 0.30) / 0.45);
        double zcrScore = clamp01((f.zeroCrossingRate() - 0.18) / 0.45);
        double wifiBandwidthScore = clamp01((bandwidthMHz - 6.0) / 24.0);
        if (bandwidthMHz > 45.0) {
            wifiBandwidthScore *= 0.55;
        }

        double wifiScore = (0.45 * wifiBandwidthScore) + (0.35 * flatnessScore) + (0.20 * zcrScore);
        if (!in24Band) {
            wifiScore *= 0.25;
        }

        double narrowbandScore = clamp01((8_000_000.0 - f.occupiedBandwidthHz()) / 8_000_000.0);
        double toneScore = clamp01((f.peakToMeanDb() - 4.0) / 10.0);
        double burstScore = clamp01(f.powerVariance() / 0.18);
        double droneScore = (0.35 * narrowbandScore) + (0.30 * toneScore) + (0.20 * energyScore) + (0.15 * burstScore);
        if (in24Band && wifiScore > 0.62) {
            droneScore *= 0.75;
        }

        double hopDeltaHz = 0.0;
        double hopRateHzPerSec = 0.0;
        if (previousState != null && previousState.tsNs() > 0 && sampleTsNs > previousState.tsNs()) {
            long dtNs = sampleTsNs - previousState.tsNs();
            if (dtNs > 0 && dtNs <= HOP_WINDOW_NS) {
                hopDeltaHz = Math.abs((double) f.peakFreqHz() - previousState.peakFreqHz());
                double dtSec = dtNs / 1_000_000_000.0;
                hopRateHzPerSec = hopDeltaHz / Math.max(1e-3, dtSec);
            }
        }
        double hopDeltaScore = clamp01((hopDeltaHz - 250_000.0) / 4_000_000.0);
        double hopRateScore = clamp01((hopRateHzPerSec - 180_000.0) / 3_000_000.0);

        double videoBandwidthScore = clamp01((bandwidthMHz - 12.0) / 20.0);
        double videoStabilityScore = clamp01((0.25 - f.powerVariance()) / 0.25);
        double digitalVideoScore = (0.45 * videoBandwidthScore)
                + (0.35 * flatnessScore)
                + (0.20 * videoStabilityScore);
        if (!in24Band) {
            digitalVideoScore *= 0.2;
        }

        double controlBandwidthScore = closenessScore(bandwidthMHz, 7.0, 6.0);
        double controlLinkScore = (0.35 * controlBandwidthScore)
                + (0.25 * zcrScore)
                + (0.20 * flatnessScore)
                + (0.20 * energyScore);
        if (bandwidthMHz > 18.0) {
            controlLinkScore *= 0.65;
        }
        if (!in24Band) {
            controlLinkScore *= 0.2;
        }

        double fhssNarrowScore = clamp01((6_500_000.0 - f.occupiedBandwidthHz()) / 6_500_000.0);
        double fhssScore = (0.35 * fhssNarrowScore)
                + (0.30 * hopDeltaScore)
                + (0.20 * hopRateScore)
                + (0.15 * burstScore);
        if (bandwidthMHz > 12.0) {
            fhssScore *= 0.7;
        }
        if (!in24Band) {
            fhssScore *= 0.15;
        }

        if (in24Band) {
            if (digitalVideoScore >= 0.58
                    && digitalVideoScore >= controlLinkScore + 0.08
                    && digitalVideoScore >= fhssScore + 0.06) {
                return new Classification(
                        EVENT_DIGITAL_VIDEO_LINK,
                        "WARN",
                        digitalVideoScore,
                        wifiScore,
                        droneScore,
                        controlLinkScore,
                        digitalVideoScore,
                        fhssScore,
                        hopDeltaHz,
                        hopRateHzPerSec
                );
            }

            if (fhssScore >= 0.54 && fhssScore >= controlLinkScore + 0.03) {
                return new Classification(
                        EVENT_FHSS_CONTROL_SUSPECTED,
                        "WARN",
                        fhssScore,
                        wifiScore,
                        droneScore,
                        controlLinkScore,
                        digitalVideoScore,
                        fhssScore,
                        hopDeltaHz,
                        hopRateHzPerSec
                );
            }

            if (controlLinkScore >= 0.50 || wifiScore >= 0.60) {
                return new Classification(
                        EVENT_WIFI_CONTROL_LINK,
                        "INFO",
                        Math.max(controlLinkScore, wifiScore),
                        wifiScore,
                        droneScore,
                        controlLinkScore,
                        digitalVideoScore,
                        fhssScore,
                        hopDeltaHz,
                        hopRateHzPerSec
                );
            }

            double unknownScore = clamp01(Math.max(energyScore * 0.65, Math.max(digitalVideoScore, Math.max(controlLinkScore, fhssScore)) * 0.80));
            return new Classification(
                    EVENT_UNKNOWN_24_GHZ,
                    "INFO",
                    unknownScore,
                    wifiScore,
                    droneScore,
                    controlLinkScore,
                    digitalVideoScore,
                    fhssScore,
                    hopDeltaHz,
                    hopRateHzPerSec
            );
        }

        if (droneScore >= 0.50) {
            return new Classification(
                    "drone_iq_activity",
                    "WARN",
                    droneScore,
                    wifiScore,
                    droneScore,
                    controlLinkScore,
                    digitalVideoScore,
                    fhssScore,
                    hopDeltaHz,
                    hopRateHzPerSec
            );
        }

        double rfScore = clamp01(Math.max(energyScore * 0.60, Math.max(wifiScore, droneScore) * 0.75));
        return new Classification(
                "rf_band_activity",
                "INFO",
                rfScore,
                wifiScore,
                droneScore,
                controlLinkScore,
                digitalVideoScore,
                fhssScore,
                hopDeltaHz,
                hopRateHzPerSec
        );
    }

    private static double closenessScore(double value, double center, double halfWidth) {
        if (halfWidth <= 0.0) {
            return 0.0;
        }
        return clamp01(1.0 - (Math.abs(value - center) / halfWidth));
    }

    private void appendIqDumpEvidence(HashMap<String, Object> evidence, String eventId, RawIqFrame frame) {
        if (!props.getDetection().isIqDumpEnabled()) {
            evidence.put("iqDumpEnabled", false);
            return;
        }

        byte[] payload = frame.payload();
        if (payload == null || payload.length == 0) {
            evidence.put("iqDumpEnabled", false);
            evidence.put("iqDumpError", "empty payload");
            return;
        }

        try {
            Path dumpDir = resolveDumpDir();
            Files.createDirectories(dumpDir);

            int maxDumpBytes = Math.max(MIN_DUMP_BYTES, props.getDetection().getIqDumpMaxBytes());
            int dumpBytes = Math.min(payload.length, maxDumpBytes);
            String dumpFileName = buildDumpFileName(eventId, frame);
            Path dumpPath = dumpDir.resolve(dumpFileName).normalize().toAbsolutePath();

            try (OutputStream out = Files.newOutputStream(
                    dumpPath,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE)) {
                out.write(payload, 0, dumpBytes);
            }

            pruneOldDumps(dumpDir, props.getDetection().getIqDumpMaxFiles());

            evidence.put("iqDumpEnabled", true);
            evidence.put("iqDumpPath", dumpPath.toString());
            evidence.put("iqDumpBytes", dumpBytes);
            evidence.put("iqFrameBytes", payload.length);
            evidence.put("iqDumpTruncated", dumpBytes < payload.length);
        } catch (Exception e) {
            evidence.put("iqDumpEnabled", false);
            evidence.put("iqDumpError", e.getMessage());
            log.warn("Failed to write IQ dump for event {}", eventId, e);
        }
    }

    private Path resolveDumpDir() {
        String dir = props.getDetection().getIqDumpDir();
        if (dir == null || dir.isBlank()) {
            return Path.of("./data/iq-dumps");
        }
        return Path.of(dir);
    }

    private static String buildDumpFileName(String eventId, RawIqFrame frame) {
        String machine = sanitizeForFile(frame.machineId());
        String device = sanitizeForFile(frame.deviceId());
        return eventId
                + "_ts" + frame.timestampNs()
                + "_" + machine
                + "_" + device
                + "_cf" + frame.centerFreqHz()
                + "_sr" + frame.sampleRateHz()
                + "_fmt" + frame.iqFormat()
                + IQ_DUMP_EXTENSION;
    }

    private static String sanitizeForFile(String value) {
        if (value == null || value.isBlank()) {
            return "unknown";
        }
        return value.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static void pruneOldDumps(Path dumpDir, int maxFiles) {
        if (maxFiles <= 0) {
            return;
        }

        try (Stream<Path> stream = Files.list(dumpDir)) {
            List<Path> dumpFiles = stream
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(IQ_DUMP_EXTENSION))
                    .sorted(Comparator.comparingLong(DetectionEventService::lastModifiedMillisSafe))
                    .collect(Collectors.toList());

            int deleteCount = dumpFiles.size() - maxFiles;
            for (int i = 0; i < deleteCount; i++) {
                try {
                    Files.deleteIfExists(dumpFiles.get(i));
                } catch (IOException ignored) {
                }
            }
        } catch (IOException ignored) {
        }
    }

    private static long lastModifiedMillisSafe(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException e) {
            return Long.MAX_VALUE;
        }
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

    private static double clamp01(double value) {
        if (value < 0.0) {
            return 0.0;
        }
        if (value > 1.0) {
            return 1.0;
        }
        return value;
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

    private record FrameFeatures(double avgAbsEnergy,
                                 double avgPower,
                                 double powerVariance,
                                 double zeroCrossingRate,
                                 double spectralFlatness,
                                 double occupiedBandwidthHz,
                                 double peakToMeanDb,
                                 long peakFreqHz,
                                 long centerFreqHz,
                                 long sampleRateHz,
                                 int iqFormat) {
    }

    private record SpectralState(long peakFreqHz, long tsNs) {
    }

    private record Classification(String type,
                                  String severity,
                                  double confidence,
                                  double wifiScore,
                                  double droneScore,
                                  double controlLinkScore,
                                  double digitalVideoScore,
                                  double fhssScore,
                                  double hopDeltaHz,
                                  double hopRateHzPerSec) {
    }
}
