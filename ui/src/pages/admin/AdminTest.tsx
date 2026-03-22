import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Play, Square, Zap, AlertTriangle, Radio, Plus, Trash2 } from "lucide-react";
import { WebSocketStreamClient } from "@/services/stream";
import type { StreamClient, SpectrumMessage } from "@/services/stream";
import { toSpectrumFrame } from "@/services/spectrumAdapter";
import { loadFilters } from "@/services/filterStore";
import { useFilterWorker } from "@/hooks/useFilterWorker";
import { FILTER_TYPE_INFO } from "@/types/sdr";
import type { SpectrumFrame, FilterConfig, MatchResult, FilterSeverity } from "@/types/sdr";
import { useStreamableDatasources } from "@/hooks/useDatasources";
import { groupDataSourcesByHost, loadSelectedRadios, saveSelectedRadios } from "@/config/dataSources";
import type { DataSource } from "@/types/sources";
import { toast } from "@/hooks/use-toast";

function resolveDbWindow(bins: number[]): { minDb: number; maxDb: number } {
  const sampled: number[] = [];
  const step = bins.length > 2048 ? 4 : bins.length > 1024 ? 2 : 1;
  for (let i = 0; i < bins.length; i += step) {
    const value = bins[i];
    if (!Number.isFinite(value) || value < -220 || value > 120) continue;
    sampled.push(value);
  }

  if (sampled.length === 0) {
    return { minDb: -120, maxDb: 0 };
  }

  sampled.sort((a, b) => a - b);
  const p05 = sampled[Math.max(0, Math.floor(sampled.length * 0.05))];
  const p98 = sampled[Math.max(0, Math.floor(sampled.length * 0.98))];

  let minDb = Math.floor((p05 - 6) / 5) * 5;
  let maxDb = Math.ceil((p98 + 3) / 5) * 5;

  minDb = Math.max(-180, minDb);
  maxDb = Math.min(60, maxDb);
  if (maxDb - minDb < 35) {
    maxDb = minDb + 35;
  }

  return { minDb, maxDb };
}

type QuickFilterType = "peak_in_band" | "threshold_in_band" | "avg_power_in_band";

const QUICK_FILTER_PRESETS: Record<
  QuickFilterType,
  {
    label: string;
    thresholdLabel: string;
    defaultThresholdDbm: number;
  }
> = {
  peak_in_band: {
    label: "Peak in Band",
    thresholdLabel: "Peak Threshold (dBm)",
    defaultThresholdDbm: -60,
  },
  threshold_in_band: {
    label: "Threshold in Band",
    thresholdLabel: "Threshold (dBm)",
    defaultThresholdDbm: -65,
  },
  avg_power_in_band: {
    label: "Average Power in Band",
    thresholdLabel: "Average Threshold (dBm)",
    defaultThresholdDbm: -75,
  },
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function firstField(payload: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return payload[key];
    }
  }
  return undefined;
}

function parseBins(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const bins = raw
      .map((item) => toFiniteNumber(item))
      .filter((item): item is number => item !== null);
    return bins.length > 0 ? bins : null;
  }

  if (typeof raw === "string") {
    const bins = raw
      .split(/[,\s]+/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .map((chunk) => Number(chunk))
      .filter((item) => Number.isFinite(item));
    return bins.length > 0 ? bins : null;
  }

  return null;
}

function normalizeCustomPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const parsed = raw as Record<string, unknown>;
  const nestedPayload = parsed.payload;
  const payload =
    nestedPayload && typeof nestedPayload === "object"
      ? (nestedPayload as Record<string, unknown>)
      : parsed;

  const normalized: Record<string, unknown> = { ...payload };
  const ts = toFiniteNumber(firstField(payload, ["ts", "timestamp", "time"]));
  const centerHz = toFiniteNumber(
    firstField(payload, ["cf", "centerFrequency", "centerHz", "center_frequency"])
  );
  const spanHz = toFiniteNumber(
    firstField(payload, ["sr", "sampleRate", "spanHz", "span", "sample_rate"])
  );
  const binHz = toFiniteNumber(firstField(payload, ["binHz", "bin_hz", "freqStep"]));
  const bins = parseBins(firstField(payload, ["bins", "binsDbm", "data", "values", "powers", "spectrum"]));
  const frameId = firstField(payload, ["frameId", "frame_id", "id", "seq"]);

  normalized.ts = ts ?? Date.now();
  if (centerHz !== null) normalized.cf = centerHz;
  if (spanHz !== null) normalized.sr = spanHz;
  if (binHz !== null) normalized.binHz = binHz;
  if (bins) normalized.bins = bins;
  if (frameId !== undefined && frameId !== null) normalized.frameId = String(frameId);

  return normalized;
}

function buildQuickFilterParams(type: QuickFilterType, thresholdDbm: number): FilterConfig["params"] {
  switch (type) {
    case "peak_in_band":
      return { peakThresholdDbm: thresholdDbm };
    case "threshold_in_band":
      return { thresholdDbm: thresholdDbm };
    case "avg_power_in_band":
      return { avgThresholdDbm: thresholdDbm };
    default:
      return {};
  }
}

const AdminTest: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [streamStatus, setStreamStatus] = useState("Disconnected");
  const [frameCount, setFrameCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [lastFrame, setLastFrame] = useState<SpectrumFrame | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchResult[]>([]);
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [quickFilters, setQuickFilters] = useState<FilterConfig[]>([]);
  const [testPayload, setTestPayload] = useState<string>("");
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [selectedRadio, setSelectedRadio] = useState("");
  const [quickType, setQuickType] = useState<QuickFilterType>("peak_in_band");
  const [quickName, setQuickName] = useState("");
  const [quickStartHz, setQuickStartHz] = useState<number>(2_395_000_000);
  const [quickEndHz, setQuickEndHz] = useState<number>(2_405_000_000);
  const [quickThresholdDbm, setQuickThresholdDbm] = useState<number>(
    QUICK_FILTER_PRESETS.peak_in_band.defaultThresholdDbm
  );
  const [quickSeverity, setQuickSeverity] = useState<FilterSeverity>("warn");
  const [quickCooldownMs, setQuickCooldownMs] = useState<number>(1000);

  const clientRef = useRef<StreamClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { evaluate: evaluateFilters, isReady: workerReady } = useFilterWorker();
  const { data: rawDatasources = [], isLoading: isLoadingDatasources } = useStreamableDatasources();
  const dataSources = useMemo(() => groupDataSourcesByHost(rawDatasources), [rawDatasources]);
  const isRadioSelectable = useCallback((source: DataSource, radioId: string): boolean => {
    const radio = source.radios.find((r) => r.id === radioId);
    const wsBase = String(radio?.meta?.wsEndpoint || source.endpoint || "").trim();
    return wsBase.length > 0;
  }, []);

  const getSourceAndRadio = useCallback(
    (radioKey: string): { source: DataSource; sourceId: string; radioId: string } | null => {
      if (!radioKey) return null;
      const [sourceId, radioId] = radioKey.split(":");
      if (!sourceId || !radioId) return null;
      const source = dataSources.find((s) => s.id === sourceId);
      if (!source) return null;
      const radio = source.radios.find((r) => r.id === radioId);
      if (!radio) return null;
      return { source, sourceId, radioId };
    },
    [dataSources]
  );

  const resolveRadioEndpoint = useCallback((source: DataSource, radioId: string): string => {
    const radio = source.radios.find((r) => r.id === radioId);
    const wsBase = String(radio?.meta?.wsEndpoint || source.endpoint || "").trim();
    const wsPath = String(radio?.meta?.wsPath || "").trim();
    if (!wsPath) return wsBase;
    try {
      // Keep path relative so '/ws/stream/' base is preserved.
      return new URL(wsPath, wsBase).toString();
    } catch {
      return wsBase;
    }
  }, []);

  useEffect(() => {
    setFilters(loadFilters());
  }, []);

  useEffect(() => {
    setQuickThresholdDbm(QUICK_FILTER_PRESETS[quickType].defaultThresholdDbm);
  }, [quickType]);

  useEffect(() => {
    if (dataSources.length === 0) return;

    const available = dataSources.flatMap((source) =>
      source.radios.map((radio) => ({
        key: `${source.id}:${radio.id}`,
        disabled: !isRadioSelectable(source, radio.id),
      }))
    );

    if (available.length === 0) return;
    if (selectedRadio && available.some((d) => d.key === selectedRadio)) return;

    const saved = loadSelectedRadios();
    if (saved.length > 0) {
      const savedKey = `${saved[0].sourceId}:${saved[0].radioId}`;
      if (available.some((d) => d.key === savedKey && !d.disabled)) {
        setSelectedRadio(savedKey);
        return;
      }
    }

    const firstEnabled = available.find((d) => !d.disabled) ?? available[0];
    setSelectedRadio(firstEnabled.key);
  }, [dataSources, selectedRadio, isRadioSelectable]);

  useEffect(() => {
    if (!selectedRadio) return;
    const [sourceId, radioId] = selectedRadio.split(":");
    if (!sourceId || !radioId) return;
    saveSelectedRadios([{ sourceId, radioId }]);
  }, [selectedRadio]);

  const activeFilters = useMemo(
    () =>
      [...filters, ...quickFilters].filter((filter) => filter.enabled && filter.scope !== "disabled"),
    [filters, quickFilters]
  );

  const processFrame = useCallback(
    (frame: SpectrumFrame, radioKey?: string) => {
      setLastFrame(frame);
      setFrameCount((c) => c + 1);

      if (workerReady && activeFilters.length > 0) {
        evaluateFilters(
          frame,
          activeFilters,
          (matches) => {
            if (matches.length > 0) {
              setMatchCount((c) => c + matches.length);
              setRecentMatches((prev) => [...matches, ...prev].slice(0, 10));
            }
          },
          radioKey
        );
      }
    },
    [workerReady, activeFilters, evaluateFilters]
  );

  const handleSpectrumMessage = useCallback(
    (msg: SpectrumMessage) => {
      const frame = toSpectrumFrame(msg.payload);
      if (!frame) return;
      processFrame(frame, `${msg.sourceId}:${msg.radioId}`);
    },
    [processFrame]
  );

  const handleStart = async () => {
    const selected = getSourceAndRadio(selectedRadio);
    if (!selected) {
      toast({
        title: "No live datasource selected",
        description: "Select an online device stream first",
        variant: "destructive",
      });
      return;
    }

    await handleStop();

    const { source, sourceId, radioId } = selected;
    const endpoint = resolveRadioEndpoint(source, radioId);
    if (!endpoint) {
      toast({
        title: "Missing websocket endpoint",
        description: "Selected datasource has no ws endpoint",
        variant: "destructive",
      });
      return;
    }

    try {
      const client = new WebSocketStreamClient(sourceId, endpoint);
      client.onSpectrum(handleSpectrumMessage);
      client.onStatus((status) => {
        setIsConnected(Boolean(status.connected));
        setStreamStatus(status.details || (status.connected ? "Connected" : "Disconnected"));
      });
      client.onError((error) => {
        setIsConnected(false);
        setStreamStatus(error.message || "Stream error");
      });

      await client.subscribeSpectrum(sourceId, radioId);
      clientRef.current = client;
      await client.connect();

      setIsRunning(true);
      setFrameCount(0);
      setMatchCount(0);
      setRecentMatches([]);
    } catch (e) {
      setIsConnected(false);
      const message = e instanceof Error ? e.message : "Failed to start live stream";
      setStreamStatus(message);
      toast({
        title: "Live stream failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleStop = async () => {
    if (clientRef.current) {
      await clientRef.current.disconnect();
      clientRef.current = null;
    }
    setIsRunning(false);
    setIsConnected(false);
    setStreamStatus("Disconnected");
  };

  useEffect(() => {
    return () => {
      void handleStop();
    };
  }, []);

  const addQuickFilter = () => {
    const startHz = Number(quickStartHz);
    const endHz = Number(quickEndHz);
    const thresholdDbm = Number(quickThresholdDbm);
    const cooldownMs = Number(quickCooldownMs);

    if (!Number.isFinite(startHz) || !Number.isFinite(endHz)) {
      toast({
        title: "Invalid band range",
        description: "Band start and end must be valid numbers",
        variant: "destructive",
      });
      return;
    }
    if (endHz <= startHz) {
      toast({
        title: "Invalid band range",
        description: "Band end must be greater than band start",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(thresholdDbm)) {
      toast({
        title: "Invalid threshold",
        description: "Threshold must be a valid number",
        variant: "destructive",
      });
      return;
    }

    const preset = QUICK_FILTER_PRESETS[quickType];
    const filterName =
      quickName.trim() ||
      `${preset.label} ${(startHz / 1e6).toFixed(3)}-${(endHz / 1e6).toFixed(3)} MHz`;

    const quickFilter: FilterConfig = {
      id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: filterName,
      type: quickType,
      category: FILTER_TYPE_INFO[quickType].category,
      enabled: true,
      scope: "test",
      severity: quickSeverity,
      cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, Math.floor(cooldownMs)) : 1000,
      bands: [{ startHz, endHz }],
      params: buildQuickFilterParams(quickType, thresholdDbm),
      createdAt: Date.now(),
    };

    setQuickFilters((prev) => [quickFilter, ...prev]);
    setQuickName("");
    toast({
      title: "Quick filter added",
      description: `${filterName} is now active`,
    });
  };

  const toggleQuickFilter = (id: string) => {
    setQuickFilters((prev) =>
      prev.map((filter) => (filter.id === id ? { ...filter, enabled: !filter.enabled } : filter))
    );
  };

  const removeQuickFilter = (id: string) => {
    setQuickFilters((prev) => prev.filter((filter) => filter.id !== id));
  };

  const handleTestPayload = () => {
    if (!testPayload.trim()) {
      setPayloadError("Paste a payload JSON or click Load Sample.");
      return;
    }

    try {
      const payload = JSON.parse(testPayload);
      const normalizedPayload = normalizeCustomPayload(payload);
      if (!normalizedPayload) {
        setPayloadError("Payload must be a JSON object.");
        return;
      }

      const frame = toSpectrumFrame(normalizedPayload);
      if (!frame) {
        setPayloadError(
          "Unable to parse payload. Required fields: center frequency, span/sample rate, and bins."
        );
        toast({
          title: "Payload parsing failed",
          description: "Expected cf/centerHz, sr/spanHz and bins array (or CSV bins string).",
          variant: "destructive",
        });
        return;
      }
      setPayloadError(null);
      processFrame(frame, selectedRadio || "custom-payload");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid JSON";
      setPayloadError(message);
      toast({
        title: "Invalid JSON",
        description: message,
        variant: "destructive",
      });
    }
  };

  // Draw spectrum
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !lastFrame) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width || 512));
    const height = Math.max(180, Math.floor(bounds.height || 200));
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(width * dpr);
    const pixelHeight = Math.floor(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "hsl(var(--background))";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "hsl(var(--border) / 0.3)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
      const y = (i / 10) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const bins = lastFrame.binsDbm;
    const { minDb, maxDb } = resolveDbWindow(bins);
    const dbRange = Math.max(1, maxDb - minDb);

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < bins.length; i++) {
      const x = (i / bins.length) * width;
      const normalized = Math.max(0, Math.min(1, (bins[i] - minDb) / dbRange));
      const y = height - normalized * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    ctx.fillStyle = "hsl(var(--muted-foreground))";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${maxDb.toFixed(0)} dB`, 6, 14);
    ctx.fillText(`${minDb.toFixed(0)} dB`, 6, height - 6);
  }, [lastFrame]);

  const samplePayload = JSON.stringify(
    {
      ts: Date.now(),
      cf: 100000000,
      sr: 10000000,
      bins: Array.from({ length: 512 }, () => -90 + Math.random() * 40),
    },
    null,
    2
  );

  const radioOptions = dataSources.flatMap((source) =>
    source.radios.map((radio) => ({
      value: `${source.id}:${radio.id}`,
      label: `${source.name} / ${radio.name}`,
      disabled: !isRadioSelectable(source, radio.id),
    }))
  );
  const hasLiveOptions = radioOptions.some((opt) => !opt.disabled);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Filter Test</h1>
        <p className="text-muted-foreground mt-1">
          Test filter evaluation against live device spectrum and custom payloads
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Live Device Stream
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Data Source</Label>
              <Select value={selectedRadio} onValueChange={setSelectedRadio}>
                <SelectTrigger>
                  <SelectValue placeholder="Select live device" />
                </SelectTrigger>
                <SelectContent>
                  {radioOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                      <div className="flex items-center gap-2">
                        <Radio className="h-3 w-3" />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isLoadingDatasources && (
                <p className="text-xs text-muted-foreground">Loading live datasources...</p>
              )}
              {!isLoadingDatasources && radioOptions.length === 0 && (
                <p className="text-xs text-destructive">No datasources available from backend</p>
              )}
            </div>

            <div className="flex gap-4">
              <Button
                onClick={handleStart}
                disabled={isRunning || !selectedRadio || !hasLiveOptions}
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                Start Live Stream
              </Button>
              <Button
                variant="outline"
                onClick={handleStop}
                disabled={!isRunning}
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-2xl font-bold">{frameCount}</p>
                <p className="text-xs text-muted-foreground">Frames</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-2xl font-bold">{matchCount}</p>
                <p className="text-xs text-muted-foreground">Matches</p>
              </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-2xl font-bold">
                  {activeFilters.length}
                </p>
                <p className="text-xs text-muted-foreground">Active Filters</p>
              </div>
            </div>

            <Badge variant={isConnected ? "default" : "secondary"}>
              {isRunning ? streamStatus : "Stopped"}
            </Badge>
          </CardContent>
        </Card>

        {/* Custom Payload Test */}
        <Card>
          <CardHeader>
            <CardTitle>Custom Payload Test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>JSON Payload</Label>
              <Textarea
                value={testPayload}
                onChange={(e) => {
                  setTestPayload(e.target.value);
                  if (payloadError) setPayloadError(null);
                }}
                placeholder={samplePayload}
                className="font-mono text-xs h-32"
              />
              <p className="text-[11px] text-muted-foreground">
                Accepts `payload` wrapper, aliases (`cf`/`centerHz`, `sr`/`spanHz`) and bins as array or CSV string.
              </p>
              {payloadError && <p className="text-xs text-destructive">{payloadError}</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={handleTestPayload} className="gap-2">
                <Play className="h-4 w-4" />
                Test Payload
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTestPayload(samplePayload);
                  setPayloadError(null);
                }}
              >
                Load Sample
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick Filter Builder */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quick Filters (On-The-Fly)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Name (optional)</Label>
                <Input
                  value={quickName}
                  onChange={(e) => setQuickName(e.target.value)}
                  placeholder="ex: 2.4GHz burst watch"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={quickType} onValueChange={(value) => setQuickType(value as QuickFilterType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(QUICK_FILTER_PRESETS).map(([value, preset]) => (
                      <SelectItem key={value} value={value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Band Start (Hz)</Label>
                <Input
                  type="number"
                  value={quickStartHz}
                  onChange={(e) => setQuickStartHz(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Band End (Hz)</Label>
                <Input
                  type="number"
                  value={quickEndHz}
                  onChange={(e) => setQuickEndHz(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>{QUICK_FILTER_PRESETS[quickType].thresholdLabel}</Label>
                <Input
                  type="number"
                  step="1"
                  value={quickThresholdDbm}
                  onChange={(e) => setQuickThresholdDbm(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={quickSeverity}
                  onValueChange={(value) => setQuickSeverity(value as FilterSeverity)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warn">Warn</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cooldown (ms)</Label>
                <Input
                  type="number"
                  min={0}
                  value={quickCooldownMs}
                  onChange={(e) => setQuickCooldownMs(Number(e.target.value))}
                />
              </div>
              <div className="flex items-end">
                <Button onClick={addQuickFilter} className="w-full gap-2">
                  <Plus className="h-4 w-4" />
                  Add Quick Filter
                </Button>
              </div>
            </div>

            {quickFilters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quick filters yet.</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {quickFilters.map((filter) => (
                  <div
                    key={filter.id}
                    className="rounded border border-border/70 bg-muted/30 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{filter.name}</p>
                        <p className="text-muted-foreground">
                          {FILTER_TYPE_INFO[filter.type].label} |{" "}
                          {(filter.bands[0]?.startHz ?? 0).toLocaleString()} -{" "}
                          {(filter.bands[0]?.endHz ?? 0).toLocaleString()} Hz
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={filter.enabled ? "secondary" : "outline"}
                          onClick={() => toggleQuickFilter(filter.id)}
                        >
                          {filter.enabled ? "Enabled" : "Disabled"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeQuickFilter(filter.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Spectrum Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Spectrum Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <canvas
              ref={canvasRef}
              width={512}
              height={200}
              className="w-full rounded border border-border bg-background"
            />
            {lastFrame && (
              <div className="mt-2 text-xs text-muted-foreground grid grid-cols-3 gap-2">
                <span>Center: {(lastFrame.centerHz / 1e6).toFixed(2)} MHz</span>
                <span>Span: {(lastFrame.spanHz / 1e6).toFixed(2)} MHz</span>
                <span>Bins: {lastFrame.binsDbm.length}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Matches */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Recent Matches
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentMatches.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No matches yet
              </p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {recentMatches.map((match, index) => (
                  <div
                    key={`${match.filterId}-${match.ts}-${index}`}
                    className={`p-2 rounded text-xs border ${
                      match.severity === "critical"
                        ? "bg-red-500/10 border-red-500/30"
                        : match.severity === "warn"
                        ? "bg-yellow-500/10 border-yellow-500/30"
                        : "bg-blue-500/10 border-blue-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{match.filterName}</span>
                      <Badge
                        variant={
                          match.severity === "critical"
                            ? "destructive"
                            : match.severity === "warn"
                            ? "secondary"
                            : "outline"
                        }
                        className="text-[10px] px-1"
                      >
                        {match.severity}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{match.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminTest;
