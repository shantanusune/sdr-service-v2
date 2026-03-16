package com.sdr.v2.backend.service;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

@Component
public class WsEndpointBuilder {

    public String buildWsBaseUrl(HttpServletRequest request) {
        String proto = headerOr(request, "X-Forwarded-Proto", request.getScheme());
        String host = headerOr(request, "X-Forwarded-Host", request.getServerName());
        String port = headerOr(request, "X-Forwarded-Port", String.valueOf(request.getServerPort()));

        boolean secure = "https".equalsIgnoreCase(proto);
        String wsScheme = secure ? "wss" : "ws";
        String authority = host.contains(":") ? host : host + ":" + port;
        return wsScheme + "://" + authority + "/ws/stream/";
    }

    public String wsPathFor(String mqttTopic) {
        if (mqttTopic == null || mqttTopic.isBlank()) {
            return null;
        }
        String[] p = mqttTopic.split("/");
        if (p.length < 3) {
            return null;
        }
        String kind = p[2];
        if (!"spectrum".equals(kind) && !"rawfeed".equals(kind)) {
            return null;
        }
        return p[0] + "/" + p[1] + "/" + kind;
    }

    private static String headerOr(HttpServletRequest req, String name, String fallback) {
        String v = req.getHeader(name);
        return (v == null || v.isBlank()) ? fallback : v;
    }
}
