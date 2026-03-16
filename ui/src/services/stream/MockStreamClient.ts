import type { StreamClient, SpectrumMessage, StreamStatus } from "./StreamClient";

/**
 * Mock StreamClient for UI testing when WebSocket is unavailable.
 * Generates synthetic spectrum frames every 250ms.
 */
export class MockStreamClient implements StreamClient {
  private sourceId: string;
  private connected = false;
  private intervalHandles: Map<string, ReturnType<typeof setInterval>> = new Map();

  private spectrumCallbacks: Array<(msg: SpectrumMessage) => void> = [];
  private statusCallbacks: Array<(status: StreamStatus) => void> = [];
  private errorCallbacks: Array<(error: { message: string; details?: unknown }) => void> = [];

  constructor(sourceId: string) {
    this.sourceId = sourceId;
  }

  async connect(): Promise<void> {
    console.log(`[Mock] Connecting to mock stream for source: ${this.sourceId}`);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate connection delay
    this.connected = true;
    this.notifyStatus({ connected: true, details: "Mock connected" });
  }

  async disconnect(): Promise<void> {
    console.log(`[Mock] Disconnecting from mock stream`);
    this.intervalHandles.forEach((handle) => clearInterval(handle));
    this.intervalHandles.clear();
    this.connected = false;
    this.notifyStatus({ connected: false, details: "Mock disconnected" });
  }

  async subscribeSpectrum(sourceId: string, radioId: string): Promise<void> {
    const key = `${sourceId}:${radioId}`;
    if (this.intervalHandles.has(key)) {
      return;
    }

    console.log(`[Mock] Subscribing to ${key}`);

    // Generate synthetic spectrum data every 250ms
    const handle = setInterval(() => {
      const frame = this.generateMockFrame(sourceId, radioId);
      this.spectrumCallbacks.forEach((cb) => cb(frame));
    }, 250);

    this.intervalHandles.set(key, handle);
  }

  async unsubscribeSpectrum(sourceId: string, radioId: string): Promise<void> {
    const key = `${sourceId}:${radioId}`;
    const handle = this.intervalHandles.get(key);
    if (handle) {
      clearInterval(handle);
      this.intervalHandles.delete(key);
      console.log(`[Mock] Unsubscribed from ${key}`);
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
    return { connected: this.connected, details: this.connected ? "Mock active" : "Mock disconnected" };
  }

  private notifyStatus(status: StreamStatus): void {
    this.statusCallbacks.forEach((cb) => cb(status));
  }

  private generateMockFrame(sourceId: string, radioId: string): SpectrumMessage {
    const binCount = 512;
    const centerHz = 100_000_000; // 100 MHz
    const spanHz = 10_000_000; // 10 MHz span
    const binHz = spanHz / binCount;

    // Generate realistic-looking spectrum with noise floor and some peaks
    const noiseFloor = -90;
    const binsDbm: number[] = [];

    for (let i = 0; i < binCount; i++) {
      // Base noise floor with some variation
      let power = noiseFloor + (Math.random() - 0.5) * 6;

      // Add some synthetic signals
      const normalizedBin = i / binCount;

      // Peak at ~25% (simulating a narrow signal)
      if (Math.abs(normalizedBin - 0.25) < 0.02) {
        power = Math.max(power, -50 + Math.random() * 5);
      }

      // Wider signal at ~60%
      if (Math.abs(normalizedBin - 0.6) < 0.05) {
        const distance = Math.abs(normalizedBin - 0.6) / 0.05;
        power = Math.max(power, -60 + (1 - distance) * 20 + Math.random() * 3);
      }

      // Random spike
      if (Math.random() < 0.002) {
        power = Math.max(power, -55 + Math.random() * 10);
      }

      binsDbm.push(power);
    }

    return {
      sourceId,
      radioId,
      payload: {
        ts: Date.now(),
        centerHz: centerHz,
        spanHz: spanHz,
        binHz,
        binsDbm,
        frameId: `mock-${Date.now()}`,
      },
    };
  }
}
