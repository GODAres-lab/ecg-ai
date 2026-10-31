import type { AnalysisHistoryItem } from '../types/ecg';
import { apiFetch, getAuthToken } from './authStorage';

const LOCAL_HISTORY_KEY = 'ai_ecg_analysis_history_v1';
const MAX_LOCAL_HISTORY = 25;

/**
 * Generates a compact, privacy-conscious thumbnail (max 360px wide, JPEG 0.65)
 * stored strictly in the user's local browser storage so past analyses remain
 * visually identifiable without ever storing patient images on the backend server.
 */
export async function createCompactThumbnail(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const maxWidth = 360;
          const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
          const w = Math.max(1, Math.round((img.naturalWidth || 360) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || 240) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(undefined);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        } catch {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = dataUrl;
    } catch {
      resolve(undefined);
    }
  });
}

export function loadLocalHistory(): AnalysisHistoryItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AnalysisHistoryItem =>
        Boolean(item && typeof item.id === 'string' && item.report)
    );
  } catch {
    return [];
  }
}

export function saveLocalHistory(items: AnalysisHistoryItem[]): void {
  const capped = items.slice(0, MAX_LOCAL_HISTORY);
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(capped));
  } catch {
    // If localStorage quota is tight, strip thumbnails from older entries and retry
    try {
      const slimmed = capped.map((item, idx) =>
        idx > 5 ? { ...item, thumbnailDataUrl: undefined } : item
      );
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(slimmed));
    } catch {
      // Ignore storage quota failure
    }
  }
}

export function prependLocalHistoryItem(newItem: AnalysisHistoryItem): AnalysisHistoryItem[] {
  const existing = loadLocalHistory().filter((item) => item.id !== newItem.id);
  const next = [newItem, ...existing].slice(0, MAX_LOCAL_HISTORY);
  saveLocalHistory(next);
  return next;
}

export function removeLocalHistoryItem(id: string): AnalysisHistoryItem[] {
  const next = loadLocalHistory().filter((item) => item.id !== id);
  saveLocalHistory(next);
  return next;
}

export function clearAllLocalHistory(): void {
  try {
    localStorage.removeItem(LOCAL_HISTORY_KEY);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Merges server-saved report history (for authenticated users) with local history
 * (preserving local compact thumbnails when IDs match).
 */
export async function syncHistoryWithServer(): Promise<AnalysisHistoryItem[]> {
  const local = loadLocalHistory();
  if (!getAuthToken()) {
    return local;
  }

  try {
    const res = await apiFetch('/api/user/history');
    if (!res.ok) return local;
    const data = await res.json();
    const serverItems: AnalysisHistoryItem[] = Array.isArray(data?.history) ? data.history : [];
    if (serverItems.length === 0) return local;

    const localMap = new Map(local.map((item) => [item.id, item]));
    const mergedMap = new Map<string, AnalysisHistoryItem>();

    for (const sItem of serverItems) {
      if (!sItem || !sItem.id || !sItem.report) continue;
      const matchingLocal = localMap.get(sItem.id);
      mergedMap.set(sItem.id, {
        ...sItem,
        thumbnailDataUrl: matchingLocal?.thumbnailDataUrl,
      });
    }

    for (const lItem of local) {
      if (!mergedMap.has(lItem.id)) {
        mergedMap.set(lItem.id, lItem);
      }
    }

    const merged = Array.from(mergedMap.values())
      .sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime())
      .slice(0, MAX_LOCAL_HISTORY);

    saveLocalHistory(merged);
    return merged;
  } catch {
    return local;
  }
}

