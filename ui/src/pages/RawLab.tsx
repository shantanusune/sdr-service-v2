import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, FileAudio, BarChart3, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/api/client';
import type { AnalysisResult, Capture, Device } from '@/models/types';

const DURATION_OPTIONS = [5, 10, 20, 30, 45, 60] as const;

const ANALYSIS_OPTIONS = [
  { key: 'energy_profile', label: 'Energy Profile', hint: 'Power/RMS envelope and baseline statistics' },
  { key: 'burst_activity', label: 'Burst Activity', hint: 'Burst ratio and threshold crossings' },
  { key: 'frequency_hopping', label: 'Frequency Hopping', hint: 'Hop count, max hop, hop rate/minute' },
  { key: 'bandwidth_occupancy', label: 'Bandwidth Occupancy', hint: 'Mean/p90 occupied bandwidth estimates' },
  { key: 'protocol_hints', label: 'Protocol Hints', hint: 'Control/video/FHSS heuristic label' },
] as const;

function formatBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN) || (bytes ?? 0) <= 0) {
    return '--';
  }
  const value = bytes as number;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusVariant(status: Capture['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'complete') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'capturing') return 'outline';
  return 'secondary';
}

function formatMetricValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value == null) {
    return '--';
  }
  return String(value);
}

const RawLab: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [duration, setDuration] = useState(5);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedAnalyses, setSelectedAnalyses] = useState<string[]>(ANALYSIS_OPTIONS.map(o => o.key));
  const [analysisResultByCapture, setAnalysisResultByCapture] = useState<Record<string, AnalysisResult>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingCapture, setIsStartingCapture] = useState(false);
  const [analysisRunningFor, setAnalysisRunningFor] = useState<string | null>(null);
  const { toast } = useToast();

  const onlineDevices = useMemo(() => devices.filter((dev) => dev.online), [devices]);

  const selectedCapture = useMemo(
    () => captures.find((c) => c.captureId === selectedCaptureId) ?? null,
    [captures, selectedCaptureId]
  );

  const effectiveAnalysis = selectedCapture
    ? selectedCapture.analysis || analysisResultByCapture[selectedCapture.captureId]
    : undefined;

  const refreshCaptures = useCallback(async () => {
    const latest = await apiClient.getCaptures();
    setCaptures(latest);
    if (latest.length > 0 && !selectedCaptureId) {
      setSelectedCaptureId(latest[0].captureId);
    }
    if (selectedCaptureId && !latest.some((c) => c.captureId === selectedCaptureId)) {
      setSelectedCaptureId(latest[0]?.captureId ?? null);
    }
  }, [selectedCaptureId]);

  const refreshDevices = useCallback(async () => {
    const d = await apiClient.getDevices();
    setDevices(d);
    if (!selectedDevice) {
      const firstOnline = d.find((dev) => dev.online);
      if (firstOnline) {
        setSelectedDevice(firstOnline.deviceId);
      }
    }
  }, [selectedDevice]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await Promise.all([refreshDevices(), refreshCaptures()]);
      } catch (e) {
        if (!cancelled) {
          toast({ title: 'Failed to load Raw Lab', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    load();

    const id = window.setInterval(() => {
      refreshCaptures().catch(() => undefined);
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshCaptures, refreshDevices, toast]);

  const handleStartCapture = async () => {
    if (!selectedDevice) return;
    setIsStartingCapture(true);
    try {
      const capture = await apiClient.createCapture({ deviceId: selectedDevice, seconds: duration });
      setCaptures(prev => [capture, ...prev]);
      setSelectedCaptureId(capture.captureId);
      toast({ title: 'Capture started', description: `Recording up to ${duration}s from ${selectedDevice}` });
    } catch (e) {
      toast({ title: 'Capture start failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsStartingCapture(false);
    }
  };

  const handleRunAnalysis = async (captureId: string) => {
    setAnalysisRunningFor(captureId);
    try {
      const job = await apiClient.createAnalysisJob(captureId, selectedAnalyses);
      if (job.result) {
        setAnalysisResultByCapture((prev) => ({ ...prev, [captureId]: job.result! }));
      }
      await refreshCaptures();
      toast({ title: 'Analysis completed', description: `${captureId} processed with ${selectedAnalyses.length} analyses` });
    } catch (e) {
      toast({ title: 'Analysis failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setAnalysisRunningFor(null);
    }
  };

  const toggleAnalysis = (key: string, checked: boolean) => {
    setSelectedAnalyses((prev) => {
      if (checked) {
        if (prev.includes(key)) return prev;
        return [...prev, key];
      }
      const next = prev.filter((v) => v !== key);
      return next.length === 0 ? prev : next;
    });
  };

  const analysisMetricEntries = useMemo(() => {
    if (!effectiveAnalysis) return [];
    const sections: Array<{ section: string; data: Record<string, unknown> }> = [];
    if (effectiveAnalysis.energyProfile) sections.push({ section: 'Energy', data: effectiveAnalysis.energyProfile });
    if (effectiveAnalysis.burstActivity) sections.push({ section: 'Burst', data: effectiveAnalysis.burstActivity });
    if (effectiveAnalysis.frequencyHopping) sections.push({ section: 'Hopping', data: effectiveAnalysis.frequencyHopping });
    if (effectiveAnalysis.bandwidthOccupancy) sections.push({ section: 'Occupancy', data: effectiveAnalysis.bandwidthOccupancy });
    return sections;
  }, [effectiveAnalysis]);

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileAudio className="h-4 w-4" />
            Capture Raw IQ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Device</label>
            <Select value={selectedDevice} onValueChange={setSelectedDevice}>
              <SelectTrigger>
                <SelectValue placeholder="Select device" />
              </SelectTrigger>
              <SelectContent>
                {onlineDevices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.deviceId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Duration</label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((sec) => (
                  <SelectItem key={sec} value={String(sec)}>
                    {sec} seconds
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">Maximum supported capture is 60 seconds.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Analyze Options</p>
            {ANALYSIS_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={selectedAnalyses.includes(opt.key)}
                  onCheckedChange={(checked) => toggleAnalysis(opt.key, checked === true)}
                />
                <span>
                  <span className="block">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <Button className="w-full" onClick={handleStartCapture} disabled={!selectedDevice || isStartingCapture || isLoading}>
            <Play className="h-4 w-4 mr-2" />
            {isStartingCapture ? 'Starting...' : 'Start Capture'}
          </Button>
        </CardContent>
      </Card>

      <Card className="col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Captures</CardTitle>
            <Button size="sm" variant="outline" onClick={() => refreshCaptures()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Frames</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {captures.map((c) => (
                <TableRow
                  key={c.captureId}
                  className="cursor-pointer"
                  onClick={() => setSelectedCaptureId(c.captureId)}
                >
                  <TableCell className="font-mono text-xs">{c.captureId}</TableCell>
                  <TableCell>{c.deviceId}</TableCell>
                  <TableCell>{c.duration}s</TableCell>
                  <TableCell>{c.frameCount ?? '--'}</TableCell>
                  <TableCell>{formatBytes(c.fileSize)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c.status)}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRunAnalysis(c.captureId);
                      }}
                      disabled={analysisRunningFor === c.captureId || c.status !== 'complete'}
                    >
                      <BarChart3 className="h-4 w-4 mr-1" />
                      {analysisRunningFor === c.captureId ? 'Analyzing...' : 'Analyze'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="col-span-3">
        <CardHeader>
          <CardTitle className="text-sm">Capture Viewer</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedCapture ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline">{selectedCapture.captureId}</Badge>
                <Badge variant="outline">{selectedCapture.deviceId}</Badge>
                <Badge variant="outline">{selectedCapture.duration}s</Badge>
                <Badge variant="outline">Frames: {selectedCapture.frameCount ?? '--'}</Badge>
                <Badge variant="outline">Size: {formatBytes(selectedCapture.fileSize)}</Badge>
              </div>

              {effectiveAnalysis ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Analysis Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Drone Link Score</span>
                        <span className="font-mono">{effectiveAnalysis.droneScore.toFixed(1)} / 100</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Dominant Label</span>
                        <span className="font-mono">{effectiveAnalysis.dominantLabel || '--'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sampled Frames</span>
                        <span className="font-mono">{effectiveAnalysis.sampledFrames ?? '--'}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {analysisMetricEntries.map(({ section, data }) => (
                    <Card key={section}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">{section}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-sm">
                        {Object.entries(data).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-muted-foreground">{key}</span>
                            <span className="font-mono">{formatMetricValue(value)}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ))}

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Detected Bands</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {(effectiveAnalysis.detectedBands || []).length === 0 ? (
                        <p className="text-muted-foreground">No dominant bands found.</p>
                      ) : (
                        effectiveAnalysis.detectedBands.map((band, idx) => (
                          <div key={`${band.startHz}-${band.endHz}-${idx}`} className="flex justify-between">
                            <span className="text-muted-foreground">
                              {(band.startHz / 1e6).toFixed(3)} - {(band.endHz / 1e6).toFixed(3)} MHz
                            </span>
                            <span className="font-mono">{(band.confidence * 100).toFixed(1)}% {band.label}</span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="h-40 bg-muted/30 rounded-lg flex items-center justify-center text-muted-foreground">
                  Run analysis to see IQ-derived metrics and protocol hints.
                </div>
              )}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              Select a capture to view details
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RawLab;
