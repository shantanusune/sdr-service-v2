import React, { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/api/client';
import type { Machine, Device } from '@/models/types';

const MapPage: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [showOnlyOnline, setShowOnlyOnline] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => { Promise.all([apiClient.getMachines(), apiClient.getDevices()]).then(([m, d]) => { setMachines(m); setDevices(d); }); }, []);

  useEffect(() => {
    if (!mapContainer.current || machines.length === 0) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 } }, layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.8, 'raster-brightness-min': 0.1, 'raster-brightness-max': 0.5 } }] },
      center: [0, 20], zoom: 2
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    const filtered = machines.filter(m => !showOnlyOnline || m.status === 'online');
    filtered.forEach(machine => {
      const machineDevices = devices.filter(d => d.machineId === machine.machineId && (filterType === 'all' || d.type === filterType));
      const color = machine.status === 'online' ? '#10b981' : machine.status === 'warning' ? '#f59e0b' : '#6b7280';
      new maplibregl.Marker({ color }).setLngLat([machine.lon, machine.lat]).setPopup(new maplibregl.Popup().setHTML(`<div class="p-2"><strong>${machine.name}</strong><br/>${machine.siteName}<br/>Devices: ${machineDevices.length}</div>`)).addTo(map.current!);
    });
    return () => { map.current?.remove(); };
  }, [machines, devices, showOnlyOnline, filterType]);

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4">
      <Card className="w-64 shrink-0"><CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between"><Label>Online Only</Label><Switch checked={showOnlyOnline} onCheckedChange={setShowOnlyOnline} /></div>
        <div><Label className="mb-2 block">Device Type</Label><Select value={filterType} onValueChange={setFilterType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="RTLSDR">RTL-SDR</SelectItem><SelectItem value="HACKRF">HackRF</SelectItem></SelectContent></Select></div>
        <div className="pt-4 space-y-2">{machines.map(m => <div key={m.machineId} className="flex items-center justify-between text-sm"><span>{m.name}</span><Badge variant={m.status === 'online' ? 'default' : 'secondary'}>{m.status}</Badge></div>)}</div>
      </CardContent></Card>
      <div ref={mapContainer} className="flex-1 rounded-lg overflow-hidden" />
    </div>
  );
};

export default MapPage;
