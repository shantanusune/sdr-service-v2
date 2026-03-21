package com.sdr.v2.backend.web;

import com.sdr.v2.backend.infrastructure.feed.SpectrumFeedHub;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1/stream")
public class SpectrumStreamController {

    private final SpectrumFeedHub hub;

    public SpectrumStreamController(SpectrumFeedHub hub) {
        this.hub = hub;
    }

    @GetMapping(path = "/spectrum", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter spectrum() {
        return hub.subscribe();
    }
}
