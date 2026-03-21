package com.sdr.v2.backend.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class RfmlLabService {

    private static final Logger log = LoggerFactory.getLogger(RfmlLabService.class);

    private static final int MIN_TRAIN_SAMPLES = 8;
    private static final int DEFAULT_EPOCHS = 300;
    private static final int MIN_EPOCHS = 20;
    private static final int MAX_EPOCHS = 2000;
    private static final double DEFAULT_LR = 0.12;
    private static final double DEFAULT_L2 = 0.0001;
    private static final double EPS = 1e-9;

    private final RawLabCaptureService rawLab;
    private final IqMlModelService iqMlModel;
    private final ObjectMapper objectMapper;

    private final LinkedHashMap<String, LabelRecord> labelsByCapture = new LinkedHashMap<>();
    private final LinkedHashMap<String, ModelRecord> modelsById = new LinkedHashMap<>();

    private final Path labelsStorePath = Path.of("./data/rfml/labels.json").toAbsolutePath().normalize();
    private final Path modelsDir = Path.of("./data/ml-models").toAbsolutePath().normalize();

    public RfmlLabService(RawLabCaptureService rawLab, IqMlModelService iqMlModel, ObjectMapper objectMapper) {
        this.rawLab = rawLab;
        this.iqMlModel = iqMlModel;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void init() {
        loadLabelsFromDisk();
    }

    public synchronized List<Map<String, Object>> listSamples() {
        List<Map<String, Object>> captures = rawLab.listCaptures();
        ArrayList<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> capture : captures) {
            String captureId = asString(capture.get("captureId"), "");
            if (captureId.isBlank()) {
                continue;
            }
            String status = asString(capture.get("status"), "unknown");
            if (!"complete".equalsIgnoreCase(status) && !"failed".equalsIgnoreCase(status)) {
                continue;
            }

            Map<String, Object> snapshot = rawLab.getCaptureFeatureSnapshot(captureId);
            @SuppressWarnings("unchecked")
            Map<String, Object> featureVector = snapshot.get("featureVector") instanceof Map<?, ?> v
                    ? (Map<String, Object>) v
                    : null;

            LabelRecord label = labelsByCapture.get(captureId);
            LinkedHashMap<String, Object> row = new LinkedHashMap<>();
            row.put("captureId", captureId);
            row.put("deviceId", asString(capture.get("deviceId"), "unknown"));
            row.put("timestamp", asLong(capture.get("timestamp"), 0L));
            row.put("duration", asInt(capture.get("duration"), 0));
            row.put("status", status);
            row.put("sampledFrames", asLong(snapshot.get("sampledFrames"), 0L));
            row.put("dominantLabel", asString(snapshot.get("dominantLabel"), ""));
            row.put("featureVector", featureVector == null ? Map.of() : featureVector);

            if (label != null) {
                row.put("label", label.label);
                row.put("notes", label.notes);
                row.put("updatedAt", label.updatedAtMs);
            } else {
                row.put("label", null);
                row.put("notes", "");
                row.put("updatedAt", 0L);
            }
            out.add(row);
        }
        out.sort(Comparator.comparingLong((Map<String, Object> v) -> asLong(v.get("timestamp"), 0L)).reversed());
        return out;
    }

    public synchronized Map<String, Object> labelCapture(Map<String, Object> request) {
        String captureId = asString(request.get("captureId"), "");
        String requestedLabel = normalizeLabel(asString(request.get("label"), ""));
        String notes = asString(request.get("notes"), "");
        if (captureId.isBlank()) {
            return Map.of("status", "failed", "error", "captureId is required");
        }
        if (requestedLabel.isBlank()) {
            return Map.of("status", "failed", "error", "label is required");
        }
        if (!iqMlModel.supportedLabels().contains(requestedLabel)) {
            return Map.of("status", "failed", "error", "unsupported label: " + requestedLabel);
        }

        Map<String, Object> snapshot = rawLab.getCaptureFeatureSnapshot(captureId);
        if (snapshot.get("error") != null) {
            return Map.of(
                    "status", "failed",
                    "captureId", captureId,
                    "error", String.valueOf(snapshot.get("error"))
            );
        }

        LabelRecord labelRecord = new LabelRecord(captureId, requestedLabel, notes, System.currentTimeMillis());
        labelsByCapture.put(captureId, labelRecord);
        persistLabelsLocked();

        return Map.of(
                "status", "ok",
                "captureId", captureId,
                "label", requestedLabel,
                "notes", notes,
                "updatedAt", labelRecord.updatedAtMs
        );
    }

    public synchronized Map<String, Object> trainModel(Map<String, Object> request) {
        int epochs = clampInt(asInt(request.get("epochs"), DEFAULT_EPOCHS), MIN_EPOCHS, MAX_EPOCHS);
        double lr = clampDouble(asDouble(request.get("learningRate"), DEFAULT_LR), 0.001, 1.0);
        double l2 = clampDouble(asDouble(request.get("l2"), DEFAULT_L2), 0.0, 0.1);
        boolean autoLoad = asBoolean(request.get("autoLoad"), true);

        List<String> labels = iqMlModel.supportedLabels();
        int classCount = labels.size();
        int featureCount = 18;

        ArrayList<double[]> samples = new ArrayList<>();
        ArrayList<Integer> targets = new ArrayList<>();
        LinkedHashMap<String, Integer> classCounts = new LinkedHashMap<>();
        for (String label : labels) {
            classCounts.put(label, 0);
        }

        for (LabelRecord labeled : labelsByCapture.values()) {
            if (!labels.contains(labeled.label)) {
                continue;
            }
            Map<String, Object> snapshot = rawLab.getCaptureFeatureSnapshot(labeled.captureId);
            if (snapshot.get("error") != null) {
                continue;
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> fvMap = snapshot.get("featureVector") instanceof Map<?, ?> m
                    ? (Map<String, Object>) m
                    : null;
            if (fvMap == null || fvMap.isEmpty()) {
                continue;
            }

            IqMlModelService.FeatureVector vector = mapToFeatureVector(fvMap);
            double[] projected = iqMlModel.projectFeatures(vector);
            if (projected.length != featureCount) {
                continue;
            }

            samples.add(projected);
            int classIdx = labels.indexOf(labeled.label);
            targets.add(classIdx);
            classCounts.put(labeled.label, classCounts.getOrDefault(labeled.label, 0) + 1);
        }

        if (samples.size() < MIN_TRAIN_SAMPLES) {
            return Map.of(
                    "status", "failed",
                    "error", "insufficient labeled samples",
                    "required", MIN_TRAIN_SAMPLES,
                    "available", samples.size()
            );
        }

        long nonZeroClasses = classCounts.values().stream().filter(v -> v > 0).count();
        if (nonZeroClasses < 2) {
            return Map.of(
                    "status", "failed",
                    "error", "training needs at least two labeled classes",
                    "classCounts", classCounts
            );
        }

        TrainOutcome outcome = trainSoftmax(samples, targets, classCount, featureCount, epochs, lr, l2);

        String modelId = "rfml-" + UUID.randomUUID();
        String version = "rfml-prototype-" + System.currentTimeMillis();
        Path modelPath = modelsDir.resolve(modelId + ".json");
        ensureDir(modelPath.getParent());

        LinkedHashMap<String, Object> artifact = new LinkedHashMap<>();
        artifact.put("version", version);
        artifact.put("labels", labels);
        artifact.put("featureOrder", List.of(
                "in24Band",
                "in5Band",
                "channelPrior",
                "controlBandwidthCloseness",
                "wideBandwidth",
                "narrowBandwidth",
                "flatness",
                "zeroCrossingRate",
                "energy",
                "burstiness",
                "toneStrength",
                "hopDelta",
                "hopRate",
                "staticWifiScore",
                "staticDroneScore",
                "staticControlLinkScore",
                "staticDigitalVideoScore",
                "staticFhssScore"
        ));
        artifact.put("bias", roundArray(outcome.bias));
        artifact.put("weights", roundMatrix(outcome.weights));

        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(modelPath.toFile(), artifact);
        } catch (IOException e) {
            return Map.of(
                    "status", "failed",
                    "error", "failed to write model artifact: " + e.getMessage()
            );
        }

        IqMlModelService.ModelLoadResult loadResult = null;
        if (autoLoad) {
            loadResult = iqMlModel.loadModelFromPath(modelPath.toString());
        }

        ModelRecord modelRecord = new ModelRecord(
                modelId,
                version,
                modelPath.toString(),
                System.currentTimeMillis(),
                samples.size(),
                round4(outcome.accuracy),
                round6(outcome.loss)
        );
        modelsById.put(modelId, modelRecord);

        LinkedHashMap<String, Object> response = new LinkedHashMap<>();
        response.put("status", "ok");
        response.put("modelId", modelId);
        response.put("modelVersion", version);
        response.put("modelPath", modelPath.toString());
        response.put("trainSamples", samples.size());
        response.put("classCounts", classCounts);
        response.put("epochs", epochs);
        response.put("learningRate", lr);
        response.put("l2", l2);
        response.put("trainAccuracy", round4(outcome.accuracy));
        response.put("trainLoss", round6(outcome.loss));
        response.put("autoLoad", autoLoad);
        response.put("activeModel", iqMlModel.currentModel());
        if (loadResult != null) {
            response.put("loadResult", loadResult);
        }
        return response;
    }

    public synchronized List<Map<String, Object>> listModels() {
        ArrayList<Map<String, Object>> out = new ArrayList<>();
        for (ModelRecord m : modelsById.values()) {
            out.add(Map.of(
                    "modelId", m.modelId,
                    "modelVersion", m.version,
                    "modelPath", m.path,
                    "createdAt", m.createdAtMs,
                    "trainSamples", m.samples,
                    "trainAccuracy", m.accuracy,
                    "trainLoss", m.loss
            ));
        }
        out.sort(Comparator.comparingLong((Map<String, Object> v) -> asLong(v.get("createdAt"), 0L)).reversed());
        return out;
    }

    public synchronized Map<String, Object> loadModel(Map<String, Object> request) {
        String modelPath = asString(request.get("modelPath"), "");
        if (modelPath.isBlank()) {
            return Map.of("status", "failed", "error", "modelPath is required");
        }
        IqMlModelService.ModelLoadResult result = iqMlModel.loadModelFromPath(modelPath);
        if (!result.loaded()) {
            return Map.of(
                    "status", "failed",
                    "modelPath", modelPath,
                    "error", result.error() == null ? "failed to load model" : result.error()
            );
        }
        return Map.of(
                "status", "ok",
                "modelPath", result.path(),
                "modelVersion", result.version(),
                "modelSource", result.source()
        );
    }

    private static TrainOutcome trainSoftmax(List<double[]> x,
                                             List<Integer> y,
                                             int classCount,
                                             int featureCount,
                                             int epochs,
                                             double lr,
                                             double l2) {
        int n = x.size();
        double[][] weights = new double[classCount][featureCount];
        double[] bias = new double[classCount];

        double loss = 0.0;
        double accuracy = 0.0;
        for (int epoch = 0; epoch < epochs; epoch++) {
            double[][] gradW = new double[classCount][featureCount];
            double[] gradB = new double[classCount];

            int correct = 0;
            double epochLoss = 0.0;

            for (int i = 0; i < n; i++) {
                double[] sample = x.get(i);
                int yi = y.get(i);

                double[] logits = new double[classCount];
                for (int c = 0; c < classCount; c++) {
                    double v = bias[c];
                    for (int f = 0; f < featureCount; f++) {
                        v += weights[c][f] * sample[f];
                    }
                    logits[c] = v;
                }
                double[] probs = softmax(logits);
                epochLoss += -Math.log(Math.max(EPS, probs[yi]));

                int pred = argmax(probs);
                if (pred == yi) {
                    correct++;
                }

                for (int c = 0; c < classCount; c++) {
                    double error = probs[c] - (c == yi ? 1.0 : 0.0);
                    gradB[c] += error;
                    for (int f = 0; f < featureCount; f++) {
                        gradW[c][f] += error * sample[f];
                    }
                }
            }

            for (int c = 0; c < classCount; c++) {
                gradB[c] = gradB[c] / n;
                bias[c] -= lr * gradB[c];
                for (int f = 0; f < featureCount; f++) {
                    gradW[c][f] = (gradW[c][f] / n) + (l2 * weights[c][f]);
                    weights[c][f] -= lr * gradW[c][f];
                }
            }

            loss = epochLoss / n;
            accuracy = (double) correct / n;
        }

        return new TrainOutcome(weights, bias, loss, accuracy);
    }

    private static int argmax(double[] values) {
        int idx = 0;
        double best = values[0];
        for (int i = 1; i < values.length; i++) {
            if (values[i] > best) {
                best = values[i];
                idx = i;
            }
        }
        return idx;
    }

    private static double[] softmax(double[] logits) {
        double max = Double.NEGATIVE_INFINITY;
        for (double v : logits) {
            if (v > max) {
                max = v;
            }
        }
        double[] exps = new double[logits.length];
        double sum = 0.0;
        for (int i = 0; i < logits.length; i++) {
            exps[i] = Math.exp(logits[i] - max);
            sum += exps[i];
        }
        double denom = Math.max(EPS, sum);
        for (int i = 0; i < exps.length; i++) {
            exps[i] /= denom;
        }
        return exps;
    }

    private IqMlModelService.FeatureVector mapToFeatureVector(Map<String, Object> fv) {
        return new IqMlModelService.FeatureVector(
                asDouble(fv.get("avgAbsEnergy"), 0.0),
                asDouble(fv.get("powerVariance"), 0.0),
                asDouble(fv.get("zeroCrossingRate"), 0.0),
                asDouble(fv.get("spectralFlatness"), 0.0),
                asDouble(fv.get("occupiedBandwidthHz"), 0.0),
                asDouble(fv.get("peakToMeanDb"), 0.0),
                asLong(fv.get("peakFreqHz"), 0L),
                asLong(fv.get("centerFreqHz"), 0L),
                asDouble(fv.get("hopDeltaHz"), 0.0),
                asDouble(fv.get("hopRateHzPerSec"), 0.0),
                asDouble(fv.get("staticWifiScore"), 0.0),
                asDouble(fv.get("staticDroneScore"), 0.0),
                asDouble(fv.get("staticControlLinkScore"), 0.0),
                asDouble(fv.get("staticDigitalVideoScore"), 0.0),
                asDouble(fv.get("staticFhssScore"), 0.0)
        );
    }

    private void loadLabelsFromDisk() {
        if (!Files.isRegularFile(labelsStorePath)) {
            return;
        }
        try {
            List<LabelRecord> rows = objectMapper.readValue(labelsStorePath.toFile(), new TypeReference<>() {});
            labelsByCapture.clear();
            for (LabelRecord row : rows) {
                if (row.captureId == null || row.captureId.isBlank()) {
                    continue;
                }
                labelsByCapture.put(row.captureId, row);
            }
        } catch (Exception e) {
            log.warn("Failed to load RFML labels store {}: {}", labelsStorePath, e.getMessage());
        }
    }

    private void persistLabelsLocked() {
        ensureDir(labelsStorePath.getParent());
        try {
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(
                    labelsStorePath.toFile(),
                    new ArrayList<>(labelsByCapture.values())
            );
        } catch (IOException e) {
            log.warn("Failed to persist RFML labels {}: {}", labelsStorePath, e.getMessage());
        }
    }

    private static void ensureDir(Path dir) {
        if (dir == null) {
            return;
        }
        try {
            Files.createDirectories(dir);
        } catch (IOException ignored) {
        }
    }

    private static String normalizeLabel(String label) {
        return label == null ? "" : label.trim().toLowerCase();
    }

    private static String asString(Object raw, String fallback) {
        if (raw instanceof String s) {
            return s;
        }
        if (raw != null) {
            return String.valueOf(raw);
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

    private static long asLong(Object raw, long fallback) {
        if (raw instanceof Number n) {
            return n.longValue();
        }
        if (raw instanceof String s) {
            try {
                return Long.parseLong(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static double asDouble(Object raw, double fallback) {
        if (raw instanceof Number n) {
            return n.doubleValue();
        }
        if (raw instanceof String s) {
            try {
                return Double.parseDouble(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static boolean asBoolean(Object raw, boolean fallback) {
        if (raw instanceof Boolean b) {
            return b;
        }
        if (raw instanceof String s) {
            return "true".equalsIgnoreCase(s.trim()) || "1".equals(s.trim());
        }
        return fallback;
    }

    private static int clampInt(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double clampDouble(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static double[] roundArray(double[] values) {
        double[] out = new double[values.length];
        for (int i = 0; i < values.length; i++) {
            out[i] = round6(values[i]);
        }
        return out;
    }

    private static double[][] roundMatrix(double[][] values) {
        double[][] out = new double[values.length][];
        for (int i = 0; i < values.length; i++) {
            out[i] = roundArray(values[i]);
        }
        return out;
    }

    private static double round6(double value) {
        return Math.round(value * 1_000_000.0) / 1_000_000.0;
    }

    private static double round4(double value) {
        return Math.round(value * 10_000.0) / 10_000.0;
    }

    private static final class LabelRecord {
        private String captureId;
        private String label;
        private String notes;
        private long updatedAtMs;

        private LabelRecord() {
        }

        private LabelRecord(String captureId, String label, String notes, long updatedAtMs) {
            this.captureId = captureId;
            this.label = label;
            this.notes = notes;
            this.updatedAtMs = updatedAtMs;
        }
    }

    private record TrainOutcome(double[][] weights, double[] bias, double loss, double accuracy) {
    }

    private record ModelRecord(String modelId,
                               String version,
                               String path,
                               long createdAtMs,
                               int samples,
                               double accuracy,
                               double loss) {
    }
}
