import type { 
  User, 
  Machine, 
  Device, 
  DeviceStatus, 
  DeviceControl, 
  Dashboard,
  Capture,
  AnalysisJob,
  CaptureRequest 
} from '@/models/types';
import { resolveApiBaseUrl } from '@/config/runtimeEndpoints';

const API_BASE_URL = resolveApiBaseUrl();
const USE_MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

// API client with auth token
class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // User
  async getMe(): Promise<User> {
    if (USE_MOCK_API) return mockData.getMe();
    return this.fetch<User>('/api/me');
  }

  // Machines
  async getMachines(): Promise<Machine[]> {
    if (USE_MOCK_API) return mockData.getMachines();
    return this.fetch<Machine[]>('/api/machines');
  }

  // Devices
  async getDevices(): Promise<Device[]> {
    if (USE_MOCK_API) return mockData.getDevices();
    return this.fetch<Device[]>('/api/devices');
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    if (USE_MOCK_API) return mockData.getDeviceStatus(deviceId);
    return this.fetch<DeviceStatus>(`/api/devices/${deviceId}/status`);
  }

  async controlDevice(deviceId: string, control: DeviceControl): Promise<void> {
    if (USE_MOCK_API) return mockData.controlDevice(deviceId, control);
    await this.fetch(`/api/devices/${deviceId}/control`, {
      method: 'POST',
      body: JSON.stringify(control),
    });
  }

  // Dashboards
  async getDashboards(): Promise<Dashboard[]> {
    if (USE_MOCK_API) return mockData.getDashboards();
    return this.fetch<Dashboard[]>('/api/dashboards');
  }

  async createDashboard(dashboard: Omit<Dashboard, 'id' | 'createdAt' | 'updatedAt'>): Promise<Dashboard> {
    if (USE_MOCK_API) return mockData.createDashboard(dashboard);
    return this.fetch<Dashboard>('/api/dashboards', {
      method: 'POST',
      body: JSON.stringify(dashboard),
    });
  }

  async updateDashboard(id: string, dashboard: Partial<Dashboard>): Promise<Dashboard> {
    if (USE_MOCK_API) return mockData.updateDashboard(id, dashboard);
    return this.fetch<Dashboard>(`/api/dashboards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dashboard),
    });
  }

  async deleteDashboard(id: string): Promise<void> {
    if (USE_MOCK_API) return mockData.deleteDashboard(id);
    await this.fetch(`/api/dashboards/${id}`, { method: 'DELETE' });
  }

  // Captures
  async createCapture(request: CaptureRequest): Promise<Capture> {
    if (USE_MOCK_API) return mockData.createCapture(request);
    return this.fetch<Capture>('/api/captures', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getCaptures(): Promise<Capture[]> {
    if (USE_MOCK_API) return mockData.getCaptures();
    return this.fetch<Capture[]>('/api/captures');
  }

  // Analysis
  async createAnalysisJob(captureId: string, analyses?: string[]): Promise<AnalysisJob> {
    if (USE_MOCK_API) return mockData.createAnalysisJob(captureId, analyses);
    return this.fetch<AnalysisJob>('/api/analysis/jobs', {
      method: 'POST',
      body: JSON.stringify({ captureId, analyses: analyses ?? [] }),
    });
  }
}

// Mock data implementations
const mockData = {
  getMe: (): User => ({
    userId: 'mock-user-1',
    name: 'Demo Admin',
    email: 'admin@sdr-demo.local',
    roles: ['ADMIN', 'ANALYST', 'VIEWER'],
  }),

  getMachines: (): Machine[] => [
    { machineId: 'machine_01', name: 'Site Alpha', lat: 37.7749, lon: -122.4194, siteName: 'San Francisco', status: 'online' },
    { machineId: 'machine_02', name: 'Site Beta', lat: 40.7128, lon: -74.006, siteName: 'New York', status: 'online' },
    { machineId: 'machine_03', name: 'Site Gamma', lat: 51.5074, lon: -0.1278, siteName: 'London', status: 'warning' },
    { machineId: 'machine_04', name: 'Site Delta', lat: 35.6762, lon: 139.6503, siteName: 'Tokyo', status: 'offline' },
    { machineId: 'machine_05', name: 'Site Epsilon', lat: -33.8688, lon: 151.2093, siteName: 'Sydney', status: 'online' },
  ],

  getDevices: (): Device[] => [
    { deviceId: 'rtl_0', machineId: 'machine_01', type: 'RTLSDR', lastSeenTs: Date.now() - 1000, cf: 100_000_000, sr: 2_560_000, online: true },
    { deviceId: 'rtl_1', machineId: 'machine_01', type: 'RTLSDR', lastSeenTs: Date.now() - 2000, cf: 433_000_000, sr: 2_560_000, online: true },
    { deviceId: 'hackrf_0', machineId: 'machine_02', type: 'HACKRF', lastSeenTs: Date.now() - 500, cf: 915_000_000, sr: 20_000_000, online: true },
    { deviceId: 'rtl_2', machineId: 'machine_02', type: 'RTLSDR', lastSeenTs: Date.now() - 60000, cf: 868_000_000, sr: 2_560_000, online: false },
    { deviceId: 'hackrf_1', machineId: 'machine_03', type: 'HACKRF', lastSeenTs: Date.now() - 3000, cf: 2_400_000_000, sr: 20_000_000, online: true },
    { deviceId: 'rtl_3', machineId: 'machine_04', type: 'RTLSDR', lastSeenTs: Date.now() - 120000, cf: 144_000_000, sr: 2_560_000, online: false },
    { deviceId: 'hackrf_2', machineId: 'machine_05', type: 'HACKRF', lastSeenTs: Date.now() - 1500, cf: 5_800_000_000, sr: 20_000_000, online: true },
  ],

  getDeviceStatus: (deviceId: string): DeviceStatus => {
    const devices = mockData.getDevices();
    const device = devices.find(d => d.deviceId === deviceId);
    return {
      lastSeenTs: device?.lastSeenTs || Date.now(),
      online: device?.online || false,
      cf: device?.cf || 100_000_000,
      sr: device?.sr || 2_560_000,
      seq: Math.floor(Math.random() * 1000),
    };
  },

  controlDevice: (deviceId: string, control: DeviceControl): void => {
    console.log(`[Mock] Device ${deviceId} control:`, control);
  },

  getDashboards: (): Dashboard[] => {
    const stored = localStorage.getItem('sdr-dashboards');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fall through to default
      }
    }
    return [
      {
        id: 'default',
        name: 'Main Dashboard',
        widgets: [
          { id: 'w1', type: 'DEVICE_HEALTH', title: 'Device Health', config: {}, layout: { x: 0, y: 0, w: 6, h: 4 } },
          { id: 'w2', type: 'MAP_MINI', title: 'Global Map', config: {}, layout: { x: 6, y: 0, w: 6, h: 4 } },
          { id: 'w3', type: 'TOP_PEAKS', title: 'Top Peaks', config: { deviceIds: ['rtl_0', 'hackrf_0'] }, layout: { x: 0, y: 4, w: 4, h: 3 } },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  },

  createDashboard: (dashboard: Omit<Dashboard, 'id' | 'createdAt' | 'updatedAt'>): Dashboard => {
    const newDashboard: Dashboard = {
      ...dashboard,
      id: `dashboard-${Date.now()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const dashboards = mockData.getDashboards();
    dashboards.push(newDashboard);
    localStorage.setItem('sdr-dashboards', JSON.stringify(dashboards));
    return newDashboard;
  },

  updateDashboard: (id: string, updates: Partial<Dashboard>): Dashboard => {
    const dashboards = mockData.getDashboards();
    const index = dashboards.findIndex(d => d.id === id);
    if (index !== -1) {
      dashboards[index] = { ...dashboards[index], ...updates, updatedAt: Date.now() };
      localStorage.setItem('sdr-dashboards', JSON.stringify(dashboards));
      return dashboards[index];
    }
    throw new Error('Dashboard not found');
  },

  deleteDashboard: (id: string): void => {
    const dashboards = mockData.getDashboards().filter(d => d.id !== id);
    localStorage.setItem('sdr-dashboards', JSON.stringify(dashboards));
  },

  createCapture: (request: CaptureRequest): Capture => ({
    captureId: `capture-${Date.now()}`,
    deviceId: request.deviceId,
    timestamp: Date.now(),
    duration: request.seconds,
    status: 'pending',
  }),

  getCaptures: (): Capture[] => [
    { captureId: 'cap-001', deviceId: 'rtl_0', timestamp: Date.now() - 3600000, duration: 5, status: 'complete', fileSize: 25600000 },
    { captureId: 'cap-002', deviceId: 'hackrf_0', timestamp: Date.now() - 7200000, duration: 10, status: 'complete', fileSize: 200000000 },
    { captureId: 'cap-003', deviceId: 'rtl_1', timestamp: Date.now() - 1800000, duration: 2, status: 'pending' },
  ],

  createAnalysisJob: (captureId: string, analyses?: string[]): AnalysisJob => ({
    jobId: `job-${Date.now()}`,
    captureId,
    status: 'complete',
    requestedAnalyses: analyses ?? [],
    result: {
      droneScore: 52.3,
      dominantLabel: 'unknown_2_4ghz',
      sampledFrames: 124,
      durationSec: 10,
      analysesRun: analyses ?? ['energy_profile', 'burst_activity', 'frequency_hopping', 'bandwidth_occupancy', 'protocol_hints'],
      detectedBands: [
        { startHz: 2_402_000_000, endHz: 2_407_000_000, label: 'unknown_2_4ghz', confidence: 0.61 },
        { startHz: 2_436_000_000, endHz: 2_441_000_000, label: 'unknown_2_4ghz', confidence: 0.44 },
      ],
      protocolHints: {
        label: 'unknown_2_4ghz',
        confidence: 0.52,
        in24GHzBand: true,
        scores: {
          controlLinkScore: 0.41,
          digitalVideoScore: 0.38,
          fhssScore: 0.33,
          unknownScore: 0.52,
        },
      },
    },
  }),
};

export const apiClient = new ApiClient();
export default apiClient;
