import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { useSpectrumWS } from '@/realtime/useSpectrumWS';
import { useStreamableDatasources } from '@/hooks/useDatasources';
import { groupDataSourcesByHost } from '@/config/dataSources';
import { isDisabledState } from '@/types/api';

interface TopPeaksWidgetProps {
  radioKeys?: string[];
  maxPeaks?: number;
}

interface PeakInfo {
  radioKey: string;
  radioName: string;
  frequencyHz: number;
  powerDb: number;
  timestamp: number;
}

export const TopPeaksWidget: React.FC<TopPeaksWidgetProps> = ({ 
  radioKeys,
  maxPeaks = 5,
}) => {
  const [peaks, setPeaks] = useState<PeakInfo[]>([]);
  
  // Fetch datasources
  const { data: rawDatasources } = useStreamableDatasources();
  
  const dataSources = useMemo(() => {
    if (!rawDatasources) return [];
    return groupDataSourcesByHost(rawDatasources);
  }, [rawDatasources]);

  // Build radio name lookup
  const radioNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of dataSources) {
      for (const radio of source.radios) {
        map.set(`${source.id}:${radio.id}`, radio.name);
      }
    }
    return map;
  }, [dataSources]);

  // Get default radio keys if not provided
  const activeRadioKeys = useMemo(() => {
    if (radioKeys && radioKeys.length > 0) return radioKeys;
    
    // Default to first 2 enabled radios
    const keys: string[] = [];
    for (const source of dataSources) {
      for (const radio of source.radios) {
        const state = String(radio.meta?.state || 'UNKNOWN');
        if (!isDisabledState(state)) {
          keys.push(`${source.id}:${radio.id}`);
          if (keys.length >= 2) break;
        }
      }
      if (keys.length >= 2) break;
    }
    return keys;
  }, [radioKeys, dataSources]);

  // Spectrum hook
  const { spectrumData, subscribe, unsubscribe, isConnected } = useSpectrumWS();

  // Subscribe to radios
  useEffect(() => {
    if (activeRadioKeys.length > 0 && dataSources.length > 0) {
      subscribe(dataSources, activeRadioKeys);
    }
    return () => unsubscribe();
  }, [activeRadioKeys, dataSources, subscribe, unsubscribe]);

  // Extract peaks from spectrum data
  useEffect(() => {
    const newPeaks: PeakInfo[] = [];
    
    Object.entries(spectrumData).forEach(([radioKey, data]) => {
      const frame = data.frame;
      if (!frame || !frame.binsDbm || frame.binsDbm.length === 0) return;

      // Find peak in bins
      let peakDb = -120;
      let peakBin = 0;
      for (let i = 0; i < frame.binsDbm.length; i++) {
        if (frame.binsDbm[i] > peakDb) {
          peakDb = frame.binsDbm[i];
          peakBin = i;
        }
      }

      const startHz = frame.centerHz - frame.spanHz / 2;
      const peakHz = startHz + peakBin * frame.binHz;

      newPeaks.push({
        radioKey,
        radioName: radioNameMap.get(radioKey) || radioKey,
        frequencyHz: peakHz,
        powerDb: peakDb,
        timestamp: data.timestamp,
      });
    });

    setPeaks(newPeaks.sort((a, b) => b.powerDb - a.powerDb).slice(0, maxPeaks));
  }, [spectrumData, radioNameMap, maxPeaks]);

  const formatFreq = (hz: number) => {
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(3)} GHz`;
    return `${(hz / 1e6).toFixed(3)} MHz`;
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Top Peaks
          </CardTitle>
          <Badge 
            variant={isConnected ? 'outline' : 'secondary'}
            className={isConnected ? 'bg-success/10 text-success border-success/30 text-xs' : 'text-xs'}
          >
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                Offline
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {peaks.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
              {activeRadioKeys.length === 0 ? 'No radios configured' : 'No peaks detected'}
            </div>
          ) : (
            <div className="space-y-2">
              {peaks.map((peak, idx) => (
                <div
                  key={`${peak.radioKey}-${idx}`}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-primary">#{idx + 1}</span>
                    <div>
                      <p className="text-sm font-mono">{formatFreq(peak.frequencyHz)}</p>
                      <p className="text-xs text-muted-foreground">{peak.radioName}</p>
                    </div>
                  </div>
                  <Badge 
                    variant="outline" 
                    className={peak.powerDb > -30 ? 'bg-destructive/10 text-destructive border-destructive/30' : ''}
                  >
                    {peak.powerDb.toFixed(1)} dB
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default TopPeaksWidget;
