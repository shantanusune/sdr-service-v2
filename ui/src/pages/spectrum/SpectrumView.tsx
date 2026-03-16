import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  Radio,
  Settings,
  Layers,
  Database,
  ChevronDown,
  RefreshCw,
  X,
  Check,
  Filter,
  Plus,
  Eye,
  EyeOff,
  Play,
  Pause,
} from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import {
  loadSelectedRadios,
  saveSelectedRadios,
  getDataSource,
  groupDataSourcesByHost,
  getRadioFromSources,
} from "@/config/dataSources";
import { useStreamableDatasources } from "@/hooks/useDatasources";
import { WebSocketStreamClient } from "@/services/stream";
import type { StreamClient, SpectrumMessage, StreamStatus } from "@/services/stream";
import { toSpectrumFrame } from "@/services/spectrumAdapter";
import { loadFilters, saveFilters } from "@/services/filterStore";
import { useFilterWorker } from "@/hooks/useFilterWorker";
import { FILTER_TYPE_INFO } from "@/types/sdr";
import type { SpectrumFrame, FilterConfig, MatchResult } from "@/types/sdr";
import type { SelectedRadio, DataSource } from "@/types/sources";

const MAX_MATCHES = 20;
const TARGET_FPS = 20;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

// Y-axis presets
const Y_AXIS_FIXED = { min: -120, max: 0, label: "Fixed (-120 to 0 dBm)" };

const SpectrumView: React.FC = () => {
  const navigate = useNavigate();
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["ADMIN"]);

  // Fetch datasources from API
  const { data: rawDatasources, isLoading: isLoadingDatasources } = useStreamableDatasources();

  // Transform backend DTOs to frontend format
  const dataSources = useMemo(() => {
    if (!rawDatasources) return [];
    return groupDataSourcesByHost(rawDatasources);
  }, [rawDatasources]);

  // Selected radios - persisted
  const [selectedRadios, setSelectedRadios] = useState<SelectedRadio[]>([]);
  // Pending selection in drawer (before Apply)
  const [pendingSelection, setPendingSelection] = useState<SelectedRadio[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [activeRadio, setActiveRadio] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState(false);
  const [autoYAxis, setAutoYAxis] = useState(false);
  const [badFrameWarning, setBadFrameWarning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<StreamStatus>({ connected: false });
  const [radioStatus, setRadioStatus] = useState<Map<string, "subscribed" | "pending" | "error">>(new Map());

  const [latestFrames, setLatestFrames] = useState<Map<string, SpectrumFrame>>(new Map());
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [filters, setFilters] = useState<FilterConfig[]>([]);

  const clientsRef = useRef<Map<string, StreamClient>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Throttling refs
  const lastRenderTimeRef = useRef<number>(0);
  const pendingFrameRef = useRef<Map<string, SpectrumFrame>>(new Map());
  const rafIdRef = useRef<number | null>(null);

  const { evaluate: evaluateFilters, isReady: workerReady } = useFilterWorker();

  // Load selected radios and filters on mount
  useEffect(() => {
    const radios = loadSelectedRadios();
    setSelectedRadios(radios);
    setPendingSelection(radios);
    if (radios.length > 0) {
      setActiveRadio(`${radios[0].sourceId}:${radios[0].radioId}`);
    }
    setFilters(loadFilters());
  }, []);

  // Sanitize and validate frame data
  const sanitizeFrame = useCallback((frame: SpectrumFrame): SpectrumFrame | null => {
    if (!frame.binsDbm || frame.binsDbm.length === 0) return null;

    const sanitizedBins: number[] = [];
    let invalidCount = 0;

    for (let i = 0; i < frame.binsDbm.length; i++) {
      const val = Number(frame.binsDbm[i]);
      if (!Number.isFinite(val)) {
        invalidCount++;
        // Replace invalid with noise floor
        sanitizedBins.push(-120);
      } else {
        sanitizedBins.push(val);
      }
    }

    // If >5% bins are invalid, skip frame
    const invalidRatio = invalidCount / frame.binsDbm.length;
    if (invalidRatio > 0.05) {
      setBadFrameWarning(true);
      setTimeout(() => setBadFrameWarning(false), 2000);
      return null;
    }

    return { ...frame, binsDbm: sanitizedBins };
  }, []);

  // Throttled rendering at max 20 FPS
  const throttledRender = useCallback(() => {
    const now = performance.now();
    const elapsed = now - lastRenderTimeRef.current;

    if (elapsed >= FRAME_INTERVAL) {
      // Apply pending frames
      if (pendingFrameRef.current.size > 0) {
        setLatestFrames(new Map(pendingFrameRef.current));
      }
      lastRenderTimeRef.current = now;
    }

    rafIdRef.current = null;
  }, []);

  const handleSpectrumMessage = useCallback(
    (msg: SpectrumMessage) => {
      const rawFrame = toSpectrumFrame(msg.payload);
      if (!rawFrame) return;

      const frame = sanitizeFrame(rawFrame);
      if (!frame) return;

      const key = `${msg.sourceId}:${msg.radioId}`;
      
      // Store pending frame for throttled rendering
      pendingFrameRef.current.set(key, frame);

      // Evaluate filters in worker
      const enabledFilters = filters.filter((f) => f.enabled);
      if (workerReady && enabledFilters.length > 0) {
        evaluateFilters(frame, enabledFilters, (newMatches) => {
          if (newMatches.length > 0) {
            setMatches((prev) => [...newMatches, ...prev].slice(0, MAX_MATCHES));
          }
        });
      }

      // Schedule throttled render
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(throttledRender);
      }
    },
    [filters, workerReady, evaluateFilters, sanitizeFrame, throttledRender]
  );

  // Connect to sources when streaming starts
  const startStreaming = useCallback(async () => {
    if (selectedRadios.length === 0 || dataSources.length === 0) return;

    // Disconnect existing (await to avoid leaked sockets)
    await Promise.allSettled(
      Array.from(clientsRef.current.values()).map((c) => c.disconnect())
    );
    clientsRef.current.clear();

    setLatestFrames(new Map());
    setRadioStatus(new Map());

    const sourceIds = [...new Set(selectedRadios.map((r) => r.sourceId))];

    for (const sourceId of sourceIds) {
      const source = getDataSource(sourceId, dataSources);
      if (!source || !source.enabled) continue;

      // Prefer per-radio wsEndpoint/wsPath when available
      const radiosForSource = selectedRadios.filter((r) => r.sourceId === sourceId);
      const firstRadio = radiosForSource.length
        ? getRadioFromSources(dataSources, radiosForSource[0].sourceId, radiosForSource[0].radioId)
        : undefined;

      const wsEndpoint = String((firstRadio?.meta as any)?.wsEndpoint || source.endpoint);
      const wsPath = String((firstRadio?.meta as any)?.wsPath || "");
      const endpoint = wsPath ? new URL(wsPath, wsEndpoint).toString() : wsEndpoint;

      try {
        const client = new WebSocketStreamClient(sourceId, endpoint);

        // Pre-queue subscriptions BEFORE connect to avoid race (server may push binary immediately)
        for (const radio of radiosForSource) {
          setRadioStatus((prev) => new Map(prev).set(`${radio.sourceId}:${radio.radioId}`, "pending"));
          await client.subscribeSpectrum(radio.sourceId, radio.radioId);
        }

        await client.connect();

        client.onStatus((status) => {
          setConnectionStatus(status);
        });

        client.onError((error) => {
          console.error(`[SpectrumView] Stream error:`, error);
        });

        client.onSpectrum(handleSpectrumMessage);

        clientsRef.current.set(sourceId, client);

        // Mark subscribed
        for (const radio of radiosForSource) {
          setRadioStatus((prev) => new Map(prev).set(`${radio.sourceId}:${radio.radioId}`, "subscribed"));
        }
      } catch (e) {
        console.error(`[SpectrumView] Failed to connect to ${sourceId}:`, e);
        setConnectionStatus({ connected: false, details: "Connection failed" });
        for (const radio of radiosForSource) {
          setRadioStatus((prev) => new Map(prev).set(`${radio.sourceId}:${radio.radioId}`, "error"));
        }
      }
    }

    setIsStreaming(true);
  }, [selectedRadios, dataSources, handleSpectrumMessage]);

  // Stop streaming
  const stopStreaming = useCallback(async () => {
    await Promise.allSettled(
      Array.from(clientsRef.current.values()).map((c) => c.disconnect())
    );
    clientsRef.current.clear();
    setConnectionStatus({ connected: false });
    setRadioStatus(new Map());
    setIsStreaming(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopStreaming();
    };
  }, [stopStreaming]);

  // Draw spectrum chart - FIXED: proper path management to prevent green fill
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // CRITICAL: Clear entire canvas each frame
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "hsl(222, 47%, 5%)";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = "hsl(220, 20%, 15%)";
    ctx.lineWidth = 1;

    // Horizontal grid lines (power levels)
    for (let i = 0; i <= 10; i++) {
      const y = (i / 10) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Vertical grid lines (frequency)
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Determine which frames to draw
    const framesToDraw: Array<{ key: string; frame: SpectrumFrame; color: string }> = [];

    if (overlayMode) {
      const colors = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];
      let colorIndex = 0;
      latestFrames.forEach((frame, key) => {
        framesToDraw.push({ key, frame, color: colors[colorIndex % colors.length] });
        colorIndex++;
      });
    } else if (activeRadio && latestFrames.has(activeRadio)) {
      framesToDraw.push({
        key: activeRadio,
        frame: latestFrames.get(activeRadio)!,
        color: "#22c55e",
      });
    }

    // Calculate y-axis range
    let minDb = Y_AXIS_FIXED.min;
    let maxDb = Y_AXIS_FIXED.max;

    if (autoYAxis && framesToDraw.length > 0) {
      let globalMin = Infinity;
      let globalMax = -Infinity;
      
      for (const { frame } of framesToDraw) {
        for (const val of frame.binsDbm) {
          if (val < globalMin) globalMin = val;
          if (val > globalMax) globalMax = val;
        }
      }

      // Add 10% padding
      const range = globalMax - globalMin;
      const padding = Math.max(range * 0.1, 5);
      minDb = globalMin - padding;
      maxDb = globalMax + padding;

      // Prevent min == max
      if (maxDb - minDb < 10) {
        minDb -= 5;
        maxDb += 5;
      }
    }

    const dbRange = maxDb - minDb;

    // Draw each spectrum - FIXED: separate path for stroke and fill
    framesToDraw.forEach(({ frame, color }) => {
      const bins = frame.binsDbm;
      if (bins.length === 0) return;

      // Build path points
      const points: Array<{ x: number; y: number }> = [];
      
      for (let i = 0; i < bins.length; i++) {
        const x = (i / bins.length) * width;
        const normalized = Math.max(0, Math.min(1, (bins[i] - minDb) / dbRange));
        const y = height - normalized * height;
        points.push({ x, y });
      }

      // Draw LINE (stroke) only - no area fill by default
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;

      for (let i = 0; i < points.length; i++) {
        if (i === 0) {
          ctx.moveTo(points[i].x, points[i].y);
        } else {
          ctx.lineTo(points[i].x, points[i].y);
        }
      }
      ctx.stroke();
      // DO NOT call fill() - this was causing the solid green issue
    });

    // Draw filter band highlights
    if (framesToDraw.length > 0) {
      const frame = framesToDraw[0].frame;
      const enabledFilters = filters.filter((f) => f.enabled);

      enabledFilters.forEach((filter) => {
        filter.bands.forEach((band) => {
          const startFreq = frame.centerHz - frame.spanHz / 2;
          const endFreq = frame.centerHz + frame.spanHz / 2;

          if (band.endHz < startFreq || band.startHz > endFreq) return;

          const x1 = ((band.startHz - startFreq) / frame.spanHz) * width;
          const x2 = ((band.endHz - startFreq) / frame.spanHz) * width;

          ctx.beginPath();
          ctx.fillStyle =
            filter.severity === "critical"
              ? "rgba(239, 68, 68, 0.15)"
              : filter.severity === "warn"
              ? "rgba(245, 158, 11, 0.15)"
              : "rgba(59, 130, 246, 0.15)";

          ctx.fillRect(Math.max(0, x1), 0, Math.min(width, x2) - Math.max(0, x1), height);
        });
      });
    }

    // Draw y-axis labels
    ctx.fillStyle = "hsl(215, 20%, 50%)";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    
    for (let i = 0; i <= 4; i++) {
      const db = maxDb - (dbRange * i) / 4;
      const y = (i / 4) * height + 12;
      ctx.fillText(`${db.toFixed(0)} dBm`, 4, y);
    }

  }, [latestFrames, activeRadio, overlayMode, filters, autoYAxis]);

  // Radio selection helpers
  const toggleRadioSelection = (sourceId: string, radioId: string) => {
    setPendingSelection((prev) => {
      const exists = prev.some((r) => r.sourceId === sourceId && r.radioId === radioId);
      if (exists) {
        return prev.filter((r) => !(r.sourceId === sourceId && r.radioId === radioId));
      }
      return [...prev, { sourceId, radioId }];
    });
  };

  const isRadioSelected = (sourceId: string, radioId: string) => {
    return pendingSelection.some((r) => r.sourceId === sourceId && r.radioId === radioId);
  };

  const handleApplySelection = () => {
    setSelectedRadios(pendingSelection);
    saveSelectedRadios(pendingSelection);
    if (pendingSelection.length > 0 && !activeRadio) {
      setActiveRadio(`${pendingSelection[0].sourceId}:${pendingSelection[0].radioId}`);
    }
    setLatestFrames(new Map()); // Clear old frames
    setDrawerOpen(false);
  };

  const handleClearSelection = () => {
    setPendingSelection([]);
  };

  const handleReconnect = async () => {
    stopStreaming();
    setTimeout(() => startStreaming(), 100);
  };

  const radioOptions = useMemo(() => selectedRadios.map((r) => ({
    value: `${r.sourceId}:${r.radioId}`,
    label: (() => {
      const radio = getRadioFromSources(dataSources, r.sourceId, r.radioId);
      return radio?.name ?? r.radioId;
    })(),
  })), [selectedRadios, dataSources]);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Live Spectrum</h1>
          
          {/* Start/Stop Button */}
          {!isStreaming ? (
            <Button 
              variant="default" 
              size="sm" 
              onClick={startStreaming}
              disabled={selectedRadios.length === 0}
              className="gap-2"
            >
              <Play className="h-4 w-4" />
              Start
            </Button>
          ) : (
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={stopStreaming}
              className="gap-2"
            >
              <Pause className="h-4 w-4" />
              Stop
            </Button>
          )}
          
          <Badge
            variant={isStreaming && connectionStatus.connected ? "default" : "secondary"}
            className={isStreaming && connectionStatus.connected ? "gap-1 bg-success/10 text-success border-success/30" : "gap-1"}
          >
            {isStreaming && connectionStatus.connected ? (
              <>
                <Wifi className="h-3 w-3" />
                <span className="w-1.5 h-1.5 rounded-full bg-success mr-1 animate-pulse" />
                Live
              </>
            ) : isStreaming ? (
              <>
                <WifiOff className="h-3 w-3" />
                Connecting...
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" />
                Stopped
              </>
            )}
          </Badge>
          {badFrameWarning && (
            <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-400">
              <AlertTriangle className="h-3 w-3" />
              Bad frame
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Y-Axis Toggle */}
          <div className="flex items-center gap-2">
            <Label htmlFor="y-axis-mode" className="text-sm">
              Auto Y
            </Label>
            <Switch
              id="y-axis-mode"
              checked={autoYAxis}
              onCheckedChange={setAutoYAxis}
            />
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="overlay-mode" className="text-sm">
              Overlay
            </Label>
            <Switch
              id="overlay-mode"
              checked={overlayMode}
              onCheckedChange={setOverlayMode}
            />
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>

          {!overlayMode && radioOptions.length > 1 && (
            <Select value={activeRadio ?? ""} onValueChange={setActiveRadio}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select radio" />
              </SelectTrigger>
              <SelectContent>
                {radioOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <Radio className="h-3 w-3" />
                      {opt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Settings Drawer with Tabs */}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] sm:w-[540px]">
              <SheetHeader>
                <SheetTitle>Spectrum Settings</SheetTitle>
              </SheetHeader>
              
              <Tabs defaultValue="sources" className="mt-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="sources" className="gap-2">
                    <Database className="h-4 w-4" />
                    Data Sources
                  </TabsTrigger>
                  <TabsTrigger value="filters" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Filters ({filters.filter(f => f.enabled).length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sources" className="mt-4 space-y-4">
                  <ScrollArea className="h-[calc(100vh-280px)]">
                    {isLoadingDatasources ? (
                      <div className="space-y-3">
                        {[1, 2].map((i) => (
                          <Skeleton key={i} className="h-32 rounded-lg" />
                        ))}
                      </div>
                    ) : dataSources.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No data sources available</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {dataSources.map((source) => (
                          <DataSourceCard
                            key={source.id}
                            source={source}
                            isRadioSelected={isRadioSelected}
                            toggleRadioSelection={toggleRadioSelection}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      className="flex-1 gap-2"
                      onClick={handleClearSelection}
                    >
                      <X className="h-4 w-4" />
                      Clear
                    </Button>
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={handleReconnect}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reconnect
                    </Button>
                    <Button
                      className="flex-1 gap-2"
                      onClick={handleApplySelection}
                    >
                      <Check className="h-4 w-4" />
                      Apply ({pendingSelection.length})
                    </Button>
                  </div>
                </TabsContent>

                {/* Active Filters Tab */}
                <TabsContent value="filters" className="mt-4 space-y-4">
                  <ScrollArea className="h-[calc(100vh-280px)]">
                    {filters.length === 0 ? (
                      <div className="text-center py-8">
                        <Filter className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <h3 className="font-medium mb-2">No Filters Created</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {isAdmin 
                            ? "Create filters to detect signals in the spectrum."
                            : "Contact an admin to create detection filters."}
                        </p>
                        {isAdmin && (
                          <Button onClick={() => navigate("/admin/filters/new")} className="gap-2">
                            <Plus className="h-4 w-4" />
                            Create Filter
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filters.map((filter) => (
                          <FilterToggleCard
                            key={filter.id}
                            filter={filter}
                            onToggle={(enabled) => {
                              const updated = filters.map(f => 
                                f.id === filter.id ? { ...f, enabled } : f
                              );
                              setFilters(updated);
                              saveFilters(updated);
                            }}
                            isAdmin={isAdmin}
                            onEdit={() => navigate(`/admin/filters/${filter.id}`)}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                  
                  {filters.length > 0 && (
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const updated = filters.map(f => ({ ...f, enabled: true }));
                          setFilters(updated);
                          saveFilters(updated);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Enable All
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const updated = filters.map(f => ({ ...f, enabled: false }));
                          setFilters(updated);
                          saveFilters(updated);
                        }}
                      >
                        <EyeOff className="h-4 w-4 mr-2" />
                        Disable All
                      </Button>
                      {isAdmin && (
                        <Button onClick={() => navigate("/admin/filters")} className="gap-2">
                          <Settings className="h-4 w-4" />
                          Manage
                        </Button>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Radio Status */}
      <div className="flex flex-wrap gap-2">
        {selectedRadios.map((r) => {
          const key = `${r.sourceId}:${r.radioId}`;
          const status = radioStatus.get(key) ?? "pending";
          const radio = getRadioFromSources(dataSources, r.sourceId, r.radioId);

          return (
            <Badge
              key={key}
              variant={status === "subscribed" ? "outline" : "secondary"}
              className="gap-1"
            >
              <Radio className="h-3 w-3" />
              {radio?.name ?? r.radioId}
              {status === "subscribed" && <span className="text-green-500">●</span>}
              {status === "pending" && <span className="text-yellow-500">○</span>}
              {status === "error" && <span className="text-red-500">✕</span>}
            </Badge>
          );
        })}
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        {/* Spectrum Chart */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Spectrum Display</span>
              <span className="text-xs text-muted-foreground font-normal">
                {autoYAxis ? "Auto Y-Axis" : `${Y_AXIS_FIXED.min} to ${Y_AXIS_FIXED.max} dBm`}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2">
            <canvas
              ref={canvasRef}
              width={1024}
              height={400}
              className="w-full h-full rounded border border-border bg-background"
              style={{ imageRendering: "auto" }}
            />
          </CardContent>
        </Card>

        {/* Matches Panel */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Filter Matches
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 min-h-0">
            <ScrollArea className="h-full max-h-[400px]">
              {matches.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  No matches yet
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {matches.map((match, index) => (
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
                      <p className="text-muted-foreground mt-1">
                        {new Date(match.ts).toLocaleTimeString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {selectedRadios.length === 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-8 text-center">
            <Radio className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="font-medium mb-2">No Radios Selected</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Open Data Sources to select radios for monitoring
            </p>
            <Button onClick={() => setDrawerOpen(true)}>
              <Database className="h-4 w-4 mr-2" />
              Select Radios
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

// Data Source Card Component
interface DataSourceCardProps {
  source: DataSource;
  isRadioSelected: (sourceId: string, radioId: string) => boolean;
  toggleRadioSelection: (sourceId: string, radioId: string) => void;
}

const DataSourceCard: React.FC<DataSourceCardProps> = ({
  source,
  isRadioSelected,
  toggleRadioSelection,
}) => {
  const [open, setOpen] = useState(true);

  return (
    <Card className={!source.enabled ? "opacity-50" : ""}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                <CardTitle className="text-sm">{source.name}</CardTitle>
                {!source.enabled && (
                  <Badge variant="secondary" className="text-xs">Disabled</Badge>
                )}
              </div>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
            {source.description && (
              <p className="text-xs text-muted-foreground">{source.description}</p>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            <div className="space-y-2">
              {source.radios.map((radio) => (
                <div
                  key={radio.id}
                  className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => source.enabled && toggleRadioSelection(source.id, radio.id)}
                >
                  <Checkbox
                    checked={isRadioSelected(source.id, radio.id)}
                    disabled={!source.enabled}
                    onCheckedChange={() => toggleRadioSelection(source.id, radio.id)}
                  />
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{radio.name}</p>
                    {radio.meta?.location && (
                      <p className="text-xs text-muted-foreground">{String(radio.meta.location)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

// Filter Toggle Card Component
interface FilterToggleCardProps {
  filter: FilterConfig;
  onToggle: (enabled: boolean) => void;
  isAdmin: boolean;
  onEdit: () => void;
}

const FilterToggleCard: React.FC<FilterToggleCardProps> = ({
  filter,
  onToggle,
  isAdmin,
  onEdit,
}) => {
  const typeInfo = FILTER_TYPE_INFO[filter.type];
  const severityColors = {
    info: "bg-blue-500",
    warn: "bg-yellow-500",
    critical: "bg-red-500",
  };

  return (
    <Card className={`transition-opacity ${!filter.enabled ? "opacity-60" : ""}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={filter.enabled}
            onCheckedChange={onToggle}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{filter.name}</span>
              <span className={`w-2 h-2 rounded-full ${severityColors[filter.severity]}`} />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {typeInfo?.label || filter.type}
            </p>
          </div>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Settings className="h-3 w-3" />
            </Button>
          )}
        </div>
        {filter.bands.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {filter.bands.slice(0, 2).map((band, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">
                {formatHz(band.startHz)} - {formatHz(band.endHz)}
              </Badge>
            ))}
            {filter.bands.length > 2 && (
              <Badge variant="outline" className="text-[10px]">
                +{filter.bands.length - 2} more
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

function formatHz(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(2)}G`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)}M`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)}k`;
  return `${hz}`;
}

export default SpectrumView;
