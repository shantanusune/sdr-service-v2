import { useRef, useCallback, useEffect, useState } from "react";
import type { SpectrumFrame, FilterConfig, MatchResult } from "@/types/sdr";

interface WorkerOutput {
  type?: "result" | "testResult";
  matches?: MatchResult[];
  result?: MatchResult | null;
  testResult?: MatchResult | null;
}

/**
 * Hook to run filter evaluation in a Web Worker
 */
export function useFilterWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const pendingCallbackRef = useRef<((output: WorkerOutput) => void) | null>(null);

  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL("../workers/filterWorker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (event: MessageEvent<WorkerOutput>) => {
      if (pendingCallbackRef.current) {
        const payload = event.data;
        if (payload?.type === "testResult") {
          pendingCallbackRef.current({
            matches: [],
            testResult: payload.result ?? payload.testResult ?? null,
          });
        } else {
          pendingCallbackRef.current({
            matches: payload?.matches ?? [],
            testResult: payload?.testResult ?? null,
          });
        }
        pendingCallbackRef.current = null;
      }
    };

    workerRef.current.onerror = (error) => {
      console.error("[FilterWorker] Error:", error);
    };

    setIsReady(true);

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * Evaluate filters against a frame (normal mode)
   */
  const evaluate = useCallback(
    (
      frame: SpectrumFrame,
      enabledFilters: FilterConfig[],
      onResult: (matches: MatchResult[]) => void,
      radioKey?: string
    ) => {
      if (!workerRef.current) {
        console.warn("[FilterWorker] Worker not ready");
        return;
      }

      pendingCallbackRef.current = (output) => onResult(output.matches ?? []);
      workerRef.current.postMessage({ type: "evaluate", frame, enabledFilters, radioKey });
    },
    []
  );

  /**
   * Test a single filter (test mode - no cooldown)
   */
  const testFilter = useCallback(
    (
      frame: SpectrumFrame,
      filter: FilterConfig,
      onResult: (result: MatchResult | null) => void,
      radioKey?: string
    ) => {
      if (!workerRef.current) {
        console.warn("[FilterWorker] Worker not ready");
        return;
      }

      pendingCallbackRef.current = (output) => onResult(output.testResult ?? null);
      workerRef.current.postMessage({
        type: "test",
        frame,
        filter,
        radioKey,
      });
    },
    []
  );

  /**
   * Reset cooldowns
   */
  const resetCooldowns = useCallback(() => {
    workerRef.current?.postMessage({ type: "command", command: "reset" });
  }, []);

  /**
   * Clear all temporal state
   */
  const clearState = useCallback(() => {
    workerRef.current?.postMessage({ type: "command", command: "clear" });
  }, []);

  return { evaluate, testFilter, resetCooldowns, clearState, isReady };
}
