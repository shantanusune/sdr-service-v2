import type {
  SpectrumFrame,
  FilterConfig,
  MatchResult,
  FrameHistoryEntry,
  RadioTemporalState,
  InferenceCategory,
} from "@/types/sdr";

/**
 * Filter Engine - Evaluates spectrum frames against filter configurations.
 * This module is designed to run in a Web Worker for performance.
 * 
 * Features:
 * - Cooldown tracking per filter
 * - Noise floor estimation
 * - Temporal ring buffer per radio
 * - Confidence scoring (0-1)
 * - Support for all inference categories
 */

// =============================================================================
// STATE
// =============================================================================

// Cooldown tracking - in-memory per filter
const lastMatchTimes: Map<string, number> = new Map();

// Temporal state per radio for time-based analysis
const radioStates: Map<string, RadioTemporalState> = new Map();

const DEFAULT_HISTORY_SIZE = 100;

// =============================================================================
// MAIN EVALUATION
// =============================================================================

/**
 * Evaluate all enabled filters against a spectrum frame
 */
export function evaluateFilters(
  frame: SpectrumFrame,
  filters: FilterConfig[],
  radioKey?: string
): MatchResult[] {
  const results: MatchResult[] = [];
  const now = Date.now();

  // Update temporal state if radio key provided
  if (radioKey) {
    updateTemporalState(radioKey, frame);
  }

  for (const filter of filters) {
    if (!filter.enabled) continue;
    if (filter.scope === "disabled") continue;

    // Check cooldown
    const lastMatch = lastMatchTimes.get(filter.id) || 0;
    if (now - lastMatch < filter.cooldownMs) continue;

    const match = evaluateFilter(frame, filter, radioKey);
    if (match) {
      lastMatchTimes.set(filter.id, now);
      results.push(match);
    }
  }

  return results;
}

/**
 * Evaluate a single filter (for test mode)
 */
export function evaluateFilterSingle(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  return evaluateFilter(frame, filter, radioKey);
}

// =============================================================================
// FILTER DISPATCH
// =============================================================================

function evaluateFilter(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  switch (filter.type) {
    // A: Carrier & Energy Detection
    case "peak_in_band":
      return evaluatePeakInBand(frame, filter);
    case "threshold_in_band":
      return evaluateThresholdInBand(frame, filter);
    case "avg_power_in_band":
      return evaluateAvgPowerInBand(frame, filter);
    case "new_emission":
      return evaluateNewEmission(frame, filter, radioKey);

    // B: Bandwidth & Occupancy
    case "occupied_bandwidth":
      return evaluateOccupiedBandwidth(frame, filter);
    case "occupancy_percent":
      return evaluateOccupancyPercent(frame, filter);
    case "channelized_energy":
      return evaluateChannelizedEnergy(frame, filter);

    // C: Temporal Behavior
    case "burst_detector":
      return evaluateBurstDetector(frame, filter, radioKey);
    case "continuous_signal":
      return evaluateContinuousSignal(frame, filter, radioKey);
    case "periodic_burst":
      return evaluatePeriodicBurst(frame, filter, radioKey);
    case "disappearing_signal":
      return evaluateDisappearingSignal(frame, filter, radioKey);

    // D: Structural / Shape
    case "single_peak":
      return evaluateSinglePeak(frame, filter);
    case "multi_peak":
      return evaluateMultiPeak(frame, filter);
    case "harmonics":
      return evaluateHarmonics(frame, filter);
    case "template_corr":
      return evaluateTemplateCorr(frame, filter);
    case "multi_band_combo":
      return evaluateMultiBandCombo(frame, filter);

    // E: Movement / Change
    case "frequency_hopping":
      return evaluateFrequencyHopping(frame, filter, radioKey);
    case "drifting_carrier":
      return evaluateDriftingCarrier(frame, filter, radioKey);
    case "power_ramp":
      return evaluatePowerRamp(frame, filter, radioKey);

    // F: Domain-specific heuristics
    case "broadcast_fm_like":
      return evaluateBroadcastFmLike(frame, filter);
    case "narrowband_fm_voice":
      return evaluateNarrowbandFmVoice(frame, filter);
    case "am_voice_like":
      return evaluateAmVoiceLike(frame, filter);
    case "cw_morse_like":
      return evaluateCwMorseLike(frame, filter);
    case "digital_burst_cluster":
      return evaluateDigitalBurstCluster(frame, filter, radioKey);
    case "unknown_emitter":
      return evaluateUnknownEmitter(frame, filter, radioKey);

    default:
      return null;
  }
}

// =============================================================================
// A: CARRIER & ENERGY DETECTION
// =============================================================================

function evaluatePeakInBand(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.peakThresholdDbm ?? -50;
  const prominence = filter.params.peakProminenceDb ?? 0;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    let peakPower = -Infinity;
    let peakBin = startBin;

    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] > peakPower) {
        peakPower = frame.binsDbm[i];
        peakBin = i;
      }
    }

    // Check prominence if required
    if (prominence > 0) {
      const neighbors = getNeighborAvg(frame.binsDbm, peakBin, 5);
      if (peakPower - neighbors < prominence) continue;
    }

    if (peakPower >= threshold) {
      const peakHz = binToHz(frame, peakBin);
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, (peakPower - threshold + 20) / 40),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakHz,
        peakDbm: peakPower,
        reason: `Peak ${peakPower.toFixed(1)} dBm at ${formatHz(peakHz)} >= ${threshold} dBm`,
      };
    }
  }
  return null;
}

function evaluateThresholdInBand(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.thresholdDbm ?? -50;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] >= threshold) {
        const triggerHz = binToHz(frame, i);
        return {
          filterId: filter.id,
          filterName: filter.name,
          ts: frame.ts,
          score: Math.min(1, (frame.binsDbm[i] - threshold + 10) / 30),
          severity: filter.severity,
          category: filter.category,
          bandHz: { start: band.startHz, end: band.endHz },
          bins: { startBin, endBin },
          peakDbm: frame.binsDbm[i],
          reason: `Bin at ${formatHz(triggerHz)} = ${frame.binsDbm[i].toFixed(1)} dBm >= ${threshold} dBm`,
        };
      }
    }
  }
  return null;
}

function evaluateAvgPowerInBand(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.avgThresholdDbm ?? -60;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { avg, peak } = getBandStats(frame.binsDbm, startBin, endBin);

    if (avg >= threshold) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, (avg - threshold + 10) / 30),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakDbm: peak,
        reason: `Average ${avg.toFixed(1)} dBm >= ${threshold} dBm`,
      };
    }
  }
  return null;
}

function evaluateNewEmission(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey) return null;
  const state = radioStates.get(radioKey);
  if (!state || !state.baseline) return null;

  const thresholdDb = filter.params.baselineThresholdDb ?? 10;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { peak } = getBandStats(frame.binsDbm, startBin, endBin);

    if (peak - state.baseline.avgDbm >= thresholdDb) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, (peak - state.baseline.avgDbm - thresholdDb + 10) / 20),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakDbm: peak,
        reason: `New emission: ${peak.toFixed(1)} dBm is ${(peak - state.baseline.avgDbm).toFixed(1)} dB above baseline`,
      };
    }
  }
  return null;
}

// =============================================================================
// B: BANDWIDTH & OCCUPANCY
// =============================================================================

function evaluateOccupiedBandwidth(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const minBw = filter.params.minBandwidthHz ?? 0;
  const maxBw = filter.params.maxBandwidthHz ?? Infinity;
  const threshold = filter.params.occupancyThresholdDbm ?? -90;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const occupiedBins = measureOccupiedBandwidth(frame.binsDbm, startBin, endBin, threshold);
    const occupiedHz = occupiedBins * frame.binHz;

    if (occupiedHz >= minBw && occupiedHz <= maxBw) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: 0.8,
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        occupiedBandwidthHz: occupiedHz,
        reason: `Occupied bandwidth: ${formatHz(occupiedHz)} (range: ${formatHz(minBw)}-${formatHz(maxBw)})`,
      };
    }
  }
  return null;
}

function evaluateOccupancyPercent(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.occupancyThresholdDbm ?? -90;
  const minPercent = filter.params.occupancyPercentMin ?? 0;
  const maxPercent = filter.params.occupancyPercentMax ?? 100;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    let aboveCount = 0;
    const totalBins = endBin - startBin + 1;

    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] >= threshold) aboveCount++;
    }

    const percent = (aboveCount / totalBins) * 100;

    if (percent >= minPercent && percent <= maxPercent) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, percent / 100),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        occupancyPercent: percent,
        reason: `Occupancy: ${percent.toFixed(1)}% above ${threshold} dBm`,
      };
    }
  }
  return null;
}

function evaluateChannelizedEnergy(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const spacing = filter.params.channelSpacingHz ?? 25000;
  const minPeaks = filter.params.minPeakCount ?? 3;
  const threshold = filter.params.peakThresholdDbm ?? -80;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, 5);

    // Check if peaks are evenly spaced
    if (peaks.length >= minPeaks) {
      const peakHzList = peaks.map((b) => binToHz(frame, b));
      const spacingBins = Math.round(spacing / frame.binHz);
      
      let channelizedCount = 0;
      for (let i = 1; i < peaks.length; i++) {
        const diff = peaks[i] - peaks[i - 1];
        if (Math.abs(diff - spacingBins) < spacingBins * 0.2) {
          channelizedCount++;
        }
      }

      if (channelizedCount >= minPeaks - 1) {
        return {
          filterId: filter.id,
          filterName: filter.name,
          ts: frame.ts,
          score: Math.min(1, channelizedCount / (peaks.length - 1)),
          severity: filter.severity,
          category: filter.category,
          bandHz: { start: band.startHz, end: band.endHz },
          bins: { startBin, endBin },
          reason: `${peaks.length} channelized peaks with ~${formatHz(spacing)} spacing`,
        };
      }
    }
  }
  return null;
}

// =============================================================================
// C: TEMPORAL BEHAVIOR
// =============================================================================

function evaluateBurstDetector(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey) return evaluateThresholdInBand(frame, filter);
  
  const state = radioStates.get(radioKey);
  if (!state || state.history.length < 2) return null;

  const riseDb = filter.params.burstRiseDb ?? 15;
  const prevEntry = state.history[state.history.length - 2];

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { peak } = getBandStats(frame.binsDbm, startBin, endBin);
    const rise = peak - prevEntry.peakDbm;

    if (rise >= riseDb) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, rise / (riseDb * 2)),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakDbm: peak,
        reason: `Burst detected: +${rise.toFixed(1)} dB rise in ${frame.ts - prevEntry.ts}ms`,
      };
    }
  }
  return null;
}

function evaluateContinuousSignal(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey) return null;
  
  const state = radioStates.get(radioKey);
  if (!state) return null;

  const minFrames = filter.params.minConsecutiveFrames ?? 10;
  const threshold = filter.params.thresholdDbm ?? -80;

  if (state.history.length < minFrames) return null;

  // Check last N frames all have signal above threshold
  const recentHistory = state.history.slice(-minFrames);
  const allAbove = recentHistory.every((h) => h.peakDbm >= threshold);

  if (allAbove) {
    const band = filter.bands[0];
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.9,
      severity: filter.severity,
      category: filter.category,
      bandHz: band ? { start: band.startHz, end: band.endHz } : undefined,
      reason: `Continuous signal for ${minFrames} frames above ${threshold} dBm`,
    };
  }
  return null;
}

function evaluatePeriodicBurst(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  // Placeholder - requires FFT of temporal pattern
  return null;
}

function evaluateDisappearingSignal(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey) return null;
  
  const state = radioStates.get(radioKey);
  if (!state || state.history.length < 5) return null;

  const threshold = filter.params.thresholdDbm ?? -80;
  const dropDb = filter.params.burstRiseDb ?? 15;

  // Check if signal was present but now gone
  const recentHistory = state.history.slice(-5);
  const wasPresent = recentHistory.slice(0, 3).some((h) => h.peakDbm >= threshold);
  const currentPeak = recentHistory[recentHistory.length - 1].peakDbm;
  const previousPeak = recentHistory[recentHistory.length - 3].peakDbm;

  if (wasPresent && previousPeak - currentPeak >= dropDb) {
    const band = filter.bands[0];
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.7,
      severity: filter.severity,
      category: filter.category,
      bandHz: band ? { start: band.startHz, end: band.endHz } : undefined,
      reason: `Signal disappeared: dropped ${(previousPeak - currentPeak).toFixed(1)} dB`,
    };
  }
  return null;
}

// =============================================================================
// D: STRUCTURAL / SHAPE
// =============================================================================

function evaluateSinglePeak(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.peakThresholdDbm ?? -70;
  const prominence = filter.params.peakProminenceDb ?? 10;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, prominence);

    if (peaks.length === 1) {
      const peakHz = binToHz(frame, peaks[0]);
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: 0.9,
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakHz,
        peakDbm: frame.binsDbm[peaks[0]],
        reason: `Single dominant peak at ${formatHz(peakHz)}`,
      };
    }
  }
  return null;
}

function evaluateMultiPeak(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.peakThresholdDbm ?? -80;
  const minPeaks = filter.params.minPeakCount ?? 2;
  const prominence = filter.params.peakProminenceDb ?? 8;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, prominence);

    if (peaks.length >= minPeaks) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, peaks.length / (minPeaks * 2)),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        reason: `${peaks.length} distinct peaks detected`,
      };
    }
  }
  return null;
}

function evaluateHarmonics(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const fundamentalHz = filter.params.fundamentalHz;
  const harmonicCount = filter.params.harmonicCount ?? 3;
  const tolerance = filter.params.harmonicToleranceHz ?? 100000;
  const threshold = filter.params.peakThresholdDbm ?? -70;

  if (!fundamentalHz) return null;

  let foundHarmonics = 0;
  const foundFreqs: number[] = [];

  for (let h = 1; h <= harmonicCount; h++) {
    const targetHz = fundamentalHz * h;
    const { startBin, endBin } = getBinRange(frame, targetHz - tolerance, targetHz + tolerance);
    
    if (startBin >= 0 && endBin < frame.binsDbm.length) {
      const { peak, peakBin } = getBandStatsWithPeakBin(frame.binsDbm, startBin, endBin);
      if (peak >= threshold) {
        foundHarmonics++;
        foundFreqs.push(binToHz(frame, peakBin));
      }
    }
  }

  if (foundHarmonics >= 2) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: foundHarmonics / harmonicCount,
      severity: filter.severity,
      category: filter.category,
      reason: `Found ${foundHarmonics}/${harmonicCount} harmonics: ${foundFreqs.map(formatHz).join(", ")}`,
    };
  }
  return null;
}

function evaluateTemplateCorr(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const template = filter.params.template;
  const corrThreshold = filter.params.corrThreshold ?? 0.8;

  if (!template || template.length === 0) return null;
  if (filter.bands.length === 0) return null;

  const band = filter.bands[0];
  const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
  if (startBin < 0 || endBin >= frame.binsDbm.length) return null;

  const bandBins = frame.binsDbm.slice(startBin, endBin + 1);
  const resampled = resampleArray(bandBins, template.length);
  const corr = normalizedCorrelation(resampled, template);

  if (corr >= corrThreshold) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: corr,
      correlationScore: corr,
      severity: filter.severity,
      category: filter.category,
      bandHz: { start: band.startHz, end: band.endHz },
      bins: { startBin, endBin },
      reason: `Template match: ${(corr * 100).toFixed(1)}% correlation`,
    };
  }
  return null;
}

function evaluateMultiBandCombo(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const logic = filter.params.comboLogic ?? "AND";
  const bandThresholds = filter.params.bandThresholds ?? [];

  if (bandThresholds.length === 0 || filter.bands.length === 0) return null;

  const results: boolean[] = [];
  const scores: number[] = [];

  for (const bt of bandThresholds) {
    if (bt.bandIndex >= filter.bands.length) continue;

    const band = filter.bands[bt.bandIndex];
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) {
      results.push(false);
      continue;
    }

    const { peak } = getBandStats(frame.binsDbm, startBin, endBin);
    scores.push(peak);
    results.push(peak >= bt.thresholdDbm);
  }

  const matched = logic === "AND" ? results.every(Boolean) : results.some(Boolean);

  if (matched) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: Math.max(...scores.map((s) => Math.min(1, (s + 100) / 100))),
      severity: filter.severity,
      category: filter.category,
      reason: `Multi-band ${logic}: ${results.map((r, i) => `Band${i + 1}=${r ? "✓" : "✗"}`).join(", ")}`,
    };
  }
  return null;
}

// =============================================================================
// E: MOVEMENT / CHANGE
// =============================================================================

function evaluateFrequencyHopping(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey || filter.bands.length < 2) return null;
  
  const state = radioStates.get(radioKey);
  if (!state || state.history.length < 3) return null;

  const threshold = filter.params.thresholdDbm ?? -60;
  const windowSize = filter.params.frameWindowSize ?? 10;

  // Check if signal appeared in different bands over recent history
  // Simplified: check if current frame has signal in different band than recent history

  const recentHistory = state.history.slice(-Math.min(windowSize, state.history.length));
  
  // For each band, check if signal appeared
  const bandActivity = filter.bands.map((band) => {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) return false;
    const { peak } = getBandStats(frame.binsDbm, startBin, endBin);
    return peak >= threshold;
  });

  // Check for hopping pattern (signal alternating between bands)
  const activeBands = bandActivity.filter(Boolean).length;
  if (activeBands >= 1 && activeBands < filter.bands.length) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.6,
      severity: filter.severity,
      category: filter.category,
      reason: `Hopping pattern: ${activeBands}/${filter.bands.length} bands active`,
    };
  }
  return null;
}

function evaluateDriftingCarrier(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  // Placeholder - requires tracking peak frequency over time
  return null;
}

function evaluatePowerRamp(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey) return null;
  
  const state = radioStates.get(radioKey);
  if (!state || state.history.length < 5) return null;

  const rampRate = filter.params.powerRampDbPerSec ?? 10;
  const windowSize = filter.params.frameWindowSize ?? 10;

  const recentHistory = state.history.slice(-Math.min(windowSize, state.history.length));
  if (recentHistory.length < 3) return null;

  // Calculate power trend
  const first = recentHistory[0];
  const last = recentHistory[recentHistory.length - 1];
  const timeDeltaSec = (last.ts - first.ts) / 1000;
  const powerDelta = last.peakDbm - first.peakDbm;
  
  if (timeDeltaSec > 0) {
    const rate = Math.abs(powerDelta) / timeDeltaSec;
    if (rate >= rampRate) {
      const direction = powerDelta > 0 ? "up" : "down";
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, rate / (rampRate * 2)),
        severity: filter.severity,
        category: filter.category,
        reason: `Power ramping ${direction}: ${rate.toFixed(1)} dB/sec`,
      };
    }
  }
  return null;
}

// =============================================================================
// F: DOMAIN-SPECIFIC HEURISTICS
// =============================================================================

function evaluateBroadcastFmLike(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const avgThreshold = filter.params.avgThresholdDbm ?? -60;
  const minBw = filter.params.minBandwidthHz ?? 150000;
  const maxBw = filter.params.maxBandwidthHz ?? 250000;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { avg } = getBandStats(frame.binsDbm, startBin, endBin);
    const occupiedBw = measureOccupiedBandwidth(frame.binsDbm, startBin, endBin, avgThreshold - 10) * frame.binHz;

    if (avg >= avgThreshold && occupiedBw >= minBw && occupiedBw <= maxBw) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: 0.8,
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        occupiedBandwidthHz: occupiedBw,
        reason: `Broadcast FM-like: ${formatHz(occupiedBw)} bandwidth, ${avg.toFixed(1)} dBm avg`,
      };
    }
  }
  return null;
}

function evaluateNarrowbandFmVoice(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.thresholdDbm ?? -85;
  const minBw = filter.params.minBandwidthHz ?? 10000;
  const maxBw = filter.params.maxBandwidthHz ?? 16000;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { peak, avg } = getBandStats(frame.binsDbm, startBin, endBin);
    const occupiedBw = measureOccupiedBandwidth(frame.binsDbm, startBin, endBin, threshold) * frame.binHz;

    if (peak >= threshold && occupiedBw >= minBw && occupiedBw <= maxBw) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: 0.7,
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        occupiedBandwidthHz: occupiedBw,
        reason: `NBFM voice-like: ${formatHz(occupiedBw)} BW, ${peak.toFixed(1)} dBm peak`,
      };
    }
  }
  return null;
}

function evaluateAmVoiceLike(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  return evaluateThresholdInBand(frame, filter);
}

function evaluateCwMorseLike(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.peakThresholdDbm ?? -80;
  const maxBw = filter.params.maxBandwidthHz ?? 500;
  const prominence = filter.params.peakProminenceDb ?? 20;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, prominence);

    if (peaks.length === 1) {
      const occupiedBw = measureOccupiedBandwidth(frame.binsDbm, startBin, endBin, threshold) * frame.binHz;
      
      if (occupiedBw <= maxBw) {
        const peakHz = binToHz(frame, peaks[0]);
        return {
          filterId: filter.id,
          filterName: filter.name,
          ts: frame.ts,
          score: 0.8,
          severity: filter.severity,
          category: filter.category,
          bandHz: { start: band.startHz, end: band.endHz },
          bins: { startBin, endBin },
          peakHz,
          peakDbm: frame.binsDbm[peaks[0]],
          occupiedBandwidthHz: occupiedBw,
          reason: `CW/Morse-like: narrow carrier at ${formatHz(peakHz)}`,
        };
      }
    }
  }
  return null;
}

function evaluateDigitalBurstCluster(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  const threshold = filter.params.thresholdDbm ?? -90;
  const minPeaks = filter.params.minPeakCount ?? 3;
  const minSeparation = filter.params.minPeakSeparationHz ?? 50;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, 3);
    
    if (peaks.length >= minPeaks) {
      // Check spacing
      const minSepBins = Math.round(minSeparation / frame.binHz);
      let validSpacing = true;
      for (let i = 1; i < peaks.length; i++) {
        if (peaks[i] - peaks[i - 1] < minSepBins) {
          validSpacing = false;
          break;
        }
      }

      if (validSpacing) {
        return {
          filterId: filter.id,
          filterName: filter.name,
          ts: frame.ts,
          score: Math.min(1, peaks.length / (minPeaks * 2)),
          severity: filter.severity,
          category: filter.category,
          bandHz: { start: band.startHz, end: band.endHz },
          bins: { startBin, endBin },
          reason: `Digital cluster: ${peaks.length} bursts detected`,
        };
      }
    }
  }
  return null;
}

function evaluateUnknownEmitter(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  // Use new_emission logic as base
  return evaluateNewEmission(frame, filter, radioKey);
}

// =============================================================================
// HELPERS
// =============================================================================

function getBinRange(
  frame: SpectrumFrame,
  startHz: number,
  endHz: number
): { startBin: number; endBin: number } {
  const startFreq = frame.centerHz - frame.spanHz / 2;
  const startBin = Math.floor((startHz - startFreq) / frame.binHz);
  const endBin = Math.floor((endHz - startFreq) / frame.binHz);
  return {
    startBin: Math.max(0, startBin),
    endBin: Math.min(frame.binsDbm.length - 1, endBin),
  };
}

function binToHz(frame: SpectrumFrame, bin: number): number {
  const startFreq = frame.centerHz - frame.spanHz / 2;
  return startFreq + bin * frame.binHz;
}

function formatHz(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)} kHz`;
  return `${hz.toFixed(0)} Hz`;
}

function getBandStats(
  bins: number[],
  startBin: number,
  endBin: number
): { avg: number; peak: number; min: number } {
  let sum = 0;
  let peak = -Infinity;
  let min = Infinity;
  let count = 0;

  for (let i = startBin; i <= endBin; i++) {
    sum += bins[i];
    if (bins[i] > peak) peak = bins[i];
    if (bins[i] < min) min = bins[i];
    count++;
  }

  return {
    avg: count > 0 ? sum / count : -Infinity,
    peak,
    min,
  };
}

function getBandStatsWithPeakBin(
  bins: number[],
  startBin: number,
  endBin: number
): { avg: number; peak: number; peakBin: number } {
  let sum = 0;
  let peak = -Infinity;
  let peakBin = startBin;
  let count = 0;

  for (let i = startBin; i <= endBin; i++) {
    sum += bins[i];
    if (bins[i] > peak) {
      peak = bins[i];
      peakBin = i;
    }
    count++;
  }

  return {
    avg: count > 0 ? sum / count : -Infinity,
    peak,
    peakBin,
  };
}

function getNeighborAvg(bins: number[], center: number, radius: number): number {
  let sum = 0;
  let count = 0;

  for (let i = Math.max(0, center - radius); i <= Math.min(bins.length - 1, center + radius); i++) {
    if (i !== center) {
      sum += bins[i];
      count++;
    }
  }

  return count > 0 ? sum / count : bins[center];
}

function measureOccupiedBandwidth(
  bins: number[],
  startBin: number,
  endBin: number,
  threshold: number
): number {
  let firstAbove = -1;
  let lastAbove = -1;

  for (let i = startBin; i <= endBin; i++) {
    if (bins[i] >= threshold) {
      if (firstAbove < 0) firstAbove = i;
      lastAbove = i;
    }
  }

  return firstAbove >= 0 ? lastAbove - firstAbove + 1 : 0;
}

function findPeaks(
  bins: number[],
  startBin: number,
  endBin: number,
  threshold: number,
  prominence: number
): number[] {
  const peaks: number[] = [];

  for (let i = startBin + 1; i < endBin; i++) {
    if (bins[i] >= threshold) {
      // Check if local maximum
      const isLocalMax = bins[i] > bins[i - 1] && bins[i] > bins[i + 1];
      
      if (isLocalMax) {
        // Check prominence
        const neighborAvg = getNeighborAvg(bins, i, 5);
        if (bins[i] - neighborAvg >= prominence) {
          peaks.push(i);
        }
      }
    }
  }

  return peaks;
}

function resampleArray(arr: number[], targetLength: number): number[] {
  if (arr.length === targetLength) return arr;

  const result: number[] = [];
  const ratio = arr.length / targetLength;

  for (let i = 0; i < targetLength; i++) {
    const srcIndex = i * ratio;
    const lower = Math.floor(srcIndex);
    const upper = Math.min(lower + 1, arr.length - 1);
    const frac = srcIndex - lower;
    result.push(arr[lower] * (1 - frac) + arr[upper] * frac);
  }

  return result;
}

function normalizedCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  const meanA = a.reduce((s, v) => s + v, 0) / a.length;
  const meanB = b.reduce((s, v) => s + v, 0) / b.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < a.length; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    numerator += diffA * diffB;
    denomA += diffA * diffA;
    denomB += diffB * diffB;
  }

  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : numerator / denom;
}

// =============================================================================
// TEMPORAL STATE MANAGEMENT
// =============================================================================

function updateTemporalState(radioKey: string, frame: SpectrumFrame): void {
  let state = radioStates.get(radioKey);

  if (!state) {
    state = {
      radioKey,
      history: [],
      maxHistorySize: DEFAULT_HISTORY_SIZE,
    };
    radioStates.set(radioKey, state);
  }

  // Compute frame summary
  const { avg, peak } = getBandStats(frame.binsDbm, 0, frame.binsDbm.length - 1);
  let occupancy = 0;
  const noiseFloor = -100;
  for (const bin of frame.binsDbm) {
    if (bin >= noiseFloor) occupancy++;
  }

  const entry: FrameHistoryEntry = {
    ts: frame.ts,
    peakDbm: peak,
    peakHz: 0, // Would need to compute
    avgDbm: avg,
    occupancy: occupancy / frame.binsDbm.length,
  };

  state.history.push(entry);

  // Trim history
  if (state.history.length > state.maxHistorySize) {
    state.history = state.history.slice(-state.maxHistorySize);
  }

  // Update baseline periodically
  if (!state.baseline || state.history.length % 50 === 0) {
    const baselineEntries = state.history.slice(-50);
    const avgSum = baselineEntries.reduce((s, e) => s + e.avgDbm, 0);
    const peakSum = baselineEntries.reduce((s, e) => s + e.peakDbm, 0);

    state.baseline = {
      avgDbm: avgSum / baselineEntries.length,
      peakDbm: peakSum / baselineEntries.length,
      computedAt: frame.ts,
    };
  }
}

/**
 * Reset cooldowns (for testing or when filters are reloaded)
 */
export function resetCooldowns(): void {
  lastMatchTimes.clear();
}

/**
 * Clear all temporal state
 */
export function clearTemporalState(): void {
  radioStates.clear();
}

/**
 * Estimate noise floor from frame
 */
export function estimateNoiseFloor(frame: SpectrumFrame): number {
  const sorted = [...frame.binsDbm].sort((a, b) => a - b);
  // Take median of lower 20% as noise floor estimate
  const cutoff = Math.floor(sorted.length * 0.2);
  const lower = sorted.slice(0, cutoff);
  return lower.reduce((s, v) => s + v, 0) / lower.length;
}
