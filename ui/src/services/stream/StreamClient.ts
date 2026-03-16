/**
 * StreamClient interface for spectrum data streaming.
 * Abstraction layer that uses WebSocket in the frontend.
 * The backend bridge handles MQTT TCP/TLS connections.
 */

export interface SpectrumMessage {
  sourceId: string;
  radioId: string;
  payload: unknown;
}

export interface StreamStatus {
  connected: boolean;
  details?: string;
}

export interface StreamClient {
  /**
   * Connect to the streaming endpoint
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the streaming endpoint
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to spectrum data for a specific radio
   */
  subscribeSpectrum(sourceId: string, radioId: string): Promise<void>;

  /**
   * Unsubscribe from spectrum data for a specific radio
   */
  unsubscribeSpectrum(sourceId: string, radioId: string): Promise<void>;

  /**
   * Register callback for spectrum data
   */
  onSpectrum(cb: (msg: SpectrumMessage) => void): void;

  /**
   * Register callback for status updates
   */
  onStatus(cb: (status: StreamStatus) => void): void;

  /**
   * Register callback for errors
   */
  onError(cb: (error: { message: string; details?: unknown }) => void): void;

  /**
   * Get current connection status
   */
  status(): StreamStatus;
}
