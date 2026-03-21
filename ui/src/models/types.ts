// Data models for SDR Command Center

// User roles from Keycloak
export type UserRole = 'ADMIN' | 'ANALYST' | 'VIEWER';

export interface User {
  userId: string;
  name: string;
  email: string;
  roles: UserRole[];
}

// Machine represents a physical location/site
export interface Machine {
  machineId: string;
  name: string;
  lat: number;
  lon: number;
  siteName: string;
  status: 'online' | 'offline' | 'warning';
}

// Device types
export type DeviceType = 'RTLSDR' | 'HACKRF';

// SDR Device
export interface Device {
  deviceId: string;
  machineId: string;
  type: DeviceType;
  lastSeenTs: number;
  cf: number; // center frequency in Hz
  sr: number; // sample rate in Hz
  online: boolean;
}

// Device status
export interface DeviceStatus {
  lastSeenTs: number;
  online: boolean;
  cf: number;
  sr: number;
  seq: number;
}

// Device control options
export interface DeviceControl {
  rawfeed?: boolean;
  spectrum?: boolean;
  spectrumEvery?: number;
}

// Dashboard widget types
export type WidgetType = 
  | 'LIVE_SPECTRUM' 
  | 'OVERLAY' 
  | 'DEVICE_HEALTH' 
  | 'MAP_MINI' 
  | 'TOP_PEAKS';

// Widget configuration
export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  layout: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

// Dashboard
export interface Dashboard {
  id: string;
  name: string;
  widgets: Widget[];
  createdAt: number;
  updatedAt: number;
}

// Spectrum META frame from WebSocket
export interface SpectrumMeta {
  type: 'META';
  deviceId: string;
  ts: number;
  cf: number;
  sr: number;
  nfft: number;
  binHz: number;
  bins: number;
  peakDb: number;
  peakHz: number;
  seq: number;
}

// Spectrum data cache
export interface SpectrumData {
  meta: SpectrumMeta;
  bins: Float32Array;
  timestamp: number;
}

// WebSocket subscribe message
export interface WSSubscribe {
  type: 'SUBSCRIBE';
  devices: string[];
  rateHz: number;
  overlay: boolean;
}

// Capture request
export interface CaptureRequest {
  deviceId: string;
  seconds: number;
}

// Capture record
export interface Capture {
  captureId: string;
  deviceId: string;
  timestamp: number;
  duration: number;
  status: 'pending' | 'capturing' | 'complete' | 'failed';
  fileSize?: number;
  frameCount?: number;
  startedAt?: number;
  completedAt?: number;
  truncated?: boolean;
  summaryTruncated?: boolean;
  sampleSummaries?: number;
  analysis?: AnalysisResult;
  error?: string;
}

// Analysis job
export interface AnalysisJob {
  jobId: string;
  captureId: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  requestedAnalyses?: string[];
  result?: AnalysisResult;
  error?: string;
}

// Analysis result
export interface AnalysisResult {
  droneScore: number;
  dominantLabel?: string;
  sampledFrames?: number;
  durationSec?: number;
  analysesRun?: string[];
  energyProfile?: Record<string, number>;
  burstActivity?: Record<string, number>;
  frequencyHopping?: Record<string, number>;
  bandwidthOccupancy?: Record<string, number>;
  protocolHints?: {
    label: string;
    confidence: number;
    in24GHzBand: boolean;
    scores: Record<string, number>;
  };
  detectedBands: {
    startHz: number;
    endHz: number;
    label: string;
    confidence: number;
  }[];
}

// Peak detection
export interface Peak {
  deviceId: string;
  frequencyHz: number;
  powerDb: number;
  timestamp: number;
}

// Marker on spectrum
export interface SpectrumMarker {
  id: string;
  frequencyHz: number;
  label?: string;
  color?: string;
}

// Navigation item
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  roles: UserRole[];
}
