package com.sdr.v2.backend.infrastructure.websocket;

import com.sdr.v2.backend.infrastructure.stream.StreamWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final StreamWebSocketHandler handler;

    public WebSocketConfig(StreamWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry
                .addHandler(handler, "/ws/stream/{machineIp}/{deviceId}/{kind}", "/ws/stream/**")
                .setAllowedOriginPatterns("*");
    }
}
