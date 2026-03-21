package com.sdr.v2.backend.infrastructure.stream;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;

@Component
public class StreamWebSocketHandler extends TextWebSocketHandler {

    private final StreamHub hub;
    private final ObjectMapper om = new ObjectMapper();

    public StreamWebSocketHandler(StreamHub hub) {
        this.hub = hub;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String topic = topicFromSessionPath(session);
        if (topic == null) {
            session.close(CloseStatus.BAD_DATA);
            return;
        }
        session.getAttributes().put("mqttTopic", topic);
        hub.addSubscriber(topic, session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        // For compatibility with clients sending subscribe/unsubscribe control messages.
        // Path-based subscription is already bound on connection, so these are ignored.
        try {
            om.readValue(message.getPayload(), Map.class);
        } catch (Exception ignored) {
            // Ignore malformed text payloads from client side.
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object topic = session.getAttributes().get("mqttTopic");
        if (topic instanceof String t) {
            hub.removeSubscriber(t, session);
        }
    }

    private String topicFromSessionPath(WebSocketSession session) {
        if (session.getUri() == null) {
            return null;
        }
        String[] p = session.getUri().getPath().split("/");
        if (p.length < 6) {
            return null;
        }

        String machineIp = p[p.length - 3];
        String deviceId = p[p.length - 2];
        String kind = p[p.length - 1];
        if (!"spectrum".equals(kind) && !"rawfeed".equals(kind)) {
            return null;
        }
        return machineIp + "/" + deviceId + "/" + kind;
    }
}
