import React, { useEffect, useState, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/api/client';
import type { Machine } from '@/models/types';

export const MapMiniWidget: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);

  useEffect(() => {
    apiClient.getMachines().then(setMachines);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || machines.length === 0) return;

    // Initialize map
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: {
              'raster-saturation': -0.8,
              'raster-brightness-min': 0.1,
              'raster-brightness-max': 0.5,
            },
          },
        ],
      },
      center: [0, 20],
      zoom: 1,
    });

    // Add markers
    machines.forEach(machine => {
      const color = machine.status === 'online' ? '#10b981' : 
                    machine.status === 'warning' ? '#f59e0b' : '#6b7280';

      const marker = new maplibregl.Marker({
        color,
      })
        .setLngLat([machine.lon, machine.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(
            `<div class="text-xs">
              <strong>${machine.name}</strong><br/>
              ${machine.siteName}<br/>
              Status: ${machine.status}
            </div>`
          )
        )
        .addTo(map.current!);
    });

    return () => {
      map.current?.remove();
    };
  }, [machines]);

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Global Sites</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <div ref={mapContainer} className="w-full h-full min-h-[150px] rounded-b-lg" />
      </CardContent>
    </Card>
  );
};

export default MapMiniWidget;
