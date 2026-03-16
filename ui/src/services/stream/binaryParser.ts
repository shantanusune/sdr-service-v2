/**
 * Binary Spectrum Frame Parser
 * 
 * Parses binary spectrum data from WebSocket.
 * 
 * Supports two formats:
 * 
 * Format A - Header + bins (28 byte header):
 *   - timestamp: Float64 (8 bytes) - Unix timestamp in ms
 *   - centerHz: Float64 (8 bytes) - Center frequency in Hz
 *   - spanHz: Float64 (8 bytes) - Span/bandwidth in Hz
 *   - binCount: Uint32 (4 bytes) - Number of bins
 *   - bins: Float32[] (binCount * 4 bytes) - Power values in dBm
 * 
 * Format B - Raw Float32 bins only:
 *   - No header, just raw Float32 power values
 *   - Uses default frequency parameters
 */

export interface BinarySpectrumFrame {
  ts: number;
  centerHz: number;
  spanHz: number;
  binHz: number;
  binsDbm: Float32Array;
}

const HEADER_SIZE = 28;

// Default frequency params when header is invalid or missing
const DEFAULT_CENTER_HZ = 100e6;  // 100 MHz
const DEFAULT_SPAN_HZ = 20e6;     // 20 MHz span

/**
 * Validate if header values are reasonable
 */
function isValidHeader(ts: number, centerHz: number, spanHz: number): boolean {
  // Check for garbage values (extremely small/large numbers indicate parsing errors)
  const isValidTs = ts > 0 && ts < 1e15 && isFinite(ts);
  const isValidCenter = centerHz > 1e3 && centerHz < 1e12 && isFinite(centerHz); // 1 kHz to 1 THz
  const isValidSpan = spanHz > 0 && spanHz < 1e11 && isFinite(spanHz); // Up to 100 GHz span
  
  return isValidTs && isValidCenter && isValidSpan;
}

/**
 * Check if a dBm value is valid (reasonable power level)
 */
function isValidDbm(value: number): boolean {
  return isFinite(value) && value >= -200 && value <= 50;
}

/**
 * Parse binary ArrayBuffer to SpectrumFrame
 * Tries Format A first, falls back to Format B if header is invalid
 */
export function parseBinarySpectrumFrame(buffer: ArrayBuffer): BinarySpectrumFrame | null {
  if (buffer.byteLength < 4) {
    return null;
  }

  try {
    const view = new DataView(buffer);

    // Try Format A: Header + bins (28-byte header)
    if (buffer.byteLength >= HEADER_SIZE) {
      // Try little-endian first
      let ts = view.getFloat64(0, true);
      let centerHz = view.getFloat64(8, true);
      let spanHz = view.getFloat64(16, true);
      let binCount = view.getUint32(24, true);

      // If little-endian fails, try big-endian
      if (!isValidHeader(ts, centerHz, spanHz)) {
        ts = view.getFloat64(0, false);
        centerHz = view.getFloat64(8, false);
        spanHz = view.getFloat64(16, false);
        binCount = view.getUint32(24, false);
      }

      const expectedDataSize = binCount * 4;
      const actualDataSize = buffer.byteLength - HEADER_SIZE;

      // Validate header and bin count
      if (
        isValidHeader(ts, centerHz, spanHz) &&
        binCount > 0 &&
        binCount < 100000 &&
        actualDataSize >= expectedDataSize
      ) {
        const binsDbm = new Float32Array(buffer, HEADER_SIZE, binCount);
        const binHz = binCount > 0 ? spanHz / binCount : 0;
        
        console.debug('[BinaryParser] Format A:', { centerHz: centerHz / 1e6, spanHz: spanHz / 1e6, binCount });
        return { ts, centerHz, spanHz, binHz, binsDbm };
      }
    }

    // Format B: Raw Float32 bins (no header or invalid header)
    const binCount = Math.floor(buffer.byteLength / 4);
    if (binCount < 10) {
      return null;
    }

    const binsView = new Float32Array(buffer);
    
    // Try to detect frequency metadata in the first few floats
    let detectedCenterHz = DEFAULT_CENTER_HZ;
    let detectedSpanHz = DEFAULT_SPAN_HZ;
    let validStart = 0;
    
    // Check if first values look like frequency metadata (large Hz values)
    const firstVal = binsView[0];
    const secondVal = binsView[1];
    
    // If first value looks like a center frequency (1MHz - 10GHz range as float)
    if (firstVal > 1e6 && firstVal < 1e10 && isFinite(firstVal)) {
      detectedCenterHz = firstVal;
      validStart = 1;
      
      // Check if second value looks like span (1kHz - 1GHz range)
      if (secondVal > 1e3 && secondVal < 1e9 && isFinite(secondVal)) {
        detectedSpanHz = secondVal;
        validStart = 2;
      }
    }

    // Find where valid dBm values start (skip any remaining garbage)
    for (let i = validStart; i < Math.min(validStart + 20, binCount); i++) {
      if (isValidDbm(binsView[i])) {
        validStart = i;
        break;
      }
    }

    const binsDbm = binsView.subarray(validStart);
    if (binsDbm.length < 10) {
      return null;
    }

    const binHz = detectedSpanHz / binsDbm.length;

    console.debug('[BinaryParser] Format B:', { 
      centerHz: detectedCenterHz / 1e6, 
      spanHz: detectedSpanHz / 1e6, 
      binCount: binsDbm.length,
      autoDetected: validStart > 0
    });

    return {
      ts: Date.now(),
      centerHz: detectedCenterHz,
      spanHz: detectedSpanHz,
      binHz,
      binsDbm,
    };
  } catch (e) {
    console.error('[BinaryParser] Failed to parse frame:', e);
    return null;
  }
}

/**
 * Check if data appears to be binary (ArrayBuffer or Blob)
 */
export function isBinaryData(data: unknown): data is ArrayBuffer | Blob {
  return data instanceof ArrayBuffer || data instanceof Blob;
}

/**
 * Convert Blob to ArrayBuffer
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}
