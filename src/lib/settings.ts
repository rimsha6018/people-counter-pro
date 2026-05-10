// Persistent AI/UI detection settings.

import { useEffect, useState } from "react";

export interface DetectionSettings {
  confidence: number; // 0-1
  intervalMs: number; // detection interval
  showBoxes: boolean;
  showLabels: boolean;
  showLine: boolean;
  showTrails: boolean;
  trackingPersistMs: number;
}

export const DEFAULT_SETTINGS: DetectionSettings = {
  confidence: 0.55,
  intervalMs: 250,
  showBoxes: true,
  showLabels: true,
  showLine: true,
  showTrails: false,
  trackingPersistMs: 2000,
};

const KEY = "sentinel.settings.v1";

export function loadSettings(): DetectionSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: DetectionSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

const listeners = new Set<(s: DetectionSettings) => void>();

export function useSettings(): [DetectionSettings, (patch: Partial<DetectionSettings>) => void] {
  const [s, setS] = useState<DetectionSettings>(() => loadSettings());

  useEffect(() => {
    const fn = (next: DetectionSettings) => setS(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const update = (patch: Partial<DetectionSettings>) => {
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      listeners.forEach((l) => l(next));
      return next;
    });
  };

  return [s, update];
}
