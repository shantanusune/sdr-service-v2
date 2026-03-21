import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ParameterSlider } from "./ParameterSlider";
import { FrequencyInput } from "./FrequencyInput";
import type { FilterConfig, FilterType, FilterParams } from "@/types/sdr";

interface FilterParamsEditorProps {
  filterType: FilterType;
  params: FilterParams;
  onChange: (params: FilterParams) => void;
}

export const FilterParamsEditor: React.FC<FilterParamsEditorProps> = ({
  filterType,
  params,
  onChange,
}) => {
  const updateParam = <K extends keyof FilterParams>(key: K, value: FilterParams[K]) => {
    onChange({ ...params, [key]: value });
  };

  const renderByCategory = () => {
    switch (filterType) {
      // =============================================
      // A: CARRIER & ENERGY DETECTION
      // =============================================
      case "peak_in_band":
        return (
          <>
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -50}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-50}
              showReset
              description="Minimum peak power to trigger"
            />
            <ParameterSlider
              label="Peak Prominence"
              value={params.peakProminenceDb ?? 0}
              onChange={(v) => updateParam("peakProminenceDb", v)}
              min={0}
              max={40}
              step={1}
              unit="dB"
              defaultValue={0}
              showReset
              description="How much peak must exceed neighbors"
            />
          </>
        );

      case "threshold_in_band":
        return (
          <ParameterSlider
            label="Threshold"
            value={params.thresholdDbm ?? -50}
            onChange={(v) => updateParam("thresholdDbm", v)}
            min={-120}
            max={0}
            step={1}
            unit="dBm"
            defaultValue={-50}
            showReset
            description="Any bin above this triggers"
          />
        );

      case "avg_power_in_band":
        return (
          <ParameterSlider
            label="Average Threshold"
            value={params.avgThresholdDbm ?? -60}
            onChange={(v) => updateParam("avgThresholdDbm", v)}
            min={-120}
            max={0}
            step={1}
            unit="dBm"
            defaultValue={-60}
            showReset
            description="Average power across band"
          />
        );

      case "new_emission":
        return (
          <>
            <div className="space-y-2">
              <Label>Baseline Mode</Label>
              <Select
                value={params.baselineMode ?? "rolling"}
                onValueChange={(v) => updateParam("baselineMode", v as "rolling" | "fixed")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rolling">Rolling Average</SelectItem>
                  <SelectItem value="fixed">Fixed Baseline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ParameterSlider
              label="Baseline Frames"
              value={params.baselineFrames ?? 100}
              onChange={(v) => updateParam("baselineFrames", v)}
              min={10}
              max={500}
              step={10}
              defaultValue={100}
              showReset
              description="Frames to average for baseline"
            />
            <ParameterSlider
              label="Threshold Above Baseline"
              value={params.baselineThresholdDb ?? 10}
              onChange={(v) => updateParam("baselineThresholdDb", v)}
              min={3}
              max={30}
              step={1}
              unit="dB"
              defaultValue={10}
              showReset
              description="How much above baseline to trigger"
            />
          </>
        );

      // =============================================
      // B: BANDWIDTH & OCCUPANCY
      // =============================================
      case "occupied_bandwidth":
        return (
          <>
            <FrequencyInput
              label="Minimum Bandwidth"
              value={params.minBandwidthHz ?? 0}
              onChange={(v) => updateParam("minBandwidthHz", v)}
            />
            <FrequencyInput
              label="Maximum Bandwidth"
              value={params.maxBandwidthHz ?? 200000}
              onChange={(v) => updateParam("maxBandwidthHz", v)}
            />
            <ParameterSlider
              label="Occupancy Threshold"
              value={params.occupancyThresholdDbm ?? -90}
              onChange={(v) => updateParam("occupancyThresholdDbm", v)}
              min={-120}
              max={-40}
              step={1}
              unit="dBm"
              defaultValue={-90}
              showReset
              description="Power level to consider bin occupied"
            />
          </>
        );

      case "occupancy_percent":
        return (
          <>
            <ParameterSlider
              label="Occupancy Threshold"
              value={params.occupancyThresholdDbm ?? -90}
              onChange={(v) => updateParam("occupancyThresholdDbm", v)}
              min={-120}
              max={-40}
              step={1}
              unit="dBm"
              defaultValue={-90}
              showReset
            />
            <ParameterSlider
              label="Minimum Occupancy"
              value={params.occupancyPercentMin ?? 0}
              onChange={(v) => updateParam("occupancyPercentMin", v)}
              min={0}
              max={100}
              step={1}
              unit="%"
              defaultValue={0}
              showReset
            />
            <ParameterSlider
              label="Maximum Occupancy"
              value={params.occupancyPercentMax ?? 100}
              onChange={(v) => updateParam("occupancyPercentMax", v)}
              min={0}
              max={100}
              step={1}
              unit="%"
              defaultValue={100}
              showReset
            />
          </>
        );

      case "channelized_energy":
        return (
          <>
            <FrequencyInput
              label="Channel Spacing"
              value={params.channelSpacingHz ?? 25000}
              onChange={(v) => updateParam("channelSpacingHz", v)}
            />
            <ParameterSlider
              label="Minimum Peak Count"
              value={params.minPeakCount ?? 3}
              onChange={(v) => updateParam("minPeakCount", v)}
              min={2}
              max={20}
              step={1}
              defaultValue={3}
              showReset
            />
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -80}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-80}
              showReset
            />
          </>
        );

      // =============================================
      // C: TEMPORAL BEHAVIOR
      // =============================================
      case "burst_detector":
        return (
          <>
            <ParameterSlider
              label="Threshold"
              value={params.thresholdDbm ?? -80}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-80}
              showReset
            />
            <ParameterSlider
              label="Burst Rise"
              value={params.burstRiseDb ?? 15}
              onChange={(v) => updateParam("burstRiseDb", v)}
              min={5}
              max={40}
              step={1}
              unit="dB"
              defaultValue={15}
              showReset
              description="Power rise to detect burst"
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 10}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={2}
              max={100}
              step={1}
              defaultValue={10}
              showReset
              description="Frames to analyze"
            />
          </>
        );

      case "continuous_signal":
        return (
          <>
            <ParameterSlider
              label="Threshold"
              value={params.thresholdDbm ?? -80}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-80}
              showReset
            />
            <ParameterSlider
              label="Consecutive Frames Required"
              value={params.minConsecutiveFrames ?? 10}
              onChange={(v) => updateParam("minConsecutiveFrames", v)}
              min={3}
              max={100}
              step={1}
              defaultValue={10}
              showReset
              description="Frames signal must persist"
            />
          </>
        );

      case "disappearing_signal":
        return (
          <>
            <ParameterSlider
              label="Previous Threshold"
              value={params.thresholdDbm ?? -70}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-70}
              showReset
              description="Signal was above this"
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 10}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={2}
              max={50}
              step={1}
              defaultValue={10}
              showReset
            />
          </>
        );

      // =============================================
      // D: STRUCTURAL / SHAPE
      // =============================================
      case "single_peak":
      case "multi_peak":
        return (
          <>
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -70}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-70}
              showReset
            />
            <ParameterSlider
              label="Peak Prominence"
              value={params.peakProminenceDb ?? 10}
              onChange={(v) => updateParam("peakProminenceDb", v)}
              min={3}
              max={40}
              step={1}
              unit="dB"
              defaultValue={10}
              showReset
            />
            {filterType === "multi_peak" && (
              <ParameterSlider
                label="Minimum Peaks"
                value={params.minPeakCount ?? 2}
                onChange={(v) => updateParam("minPeakCount", v)}
                min={2}
                max={10}
                step={1}
                defaultValue={2}
                showReset
              />
            )}
          </>
        );

      case "harmonics":
        return (
          <>
            <FrequencyInput
              label="Fundamental Frequency"
              value={params.fundamentalHz ?? 100000000}
              onChange={(v) => updateParam("fundamentalHz", v)}
            />
            <ParameterSlider
              label="Harmonic Count"
              value={params.harmonicCount ?? 3}
              onChange={(v) => updateParam("harmonicCount", v)}
              min={2}
              max={5}
              step={1}
              defaultValue={3}
              showReset
              description="Check f, 2f, 3f..."
            />
            <FrequencyInput
              label="Frequency Tolerance"
              value={params.harmonicToleranceHz ?? 100000}
              onChange={(v) => updateParam("harmonicToleranceHz", v)}
            />
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -70}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-70}
              showReset
            />
          </>
        );

      case "template_corr":
        return (
          <>
            <ParameterSlider
              label="Correlation Threshold"
              value={params.corrThreshold ?? 0.8}
              onChange={(v) => updateParam("corrThreshold", v)}
              min={0.5}
              max={1}
              step={0.05}
              defaultValue={0.8}
              showReset
              description="0.8 = 80% match required"
            />
            <div className="space-y-2">
              <Label>Template Pattern (comma-separated dBm)</Label>
              <Textarea
                value={(params.template ?? []).join(", ")}
                onChange={(e) => {
                  const values = e.target.value
                    .split(",")
                    .map((s) => parseFloat(s.trim()))
                    .filter((n) => !isNaN(n));
                  updateParam("template", values);
                }}
                placeholder="-90, -80, -60, -40, -60, -80, -90"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Define the expected spectral shape as power levels
              </p>
            </div>
          </>
        );

      case "multi_band_combo":
        return (
          <>
            <div className="space-y-2">
              <Label>Combo Logic</Label>
              <Select
                value={params.comboLogic ?? "AND"}
                onValueChange={(v) => updateParam("comboLogic", v as "AND" | "OR")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">AND (all bands must match)</SelectItem>
                  <SelectItem value="OR">OR (any band must match)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure individual band thresholds below. Each band uses the same peak detection.
            </p>
          </>
        );

      // =============================================
      // E: MOVEMENT / CHANGE
      // =============================================
      case "frequency_hopping":
        return (
          <>
            <ParameterSlider
              label="Threshold"
              value={params.thresholdDbm ?? -70}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-70}
              showReset
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 20}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={5}
              max={100}
              step={1}
              defaultValue={20}
              showReset
              description="Frames to analyze for hopping"
            />
            <p className="text-xs text-muted-foreground">
              Define multiple bands below. Filter triggers when peak hops between bands.
            </p>
          </>
        );

      case "drifting_carrier":
        return (
          <>
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -70}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-70}
              showReset
            />
            <FrequencyInput
              label="Max Drift Rate"
              value={params.driftRateHzPerSec ?? 100}
              onChange={(v) => updateParam("driftRateHzPerSec", v)}
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 50}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={10}
              max={200}
              step={5}
              defaultValue={50}
              showReset
            />
          </>
        );

      case "power_ramp":
        return (
          <>
            <ParameterSlider
              label="Ramp Rate"
              value={params.powerRampDbPerSec ?? 5}
              onChange={(v) => updateParam("powerRampDbPerSec", v)}
              min={1}
              max={30}
              step={1}
              unit="dB/s"
              defaultValue={5}
              showReset
              description="Power change rate to detect"
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 20}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={5}
              max={100}
              step={1}
              defaultValue={20}
              showReset
            />
          </>
        );

      // =============================================
      // F: DOMAIN-SPECIFIC HEURISTICS
      // =============================================
      case "broadcast_fm_like":
        return (
          <>
            <ParameterSlider
              label="Average Threshold"
              value={params.avgThresholdDbm ?? -60}
              onChange={(v) => updateParam("avgThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-60}
              showReset
            />
            <FrequencyInput
              label="Minimum Bandwidth"
              value={params.minBandwidthHz ?? 150000}
              onChange={(v) => updateParam("minBandwidthHz", v)}
            />
            <FrequencyInput
              label="Maximum Bandwidth"
              value={params.maxBandwidthHz ?? 250000}
              onChange={(v) => updateParam("maxBandwidthHz", v)}
            />
          </>
        );

      case "narrowband_fm_voice":
      case "am_voice_like":
        return (
          <>
            <ParameterSlider
              label="Threshold"
              value={params.thresholdDbm ?? -85}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-85}
              showReset
            />
            <FrequencyInput
              label="Minimum Bandwidth"
              value={params.minBandwidthHz ?? 5000}
              onChange={(v) => updateParam("minBandwidthHz", v)}
            />
            <FrequencyInput
              label="Maximum Bandwidth"
              value={params.maxBandwidthHz ?? 15000}
              onChange={(v) => updateParam("maxBandwidthHz", v)}
            />
            <ParameterSlider
              label="Burst Rise"
              value={params.burstRiseDb ?? 10}
              onChange={(v) => updateParam("burstRiseDb", v)}
              min={3}
              max={30}
              step={1}
              unit="dB"
              defaultValue={10}
              showReset
            />
          </>
        );

      case "cw_morse_like":
        return (
          <>
            <ParameterSlider
              label="Peak Threshold"
              value={params.peakThresholdDbm ?? -80}
              onChange={(v) => updateParam("peakThresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-80}
              showReset
            />
            <ParameterSlider
              label="Peak Prominence"
              value={params.peakProminenceDb ?? 20}
              onChange={(v) => updateParam("peakProminenceDb", v)}
              min={5}
              max={40}
              step={1}
              unit="dB"
              defaultValue={20}
              showReset
            />
            <FrequencyInput
              label="Max Bandwidth"
              value={params.maxBandwidthHz ?? 500}
              onChange={(v) => updateParam("maxBandwidthHz", v)}
            />
          </>
        );

      case "digital_burst_cluster":
        return (
          <>
            <ParameterSlider
              label="Threshold"
              value={params.thresholdDbm ?? -90}
              onChange={(v) => updateParam("thresholdDbm", v)}
              min={-120}
              max={0}
              step={1}
              unit="dBm"
              defaultValue={-90}
              showReset
            />
            <ParameterSlider
              label="Minimum Peaks"
              value={params.minPeakCount ?? 3}
              onChange={(v) => updateParam("minPeakCount", v)}
              min={2}
              max={20}
              step={1}
              defaultValue={3}
              showReset
            />
            <FrequencyInput
              label="Min Peak Separation"
              value={params.minPeakSeparationHz ?? 50}
              onChange={(v) => updateParam("minPeakSeparationHz", v)}
            />
            <ParameterSlider
              label="Frame Window"
              value={params.frameWindowSize ?? 30}
              onChange={(v) => updateParam("frameWindowSize", v)}
              min={10}
              max={100}
              step={5}
              defaultValue={30}
              showReset
            />
          </>
        );

      case "unknown_emitter":
        return (
          <>
            <div className="space-y-2">
              <Label>Baseline Mode</Label>
              <Select
                value={params.baselineMode ?? "rolling"}
                onValueChange={(v) => updateParam("baselineMode", v as "rolling" | "fixed")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rolling">Rolling Average</SelectItem>
                  <SelectItem value="fixed">Fixed Baseline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ParameterSlider
              label="Baseline Frames"
              value={params.baselineFrames ?? 200}
              onChange={(v) => updateParam("baselineFrames", v)}
              min={50}
              max={500}
              step={10}
              defaultValue={200}
              showReset
            />
            <ParameterSlider
              label="Threshold Above Baseline"
              value={params.baselineThresholdDb ?? 15}
              onChange={(v) => updateParam("baselineThresholdDb", v)}
              min={5}
              max={40}
              step={1}
              unit="dB"
              defaultValue={15}
              showReset
            />
            <ParameterSlider
              label="SNR Threshold"
              value={params.snrThresholdDb ?? 10}
              onChange={(v) => updateParam("snrThresholdDb", v)}
              min={3}
              max={30}
              step={1}
              unit="dB"
              defaultValue={10}
              showReset
            />
          </>
        );

      default:
        return (
          <p className="text-sm text-muted-foreground">
            No additional parameters for this filter type.
          </p>
        );
    }
  };

  return <div className="space-y-4">{renderByCategory()}</div>;
};

export default FilterParamsEditor;
