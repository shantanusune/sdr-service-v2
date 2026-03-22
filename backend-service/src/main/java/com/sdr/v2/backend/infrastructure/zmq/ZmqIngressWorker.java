package com.sdr.v2.backend.infrastructure.zmq;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sdr.v2.backend.config.AppProperties;
import com.sdr.v2.backend.domain.NativeActivityEvent;
import com.sdr.v2.backend.domain.RawIqFrame;
import com.sdr.v2.backend.domain.RdsdFrameHeader;
import com.sdr.v2.backend.domain.SpectrumFrame;
import com.sdr.v2.backend.infrastructure.stream.StreamHub;
import com.sdr.v2.backend.service.DetectionEventService;
import com.sdr.v2.backend.service.NativeActivityService;
import com.sdr.v2.backend.service.RawLabCaptureService;
import com.sdr.v2.backend.service.RegistryStateService;
import com.sdr.v2.backend.service.SpectrumBinaryFrameCodec;
import com.sdr.v2.backend.service.SpectrumService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;
import org.zeromq.SocketType;
import org.zeromq.ZContext;
import org.zeromq.ZMQ;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class ZmqIngressWorker implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(ZmqIngressWorker.class);

    private final AppProperties props;
    private final RegistryStateService registry;
    private final SpectrumService spectrum;
    private final DetectionEventService detections;
    private final NativeActivityService nativeActivity;
    private final RawLabCaptureService rawLabCaptures;
    private final StreamHub streamHub;
    private final SpectrumBinaryFrameCodec spectrumCodec;
    private final ObjectMapper om = new ObjectMapper();

    private final AtomicBoolean running = new AtomicBoolean(false);
    private Thread worker;

    public ZmqIngressWorker(AppProperties props,
                            RegistryStateService registry,
                            SpectrumService spectrum,
                            DetectionEventService detections,
                            NativeActivityService nativeActivity,
                            RawLabCaptureService rawLabCaptures,
                            StreamHub streamHub,
                            SpectrumBinaryFrameCodec spectrumCodec) {
        this.props = props;
        this.registry = registry;
        this.spectrum = spectrum;
        this.detections = detections;
        this.nativeActivity = nativeActivity;
        this.rawLabCaptures = rawLabCaptures;
        this.streamHub = streamHub;
        this.spectrumCodec = spectrumCodec;
    }

    @Override
    public void start() {
        if (!running.compareAndSet(false, true)) {
            return;
        }
        worker = new Thread(this::runLoop, "zmq-ingress-worker");
        worker.setDaemon(true);
        worker.start();
    }

    private void runLoop() {
        String machineId = "unknown";
        log.info("ZMQ ingress started endpoint={}", props.getZmq().getEndpoint());

        try (ZContext context = new ZContext(); ZMQ.Socket sub = context.createSocket(SocketType.SUB)) {
            sub.setReceiveTimeOut(props.getZmq().getReceiveTimeoutMs());
            sub.connect(props.getZmq().getEndpoint());
            sub.subscribe(new byte[0]);

            while (running.get()) {
                String topic = sub.recvStr();
                if (topic == null) {
                    continue;
                }
                byte[] payload = sub.recv(0);
                if (payload == null) {
                    continue;
                }

                String effectiveMachineId = machineId;
                if (topic.startsWith("meta/")) {
                    Map<String, Object> body = parseJson(payload);
                    if (body == null) {
                        continue;
                    }

                    if ("meta/host".equals(topic)) {
                        Object ip = body.get("machineIp");
                        if (ip instanceof String s && !s.isBlank()) {
                            machineId = s;
                            effectiveMachineId = s;
                        }
                    }

                    nativeActivity.add(new NativeActivityEvent(effectiveMachineId, topic, Instant.now(), body));
                    registry.onMeta(effectiveMachineId, topic, body);
                    continue;
                }

                TopicParts parts = TopicParts.parse(topic, machineId);
                if (parts == null) {
                    continue;
                }

                effectiveMachineId = parts.machineId();
                if ("rawfeed".equals(parts.stream())) {
                    handleRawFrame(effectiveMachineId, parts.deviceId(), payload);
                    continue;
                }

                if ("spectrum".equals(parts.stream())) {
                    handleNativeSpectrum(effectiveMachineId, parts.deviceId(), payload);
                }
            }
        } catch (Exception e) {
            log.error("ZMQ ingress loop failed", e);
        } finally {
            running.set(false);
        }
    }

    private void handleRawFrame(String machineId, String deviceId, byte[] payload) {
        RdsdFrameHeader header = RdsdFrameHeader.parse(payload);
        if (header == null || !header.hasMagic()) {
            return;
        }

        int dataOffset = RdsdFrameHeader.SIZE;
        int iqLen = (int) Math.min(header.payloadLen(), Math.max(0, payload.length - dataOffset));
        if (iqLen <= 0) {
            return;
        }

        byte[] iq = new byte[iqLen];
        System.arraycopy(payload, dataOffset, iq, 0, iqLen);

        RawIqFrame frame = new RawIqFrame(
                machineId,
                deviceId,
                header.timestampNs(),
                header.seq(),
                header.centerFreqHz(),
                header.sampleRateHz(),
                header.iqFormat(),
                iq
        );

        registry.onRawFrame(frame, header.deviceType());
        rawLabCaptures.onIqFrame(frame);
        detections.onIqFrame(frame);

        SpectrumFrame spectrumFrame = spectrum.onIqFrame(frame);
        if (spectrumFrame != null) {
            registry.onSpectrumFrame(spectrumFrame);
            safePublish(topic(machineId, deviceId, "spectrum"), spectrumCodec.encode(spectrumFrame));
        }

        // Raw path forwards native frame bytes as-is.
        safePublish(topic(machineId, deviceId, "rawfeed"), payload);
    }

    private void handleNativeSpectrum(String machineId, String deviceId, byte[] payload) {
        RdsdFrameHeader header = RdsdFrameHeader.parse(payload);

        float[] bins;
        long tsNs;
        long seq;
        long centerHz;
        long sampleRateHz;

        if (header != null && header.hasMagic()) {
            int off = RdsdFrameHeader.SIZE;
            int binsBytes = (int) Math.min(header.payloadLen(), Math.max(0, payload.length - off));
            bins = toFloatArray(payload, off, binsBytes);
            tsNs = header.timestampNs();
            seq = header.seq();
            centerHz = header.centerFreqHz();
            sampleRateHz = header.sampleRateHz();
        } else {
            bins = toFloatArray(payload, 0, payload.length);
            tsNs = System.nanoTime();
            seq = 0L;
            centerHz = 0L;
            sampleRateHz = 0L;
        }

        if (bins == null || bins.length == 0) {
            return;
        }

        SpectrumFrame frame = spectrum.fromNativeBins(
                machineId,
                deviceId,
                tsNs,
                seq,
                centerHz,
                sampleRateHz,
                bins
        );

        if (frame != null) {
            registry.onSpectrumFrame(frame);
            safePublish(topic(machineId, deviceId, "spectrum"), spectrumCodec.encode(frame));
        }
    }

    private void safePublish(String topic, byte[] payload) {
        try {
            streamHub.publish(topic, payload);
        } catch (Exception e) {
            // Stream publish errors must never terminate ZMQ ingress.
            log.debug("Stream publish failed topic={}", topic, e);
        }
    }

    private static float[] toFloatArray(byte[] payload, int offset, int bytesLen) {
        if (payload == null || bytesLen <= 0 || offset < 0 || offset >= payload.length) {
            return null;
        }
        int len = Math.min(bytesLen, payload.length - offset);
        if (len < 4) {
            return null;
        }
        len = len - (len % 4);
        ByteBuffer bb = ByteBuffer.wrap(payload, offset, len).order(ByteOrder.LITTLE_ENDIAN);
        int n = len / 4;
        float[] out = new float[n];
        for (int i = 0; i < n; i++) {
            out[i] = bb.getFloat();
        }
        return out;
    }

    private Map<String, Object> parseJson(byte[] payload) {
        try {
            String json = new String(payload, StandardCharsets.UTF_8);
            return om.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            return null;
        }
    }

    private static String topic(String machineId, String deviceId, String kind) {
        return machineId + "/" + deviceId + "/" + kind;
    }

    @Override
    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        if (worker != null) {
            try {
                worker.join(3000);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @Override
    public boolean isRunning() {
        return running.get();
    }

    @Override
    public int getPhase() {
        return 0;
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public void stop(Runnable callback) {
        stop();
        callback.run();
    }

    private record TopicParts(String machineId, String deviceId, String stream) {
        private static TopicParts parse(String topic, String fallbackMachineId) {
            if (topic == null || topic.isBlank()) {
                return null;
            }

            String[] parts = topic.split("/");
            if (parts.length < 2) {
                return null;
            }

            // <machineId>/<deviceId>/<stream>
            if (parts.length >= 3 && ("rawfeed".equals(parts[2]) || "spectrum".equals(parts[2]))) {
                return new TopicParts(parts[0], parts[1], parts[2]);
            }

            // <deviceId>/<stream>
            if ("rawfeed".equals(parts[1]) || "spectrum".equals(parts[1])) {
                return new TopicParts(fallbackMachineId == null || fallbackMachineId.isBlank() ? "unknown" : fallbackMachineId,
                        parts[0], parts[1]);
            }

            return null;
        }
    }
}
