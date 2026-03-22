import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Play,
  Pause,
  Save,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Radio,
  Activity,
} from "lucide-react";
import { getFilter, saveFilters, loadFilters } from "@/services/filterStore";
import { FilterParamsEditor } from "@/components/filters/FilterParamsEditor";
import { formatHz } from "@/components/filters/FrequencyInput";
import {
  loadSelectedRadios,
  saveSelectedRadios,
  groupDataSourcesByHost,
} from "@/config/dataSources";
import { WebSocketStreamClient } from "@/services/stream";
import type { StreamClient, SpectrumMessage } from "@/services/stream";
import { toSpectrumFrame } from "@/services/spectrumAdapter";
import { useFilterWorker } from "@/hooks/useFilterWorker";
import type { FilterConfig, SpectrumFrame } from "@/types/sdr";
import { FILTER_TYPE_INFO } from "@/types/sdr";
import { toast } from "@/hooks/use-toast";
import { useStreamableDatasources } from "@/hooks/useDatasources";
import type { DataSource } from "@/types/sources";

const MAX_LOG_ENTRIES = 50;
const TARGET_FPS = 20;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

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

interface MatchLogEntry {
  ts: number;
  matched: boolean;
  score?: number;
  reason?: string;
}

const FilterTestMode: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [filter, setFilter] = useState<FilterConfig | null>(null);
  const [originalFilter, setOriginalFilter] = useState<FilterConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const [selectedRadio, setSelectedRadio] = useState<string>("");
  const [running, setRunning] = useState(true);
  const [streamStatus, setStreamStatus] = useState("Disconnected");
  const [streamConnected, setStreamConnected] = useState(false);
  const [currentMatch, setCurrentMatch] = useState<boolean>(false);
  const [matchLog, setMatchLog] = useState<MatchLogEntry[]>([]);
  const [latestFrame, setLatestFrame] = useState<SpectrumFrame | null>(null);

  const clientRef = useRef<StreamClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRenderTimeRef = useRef<number>(0);

  const { testFilter, isReady: workerReady } = useFilterWorker();
  const { data: rawDatasources = [], isLoading: isLoadingDatasources } = useStreamableDatasources();
  const dataSources = useMemo(() => groupDataSourcesByHost(rawDatasources), [rawDatasources]);
  const isRadioSelectable = useCallback((source: DataSource, radioId: string): boolean => {
    const radio = source.radios.find((r) => r.id === radioId);
    const wsBase = String(radio?.meta?.wsEndpoint || source.endpoint || "").trim();
    return wsBase.length > 0;
  }, []);

  const getSourceAndRadio = useCallback(
    (radioKey: string): { source: DataSource; radioId: string } | null => {
      if (!radioKey) return null;
      const [sourceId, radioId] = radioKey.split(":");
      if (!sourceId || !radioId) return null;
      const source = dataSources.find((s) => s.id === sourceId);
      if (!source) return null;
      const radio = source.radios.find((r) => r.id === radioId);
      if (!radio) return null;
      return { source, radioId };
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

  // Load filter
  useEffect(() => {
    if (id) {
      const existing = getFilter(id);
      if (existing) {
        setFilter(existing);
        setOriginalFilter(existing);
      } else {
        toast({ title: "Filter not found", variant: "destructive" });
        navigate("/admin/filters");
      }
    }
  }, [id, navigate]);

  // Track changes
  useEffect(() => {
    if (filter && originalFilter) {
      setHasChanges(JSON.stringify(filter) !== JSON.stringify(originalFilter));
    }
  }, [filter, originalFilter]);

  // Initialize radio selection from saved radio or first available live device
  useEffect(() => {
    if (dataSources.length === 0) return;

    const availableRadios = dataSources.flatMap((source) =>
      source.radios.map((radio) => ({
        key: `${source.id}:${radio.id}`,
        disabled: !isRadioSelectable(source, radio.id),
      }))
    );

    if (availableRadios.length === 0) return;

    if (selectedRadio && availableRadios.some((r) => r.key === selectedRadio)) {
      return;
    }

    const savedRadios = loadSelectedRadios();
    if (savedRadios.length > 0) {
      const savedKey = `${savedRadios[0].sourceId}:${savedRadios[0].radioId}`;
      if (availableRadios.some((r) => r.key === savedKey && !r.disabled)) {
        setSelectedRadio(savedKey);
        return;
      }
    }

    const firstEnabled = availableRadios.find((r) => !r.disabled) ?? availableRadios[0];
    setSelectedRadio(firstEnabled.key);
  }, [dataSources, selectedRadio, isRadioSelectable]);

  useEffect(() => {
    if (!selectedRadio) return;
    const [sourceId, radioId] = selectedRadio.split(":");
    if (!sourceId || !radioId) return;
    saveSelectedRadios([{ sourceId, radioId }]);
  }, [selectedRadio]);

  // Handle incoming spectrum frame
  const handleSpectrumMessage = useCallback(
    (msg: SpectrumMessage) => {
      const now = performance.now();
      if (now - lastRenderTimeRef.current < FRAME_INTERVAL) return;
      lastRenderTimeRef.current = now;

      const frame = toSpectrumFrame(msg.payload);
      if (!frame) return;

      setLatestFrame(frame);

      // Test filter
      if (filter && workerReady) {
        testFilter(frame, filter, (result) => {
          const matched = result !== null;
          setCurrentMatch(matched);

          setMatchLog((prev) => [
            {
              ts: Date.now(),
              matched,
              score: result?.score,
              reason: result?.reason,
            },
            ...prev,
          ].slice(0, MAX_LOG_ENTRIES));
        });
      }
    },
    [filter, workerReady, testFilter]
  );

  // Connect to selected radio
  useEffect(() => {
    if (!selectedRadio || !running) return;

    const selected = getSourceAndRadio(selectedRadio);
    if (!selected) return;
    const { source, radioId } = selected;
    const [sourceId] = selectedRadio.split(":");

    let cancelled = false;
    const connect = async (): Promise<void> => {
      setStreamStatus("Connecting...");
      setStreamConnected(false);
      try {
        const endpoint = resolveRadioEndpoint(source, radioId);
        if (!endpoint) {
          throw new Error("No websocket endpoint available");
        }

        const client = new WebSocketStreamClient(sourceId, endpoint);
        client.onStatus((status) => {
          if (cancelled) return;
          setStreamConnected(Boolean(status.connected));
          setStreamStatus(status.details || (status.connected ? "Connected" : "Disconnected"));
        });
        client.onError((error) => {
          if (cancelled) return;
          setStreamConnected(false);
          setStreamStatus(error.message || "Stream error");
        });
        client.onSpectrum((msg: SpectrumMessage) => {
          if (cancelled) return;
          handleSpectrumMessage(msg);
        });

        await client.subscribeSpectrum(sourceId, radioId);
        if (cancelled) {
          await client.disconnect();
          return;
        }

        clientRef.current = client;
        await client.connect();
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to connect to live stream";
        setStreamConnected(false);
        setStreamStatus(message);
        toast({ title: "Filter test stream failed", description: message, variant: "destructive" });
      }
    };

    void connect();

    return () => {
      cancelled = true;
      void clientRef.current?.disconnect();
      clientRef.current = null;
      setStreamConnected(false);
      setStreamStatus("Disconnected");
    };
  }, [selectedRadio, running, getSourceAndRadio, resolveRadioEndpoint, handleSpectrumMessage]);

  // Draw spectrum chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !latestFrame) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width || 800));
    const height = Math.max(220, Math.floor(bounds.height || 300));
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(width * dpr);
    const pixelHeight = Math.floor(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "hsl(222, 47%, 5%)";
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "hsl(220, 20%, 15%)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i / 10) * height);
      ctx.lineTo(width, (i / 10) * height);
      ctx.stroke();
    }

    // Draw filter bands highlight
    if (filter) {
      const startFreq = latestFrame.centerHz - latestFrame.spanHz / 2;
      filter.bands.forEach((band) => {
        const x1 = ((band.startHz - startFreq) / latestFrame.spanHz) * width;
        const x2 = ((band.endHz - startFreq) / latestFrame.spanHz) * width;

        ctx.fillStyle = currentMatch
          ? filter.severity === "critical"
            ? "rgba(239, 68, 68, 0.3)"
            : filter.severity === "warn"
            ? "rgba(245, 158, 11, 0.3)"
            : "rgba(59, 130, 246, 0.3)"
          : "rgba(100, 100, 100, 0.2)";

        ctx.fillRect(Math.max(0, x1), 0, Math.min(width, x2) - Math.max(0, x1), height);
      });
    }

    // Draw spectrum line
    const bins = latestFrame.binsDbm;
    const { minDb, maxDb } = resolveDbWindow(bins);
    const dbRange = Math.max(1, maxDb - minDb);

    ctx.beginPath();
    ctx.strokeStyle = currentMatch ? "#22c55e" : "#3b82f6";
    ctx.lineWidth = 2;

    for (let i = 0; i < bins.length; i++) {
      const x = (i / bins.length) * width;
      const normalized = Math.max(0, Math.min(1, (bins[i] - minDb) / dbRange));
      const y = height - normalized * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "hsl(var(--muted-foreground))";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${maxDb.toFixed(0)} dB`, 6, 14);
    ctx.fillText(`${minDb.toFixed(0)} dB`, 6, height - 6);

  }, [latestFrame, filter, currentMatch]);

  // Save changes
  const handleSave = () => {
    if (!filter) return;
    const filters = loadFilters();
    const index = filters.findIndex((f) => f.id === filter.id);
    if (index !== -1) {
      filters[index] = { ...filter, updatedAt: Date.now() };
      saveFilters(filters);
      setOriginalFilter(filter);
      setHasChanges(false);
      toast({ title: "Changes saved" });
    }
  };

  // Discard changes
  const handleDiscard = () => {
    if (originalFilter) {
      setFilter(originalFilter);
      setHasChanges(false);
    }
  };

  // Build radio options from live datasources
  const radioOptions = dataSources.flatMap((source) =>
    source.radios.map((radio) => ({
      value: `${source.id}:${radio.id}`,
      label: `${source.name} / ${radio.name}`,
      disabled: !isRadioSelectable(source, radio.id),
    }))
  );

  if (!filter) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading filter...</p>
      </div>
    );
  }

  const typeInfo = FILTER_TYPE_INFO[filter.type];

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/admin/filters/${id}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6" />
              Test Mode: {filter.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {typeInfo.label} • {typeInfo.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Match Indicator */}
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
              currentMatch
                ? "bg-green-500/20 border border-green-500/50"
                : "bg-muted/50 border border-border"
            }`}
          >
            {currentMatch ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
            <span className={`font-medium ${currentMatch ? "text-green-500" : "text-muted-foreground"}`}>
              {currentMatch ? "MATCHED" : "NOT MATCHED"}
            </span>
          </div>

          {/* Run/Pause */}
          <Button
            variant={running ? "outline" : "default"}
            size="icon"
            onClick={() => setRunning(!running)}
          >
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Badge variant={streamConnected ? "default" : "secondary"}>
            {running ? streamStatus : "Paused"}
          </Badge>
        </div>
      </div>

      {/* Radio Selector */}
      <div className="flex items-center gap-4">
        <Label className="text-sm">Data Source:</Label>
        <Select value={selectedRadio} onValueChange={setSelectedRadio}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Select radio" />
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
          <Badge variant="outline">Loading devices...</Badge>
        )}
        {!isLoadingDatasources && radioOptions.length === 0 && (
          <Badge variant="destructive">No live stream devices found</Badge>
        )}
        {hasChanges && (
          <Badge variant="secondary" className="ml-auto">
            Unsaved changes
          </Badge>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        {/* Left: Spectrum Canvas */}
        <Card className="lg:col-span-2 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live Spectrum (Test Scope)</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2">
            <canvas
              ref={canvasRef}
              width={800}
              height={300}
              className="w-full h-full rounded border border-border bg-background"
            />
            {latestFrame && (
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>Center: {formatHz(latestFrame.centerHz)}</span>
                <span>Span: {formatHz(latestFrame.spanHz)}</span>
                <span>Bins: {latestFrame.binsDbm.length}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Parameters + Match Log */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Parameters */}
          <Card className="flex-1 min-h-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Parameters (Live Edit)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <ScrollArea className="h-[200px] pr-4">
                <FilterParamsEditor
                  filterType={filter.type}
                  params={filter.params}
                  onChange={(params) => setFilter((prev) => prev ? { ...prev, params } : prev)}
                />
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Match Log */}
          <Card className="flex-1 min-h-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Match Log</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[200px]">
                {matchLog.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    Waiting for matches...
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {matchLog.map((entry, index) => (
                      <div
                        key={index}
                        className={`px-3 py-2 text-xs ${
                          entry.matched ? "bg-green-500/5" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={entry.matched ? "text-green-500" : "text-muted-foreground"}>
                            {entry.matched ? "✓ Match" : "✗ No match"}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(entry.ts).toLocaleTimeString()}
                          </span>
                        </div>
                        {entry.matched && entry.reason && (
                          <p className="mt-1 text-muted-foreground">{entry.reason}</p>
                        )}
                        {entry.matched && entry.score !== undefined && (
                          <p className="text-primary">Score: {(entry.score * 100).toFixed(0)}%</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex justify-between items-center pt-4 border-t">
        <Button variant="outline" onClick={() => navigate(`/admin/filters/${id}`)}>
          Back to Editor
        </Button>
        <div className="flex gap-2">
          {hasChanges && (
            <>
              <Button variant="ghost" onClick={handleDiscard} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Discard
              </Button>
              <Button onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" />
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FilterTestMode;
