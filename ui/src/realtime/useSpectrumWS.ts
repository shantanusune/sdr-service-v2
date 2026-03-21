import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketStreamClient } from '@/services/stream/WebSocketStreamClient';
import { MockStreamClient } from '@/services/stream/MockStreamClient';
import type { StreamClient, SpectrumMessage } from '@/services/stream/StreamClient';
import { toSpectrumFrame } from '@/services/spectrumAdapter';
import type { SpectrumFrame } from '@/types/sdr';
import type { DataSource } from '@/types/sources';

const USE_MOCK_API = import.meta.env.VITE_MOCK_API === 'true';

interface SpectrumCache {
  [radioKey: string]: {
    frame: SpectrumFrame;
    timestamp: number;
  };
}

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

/**
 * Hook for subscribing to spectrum data from multiple datasources.
 * Uses the new WebSocketStreamClient architecture with proper datasource/radio IDs.
 */
export function useSpectrumWS(options: UseSpectrumWSOptions = {}): UseSpectrumWSResult {
  const { fps = 20 } = options;
  const flushIntervalMs = Math.max(16, Math.floor(1000 / Math.min(60, Math.max(5, fps))));
  const [isConnected, setIsConnected] = useState(false);
  const [spectrumData, setSpectrumData] = useState<SpectrumCache>({});
  const [isPaused, setIsPaused] = useState(false);

  const clientsRef = useRef<Map<string, StreamClient>>(new Map());
  const connectionStateRef = useRef<Map<string, boolean>>(new Map());
  const pausedRef = useRef(false);

  // Buffer incoming frames and flush to React state at a capped rate.
  const latestRef = useRef<SpectrumCache>({});
  const flushTimerRef = useRef<number | null>(null);
  const lastFlushRef = useRef(0);

  const flushNow = useCallback(() => {
    flushTimerRef.current = null;
    lastFlushRef.current = Date.now();

    // Shallow clone so React sees a new object, but frames are referenced (no bin copies).
    setSpectrumData({ ...latestRef.current });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;

    const now = Date.now();
    const elapsed = now - lastFlushRef.current;
    const delay = Math.max(0, flushIntervalMs - elapsed);

    flushTimerRef.current = window.setTimeout(flushNow, delay);
  }, [flushNow, flushIntervalMs]);

  const handleSpectrumMessage = useCallback(
    (msg: SpectrumMessage) => {
      if (pausedRef.current) return;

      const frame = toSpectrumFrame(msg.payload);
      if (!frame) return;

      const key = `${msg.sourceId}:${msg.radioId}`;
      latestRef.current[key] = {
        frame,
        timestamp: Date.now(),
      };

      scheduleFlush();
    },
    [scheduleFlush]
  );

  const recomputeConnected = useCallback(() => {
    for (const connected of connectionStateRef.current.values()) {
      if (connected) {
        setIsConnected(true);
        return;
      }
    }
    setIsConnected(false);
  }, []);

  const subscribe = useCallback(
    (sources: DataSource[], radioIds: string[]) => {
      void (async () => {
        // Disconnect existing clients
        const existing = Array.from(clientsRef.current.values());
        clientsRef.current.clear();
        connectionStateRef.current.clear();
        await Promise.allSettled(existing.map((c) => c.disconnect()));

        latestRef.current = {};
        setSpectrumData({});

        if (radioIds.length === 0) {
          setIsConnected(false);
          return;
        }

        // IMPORTANT:
        // Spectrum Lab can select radios that each specify their own wsEndpoint/wsPath.
        // A single websocket connection cannot reliably multiplex multiple binary feeds
        // (binary frames do not include sourceId/radioId), so we must connect per-radio.
        await Promise.allSettled(
          radioIds.map(async (radioKey) => {
            // radioKey format: "sourceId:radioId"
            const [sourceId, radioId] = radioKey.includes(':') ? radioKey.split(':') : [radioKey, radioKey];
            const source = sources.find((s) => s.id === sourceId);
            if (!source) return;

            const radio = source.radios.find((r) => r.id === radioId);

            try {
              let client: StreamClient;
              let clientKey = radioKey;

              if (USE_MOCK_API) {
                client = new MockStreamClient(sourceId);
              } else {
                const wsEndpoint = String(radio?.meta?.wsEndpoint || source.endpoint);
                const wsPath = String(radio?.meta?.wsPath || '');
                const endpoint = wsPath ? new URL(wsPath, wsEndpoint).toString() : wsEndpoint;
                clientKey = `${radioKey}@${endpoint}`;
                client = new WebSocketStreamClient(sourceId, endpoint);
              }

              // Register handler BEFORE connect to avoid races where binary frames arrive immediately.
              client.onSpectrum(handleSpectrumMessage);

              client.onStatus((status) => {
                connectionStateRef.current.set(clientKey, Boolean(status.connected));
                recomputeConnected();
              });

              client.onError((error) => {
                console.error(`[useSpectrumWS] Error from ${sourceId}/${radioId}:`, error);
              });

              // Subscribe this socket to ONLY this radio.
              await client.subscribeSpectrum(sourceId, radioId);

              clientsRef.current.set(clientKey, client);
              connectionStateRef.current.set(clientKey, false);
              await client.connect();
            } catch (e) {
              console.error(`[useSpectrumWS] Failed to connect to ${sourceId}/${radioId}:`, e);
              connectionStateRef.current.set(radioKey, false);
              recomputeConnected();
            }
          })
        );
      })();
    },
    [handleSpectrumMessage, recomputeConnected]
  );

  const unsubscribe = useCallback(() => {
    void (async () => {
      const clients = Array.from(clientsRef.current.values());
      clientsRef.current.clear();
      connectionStateRef.current.clear();
      await Promise.allSettled(clients.map((c) => c.disconnect()));

      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      latestRef.current = {};
      setIsConnected(false);
      setSpectrumData({});
    })();
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void (async () => {
        const clients = Array.from(clientsRef.current.values());
        clientsRef.current.clear();
        await Promise.allSettled(clients.map((c) => c.disconnect()));
      })();

      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  return {
    isConnected,
    spectrumData,
    subscribe,
    unsubscribe,
    pause,
    resume,
    isPaused,
  };
}

