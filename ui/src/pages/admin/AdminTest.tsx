import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Square, Zap, AlertTriangle, Radio } from "lucide-react";
import { WebSocketStreamClient } from "@/services/stream";
import type { StreamClient, SpectrumMessage } from "@/services/stream";
import { toSpectrumFrame } from "@/services/spectrumAdapter";
import { loadFilters } from "@/services/filterStore";
import { useFilterWorker } from "@/hooks/useFilterWorker";
import type { SpectrumFrame, FilterConfig, MatchResult } from "@/types/sdr";
import { useStreamableDatasources } from "@/hooks/useDatasources";
import { groupDataSourcesByHost, loadSelectedRadios, saveSelectedRadios } from "@/config/dataSources";
import type { DataSource } from "@/types/sources";
import { toast } from "@/hooks/use-toast";

const AdminTest: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [streamStatus, setStreamStatus] = useState("Disconnected");
  const [frameCount, setFrameCount] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [lastFrame, setLastFrame] = useState<SpectrumFrame | null>(null);
  const [recentMatches, setRecentMatches] = useState<MatchResult[]>([]);
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [testPayload, setTestPayload] = useState<string>("");
  const [selectedRadio, setSelectedRadio] = useState("");

  const clientRef = useRef<StreamClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { evaluate: evaluateFilters, isReady: workerReady } = useFilterWorker();
  const { data: rawDatasources = [], isLoading: isLoadingDatasources } = useStreamableDatasources();
  const dataSources = useMemo(() => groupDataSourcesByHost(rawDatasources), [rawDatasources]);

  const getSourceAndRadio = useCallback(
    (radioKey: string): { source: DataSource; sourceId: string; radioId: string } | null => {
      if (!radioKey) return null;
      const [sourceId, radioId] = radioKey.split(":");
      if (!sourceId || !radioId) return null;
      const source = dataSources.find((s) => s.id === sourceId);
      if (!source) return null;
      const radio = source.radios.find((r) => r.id === radioId);
      if (!radio || radio.meta?.disabled) return null;
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
      const normalizedPath = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
      return new URL(normalizedPath, wsBase).toString();
    } catch {
      return wsBase;
    }
  }, []);

  useEffect(() => {
    setFilters(loadFilters());
  }, []);

  useEffect(() => {
    if (dataSources.length === 0) return;

    const available = dataSources.flatMap((source) =>
      source.radios.map((radio) => ({
        key: `${source.id}:${radio.id}`,
        disabled: Boolean(radio.meta?.disabled),
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
  }, [dataSources, selectedRadio]);

  useEffect(() => {
    if (!selectedRadio) return;
    const [sourceId, radioId] = selectedRadio.split(":");
    if (!sourceId || !radioId) return;
    saveSelectedRadios([{ sourceId, radioId }]);
  }, [selectedRadio]);

  const handleSpectrumMessage = useCallback(
    (msg: SpectrumMessage) => {
      const frame = toSpectrumFrame(msg.payload);
      if (!frame) return;

      setLastFrame(frame);
      setFrameCount((c) => c + 1);

      const enabledFilters = filters.filter((f) => f.enabled);
      if (workerReady && enabledFilters.length > 0) {
        evaluateFilters(frame, enabledFilters, (matches) => {
          if (matches.length > 0) {
            setMatchCount((c) => c + matches.length);
            setRecentMatches((prev) => [...matches, ...prev].slice(0, 10));
          }
        });
      }
    },
    [filters, workerReady, evaluateFilters]
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

  const handleTestPayload = () => {
    try {
      const payload = JSON.parse(testPayload);
      const frame = toSpectrumFrame(payload);
      if (frame) {
        setLastFrame(frame);
        setFrameCount((c) => c + 1);

        const enabledFilters = filters.filter((f) => f.enabled);
        if (workerReady && enabledFilters.length > 0) {
          evaluateFilters(frame, enabledFilters, (matches) => {
            if (matches.length > 0) {
              setMatchCount((c) => c + matches.length);
              setRecentMatches((prev) => [...matches, ...prev].slice(0, 10));
            }
          });
        }
      }
    } catch (e) {
      console.error("Invalid JSON:", e);
    }
  };

  // Draw spectrum
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !lastFrame) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

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
    const minDb = -120;
    const maxDb = -20;

    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < bins.length; i++) {
      const x = (i / bins.length) * width;
      const normalized = (bins[i] - minDb) / (maxDb - minDb);
      const y = height - normalized * height;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
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
      disabled: Boolean(radio.meta?.disabled),
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
                  {filters.filter((f) => f.enabled).length}
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
                onChange={(e) => setTestPayload(e.target.value)}
                placeholder={samplePayload}
                className="font-mono text-xs h-32"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleTestPayload} className="gap-2">
                <Play className="h-4 w-4" />
                Test Payload
              </Button>
              <Button
                variant="outline"
                onClick={() => setTestPayload(samplePayload)}
              >
                Load Sample
              </Button>
            </div>
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
