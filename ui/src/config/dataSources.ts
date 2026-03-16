import type { DataSource, SelectedRadio, RadioSource } from "@/types/sources";
import type { DataSourceDto, HostDto } from "@/types/api";
import { isDisabledState, isEnabledState } from "@/types/api";

/**
 * Static data sources configuration (used as fallback for mock mode).
 * Each source represents a WebSocket bridge endpoint that connects to MQTT backend.
 */
export const DATA_SOURCES: DataSource[] = [];

const STORAGE_KEY = "sdr.selectedRadios.v1";

/**
 * Load selected radios from localStorage
 */
export function loadSelectedRadios(): SelectedRadio[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn("Failed to load selected radios from localStorage:", e);
  }
  return [];
}

/**
 * Save selected radios to localStorage
 */
export function saveSelectedRadios(selected: SelectedRadio[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  } catch (e) {
    console.warn("Failed to save selected radios to localStorage:", e);
  }
}

/**
 * Get a flat list of all radios across all enabled sources
 */
export function getAllRadios(): Array<{
  source: DataSource;
  radio: DataSource["radios"][0];
}> {
  return DATA_SOURCES.filter((s) => s.enabled).flatMap((source) =>
    source.radios.map((radio) => ({ source, radio }))
  );
}

/**
 * Find a data source by ID (searches in provided sources or falls back to static)
 */
export function getDataSource(
  sourceId: string,
  sources: DataSource[] = []
): DataSource | undefined {
  return sources.find((s) => s.id === sourceId);
}

// ==========================================
// Backend DTO Adapters
// ==========================================

/**
 * Convert a single backend DataSourceDto to frontend DataSource format.
 * Each backend datasource maps to one radio under a host-based source.
 * 
 * LiveState logic:
 * - OFFLINE, ERROR, UNKNOWN = disabled (radio greyed out)
 * - ONLINE, READY, CAPTURING = enabled (radio selectable)
 */
export function adaptDataSourceDto(dto: DataSourceDto): {
  hostKey: string;
  radio: RadioSource;
  wsEndpoint: string;
  enabled: boolean;
  state: string;
} {
  const wsEndpoint = dto.wsEndpoint
    ? `${dto.wsEndpoint}${dto.wsPath || ''}`
    : 'ws://localhost:8090/ws';

  const radio: RadioSource = {
    id: dto.id.toString(),
    name: dto.displayName,
    mqtt: dto.mqttTopic ? { spectrumTopic: dto.mqttTopic } : undefined,
    meta: {
      type: dto.deviceKey || dto.sourceType,
      deviceId: dto.deviceId,
      capabilities: dto.capabilities,
      lastSeenAt: dto.lastSeenAt,
      wsEndpoint: dto.wsEndpoint,
      wsPath: dto.wsPath,
      state: dto.state, // Preserve state for UI display
    },
  };

  return {
    hostKey: dto.hostKey || `host-${dto.hostId}`,
    radio,
    wsEndpoint,
    // Only disable if state is OFFLINE, ERROR, or UNKNOWN
    enabled: isEnabledState(dto.state),
    state: dto.state,
  };
}

/**
 * Group datasources by host to create the hierarchical DataSource structure.
 * Backend model: datasource = one stream from one device
 * Frontend model: DataSource (host) contains multiple RadioSource entries
 * 
 * Host enabling logic:
 * - If host itself is OFFLINE -> all radios disabled
 * - Otherwise, each radio follows its own state
 */
export function groupDataSourcesByHost(
  dtos: DataSourceDto[],
  hosts?: HostDto[]
): DataSource[] {
  const hostMap = new Map<string, DataSource>();
  const hostStateMap = new Map<string, string>();

  // Build host state lookup if hosts provided
  if (hosts) {
    for (const host of hosts) {
      hostStateMap.set(host.hostKey, host.state);
    }
  }

  for (const dto of dtos) {
    const adapted = adaptDataSourceDto(dto);
    const hostKey = adapted.hostKey;

    // Check if host is offline
    const hostState = hostStateMap.get(hostKey);
    const hostOffline = isDisabledState(hostState);

    if (!hostMap.has(hostKey)) {
      hostMap.set(hostKey, {
        id: hostKey,
        name: dto.hostKey || hostKey,
        description: `Datasources from ${hostKey}`,
        transport: 'ws',
        endpoint: adapted.wsEndpoint,
        // Host is enabled if not offline (allow user to refresh even if some radios are down)
        enabled: !hostOffline,
        radios: [],
      });
    }

    const source = hostMap.get(hostKey)!;
    
    // Add state info to radio meta for UI display
    const radioWithState: RadioSource = {
      ...adapted.radio,
      meta: {
        ...adapted.radio.meta,
        state: adapted.state,
        // Radio is disabled if host is offline OR radio state is disabled
        disabled: hostOffline || !adapted.enabled,
      },
    };
    
    source.radios.push(radioWithState);

    // If any radio is in an enabled state, keep host enabled
    if (adapted.enabled && !hostOffline) {
      source.enabled = true;
    }
  }

  return Array.from(hostMap.values());
}

/**
 * Get a radio from dynamic sources by sourceId and radioId
 */
export function getRadioFromSources(
  sources: DataSource[],
  sourceId: string,
  radioId: string
): RadioSource | undefined {
  const source = sources.find((s) => s.id === sourceId);
  return source?.radios.find((r) => r.id === radioId);
}
