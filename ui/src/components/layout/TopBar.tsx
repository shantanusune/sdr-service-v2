import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { 
  LogOut, 
  User as UserIcon,
  Bell,
  Wifi,
  WifiOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface TopBarProps {
  sidebarCollapsed: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({ sidebarCollapsed }) => {
  const { user, logout, roles } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const primaryRole = roles[0] || 'VIEWER';
  const roleColors: Record<string, string> = {
    ADMIN: 'bg-destructive text-destructive-foreground',
    ANALYST: 'bg-accent text-accent-foreground',
    VIEWER: 'bg-muted text-muted-foreground',
  };

  return (
    <header 
      className={cn(
        "fixed top-0 right-0 z-30 h-16 bg-background/80 backdrop-blur-md border-b border-border transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-60"
      )}
    >
      <div className="flex h-full items-center justify-between px-6">
        {/* Left side - Workspace name */}
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">SDR Workspace</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wifi className="h-4 w-4 text-success" />
            <span>Connected</span>
          </div>
        </div>

        {/* Right side - User info & actions */}
        <div className="flex items-center gap-4">
          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
              3
            </span>
          </Button>

          {/* User dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-3 h-10 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {user ? getInitials(user.name) : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium text-foreground">
                    {user?.name || 'User'}
                  </span>
                  <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", roleColors[primaryRole])}>
                    {primaryRole}
                  </Badge>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{user?.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <UserIcon className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
