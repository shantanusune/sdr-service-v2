import type { FilterConfig } from "@/types/sdr";

const STORAGE_KEY = "sdr.filters.v1";
const USE_API = import.meta.env.VITE_FILTER_STORE_MODE === "api";

/**
 * Filter Store - localStorage now, API-ready for future.
 * Set VITE_FILTER_STORE_MODE=api to switch to API storage.
 */

export function loadFilters(): FilterConfig[] {
  if (USE_API) {
    // TODO: Implement API fetch when backend is ready
    console.log("[FilterStore] API mode not implemented, falling back to localStorage");
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn("[FilterStore] Failed to load filters:", e);
  }
  return [];
}

export function saveFilters(filters: FilterConfig[]): void {
  if (USE_API) {
    // TODO: Implement API save when backend is ready
    console.log("[FilterStore] API mode not implemented, falling back to localStorage");
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.warn("[FilterStore] Failed to save filters:", e);
  }
}

export function getFilter(id: string): FilterConfig | undefined {
  const filters = loadFilters();
  return filters.find((f) => f.id === id);
}

export function createFilter(filter: FilterConfig): void {
  const filters = loadFilters();
  filters.push(filter);
  saveFilters(filters);
}

export function updateFilter(id: string, updates: Partial<FilterConfig>): void {
  const filters = loadFilters();
  const index = filters.findIndex((f) => f.id === id);
  if (index !== -1) {
    filters[index] = { ...filters[index], ...updates };
    saveFilters(filters);
  }
}

export function deleteFilter(id: string): void {
  const filters = loadFilters();
  const updated = filters.filter((f) => f.id !== id);
  saveFilters(updated);
}

export function exportFilters(): string {
  const filters = loadFilters();
  return JSON.stringify(filters, null, 2);
}

export function importFilters(json: string): { success: boolean; error?: string } {
  try {
    const filters = JSON.parse(json);
    if (!Array.isArray(filters)) {
      return { success: false, error: "Invalid format: expected array" };
    }
    // Basic validation
    for (const f of filters) {
      if (!f.id || !f.name || !f.type) {
        return { success: false, error: "Invalid filter: missing required fields" };
      }
    }
    saveFilters(filters);
    return { success: true };
  } catch (e) {
    return { success: false, error: `Parse error: ${e}` };
  }
}

export function generateFilterId(): string {
  return `filter-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
