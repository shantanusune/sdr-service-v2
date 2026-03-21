import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, FileAudio, BarChart3, RefreshCw, BrainCircuit, Tag, UploadCloud } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/api/client';
import type {
  AnalysisResult,
  Capture,
  Device,
  RfmlModel,
  RfmlSample,
  RfmlTrainResult,
} from '@/models/types';

const DURATION_OPTIONS = [5, 10, 20, 30, 45, 60] as const;
const RFML_LABELS = [
  'wifi_control_link',
  'digital_video_link',
  'fhss_control_suspected',
  'drone_iq_activity',
  'rf_band_activity',
] as const;

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

function formatTs(ts?: number): string {
  if (!ts || ts <= 0) return '--';
  return new Date(ts).toLocaleString();
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
  const [rfmlSamples, setRfmlSamples] = useState<RfmlSample[]>([]);
  const [rfmlModels, setRfmlModels] = useState<RfmlModel[]>([]);

  const [selectedDevice, setSelectedDevice] = useState('');
  const [duration, setDuration] = useState(5);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [selectedAnalyses, setSelectedAnalyses] = useState<string[]>(ANALYSIS_OPTIONS.map(o => o.key));
  const [analysisResultByCapture, setAnalysisResultByCapture] = useState<Record<string, AnalysisResult>>({});

  const [labelValue, setLabelValue] = useState<string>(RFML_LABELS[0]);
  const [labelNotes, setLabelNotes] = useState('');
  const [trainEpochs, setTrainEpochs] = useState(300);
  const [trainLearningRate, setTrainLearningRate] = useState(0.12);
  const [trainL2, setTrainL2] = useState(0.0001);
  const [trainResult, setTrainResult] = useState<RfmlTrainResult | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isStartingCapture, setIsStartingCapture] = useState(false);
  const [analysisRunningFor, setAnalysisRunningFor] = useState<string | null>(null);
  const [isSavingLabel, setIsSavingLabel] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [loadingModelPath, setLoadingModelPath] = useState<string | null>(null);

  const { toast } = useToast();

  const onlineDevices = useMemo(() => devices.filter((dev) => dev.online), [devices]);

  const selectedCapture = useMemo(
    () => captures.find((c) => c.captureId === selectedCaptureId) ?? null,
    [captures, selectedCaptureId],
  );

  const selectedRfmlSample = useMemo(
    () => rfmlSamples.find((s) => s.captureId === selectedCaptureId) ?? null,
    [rfmlSamples, selectedCaptureId],
  );

  useEffect(() => {
    if (!selectedRfmlSample) return;
    setLabelValue((selectedRfmlSample.label || selectedRfmlSample.dominantLabel || RFML_LABELS[0]) as string);
    setLabelNotes(selectedRfmlSample.notes || '');
  }, [selectedRfmlSample?.captureId, selectedRfmlSample?.updatedAt]);

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

  const refreshRfml = useCallback(async () => {
    const [samples, models] = await Promise.all([
      apiClient.getRfmlSamples(),
      apiClient.getRfmlModels(),
    ]);
    setRfmlSamples(samples);
    setRfmlModels(models);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await Promise.all([refreshDevices(), refreshCaptures(), refreshRfml()]);
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
      Promise.all([refreshCaptures(), refreshRfml()]).catch(() => undefined);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshCaptures, refreshDevices, refreshRfml, toast]);

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
      await Promise.all([refreshCaptures(), refreshRfml()]);
      toast({ title: 'Analysis completed', description: `${captureId} processed with ${selectedAnalyses.length} analyses` });
    } catch (e) {
      toast({ title: 'Analysis failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setAnalysisRunningFor(null);
    }
  };

  const handleSaveLabel = async () => {
    if (!selectedCaptureId) return;
    setIsSavingLabel(true);
    try {
      const result = await apiClient.labelRfmlSample(selectedCaptureId, labelValue, labelNotes);
      if (result.status !== 'ok') {
        throw new Error(result.error || 'label save failed');
      }
      await refreshRfml();
      toast({ title: 'Label saved', description: `${selectedCaptureId} annotated as ${labelValue}` });
    } catch (e) {
      toast({ title: 'Label save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsSavingLabel(false);
    }
  };

  const handleTrainModel = async () => {
    setIsTraining(true);
    try {
      const result = await apiClient.trainRfmlModel({
        epochs: trainEpochs,
        learningRate: trainLearningRate,
        l2: trainL2,
        autoLoad: true,
      });
      setTrainResult(result);
      await refreshRfml();
      if (result.status === 'ok') {
        toast({
          title: 'RFML model trained',
          description: `${result.modelVersion || 'model'} trained with ${result.trainSamples ?? 0} samples`,
        });
      } else {
        toast({
          title: 'RFML training failed',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (e) {
      toast({ title: 'RFML training failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsTraining(false);
    }
  };

  const handleLoadModel = async (modelPath: string) => {
    setLoadingModelPath(modelPath);
    try {
      const result = await apiClient.loadRfmlModel(modelPath);
      if (result.status !== 'ok') {
        throw new Error(result.error || 'failed to load model');
      }
      toast({ title: 'Model loaded', description: modelPath });
    } catch (e) {
      toast({ title: 'Model load failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setLoadingModelPath(null);
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

  const rfmlStats = useMemo(() => {
    const total = rfmlSamples.length;
    const labeled = rfmlSamples.filter((s) => !!s.label).length;
    const counts: Record<string, number> = {};
    RFML_LABELS.forEach((label) => {
      counts[label] = rfmlSamples.filter((s) => s.label === label).length;
    });
    return { total, labeled, counts };
  }, [rfmlSamples]);

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
            <Button size="sm" variant="outline" onClick={() => Promise.all([refreshCaptures(), refreshRfml()])} className="gap-1.5">
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
                <TableHead>Label</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {captures.map((c) => {
                const sample = rfmlSamples.find((s) => s.captureId === c.captureId);
                return (
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
                      {sample?.label ? (
                        <Badge variant="outline" className="font-mono text-[11px]">{sample.label}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
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
                );
              })}
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

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    RFML Annotation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-2 block">Label</label>
                      <Select value={labelValue} onValueChange={setLabelValue}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RFML_LABELS.map((label) => (
                            <SelectItem key={label} value={label}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-2 block">Detected Hint</label>
                      <div className="h-10 rounded-md border px-3 flex items-center text-sm font-mono">
                        {selectedRfmlSample?.dominantLabel || effectiveAnalysis?.dominantLabel || '--'}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-2 block">Notes</label>
                    <Textarea
                      value={labelNotes}
                      onChange={(e) => setLabelNotes(e.target.value)}
                      rows={2}
                      placeholder="Context, environment, expected emitter..."
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Last updated: {selectedRfmlSample?.updatedAt ? formatTs(selectedRfmlSample.updatedAt) : '--'}
                    </p>
                    <Button onClick={handleSaveLabel} disabled={isSavingLabel || !selectedCaptureId || selectedCapture.status !== 'complete'}>
                      {isSavingLabel ? 'Saving...' : 'Save Label'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

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

      <Card className="col-span-3">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <BrainCircuit className="h-4 w-4" />
            RFML Prototype Training
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Dataset</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Samples</span>
                  <span className="font-mono">{rfmlStats.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labeled Samples</span>
                  <span className="font-mono">{rfmlStats.labeled}</span>
                </div>
                {RFML_LABELS.map((label) => (
                  <div className="flex justify-between" key={label}>
                    <span className="text-muted-foreground font-mono text-xs">{label}</span>
                    <span className="font-mono">{rfmlStats.counts[label]}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Train Model</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Epochs</label>
                    <Input type="number" min={20} max={2000} value={trainEpochs} onChange={(e) => setTrainEpochs(Number(e.target.value || 300))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">LR</label>
                    <Input type="number" step="0.001" min={0.001} max={1} value={trainLearningRate} onChange={(e) => setTrainLearningRate(Number(e.target.value || 0.12))} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">L2</label>
                    <Input type="number" step="0.0001" min={0} max={0.1} value={trainL2} onChange={(e) => setTrainL2(Number(e.target.value || 0.0001))} />
                  </div>
                </div>
                <Button className="w-full" onClick={handleTrainModel} disabled={isTraining}>
                  {isTraining ? 'Training...' : 'Train + Load Model'}
                </Button>
                {trainResult && (
                  <div className="text-xs space-y-1 border rounded-md p-2 bg-muted/20">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-mono">{trainResult.status}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono">{trainResult.modelVersion || '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Accuracy</span>
                      <span className="font-mono">{trainResult.trainAccuracy ?? '--'}</span>
                    </div>
                    {trainResult.error && <p className="text-destructive">{trainResult.error}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Trained Models</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {rfmlModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trained model yet.</p>
                ) : (
                  rfmlModels.slice(0, 5).map((m) => (
                    <div key={m.modelId} className="border rounded-md p-2 space-y-1">
                      <div className="text-xs font-mono">{m.modelVersion}</div>
                      <div className="text-xs text-muted-foreground">{formatTs(m.createdAt)}</div>
                      <div className="text-xs text-muted-foreground">acc={m.trainAccuracy} loss={m.trainLoss}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => handleLoadModel(m.modelPath)}
                        disabled={loadingModelPath === m.modelPath}
                      >
                        <UploadCloud className="h-3.5 w-3.5 mr-1" />
                        {loadingModelPath === m.modelPath ? 'Loading...' : 'Load'}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">RFML Samples</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Capture</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Hint</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Frames</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rfmlSamples.map((sample) => (
                    <TableRow
                      key={sample.captureId}
                      className="cursor-pointer"
                      onClick={() => setSelectedCaptureId(sample.captureId)}
                    >
                      <TableCell className="font-mono text-xs">{sample.captureId}</TableCell>
                      <TableCell>{sample.deviceId}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">{sample.dominantLabel || '--'}</Badge>
                      </TableCell>
                      <TableCell>
                        {sample.label ? (
                          <Badge className="font-mono text-[11px]">{sample.label}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">unlabeled</span>
                        )}
                      </TableCell>
                      <TableCell>{sample.sampledFrames || '--'}</TableCell>
                      <TableCell>{formatTs(sample.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
};

export default RawLab;
