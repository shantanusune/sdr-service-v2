import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Play, FileAudio, BarChart3, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/api/client';
import type { Device, Capture } from '@/models/types';

const RawLab: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [duration, setDuration] = useState(5);
  const [selectedCapture, setSelectedCapture] = useState<Capture | null>(null);
  const { toast } = useToast();

  useEffect(() => { apiClient.getDevices().then(d => setDevices(d.filter(dev => dev.online))); apiClient.getCaptures().then(setCaptures); }, []);

  const handleStartCapture = async () => {
    if (!selectedDevice) return;
    const capture = await apiClient.createCapture({ deviceId: selectedDevice, seconds: duration });
    setCaptures(prev => [capture, ...prev]);
    toast({ title: 'Capture started', description: `Recording ${duration}s from ${selectedDevice}` });
  };

  const handleRunAnalysis = async (captureId: string) => {
    await apiClient.createAnalysisJob(captureId);
    toast({ title: 'Analysis started', description: 'Processing capture...' });
  };

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileAudio className="h-4 w-4" />Capture Raw IQ</CardTitle></CardHeader><CardContent className="space-y-4">
        <div><label className="text-sm text-muted-foreground mb-2 block">Device</label><Select value={selectedDevice} onValueChange={setSelectedDevice}><SelectTrigger><SelectValue placeholder="Select device" /></SelectTrigger><SelectContent>{devices.map(d => <SelectItem key={d.deviceId} value={d.deviceId}>{d.deviceId}</SelectItem>)}</SelectContent></Select></div>
        <div><label className="text-sm text-muted-foreground mb-2 block">Duration</label><Select value={String(duration)} onValueChange={v => setDuration(Number(v))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="2">2 seconds</SelectItem><SelectItem value="5">5 seconds</SelectItem><SelectItem value="10">10 seconds</SelectItem></SelectContent></Select></div>
        <Button className="w-full" onClick={handleStartCapture} disabled={!selectedDevice}><Play className="h-4 w-4 mr-2" />Start Capture</Button>
      </CardContent></Card>

      <Card className="col-span-2"><CardHeader><CardTitle className="text-sm">Captures</CardTitle></CardHeader><CardContent className="p-0">
        <Table><TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Device</TableHead><TableHead>Duration</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
          <TableBody>{captures.map(c => <TableRow key={c.captureId} className="cursor-pointer" onClick={() => setSelectedCapture(c)}><TableCell className="font-mono text-xs">{c.captureId}</TableCell><TableCell>{c.deviceId}</TableCell><TableCell>{c.duration}s</TableCell><TableCell><Badge variant={c.status === 'complete' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); handleRunAnalysis(c.captureId); }} disabled={c.status !== 'complete'}><BarChart3 className="h-4 w-4 mr-1" />Analyze</Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent></Card>

      <Card className="col-span-3"><CardHeader><CardTitle className="text-sm">Capture Viewer</CardTitle></CardHeader><CardContent>
        {selectedCapture ? <div className="space-y-4"><div className="flex gap-4"><Badge variant="outline">{selectedCapture.captureId}</Badge><Badge variant="outline">{selectedCapture.deviceId}</Badge><Badge variant="outline">{selectedCapture.duration}s</Badge></div><div className="h-48 bg-muted/30 rounded-lg flex items-center justify-center text-muted-foreground">Spectrum/Spectrogram visualization placeholder</div><Card><CardHeader className="pb-2"><CardTitle className="text-sm">Analysis Results</CardTitle></CardHeader><CardContent><div className="flex justify-between"><span className="text-muted-foreground">Drone Link Score</span><span className="font-mono">-- / 100</span></div><div className="text-sm text-muted-foreground mt-2">Run analysis to see detected bands</div></CardContent></Card></div> : <div className="h-48 flex items-center justify-center text-muted-foreground">Select a capture to view details</div>}
      </CardContent></Card>
    </div>
  );
};

export default RawLab;
