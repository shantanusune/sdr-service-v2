import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Pause, Trash2, Search, RefreshCw, Wifi, WifiOff, Settings2, Crosshair, TerminalSquare } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { SpectrumChart, type SpectrumHorizontalMarker } from '@/components/charts/SpectrumChart';
import { WaterfallChart } from '@/components/charts/WaterfallChart';
import { useSpectrumWS } from '@/realtime/useSpectrumWS';
import { useStreamableDatasources } from '@/hooks/useDatasources';
import { groupDataSourcesByHost } from '@/config/dataSources';
import { isDisabledState } from '@/types/api';
import type { SpectrumMarker } from '@/models/types';
import type { SpectrumFrame } from '@/types/sdr';
import { http } from '@/api/http';

interface RadioItem {
  sourceId: string;
  radioId: string;
  radioKey: string;
  name: string;
  type: string;
  sourceType: 'rawfeed' | 'spectrum' | 'unknown';
  state: string;
  disabled: boolean;
  centerHz?: number;
}

interface DetectionEventDto {
  eventId: string;
  machineId: string;
  deviceId: string;
  detectedAt: string;
  type: string;
  severity: string;
  confidence: number;
  evidence?: Record<string, unknown>;
}

interface NativeActivityEventDto {
  machineId: string;
  topic: string;
  ts: string;
  payload?: Record<string, unknown>;
}

interface EventsPayload {
  detections: DetectionEventDto[];
  nativeActivity: NativeActivityEventDto[];
}

type EventFilter = 'all' | 'detections' | 'activity';
const ALL_EVENT_TYPES = '__all_event_types__';

interface EventConsoleRow {
  id: string;
  kind: 'detection' | 'activity';
  eventType: string;
  ts: string;
  epochMs: number;
  summary: string;
}

const FPS_OPTIONS = [5, 10, 20, 30] as const;
const FPS_STORAGE_KEY = 'sdr.spectrumLab.fps';
const EVENT_ROWS_LIMIT = 250;

function toEpoch(ts: string | undefined): number {
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactJson(value: unknown, maxLength = 90): string {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
  } catch {
    return '';
  }
}

function formatDetectionSummary(event: DetectionEventDto): string {
  const confidencePct = Number.isFinite(event.confidence)
    ? `${(event.confidence * 100).toFixed(1)}%`
    : 'n/a';
  const centerFreq = typeof event.evidence?.centerFreqHz === 'number'
    ? `${((event.evidence.centerFreqHz as number) / 1e6).toFixed(3)} MHz`
    : 'n/a';

  return `${event.severity} ${event.type} device=${event.deviceId} confidence=${confidencePct} cf=${centerFreq}`;
}

function formatActivitySummary(event: NativeActivityEventDto): string {
  const payloadHint = compactJson(event.payload, 80);
  return payloadHint
    ? `${event.topic} ${payloadHint}`
    : `${event.topic}`;
}

function filterRowsByKind(rows: EventConsoleRow[], eventFilter: EventFilter): EventConsoleRow[] {
  if (eventFilter === 'detections') {
    return rows.filter((row) => row.kind === 'detection');
  }
  if (eventFilter === 'activity') {
    return rows.filter((row) => row.kind === 'activity');
  }
  return rows;
}

function resolveStreamType(meta: Record<string, unknown> | undefined): 'rawfeed' | 'spectrum' | 'unknown' {
  const normalize = (value: unknown): string =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const rawCandidates = [
    meta?.sourceType,
    meta?.wsPath,
    meta?.wsEndpoint,
    meta?.mqttTopic,
    meta?.displayName,
    meta?.type,
  ];

  const hasRawfeed = rawCandidates.some((value) => {
    const normalized = normalize(value);
    return normalized.includes('rawfeed');
  });
  if (hasRawfeed) {
    return 'rawfeed';
  }

  const hasSpectrum = rawCandidates.some((value) => {
    const normalized = normalize(value);
    return normalized.includes('spectrum');
  });
  if (hasSpectrum) {
    return 'spectrum';
  }

  const wsPath = String(meta?.wsPath || '').toLowerCase();
  if (wsPath.endsWith('/rawfeed')) {
    return 'rawfeed';
  }
  if (wsPath.endsWith('/spectrum')) {
    return 'spectrum';
  }

  return 'unknown';
}

const SpectrumLab: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [selectedRadios, setSelectedRadios] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [markers, setMarkers] = useState<SpectrumMarker[]>([]);
  const [horizontalMarkers, setHorizontalMarkers] = useState<SpectrumHorizontalMarker[]>([]);
  const [horizontalMarkerInput, setHorizontalMarkerInput] = useState('');
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>(ALL_EVENT_TYPES);
  const [isClearingEvents, setIsClearingEvents] = useState(false);
  const [layerOpacities, setLayerOpacities] = useState<Record<string, number>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [fps, setFps] = useState<number>(() => {
    const saved = localStorage.getItem(FPS_STORAGE_KEY);
    return saved ? parseInt(saved, 10) : 20;
  });

  // Manual frequency override state
  const [useManualFreq, setUseManualFreq] = useState(false);
  const [manualCenterMHz, setManualCenterMHz] = useState(100);
  const [manualSpanMHz, setManualSpanMHz] = useState(20);

  // Fetch datasources from API
  const { data: rawDatasources, isLoading, error, refetch, isRefetching } = useStreamableDatasources();

  // Poll detection/native events for console view
  const {
    data: eventsPayload,
    isRefetching: isEventsRefetching,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['events', 'spectrum-lab'],
    queryFn: () => http.get<EventsPayload>('/api/events'),
    refetchInterval: isStreaming ? 2000 : 5000,
    staleTime: 1000,
    retry: 2,
  });

  const rawEventRows = useMemo(() => {
    const detectionRows: EventConsoleRow[] = (eventsPayload?.detections || []).map((event) => ({
      id: `d:${event.eventId}`,
      kind: 'detection',
      eventType: event.type || 'unknown_detection',
      ts: event.detectedAt,
      epochMs: toEpoch(event.detectedAt),
      summary: formatDetectionSummary(event),
    }));

    const activityRows: EventConsoleRow[] = (eventsPayload?.nativeActivity || []).map((event, idx) => ({
      id: `a:${event.ts}:${event.topic}:${idx}`,
      kind: 'activity',
      eventType: event.topic || 'unknown_activity',
      ts: event.ts,
      epochMs: toEpoch(event.ts),
      summary: formatActivitySummary(event),
    }));

    return [...detectionRows, ...activityRows]
      .sort((a, b) => b.epochMs - a.epochMs)
      .slice(0, EVENT_ROWS_LIMIT);
  }, [eventsPayload]);

  const eventTypeOptions = useMemo(() => {
    const visibleByKind = filterRowsByKind(rawEventRows, eventFilter);
    return Array.from(new Set(visibleByKind.map((row) => row.eventType))).sort((a, b) => a.localeCompare(b));
  }, [rawEventRows, eventFilter]);

  useEffect(() => {
    if (eventTypeFilter !== ALL_EVENT_TYPES && !eventTypeOptions.includes(eventTypeFilter)) {
      setEventTypeFilter(ALL_EVENT_TYPES);
    }
  }, [eventTypeFilter, eventTypeOptions]);

  const eventRows = useMemo(() => {
    const visibleByKind = filterRowsByKind(rawEventRows, eventFilter);
    if (eventTypeFilter === ALL_EVENT_TYPES) {
      return visibleByKind;
    }
    return visibleByKind.filter((row) => row.eventType === eventTypeFilter);
  }, [rawEventRows, eventFilter, eventTypeFilter]);

  const detectionCount = eventsPayload?.detections?.length ?? 0;
  const nativeActivityCount = eventsPayload?.nativeActivity?.length ?? 0;

  // Transform to frontend format
  const dataSources = useMemo(() => {
    if (!rawDatasources) return [];
    return groupDataSourcesByHost(rawDatasources);
  }, [rawDatasources]);

  // Flatten radios for selection list
  const allRadios = useMemo((): RadioItem[] => {
    const items: RadioItem[] = [];

    for (const source of dataSources) {
      for (const radio of source.radios) {
        const state = String(radio.meta?.state || 'UNKNOWN');
        const radioKey = `${source.id}:${radio.id}`;
        const capabilities = radio.meta?.capabilities as Record<string, unknown> | undefined;

        items.push({
          sourceId: source.id,
          radioId: radio.id,
          radioKey,
          name: radio.name,
          type: String(radio.meta?.type || 'Unknown'),
          sourceType: resolveStreamType(radio.meta as Record<string, unknown> | undefined),
          state,
          disabled: isDisabledState(state),
          centerHz: typeof capabilities?.cf === 'number' ? capabilities.cf : undefined,
        });
      }
    }

    return items;
  }, [dataSources]);

  // Filter radios by search
  const filteredRadios = useMemo(() => {
    if (!searchQuery) return allRadios;
    const query = searchQuery.toLowerCase();
    return allRadios.filter(r =>
      r.name.toLowerCase().includes(query) ||
      r.type.toLowerCase().includes(query) ||
      r.sourceType.toLowerCase().includes(query) ||
      r.radioId.toLowerCase().includes(query)
    );
  }, [allRadios, searchQuery]);

  // Spectrum WebSocket hook with configurable FPS
  const { spectrumData, subscribe, unsubscribe, pause, resume, isPaused, isConnected } = useSpectrumWS({ fps });

  // Handle FPS change
  const handleFpsChange = useCallback((value: string) => {
    const newFps = parseInt(value, 10);
    setFps(newFps);
    localStorage.setItem(FPS_STORAGE_KEY, value);
  }, []);

  // Initialize from URL params
  useEffect(() => {
    const initialRadios = searchParams.get('radios')?.split(',') || [];
    if (initialRadios.length > 0) {
      setSelectedRadios(initialRadios);
    }
  }, [searchParams]);

  // Start streaming
  const handleStartStreaming = useCallback(() => {
    if (selectedRadios.length > 0 && dataSources.length > 0) {
      subscribe(dataSources, selectedRadios);
      setIsStreaming(true);
    }
  }, [selectedRadios, dataSources, subscribe]);

  // Stop streaming
  const handleStopStreaming = useCallback(() => {
    unsubscribe();
    setIsStreaming(false);
  }, [unsubscribe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => unsubscribe();
  }, [unsubscribe]);

  const toggleRadio = useCallback((radioKey: string) => {
    setSelectedRadios(prev =>
      prev.includes(radioKey)
        ? prev.filter(r => r !== radioKey)
        : [...prev, radioKey]
    );
  }, []);

  const selectedRawfeedKeys = useMemo(
    () =>
      selectedRadios.filter((radioKey) => {
        const radio = allRadios.find((r) => r.radioKey === radioKey);
        return radio?.sourceType === 'rawfeed';
      }),
    [selectedRadios, allRadios]
  );

  const selectedSpectrumKeys = useMemo(
    () =>
      selectedRadios.filter((radioKey) => {
        const radio = allRadios.find((r) => r.radioKey === radioKey);
        return radio?.sourceType !== 'rawfeed';
      }),
    [selectedRadios, allRadios]
  );

  // Prepare spectrum chart data (line graph) from spectrum-type feeds.
  const spectrumChartData = useMemo(() => {
    return selectedSpectrumKeys
      .map((key) => spectrumData[key])
      .filter(Boolean)
      .map((item) => {
        const frame = item.frame;
        if (useManualFreq) {
          return {
            ...frame,
            centerHz: manualCenterMHz * 1e6,
            spanHz: manualSpanMHz * 1e6,
            binHz: (manualSpanMHz * 1e6) / frame.binsDbm.length,
          };
        }
        return frame;
      });
  }, [selectedSpectrumKeys, spectrumData, useManualFreq, manualCenterMHz, manualSpanMHz]);

  const rawfeedWaterfalls = useMemo(() => {
    return selectedRawfeedKeys
      .map((key) => {
        const item = spectrumData[key];
        if (!item) {
          return null;
        }

        const radio = allRadios.find((r) => r.radioKey === key);
        const frame = item.frame;
        let resolvedFrame: SpectrumFrame = frame;
        if (useManualFreq) {
          resolvedFrame = {
            ...frame,
            centerHz: manualCenterMHz * 1e6,
            spanHz: manualSpanMHz * 1e6,
            binHz: (manualSpanMHz * 1e6) / frame.binsDbm.length,
          };
        }

        return {
          key,
          name: radio?.name || key,
          frame: resolvedFrame,
        };
      })
      .filter((item): item is { key: string; name: string; frame: SpectrumFrame } => item !== null);
  }, [selectedRawfeedKeys, spectrumData, allRadios, useManualFreq, manualCenterMHz, manualSpanMHz]);

  const opacities = useMemo(() =>
    selectedSpectrumKeys.map((key) => layerOpacities[key] ?? 0.8),
    [selectedSpectrumKeys, layerOpacities]
  );

  const handleMarkerAdd = useCallback((hz: number) => {
    const frequency = Math.round(hz);
    setMarkers(prev => [
      {
        id: `m-${Date.now()}-${prev.length}`,
        frequencyHz: frequency,
        label: `${(frequency / 1e6).toFixed(3)} MHz`,
      },
      ...prev,
    ].slice(0, 50));
  }, []);

  const handleHorizontalMarkerAdd = useCallback((dbValue: number) => {
    const rounded = Math.round(dbValue * 10) / 10;
    setHorizontalMarkers(prev => [
      {
        id: `hm-${Date.now()}-${prev.length}`,
        dbValue: rounded,
        label: `${rounded.toFixed(1)} dB`,
      },
      ...prev,
    ].slice(0, 50));
  }, []);

  const handleAddHorizontalFromInput = useCallback(() => {
    if (!horizontalMarkerInput.trim()) return;
    const parsed = Number(horizontalMarkerInput);
    if (!Number.isFinite(parsed)) return;
    handleHorizontalMarkerAdd(parsed);
    setHorizontalMarkerInput('');
  }, [horizontalMarkerInput, handleHorizontalMarkerAdd]);

  const clearAllMarkers = useCallback(() => {
    setMarkers([]);
    setHorizontalMarkers([]);
  }, []);

  const handleClearConsole = useCallback(async () => {
    if (isClearingEvents) {
      return;
    }

    setIsClearingEvents(true);
    try {
      await http.delete('/api/events');
      await refetchEvents();
    } catch (err) {
      console.error('Failed to clear event console', err);
    } finally {
      setIsClearingEvents(false);
    }
  }, [isClearingEvents, refetchEvents]);

  const hasSpectrumSelection = selectedSpectrumKeys.length > 0;
  const hasRawfeedSelection = selectedRawfeedKeys.length > 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex gap-4 items-start">
        <Card className="w-64 shrink-0">
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-20" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
        <div className="flex-1">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Card className="p-8 text-center">
          <WifiOff className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h3 className="font-medium mb-2">Failed to Load Data Sources</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {error instanceof Error ? error.message : 'Unable to connect to the backend API'}
          </p>
          <Button onClick={() => refetch()} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex gap-4 items-start">
      {/* Device Selection Panel */}
      <Card className="w-64 shrink-0 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Data Sources</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 flex flex-col">
          <div className="px-4 pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search radios..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1 px-4">
            {filteredRadios.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No radios found
              </p>
            ) : (
              filteredRadios.map(radio => (
                <div
                  key={radio.radioKey}
                  className={`flex items-center gap-2 py-2 border-b border-border last:border-0 ${
                    radio.disabled ? 'opacity-50' : ''
                  }`}
                >
                  <Checkbox
                    checked={selectedRadios.includes(radio.radioKey)}
                    onCheckedChange={() => !radio.disabled && toggleRadio(radio.radioKey)}
                    disabled={radio.disabled}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{radio.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{radio.type}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">
                        {radio.sourceType}
                      </Badge>
                      <Badge
                        variant={radio.disabled ? 'secondary' : 'outline'}
                        className="text-[9px] px-1 py-0"
                      >
                        {radio.state}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Controls */}
        <Card>
          <CardContent className="pt-4 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Start/Stop Button */}
              {!isStreaming ? (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleStartStreaming}
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
                  onClick={handleStopStreaming}
                  className="gap-2"
                >
                  <Pause className="h-4 w-4" />
                  Stop
                </Button>
              )}

              {/* Pause/Resume (only when streaming) */}
              {isStreaming && (
                <Button
                  variant={isPaused ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => isPaused ? resume() : pause()}
                >
                  {isPaused ? 'Resume' : 'Pause'}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={clearAllMarkers}
                disabled={markers.length === 0 && horizontalMarkers.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear Markers (V:{markers.length} / H:{horizontalMarkers.length})
              </Button>

              {/* FPS Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">FPS:</span>
                <Select value={String(fps)} onValueChange={handleFpsChange}>
                  <SelectTrigger className="h-8 w-16">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FPS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={String(opt)}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Manual Frequency Override */}
              <div className="flex items-center gap-2 border-l pl-3">
                <div className="flex items-center gap-1.5">
                  <Switch
                    id="manual-freq"
                    checked={useManualFreq}
                    onCheckedChange={setUseManualFreq}
                  />
                  <Label htmlFor="manual-freq" className="text-xs text-muted-foreground">
                    <Settings2 className="h-3 w-3 inline mr-1" />
                    Manual
                  </Label>
                </div>
                {useManualFreq && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">CF:</span>
                      <Input
                        type="number"
                        value={manualCenterMHz}
                        onChange={(e) => setManualCenterMHz(parseFloat(e.target.value) || 100)}
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">MHz</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">Span:</span>
                      <Input
                        type="number"
                        value={manualSpanMHz}
                        onChange={(e) => setManualSpanMHz(parseFloat(e.target.value) || 20)}
                        className="h-7 w-20 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">MHz</span>
                    </div>
                  </>
                )}
              </div>

              {/* Horizontal marker controls */}
              {hasSpectrumSelection && (
                <div className="flex items-center gap-2 border-l pl-3">
                  <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.1"
                    value={horizontalMarkerInput}
                    onChange={(e) => setHorizontalMarkerInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddHorizontalFromInput();
                      }
                    }}
                    placeholder="dB"
                    className="h-7 w-20 text-xs"
                  />
                  <Button variant="outline" size="sm" onClick={handleAddHorizontalFromInput}>
                    Add dB Line
                  </Button>
                </div>
              )}
            </div>
            <Badge
              variant={isStreaming && isConnected ? 'default' : 'secondary'}
              className={isStreaming && isConnected ? 'bg-success/10 text-success border-success/30' : ''}
            >
              {isStreaming && isConnected ? (
                <>
                  <Wifi className="h-3 w-3 mr-1" />
                  <span className="w-1.5 h-1.5 rounded-full bg-success mr-1.5 animate-pulse" />
                  Live
                </>
              ) : isStreaming ? (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  Connecting...
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 mr-1" />
                  Stopped
                </>
              )}
            </Badge>
          </CardContent>
        </Card>

        {/* Spectrum / Rawfeed Visualization */}
        <Card className="min-h-[520px]">
          <CardContent className="pt-4 flex flex-col gap-4">
            {selectedRadios.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                Select radios to view live data
              </div>
            ) : (
              <>
                {hasSpectrumSelection && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                      Spectrum Feeds
                    </p>
                    {spectrumChartData.length === 0 ? (
                      <div className="min-h-[220px] flex items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground text-sm">
                        {!isStreaming ? 'Click Start to begin streaming' : 'Waiting for spectrum data...'}
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Click to add vertical frequency marker. Shift+click to add horizontal dB marker.
                        </p>
                        <SpectrumChart
                          data={spectrumChartData}
                          markers={markers}
                          horizontalMarkers={horizontalMarkers}
                          onMarkerAdd={handleMarkerAdd}
                          onHorizontalMarkerAdd={handleHorizontalMarkerAdd}
                          width={900}
                          height={370}
                          opacities={opacities}
                        />
                      </>
                    )}

                    {/* Layer controls */}
                    {selectedSpectrumKeys.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {selectedSpectrumKeys.map((radioKey, idx) => {
                          const radio = allRadios.find((r) => r.radioKey === radioKey);
                          const colors = ['hsl(217,91%,60%)', 'hsl(187,96%,42%)', 'hsl(160,84%,39%)', 'hsl(38,92%,50%)'];

                          return (
                            <div key={radioKey} className="flex items-center gap-4">
                              <div
                                className="w-3 h-3 rounded"
                                style={{ backgroundColor: colors[idx % colors.length] }}
                              />
                              <span className="text-sm w-32 truncate">{radio?.name || radioKey}</span>
                              <Slider
                                value={[(layerOpacities[radioKey] ?? 0.8) * 100]}
                                onValueChange={([v]) => setLayerOpacities((prev) => ({ ...prev, [radioKey]: v / 100 }))}
                                max={100}
                                className="w-32"
                              />
                              <span className="text-xs text-muted-foreground w-8">
                                {Math.round((layerOpacities[radioKey] ?? 0.8) * 100)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {hasRawfeedSelection && (
                  <div className={hasSpectrumSelection ? 'pt-4 border-t border-border/40' : ''}>
                    <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                      Rawfeed Waterfall
                    </p>
                    {rawfeedWaterfalls.length === 0 ? (
                      <div className="min-h-[220px] flex items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground text-sm">
                        {!isStreaming ? 'Click Start to begin streaming' : 'Waiting for raw IQ frames...'}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {rawfeedWaterfalls.map((waterfall) => (
                          <div key={waterfall.key} className="space-y-1">
                            <p className="text-xs text-muted-foreground">{waterfall.name}</p>
                            <WaterfallChart
                              frame={waterfall.frame}
                              width={900}
                              height={300}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!hasSpectrumSelection && !hasRawfeedSelection && (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    Selected radios are not stream-capable
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Event Console */}
        <Card className="h-72">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <TerminalSquare className="h-4 w-4" />
                Event Console
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Detections: {detectionCount}</Badge>
                <Badge variant="outline">Native: {nativeActivityCount}</Badge>
                <Select value={eventFilter} onValueChange={(v) => setEventFilter(v as EventFilter)}>
                  <SelectTrigger className="h-8 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="detections">Detections</SelectItem>
                    <SelectItem value="activity">Native Activity</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
                  <SelectTrigger className="h-8 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_EVENT_TYPES}>All Types</SelectItem>
                    {eventTypeOptions.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={handleClearConsole}
                  disabled={isClearingEvents || detectionCount + nativeActivityCount === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isClearingEvents ? 'Clearing...' : 'Clear'}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => refetchEvents()}
                  disabled={isEventsRefetching || isClearingEvents}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isEventsRefetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 h-[calc(100%-3.25rem)]">
            <ScrollArea className="h-full rounded-md border bg-muted/20 p-2">
              {eventRows.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No events yet
                </p>
              ) : (
                <div className="space-y-1 font-mono text-xs">
                  {eventRows.map((row) => (
                    <div
                      key={row.id}
                      className={`rounded px-2 py-1 ${
                        row.kind === 'detection'
                          ? 'bg-destructive/10 border border-destructive/25'
                          : 'bg-primary/10 border border-primary/20'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground shrink-0">
                          {new Date(row.epochMs || Date.now()).toLocaleTimeString()}
                        </span>
                        <span
                          className={`shrink-0 font-semibold uppercase tracking-wide ${
                            row.kind === 'detection' ? 'text-destructive' : 'text-primary'
                          }`}
                        >
                          {row.kind === 'detection' ? 'DETECT' : 'NATIVE'}
                        </span>
                        <span className="text-foreground/90 break-all">{row.summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SpectrumLab;
