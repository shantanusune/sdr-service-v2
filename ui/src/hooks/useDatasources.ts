/**
 * React Query hooks for datasources API.
 * Provides data fetching with caching, background refresh, and mock fallback.
 */

import { useQuery } from '@tanstack/react-query';
import { datasourcesApi } from '@/api/datasources';
import type { DataSourceDto, HostDto, RegistryCatalogDto } from '@/types/api';
import { DATA_SOURCES } from '@/config/dataSources';

const USE_MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

/**
 * Convert static DATA_SOURCES to DTO format for mock mode
 */
function getMockStreamableDatasources(): DataSourceDto[] {
  return DATA_SOURCES.flatMap((source) =>
    source.radios.map((radio) => ({
      id: 0,
      sourceKey: radio.id,
      sourceType: 'spectrum',
      displayName: radio.name,
      state: source.enabled ? 'ONLINE' : 'OFFLINE',
      mqttTopic: radio.mqtt?.spectrumTopic || '',
      hostId: 0,
      hostKey: source.id,
      deviceId: 0,
      // In real API this is a stable unique device identifier; keep mock unique too.
      deviceKey: radio.id,
      capabilities: {},
      wsEndpoint: source.endpoint,
      wsPath: '',
      lastSeenAt: new Date().toISOString(),
    }))
  );
}

/**
 * Hook to fetch streamable datasources (spectrum/rawfeed with WS endpoints)
 * This is the primary hook for the Spectrum Viewer
 */
export function useStreamableDatasources() {
  return useQuery({
    queryKey: ['datasources', 'streamable'],
    queryFn: async (): Promise<DataSourceDto[]> => {
      if (USE_MOCK_API) {
        // Simulate network delay for more realistic behavior
        await new Promise((resolve) => setTimeout(resolve, 300));
        return getMockStreamableDatasources();
      }
      return datasourcesApi.listStreamable();
    },
    staleTime: 30_000, // 30 seconds
    refetchInterval: USE_MOCK_API ? false : 60_000, // Refresh every minute (real API only)
    retry: USE_MOCK_API ? false : 3,
  });
}

/**
 * Hook to fetch all datasources with optional state filter
 */
export function useDatasources(state?: string) {
  return useQuery({
    queryKey: ['datasources', state],
    queryFn: async (): Promise<DataSourceDto[]> => {
      if (USE_MOCK_API) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const mocks = getMockStreamableDatasources();
        if (state) {
          return mocks.filter((d) => d.state === state);
        }
        return mocks;
      }
      return datasourcesApi.list(state);
    },
    staleTime: 30_000,
    retry: USE_MOCK_API ? false : 3,
  });
}

/**
 * Hook to fetch full registry catalog
 */
export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: async (): Promise<RegistryCatalogDto> => {
      if (USE_MOCK_API) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Return minimal mock catalog
        return {
          broker: {},
          websocket: { host: 'localhost', port: 8090, protocol: 'ws' },
          hosts: DATA_SOURCES.map((source, index) => ({
            id: index,
            hostKey: source.id,
            hostName: source.name,
            ipAddress: '127.0.0.1',
            state: source.enabled ? 'ONLINE' : 'OFFLINE',
            lastSeenAt: new Date().toISOString(),
            services: [],
            devices: source.radios.map((radio, rIndex) => ({
              id: rIndex,
              deviceKey: radio.id,
              deviceType: String(radio.meta?.type || 'UNKNOWN'),
              serialNumber: '',
              state: 'ONLINE',
              lastSeenAt: new Date().toISOString(),
              meta: radio.meta || {},
            })),
            dataSources: source.radios.map((radio, rIndex) => ({
              id: rIndex,
              sourceKey: radio.id,
              sourceType: 'spectrum',
              displayName: radio.name,
              state: source.enabled ? 'ONLINE' : 'OFFLINE',
              mqttTopic: radio.mqtt?.spectrumTopic || '',
              wsEndpoint: source.endpoint,
              wsPath: '',
              capabilities: {},
            })),
            topics: [],
          })),
          generatedAt: new Date().toISOString(),
        };
      }
      return datasourcesApi.getCatalog();
    },
    staleTime: 30_000,
    retry: USE_MOCK_API ? false : 3,
  });
}

/**
 * Hook to fetch all hosts
 */
export function useHosts() {
  return useQuery({
    queryKey: ['hosts'],
    queryFn: async (): Promise<HostDto[]> => {
      if (USE_MOCK_API) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return DATA_SOURCES.map((source, index) => ({
          id: index,
          hostKey: source.id,
          hostName: source.name,
          ipAddress: '127.0.0.1',
          osName: 'Linux',
          osVersion: '5.15',
          arch: 'x86_64',
          agentVersion: '1.0.0',
          state: source.enabled ? 'ONLINE' : 'OFFLINE',
          lastSeenAt: new Date().toISOString(),
        }));
      }
      return datasourcesApi.getHosts();
    },
    staleTime: 30_000,
    retry: USE_MOCK_API ? false : 3,
  });
}

/**
 * Hook to fetch datasources for a specific host
 */
export function useDatasourcesByHost(hostId: number | undefined) {
  return useQuery({
    queryKey: ['datasources', 'host', hostId],
    queryFn: async (): Promise<DataSourceDto[]> => {
      if (!hostId && hostId !== 0) return [];
      if (USE_MOCK_API) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return getMockStreamableDatasources().filter((d) => d.hostId === hostId);
      }
      return datasourcesApi.byHost(hostId);
    },
    enabled: hostId !== undefined,
    staleTime: 30_000,
    retry: USE_MOCK_API ? false : 3,
  });
}
