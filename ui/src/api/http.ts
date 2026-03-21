import { getKeycloak } from '@/auth/keycloak';
import { resolveApiBaseUrl } from '@/config/runtimeEndpoints';

const API_BASE_URL = resolveApiBaseUrl();
const USE_MOCK_AUTH = import.meta.env.VITE_MOCK_AUTH === 'true';

export interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export interface ApiError {
  status: number;
  message: string;
  data?: unknown;
}

/**
 * Get the current access token
 */
const getAccessToken = (): string | null => {
  if (USE_MOCK_AUTH) {
    return 'mock-token';
  }
  
  const keycloak = getKeycloak();
  return keycloak.token || null;
};

/**
 * Handle 401 unauthorized responses
 */
const handleUnauthorized = async (): Promise<void> => {
  if (USE_MOCK_AUTH) {
    console.warn('Unauthorized in mock mode - redirecting to login');
    window.location.href = '/login';
    return;
  }

  const keycloak = getKeycloak();
  
  try {
    // Try to refresh the token first
    const refreshed = await keycloak.updateToken(60);
    if (!refreshed) {
      // Token couldn't be refreshed, force re-login
      keycloak.login({
        redirectUri: window.location.origin + '/dashboard',
      });
    }
  } catch {
    // Refresh failed, force re-login
    keycloak.login({
      redirectUri: window.location.origin + '/dashboard',
    });
  }
};

/**
 * Authenticated fetch helper
 * - Adds Authorization: Bearer <token> header
 * - Handles 401 by forcing re-login
 * - Throws ApiError for non-2xx responses
 */
export const fetchWithAuth = async <T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> => {
  const { skipAuth = false, headers = {}, ...restOptions } = options;

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;

  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...headers,
  };

  // Add authorization header if not skipped
  if (!skipAuth) {
    const token = getAccessToken();
    if (token) {
      (requestHeaders as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...restOptions,
      headers: requestHeaders,
    });

    // Handle 401 Unauthorized
    if (response.status === 401) {
      await handleUnauthorized();
      throw {
        status: 401,
        message: 'Unauthorized - redirecting to login',
      } as ApiError;
    }

    // Handle other non-2xx responses
    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }

      throw {
        status: response.status,
        message: `Request failed with status ${response.status}`,
        data: errorData,
      } as ApiError;
    }

    // Handle empty responses
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || response.status === 204) {
      return undefined as T;
    }

    // Parse JSON response
    return await response.json();
  } catch (error) {
    // Re-throw ApiError
    if ((error as ApiError).status) {
      throw error;
    }

    // Network or other errors
    throw {
      status: 0,
      message: error instanceof Error ? error.message : 'Network error',
    } as ApiError;
  }
};

/**
 * HTTP method helpers
 */
export const http = {
  get: <T = unknown>(endpoint: string, options?: FetchOptions) =>
    fetchWithAuth<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = unknown>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchWithAuth<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T = unknown>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchWithAuth<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T = unknown>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchWithAuth<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T = unknown>(endpoint: string, options?: FetchOptions) =>
    fetchWithAuth<T>(endpoint, { ...options, method: 'DELETE' }),
};

export default http;
