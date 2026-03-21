import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SpectrumChart } from '@/components/charts/SpectrumChart';
import { useSpectrumWS } from '@/realtime/useSpectrumWS';
import { useStreamableDatasources } from '@/hooks/useDatasources';
import { groupDataSourcesByHost } from '@/config/dataSources';
import { isDisabledState } from '@/types/api';
import { Wifi, WifiOff } from 'lucide-react';

interface LiveSpectrumWidgetProps {
  initialDeviceId?: string;
}

interface RadioOption {
  key: string;
  sourceId: string;
  radioId: string;
  name: string;
  disabled: boolean;
}

export const LiveSpectrumWidget: React.FC<LiveSpectrumWidgetProps> = ({ 
  initialDeviceId 
}) => {
  const [selectedRadio, setSelectedRadio] = useState<string>(initialDeviceId || '');
  
  // Fetch datasources
  const { data: rawDatasources } = useStreamableDatasources();
  
  const dataSources = useMemo(() => {
    if (!rawDatasources) return [];
    return groupDataSourcesByHost(rawDatasources);
  }, [rawDatasources]);

  // Build radio options
  const radioOptions = useMemo((): RadioOption[] => {
    const options: RadioOption[] = [];
    for (const source of dataSources) {
      for (const radio of source.radios) {
        const state = String(radio.meta?.state || 'UNKNOWN');
        options.push({
          key: `${source.id}:${radio.id}`,
          sourceId: source.id,
          radioId: radio.id,
          name: radio.name,
          disabled: isDisabledState(state),
        });
      }
    }
    return options;
  }, [dataSources]);

  // Auto-select first available radio
  useEffect(() => {
    if (!selectedRadio && radioOptions.length > 0) {
      const firstEnabled = radioOptions.find(r => !r.disabled);
      if (firstEnabled) {
        setSelectedRadio(firstEnabled.key);
      }
    }
  }, [radioOptions, selectedRadio]);

  // Spectrum hook
  const { spectrumData, subscribe, unsubscribe, isConnected } = useSpectrumWS();

  // Subscribe when selection changes
  useEffect(() => {
    if (selectedRadio && dataSources.length > 0) {
      subscribe(dataSources, [selectedRadio]);
    }
    return () => unsubscribe();
  }, [selectedRadio, dataSources, subscribe, unsubscribe]);

  // Chart data
  const chartData = useMemo(() => {
    if (selectedRadio && spectrumData[selectedRadio]) {
      return [spectrumData[selectedRadio].frame];
    }
    return [];
  }, [selectedRadio, spectrumData]);

  const selectedOption = radioOptions.find(r => r.key === selectedRadio);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Live Spectrum</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedRadio} onValueChange={setSelectedRadio}>
              <SelectTrigger className="w-36 h-7 text-xs">
                <SelectValue placeholder="Select radio" />
              </SelectTrigger>
              <SelectContent>
                {radioOptions.map(radio => (
                  <SelectItem 
                    key={radio.key} 
                    value={radio.key}
                    disabled={radio.disabled}
                  >
                    {radio.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-2">
        {chartData.length > 0 ? (
          <SpectrumChart 
            data={chartData} 
            width={400} 
            height={200}
            showGrid
            showPeaks
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {selectedRadio ? 'Waiting for data...' : 'Select a radio'}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LiveSpectrumWidget;
