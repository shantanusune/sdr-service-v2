import type { StreamClient, SpectrumMessage, StreamStatus } from "./StreamClient";
import { parseBinarySpectrumFrame, isBinaryData, blobToArrayBuffer } from "./binaryParser";

/**
 * WebSocket-based StreamClient implementation.
 * Connects to a backend bridge that handles MQTT TCP/TLS.
 * 
 * Supports both binary (ArrayBuffer) and JSON spectrum data.
 */
export class WebSocketStreamClient implements StreamClient {
  private ws: WebSocket | null = null;
  private endpoint: string;
  private sourceId: string;

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pendingSubscriptions: Set<string> = new Set();
  private activeSubscriptions: Set<string> = new Set();

  // Prevent reconnect + event leakage when user explicitly stops streaming
  private allowReconnect = true;

  private spectrumCallbacks: Array<(msg: SpectrumMessage) => void> = [];
  private statusCallbacks: Array<(status: StreamStatus) => void> = [];
  private errorCallbacks: Array<(error: { message: string; details?: unknown }) => void> = [];

  private currentStatus: StreamStatus = { connected: false };

  constructor(sourceId: string, endpoint: string) {
    this.sourceId = sourceId;
    this.endpoint = endpoint;
  }

  async connect(): Promise<void> {
    this.allowReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.endpoint);

        // Set binary type to arraybuffer for efficient binary handling
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          console.log(`[WS] Connected to ${this.endpoint}`);
          this.reconnectAttempts = 0;
          this.updateStatus({ connected: true, details: "Connected" });

          // Process pending subscriptions - add to active BEFORE sending
          this.pendingSubscriptions.forEach((key) => {
            this.activeSubscriptions.add(key);
            const [sourceId, radioId] = key.split(":");
            this.sendSubscribe(sourceId, radioId);
          });
          this.pendingSubscriptions.clear();

          resolve();
        };

        this.ws.onclose = (event) => {
          console.log(`[WS] Disconnected: ${event.code} ${event.reason}`);
          this.updateStatus({ connected: false, details: "Disconnected" });

          // If user explicitly stopped, do not auto-reconnect
          if (!this.allowReconnect) return;
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error(`[WS] Error:`, error);
          this.notifyError({ message: "WebSocket error" });
          reject(error);
        };

        this.ws.onmessage = async (event) => {
          await this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    // Explicit user stop: prevent reconnect + release timers/handlers
    this.allowReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const ws = this.ws;

    if (ws) {
      // Best-effort unsubscribe before closing
      if (ws.readyState === WebSocket.OPEN) {
        this.activeSubscriptions.forEach((key) => {
          const [sourceId, radioId] = key.split(":");
          try {
            ws.send(
              JSON.stringify({
                type: "unsubscribe",
                sourceId,
                radioId,
              })
            );
          } catch {
            // ignore
          }
        });
      }

      // Detach handlers to avoid leakage
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;

      try {
        ws.close(1000, "Client disconnect");
      } catch {
        // ignore
      }
    }

    this.ws = null;
    this.pendingSubscriptions.clear();
    this.activeSubscriptions.clear();

    // Release callback references (avoid memory leaks)
    this.spectrumCallbacks = [];
    this.statusCallbacks = [];
    this.errorCallbacks = [];

    this.updateStatus({ connected: false, details: "Disconnected by client" });
  }

  async subscribeSpectrum(sourceId: string, radioId: string): Promise<void> {
    const key = `${sourceId}:${radioId}`;

    if (this.activeSubscriptions.has(key) || this.pendingSubscriptions.has(key)) {
      return; // Already subscribed or pending
    }

    // Add to active immediately (even if socket isn't open yet) so
    // incoming binary frames can be attributed without racing subscription ACK.
    this.activeSubscriptions.add(key);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(sourceId, radioId);
    } else {
      // Queue for when connection is established
      this.pendingSubscriptions.add(key);
    }
  }

  async unsubscribeSpectrum(sourceId: string, radioId: string): Promise<void> {
    const key = `${sourceId}:${radioId}`;

    this.pendingSubscriptions.delete(key);
    this.activeSubscriptions.delete(key);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(sourceId, radioId);
    }
  }

  onSpectrum(cb: (msg: SpectrumMessage) => void): void {
    this.spectrumCallbacks.push(cb);
  }

  onStatus(cb: (status: StreamStatus) => void): void {
    this.statusCallbacks.push(cb);
  }

  onError(cb: (error: { message: string; details?: unknown }) => void): void {
    this.errorCallbacks.push(cb);
  }

  status(): StreamStatus {
    return this.currentStatus;
  }

  private sendSubscribe(sourceId: string, radioId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "subscribe",
          sourceId,
          radioId,
        })
      );
      console.log(`[WS] Subscribed to ${sourceId}:${radioId}`);
    }
  }

  private sendUnsubscribe(sourceId: string, radioId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "unsubscribe",
          sourceId,
          radioId,
        })
      );
      console.log(`[WS] Unsubscribed from ${sourceId}:${radioId}`);
    }
  }

  private async handleMessage(data: string | ArrayBuffer | Blob): Promise<void> {
    // Handle binary data (spectrum frames)
    if (isBinaryData(data)) {
      await this.handleBinaryMessage(data);
      return;
    }

    // Handle JSON messages (control messages)
    this.handleJsonMessage(data as string);
  }

  private async handleBinaryMessage(data: ArrayBuffer | Blob): Promise<void> {
    try {
      // Convert Blob to ArrayBuffer if needed
      const buffer = data instanceof Blob ? await blobToArrayBuffer(data) : data;
      
      const frame = parseBinarySpectrumFrame(buffer);
      if (!frame) {
        return;
      }

      // Get the active subscription to determine sourceId/radioId
      // If the server starts streaming immediately, active may be empty unless we pre-add it.
      const firstSub = this.activeSubscriptions.values().next().value ?? this.pendingSubscriptions.values().next().value;
      if (!firstSub) {
        console.warn(`[WS] Received binary data but no subscriptions (endpoint=${this.endpoint})`);
        return;
      }

      const [sourceId, radioId] = String(firstSub).split(':');

      this.spectrumCallbacks.forEach((cb) =>
        cb({
          sourceId,
          radioId,
          payload: frame,
        })
      );
    } catch (e) {
      console.error('[WS] Failed to handle binary message:', e);
    }
  }

  private handleJsonMessage(data: string): void {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case "spectrum":
          // JSON spectrum data (legacy or fallback format)
          this.spectrumCallbacks.forEach((cb) =>
            cb({
              sourceId: msg.sourceId,
              radioId: msg.radioId,
              payload: msg.payload,
            })
          );
          break;

        case "status":
          this.updateStatus({
            connected: msg.connected,
            details: msg.details,
          });
          break;

        case "error":
          this.notifyError({ message: msg.message });
          break;

        default:
          console.warn(`[WS] Unknown message type: ${msg.type}`);
      }
    } catch (e) {
      console.error(`[WS] Failed to parse JSON message:`, e);
    }
  }

  private updateStatus(status: StreamStatus): void {
    this.currentStatus = status;
    this.statusCallbacks.forEach((cb) => cb(status));
  }

  private notifyError(error: { message: string; details?: unknown }): void {
    this.errorCallbacks.forEach((cb) => cb(error));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[WS] Max reconnect attempts reached`);
      this.notifyError({ message: "Max reconnect attempts reached" });
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.updateStatus({ connected: false, details: `Reconnecting in ${delay}ms...` });

    this.reconnectTimer = setTimeout(() => {
      // Move active subscriptions to pending for re-subscription
      this.activeSubscriptions.forEach((key) => this.pendingSubscriptions.add(key));
      this.activeSubscriptions.clear();

      this.connect().catch((e) => {
        console.error(`[WS] Reconnect failed:`, e);
      });
    }, delay);
  }
}
