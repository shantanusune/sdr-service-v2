package com.sdr.v2.backend.infrastructure.feed;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sdr.v2.backend.domain.SpectrumFrame;
import com.sdr.v2.backend.ports.SpectrumFeedPort;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SpectrumFeedHub implements SpectrumFeedPort {

    private static final Logger log = LoggerFactory.getLogger(SpectrumFeedHub.class);

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError((err) -> emitters.remove(emitter));
        return emitter;
    }

    @Override
    public void publish(SpectrumFrame frame) {
        String payload;
        try {
            payload = objectMapper.writeValueAsString(frame);
        } catch (Exception e) {
            log.debug("Failed to serialize spectrum frame", e);
            return;
        }

        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(SseEmitter.event().name("spectrum").data(payload));
            } catch (Exception e) {
                emitters.remove(emitter);
                try {
                    emitter.complete();
                } catch (Exception ignored) {
                    // Ignore completion races for closed/errored async contexts.
                }
            }
        }
    }
}
