/**
 * Binary Spectrum Frame Parser
 * 
 * Parses binary spectrum data from WebSocket.
 * 
 * Supports three formats:
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
 *
 * Format C - Native RDSD raw IQ frame (48 byte header + IQ payload):
 *   - header magic: 0x44534452 ("RDSD", little-endian)
 *   - center/sample rate/timestamp metadata in header
 *   - payload is interleaved IQ bytes
 *   - parser derives one FFT power row for waterfall rendering
 */

export interface BinarySpectrumFrame {
  ts: number;
  centerHz: number;
  spanHz: number;
  binHz: number;
  binsDbm: Float32Array;
}

const HEADER_SIZE = 28;
const RDSD_HEADER_SIZE = 48;
const RDSD_MAGIC = 0x44534452;

// Default frequency params when header is invalid or missing
const DEFAULT_CENTER_HZ = 100e6;  // 100 MHz
const DEFAULT_SPAN_HZ = 20e6;     // 20 MHz span
const RAW_MIN_NFFT = 128;
const RAW_MAX_NFFT = 4096;

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

function readUint64LE(view: DataView, offset: number): bigint {
  const lo = BigInt(view.getUint32(offset, true));
  const hi = BigInt(view.getUint32(offset + 4, true));
  return (hi << 32n) | lo;
}

function highestPowerOfTwoAtMost(value: number): number {
  let p2 = 1;
  while ((p2 << 1) <= value) {
    p2 <<= 1;
  }
  return p2;
}

function decodeIqSample(raw: number, iqFormat: number): number {
  if (iqFormat === 1) {
    const signed = raw > 127 ? raw - 256 : raw;
    return signed / 128.0;
  }
  return (raw - 127.5) / 128.0;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2.0 * Math.PI) / len;
    const wLenRe = Math.cos(ang);
    const wLenIm = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;

      for (let j = 0; j < len / 2; j++) {
        const u = i + j;
        const v = i + j + len / 2;

        const vr = re[v] * wRe - im[v] * wIm;
        const vi = re[v] * wIm + im[v] * wRe;

        re[v] = re[u] - vr;
        im[v] = im[u] - vi;
        re[u] = re[u] + vr;
        im[u] = im[u] + vi;

        const nextRe = wRe * wLenRe - wIm * wLenIm;
        const nextIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextRe;
        wIm = nextIm;
      }
    }
  }
}

function parseNativeRawIqFrame(buffer: ArrayBuffer): BinarySpectrumFrame | null {
  if (buffer.byteLength < RDSD_HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== RDSD_MAGIC) {
    return null;
  }

  try {
    const centerFreqHz = Number(readUint64LE(view, 8));
    const sampleRateHz = view.getUint32(16, true);
    const timestampNs = readUint64LE(view, 20);
    const payloadLen = view.getUint32(36, true);
    const iqFormat = view.getUint8(40);

    const availablePayload = Math.max(0, buffer.byteLength - RDSD_HEADER_SIZE);
    const iqLen = Math.min(payloadLen, availablePayload);
    const iqPairs = Math.floor(iqLen / 2);
    if (iqPairs < RAW_MIN_NFFT) {
      return null;
    }

    const nfft = Math.max(
      RAW_MIN_NFFT,
      Math.min(RAW_MAX_NFFT, highestPowerOfTwoAtMost(iqPairs))
    );

    const iqBytes = new Uint8Array(buffer, RDSD_HEADER_SIZE, iqLen);
    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);

    for (let i = 0; i < nfft; i++) {
      const ii = i * 2;
      const qq = ii + 1;
      if (qq >= iqBytes.length) {
        break;
      }

      let iVal = decodeIqSample(iqBytes[ii], iqFormat);
      let qVal = decodeIqSample(iqBytes[qq], iqFormat);

      const w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * i) / (nfft - 1));
      iVal *= w;
      qVal *= w;

      re[i] = iVal;
      im[i] = qVal;
    }

    fft(re, im);

    const binsCount = nfft;
    const binsDbm = new Float32Array(binsCount);
    const magScale = 1.0 / (nfft * nfft);
    for (let k = 0; k < binsCount; k++) {
      // Shift FFT so output bins map from -Fs/2..+Fs/2 around center frequency.
      const shifted = (k + nfft / 2) & (nfft - 1);
      const mag2 = (re[shifted] * re[shifted] + im[shifted] * im[shifted]) * magScale;
      binsDbm[k] = 10 * Math.log10(mag2 + 1e-15);
    }

    const parsedCenterHz = centerFreqHz > 1e3 && centerFreqHz < 1e12
      ? centerFreqHz
      : DEFAULT_CENTER_HZ;
    const parsedSpanHz = sampleRateHz > 0 ? sampleRateHz : DEFAULT_SPAN_HZ;
    const tsMsBigInt = timestampNs / 1000000n;
    const parsedTs = Number(tsMsBigInt);

    return {
      ts: Number.isFinite(parsedTs) && parsedTs > 0 ? parsedTs : Date.now(),
      centerHz: parsedCenterHz,
      spanHz: parsedSpanHz,
      binHz: parsedSpanHz / binsDbm.length,
      binsDbm,
    };
  } catch (e) {
    console.error('[BinaryParser] Failed to parse native raw IQ frame:', e);
    return null;
  }
}

/**
 * Parse binary ArrayBuffer to SpectrumFrame
 * Tries Format C first (native IQ), then Format A, then falls back to Format B.
 */
export function parseBinarySpectrumFrame(buffer: ArrayBuffer): BinarySpectrumFrame | null {
  if (buffer.byteLength < 4) {
    return null;
  }

  try {
    const nativeRawFrame = parseNativeRawIqFrame(buffer);
    if (nativeRawFrame) {
      console.debug('[BinaryParser] Format C (native raw IQ):', {
        centerHz: nativeRawFrame.centerHz / 1e6,
        spanHz: nativeRawFrame.spanHz / 1e6,
        binCount: nativeRawFrame.binsDbm.length,
      });
      return nativeRawFrame;
    }

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
