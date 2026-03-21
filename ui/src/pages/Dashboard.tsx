import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as ReactGridLayout from 'react-grid-layout';
import { 
  Plus, 
  LayoutDashboard,
  Radio,
  Activity,
  Map,
  TrendingUp,
  X,
  GripVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/api/client';
import type { Dashboard, WidgetType, Widget } from '@/models/types';
import { DeviceHealthWidget } from '@/components/widgets/DeviceHealthWidget';
import { MapMiniWidget } from '@/components/widgets/MapMiniWidget';
import { TopPeaksWidget } from '@/components/widgets/TopPeaksWidget';
import { LiveSpectrumWidget } from '@/components/widgets/LiveSpectrumWidget';
import { Spinner } from '@/components/ui/spinner';

// react-grid-layout is CommonJS; Vite ESM interop can be inconsistent for attached exports.
// To avoid runtime issues with WidthProvider, we use Responsive directly and pass an explicit width.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RGL = ReactGridLayout as any;
const ResponsiveGridLayout = RGL.Responsive as React.ComponentType<any>;

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}

interface LayoutsMap {
  [key: string]: LayoutItem[];
}

const WIDGET_CATALOG: { type: WidgetType; label: string; icon: React.FC<{ className?: string }>; defaultSize: { w: number; h: number; minW: number; minH: number } }[] = [
  { type: 'LIVE_SPECTRUM', label: 'Live Spectrum', icon: Radio, defaultSize: { w: 6, h: 4, minW: 4, minH: 3 } },
  { type: 'DEVICE_HEALTH', label: 'Device Health', icon: Activity, defaultSize: { w: 4, h: 4, minW: 3, minH: 3 } },
  { type: 'MAP_MINI', label: 'Map Mini', icon: Map, defaultSize: { w: 6, h: 5, minW: 4, minH: 4 } },
  { type: 'TOP_PEAKS', label: 'Top Peaks', icon: TrendingUp, defaultSize: { w: 4, h: 4, minW: 3, minH: 3 } },
];

const STORAGE_KEY = 'dashboard-layouts';

const DashboardPage: React.FC = () => {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<Dashboard | null>(null);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [layouts, setLayouts] = useState<LayoutsMap>({});
  const [isLoading, setIsLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1200);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setContainerWidth(el.getBoundingClientRect().width || 1200);
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  // Load layouts from localStorage
  useEffect(() => {
    const savedLayouts = localStorage.getItem(STORAGE_KEY);
    if (savedLayouts) {
      try {
        setLayouts(JSON.parse(savedLayouts));
      } catch (e) {
        console.error('Failed to parse saved layouts:', e);
      }
    }
  }, []);

  // Fetch dashboards
  useEffect(() => {
    setIsLoading(true);
    apiClient.getDashboards().then(data => {
      setDashboards(data);
      if (data.length > 0) setActiveDashboard(data[0]);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  // Generate layout from widgets
  const generateLayoutFromWidgets = useCallback((widgets: Widget[]): LayoutItem[] => {
    return widgets.map((widget, index) => {
      const catalogItem = WIDGET_CATALOG.find(w => w.type === widget.type);
      const defaultSize = catalogItem?.defaultSize || { w: 6, h: 4, minW: 3, minH: 3 };
      
      return {
        i: widget.id,
        x: widget.layout?.x ?? (index % 2) * 6,
        y: widget.layout?.y ?? Math.floor(index / 2) * 4,
        w: widget.layout?.w ?? defaultSize.w,
        h: widget.layout?.h ?? defaultSize.h,
        minW: defaultSize.minW,
        minH: defaultSize.minH,
      };
    });
  }, []);

  // Get current layout for active dashboard
  const getCurrentLayout = useCallback((): LayoutItem[] => {
    if (!activeDashboard) return [];
    
    const dashboardLayouts = layouts[activeDashboard.id];
    if (dashboardLayouts && dashboardLayouts.length === activeDashboard.widgets.length) {
      return dashboardLayouts;
    }
    
    return generateLayoutFromWidgets(activeDashboard.widgets);
  }, [activeDashboard, layouts, generateLayoutFromWidgets]);

  const handleLayoutChange = useCallback((_currentLayout: LayoutItem[], allLayouts: LayoutsMap) => {
    if (!activeDashboard) return;
    
    const newLayouts: LayoutsMap = {
      ...layouts,
      ...allLayouts,
      [activeDashboard.id]: allLayouts.lg || _currentLayout,
    };
    setLayouts(newLayouts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayouts));
  }, [activeDashboard, layouts]);

  const handleAddWidget = (type: WidgetType) => {
    if (!activeDashboard) return;
    
    const catalogItem = WIDGET_CATALOG.find(w => w.type === type);
    const defaultSize = catalogItem?.defaultSize || { w: 6, h: 4, minW: 3, minH: 3 };
    
    const newWidget: Widget = {
      id: `widget-${Date.now()}`,
      type,
      title: catalogItem?.label || type,
      config: {},
      layout: { x: 0, y: Infinity, w: defaultSize.w, h: defaultSize.h },
    };
    
    const updated = { ...activeDashboard, widgets: [...activeDashboard.widgets, newWidget] };
    setActiveDashboard(updated);
    
    // Update layouts for the dashboard
    const currentLayout = getCurrentLayout();
    const newLayout: LayoutItem = {
      i: newWidget.id,
      x: 0,
      y: Infinity,
      w: defaultSize.w,
      h: defaultSize.h,
      minW: defaultSize.minW,
      minH: defaultSize.minH,
    };
    
    const newLayouts: LayoutsMap = {
      ...layouts,
      [activeDashboard.id]: [...currentLayout, newLayout],
    };
    setLayouts(newLayouts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayouts));
    
    apiClient.updateDashboard(activeDashboard.id, updated);
  };

  const handleRemoveWidget = (widgetId: string) => {
    if (!activeDashboard) return;
    
    const updated = { ...activeDashboard, widgets: activeDashboard.widgets.filter(w => w.id !== widgetId) };
    setActiveDashboard(updated);
    
    // Remove from layouts
    const currentLayout = getCurrentLayout();
    const newLayouts: LayoutsMap = {
      ...layouts,
      [activeDashboard.id]: currentLayout.filter(l => l.i !== widgetId),
    };
    setLayouts(newLayouts);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayouts));
    
    apiClient.updateDashboard(activeDashboard.id, updated);
  };

  const handleCreateDashboard = async () => {
    if (!newDashboardName.trim()) return;
    const newDashboard = await apiClient.createDashboard({ name: newDashboardName, widgets: [] });
    setDashboards(prev => [...prev, newDashboard]);
    setActiveDashboard(newDashboard);
    setNewDashboardName('');
    setShowNewDialog(false);
  };

  const renderWidget = (widget: Widget) => {
    const content = (() => {
      switch (widget.type) {
        case 'DEVICE_HEALTH': return <DeviceHealthWidget />;
        case 'MAP_MINI': return <MapMiniWidget />;
        case 'TOP_PEAKS': return <TopPeaksWidget radioKeys={widget.config.deviceIds as string[]} />;
        case 'LIVE_SPECTRUM': return <LiveSpectrumWidget initialDeviceId={widget.config.deviceId as string} />;
        default: return (
          <Card className="h-full">
            <CardContent className="flex items-center justify-center h-full text-muted-foreground">
              Unknown widget
            </CardContent>
          </Card>
        );
      }
    })();

    return (
      <div className="h-full relative group">
        <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-move drag-handle">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <Button 
          variant="destructive" 
          size="icon" 
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 z-10 transition-opacity" 
          onClick={() => handleRemoveWidget(widget.id)}
        >
          <X className="h-3 w-3" />
        </Button>
        {content}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Select 
            value={activeDashboard?.id || ''} 
            onValueChange={(id) => setActiveDashboard(dashboards.find(d => d.id === id) || null)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select dashboard" />
            </SelectTrigger>
            <SelectContent>
              {dashboards.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  <LayoutDashboard className="h-4 w-4 inline mr-2" />
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />New
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Dashboard</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Input 
                  placeholder="Dashboard name" 
                  value={newDashboardName} 
                  onChange={(e) => setNewDashboardName(e.target.value)} 
                />
                <Button onClick={handleCreateDashboard} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="flex items-center gap-2">
          {WIDGET_CATALOG.map(item => (
            <Button 
              key={item.type} 
              variant="outline" 
              size="sm" 
              onClick={() => handleAddWidget(item.type)}
            >
              <item.icon className="h-4 w-4 mr-1" />
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {activeDashboard && (
        <div ref={containerRef} className="min-h-[600px]">
          {activeDashboard.widgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
              <LayoutDashboard className="h-16 w-16 mb-4 opacity-30" />
              <p className="text-lg font-medium">No widgets yet</p>
              <p className="text-sm">Click a widget button above to add one</p>
            </div>
          ) : (
            <ResponsiveGridLayout
              className="layout"
              width={containerWidth}
              layouts={{ lg: getCurrentLayout() }}
              breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
              cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
              rowHeight={80}
              onLayoutChange={handleLayoutChange}
              draggableHandle=".drag-handle"
              isResizable={true}
              isDraggable={true}
              useCSSTransforms={true}
            >
              {activeDashboard.widgets.map(widget => (
                <div key={widget.id} className="overflow-hidden">
                  {renderWidget(widget)}
                </div>
              ))}
            </ResponsiveGridLayout>
          )}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
