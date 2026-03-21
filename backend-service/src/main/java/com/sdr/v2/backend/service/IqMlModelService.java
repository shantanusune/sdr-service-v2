package com.sdr.v2.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sdr.v2.backend.config.AppProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class IqMlModelService {

    private static final Logger log = LoggerFactory.getLogger(IqMlModelService.class);

    public static final String LABEL_WIFI_CONTROL_LINK = "wifi_control_link";
    public static final String LABEL_DIGITAL_VIDEO_LINK = "digital_video_link";
    public static final String LABEL_FHSS_CONTROL_SUSPECTED = "fhss_control_suspected";
    public static final String LABEL_DRONE_IQ_ACTIVITY = "drone_iq_activity";
    public static final String LABEL_RF_BAND_ACTIVITY = "rf_band_activity";

    private static final String[] LABELS = new String[]{
            LABEL_WIFI_CONTROL_LINK,
            LABEL_DIGITAL_VIDEO_LINK,
            LABEL_FHSS_CONTROL_SUSPECTED,
            LABEL_DRONE_IQ_ACTIVITY,
            LABEL_RF_BAND_ACTIVITY
    };

    private static final int F_IN24_BAND = 0;
    private static final int F_IN5_BAND = 1;
    private static final int F_CHANNEL_PRIOR = 2;
    private static final int F_CONTROL_BW_CLOSENESS = 3;
    private static final int F_WIDE_BW = 4;
    private static final int F_NARROW_BW = 5;
    private static final int F_FLATNESS = 6;
    private static final int F_ZCR = 7;
    private static final int F_ENERGY = 8;
    private static final int F_BURST = 9;
    private static final int F_TONE = 10;
    private static final int F_HOP_DELTA = 11;
    private static final int F_HOP_RATE = 12;
    private static final int F_STATIC_WIFI = 13;
    private static final int F_STATIC_DRONE = 14;
    private static final int F_STATIC_CONTROL = 15;
    private static final int F_STATIC_VIDEO = 16;
    private static final int F_STATIC_FHSS = 17;
    private static final int FEATURE_COUNT = 18;

    private static final String MODEL_SOURCE_EMBEDDED = "embedded";

    private static final long[] KNOWN_CHANNELS_HZ = new long[]{
            // FPV analog bands (A/B/E/F/R/S)
            5_645_000_000L, 5_658_000_000L, 5_660_000_000L, 5_665_000_000L, 5_685_000_000L, 5_695_000_000L,
            5_705_000_000L, 5_725_000_000L, 5_732_000_000L, 5_733_000_000L, 5_735_000_000L, 5_740_000_000L,
            5_745_000_000L, 5_752_000_000L, 5_760_000_000L, 5_765_000_000L, 5_769_000_000L, 5_770_000_000L,
            5_771_000_000L, 5_780_000_000L, 5_785_000_000L, 5_790_000_000L, 5_800_000_000L, 5_805_000_000L,
            5_806_000_000L, 5_809_000_000L, 5_820_000_000L, 5_825_000_000L, 5_828_000_000L, 5_839_000_000L,
            5_840_000_000L, 5_843_000_000L, 5_845_000_000L, 5_847_000_000L, 5_860_000_000L, 5_865_000_000L,
            5_866_000_000L, 5_878_000_000L, 5_880_000_000L, 5_885_000_000L, 5_905_000_000L, 5_917_000_000L,
            5_925_000_000L, 5_945_000_000L,

            // DJI Transmission table + known 2.4 GHz entries
            2_435_000_000L, 2_445_000_000L, 2_461_000_000L,
            5_180_000_000L, 5_190_000_000L, 5_200_000_000L, 5_220_000_000L, 5_230_000_000L, 5_240_000_000L,
            5_260_000_000L, 5_270_000_000L, 5_280_000_000L, 5_300_000_000L, 5_310_000_000L, 5_320_000_000L,
            5_500_000_000L, 5_510_000_000L, 5_520_000_000L, 5_540_000_000L, 5_550_000_000L, 5_560_000_000L,
            5_580_000_000L, 5_660_000_000L, 5_670_000_000L, 5_680_000_000L, 5_700_000_000L, 5_760_000_000L,
            5_770_000_000L, 5_786_000_000L, 5_812_000_000L, 5_829_000_000L, 5_838_000_000L
    };

    private final AppProperties props;
    private final ObjectMapper objectMapper;
    private volatile ModelRuntime modelRuntime = defaultRuntime();

    public IqMlModelService(AppProperties props, ObjectMapper objectMapper) {
        this.props = props;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void init() {
        loadModelRuntime();
    }

    public List<String> supportedLabels() {
        return List.of(LABELS);
    }

    public double[] projectFeatures(FeatureVector vector) {
        KnownChannelMatch known = nearestKnownChannelMatch(
                vector.centerFreqHz(),
                vector.peakFreqHz(),
                props.getDetection().getMl().getKnownChannelToleranceHz()
        );
        return buildFeatures(vector, known);
    }

    public ModelInfo currentModel() {
        ModelRuntime runtime = modelRuntime;
        return new ModelInfo(runtime.version(), runtime.source(), props.getDetection().getMl().getModelPath());
    }

    public synchronized ModelLoadResult loadModelFromPath(String modelPath) {
        String requestedPath = modelPath == null ? "" : modelPath.trim();
        if (requestedPath.isBlank()) {
            props.getDetection().getMl().setModelPath("");
            modelRuntime = defaultRuntime();
            ModelRuntime runtime = modelRuntime;
            return new ModelLoadResult(true, runtime.version(), runtime.source(), "", null);
        }

        Path resolvedPath = Path.of(requestedPath).toAbsolutePath().normalize();
        if (!Files.isRegularFile(resolvedPath)) {
            return new ModelLoadResult(
                    false,
                    modelRuntime.version(),
                    modelRuntime.source(),
                    resolvedPath.toString(),
                    "model file not found"
            );
        }

        try {
            ModelArtifact artifact = objectMapper.readValue(resolvedPath.toFile(), ModelArtifact.class);
            ModelRuntime runtime = toRuntime(artifact, resolvedPath.toString());
            props.getDetection().getMl().setModelPath(resolvedPath.toString());
            modelRuntime = runtime;
            log.info("Loaded IQ ML model from {} version={}", resolvedPath, runtime.version());
            return new ModelLoadResult(true, runtime.version(), runtime.source(), resolvedPath.toString(), null);
        } catch (Exception e) {
            log.warn("Failed to load IQ ML model from {}: {}", resolvedPath, e.getMessage());
            return new ModelLoadResult(
                    false,
                    modelRuntime.version(),
                    modelRuntime.source(),
                    resolvedPath.toString(),
                    e.getMessage()
            );
        }
    }

    public MlInference infer(FeatureVector vector) {
        ModelRuntime runtime = modelRuntime;
        KnownChannelMatch known = nearestKnownChannelMatch(
                vector.centerFreqHz(),
                vector.peakFreqHz(),
                props.getDetection().getMl().getKnownChannelToleranceHz()
        );
        double[] features = buildFeatures(vector, known);

        double[] logits = new double[LABELS.length];
        for (int i = 0; i < LABELS.length; i++) {
            double v = runtime.bias()[i];
            for (int j = 0; j < FEATURE_COUNT; j++) {
                v += runtime.weights()[i][j] * features[j];
            }
            logits[i] = v;
        }

        double[] probs = softmax(logits);

        int bestIdx = 0;
        double bestProb = probs[0];
        for (int i = 1; i < probs.length; i++) {
            if (probs[i] > bestProb) {
                bestProb = probs[i];
                bestIdx = i;
            }
        }

        LinkedHashMap<String, Double> probabilityByLabel = new LinkedHashMap<>();
        for (int i = 0; i < LABELS.length; i++) {
            probabilityByLabel.put(LABELS[i], round4(probs[i]));
        }

        return new MlInference(
                LABELS[bestIdx],
                round4(bestProb),
                probabilityByLabel,
                known.isNearKnownChannel(),
                known.nearestKnownChannelHz(),
                runtime.version(),
                runtime.source()
        );
    }

    private static double[] buildFeatures(FeatureVector vector, KnownChannelMatch known) {
        double bandwidthMHz = vector.occupiedBandwidthHz() / 1_000_000.0;
        double energyScore = clamp01((vector.avgAbsEnergy() - 0.10) / 0.55);
        double flatnessScore = clamp01((vector.spectralFlatness() - 0.25) / 0.55);
        double zcrScore = clamp01((vector.zeroCrossingRate() - 0.15) / 0.50);
        double burstScore = clamp01(vector.powerVariance() / 0.20);
        double toneScore = clamp01((vector.peakToMeanDb() - 4.0) / 12.0);

        double narrowBandwidthScore = clamp01((10.0 - bandwidthMHz) / 10.0);
        double wideBandwidthScore = clamp01((bandwidthMHz - 9.0) / 24.0);
        double hopDeltaScore = clamp01((vector.hopDeltaHz() - 250_000.0) / 4_000_000.0);
        double hopRateScore = clamp01((vector.hopRateHzPerSec() - 150_000.0) / 3_000_000.0);
        double channelPriorScore = known.isNearKnownChannel() ? 1.0 : 0.0;
        double in24Band = inRange(vector.centerFreqHz(), 2_400_000_000L, 2_483_500_000L) ? 1.0 : 0.0;
        double in5Band = inRange(vector.centerFreqHz(), 5_100_000_000L, 5_950_000_000L) ? 1.0 : 0.0;

        double[] features = new double[FEATURE_COUNT];
        features[F_IN24_BAND] = in24Band;
        features[F_IN5_BAND] = in5Band;
        features[F_CHANNEL_PRIOR] = channelPriorScore;
        features[F_CONTROL_BW_CLOSENESS] = closenessScore(bandwidthMHz, 7.0, 6.0);
        features[F_WIDE_BW] = wideBandwidthScore;
        features[F_NARROW_BW] = narrowBandwidthScore;
        features[F_FLATNESS] = flatnessScore;
        features[F_ZCR] = zcrScore;
        features[F_ENERGY] = energyScore;
        features[F_BURST] = burstScore;
        features[F_TONE] = toneScore;
        features[F_HOP_DELTA] = hopDeltaScore;
        features[F_HOP_RATE] = hopRateScore;
        features[F_STATIC_WIFI] = vector.staticWifiScore();
        features[F_STATIC_DRONE] = vector.staticDroneScore();
        features[F_STATIC_CONTROL] = vector.staticControlLinkScore();
        features[F_STATIC_VIDEO] = vector.staticDigitalVideoScore();
        features[F_STATIC_FHSS] = vector.staticFhssScore();
        return features;
    }

    private void loadModelRuntime() {
        ModelRuntime fallback = defaultRuntime();
        String configuredPath = props.getDetection().getMl().getModelPath();
        if (configuredPath == null || configuredPath.isBlank()) {
            modelRuntime = fallback;
            return;
        }

        Path modelPath = Path.of(configuredPath).toAbsolutePath().normalize();
        if (!Files.isRegularFile(modelPath)) {
            log.warn("Configured ML model path not found: {}. Using embedded model.", modelPath);
            modelRuntime = fallback;
            return;
        }

        try {
            ModelArtifact artifact = objectMapper.readValue(modelPath.toFile(), ModelArtifact.class);
            ModelRuntime loaded = toRuntime(artifact, modelPath.toString());
            modelRuntime = loaded;
            log.info("Loaded IQ ML model from {} version={}", modelPath, loaded.version());
        } catch (Exception e) {
            log.warn("Failed to load ML model from {}: {}. Using embedded model.", modelPath, e.getMessage());
            modelRuntime = fallback;
        }
    }

    private static ModelRuntime toRuntime(ModelArtifact artifact, String sourcePath) {
        if (artifact == null) {
            throw new IllegalArgumentException("model artifact is null");
        }
        List<String> labels = artifact.getLabels();
        double[] artifactBias = artifact.getBias();
        double[][] artifactWeights = artifact.getWeights();

        if (labels == null || artifactBias == null || artifactWeights == null) {
            throw new IllegalArgumentException("model artifact must contain labels, bias and weights");
        }
        if (labels.size() != LABELS.length) {
            throw new IllegalArgumentException("labels count mismatch");
        }
        if (artifactBias.length != LABELS.length) {
            throw new IllegalArgumentException("bias count mismatch");
        }
        if (artifactWeights.length != LABELS.length) {
            throw new IllegalArgumentException("weights rows mismatch");
        }

        HashMap<String, Integer> labelToIndex = new HashMap<>();
        for (int i = 0; i < labels.size(); i++) {
            labelToIndex.put(labels.get(i), i);
        }

        double[] bias = new double[LABELS.length];
        double[][] weights = new double[LABELS.length][FEATURE_COUNT];
        for (int targetIdx = 0; targetIdx < LABELS.length; targetIdx++) {
            Integer sourceIdx = labelToIndex.get(LABELS[targetIdx]);
            if (sourceIdx == null) {
                throw new IllegalArgumentException("missing expected label: " + LABELS[targetIdx]);
            }
            if (artifactWeights[sourceIdx] == null || artifactWeights[sourceIdx].length != FEATURE_COUNT) {
                throw new IllegalArgumentException("weights columns mismatch for label: " + LABELS[targetIdx]);
            }
            bias[targetIdx] = artifactBias[sourceIdx];
            System.arraycopy(artifactWeights[sourceIdx], 0, weights[targetIdx], 0, FEATURE_COUNT);
        }

        String version = artifact.getVersion();
        if (version == null || version.isBlank()) {
            version = "external-unknown";
        }
        return new ModelRuntime(bias, weights, version, sourcePath);
    }

    private static ModelRuntime defaultRuntime() {
        double[] bias = new double[]{
                -1.30, // wifi_control_link
                -1.45, // digital_video_link
                -1.55, // fhss_control_suspected
                -1.65, // drone_iq_activity
                -0.95  // rf_band_activity
        };
        double[][] weights = new double[LABELS.length][FEATURE_COUNT];

        // wifi_control_link
        weights[0][F_IN24_BAND] = 1.90;
        weights[0][F_CHANNEL_PRIOR] = 1.30;
        weights[0][F_CONTROL_BW_CLOSENESS] = 1.40;
        weights[0][F_FLATNESS] = 0.90;
        weights[0][F_ZCR] = 0.80;
        weights[0][F_ENERGY] = 0.60;
        weights[0][F_HOP_DELTA] = -0.40;
        weights[0][F_STATIC_WIFI] = 0.40;
        weights[0][F_STATIC_CONTROL] = 0.90;

        // digital_video_link
        weights[1][F_IN24_BAND] = 1.40;
        weights[1][F_IN5_BAND] = 1.30;
        weights[1][F_CHANNEL_PRIOR] = 1.25;
        weights[1][F_WIDE_BW] = 1.80;
        weights[1][F_FLATNESS] = 0.90;
        weights[1][F_ENERGY] = 0.50;
        weights[1][F_BURST] = -0.40;
        weights[1][F_HOP_DELTA] = -0.25;
        weights[1][F_STATIC_WIFI] = 0.30;
        weights[1][F_STATIC_VIDEO] = 0.90;

        // fhss_control_suspected
        weights[2][F_IN24_BAND] = 1.70;
        weights[2][F_CHANNEL_PRIOR] = 1.20;
        weights[2][F_NARROW_BW] = 1.20;
        weights[2][F_BURST] = 0.60;
        weights[2][F_HOP_DELTA] = 1.30;
        weights[2][F_HOP_RATE] = 1.10;
        weights[2][F_STATIC_FHSS] = 1.00;

        // drone_iq_activity
        weights[3][F_IN5_BAND] = 0.40;
        weights[3][F_CHANNEL_PRIOR] = 0.90;
        weights[3][F_NARROW_BW] = 1.00;
        weights[3][F_ENERGY] = 0.80;
        weights[3][F_BURST] = 0.70;
        weights[3][F_TONE] = 0.90;
        weights[3][F_HOP_DELTA] = 0.50;
        weights[3][F_STATIC_DRONE] = 0.70;

        // rf_band_activity
        weights[4][F_IN24_BAND] = 0.20;
        weights[4][F_IN5_BAND] = 0.20;
        weights[4][F_WIDE_BW] = 0.40;
        weights[4][F_FLATNESS] = 0.60;
        weights[4][F_ENERGY] = 0.90;
        weights[4][F_STATIC_WIFI] = 0.10;
        weights[4][F_STATIC_DRONE] = 0.10;

        return new ModelRuntime(bias, weights, "embedded-v1", MODEL_SOURCE_EMBEDDED);
    }

    private static KnownChannelMatch nearestKnownChannelMatch(long centerFreqHz, long peakFreqHz, long toleranceHz) {
        long tol = Math.max(0L, toleranceHz);
        long nearest = 0L;
        long bestDist = Long.MAX_VALUE;

        for (long channelHz : KNOWN_CHANNELS_HZ) {
            long dCenter = Math.abs(centerFreqHz - channelHz);
            long dPeak = Math.abs(peakFreqHz - channelHz);
            long dist = Math.min(dCenter, dPeak);
            if (dist < bestDist) {
                bestDist = dist;
                nearest = channelHz;
            }
        }

        return new KnownChannelMatch(bestDist <= tol, nearest);
    }

    private static double[] softmax(double[] logits) {
        double max = Double.NEGATIVE_INFINITY;
        for (double v : logits) {
            if (v > max) {
                max = v;
            }
        }

        double sum = 0.0;
        double[] exps = new double[logits.length];
        for (int i = 0; i < logits.length; i++) {
            exps[i] = Math.exp(logits[i] - max);
            sum += exps[i];
        }

        double denom = Math.max(1e-9, sum);
        for (int i = 0; i < exps.length; i++) {
            exps[i] = exps[i] / denom;
        }
        return exps;
    }

    private static boolean inRange(long value, long start, long end) {
        return value >= start && value <= end;
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

    private static double round4(double value) {
        return Math.round(value * 10_000.0) / 10_000.0;
    }

    public record FeatureVector(double avgAbsEnergy,
                                double powerVariance,
                                double zeroCrossingRate,
                                double spectralFlatness,
                                double occupiedBandwidthHz,
                                double peakToMeanDb,
                                long peakFreqHz,
                                long centerFreqHz,
                                double hopDeltaHz,
                                double hopRateHzPerSec,
                                double staticWifiScore,
                                double staticDroneScore,
                                double staticControlLinkScore,
                                double staticDigitalVideoScore,
                                double staticFhssScore) {
    }

    public record MlInference(String label,
                              double confidence,
                              Map<String, Double> probabilityByLabel,
                              boolean nearKnownChannel,
                              long nearestKnownChannelHz,
                              String modelVersion,
                              String modelSource) {
    }

    private record KnownChannelMatch(boolean isNearKnownChannel, long nearestKnownChannelHz) {
    }

    private record ModelRuntime(double[] bias,
                                double[][] weights,
                                String version,
                                String source) {
    }

    public static class ModelArtifact {
        private String version;
        private List<String> labels;
        private double[] bias;
        private double[][] weights;

        public String getVersion() {
            return version;
        }

        public void setVersion(String version) {
            this.version = version;
        }

        public List<String> getLabels() {
            return labels;
        }

        public void setLabels(List<String> labels) {
            this.labels = labels;
        }

        public double[] getBias() {
            return bias;
        }

        public void setBias(double[] bias) {
            this.bias = bias;
        }

        public double[][] getWeights() {
            return weights;
        }

        public void setWeights(double[][] weights) {
            this.weights = weights;
        }
    }

    public record ModelInfo(String version, String source, String configuredPath) {
    }

    public record ModelLoadResult(boolean loaded,
                                  String version,
                                  String source,
                                  String path,
                                  String error) {
    }
}
