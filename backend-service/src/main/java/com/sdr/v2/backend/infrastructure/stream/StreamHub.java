package com.sdr.v2.backend.infrastructure.stream;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class StreamHub {

    private final ConcurrentHashMap<String, Set<WebSocketSession>> topicToSessions = new ConcurrentHashMap<>();

    public void addSubscriber(String topic, WebSocketSession session) {
        topicToSessions.computeIfAbsent(topic, ignored -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void removeSubscriber(String topic, WebSocketSession session) {
        Set<WebSocketSession> set = topicToSessions.get(topic);
        if (set == null) {
            return;
        }
        set.remove(session);
        if (set.isEmpty()) {
            topicToSessions.remove(topic);
        }
    }

    public void publish(String topic, byte[] payload) {
        Set<WebSocketSession> subscribers = topicToSessions.get(topic);
        if (subscribers == null || subscribers.isEmpty()) {
            return;
        }

        BinaryMessage msg = new BinaryMessage(payload);
        for (WebSocketSession session : subscribers) {
            if (!session.isOpen()) {
                removeSubscriber(topic, session);
                continue;
            }
            try {
                session.sendMessage(msg);
            } catch (IOException ignored) {
                removeSubscriber(topic, session);
            }
        }
    }
}
