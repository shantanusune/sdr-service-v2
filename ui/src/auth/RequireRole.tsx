import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { UserRole } from '@/models/types';

interface RequireRoleProps {
  children: React.ReactNode;
  roles: UserRole[];
  /** Require all roles (AND) vs any role (OR). Default is OR */
  requireAll?: boolean;
}

/**
 * Wrapper component that requires specific roles.
 * Must be used inside RequireAuth.
 * Redirects to /forbidden if user doesn't have required roles.
 */
export const RequireRole: React.FC<RequireRoleProps> = ({ 
  children, 
  roles,
  requireAll = false 
}) => {
  const { hasRole, hasAnyRole, isLoading, isInitialized } = useAuth();

  // Still loading
  if (isLoading || !isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Check role access
  const hasAccess = requireAll 
    ? roles.every(role => hasRole(role))
    : hasAnyRole(roles);

  if (!hasAccess) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
};

export default RequireRole;
