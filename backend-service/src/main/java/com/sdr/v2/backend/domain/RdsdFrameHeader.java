package com.sdr.v2.backend.domain;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public record RdsdFrameHeader(
        int magic,
        int version,
        int deviceType,
        int flags,
        long centerFreqHz,
        long sampleRateHz,
        long timestampNs,
        long seq,
        long payloadLen,
        int iqFormat
) {
    public static final int SIZE = 48;
    private static final int MAGIC = 0x44534452;

    public static RdsdFrameHeader parse(byte[] bytes) {
        if (bytes == null || bytes.length < SIZE) {
            return null;
        }
        ByteBuffer bb = ByteBuffer.wrap(bytes, 0, SIZE).order(ByteOrder.LITTLE_ENDIAN);
        return new RdsdFrameHeader(
                bb.getInt(0),
                bb.get(4) & 0xFF,
                bb.get(5) & 0xFF,
                bb.getShort(6) & 0xFFFF,
                bb.getLong(8),
                bb.getInt(16) & 0xFFFFFFFFL,
                bb.getLong(20),
                bb.getLong(28),
                bb.getInt(36) & 0xFFFFFFFFL,
                bb.get(40) & 0xFF
        );
    }

    public boolean hasMagic() {
        return magic == MAGIC;
    }
}
