import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import type { UserRole, NavItem } from '@/models/types';
import { 
  LayoutDashboard, 
  Cpu, 
  Map, 
  Radio, 
  FlaskConical, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  Eye,
  Filter,
  TestTube2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const navItems: (NavItem & { Icon: React.FC<{ className?: string }>; children?: (NavItem & { Icon: React.FC<{ className?: string }> })[] })[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', Icon: LayoutDashboard, roles: ['VIEWER', 'ANALYST', 'ADMIN'] },
  { path: '/devices', label: 'Devices', icon: 'cpu', Icon: Cpu, roles: ['VIEWER', 'ANALYST', 'ADMIN'] },
  { path: '/map', label: 'Map', icon: 'map', Icon: Map, roles: ['VIEWER', 'ANALYST', 'ADMIN'] },
  { path: '/spectrum/sources', label: 'Data Sources', icon: 'activity', Icon: Activity, roles: ['VIEWER', 'ANALYST', 'ADMIN'] },
  { path: '/spectrum/view', label: 'Live Spectrum', icon: 'eye', Icon: Eye, roles: ['VIEWER', 'ANALYST', 'ADMIN'] },
  { path: '/spectrum-lab', label: 'Spectrum Lab', icon: 'radio', Icon: Radio, roles: ['ANALYST', 'ADMIN'] },
  { path: '/raw-lab', label: 'Raw Lab', icon: 'flask', Icon: FlaskConical, roles: ['ANALYST', 'ADMIN'] },
  { path: '/admin/filters', label: 'Filters', icon: 'filter', Icon: Filter, roles: ['ADMIN'] },
  { path: '/admin/test', label: 'Filter Test', icon: 'test', Icon: TestTube2, roles: ['ADMIN'] },
  { path: '/admin', label: 'Admin', icon: 'settings', Icon: Settings, roles: ['ADMIN'] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const { hasAnyRole } = useAuth();
  const location = useLocation();

  const visibleItems = navItems.filter(item => hasAnyRole(item.roles as UserRole[]));

  return (
    <aside 
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Radio className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sidebar-primary-foreground text-sm">SDR Command</span>
          </div>
        )}
        {collapsed && (
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto">
            <Radio className="h-4 w-4 text-primary-foreground" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 p-2 mt-2">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.Icon;

          const linkContent = (
            <NavLink
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                "hover:bg-sidebar-accent text-sidebar-foreground",
                isActive && "bg-sidebar-accent text-sidebar-primary glow-primary",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
              {!collapsed && (
                <span className={cn("text-sm font-medium", isActive && "text-primary")}>
                  {item.label}
                </span>
              )}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>
                  {linkContent}
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-popover text-popover-foreground">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return <React.Fragment key={item.path}>{linkContent}</React.Fragment>;
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="absolute bottom-4 left-0 right-0 px-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn(
            "w-full text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed && "px-2"
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
};

export default Sidebar;
