package com.sdr.v2.backend.service;

import com.sdr.v2.backend.config.AppProperties;
import com.sdr.v2.backend.domain.RawIqFrame;
import com.sdr.v2.backend.domain.SpectrumFrame;
import com.sdr.v2.backend.ports.SpectrumFeedPort;
import org.springframework.stereotype.Service;

@Service
public class SpectrumService {

    private final AppProperties props;
    private final SpectrumFeedPort feedPort;

    public SpectrumService(AppProperties props, SpectrumFeedPort feedPort) {
        this.props = props;
        this.feedPort = feedPort;
    }

    public SpectrumFrame onIqFrame(RawIqFrame frame) {
        SpectrumFrame spectrum = computeSpectrum(frame);
        if (spectrum != null) {
            feedPort.publish(spectrum);
        }
        return spectrum;
    }

    public SpectrumFrame fromNativeBins(String machineId,
                                        String deviceId,
                                        long timestampNs,
                                        long seq,
                                        long centerFreqHz,
                                        long sampleRateHz,
                                        float[] binsDb) {
        if (binsDb == null || binsDb.length == 0) {
            return null;
        }
        int nfft = binsDb.length * 2;
        float binHz = (sampleRateHz <= 0 || nfft <= 0) ? 0f : (float) sampleRateHz / nfft;

        float peakDb = -200f;
        int peakIndex = 0;
        for (int i = 0; i < binsDb.length; i++) {
            if (binsDb[i] > peakDb) {
                peakDb = binsDb[i];
                peakIndex = i;
            }
        }

        long peakHz = centerFreqHz;
        if (binHz > 0) {
            peakHz = centerFreqHz + Math.round(peakIndex * binHz);
        }

        SpectrumFrame frame = new SpectrumFrame(
                machineId,
                deviceId,
                timestampNs,
                seq,
                centerFreqHz,
                sampleRateHz,
                nfft,
                binHz,
                binsDb,
                peakDb,
                peakHz
        );

        feedPort.publish(frame);
        return frame;
    }

    private SpectrumFrame computeSpectrum(RawIqFrame frame) {
        int nfft = Math.max(256, props.getSpectrum().getDefaultNfft());
        nfft = highestPowerOfTwo(nfft);

        int needed = nfft * 2;
        if (frame.payload() == null || frame.payload().length < needed) {
            return null;
        }

        double[] re = new double[nfft];
        double[] im = new double[nfft];
        byte[] iq = frame.payload();

        for (int i = 0; i < nfft; i++) {
            int ii = i * 2;
            int qq = ii + 1;
            double iVal;
            double qVal;
            if (frame.iqFormat() == 1) {
                iVal = iq[ii] / 128.0;
                qVal = iq[qq] / 128.0;
            } else {
                iVal = ((iq[ii] & 0xFF) - 127.5) / 128.0;
                qVal = ((iq[qq] & 0xFF) - 127.5) / 128.0;
            }

            if (props.getSpectrum().isApplyHannWindow()) {
                double w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (nfft - 1));
                iVal *= w;
                qVal *= w;
            }

            re[i] = iVal;
            im[i] = qVal;
        }

        fft(re, im);

        int bins = props.getSpectrum().isHalfSpectrum() ? (nfft / 2) : nfft;
        float[] out = new float[bins];
        float peakDb = -200f;
        int peakIndex = 0;

        for (int k = 0; k < bins; k++) {
            double mag2 = (re[k] * re[k]) + (im[k] * im[k]);
            float db = (float) (10.0 * Math.log10(mag2 + 1e-12));
            out[k] = db;
            if (db > peakDb) {
                peakDb = db;
                peakIndex = k;
            }
        }

        float binHz = (float) frame.sampleRateHz() / nfft;
        long peakHz = frame.centerFreqHz() + Math.round(peakIndex * binHz);

        return new SpectrumFrame(
                frame.machineId(),
                frame.deviceId(),
                frame.timestampNs(),
                frame.sequence(),
                frame.centerFreqHz(),
                frame.sampleRateHz(),
                nfft,
                binHz,
                out,
                peakDb,
                peakHz
        );
    }

    private static int highestPowerOfTwo(int value) {
        int p2 = 1;
        while (p2 < value) {
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
}
