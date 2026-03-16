/**
 * Backend API DTO types matching the Swagger schema.
 * These types represent the data structures returned by the backend API.
 */

// ==========================================
// Live State Enum
// ==========================================

/**
 * LiveState enum matching backend definition.
 * ONLINE, READY, CAPTURING = operational (enabled)
 * OFFLINE, ERROR, UNKNOWN = not operational (disabled)
 */
export type LiveState = 'ONLINE' | 'OFFLINE' | 'READY' | 'CAPTURING' | 'ERROR' | 'UNKNOWN';

/**
 * States that should disable a datasource
 */
export const DISABLED_STATES: LiveState[] = ['OFFLINE', 'ERROR', 'UNKNOWN'];

/**
 * Check if a state is considered disabled
 */
export function isDisabledState(state: string | undefined): boolean {
  if (!state) return true;
  return DISABLED_STATES.includes(state as LiveState);
}

/**
 * Check if a state is considered enabled (operational)
 */
export function isEnabledState(state: string | undefined): boolean {
  return !isDisabledState(state);
}

// ==========================================
// Data Source DTOs
// ==========================================

export interface DataSourceDto {
  id: number;
  sourceKey: string;
  sourceType: string;
  displayName: string;
  state: string;
  mqttTopic: string;
  hostId: number;
  hostKey: string;
  deviceId: number;
  deviceKey: string;
  capabilities: Record<string, unknown>;
  wsEndpoint: string;
  wsPath: string;
  lastSeenAt: string;
}

// ==========================================
// Host DTOs
// ==========================================

export interface HostDto {
  id: number;
  hostKey: string;
  hostName: string;
  ipAddress: string;
  osName: string;
  osVersion: string;
  arch: string;
  agentVersion: string;
  state: string;
  lastSeenAt: string;
}

// ==========================================
// Radio Device DTOs
// ==========================================

export interface RadioDeviceDto {
  id: number;
  hostId: number;
  hostKey: string;
  deviceKey: string;
  deviceType: string;
  serialNumber: string;
  state: string;
  lastSeenAt: string;
  meta: Record<string, unknown>;
}

// ==========================================
// Service Info
// ==========================================

export interface ServiceInfo {
  hostKey: string;
  hostName: string;
  serviceKey: string;
  state: string;
  mqttTopic: string;
  config: Record<string, unknown>;
}

// ==========================================
// Catalog DTOs (for full registry view)
// ==========================================

export interface RegistryCatalogDto {
  broker: Record<string, unknown>;
  websocket: {
    host?: string;
    port?: number;
    protocol?: string;
    [key: string]: unknown;
  };
  hosts: HostCatalog[];
  generatedAt: string;
}

export interface HostCatalog {
  id: number;
  hostKey: string;
  hostName: string;
  ipAddress: string;
  state: string;
  lastSeenAt: string;
  services: ServiceCatalog[];
  devices: DeviceCatalog[];
  dataSources: DataSourceCatalog[];
  topics: TopicCatalog[];
}

export interface ServiceCatalog {
  serviceKey: string;
  displayName: string;
  state: string;
  topic: string;
  config: Record<string, unknown>;
}

export interface DeviceCatalog {
  id: number;
  deviceKey: string;
  deviceType: string;
  serialNumber: string;
  state: string;
  lastSeenAt: string;
  meta: Record<string, unknown>;
}

export interface DataSourceCatalog {
  id: number;
  sourceKey: string;
  sourceType: string;
  displayName: string;
  state: string;
  mqttTopic: string;
  wsEndpoint: string;
  wsPath: string;
  capabilities: Record<string, unknown>;
}

export interface TopicCatalog {
  id: number;
  topic: string;
  direction: string;
  enabled: boolean;
}
