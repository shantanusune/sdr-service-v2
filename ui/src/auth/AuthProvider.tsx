import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getKeycloak, getRedirectUri, extractRealmRoles, KeycloakTokenParsed } from './keycloak';
import type { User, UserRole } from '@/models/types';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  user: User | null;
  roles: UserRole[];
  token: string | null;
  login: () => void;
  logout: () => void;
  refreshToken: () => Promise<boolean>;
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Token refresh interval in milliseconds (30 seconds)
const TOKEN_REFRESH_INTERVAL = 30 * 1000;

// Minimum token validity in seconds (60 seconds)
const MIN_TOKEN_VALIDITY = 60;

// Mock user for development when VITE_MOCK_AUTH is true
const MOCK_USER: User = {
  userId: 'mock-user-1',
  name: 'Demo Admin',
  email: 'admin@sdr-demo.local',
  roles: ['ADMIN', 'ANALYST', 'VIEWER'],
};

const USE_MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Update user state from Keycloak token
   */
  const updateUserFromToken = useCallback((tokenParsed: KeycloakTokenParsed | undefined, accessToken: string | undefined) => {
    if (!tokenParsed) {
      setUser(null);
      setToken(null);
      setIsAuthenticated(false);
      return;
    }

    const roles = extractRealmRoles(tokenParsed) as UserRole[];
    
    // Default to VIEWER if no roles found
    const userRoles: UserRole[] = roles.length > 0 ? roles : ['VIEWER'];

    setUser({
      userId: tokenParsed.sub || '',
      name: tokenParsed.name || tokenParsed.preferred_username || 'Unknown User',
      email: tokenParsed.email || '',
      roles: userRoles,
    });
    setToken(accessToken || null);
    setIsAuthenticated(true);
  }, []);

  /**
   * Refresh the access token
   */
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (USE_MOCK_AUTH) {
      return true;
    }

    try {
      const keycloak = getKeycloak();
      const refreshed = await keycloak.updateToken(MIN_TOKEN_VALIDITY);
      
      if (refreshed) {
        console.log('Token refreshed successfully');
        updateUserFromToken(keycloak.tokenParsed as KeycloakTokenParsed, keycloak.token);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // On refresh failure, logout and redirect to login
      logout();
      return false;
    }
  }, [updateUserFromToken]);

  /**
   * Start automatic token refresh
   */
  const startTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = setInterval(() => {
      refreshToken();
    }, TOKEN_REFRESH_INTERVAL);
  }, [refreshToken]);

  /**
   * Stop automatic token refresh
   */
  const stopTokenRefresh = useCallback(() => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, []);

  /**
   * Initialize Keycloak authentication
   */
  const initAuth = useCallback(async () => {
    if (USE_MOCK_AUTH) {
      setUser(MOCK_USER);
      setIsAuthenticated(true);
      setToken('mock-token');
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    try {
      const keycloak = getKeycloak();
      
      const authenticated = await keycloak.init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        checkLoginIframe: false,
        pkceMethod: 'S256',
      });

      if (authenticated) {
        updateUserFromToken(keycloak.tokenParsed as KeycloakTokenParsed, keycloak.token);
        startTokenRefresh();

        // Handle token expiry event
        keycloak.onTokenExpired = () => {
          console.log('Token expired, attempting refresh...');
          refreshToken();
        };

        // Handle auth error
        keycloak.onAuthError = (error) => {
          console.error('Keycloak auth error:', error);
          logout();
        };

        // Handle auth logout
        keycloak.onAuthLogout = () => {
          console.log('User logged out from Keycloak');
          stopTokenRefresh();
          setUser(null);
          setToken(null);
          setIsAuthenticated(false);
        };
      }
    } catch (error) {
      console.error('Failed to initialize Keycloak:', error);
      // Only use mock auth if explicitly enabled
      if (USE_MOCK_AUTH) {
        setUser(MOCK_USER);
        setIsAuthenticated(true);
        setToken('mock-token');
      }
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, [updateUserFromToken, startTokenRefresh, stopTokenRefresh, refreshToken]);

  useEffect(() => {
    initAuth();

    return () => {
      stopTokenRefresh();
    };
  }, [initAuth, stopTokenRefresh]);

  /**
   * Login via Keycloak
   */
  const login = useCallback(() => {
    if (USE_MOCK_AUTH) {
      setUser(MOCK_USER);
      setIsAuthenticated(true);
      setToken('mock-token');
      return;
    }

    const keycloak = getKeycloak();
    keycloak.login({
      redirectUri: getRedirectUri('/dashboard'),
    });
  }, []);

  /**
   * Logout via Keycloak
   */
  const logout = useCallback(() => {
    stopTokenRefresh();
    
    if (USE_MOCK_AUTH) {
      setUser(null);
      setIsAuthenticated(false);
      setToken(null);
      return;
    }

    const keycloak = getKeycloak();
    setUser(null);
    setIsAuthenticated(false);
    setToken(null);
    
    keycloak.logout({
      redirectUri: getRedirectUri('/login'),
    });
  }, [stopTokenRefresh]);

  /**
   * Check if user has a specific role
   */
  const hasRole = useCallback((role: UserRole): boolean => {
    return user?.roles.includes(role) || false;
  }, [user]);

  /**
   * Check if user has any of the specified roles
   */
  const hasAnyRole = useCallback((roles: UserRole[]): boolean => {
    return roles.some(role => user?.roles.includes(role));
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        isInitialized,
        user,
        roles: user?.roles || [],
        token,
        login,
        logout,
        refreshToken,
        hasRole,
        hasAnyRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthProvider;
