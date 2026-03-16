import type { FilterConfig, FilterType, FilterSeverity, InferenceCategory } from "@/types/sdr";
import { generateFilterId } from "@/services/filterStore";

/**
 * Filter Template Definition
 */
export interface FilterTemplate {
  id: string;
  name: string;
  description: string;
  whatItDetects: string;
  category: InferenceCategory;
  signalType: "narrow" | "wide" | "burst" | "pattern" | "multi";
  typicalBands?: string; // e.g., "VHF/UHF", "HF", "2.4 GHz"
  icon: string;
  createFilter: () => FilterConfig;
}

/**
 * Complete filter template library grouped by inference category
 */
export const FILTER_TEMPLATES: FilterTemplate[] = [
  // ==========================================================================
  // A: CARRIER & ENERGY DETECTION
  // ==========================================================================
  {
    id: "broadcast-fm-station",
    name: "Broadcast FM Station",
    description: "Detect active FM broadcast stations in the 88-108 MHz band",
    whatItDetects: "Strong wideband FM emissions with typical ~200kHz bandwidth",
    category: "carrier_energy",
    signalType: "wide",
    typicalBands: "88-108 MHz",
    icon: "📻",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Broadcast FM Station",
      type: "broadcast_fm_like" as FilterType,
      category: "carrier_energy",
      templateId: "broadcast-fm-station",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 5000,
      bands: [{ startHz: 88_000_000, endHz: 108_000_000 }],
      params: {
        avgThresholdDbm: -60,
        minBandwidthHz: 150_000,
        maxBandwidthHz: 250_000,
      },
      highlight: { severity: "info", label: "FM Station" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "narrowband-carrier",
    name: "Narrowband Carrier (CW/Beacon)",
    description: "Detect narrow continuous carriers like CW, beacons, or test signals",
    whatItDetects: "Single narrow peak with high power, minimal bandwidth",
    category: "carrier_energy",
    signalType: "narrow",
    typicalBands: "HF, VHF",
    icon: "📡",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Narrowband Carrier",
      type: "peak_in_band" as FilterType,
      category: "carrier_energy",
      templateId: "narrowband-carrier",
      enabled: true,
      scope: "live",
      severity: "warn" as FilterSeverity,
      cooldownMs: 2000,
      bands: [{ startHz: 144_000_000, endHz: 144_100_000 }],
      params: {
        peakThresholdDbm: -60,
        peakProminenceDb: 15,
      },
      highlight: { severity: "warn", label: "CW/Carrier" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "new-emission-detector",
    name: "New Emission Detector",
    description: "Detect new emissions that appear above the rolling baseline",
    whatItDetects: "Any signal significantly above the noise floor baseline",
    category: "carrier_energy",
    signalType: "pattern",
    typicalBands: "Any",
    icon: "🆕",
    createFilter: () => ({
      id: generateFilterId(),
      name: "New Emission Detector",
      type: "new_emission" as FilterType,
      category: "carrier_energy",
      templateId: "new-emission-detector",
      enabled: true,
      scope: "live",
      severity: "warn" as FilterSeverity,
      cooldownMs: 10000,
      bands: [{ startHz: 430_000_000, endHz: 440_000_000 }],
      params: {
        baselineMode: "rolling",
        baselineFrames: 100,
        baselineThresholdDb: 10,
      },
      highlight: { severity: "warn", label: "New Emission" },
      createdAt: Date.now(),
    }),
  },

  // ==========================================================================
  // B: BANDWIDTH & OCCUPANCY
  // ==========================================================================
  {
    id: "band-occupancy-monitor",
    name: "Band Occupancy Monitor",
    description: "Monitor what percentage of a band is actively occupied",
    whatItDetects: "Overall band activity level as percentage",
    category: "bandwidth_occupancy",
    signalType: "wide",
    typicalBands: "Any",
    icon: "📊",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Band Occupancy Monitor",
      type: "occupancy_percent" as FilterType,
      category: "bandwidth_occupancy",
      templateId: "band-occupancy-monitor",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 5000,
      bands: [{ startHz: 462_562_500, endHz: 462_712_500 }], // FRS band
      params: {
        occupancyThresholdDbm: -90,
        occupancyPercentMin: 20,
      },
      highlight: { severity: "info", label: "Occupied" },
      createdAt: Date.now(),
    }),
  },

  // ==========================================================================
  // C: TEMPORAL BEHAVIOR
  // ==========================================================================
  {
    id: "airband-am-voice",
    name: "Airband AM Voice (PTT)",
    description: "Detect AM voice transmissions typical of aircraft communications",
    whatItDetects: "PTT burst pattern with AM carrier + sidebands, 118-137 MHz",
    category: "temporal",
    signalType: "burst",
    typicalBands: "118-137 MHz",
    icon: "✈️",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Airband AM Voice",
      type: "burst_detector" as FilterType,
      category: "temporal",
      templateId: "airband-am-voice",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 1000,
      bands: [{ startHz: 118_000_000, endHz: 137_000_000 }],
      params: {
        thresholdDbm: -80,
        burstRiseDb: 15,
        frameWindowSize: 10,
        minBandwidthHz: 5000,
        maxBandwidthHz: 12000,
      },
      highlight: { severity: "info", label: "Airband" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "nbfm-voice",
    name: "Narrowband FM Voice (VHF/UHF)",
    description: "Detect narrowband FM voice typical of ham radio and land mobile",
    whatItDetects: "NBFM emissions with ~12-15kHz bandwidth, PTT pattern",
    category: "temporal",
    signalType: "burst",
    typicalBands: "VHF/UHF",
    icon: "🎙️",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Narrowband FM Voice",
      type: "narrowband_fm_voice" as FilterType,
      category: "temporal",
      templateId: "nbfm-voice",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 1000,
      bands: [{ startHz: 145_000_000, endHz: 148_000_000 }],
      params: {
        thresholdDbm: -85,
        minBandwidthHz: 10000,
        maxBandwidthHz: 16000,
        burstRiseDb: 10,
      },
      highlight: { severity: "info", label: "NBFM Voice" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "ham-ssb-voice",
    name: "Ham SSB Voice (HF)",
    description: "Detect single-sideband voice transmissions on HF bands",
    whatItDetects: "SSB with ~2.8kHz bandwidth, asymmetric spectrum",
    category: "temporal",
    signalType: "narrow",
    typicalBands: "HF (3-30 MHz)",
    icon: "📶",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Ham SSB Voice",
      type: "burst_detector" as FilterType,
      category: "temporal",
      templateId: "ham-ssb-voice",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 2000,
      bands: [{ startHz: 14_150_000, endHz: 14_350_000 }], // 20m phone
      params: {
        thresholdDbm: -80,
        burstRiseDb: 10,
        minBandwidthHz: 2000,
        maxBandwidthHz: 3500,
      },
      highlight: { severity: "info", label: "SSB" },
      createdAt: Date.now(),
    }),
  },

  // ==========================================================================
  // D: STRUCTURAL / SHAPE
  // ==========================================================================
  {
    id: "cw-narrow-carrier",
    name: "CW / Narrow Carrier",
    description: "Detect pure CW or very narrow carrier signals",
    whatItDetects: "Extremely narrow carrier (<500Hz) with high SNR",
    category: "structural",
    signalType: "narrow",
    typicalBands: "HF",
    icon: "📍",
    createFilter: () => ({
      id: generateFilterId(),
      name: "CW / Narrow Carrier",
      type: "cw_morse_like" as FilterType,
      category: "structural",
      templateId: "cw-narrow-carrier",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 2000,
      bands: [{ startHz: 7_000_000, endHz: 7_050_000 }],
      params: {
        peakThresholdDbm: -80,
        peakProminenceDb: 20,
        maxBandwidthHz: 500,
      },
      highlight: { severity: "info", label: "CW" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "digital-burst-cluster",
    name: "Digital Burst Cluster",
    description: "Detect clustered digital mode bursts like FT8/FT4",
    whatItDetects: "Multiple narrow bursts clustered in time/frequency",
    category: "structural",
    signalType: "pattern",
    typicalBands: "HF",
    icon: "💻",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Digital Burst Cluster",
      type: "digital_burst_cluster" as FilterType,
      category: "structural",
      templateId: "digital-burst-cluster",
      enabled: true,
      scope: "live",
      severity: "info" as FilterSeverity,
      cooldownMs: 15000,
      bands: [{ startHz: 14_074_000, endHz: 14_077_000 }], // FT8
      params: {
        thresholdDbm: -90,
        minPeakCount: 3,
        minPeakSeparationHz: 50,
        frameWindowSize: 30,
      },
      highlight: { severity: "info", label: "Digital" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "harmonic-spur-detector",
    name: "Harmonic / Spur Detector",
    description: "Detect signals with harmonic content (f, 2f, 3f)",
    whatItDetects: "Fundamental frequency plus its harmonics",
    category: "structural",
    signalType: "multi",
    typicalBands: "Any",
    icon: "🎵",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Harmonic Detector",
      type: "harmonics" as FilterType,
      category: "structural",
      templateId: "harmonic-spur-detector",
      enabled: true,
      scope: "live",
      severity: "warn" as FilterSeverity,
      cooldownMs: 5000,
      bands: [
        { startHz: 100_000_000, endHz: 100_500_000 },
        { startHz: 200_000_000, endHz: 201_000_000 },
        { startHz: 300_000_000, endHz: 301_500_000 },
      ],
      params: {
        fundamentalHz: 100_000_000,
        harmonicCount: 3,
        harmonicToleranceHz: 500_000,
        peakThresholdDbm: -70,
      },
      highlight: { severity: "warn", label: "Harmonic" },
      createdAt: Date.now(),
    }),
  },
  {
    id: "custom-template-correlation",
    name: "Custom Shape Correlation",
    description: "Match spectrum against a user-defined template shape",
    whatItDetects: "Spectrum matching the provided template pattern",
    category: "structural",
    signalType: "pattern",
    typicalBands: "Any",
    icon: "🔍",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Template Matcher",
      type: "template_corr" as FilterType,
      category: "structural",
      templateId: "custom-template-correlation",
      enabled: true,
      scope: "live",
      severity: "critical" as FilterSeverity,
      cooldownMs: 3000,
      bands: [{ startHz: 433_000_000, endHz: 434_000_000 }],
      params: {
        template: [-90, -80, -60, -40, -60, -80, -90],
        corrThreshold: 0.85,
      },
      highlight: { severity: "critical", label: "Template Match" },
      createdAt: Date.now(),
    }),
  },

  // ==========================================================================
  // E: MOVEMENT / CHANGE
  // ==========================================================================
  {
    id: "frequency-hopper-detector",
    name: "Frequency Hopper Detector",
    description: "Detect signals hopping between frequency bands",
    whatItDetects: "Peak appearing in band A then band B over time",
    category: "movement",
    signalType: "multi",
    typicalBands: "ISM, Military",
    icon: "🦘",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Hopper Detector",
      type: "frequency_hopping" as FilterType,
      category: "movement",
      templateId: "frequency-hopper-detector",
      enabled: true,
      scope: "live",
      severity: "warn" as FilterSeverity,
      cooldownMs: 1000,
      bands: [
        { startHz: 915_000_000, endHz: 915_500_000 },
        { startHz: 917_000_000, endHz: 917_500_000 },
      ],
      params: {
        thresholdDbm: -55,
        frameWindowSize: 20,
      },
      highlight: { severity: "warn", label: "Hopping" },
      createdAt: Date.now(),
    }),
  },

  // ==========================================================================
  // F: DOMAIN-SPECIFIC HEURISTICS
  // ==========================================================================
  {
    id: "unknown-emitter-surveillance",
    name: "Unknown Emitter (Surveillance)",
    description: "Flag any emission that doesn't match known patterns",
    whatItDetects: "Emissions above noise that don't match common signal types",
    category: "domain_heuristic",
    signalType: "pattern",
    typicalBands: "Any",
    icon: "🔮",
    createFilter: () => ({
      id: generateFilterId(),
      name: "Unknown Emitter",
      type: "unknown_emitter" as FilterType,
      category: "domain_heuristic",
      templateId: "unknown-emitter-surveillance",
      enabled: true,
      scope: "live",
      severity: "critical" as FilterSeverity,
      cooldownMs: 30000,
      bands: [{ startHz: 400_000_000, endHz: 500_000_000 }],
      params: {
        baselineMode: "rolling",
        baselineFrames: 200,
        baselineThresholdDb: 15,
        snrThresholdDb: 10,
      },
      highlight: { severity: "critical", label: "Unknown" },
      createdAt: Date.now(),
    }),
  },
];

/**
 * Get templates grouped by inference category
 */
export function getTemplatesByCategory(): Record<InferenceCategory, FilterTemplate[]> {
  const grouped: Record<InferenceCategory, FilterTemplate[]> = {
    carrier_energy: [],
    bandwidth_occupancy: [],
    temporal: [],
    structural: [],
    movement: [],
    domain_heuristic: [],
  };

  for (const template of FILTER_TEMPLATES) {
    grouped[template.category].push(template);
  }

  return grouped;
}

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): FilterTemplate | undefined {
  return FILTER_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates by signal type
 */
export function getTemplatesBySignalType(signalType: FilterTemplate["signalType"]): FilterTemplate[] {
  return FILTER_TEMPLATES.filter((t) => t.signalType === signalType);
}

/**
 * Category labels for UI display
 */
export const TEMPLATE_CATEGORY_LABELS: Record<InferenceCategory, { label: string; icon: string }> = {
  carrier_energy: { label: "Carrier & Energy Detection", icon: "⚡" },
  bandwidth_occupancy: { label: "Bandwidth & Occupancy", icon: "📊" },
  temporal: { label: "Temporal Behavior", icon: "⏱️" },
  structural: { label: "Structural / Shape", icon: "📐" },
  movement: { label: "Movement / Change", icon: "🔄" },
  domain_heuristic: { label: "Domain-Specific", icon: "🎯" },
};

/**
 * Signal type icons for UI
 */
export const SIGNAL_TYPE_INFO: Record<FilterTemplate["signalType"], { label: string; icon: string }> = {
  narrow: { label: "Narrowband", icon: "📍" },
  wide: { label: "Wideband", icon: "📶" },
  burst: { label: "Burst/PTT", icon: "⚡" },
  pattern: { label: "Pattern", icon: "🔍" },
  multi: { label: "Multi-Band", icon: "🎯" },
};
