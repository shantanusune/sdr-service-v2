/**
 * Filter Worker - Runs filter evaluation in a Web Worker for UI smoothness.
 * 
 * Message types:
 * - { type: "evaluate", frame, enabledFilters, radioKey? } → { type: "result", matches }
 * - { type: "test", frame, filter, radioKey? } → { type: "testResult", result }
 * - { type: "command", command: "reset" | "clear" }
 */

import type { SpectrumFrame, FilterConfig, MatchResult, FrameHistoryEntry, RadioTemporalState } from "@/types/sdr";

// =============================================================================
// STATE
// =============================================================================

const lastMatchTimes: Map<string, number> = new Map();
const radioStates: Map<string, RadioTemporalState> = new Map();
const DEFAULT_HISTORY_SIZE = 100;

// =============================================================================
// MESSAGE HANDLER
// =============================================================================

self.onmessage = (event: MessageEvent) => {
  const data = event.data;

  if (data.type === "evaluate") {
    const { frame, enabledFilters, radioKey } = data;
    const matches = evaluateFilters(frame, enabledFilters, radioKey);
    self.postMessage({ type: "result", matches });
  } else if (data.type === "test") {
    const { frame, filter, radioKey } = data;
    const result = evaluateFilterSingle(frame, filter, radioKey);
    self.postMessage({ type: "testResult", result });
  } else if (data.type === "command") {
    if (data.command === "reset") {
      lastMatchTimes.clear();
    } else if (data.command === "clear") {
      radioStates.clear();
      lastMatchTimes.clear();
    }
  }
};

// =============================================================================
// TEMPORAL STATE
// =============================================================================

function updateTemporalState(radioKey: string, frame: SpectrumFrame) {
  let state = radioStates.get(radioKey);
  if (!state) {
    state = {
      radioKey,
      history: [],
      maxHistorySize: DEFAULT_HISTORY_SIZE,
    };
    radioStates.set(radioKey, state);
  }

  const { peak, avg } = getBandStats(frame.binsDbm, 0, frame.binsDbm.length - 1);
  const peakBin = frame.binsDbm.indexOf(peak);
  const peakHz = binToHz(frame, peakBin);

  const entry: FrameHistoryEntry = {
    ts: frame.ts,
    peakDbm: peak,
    peakHz,
    avgDbm: avg,
    occupancy: calculateOccupancy(frame.binsDbm, -90),
  };

  state.history.push(entry);
  if (state.history.length > state.maxHistorySize) {
    state.history.shift();
  }

  // Update rolling baseline
  if (state.history.length >= 10) {
    const avgSum = state.history.reduce((s, h) => s + h.avgDbm, 0);
    const peakSum = state.history.reduce((s, h) => s + h.peakDbm, 0);
    state.baseline = {
      avgDbm: avgSum / state.history.length,
      peakDbm: peakSum / state.history.length,
      computedAt: Date.now(),
    };
  }
}

function calculateOccupancy(bins: number[], threshold: number): number {
  let count = 0;
  for (const b of bins) {
    if (b >= threshold) count++;
  }
  return count / bins.length;
}

// =============================================================================
// MAIN EVALUATION
// =============================================================================

function evaluateFilters(
  frame: SpectrumFrame,
  filters: FilterConfig[],
  radioKey?: string
): MatchResult[] {
  const results: MatchResult[] = [];
  const now = Date.now();

  if (radioKey) {
    updateTemporalState(radioKey, frame);
  }

  for (const filter of filters) {
    if (!filter.enabled) continue;
    if (filter.scope === "disabled") continue;

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

function evaluateFilterSingle(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  // Test mode: no cooldown applied
  if (radioKey) {
    updateTemporalState(radioKey, frame);
  }
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
    case "peak_in_band":
      return evaluatePeakInBand(frame, filter);
    case "threshold_in_band":
      return evaluateThresholdInBand(frame, filter);
    case "avg_power_in_band":
      return evaluateAvgPowerInBand(frame, filter);
    case "new_emission":
      return evaluateNewEmission(frame, filter, radioKey);
    case "occupied_bandwidth":
      return evaluateOccupiedBandwidth(frame, filter);
    case "occupancy_percent":
      return evaluateOccupancyPercent(frame, filter);
    case "channelized_energy":
      return evaluateChannelizedEnergy(frame, filter);
    case "burst_detector":
      return evaluateBurstDetector(frame, filter, radioKey);
    case "continuous_signal":
      return evaluateContinuousSignal(frame, filter, radioKey);
    case "disappearing_signal":
      return evaluateDisappearingSignal(frame, filter, radioKey);
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
    case "frequency_hopping":
      return evaluateFrequencyHopping(frame, filter, radioKey);
    case "broadcast_fm_like":
    case "narrowband_fm_voice":
    case "am_voice_like":
    case "cw_morse_like":
    case "digital_burst_cluster":
    case "unknown_emitter":
      return evaluateDomainHeuristic(frame, filter, radioKey);
    default:
      return null;
  }
}

// =============================================================================
// FILTER IMPLEMENTATIONS
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
        return {
          filterId: filter.id,
          filterName: filter.name,
          ts: frame.ts,
          score: Math.min(1, (frame.binsDbm[i] - threshold + 10) / 30),
          severity: filter.severity,
          category: filter.category,
          bandHz: { start: band.startHz, end: band.endHz },
          bins: { startBin, endBin },
          reason: `Bin ${i} = ${frame.binsDbm[i].toFixed(1)} dBm >= ${threshold} dBm`,
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

function evaluateOccupiedBandwidth(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const minBw = filter.params.minBandwidthHz ?? 0;
  const maxBw = filter.params.maxBandwidthHz ?? Infinity;
  const threshold = filter.params.occupancyThresholdDbm ?? -90;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    let occupiedBins = 0;
    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] >= threshold) occupiedBins++;
    }
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
        reason: `Occupied bandwidth: ${formatHz(occupiedHz)}`,
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
        score: percent / 100,
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

    if (peaks.length >= minPeaks) {
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
          score: channelizedCount / (peaks.length - 1),
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
        reason: `Burst: +${rise.toFixed(1)} dB rise`,
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

  const recentHistory = state.history.slice(-minFrames);
  const allAbove = recentHistory.every((h) => h.peakDbm >= threshold);

  if (allAbove && filter.bands.length > 0) {
    const band = filter.bands[0];
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.9,
      severity: filter.severity,
      category: filter.category,
      bandHz: { start: band.startHz, end: band.endHz },
      reason: `Continuous signal for ${minFrames} frames above ${threshold} dBm`,
    };
  }
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

  const threshold = filter.params.thresholdDbm ?? -70;
  const windowSize = filter.params.frameWindowSize ?? 10;

  const oldHistory = state.history.slice(-windowSize - 5, -5);
  const recentHistory = state.history.slice(-5);

  if (oldHistory.length === 0) return null;

  const wasPresent = oldHistory.every((h) => h.peakDbm >= threshold);
  const isGone = recentHistory.every((h) => h.peakDbm < threshold - 10);

  if (wasPresent && isGone && filter.bands.length > 0) {
    const band = filter.bands[0];
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.85,
      severity: filter.severity,
      category: filter.category,
      bandHz: { start: band.startHz, end: band.endHz },
      reason: `Signal disappeared (was above ${threshold} dBm)`,
    };
  }
  return null;
}

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
        reason: `Single peak at ${formatHz(peakHz)}`,
      };
    }
  }
  return null;
}

function evaluateMultiPeak(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const threshold = filter.params.peakThresholdDbm ?? -70;
  const prominence = filter.params.peakProminenceDb ?? 10;
  const minPeaks = filter.params.minPeakCount ?? 2;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const peaks = findPeaks(frame.binsDbm, startBin, endBin, threshold, prominence);

    if (peaks.length >= minPeaks) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, peaks.length / 5),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        reason: `${peaks.length} peaks detected`,
      };
    }
  }
  return null;
}

function evaluateHarmonics(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const fundamental = filter.params.fundamentalHz ?? 100_000_000;
  const count = filter.params.harmonicCount ?? 3;
  const tolerance = filter.params.harmonicToleranceHz ?? 100_000;
  const threshold = filter.params.peakThresholdDbm ?? -70;

  let matchedHarmonics = 0;

  for (let h = 1; h <= count; h++) {
    const targetHz = fundamental * h;
    const { startBin, endBin } = getBinRange(
      frame,
      targetHz - tolerance,
      targetHz + tolerance
    );

    if (startBin >= 0 && endBin < frame.binsDbm.length) {
      const { peak } = getBandStats(frame.binsDbm, startBin, endBin);
      if (peak >= threshold) matchedHarmonics++;
    }
  }

  if (matchedHarmonics >= 2) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: matchedHarmonics / count,
      severity: filter.severity,
      category: filter.category,
      reason: `${matchedHarmonics}/${count} harmonics detected (f=${formatHz(fundamental)})`,
    };
  }
  return null;
}

function evaluateTemplateCorr(frame: SpectrumFrame, filter: FilterConfig): MatchResult | null {
  const template = filter.params.template;
  const corrThreshold = filter.params.corrThreshold ?? 0.8;

  if (!template || template.length === 0 || filter.bands.length === 0) return null;

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
      severity: filter.severity,
      category: filter.category,
      bandHz: { start: band.startHz, end: band.endHz },
      bins: { startBin, endBin },
      correlationScore: corr,
      reason: `Template correlation: ${(corr * 100).toFixed(1)}%`,
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

    let peakPower = -Infinity;
    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] > peakPower) peakPower = frame.binsDbm[i];
    }

    scores.push(peakPower);
    results.push(peakPower >= bt.thresholdDbm);
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
      reason: `Multi-band ${logic}: ${results.map((r, i) => `Band${i}=${r}`).join(", ")}`,
    };
  }
  return null;
}

function evaluateFrequencyHopping(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  if (!radioKey || filter.bands.length < 2) return null;
  const state = radioStates.get(radioKey);
  if (!state || state.history.length < 5) return null;

  const threshold = filter.params.thresholdDbm ?? -70;

  // Check if peak was in one band in recent history and now in another
  const recentPeakHz = state.history[state.history.length - 1].peakHz;
  const oldPeakHz = state.history[Math.max(0, state.history.length - 5)].peakHz;

  let recentBandIndex = -1;
  let oldBandIndex = -1;

  filter.bands.forEach((band, i) => {
    if (recentPeakHz >= band.startHz && recentPeakHz <= band.endHz) recentBandIndex = i;
    if (oldPeakHz >= band.startHz && oldPeakHz <= band.endHz) oldBandIndex = i;
  });

  if (recentBandIndex !== -1 && oldBandIndex !== -1 && recentBandIndex !== oldBandIndex) {
    return {
      filterId: filter.id,
      filterName: filter.name,
      ts: frame.ts,
      score: 0.85,
      severity: filter.severity,
      category: filter.category,
      reason: `Hopping detected: Band ${oldBandIndex + 1} → Band ${recentBandIndex + 1}`,
    };
  }
  return null;
}

function evaluateDomainHeuristic(
  frame: SpectrumFrame,
  filter: FilterConfig,
  radioKey?: string
): MatchResult | null {
  // Simplified domain heuristics
  const threshold = filter.params.thresholdDbm ?? filter.params.avgThresholdDbm ?? -80;
  const minBw = filter.params.minBandwidthHz ?? 0;
  const maxBw = filter.params.maxBandwidthHz ?? Infinity;

  for (const band of filter.bands) {
    const { startBin, endBin } = getBinRange(frame, band.startHz, band.endHz);
    if (startBin < 0 || endBin >= frame.binsDbm.length) continue;

    const { avg, peak } = getBandStats(frame.binsDbm, startBin, endBin);

    // Measure occupied bandwidth
    let occupiedBins = 0;
    for (let i = startBin; i <= endBin; i++) {
      if (frame.binsDbm[i] >= threshold) occupiedBins++;
    }
    const occupiedHz = occupiedBins * frame.binHz;

    if (avg >= threshold && occupiedHz >= minBw && occupiedHz <= maxBw) {
      return {
        filterId: filter.id,
        filterName: filter.name,
        ts: frame.ts,
        score: Math.min(1, (avg - threshold + 20) / 40),
        severity: filter.severity,
        category: filter.category,
        bandHz: { start: band.startHz, end: band.endHz },
        bins: { startBin, endBin },
        peakDbm: peak,
        occupiedBandwidthHz: occupiedHz,
        reason: `${filter.type}: avg=${avg.toFixed(1)} dBm, bw=${formatHz(occupiedHz)}`,
      };
    }
  }
  return null;
}

// =============================================================================
// UTILITY FUNCTIONS
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

function getNeighborAvg(bins: number[], center: number, radius: number): number {
  let sum = 0;
  let count = 0;
  for (let i = center - radius; i <= center + radius; i++) {
    if (i >= 0 && i < bins.length && i !== center) {
      sum += bins[i];
      count++;
    }
  }
  return count > 0 ? sum / count : -Infinity;
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
    if (bins[i] >= threshold && bins[i] > bins[i - 1] && bins[i] > bins[i + 1]) {
      const neighborAvg = getNeighborAvg(bins, i, 5);
      if (bins[i] - neighborAvg >= prominence) {
        peaks.push(i);
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

function formatHz(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`;
  return `${hz} Hz`;
}
