# SDR Spectrum Visualization - Technical Implementation Guide

> **Generated:** 2026-01-13  
> **Version:** 1.0

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Data Flow Pipeline](#3-data-flow-pipeline)
4. [Core Components](#4-core-components)
5. [Data Types and Interfaces](#5-data-types-and-interfaces)
6. [WebSocket Communication](#6-websocket-communication)
7. [Binary Data Parsing](#7-binary-data-parsing)
8. [Rendering Pipeline](#8-rendering-pipeline)
9. [Performance Optimizations](#9-performance-optimizations)
10. [Configuration Options](#10-configuration-options)
11. [File Index](#11-file-index)

---

## 1. Architecture Overview

The spectrum visualization system follows a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer                                │
│  SpectrumLab.tsx → useSpectrumWS → SpectrumChart (Canvas)      │
├─────────────────────────────────────────────────────────────────┤
│                      Data Management                            │
│  WebSocketStreamClient ↔ BinaryParser ↔ SpectrumAdapter        │
├─────────────────────────────────────────────────────────────────┤
│                      Transport Layer                            │
│  WebSocket (ArrayBuffer/JSON) → Backend MQTT-WS Bridge         │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Principles

- **No Direct MQTT**: Frontend connects via WebSocket to a backend bridge (no direct MQTT access)
- **Dual Format Support**: Supports both binary (high-performance) and JSON (fallback) formats
- **Canvas Rendering**: Canvas-based rendering for handling 1024+ bins at high frame rates
- **Configurable FPS**: User-adjustable frame rate with throttled UI updates to prevent thread blocking
- **Multi-Radio Overlay**: Support for multiple radio streams with per-layer opacity controls

---

## 2. Technology Stack

### JavaScript/TypeScript Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| React | ^18.3.1 | UI Framework |
| TypeScript | (via Vite) | Type safety |
| Vite | (build tool) | Development server and bundling |
| TanStack React Query | ^5.83.0 | Data fetching/caching for datasources API |
| react-router-dom | ^6.30.1 | Client-side routing with URL params |
| Tailwind CSS | (config) | Utility-first styling |
| Radix UI | (various) | Accessible UI primitives (Select, Slider, Dialog, etc.) |
| Recharts | ^2.15.4 | Charting library (used elsewhere, not for spectrum) |
| lucide-react | ^0.462.0 | Icon library |

### Native Browser APIs Used

| API | Purpose |
|-----|---------|
| **WebSocket API** | Real-time bidirectional communication with backend |
| **ArrayBuffer** | Container for raw binary data from WebSocket |
| **DataView** | Reading typed values from ArrayBuffer at specific offsets |
| **Float32Array / Float64Array** | Zero-copy typed array views for spectrum bins |
| **Canvas 2D API** | High-performance spectrum line/fill rendering |
| **localStorage** | Persisting user preferences (FPS, radio selections) |
| **URL / URLSearchParams** | Shareable state via URL query parameters |

---

## 3. Data Flow Pipeline

### Complete Step-by-Step Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│ User selects │ ──► │ useSpectrumWS│ ──► │ WebSocketStreamClient│
│ radios in UI │     │ subscribe()  │     │ connect + subscribe  │
└──────────────┘     └──────────────┘     └──────────────────────┘
                                                    │
                                                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│ Backend MQTT │ ◄── │ WebSocket    │ ◄── │ Backend WS Bridge    │
│ Broker       │     │ Connection   │     │ (MQTT-to-WS)         │
└──────────────┘     └──────────────┘     └──────────────────────┘
                            │
                            ▼ ArrayBuffer (binary) or JSON
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│ binaryParser │ ──► │ spectrum     │ ──► │ latestRef buffer     │
│ parse frame  │     │ Adapter      │     │ (per radioKey)       │
└──────────────┘     └──────────────┘     └──────────────────────┘
                                                    │
                                                    ▼ Throttled flush (FPS)
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│ SpectrumChart│ ◄── │ React state  │ ◄── │ setSpectrumData()    │
│ Canvas render│     │ spectrumData │     │ shallow clone        │
└──────────────┘     └──────────────┘     └──────────────────────┘
```

### Detailed Steps

1. **User Selection**: User selects one or more radios from the Data Sources panel
2. **Subscription Request**: `useSpectrumWS.subscribe()` creates `WebSocketStreamClient` instances per datasource
3. **WebSocket Connection**: Client connects to backend bridge endpoint (`ws://host:port/path`)
4. **Subscription Command**: JSON message `{type: "subscribe", sourceId, radioId}` sent to server
5. **Binary Streaming**: Backend streams `ArrayBuffer` frames at high rate (typically 20-60 FPS)
6. **Binary Parsing**: `binaryParser.parseBinarySpectrumFrame()` extracts header + Float32Array bins
7. **Normalization**: `spectrumAdapter.toSpectrumFrame()` converts to standard `SpectrumFrame` type
8. **Buffering**: Frames stored in `latestRef` Map, keyed by `sourceId:radioId`
9. **Throttled Flush**: Timer fires at configured FPS, triggers `setSpectrumData()` with shallow clone
10. **Canvas Rendering**: `SpectrumChart` redraws all layers using Canvas 2D context

---

## 4. Core Components

### 4.1 SpectrumLab.tsx

**Location:** `src/pages/SpectrumLab.tsx`

Main page component orchestrating the spectrum viewer.

#### State Management

```typescript
// Selected radio keys (format: "sourceId:radioId")
const [selectedRadios, setSelectedRadios] = useState<string[]>([]);

// Search filter for radio list
const [searchQuery, setSearchQuery] = useState('');

// User-placed frequency markers
const [markers, setMarkers] = useState<SpectrumMarker[]>([]);

// Per-radio opacity (0.0 - 1.0)
const [layerOpacities, setLayerOpacities] = useState<Record<string, number>>({});

// Streaming active state
const [isStreaming, setIsStreaming] = useState(false);

// Configurable FPS (persisted in localStorage)
const [fps, setFps] = useState<number>(() => {
  const saved = localStorage.getItem('sdr.spectrumLab.fps');
  return saved ? parseInt(saved, 10) : 20;
});
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `handleStartStreaming()` | Initiates WebSocket connections for selected radios |
| `handleStopStreaming()` | Closes all connections and cleans up state |
| `handleFpsChange()` | Updates FPS setting and persists to localStorage |
| `handleAddMarker()` | Adds a frequency marker at clicked position |
| `handleOpacityChange()` | Updates opacity for a specific radio layer |

#### URL Parameter Support

```typescript
// Read initial selection from URL
const [searchParams] = useSearchParams();
useEffect(() => {
  const radioParam = searchParams.get('radios');
  if (radioParam) {
    setSelectedRadios(radioParam.split(','));
  }
}, []);
```

---

### 4.2 useSpectrumWS Hook

**Location:** `src/realtime/useSpectrumWS.ts`

React hook managing WebSocket connections and data buffering.

#### Interface

```typescript
interface UseSpectrumWSOptions {
  /** Target frames per second for UI updates (5-60, default 20) */
  fps?: number;
}

interface UseSpectrumWSResult {
  isConnected: boolean;
  spectrumData: SpectrumCache;
  subscribe: (sources: DataSource[], radioIds: string[]) => void;
  unsubscribe: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: boolean;
}

interface SpectrumCache {
  [radioKey: string]: {
    frame: SpectrumFrame;
    timestamp: number;
  };
}
```

#### Throttling Mechanism

```typescript
const { fps = 20 } = options;
const flushIntervalMs = Math.max(16, Math.floor(1000 / Math.min(60, Math.max(5, fps))));

// FPS to interval mapping:
// 5 FPS  → 200ms interval
// 10 FPS → 100ms interval
// 20 FPS → 50ms interval
// 30 FPS → 33ms interval
// 60 FPS → 16ms interval (minimum)
```

#### Buffering Strategy

```typescript
// Mutable refs for high-frequency updates (no re-renders)
const latestRef = useRef<SpectrumCache>({});
const flushTimerRef = useRef<number | null>(null);
const lastFlushRef = useRef<number>(0);

// On incoming spectrum message:
const handleSpectrumMessage = useCallback((msg: SpectrumMessage) => {
  if (isPausedRef.current) return;
  
  const radioKey = `${msg.sourceId}:${msg.radioId}`;
  latestRef.current[radioKey] = {
    frame: msg.frame,
    timestamp: Date.now()
  };
  
  scheduleFlush(); // Schedule UI update if not already pending
}, [scheduleFlush]);
```

---

### 4.3 WebSocketStreamClient

**Location:** `src/services/stream/WebSocketStreamClient.ts`

Low-level WebSocket client with reconnection and subscription management.

#### Features

- **Auto-reconnection**: Exponential backoff (1s → 2s → 4s → ... → 30s max)
- **Binary mode**: `ws.binaryType = "arraybuffer"` for efficient binary handling
- **Subscription queue**: Queues subscriptions if sent before connection ready
- **Graceful disconnect**: Sends unsubscribe commands before closing

#### Class Structure

```typescript
export class WebSocketStreamClient implements StreamClient {
  private ws: WebSocket | null = null;
  private endpoint: string;
  private sourceId: string;
  
  // Subscription tracking
  private activeSubscriptions = new Map<string, Set<string>>();
  private pendingSubscriptions: Array<{sourceId: string, radioId: string}> = [];
  
  // Callbacks
  private spectrumCallbacks: Array<(msg: SpectrumMessage) => void> = [];
  private statusCallbacks: Array<(status: StreamStatus) => void> = [];
  private errorCallbacks: Array<(error: {...}) => void> = [];
  
  // Reconnection
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
}
```

#### Connection Lifecycle

```typescript
connect(): void {
  this.ws = new WebSocket(this.endpoint);
  this.ws.binaryType = "arraybuffer";
  
  this.ws.onopen = () => {
    this.reconnectAttempts = 0;
    this.updateStatus("connected");
    this.flushPendingSubscriptions();
  };
  
  this.ws.onclose = () => {
    this.updateStatus("disconnected");
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  };
  
  this.ws.onmessage = (event) => {
    this.handleMessage(event.data);
  };
}
```

---

### 4.4 SpectrumChart

**Location:** `src/components/charts/SpectrumChart.tsx`

Canvas-based spectrum visualization component.

#### Props Interface

```typescript
interface SpectrumChartProps {
  data: ChartDataItem[];           // Array of SpectrumFrame or SpectrumData
  markers?: SpectrumMarker[];      // Frequency markers to display
  onMarkerAdd?: (hz: number) => void; // Callback when user clicks to add marker
  width?: number;                  // Canvas width (default: 800)
  height?: number;                 // Canvas height (default: 300)
  showGrid?: boolean;              // Show frequency/power grid (default: true)
  showPeaks?: boolean;             // Show peak indicators (default: true)
  colors?: string[];               // Colors for each layer
  opacities?: number[];            // Opacity for each layer (0-1)
  offsets?: number[];              // dB offset for each layer
}
```

#### Normalization Layer

The chart includes type guards to handle both legacy and modern data formats:

```typescript
function isSpectrumFrame(item: unknown): item is SpectrumFrame {
  return (
    typeof item === 'object' &&
    item !== null &&
    'binsDbm' in item &&
    'centerHz' in item
  );
}

function normalizeData(item: ChartDataItem): NormalizedSpectrum {
  if (isSpectrumFrame(item)) {
    // Modern SpectrumFrame format
    return {
      bins: Array.isArray(item.binsDbm) ? item.binsDbm : Array.from(item.binsDbm),
      centerHz: item.centerHz,
      spanHz: item.spanHz,
      binHz: item.binHz,
      // ... peak detection
    };
  } else {
    // Legacy SpectrumData format
    return {
      bins: item.bins,
      centerHz: item.meta?.centerHz ?? 100e6,
      // ...
    };
  }
}
```

---

## 5. Data Types and Interfaces

### 5.1 SpectrumFrame

**Location:** `src/types/sdr.ts`

The normalized internal representation of spectrum data:

```typescript
export type SpectrumFrame = {
  /** Unix timestamp in milliseconds */
  ts: number;
  
  /** Center frequency in Hz */
  centerHz: number;
  
  /** Total span/bandwidth in Hz */
  spanHz: number;
  
  /** Frequency resolution per bin (spanHz / bins.length) */
  binHz: number;
  
  /** Power levels in dBm for each frequency bin */
  binsDbm: number[];
  
  /** Optional frame identifier */
  frameId?: string;
};
```

### 5.2 BinarySpectrumFrame

**Location:** `src/services/stream/binaryParser.ts`

Parsed directly from raw WebSocket ArrayBuffer:

```typescript
export interface BinarySpectrumFrame {
  ts: number;
  centerHz: number;
  spanHz: number;
  binHz: number;
  binsDbm: Float32Array; // Uses Float32Array for zero-copy efficiency
}
```

### 5.3 SpectrumMessage

**Location:** `src/services/stream/StreamClient.ts`

Message format from StreamClient callbacks:

```typescript
export interface SpectrumMessage {
  sourceId: string;
  radioId: string;
  frame: SpectrumFrame;
}
```

### 5.4 SpectrumCache

**Location:** `src/realtime/useSpectrumWS.ts`

In-memory cache of latest frames per radio:

```typescript
interface SpectrumCache {
  [radioKey: string]: {  // Key format: "sourceId:radioId"
    frame: SpectrumFrame;
    timestamp: number;   // When frame was received
  };
}
```

### 5.5 DataSource / RadioSource

**Location:** `src/types/sources.ts`

Frontend representation of hosts and their radios:

```typescript
export type DataSource = {
  id: string;           // Unique source identifier
  name: string;         // Display name
  transport: "ws";      // Transport type (always WebSocket)
  endpoint: string;     // WebSocket URL (e.g., "ws://localhost:8080")
  enabled: boolean;     // Whether source is enabled
  radios: RadioSource[];// List of radios on this source
};

export type RadioSource = {
  id: string;           // Radio identifier
  name: string;         // Display name (e.g., "HackRF One")
  mqtt?: {
    spectrumTopic: string; // MQTT topic (used by backend)
  };
  meta?: Record<string, unknown>; // Additional metadata
};
```

### 5.6 SpectrumMarker

**Location:** `src/types/sdr.ts`

User-placed frequency markers:

```typescript
export type SpectrumMarker = {
  id: string;
  frequencyHz: number;
  label?: string;
  color?: string;
};
```

---

## 6. WebSocket Communication

### 6.1 Connection Establishment

```typescript
// WebSocketStreamClient.connect()
this.ws = new WebSocket(this.endpoint);
this.ws.binaryType = "arraybuffer"; // Critical for binary handling

this.ws.onopen = () => {
  console.log(`[WS] Connected to ${this.endpoint}`);
  this.reconnectAttempts = 0;
  this.updateStatus("connected");
  this.flushPendingSubscriptions();
};
```

### 6.2 Message Protocol

#### Outbound Messages (Client → Server)

```json
// Subscribe to spectrum data for a radio
{
  "type": "subscribe",
  "sourceId": "host-1",
  "radioId": "hackrf-1"
}

// Unsubscribe from spectrum data
{
  "type": "unsubscribe",
  "sourceId": "host-1", 
  "radioId": "hackrf-1"
}
```

#### Inbound Messages (Server → Client)

**Binary Format (Primary):**
Raw `ArrayBuffer` containing spectrum frame (see Section 7)

**JSON Format (Fallback/Control):**

```json
// Status message
{
  "type": "status",
  "connected": true,
  "details": "Connected to MQTT broker"
}

// Error message
{
  "type": "error",
  "message": "Subscription failed",
  "details": { ... }
}

// Legacy JSON spectrum (fallback)
{
  "type": "spectrum",
  "sourceId": "host-1",
  "radioId": "hackrf-1",
  "payload": {
    "ts": 1736784000000,
    "centerHz": 100000000,
    "spanHz": 20000000,
    "bins": [-80.5, -82.1, -79.3, ...]
  }
}
```

### 6.3 Subscription Management

```typescript
subscribeSpectrum(sourceId: string, radioId: string): void {
  // Track locally FIRST (prevents race condition with fast binary data)
  if (!this.activeSubscriptions.has(sourceId)) {
    this.activeSubscriptions.set(sourceId, new Set());
  }
  this.activeSubscriptions.get(sourceId)!.add(radioId);
  
  // Queue if not connected yet
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    this.pendingSubscriptions.push({ sourceId, radioId });
    return;
  }
  
  // Send subscription command
  this.sendSubscribe(sourceId, radioId);
}
```

### 6.4 Reconnection Strategy

```typescript
private scheduleReconnect(): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    console.error('[WS] Max reconnection attempts reached');
    return;
  }
  
  const delay = Math.min(
    this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
    30000 // Cap at 30 seconds
  );
  
  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
  
  this.reconnectTimer = window.setTimeout(() => {
    this.reconnectAttempts++;
    this.connect();
  }, delay);
}

// Delay progression: 1s → 2s → 4s → 8s → 16s → 30s → 30s → ...
```

---

## 7. Binary Data Parsing

### 7.1 Supported Binary Formats

The parser supports two binary formats, auto-detected based on header validation:

#### Format A - Header + Bins (28-byte header)

```
┌────────┬─────────┬───────┬────────────┬─────────────────────────┐
│ Offset │ Type    │ Size  │ Field      │ Description             │
├────────┼─────────┼───────┼────────────┼─────────────────────────┤
│ 0      │ Float64 │ 8     │ timestamp  │ Unix timestamp (ms)     │
│ 8      │ Float64 │ 8     │ centerHz   │ Center frequency (Hz)   │
│ 16     │ Float64 │ 8     │ spanHz     │ Span/bandwidth (Hz)     │
│ 24     │ Uint32  │ 4     │ binCount   │ Number of spectrum bins │
│ 28     │ Float32 │ N×4   │ bins[]     │ Power values (dBm)      │
└────────┴─────────┴───────┴────────────┴─────────────────────────┘

Total size: 28 + (binCount × 4) bytes
Example: 1024 bins = 28 + 4096 = 4124 bytes per frame
```

#### Format B - Raw Float32 Bins (No Header)

```
┌────────┬─────────┬───────┬────────────┬─────────────────────────┐
│ Offset │ Type    │ Size  │ Field      │ Description             │
├────────┼─────────┼───────┼────────────┼─────────────────────────┤
│ 0      │ Float32 │ N×4   │ bins[]     │ Power values (dBm)      │
└────────┴─────────┴───────┴────────────┴─────────────────────────┘

- No header, just raw Float32 power values
- Uses default frequency parameters:
  - centerHz: 100 MHz
  - spanHz: 20 MHz
- Parser auto-detects by validating header values
```

### 7.2 Parsing Implementation

**Location:** `src/services/stream/binaryParser.ts`

```typescript
const HEADER_SIZE = 28;
const DEFAULT_CENTER_HZ = 100e6;  // 100 MHz
const DEFAULT_SPAN_HZ = 20e6;     // 20 MHz

export function parseBinarySpectrumFrame(buffer: ArrayBuffer): BinarySpectrumFrame | null {
  if (buffer.byteLength < 4) {
    return null;
  }

  try {
    const view = new DataView(buffer);

    // Try Format A: Header + bins
    if (buffer.byteLength >= HEADER_SIZE) {
      const ts = view.getFloat64(0, true);        // Little-endian
      const centerHz = view.getFloat64(8, true);
      const spanHz = view.getFloat64(16, true);
      const binCount = view.getUint32(24, true);

      const expectedDataSize = binCount * 4;
      const actualDataSize = buffer.byteLength - HEADER_SIZE;

      // Validate header and bin count
      if (
        isValidHeader(ts, centerHz, spanHz) &&
        binCount > 0 &&
        binCount < 100000 &&
        actualDataSize >= expectedDataSize
      ) {
        // Zero-copy: create Float32Array view directly on buffer
        const binsDbm = new Float32Array(buffer, HEADER_SIZE, binCount);
        const binHz = binCount > 0 ? spanHz / binCount : 0;
        return { ts, centerHz, spanHz, binHz, binsDbm };
      }
    }

    // Format B: Raw Float32 bins (no header or invalid header)
    const binCount = Math.floor(buffer.byteLength / 4);
    if (binCount < 10) {
      return null;
    }

    const binsView = new Float32Array(buffer);

    // Find where valid dBm values start (skip garbage header floats)
    let validStart = 0;
    for (let i = 0; i < Math.min(20, binCount); i++) {
      if (isValidDbm(binsView[i])) {
        validStart = i;
        break;
      }
    }

    const binsDbm = binsView.subarray(validStart);
    if (binsDbm.length < 10) {
      return null;
    }

    return {
      ts: Date.now(),
      centerHz: DEFAULT_CENTER_HZ,
      spanHz: DEFAULT_SPAN_HZ,
      binHz: DEFAULT_SPAN_HZ / binsDbm.length,
      binsDbm,
    };
  } catch (e) {
    console.error('[BinaryParser] Failed to parse frame:', e);
    return null;
  }
}
```

### 7.3 Validation Functions

```typescript
/**
 * Validate if header values are reasonable
 * Detects garbage values from incorrectly parsed binary data
 */
function isValidHeader(ts: number, centerHz: number, spanHz: number): boolean {
  // Timestamp: positive, less than year 33000, finite
  const isValidTs = ts > 0 && ts < 1e15 && isFinite(ts);
  
  // Center frequency: 1 kHz to 1 THz range
  const isValidCenter = centerHz > 1e3 && centerHz < 1e12 && isFinite(centerHz);
  
  // Span: positive, up to 100 GHz
  const isValidSpan = spanHz > 0 && spanHz < 1e11 && isFinite(spanHz);
  
  return isValidTs && isValidCenter && isValidSpan;
}

/**
 * Check if a dBm value is valid (reasonable power level)
 * Valid range: -200 dBm to +50 dBm
 */
function isValidDbm(value: number): boolean {
  return isFinite(value) && value >= -200 && value <= 50;
}
```

### 7.4 Helper Functions

```typescript
/**
 * Check if data appears to be binary (ArrayBuffer or Blob)
 */
export function isBinaryData(data: unknown): data is ArrayBuffer | Blob {
  return data instanceof ArrayBuffer || data instanceof Blob;
}

/**
 * Convert Blob to ArrayBuffer (for Blob WebSocket messages)
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}
```

---

## 8. Rendering Pipeline

### 8.1 Canvas Setup and High-DPI Support

```typescript
const drawChart = useCallback(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Handle high-DPI displays (Retina, etc.)
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  
  // Clear canvas with background color
  ctx.fillStyle = 'hsl(222, 47%, 11%)'; // --background
  ctx.fillRect(0, 0, width, height);
  
  // Draw grid, spectrum layers, markers, legends...
}, [data, width, height, markers, colors, opacities]);
```

### 8.2 Grid Drawing

```typescript
const drawGrid = (ctx: CanvasRenderingContext2D) => {
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  ctx.strokeStyle = 'hsl(217, 19%, 27%)'; // --border
  ctx.lineWidth = 0.5;
  
  // Horizontal grid lines (dB levels)
  const dbSteps = [-100, -80, -60, -40, -20, 0];
  dbSteps.forEach(db => {
    const y = padding.top + chartHeight * (1 - (db - minDb) / dbRange);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    
    // Label
    ctx.fillStyle = 'hsl(215, 20%, 65%)'; // --muted-foreground
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${db} dBm`, padding.left - 5, y + 3);
  });
  
  // Vertical grid lines (frequency)
  // ... similar implementation
};
```

### 8.3 Spectrum Line Drawing

```typescript
normalizedData.forEach((spectrum, layerIdx) => {
  const { bins, centerHz, spanHz } = spectrum;
  const color = colors[layerIdx % colors.length];
  const opacity = opacities[layerIdx] ?? 1.0;
  const offset = offsets[layerIdx] ?? 0;
  
  // Draw spectrum line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = opacity;
  
  for (let i = 0; i < bins.length; i++) {
    const x = padding.left + (i / bins.length) * chartWidth;
    const dbValue = bins[i] + offset;
    const normalizedDb = (dbValue - minDb) / dbRange;
    const y = padding.top + chartHeight * (1 - normalizedDb);
    
    // Skip invalid values
    if (!isFinite(y)) continue;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  
  // Fill under curve
  ctx.lineTo(padding.left + chartWidth, height - padding.bottom);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = opacity * 0.15;
  ctx.fill();
  
  ctx.globalAlpha = 1.0; // Reset
});
```

### 8.4 Peak Detection and Display

```typescript
const findPeak = (bins: number[]): { index: number; value: number } => {
  let peakIndex = 0;
  let peakValue = -Infinity;
  
  for (let i = 0; i < bins.length; i++) {
    if (isFinite(bins[i]) && bins[i] > peakValue) {
      peakValue = bins[i];
      peakIndex = i;
    }
  }
  
  return { index: peakIndex, value: peakValue };
};

// Draw peak indicator
if (showPeaks) {
  const { index, value } = findPeak(bins);
  const peakX = padding.left + (index / bins.length) * chartWidth;
  const peakY = padding.top + chartHeight * (1 - (value - minDb) / dbRange);
  
  // Draw peak marker (triangle or circle)
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(peakX, peakY, 4, 0, Math.PI * 2);
  ctx.fill();
  
  // Peak frequency label
  const peakHz = centerHz - spanHz/2 + (index / bins.length) * spanHz;
  ctx.fillText(formatFrequency(peakHz), peakX, peakY - 10);
}
```

### 8.5 Marker Rendering

```typescript
markers?.forEach(marker => {
  const markerX = padding.left + 
    ((marker.frequencyHz - startHz) / spanHz) * chartWidth;
  
  if (markerX < padding.left || markerX > width - padding.right) return;
  
  // Vertical line
  ctx.strokeStyle = marker.color || 'hsl(0, 84%, 60%)'; // --destructive
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(markerX, padding.top);
  ctx.lineTo(markerX, height - padding.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Label
  if (marker.label) {
    ctx.fillStyle = marker.color || 'hsl(0, 84%, 60%)';
    ctx.font = '11px sans-serif';
    ctx.fillText(marker.label, markerX + 4, padding.top + 15);
  }
});
```

---

## 9. Performance Optimizations

### 9.1 Frame Rate Throttling

The UI update rate is decoupled from the WebSocket message rate:

```typescript
// useSpectrumWS.ts

// Calculate flush interval from FPS
const flushIntervalMs = Math.max(16, Math.floor(1000 / fps));

// Buffer incoming frames without re-rendering
const handleSpectrumMessage = useCallback((msg: SpectrumMessage) => {
  if (isPausedRef.current) return;
  
  // Update mutable ref (no re-render)
  latestRef.current[radioKey] = { frame, timestamp: Date.now() };
  
  // Schedule flush if not already pending
  scheduleFlush();
}, [scheduleFlush]);

// Flush at controlled rate
const scheduleFlush = useCallback(() => {
  if (flushTimerRef.current !== null) return; // Already scheduled
  
  const now = Date.now();
  const elapsed = now - lastFlushRef.current;
  const delay = Math.max(0, flushIntervalMs - elapsed);
  
  flushTimerRef.current = window.setTimeout(() => {
    flushTimerRef.current = null;
    lastFlushRef.current = Date.now();
    
    // Shallow clone triggers React re-render
    setSpectrumData({ ...latestRef.current });
  }, delay);
}, [flushIntervalMs]);
```

### 9.2 Zero-Copy Binary Parsing

```typescript
// Create Float32Array view directly on ArrayBuffer (no memory copy)
const binsDbm = new Float32Array(buffer, HEADER_SIZE, binCount);

// Subarray also creates a view (no copy)
const binsDbm = binsView.subarray(validStart);
```

**Memory Comparison:**
- With copy: `new Float32Array([...values])` → 2× memory, O(n) copy
- Zero-copy: `new Float32Array(buffer, offset, length)` → view only, O(1)

### 9.3 Canvas Optimizations

```typescript
// 1. Clear with fillRect (faster than clearRect for colored backgrounds)
ctx.fillRect(0, 0, width, height);

// 2. Single stroke() call per layer (not per point)
ctx.beginPath();
for (let i = 0; i < bins.length; i++) {
  // moveTo/lineTo only
}
ctx.stroke(); // One GPU call

// 3. Batch similar operations
ctx.globalAlpha = opacity;
// ... all drawing for this layer
ctx.globalAlpha = 1.0;

// 4. Device pixel ratio for crisp rendering
const dpr = window.devicePixelRatio || 1;
canvas.width = width * dpr;
ctx.scale(dpr, dpr);
```

### 9.4 React Optimizations

```typescript
// 1. useCallback for handlers (stable references)
const handleStartStreaming = useCallback(() => {
  // ...
}, [subscribe, selectedRadios, datasources]);

// 2. useMemo for derived data
const chartData = useMemo(() => 
  selectedRadios
    .map(key => spectrumData[key]?.frame)
    .filter(Boolean),
  [selectedRadios, spectrumData]
);

// 3. Shallow clone for state updates (reference inequality)
setSpectrumData({ ...latestRef.current });

// 4. useRef for mutable values (no re-renders)
const latestRef = useRef<SpectrumCache>({});
const isPausedRef = useRef(false);
```

### 9.5 Subscription Race Condition Prevention

```typescript
subscribeSpectrum(sourceId: string, radioId: string): void {
  // Track locally FIRST before sending wire message
  // This prevents "no active subscription" errors when
  // binary data arrives before subscribe acknowledgment
  if (!this.activeSubscriptions.has(sourceId)) {
    this.activeSubscriptions.set(sourceId, new Set());
  }
  this.activeSubscriptions.get(sourceId)!.add(radioId);
  
  // Then send subscribe command
  this.sendSubscribe(sourceId, radioId);
}
```

---

## 10. Configuration Options

### 10.1 FPS Settings

**Storage:** `localStorage` key `sdr.spectrumLab.fps`

| FPS | Flush Interval | CPU Impact | Use Case |
|-----|----------------|------------|----------|
| 5   | 200ms          | Very Low   | Overview, battery saving |
| 10  | 100ms          | Low        | Casual monitoring |
| 20  | 50ms           | Medium     | **Default** - smooth visualization |
| 30  | 33ms           | Higher     | High detail, fast signals |

### 10.2 Default Frequency Parameters

Used when binary header is invalid or missing:

```typescript
const DEFAULT_CENTER_HZ = 100e6;  // 100 MHz
const DEFAULT_SPAN_HZ = 20e6;     // 20 MHz span
```

### 10.3 Chart Appearance Defaults

```typescript
// Default colors for spectrum layers
const DEFAULT_COLORS = [
  'hsl(217, 91%, 60%)',   // Primary blue
  'hsl(187, 96%, 42%)',   // Cyan
  'hsl(160, 84%, 39%)',   // Green
  'hsl(38, 92%, 50%)',    // Yellow/Orange
  'hsl(280, 70%, 60%)',   // Purple
  'hsl(0, 84%, 60%)',     // Red
];

// Chart padding
const padding = { 
  top: 20, 
  right: 20, 
  bottom: 40,  // Room for frequency labels
  left: 60     // Room for dB labels
};

// Default Y-axis range
const minDb = -100;  // Noise floor
const maxDb = 0;     // Maximum power
```

### 10.4 WebSocket Reconnection Settings

```typescript
private maxReconnectAttempts = 10;
private reconnectDelay = 1000;        // Initial delay (1 second)
// Maximum delay: 30 seconds (capped in scheduleReconnect)
// Backoff: exponential (delay × 2^attempts)
```

### 10.5 Binary Parser Limits

```typescript
const HEADER_SIZE = 28;         // Bytes
const MIN_BIN_COUNT = 10;       // Minimum valid bins
const MAX_BIN_COUNT = 100000;   // Maximum valid bins

// Validation ranges
const MIN_FREQUENCY_HZ = 1e3;   // 1 kHz
const MAX_FREQUENCY_HZ = 1e12;  // 1 THz
const MAX_SPAN_HZ = 1e11;       // 100 GHz
const MIN_DBM = -200;
const MAX_DBM = 50;
```

---

## 11. File Index

### Core Implementation Files

| File | Purpose |
|------|---------|
| `src/pages/SpectrumLab.tsx` | Main spectrum viewer page component |
| `src/realtime/useSpectrumWS.ts` | WebSocket subscription hook with throttling |
| `src/services/stream/WebSocketStreamClient.ts` | WebSocket client implementation |
| `src/services/stream/StreamClient.ts` | StreamClient interface definition |
| `src/services/stream/MockStreamClient.ts` | Mock client for testing/development |
| `src/services/stream/binaryParser.ts` | Binary ArrayBuffer parsing |
| `src/services/stream/index.ts` | Stream module exports |
| `src/services/spectrumAdapter.ts` | Payload normalization to SpectrumFrame |
| `src/components/charts/SpectrumChart.tsx` | Canvas-based spectrum rendering |

### Type Definitions

| File | Purpose |
|------|---------|
| `src/types/sdr.ts` | SpectrumFrame, SpectrumMarker, filter types |
| `src/types/sources.ts` | DataSource, RadioSource types |
| `src/types/api.ts` | API response types |
| `src/models/types.ts` | Legacy types (SpectrumMeta, SpectrumData) |

### Data Fetching & Configuration

| File | Purpose |
|------|---------|
| `src/hooks/useDatasources.ts` | React Query hooks for datasource API |
| `src/config/dataSources.ts` | Static config and DTO adapter (groupDataSourcesByHost) |
| `src/api/datasources.ts` | API client for datasources endpoint |

### Supporting Components

| File | Purpose |
|------|---------|
| `src/components/widgets/LiveSpectrumWidget.tsx` | Dashboard spectrum widget |
| `src/components/widgets/TopPeaksWidget.tsx` | Peak detection widget |
| `src/pages/spectrum/SpectrumView.tsx` | Alternative spectrum view page |
| `src/pages/spectrum/SpectrumSources.tsx` | Datasource management page |

---

## Appendix: Troubleshooting

### Common Issues

1. **"No active subscription" errors**
   - Cause: Binary data arriving before subscription registered
   - Fix: Client registers subscription locally before sending wire message

2. **Garbage frequency values on chart**
   - Cause: Invalid binary header being parsed
   - Fix: Validation layer applies defaults (100 MHz center, 20 MHz span)

3. **Chart shows "solid green" or color accumulation**
   - Cause: Not clearing canvas between frames
   - Fix: Use `clearRect()` or `fillRect()` before each draw

4. **High CPU usage**
   - Cause: FPS too high or no throttling
   - Fix: Reduce FPS setting, ensure flush interval is respected

5. **Blank chart with valid data**
   - Cause: NaN/Infinity values in bins
   - Fix: Filter invalid values in normalization layer

---

*End of Documentation*
