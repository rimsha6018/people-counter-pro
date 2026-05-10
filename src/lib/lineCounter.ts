// Stable line counter with per-track cooldown to prevent double-counting
// when a person hovers over the line.

import type { TrackedObject } from "./tracker";

export interface LineCounterResult {
  entered: { trackId: number; employeeId?: string | null }[];
  exited: { trackId: number; employeeId?: string | null }[];
}

const COOLDOWN_MS = 1500;

export class LineCounter {
  private prevY = new Map<number, number>();
  private lastCrossAt = new Map<number, number>();
  totalIn = 0;
  totalOut = 0;

  constructor(public lineY: number) {}

  setLine(y: number) {
    this.lineY = y;
  }

  update(tracks: TrackedObject[]): LineCounterResult {
    const result: LineCounterResult = { entered: [], exited: [] };
    const seen = new Set<number>();
    const now = Date.now();

    for (const t of tracks) {
      seen.add(t.id);
      const y = t.centroid[1];
      const prev = this.prevY.get(t.id);
      const lastCross = this.lastCrossAt.get(t.id) ?? 0;

      if (prev !== undefined && now - lastCross > COOLDOWN_MS) {
        if (prev < this.lineY && y >= this.lineY) {
          this.totalIn += 1;
          this.lastCrossAt.set(t.id, now);
          result.entered.push({ trackId: t.id, employeeId: t.employeeId ?? null });
        } else if (prev >= this.lineY && y < this.lineY) {
          this.totalOut += 1;
          this.lastCrossAt.set(t.id, now);
          result.exited.push({ trackId: t.id, employeeId: t.employeeId ?? null });
        }
      }
      this.prevY.set(t.id, y);
    }
    for (const id of Array.from(this.prevY.keys())) {
      if (!seen.has(id)) {
        this.prevY.delete(id);
        this.lastCrossAt.delete(id);
      }
    }
    return result;
  }

  reset() {
    this.prevY.clear();
    this.lastCrossAt.clear();
    this.totalIn = 0;
    this.totalOut = 0;
  }
}
