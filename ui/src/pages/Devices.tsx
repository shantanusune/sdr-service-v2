import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  Wifi, 
  WifiOff, 
  Radio, 
  Settings2, 
  ExternalLink,
  Clock,
  Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/auth/AuthProvider';
import { apiClient } from '@/api/client';
import type { Device, Machine, DeviceType } from '@/models/types';
import { cn } from '@/lib/utils';

const DevicesPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMachine, setFilterMachine] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterOnline, setFilterOnline] = useState<string>('all');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { hasAnyRole } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const canControl = hasAnyRole(['ANALYST', 'ADMIN']);

  useEffect(() => {
    Promise.all([apiClient.getDevices(), apiClient.getMachines()]).then(
      ([deviceData, machineData]) => {
        setDevices(deviceData);
        setMachines(machineData);
        setLoading(false);
      }
    );
  }, []);

  const filteredDevices = devices.filter(device => {
    if (searchQuery && !device.deviceId.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filterMachine !== 'all' && device.machineId !== filterMachine) {
      return false;
    }
    if (filterType !== 'all' && device.type !== filterType) {
      return false;
    }
    if (filterOnline !== 'all') {
      if (filterOnline === 'online' && !device.online) return false;
      if (filterOnline === 'offline' && device.online) return false;
    }
    return true;
  });

  const formatLastSeen = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return new Date(ts).toLocaleDateString();
  };

  const formatFrequency = (hz: number) => {
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
    return `${(hz / 1e6).toFixed(2)} MHz`;
  };

  const formatSampleRate = (hz: number) => {
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)} MS/s`;
    return `${(hz / 1e3).toFixed(0)} kS/s`;
  };

  const handleOpenSpectrum = (deviceIds: string[]) => {
    navigate(`/spectrum-lab?devices=${deviceIds.join(',')}`);
  };

  const handleControlChange = async (deviceId: string, control: 'rawfeed' | 'spectrum', value: boolean) => {
    try {
      await apiClient.controlDevice(deviceId, { [control]: value });
      toast({
        title: 'Control updated',
        description: `${control} ${value ? 'enabled' : 'disabled'} for ${deviceId}`,
      });
    } catch (error) {
      toast({
        title: 'Control failed',
        description: 'Failed to update device control.',
        variant: 'destructive',
      });
    }
  };

  const getMachineName = (machineId: string) => {
    return machines.find(m => m.machineId === machineId)?.name || machineId;
  };

  const onlineCount = devices.filter(d => d.online).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Devices</p>
                <p className="text-3xl font-bold">{devices.length}</p>
              </div>
              <Activity className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Online</p>
                <p className="text-3xl font-bold text-success">{onlineCount}</p>
              </div>
              <Wifi className="h-8 w-8 text-success" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Offline</p>
                <p className="text-3xl font-bold text-muted-foreground">{offlineCount}</p>
              </div>
              <WifiOff className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sites</p>
                <p className="text-3xl font-bold">{machines.length}</p>
              </div>
              <Radio className="h-8 w-8 text-accent" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search devices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterMachine} onValueChange={setFilterMachine}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Machine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {machines.map(m => (
                  <SelectItem key={m.machineId} value={m.machineId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="RTLSDR">RTL-SDR</SelectItem>
                <SelectItem value="HACKRF">HackRF</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterOnline} onValueChange={setFilterOnline}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Devices table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device ID</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Center Freq</TableHead>
                <TableHead>Sample Rate</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      Loading devices...
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredDevices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No devices found
                  </TableCell>
                </TableRow>
              ) : (
                filteredDevices.map(device => (
                  <TableRow 
                    key={device.deviceId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setSelectedDevice(device);
                      setSheetOpen(true);
                    }}
                  >
                    <TableCell>
                      <span className="font-mono text-sm">{device.deviceId}</span>
                    </TableCell>
                    <TableCell>{getMachineName(device.machineId)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{device.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {device.online ? (
                          <>
                            <span className="h-2 w-2 rounded-full bg-success" />
                            <span className="text-success text-sm">Online</span>
                          </>
                        ) : (
                          <>
                            <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                            <span className="text-muted-foreground text-sm">Offline</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatFrequency(device.cf)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatSampleRate(device.sr)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatLastSeen(device.lastSeenTs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSpectrum([device.deviceId]);
                        }}
                        disabled={!device.online}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Spectrum
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Device detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-96">
          {selectedDevice && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Radio className="h-5 w-5" />
                  {selectedDevice.deviceId}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {/* Status */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
                  <div className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border",
                    selectedDevice.online ? "border-success/30 bg-success/5" : "border-border bg-muted/30"
                  )}>
                    {selectedDevice.online ? (
                      <Wifi className="h-5 w-5 text-success" />
                    ) : (
                      <WifiOff className="h-5 w-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{selectedDevice.online ? 'Online' : 'Offline'}</p>
                      <p className="text-xs text-muted-foreground">
                        Last seen: {formatLastSeen(selectedDevice.lastSeenTs)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Details</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Machine</span>
                      <span className="font-medium">{getMachineName(selectedDevice.machineId)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Type</span>
                      <Badge variant="outline">{selectedDevice.type}</Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Center Frequency</span>
                      <span className="font-mono">{formatFrequency(selectedDevice.cf)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Sample Rate</span>
                      <span className="font-mono">{formatSampleRate(selectedDevice.sr)}</span>
                    </div>
                  </div>
                </div>

                {/* Controls */}
                {canControl && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Controls</h4>
                    <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/20">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="rawfeed" className="text-sm">Raw Feed</Label>
                        <Switch
                          id="rawfeed"
                          disabled={!selectedDevice.online}
                          onCheckedChange={(checked) => 
                            handleControlChange(selectedDevice.deviceId, 'rawfeed', checked)
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="spectrum" className="text-sm">Spectrum</Label>
                        <Switch
                          id="spectrum"
                          defaultChecked={selectedDevice.online}
                          disabled={!selectedDevice.online}
                          onCheckedChange={(checked) => 
                            handleControlChange(selectedDevice.deviceId, 'spectrum', checked)
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Topic path */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Topic Path</h4>
                  <code className="block p-3 rounded-lg bg-muted/50 text-xs font-mono break-all">
                    {selectedDevice.machineId}/{selectedDevice.deviceId}/spectrum/*
                  </code>
                </div>

                {/* Actions */}
                <div className="pt-4 space-y-2">
                  <Button
                    className="w-full"
                    onClick={() => handleOpenSpectrum([selectedDevice.deviceId])}
                    disabled={!selectedDevice.online}
                  >
                    <Radio className="h-4 w-4 mr-2" />
                    Open in Spectrum Lab
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default DevicesPage;
