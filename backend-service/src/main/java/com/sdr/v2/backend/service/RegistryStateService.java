package com.sdr.v2.backend.service;

import com.sdr.v2.backend.config.AppProperties;
import com.sdr.v2.backend.domain.RawIqFrame;
import com.sdr.v2.backend.domain.SpectrumFrame;
import com.sdr.v2.backend.web.dto.DataSourceDto;
import com.sdr.v2.backend.web.dto.HostDto;
import com.sdr.v2.backend.web.dto.RadioDeviceDto;
import com.sdr.v2.backend.web.dto.RegistryCatalogDto;
import com.sdr.v2.backend.web.dto.ServiceInfoDto;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class RegistryStateService {

    private static final String STATE_ONLINE = "ONLINE";
    private static final String STATE_READY = "READY";
    private static final String STATE_CAPTURING = "CAPTURING";
    private static final String STATE_OFFLINE = "OFFLINE";
    private static final String STATE_ERROR = "ERROR";
    private static final String STATE_UNKNOWN = "UNKNOWN";

    private static final class HostEntry {
        long id;
        String hostKey;
        String hostName;
        String ipAddress;
        String osName;
        String osVersion;
        String arch;
        String agentVersion;
        String state;
        Instant lastSeenAt;
        Map<String, Object> latestServiceMeta = new LinkedHashMap<>();
    }

    private static final class DeviceEntry {
        long id;
        long hostId;
        String hostKey;
        String deviceKey;
        String deviceType;
        String serialNumber;
        String state;
        Instant lastSeenAt;
        long centerFreqHz;
        long sampleRateHz;
        Map<String, Object> meta = new LinkedHashMap<>();
    }

    private static final class DataSourceEntry {
        long id;
        String sourceKey;
        String sourceType;
        String displayName;
        String state;
        String mqttTopic;
        long hostId;
        String hostKey;
        Long deviceId;
        String deviceKey;
        Map<String, Object> capabilities = new LinkedHashMap<>();
        Instant lastSeenAt;
    }

    private static final class TopicEntry {
        long id;
        String hostKey;
        String topic;
        String direction;
        boolean enabled;
    }

    private final AppProperties props;
    private final WsEndpointBuilder wsBuilder;

    private final AtomicLong hostIdSeq = new AtomicLong(1);
    private final AtomicLong deviceIdSeq = new AtomicLong(1);
    private final AtomicLong dataSourceIdSeq = new AtomicLong(1);
    private final AtomicLong topicIdSeq = new AtomicLong(1);

    private final LinkedHashMap<String, HostEntry> hostsByKey = new LinkedHashMap<>();
    private final LinkedHashMap<Long, HostEntry> hostsById = new LinkedHashMap<>();
    private final LinkedHashMap<String, DeviceEntry> devicesByHostAndDevice = new LinkedHashMap<>();
    private final LinkedHashMap<Long, DeviceEntry> devicesById = new LinkedHashMap<>();
    private final LinkedHashMap<String, DataSourceEntry> dataSourcesByKey = new LinkedHashMap<>();
    private final LinkedHashMap<String, TopicEntry> topicsByUnique = new LinkedHashMap<>();

    public RegistryStateService(AppProperties props, WsEndpointBuilder wsBuilder) {
        this.props = props;
        this.wsBuilder = wsBuilder;
    }

    public synchronized void onMeta(String machineId, String topic, Map<String, Object> body) {
        HostEntry host = ensureHost(machineId);
        touchHost(host);

        if ("meta/host".equals(topic)) {
            host.hostName = firstString(body.get("hostname"), host.hostName, machineId);
            host.ipAddress = firstString(body.get("machineIp"), host.ipAddress, machineId);
            host.osName = firstString(body.get("os"), host.osName, "");
            host.osVersion = firstString(body.get("kernel"), host.osVersion, "");
            host.arch = firstString(body.get("arch"), host.arch, "");
            host.state = STATE_ONLINE;
            return;
        }

        if ("meta/service".equals(topic)) {
            String service = firstString(body.get("service"), "sdr_service");
            String status = firstString(body.get("status"), "RUNNING").toUpperCase(Locale.ROOT);
            String dsState = "STOPPED".equals(status) ? STATE_OFFLINE : STATE_ONLINE;
            upsertDataSource(
                    "service:" + host.hostKey + ":" + service,
                    "HOST",
                    "SDR Service",
                    dsState,
                    host.hostKey + "/meta/service",
                    host,
                    null,
                    Map.of("status", true)
            );
            host.latestServiceMeta = new LinkedHashMap<>(body);
            return;
        }

        if ("meta/devices".equals(topic)) {
            handleDevicesMeta(host, body);
            return;
        }

        if ("meta/topics".equals(topic)) {
            handleTopicsMeta(host, body);
            return;
        }

        if ("meta/usb".equals(topic)) {
            handleUsbMeta(host, body);
        }
    }

    public synchronized void onRawFrame(RawIqFrame frame, int deviceType) {
        HostEntry host = ensureHost(frame.machineId());
        touchHost(host);

        DeviceEntry device = ensureDevice(host, frame.deviceId());
        device.deviceType = deviceTypeName(deviceType);
        device.state = STATE_CAPTURING;
        device.centerFreqHz = frame.centerFreqHz();
        device.sampleRateHz = frame.sampleRateHz();
        device.lastSeenAt = Instant.now();

        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":rawfeed",
                "DEVICE",
                device.deviceKey + " Rawfeed",
                device.state,
                host.hostKey + "/" + device.deviceKey + "/rawfeed",
                host,
                device,
                Map.of("rawfeed", true)
        );

        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":spectrum",
                "DEVICE",
                device.deviceKey + " Spectrum",
                device.state,
                host.hostKey + "/" + device.deviceKey + "/spectrum",
                host,
                device,
                Map.of("spectrum", true)
        );
    }

    public synchronized void onSpectrumFrame(SpectrumFrame frame) {
        HostEntry host = ensureHost(frame.machineId());
        touchHost(host);

        DeviceEntry device = ensureDevice(host, frame.deviceId());
        if (!STATE_ERROR.equals(device.state)) {
            device.state = STATE_CAPTURING;
        }
        device.centerFreqHz = frame.centerFreqHz();
        device.sampleRateHz = frame.sampleRateHz();
        device.lastSeenAt = Instant.now();

        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":spectrum",
                "DEVICE",
                device.deviceKey + " Spectrum",
                device.state,
                host.hostKey + "/" + device.deviceKey + "/spectrum",
                host,
                device,
                Map.of("spectrum", true)
        );
    }

    public synchronized List<HostDto> listHosts() {
        return hostsById.values().stream().map(this::toHostDto).toList();
    }

    public synchronized HostDto getHost(long id) {
        HostEntry host = hostsById.get(id);
        if (host == null) {
            return null;
        }
        return toHostDto(host);
    }

    public synchronized List<RadioDeviceDto> listDevicesByHost(long hostId) {
        return devicesById.values().stream()
                .filter(d -> d.hostId == hostId)
                .map(this::toDeviceDto)
                .toList();
    }

    public synchronized List<DataSourceDto> listDataSources(String state, String wsBase) {
        return dataSourcesByKey.values().stream()
                .filter(ds -> state == null || state.isBlank() || state.equalsIgnoreCase(ds.state))
                .map(ds -> toDataSourceDto(ds, wsBase))
                .toList();
    }

    public synchronized List<DataSourceDto> listStreamableDataSources(String wsBase) {
        return dataSourcesByKey.values().stream()
                .map(ds -> toDataSourceDto(ds, wsBase))
                .filter(ds -> ds.wsPath() != null)
                .toList();
    }

    public synchronized List<ServiceInfoDto> listServices() {
        List<ServiceInfoDto> out = new ArrayList<>();
        for (HostEntry host : hostsById.values()) {
            ServiceInfoDto fallback = null;
            for (DataSourceEntry ds : dataSourcesByKey.values()) {
                if (ds.hostId != host.id) {
                    continue;
                }
                if (!ds.sourceKey.startsWith("service:")) {
                    continue;
                }
                ServiceInfoDto info = new ServiceInfoDto(
                        host.hostKey,
                        host.hostName,
                        ds.sourceKey,
                        ds.state,
                        ds.mqttTopic,
                        host.latestServiceMeta == null ? Map.of() : Collections.unmodifiableMap(host.latestServiceMeta)
                );
                fallback = info;
                out.add(info);
            }
            if (fallback == null && host.latestServiceMeta != null && !host.latestServiceMeta.isEmpty()) {
                out.add(new ServiceInfoDto(
                        host.hostKey,
                        host.hostName,
                        "service:" + host.hostKey + ":sdr_service",
                        firstString(host.latestServiceMeta.get("status"), STATE_UNKNOWN),
                        host.hostKey + "/meta/service",
                        Collections.unmodifiableMap(host.latestServiceMeta)
                ));
            }
        }
        return out;
    }

    public synchronized RegistryCatalogDto catalog(String wsBase) {
        List<RegistryCatalogDto.HostCatalog> hosts = hostsById.values().stream()
                .map(h -> toHostCatalog(h, wsBase))
                .toList();

        return new RegistryCatalogDto(
                Map.of("broker", "internal-zmq", "rootTopic", "#"),
                Map.of(
                        "baseUrl", wsBase,
                        "spectrumPathTemplate", "/ws/stream/{machineIp}/{deviceId}/spectrum",
                        "rawfeedPathTemplate", "/ws/stream/{machineIp}/{deviceId}/rawfeed"
                ),
                hosts,
                Instant.now()
        );
    }

    public synchronized RegistryCatalogDto.HostCatalog hostCatalog(long hostId, String wsBase) {
        HostEntry host = hostsById.get(hostId);
        if (host == null) {
            return null;
        }
        return toHostCatalog(host, wsBase);
    }

    @Scheduled(fixedDelay = 10000)
    public synchronized void markOffline() {
        long offlineAfterMs = Math.max(5000L, props.getRegistry().getOfflineAfterMs());
        Instant cutoff = Instant.now().minusMillis(offlineAfterMs);

        for (HostEntry host : hostsById.values()) {
            if (host.lastSeenAt != null && host.lastSeenAt.isBefore(cutoff)) {
                host.state = STATE_OFFLINE;
            }
        }

        for (DeviceEntry device : devicesById.values()) {
            if (device.lastSeenAt != null && device.lastSeenAt.isBefore(cutoff) && !STATE_ERROR.equals(device.state)) {
                device.state = STATE_OFFLINE;
            }
        }

        for (DataSourceEntry ds : dataSourcesByKey.values()) {
            if (ds.lastSeenAt != null && ds.lastSeenAt.isBefore(cutoff) && !STATE_ERROR.equals(ds.state)) {
                ds.state = STATE_OFFLINE;
            }
        }
    }

    private RegistryCatalogDto.HostCatalog toHostCatalog(HostEntry host, String wsBase) {
        List<RegistryCatalogDto.DeviceCatalog> devices = devicesById.values().stream()
                .filter(d -> d.hostId == host.id)
                .map(d -> new RegistryCatalogDto.DeviceCatalog(
                        d.id,
                        d.deviceKey,
                        d.deviceType,
                        d.serialNumber,
                        d.state,
                        d.lastSeenAt,
                        Collections.unmodifiableMap(d.meta)
                ))
                .toList();

        List<RegistryCatalogDto.DataSourceCatalog> dataSources = dataSourcesByKey.values().stream()
                .filter(ds -> ds.hostId == host.id)
                .map(ds -> {
                    DataSourceDto dto = toDataSourceDto(ds, wsBase);
                    return new RegistryCatalogDto.DataSourceCatalog(
                            dto.id(),
                            dto.sourceKey(),
                            dto.sourceType(),
                            dto.displayName(),
                            dto.state(),
                            dto.mqttTopic(),
                            dto.wsEndpoint(),
                            dto.wsPath(),
                            dto.capabilities()
                    );
                })
                .toList();

        List<RegistryCatalogDto.ServiceCatalog> services = dataSources.stream()
                .filter(ds -> ds.sourceKey() != null && ds.sourceKey().startsWith("service:"))
                .map(ds -> new RegistryCatalogDto.ServiceCatalog(
                        ds.sourceKey(),
                        ds.displayName(),
                        ds.state(),
                        ds.mqttTopic(),
                        host.latestServiceMeta == null ? Map.of() : Collections.unmodifiableMap(host.latestServiceMeta)
                ))
                .toList();

        List<RegistryCatalogDto.TopicCatalog> topics = topicsByUnique.values().stream()
                .filter(t -> Objects.equals(t.hostKey, host.hostKey))
                .map(t -> new RegistryCatalogDto.TopicCatalog(t.id, t.topic, t.direction, t.enabled))
                .toList();

        return new RegistryCatalogDto.HostCatalog(
                host.id,
                host.hostKey,
                host.hostName,
                host.ipAddress,
                host.state,
                host.lastSeenAt,
                services,
                devices,
                dataSources,
                topics
        );
    }

    private HostDto toHostDto(HostEntry host) {
        return new HostDto(
                host.id,
                host.hostKey,
                host.hostName,
                host.ipAddress,
                host.osName,
                host.osVersion,
                host.arch,
                host.agentVersion,
                host.state,
                host.lastSeenAt
        );
    }

    private RadioDeviceDto toDeviceDto(DeviceEntry device) {
        return new RadioDeviceDto(
                device.id,
                device.hostId,
                device.hostKey,
                device.deviceKey,
                device.deviceType,
                device.serialNumber,
                device.state,
                device.lastSeenAt,
                Collections.unmodifiableMap(device.meta)
        );
    }

    private DataSourceDto toDataSourceDto(DataSourceEntry ds, String wsBase) {
        String wsPath = wsBuilder.wsPathFor(ds.mqttTopic);
        return new DataSourceDto(
                ds.id,
                ds.sourceKey,
                ds.sourceType,
                ds.displayName,
                ds.state,
                ds.mqttTopic,
                ds.hostId,
                ds.hostKey,
                ds.deviceId,
                ds.deviceKey,
                Collections.unmodifiableMap(ds.capabilities),
                wsPath == null ? null : wsBase,
                wsPath,
                ds.lastSeenAt
        );
    }

    private void handleDevicesMeta(HostEntry host, Map<String, Object> body) {
        Instant now = Instant.now();
        Map<String, Boolean> seenConnected = new LinkedHashMap<>();
        List<?> connected = asList(body.get("connected"));
        for (Object item : connected) {
            Map<String, Object> deviceJson = asMap(item);
            if (deviceJson == null) {
                continue;
            }
            String deviceId = firstString(deviceJson.get("id"), "");
            if (deviceId.isBlank()) {
                continue;
            }
            seenConnected.put(deviceId, Boolean.TRUE);

            DeviceEntry device = ensureDevice(host, deviceId);
            device.deviceType = firstString(deviceJson.get("type"), device.deviceType, STATE_UNKNOWN);
            device.serialNumber = extractSerial(deviceJson);

            Map<String, Object> state = firstMap(deviceJson.get("state"));
            boolean open = bool(first(state, "open"), true);
            boolean rx = bool(first(state, "rxRunning", "rx"), false);
            long cf = asLong(first(state, "centerFreqHz", "centerHz"), device.centerFreqHz);
            long sr = asLong(first(state, "sampleRateHz", "srHz"), device.sampleRateHz);

            device.centerFreqHz = cf;
            device.sampleRateHz = sr;
            device.lastSeenAt = now;
            device.state = rx ? STATE_CAPTURING : (open ? STATE_READY : STATE_OFFLINE);

            Map<String, Object> meta = new LinkedHashMap<>();
            Map<String, Object> caps = firstMap(deviceJson.get("capabilities"), deviceJson.get("caps"));
            if (caps != null) {
                meta.put("capabilities", caps);
            }
            meta.put("state", state == null ? Map.of() : state);
            Map<String, Object> usb = firstMap(deviceJson.get("usb"));
            if (usb != null) {
                meta.put("usb", usb);
            }
            device.meta = meta;

            syncDeviceDataSources(host, device);
        }

        List<?> failed = asList(body.get("failed"));
        for (Object item : failed) {
            Map<String, Object> failedJson = asMap(item);
            if (failedJson == null) {
                continue;
            }
            String deviceId = firstString(failedJson.get("id"), "");
            if (deviceId.isBlank()) {
                continue;
            }
            DeviceEntry device = ensureDevice(host, deviceId);
            device.deviceType = firstString(failedJson.get("type"), device.deviceType, STATE_UNKNOWN);
            device.state = STATE_ERROR;
            device.lastSeenAt = now;
            device.meta = Map.of("error", firstString(failedJson.get("error"), "device error"));
            syncDeviceDataSources(host, device);
        }

        if (bool(body.get("full"), false)) {
            for (DeviceEntry device : devicesById.values()) {
                if (!Objects.equals(device.hostKey, host.hostKey)) {
                    continue;
                }
                if (seenConnected.containsKey(device.deviceKey)) {
                    continue;
                }
                if (STATE_ERROR.equals(device.state)) {
                    continue;
                }

                device.state = STATE_OFFLINE;
                device.lastSeenAt = now;
                syncDeviceDataSources(host, device);
            }
        }
    }

    private void handleTopicsMeta(HostEntry host, Map<String, Object> body) {
        List<String> publishTopics = asStringList(first(body, "publish", "pub"));
        for (String rel : publishTopics) {
            if (rel == null || rel.isBlank()) {
                continue;
            }
            String full = host.hostKey + "/" + rel;
            upsertTopic(host.hostKey, full, "PUB", true);
            maybeCreateDataSourceFromTopic(host, rel);
        }

        List<String> subscribeTopics = asStringList(first(body, "subscribe", "sub"));
        for (String rel : subscribeTopics) {
            if (rel == null || rel.isBlank()) {
                continue;
            }
            String full = host.hostKey + "/" + rel;
            upsertTopic(host.hostKey, full, "SUB", true);
        }
    }

    private void handleUsbMeta(HostEntry host, Map<String, Object> body) {
        String event = firstString(body.get("event"), "").toUpperCase(Locale.ROOT);
        String deviceKey = firstString(body.get("deviceId"), firstString(body.get("key"), ""));
        if (deviceKey.isBlank()) {
            return;
        }

        DeviceEntry device = ensureDevice(host, deviceKey);
        device.lastSeenAt = Instant.now();
        String serial = firstString(body.get("serial"), "");
        if (serial.isBlank()) {
            Map<String, Object> usb = firstMap(body.get("usb"));
            serial = firstString(first(usb, "serial"), "");
        }
        if (!serial.isBlank()) {
            device.serialNumber = serial;
        }

        String typeFromDriver = driverTypeName(firstString(body.get("driver"), ""));
        if (!STATE_UNKNOWN.equals(typeFromDriver)) {
            device.deviceType = typeFromDriver;
        }

        Map<String, Object> nextMeta = new LinkedHashMap<>(device.meta == null ? Map.of() : device.meta);
        nextMeta.put("usb", new LinkedHashMap<>(body));
        device.meta = nextMeta;

        if ("REMOVED".equals(event) || "DETACHED".equals(event) || "DISCONNECTED".equals(event)) {
            device.state = STATE_OFFLINE;
        } else if ("ADDED".equals(event) || "ATTACHED".equals(event) || "CONNECTED".equals(event)) {
            if (!STATE_CAPTURING.equals(device.state)) {
                device.state = STATE_READY;
            }
        }

        syncDeviceDataSources(host, device);
    }

    private void syncDeviceDataSources(HostEntry host, DeviceEntry device) {
        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":spectrum",
                "DEVICE",
                device.deviceKey + " Spectrum",
                device.state,
                host.hostKey + "/" + device.deviceKey + "/spectrum",
                host,
                device,
                Map.of("spectrum", true)
        );

        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":rawfeed",
                "DEVICE",
                device.deviceKey + " Rawfeed",
                device.state,
                host.hostKey + "/" + device.deviceKey + "/rawfeed",
                host,
                device,
                Map.of("rawfeed", true)
        );
    }

    private void maybeCreateDataSourceFromTopic(HostEntry host, String relTopic) {
        if (!relTopic.contains("/")) {
            return;
        }
        String[] p = relTopic.split("/");
        if (p.length < 2) {
            return;
        }
        String deviceId = p[0];
        String kind = p[1];
        if (!"spectrum".equals(kind) && !"rawfeed".equals(kind)) {
            return;
        }

        DeviceEntry device = ensureDevice(host, deviceId);
        String cap = "spectrum".equals(kind) ? "spectrum" : "rawfeed";
        upsertDataSource(
                "device:" + host.hostKey + ":" + device.deviceKey + ":" + kind,
                "DEVICE",
                device.deviceKey + ("spectrum".equals(kind) ? " Spectrum" : " Rawfeed"),
                device.state,
                host.hostKey + "/" + device.deviceKey + "/" + kind,
                host,
                device,
                Map.of(cap, true)
        );
    }

    private HostEntry ensureHost(String machineId) {
        String hostKey = (machineId == null || machineId.isBlank()) ? "unknown" : machineId;
        HostEntry host = hostsByKey.get(hostKey);
        if (host != null) {
            return host;
        }

        host = new HostEntry();
        host.id = hostIdSeq.getAndIncrement();
        host.hostKey = hostKey;
        host.hostName = hostKey;
        host.ipAddress = hostKey;
        host.osName = "";
        host.osVersion = "";
        host.arch = "";
        host.agentVersion = "";
        host.state = STATE_ONLINE;
        host.lastSeenAt = Instant.now();

        hostsByKey.put(hostKey, host);
        hostsById.put(host.id, host);
        return host;
    }

    private DeviceEntry ensureDevice(HostEntry host, String deviceKey) {
        String key = host.hostKey + "/" + deviceKey;
        DeviceEntry device = devicesByHostAndDevice.get(key);
        if (device != null) {
            return device;
        }

        device = new DeviceEntry();
        device.id = deviceIdSeq.getAndIncrement();
        device.hostId = host.id;
        device.hostKey = host.hostKey;
        device.deviceKey = deviceKey;
        device.deviceType = STATE_UNKNOWN;
        device.serialNumber = "";
        device.state = STATE_UNKNOWN;
        device.lastSeenAt = Instant.now();

        devicesByHostAndDevice.put(key, device);
        devicesById.put(device.id, device);
        return device;
    }

    private void upsertDataSource(String sourceKey,
                                  String sourceType,
                                  String displayName,
                                  String state,
                                  String mqttTopic,
                                  HostEntry host,
                                  DeviceEntry device,
                                  Map<String, Object> capabilities) {
        DataSourceEntry ds = dataSourcesByKey.get(sourceKey);
        if (ds == null) {
            ds = new DataSourceEntry();
            ds.id = dataSourceIdSeq.getAndIncrement();
            ds.sourceKey = sourceKey;
            dataSourcesByKey.put(sourceKey, ds);
        }

        ds.sourceType = sourceType;
        ds.displayName = displayName;
        ds.state = normalizeState(state);
        ds.mqttTopic = mqttTopic;
        ds.hostId = host.id;
        ds.hostKey = host.hostKey;
        ds.deviceId = (device == null) ? null : device.id;
        ds.deviceKey = (device == null) ? null : device.deviceKey;
        ds.capabilities = new LinkedHashMap<>(capabilities == null ? Map.of() : capabilities);
        ds.lastSeenAt = Instant.now();
    }

    private void upsertTopic(String hostKey, String topic, String direction, boolean enabled) {
        String uniqueKey = hostKey + "|" + topic + "|" + direction;
        TopicEntry entry = topicsByUnique.get(uniqueKey);
        if (entry == null) {
            entry = new TopicEntry();
            entry.id = topicIdSeq.getAndIncrement();
            entry.hostKey = hostKey;
            entry.topic = topic;
            entry.direction = direction;
            entry.enabled = enabled;
            topicsByUnique.put(uniqueKey, entry);
            return;
        }
        entry.enabled = enabled;
    }

    private void touchHost(HostEntry host) {
        host.lastSeenAt = Instant.now();
        if (!STATE_ERROR.equals(host.state)) {
            host.state = STATE_ONLINE;
        }
    }

    private static String deviceTypeName(int deviceType) {
        return switch (deviceType) {
            case 1 -> "HACKRF";
            case 0 -> "RTLSDR";
            default -> STATE_UNKNOWN;
        };
    }

    private static String driverTypeName(String driver) {
        if (driver == null || driver.isBlank()) {
            return STATE_UNKNOWN;
        }
        String upper = driver.toUpperCase(Locale.ROOT);
        if (upper.contains("HACKRF")) {
            return "HACKRF";
        }
        if (upper.contains("RTL")) {
            return "RTLSDR";
        }
        return STATE_UNKNOWN;
    }

    private static String normalizeState(String state) {
        if (state == null || state.isBlank()) {
            return STATE_UNKNOWN;
        }
        String upper = state.toUpperCase(Locale.ROOT);
        return switch (upper) {
            case STATE_ONLINE, STATE_READY, STATE_CAPTURING, STATE_OFFLINE, STATE_ERROR -> upper;
            default -> STATE_UNKNOWN;
        };
    }

    private static String extractSerial(Map<String, Object> deviceJson) {
        Map<String, Object> usb = firstMap(deviceJson.get("usb"));
        if (usb != null) {
            return firstString(usb.get("serial"), "");
        }
        return "";
    }

    private static List<?> asList(Object value) {
        if (value instanceof List<?> list) {
            return list;
        }
        return List.of();
    }

    private static List<String> asStringList(Object value) {
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<String> out = new ArrayList<>(list.size());
        for (Object item : list) {
            String s = asString(item);
            if (s != null) {
                out.add(s);
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return null;
    }

    private static Map<String, Object> firstMap(Object... values) {
        for (Object v : values) {
            Map<String, Object> map = asMap(v);
            if (map != null) {
                return map;
            }
        }
        return null;
    }

    private static Object first(Map<String, Object> map, String... keys) {
        if (map == null) {
            return null;
        }
        for (String key : keys) {
            if (map.containsKey(key)) {
                return map.get(key);
            }
        }
        return null;
    }

    private static String firstString(Object value, String fallback) {
        String s = asString(value);
        return (s == null || s.isBlank()) ? fallback : s;
    }

    private static String firstString(Object value, String fallback, String fallback2) {
        String s = asString(value);
        if (s != null && !s.isBlank()) {
            return s;
        }
        if (fallback != null && !fallback.isBlank()) {
            return fallback;
        }
        return fallback2;
    }

    private static String asString(Object value) {
        return (value == null) ? null : value.toString();
    }

    private static long asLong(Object value, long fallback) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        if (value instanceof String s) {
            try {
                return Long.parseLong(s.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static boolean bool(Object value, boolean fallback) {
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof String s) {
            return Boolean.parseBoolean(s);
        }
        return fallback;
    }
}
