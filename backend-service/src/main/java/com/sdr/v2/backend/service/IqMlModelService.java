package com.sdr.v2.backend.service;

import com.sdr.v2.backend.config.AppProperties;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class IqMlModelService {

    public static final String LABEL_WIFI_CONTROL_LINK = "wifi_control_link";
    public static final String LABEL_DIGITAL_VIDEO_LINK = "digital_video_link";
    public static final String LABEL_FHSS_CONTROL_SUSPECTED = "fhss_control_suspected";
    public static final String LABEL_DRONE_IQ_ACTIVITY = "drone_iq_activity";
    public static final String LABEL_RF_BAND_ACTIVITY = "rf_band_activity";

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

    public IqMlModelService(AppProperties props) {
        this.props = props;
    }

    public MlInference infer(FeatureVector vector) {
        KnownChannelMatch known = nearestKnownChannelMatch(
                vector.centerFreqHz(),
                vector.peakFreqHz(),
                props.getDetection().getMl().getKnownChannelToleranceHz()
        );

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

        double logitControl = -1.30
                + (1.90 * in24Band)
                + (1.30 * channelPriorScore)
                + (1.40 * closenessScore(bandwidthMHz, 7.0, 6.0))
                + (0.90 * flatnessScore)
                + (0.80 * zcrScore)
                + (0.60 * energyScore)
                + (0.90 * vector.staticControlLinkScore())
                + (0.40 * vector.staticWifiScore())
                - (0.40 * hopDeltaScore);

        double logitVideo = -1.45
                + (1.40 * in24Band)
                + (1.30 * in5Band)
                + (1.25 * channelPriorScore)
                + (1.80 * wideBandwidthScore)
                + (0.90 * flatnessScore)
                + (0.50 * energyScore)
                + (0.90 * vector.staticDigitalVideoScore())
                + (0.30 * vector.staticWifiScore())
                - (0.40 * burstScore)
                - (0.25 * hopDeltaScore);

        double logitFhss = -1.55
                + (1.70 * in24Band)
                + (1.20 * channelPriorScore)
                + (1.20 * narrowBandwidthScore)
                + (1.30 * hopDeltaScore)
                + (1.10 * hopRateScore)
                + (0.60 * burstScore)
                + (1.00 * vector.staticFhssScore());

        double logitDrone = -1.65
                + (0.90 * channelPriorScore)
                + (1.00 * narrowBandwidthScore)
                + (0.90 * toneScore)
                + (0.80 * energyScore)
                + (0.70 * burstScore)
                + (0.50 * hopDeltaScore)
                + (0.40 * in5Band)
                + (0.70 * vector.staticDroneScore());

        double logitRf = -0.95
                + (0.90 * energyScore)
                + (0.60 * flatnessScore)
                + (0.40 * wideBandwidthScore)
                + (0.20 * in24Band)
                + (0.20 * in5Band)
                + (0.20 * Math.max(vector.staticWifiScore(), vector.staticDroneScore()));

        String[] labels = new String[]{
                LABEL_WIFI_CONTROL_LINK,
                LABEL_DIGITAL_VIDEO_LINK,
                LABEL_FHSS_CONTROL_SUSPECTED,
                LABEL_DRONE_IQ_ACTIVITY,
                LABEL_RF_BAND_ACTIVITY
        };
        double[] logits = new double[]{
                logitControl,
                logitVideo,
                logitFhss,
                logitDrone,
                logitRf
        };
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
        for (int i = 0; i < labels.length; i++) {
            probabilityByLabel.put(labels[i], round4(probs[i]));
        }

        return new MlInference(
                labels[bestIdx],
                round4(bestProb),
                probabilityByLabel,
                known.isNearKnownChannel(),
                known.nearestKnownChannelHz()
        );
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
                              long nearestKnownChannelHz) {
    }

    private record KnownChannelMatch(boolean isNearKnownChannel, long nearestKnownChannelHz) {
    }
}
