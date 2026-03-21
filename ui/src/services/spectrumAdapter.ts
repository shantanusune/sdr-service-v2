import type { SpectrumFrame } from "@/types/sdr";
import type { BinarySpectrumFrame } from "./stream/binaryParser";

/**
 * Spectrum Adapter - Normalizes raw spectrum payloads to SpectrumFrame.
 * 
 * Supports two input formats:
 * 1. Binary format (BinarySpectrumFrame) - parsed from WebSocket ArrayBuffer
 * 2. JSON format - legacy or fallback from JSON WebSocket messages
 * 
 * Expected JSON payload format (adjust as needed):
 * {
 *   ts: number,           // timestamp in ms
 *   cf: number,           // center frequency in Hz
 *   sr: number,           // sample rate / span in Hz
 *   binHz: number,        // Hz per bin (optional, calculated from sr/bins.length)
 *   bins: number[],       // power values in dBm
 *   frameId?: string      // optional frame identifier
 * }
 */

/**
 * Convert BinarySpectrumFrame to SpectrumFrame (direct mapping)
 */
export function fromBinaryFrame(frame: BinarySpectrumFrame): SpectrumFrame {
  return {
    ts: frame.ts,
    centerHz: frame.centerHz,
    spanHz: frame.spanHz,
    binHz: frame.binHz,
    binsDbm: Array.from(frame.binsDbm),
  };
}

/**
 * Check if payload is a BinarySpectrumFrame with valid data
 */
export function isBinarySpectrumFrame(payload: unknown): payload is BinarySpectrumFrame {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;

  // Check structure
  const bins = p.binsDbm as unknown;
  const isBinsArray = Array.isArray(bins) || bins instanceof Float32Array;

  if (
    typeof p.ts !== 'number' ||
    typeof p.centerHz !== 'number' ||
    typeof p.spanHz !== 'number' ||
    typeof p.binHz !== 'number' ||
    !isBinsArray
  ) {
    return false;
  }

  // Validate that header values are reasonable (not garbage from parsing errors)
  const isValidCenter = p.centerHz > 1e3 && p.centerHz < 1e12 && isFinite(p.centerHz);
  const isValidSpan = p.spanHz > 0 && p.spanHz < 1e11 && isFinite(p.spanHz);

  return isValidCenter && isValidSpan;
}

/**
 * Convert raw payload to SpectrumFrame.
 * Handles both BinarySpectrumFrame and JSON formats.
 */
export function toSpectrumFrame(raw: unknown): SpectrumFrame | null {
  // Handle binary frame format (from WebSocket binary parser)
  if (isBinarySpectrumFrame(raw)) {
    return fromBinaryFrame(raw);
  }

  // Handle JSON format
  if (!raw || typeof raw !== "object") {
    console.warn("[SpectrumAdapter] Invalid payload: not an object");
    return null;
  }

  const payload = raw as Record<string, unknown>;

  // Extract timestamp
  const ts = extractNumber(payload, ["ts", "timestamp", "time"]);
  if (ts === null) {
    console.warn("[SpectrumAdapter] Missing timestamp field");
    return null;
  }

  // Extract center frequency
  const centerHz = extractNumber(payload, ["cf", "centerFrequency", "centerHz", "center_frequency"]);
  if (centerHz === null) {
    console.warn("[SpectrumAdapter] Missing center frequency field");
    return null;
  }

  // Extract span/sample rate
  const spanHz = extractNumber(payload, ["sr", "sampleRate", "spanHz", "span", "sample_rate"]);
  if (spanHz === null) {
    console.warn("[SpectrumAdapter] Missing span/sample rate field");
    return null;
  }

  // Extract bins array
  const binsDbm = extractNumberArray(payload, ["bins", "data", "values", "powers", "spectrum", "binsDbm"]);
  if (binsDbm === null || binsDbm.length === 0) {
    console.warn("[SpectrumAdapter] Missing or empty bins array");
    return null;
  }

  // Calculate or extract binHz
  let binHz = extractNumber(payload, ["binHz", "bin_hz", "freqStep"]);
  if (binHz === null) {
    binHz = spanHz / binsDbm.length;
  }

  // Extract optional frameId
  const frameId = extractString(payload, ["frameId", "frame_id", "id", "seq"]);

  return {
    ts,
    centerHz,
    spanHz,
    binHz,
    binsDbm,
    frameId: frameId ?? undefined,
  };
}

/**
 * Helper to extract a number from payload trying multiple field names
 */
function extractNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && !isNaN(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Helper to extract a number array from payload trying multiple field names
 */
function extractNumberArray(payload: Record<string, unknown>, keys: string[]): number[] | null {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
      return value as number[];
    }
  }
  return null;
}

/**
 * Helper to extract a string from payload trying multiple field names
 */
function extractString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
}
