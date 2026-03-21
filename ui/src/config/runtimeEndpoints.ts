const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function browserHost(): string {
  if (typeof window === "undefined") {
    return "localhost";
  }
  return window.location.hostname || "localhost";
}

function parseUrl(value: string, protocolHint: "http:" | "ws:"): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`${protocolHint}//${value}`);
    } catch {
      return null;
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function rewriteLocalhost(url: URL): URL {
  const host = browserHost();
  if (!LOCAL_HOSTS.has(host) && LOCAL_HOSTS.has(url.hostname)) {
    url.hostname = host;
  }
  return url;
}

export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    const parsed = parseUrl(configured, "http:");
    if (parsed) {
      return trimTrailingSlash(rewriteLocalhost(parsed).toString());
    }
    return trimTrailingSlash(configured);
  }

  return `http://${browserHost()}:8090`;
}

export function resolveWsBaseUrl(): string {
  const configured = import.meta.env.VITE_WS_BASE_URL?.trim();
  if (configured) {
    const parsed = parseUrl(configured, "ws:");
    if (parsed) {
      return trimTrailingSlash(rewriteLocalhost(parsed).toString());
    }
    return trimTrailingSlash(configured);
  }

  const scheme = typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss"
    : "ws";
  return `${scheme}://${browserHost()}:8090`;
}

export function resolveWsEndpoint(endpoint?: string | null): string {
  if (endpoint && endpoint.trim().length > 0) {
    const parsed = parseUrl(endpoint.trim(), "ws:");
    if (parsed) {
      return trimTrailingSlash(rewriteLocalhost(parsed).toString());
    }
    return trimTrailingSlash(endpoint.trim());
  }

  return `${resolveWsBaseUrl()}/ws`;
}
