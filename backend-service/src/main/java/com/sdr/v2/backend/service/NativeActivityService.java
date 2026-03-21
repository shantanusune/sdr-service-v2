package com.sdr.v2.backend.service;

import com.sdr.v2.backend.domain.NativeActivityEvent;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class NativeActivityService {

    private final List<NativeActivityEvent> nativeEvents = new ArrayList<>();

    public synchronized void add(NativeActivityEvent event) {
        nativeEvents.add(0, event);
        while (nativeEvents.size() > 1000) {
            nativeEvents.remove(nativeEvents.size() - 1);
        }
    }

    public synchronized List<NativeActivityEvent> list() {
        return List.copyOf(nativeEvents);
    }
}
