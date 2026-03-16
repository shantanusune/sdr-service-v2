import Keycloak from 'keycloak-js';

// Keycloak configuration from environment variables
const keycloakConfig = {
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'sdr',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'lovable-web',
};

// Singleton Keycloak instance
let keycloakInstance: Keycloak | null = null;

/**
 * Get or create the Keycloak instance
 */
export const getKeycloak = (): Keycloak => {
  if (!keycloakInstance) {
    keycloakInstance = new Keycloak(keycloakConfig);
  }
  return keycloakInstance;
};

/**
 * Get redirect URI from env or use current origin
 */
export const getRedirectUri = (path: string = '/'): string => {
  const baseUri = import.meta.env.VITE_KEYCLOAK_REDIRECT_URI || window.location.origin;
  return `${baseUri}${path}`;
};

/**
 * TypeScript interface for parsed Keycloak token
 */
export interface KeycloakTokenParsed {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [key: string]: {
      roles: string[];
    };
  };
  exp?: number;
  iat?: number;
}

/**
 * Extract realm roles from the token
 */
export const extractRealmRoles = (tokenParsed: KeycloakTokenParsed | undefined): string[] => {
  if (!tokenParsed?.realm_access?.roles) {
    return [];
  }
  
  // Filter to only include our application roles
  const appRoles = ['ADMIN', 'ANALYST', 'VIEWER'];
  return tokenParsed.realm_access.roles.filter(role => appRoles.includes(role));
};

export default getKeycloak;
