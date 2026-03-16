/**
 * SDR Spectrum types for the Spectrum Analyzer.
 */

export type SpectrumFrame = {
  ts: number; // Unix timestamp in milliseconds
  centerHz: number; // Center frequency in Hz
  spanHz: number; // Span in Hz
  binHz: number; // Hz per bin
  binsDbm: number[]; // Power levels in dBm for each bin
  frameId?: string; // Optional frame identifier
};

// =============================================================================
// INFERENCE CATEGORIES
// =============================================================================

/**
 * Inference categories for filter grouping and UI organization
 */
export type InferenceCategory =
  | "carrier_energy"      // A: Carrier & Energy Detection
  | "bandwidth_occupancy" // B: Bandwidth & Occupancy
  | "temporal"            // C: Temporal Behavior
  | "structural"          // D: Structural / Shape
  | "movement"            // E: Movement / Change
  | "domain_heuristic";   // F: Domain-specific inference

export const INFERENCE_CATEGORIES: Record<InferenceCategory, { label: string; description: string }> = {
  carrier_energy: {
    label: "Carrier & Energy Detection",
    description: "Detect presence of carriers and energy levels in bands",
  },
  bandwidth_occupancy: {
    label: "Bandwidth & Occupancy",
    description: "Measure occupied bandwidth and spectral occupancy",
  },
  temporal: {
    label: "Temporal Behavior",
    description: "Analyze signal behavior over time (bursts, continuous, periodic)",
  },
  structural: {
    label: "Structural / Shape",
    description: "Detect spectral shapes (peaks, harmonics, patterns)",
  },
  movement: {
    label: "Movement / Change",
    description: "Track frequency/power changes over time",
  },
  domain_heuristic: {
    label: "Domain-Specific Inference",
    description: "Heuristic detection of common signal types (not decoders)",
  },
};

// =============================================================================
// FILTER TYPES (Expanded)
// =============================================================================

export type FilterType =
  // A: Carrier & Energy Detection
  | "peak_in_band"          // Narrowband carrier present
  | "threshold_in_band"     // Any bin exceeds threshold
  | "avg_power_in_band"     // Average band power exceeded
  | "new_emission"          // New emission vs baseline
  
  // B: Bandwidth & Occupancy
  | "occupied_bandwidth"    // Bandwidth within range
  | "occupancy_percent"     // % of bins above threshold
  | "channelized_energy"    // Multiple spaced peaks
  
  // C: Temporal Behavior
  | "burst_detector"        // Burst / PTT detection
  | "continuous_signal"     // Continuous transmission
  | "periodic_burst"        // Periodic burst pattern
  | "disappearing_signal"   // Signal disappeared
  
  // D: Structural / Shape
  | "single_peak"           // Single dominant peak
  | "multi_peak"            // Multiple peaks
  | "harmonics"             // Harmonics f, 2f, 3f
  | "template_corr"         // Template correlation
  
  // E: Movement / Change
  | "frequency_hopping"     // Band A → Band B
  | "drifting_carrier"      // Slow frequency drift
  | "power_ramp"            // Power ramp up/down
  
  // F: Domain-specific heuristics
  | "broadcast_fm_like"     // Broadcast FM emission
  | "narrowband_fm_voice"   // NBFM voice-like
  | "am_voice_like"         // AM voice (airband)
  | "cw_morse_like"         // CW / Morse-like
  | "digital_burst_cluster" // FT8-like digital
  | "unknown_emitter"       // Surveillance unknown
  
  // Legacy / combo
  | "multi_band_combo";

export const FILTER_TYPE_INFO: Record<FilterType, { label: string; category: InferenceCategory; description: string }> = {
  // A: Carrier & Energy Detection
  peak_in_band: {
    label: "Peak in Band",
    category: "carrier_energy",
    description: "Detect if peak power in band exceeds threshold",
  },
  threshold_in_band: {
    label: "Threshold in Band",
    category: "carrier_energy",
    description: "Detect if any bin exceeds threshold",
  },
  avg_power_in_band: {
    label: "Average Power in Band",
    category: "carrier_energy",
    description: "Detect if average power exceeds threshold",
  },
  new_emission: {
    label: "New Emission",
    category: "carrier_energy",
    description: "Detect new emission vs baseline (requires history)",
  },
  
  // B: Bandwidth & Occupancy
  occupied_bandwidth: {
    label: "Occupied Bandwidth",
    category: "bandwidth_occupancy",
    description: "Check if occupied bandwidth is within range",
  },
  occupancy_percent: {
    label: "Occupancy Percentage",
    category: "bandwidth_occupancy",
    description: "Percentage of bins above threshold",
  },
  channelized_energy: {
    label: "Channelized Energy",
    category: "bandwidth_occupancy",
    description: "Multiple evenly-spaced peaks (channelized signal)",
  },
  
  // C: Temporal Behavior
  burst_detector: {
    label: "Burst Detector",
    category: "temporal",
    description: "Detect sudden signal bursts (PTT)",
  },
  continuous_signal: {
    label: "Continuous Signal",
    category: "temporal",
    description: "Detect continuous transmission over N frames",
  },
  periodic_burst: {
    label: "Periodic Burst",
    category: "temporal",
    description: "Detect periodic burst pattern",
  },
  disappearing_signal: {
    label: "Disappearing Signal",
    category: "temporal",
    description: "Signal was present but disappeared",
  },
  
  // D: Structural / Shape
  single_peak: {
    label: "Single Peak",
    category: "structural",
    description: "Single dominant peak in band",
  },
  multi_peak: {
    label: "Multi-Peak",
    category: "structural",
    description: "Multiple distinct peaks in band",
  },
  harmonics: {
    label: "Harmonics Detector",
    category: "structural",
    description: "Detect fundamental + harmonics (f, 2f, 3f)",
  },
  template_corr: {
    label: "Template Correlation",
    category: "structural",
    description: "Match spectrum shape against template",
  },
  
  // E: Movement / Change
  frequency_hopping: {
    label: "Frequency Hopping",
    category: "movement",
    description: "Peak appears in band A then band B",
  },
  drifting_carrier: {
    label: "Drifting Carrier",
    category: "movement",
    description: "Peak frequency drifting over time",
  },
  power_ramp: {
    label: "Power Ramp",
    category: "movement",
    description: "Power ramping up or down over time",
  },
  
  // F: Domain-specific heuristics
  broadcast_fm_like: {
    label: "Broadcast FM-like",
    category: "domain_heuristic",
    description: "Wide FM emission (~200kHz) with stereo pilot",
  },
  narrowband_fm_voice: {
    label: "Narrowband FM Voice",
    category: "domain_heuristic",
    description: "NBFM voice-like (VHF/UHF)",
  },
  am_voice_like: {
    label: "AM Voice (Airband)",
    category: "domain_heuristic",
    description: "AM voice with carrier + sidebands",
  },
  cw_morse_like: {
    label: "CW / Morse-like",
    category: "domain_heuristic",
    description: "Narrow carrier on/off keying",
  },
  digital_burst_cluster: {
    label: "Digital Burst Cluster",
    category: "domain_heuristic",
    description: "Clustered digital bursts (FT8-like)",
  },
  unknown_emitter: {
    label: "Unknown Emitter",
    category: "domain_heuristic",
    description: "Surveillance: any new/unknown emission",
  },
  
  // Legacy
  multi_band_combo: {
    label: "Multi-Band Combo",
    category: "structural",
    description: "Logical combination of multiple bands",
  },
};

export type FilterSeverity = "info" | "warn" | "critical";

export type FilterScope = "live" | "test" | "disabled";

export interface FilterBand {
  startHz: number;
  endHz: number;
}

export interface FilterHighlight {
  label?: string;
  severity: FilterSeverity;
  color?: string; // Optional custom color
}

export interface FilterConfig {
  id: string;
  name: string;
  type: FilterType;
  category?: InferenceCategory;
  templateId?: string; // Source template if created from one
  enabled: boolean;
  scope?: FilterScope; // "live" | "test" | "disabled"
  severity: FilterSeverity;
  cooldownMs: number; // Minimum time between matches
  bands: FilterBand[];
  params: FilterParams;
  highlight?: FilterHighlight;
  // Metadata
  createdAt?: number;
  updatedAt?: number;
  lastMatchTs?: number;
}

export type FilterParams = {
  // === Thresholds (dBm) ===
  peakThresholdDbm?: number;      // peak_in_band
  thresholdDbm?: number;          // threshold_in_band, burst_detector
  avgThresholdDbm?: number;       // avg_power_in_band
  noiseFloorDbm?: number;         // Used for SNR calculations
  snrThresholdDb?: number;        // Signal-to-noise threshold
  
  // === Bandwidth / Occupancy ===
  minBandwidthHz?: number;        // occupied_bandwidth min
  maxBandwidthHz?: number;        // occupied_bandwidth max
  occupancyThresholdDbm?: number; // occupancy_percent threshold per bin
  occupancyPercentMin?: number;   // min % bins above threshold
  occupancyPercentMax?: number;   // max % bins above threshold
  channelSpacingHz?: number;      // channelized_energy spacing
  minPeakCount?: number;          // channelized_energy min peaks
  
  // === Temporal ===
  frameWindowSize?: number;       // Number of frames for temporal analysis
  minConsecutiveFrames?: number;  // continuous_signal requirement
  burstRiseDb?: number;           // burst_detector rise threshold
  periodMs?: number;              // periodic_burst period
  periodToleranceMs?: number;     // periodic_burst tolerance
  
  // === Structural ===
  peakProminenceDb?: number;      // How much peak must exceed neighbors
  minPeakSeparationHz?: number;   // multi_peak separation
  
  // === Template Correlation ===
  template?: number[];            // Template pattern (dBm values)
  corrThreshold?: number;         // 0-1 correlation threshold
  
  // === Harmonics ===
  fundamentalHz?: number;         // Base frequency for harmonics
  harmonicCount?: number;         // Number of harmonics to check (2, 3, etc.)
  harmonicToleranceHz?: number;   // Frequency tolerance for harmonic match
  
  // === Multi-band Combo ===
  comboLogic?: "AND" | "OR";
  bandThresholds?: { bandIndex: number; thresholdDbm: number }[];
  
  // === Domain heuristics ===
  heuristicType?: string;         // Sub-type for domain heuristics
  bandwidthRangeHz?: [number, number]; // Expected bandwidth range
  
  // === Drift / Movement ===
  driftRateHzPerSec?: number;     // Max drift rate
  powerRampDbPerSec?: number;     // Power change rate
  
  // === Baseline comparison ===
  baselineMode?: "rolling" | "fixed";
  baselineFrames?: number;        // Frames for rolling baseline
  baselineThresholdDb?: number;   // How much above baseline to trigger
};

export interface MatchResult {
  filterId: string;
  filterName: string;
  ts: number;
  score?: number; // Confidence score 0-1 for some filters
  severity?: FilterSeverity;
  label?: string;
  bandHz?: { start: number; end: number };
  bins?: { startBin: number; endBin: number };
  reason?: string;
  category?: InferenceCategory;
  // Additional match metadata
  peakHz?: number;
  peakDbm?: number;
  occupancyPercent?: number;
  occupiedBandwidthHz?: number;
  correlationScore?: number;
}

// =============================================================================
// TEMPORAL ANALYSIS SUPPORT
// =============================================================================

/**
 * Ring buffer entry for temporal analysis
 */
export interface FrameHistoryEntry {
  ts: number;
  peakDbm: number;
  peakHz: number;
  avgDbm: number;
  occupancy: number;
  binsDbm?: number[]; // Optional full bins for advanced analysis
}

/**
 * Per-radio temporal state maintained by engine
 */
export interface RadioTemporalState {
  radioKey: string; // "sourceId:radioId"
  history: FrameHistoryEntry[];
  maxHistorySize: number;
  baseline?: {
    avgDbm: number;
    peakDbm: number;
    computedAt: number;
  };
}
