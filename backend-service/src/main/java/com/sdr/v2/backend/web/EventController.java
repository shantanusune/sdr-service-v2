package com.sdr.v2.backend.web;

import com.sdr.v2.backend.service.DetectionEventService;
import com.sdr.v2.backend.service.NativeActivityService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping({"/api/v1/events", "/api/events"})
public class EventController {

    private final DetectionEventService detections;
    private final NativeActivityService nativeActivity;

    public EventController(DetectionEventService detections, NativeActivityService nativeActivity) {
        this.detections = detections;
        this.nativeActivity = nativeActivity;
    }

    @GetMapping
    public Map<String, List<?>> list() {
        Map<String, List<?>> out = new HashMap<>();
        out.put("detections", detections.list());
        out.put("nativeActivity", nativeActivity.list());
        return out;
    }

    @DeleteMapping
    public Map<String, Integer> clear() {
        int clearedDetections = detections.clear();
        int clearedNativeActivity = nativeActivity.clear();

        Map<String, Integer> out = new HashMap<>();
        out.put("clearedDetections", clearedDetections);
        out.put("clearedNativeActivity", clearedNativeActivity);
        return out;
    }
}
