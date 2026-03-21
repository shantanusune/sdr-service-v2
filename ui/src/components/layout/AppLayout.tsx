import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';

// Breadcrumb mapping
const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/devices': 'Devices',
  '/map': 'Map View',
  '/spectrum-lab': 'Spectrum Lab',
  '/raw-lab': 'Raw Lab',
  '/admin': 'Admin Panel',
};

export const AppLayout: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();

  const pageTitle = pageTitles[location.pathname] || 'Dashboard';

  return (
    <div className="min-h-screen bg-background bg-grid">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      <TopBar sidebarCollapsed={sidebarCollapsed} />
      
      <main 
        className={cn(
          "pt-16 min-h-screen transition-all duration-300",
          sidebarCollapsed ? "pl-16" : "pl-60"
        )}
      >
        {/* Page header */}
        <div className="border-b border-border bg-background/50 backdrop-blur-sm">
          <div className="px-6 py-4">
            <h2 className="text-2xl font-bold text-foreground">{pageTitle}</h2>
          </div>
        </div>

        {/* Page content */}
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
