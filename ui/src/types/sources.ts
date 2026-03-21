/**
 * Data Source and Radio types for the Spectrum Analyzer.
 * The frontend communicates via WebSocket to a backend bridge
 * that handles MQTT TCP/TLS connections.
 */

export type DataSource = {
  id: string;
  name: string;
  description?: string;
  transport: "ws"; // frontend transport - always WebSocket
  endpoint: string; // websocket endpoint to backend bridge, e.g. ws://localhost:8090/ws
  enabled: boolean;
  radios: RadioSource[];
};

export type RadioSource = {
  id: string;
  name: string;
  // backend uses these to subscribe to mqtt topics for this radio
  mqtt?: {
    spectrumTopic: string;
  };
  meta?: Record<string, unknown>;
};

export type SelectedRadio = {
  sourceId: string;
  radioId: string;
};
