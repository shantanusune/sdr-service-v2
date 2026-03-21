import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Pause, Trash2, Search, RefreshCw, Wifi, WifiOff, Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { SpectrumChart } from '@/components/charts/SpectrumChart';
import { useSpectrumWS } from '@/realtime/useSpectrumWS';
import { useStreamableDatasources } from '@/hooks/useDatasources';
import { groupDataSourcesByHost } from '@/config/dataSources';
import { isDisabledState } from '@/types/api';
import type { SpectrumMarker } from '@/models/types';
import type { DataSource } from '@/types/sources';

interface RadioItem {
  sourceId: string;
  radioId: string;
  radioKey: string;
  name: string;
  type: string;
  state: string;
  disabled: boolean;
  centerHz?: number;
}

const FPS_OPTIONS = [5, 10, 20, 30] as const;
const FPS_STORAGE_KEY = 'sdr.spectrumLab.fps';

const SpectrumLab: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [selectedRadios, setSelectedRadios] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [markers, setMarkers] = useState<SpectrumMarker[]>([]);
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

  // Prepare chart data from spectrum cache with optional frequency override
  const chartData = useMemo(() => {
    return selectedRadios
      .map(key => spectrumData[key])
      .filter(Boolean)
      .map(item => {
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
  }, [selectedRadios, spectrumData, useManualFreq, manualCenterMHz, manualSpanMHz]);

  const opacities = useMemo(() => 
    selectedRadios.map(key => layerOpacities[key] ?? 0.8), 
    [selectedRadios, layerOpacities]
  );

  const handleMarkerAdd = useCallback((hz: number) => {
    setMarkers(prev => [...prev, { id: `m-${Date.now()}`, frequencyHz: hz }]);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex gap-4 h-[calc(100vh-12rem)]">
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
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
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
    <div className="flex gap-4 h-[calc(100vh-12rem)]">
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
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
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
                onClick={() => setMarkers([])}
                disabled={markers.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear Markers ({markers.length})
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
              <div className="flex items-center gap-2 border-l pl-4 ml-2">
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

        {/* Spectrum Chart */}
        <Card className="flex-1">
          <CardContent className="pt-4 h-full flex flex-col">
            {chartData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                {selectedRadios.length === 0 
                  ? 'Select radios to view spectrum'
                  : !isStreaming 
                    ? 'Click Start to begin streaming'
                    : 'Waiting for spectrum data...'}
              </div>
            ) : (
              <SpectrumChart 
                data={chartData} 
                markers={markers} 
                onMarkerAdd={handleMarkerAdd} 
                width={900} 
                height={400} 
                opacities={opacities} 
              />
            )}
            
            {/* Layer controls */}
            {selectedRadios.length > 0 && (
              <div className="mt-4 space-y-2">
                {selectedRadios.map((radioKey, idx) => {
                  const radio = allRadios.find(r => r.radioKey === radioKey);
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
                        onValueChange={([v]) => setLayerOpacities(prev => ({ ...prev, [radioKey]: v / 100 }))} 
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SpectrumLab;
