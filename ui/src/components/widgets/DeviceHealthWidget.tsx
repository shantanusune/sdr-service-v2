import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wifi, WifiOff, Clock } from 'lucide-react';
import { apiClient } from '@/api/client';
import type { Device } from '@/models/types';
import { cn } from '@/lib/utils';

export const DeviceHealthWidget: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.getDevices().then(data => {
      setDevices(data);
      setLoading(false);
    });
  }, []);

  const formatLastSeen = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Device Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const onlineCount = devices.filter(d => d.online).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Device Health</CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              {onlineCount} online
            </Badge>
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              {offlineCount} offline
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full px-4 pb-4">
          <div className="space-y-2">
            {devices.map(device => (
              <div
                key={device.deviceId}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg border",
                  device.online ? "border-success/20 bg-success/5" : "border-border bg-muted/30"
                )}
              >
                <div className="flex items-center gap-3">
                  {device.online ? (
                    <Wifi className="h-4 w-4 text-success" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{device.deviceId}</p>
                    <p className="text-xs text-muted-foreground">{device.type}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-muted-foreground">
                    {(device.cf / 1e6).toFixed(1)} MHz
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatLastSeen(device.lastSeenTs)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default DeviceHealthWidget;
