package com.sdr.v2.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private final Zmq zmq = new Zmq();
    private final Spectrum spectrum = new Spectrum();
    private final Detection detection = new Detection();
    private final Registry registry = new Registry();
    private final Security security = new Security();

    public Zmq getZmq() {
        return zmq;
    }

    public Spectrum getSpectrum() {
        return spectrum;
    }

    public Detection getDetection() {
        return detection;
    }

    public Registry getRegistry() {
        return registry;
    }

    public Security getSecurity() {
        return security;
    }

    public static class Zmq {
        private String endpoint = "tcp://127.0.0.1:5555";
        private int receiveTimeoutMs = 1000;

        public String getEndpoint() {
            return endpoint;
        }

        public void setEndpoint(String endpoint) {
            this.endpoint = endpoint;
        }

        public int getReceiveTimeoutMs() {
            return receiveTimeoutMs;
        }

        public void setReceiveTimeoutMs(int receiveTimeoutMs) {
            this.receiveTimeoutMs = receiveTimeoutMs;
        }
    }

    public static class Spectrum {
        private int defaultNfft = 2048;
        private boolean halfSpectrum = true;
        private boolean applyHannWindow = true;

        public int getDefaultNfft() {
            return defaultNfft;
        }

        public void setDefaultNfft(int defaultNfft) {
            this.defaultNfft = defaultNfft;
        }

        public boolean isHalfSpectrum() {
            return halfSpectrum;
        }

        public void setHalfSpectrum(boolean halfSpectrum) {
            this.halfSpectrum = halfSpectrum;
        }

        public boolean isApplyHannWindow() {
            return applyHannWindow;
        }

        public void setApplyHannWindow(boolean applyHannWindow) {
            this.applyHannWindow = applyHannWindow;
        }
    }

    public static class Detection {
        private boolean iqEnabled = true;
        private double detectionThreshold = 0.22;
        private long detectionCooldownMs = 5000;
        private boolean iqDumpEnabled = true;
        private String iqDumpDir = "./data/iq-dumps";
        private int iqDumpMaxBytes = 131072;
        private int iqDumpMaxFiles = 2000;
        private List<String> bands = new ArrayList<>(List.of(
                "433000000-435000000",
                "863000000-928000000",
                "2400000000-2483500000",
                "5725000000-5875000000"
        ));

        public boolean isIqEnabled() {
            return iqEnabled;
        }

        public void setIqEnabled(boolean iqEnabled) {
            this.iqEnabled = iqEnabled;
        }

        public double getDetectionThreshold() {
            return detectionThreshold;
        }

        public void setDetectionThreshold(double detectionThreshold) {
            this.detectionThreshold = detectionThreshold;
        }

        public long getDetectionCooldownMs() {
            return detectionCooldownMs;
        }

        public void setDetectionCooldownMs(long detectionCooldownMs) {
            this.detectionCooldownMs = detectionCooldownMs;
        }

        public boolean isIqDumpEnabled() {
            return iqDumpEnabled;
        }

        public void setIqDumpEnabled(boolean iqDumpEnabled) {
            this.iqDumpEnabled = iqDumpEnabled;
        }

        public String getIqDumpDir() {
            return iqDumpDir;
        }

        public void setIqDumpDir(String iqDumpDir) {
            this.iqDumpDir = iqDumpDir;
        }

        public int getIqDumpMaxBytes() {
            return iqDumpMaxBytes;
        }

        public void setIqDumpMaxBytes(int iqDumpMaxBytes) {
            this.iqDumpMaxBytes = iqDumpMaxBytes;
        }

        public int getIqDumpMaxFiles() {
            return iqDumpMaxFiles;
        }

        public void setIqDumpMaxFiles(int iqDumpMaxFiles) {
            this.iqDumpMaxFiles = iqDumpMaxFiles;
        }

        public List<String> getBands() {
            return bands;
        }

        public void setBands(List<String> bands) {
            this.bands = (bands == null) ? new ArrayList<>() : bands;
        }
    }

    public static class Registry {
        private long offlineAfterMs = 45000;

        public long getOfflineAfterMs() {
            return offlineAfterMs;
        }

        public void setOfflineAfterMs(long offlineAfterMs) {
            this.offlineAfterMs = offlineAfterMs;
        }
    }

    public static class Security {
        private boolean authEnabled = false;
        private String issuerUri = "";

        public boolean isAuthEnabled() {
            return authEnabled;
        }

        public void setAuthEnabled(boolean authEnabled) {
            this.authEnabled = authEnabled;
        }

        public String getIssuerUri() {
            return issuerUri;
        }

        public void setIssuerUri(String issuerUri) {
            this.issuerUri = issuerUri;
        }
    }
}
