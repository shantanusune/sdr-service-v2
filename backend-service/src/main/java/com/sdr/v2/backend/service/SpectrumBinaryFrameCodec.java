package com.sdr.v2.backend.service;

import com.sdr.v2.backend.domain.SpectrumFrame;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@Component
public class SpectrumBinaryFrameCodec {

    // 8 + 8 + 8 + 4
    private static final int HEADER_SIZE = 28;

    public byte[] encode(SpectrumFrame frame) {
        int binCount = (frame.binsDb() == null) ? 0 : frame.binsDb().length;
        ByteBuffer out = ByteBuffer
                .allocate(HEADER_SIZE + (binCount * Float.BYTES))
                .order(ByteOrder.LITTLE_ENDIAN);

        double tsMs = frame.timestampNs() / 1_000_000.0;
        double centerHz = frame.centerFreqHz();
        double spanHz = frame.sampleRateHz();

        out.putDouble(tsMs);
        out.putDouble(centerHz);
        out.putDouble(spanHz);
        out.putInt(binCount);

        if (binCount > 0) {
            for (float v : frame.binsDb()) {
                out.putFloat(v);
            }
        }

        return out.array();
    }
}
