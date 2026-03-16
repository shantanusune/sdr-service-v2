/**
 * Datasources API client methods.
 * Handles communication with the backend datasources endpoints.
 */

import { http } from './http';
import type {
  DataSourceDto,
  HostDto,
  RadioDeviceDto,
  RegistryCatalogDto,
  HostCatalog,
  ServiceInfo,
} from '@/types/api';

export const datasourcesApi = {
  /**
   * Get all datasources with optional state filter
   * @param state - Optional state filter (e.g., "ONLINE", "OFFLINE")
   */
  list: (state?: string) =>
    http.get<DataSourceDto[]>(
      `/api/datasources${state ? `?state=${state}` : ''}`
    ),

  /**
   * Get only streamable datasources (spectrum/rawfeed with WS endpoints)
   * This is the primary endpoint for the Spectrum Viewer
   */
  listStreamable: () =>
    http.get<DataSourceDto[]>('/api/datasources/streamable'),

  /**
   * Get datasources for a specific host
   * @param hostId - The host ID
   */
  byHost: (hostId: number) =>
    http.get<DataSourceDto[]>(`/api/datasources/host/${hostId}`),

  /**
   * Get full registry catalog (includes all hosts, datasources, WS config)
   * Useful for getting the complete system overview
   */
  getCatalog: () => http.get<RegistryCatalogDto>('/api/catalog'),

  /**
   * Get host-specific catalog
   * @param hostId - The host ID
   */
  getHostCatalog: (hostId: number) =>
    http.get<HostCatalog>(`/api/catalog/hosts/${hostId}`),

  /**
   * Get all discovered hosts
   */
  getHosts: () => http.get<HostDto[]>('/api/hosts'),

  /**
   * Get a specific host by ID
   * @param hostId - The host ID
   */
  getHost: (hostId: number) => http.get<HostDto>(`/api/hosts/${hostId}`),

  /**
   * Get devices for a specific host
   * @param hostId - The host ID
   */
  getDevices: (hostId: number) =>
    http.get<RadioDeviceDto[]>(`/api/hosts/${hostId}/devices`),

  /**
   * Get all discovered services
   */
  getServices: () => http.get<ServiceInfo[]>('/api/services'),

  /**
   * Health check endpoint
   */
  health: () => http.get<Record<string, unknown>>('/health'),
};

export default datasourcesApi;
