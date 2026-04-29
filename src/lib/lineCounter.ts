// Tracks line crossings for entry/exit counting.
// Line is defined as a horizontal y-position (in video pixel coords).
// Direction: a track crossing from y < line to y >= line counts as "in"; reverse = "out".

import type { TrackedObject } from "./tracker";

export interface LineCounterResult {
  entered: { trackId: number; employeeId?: string | null }[];
  exited: { trackId: number; employeeId?: string | null }[];
}

export class LineCounter {
  private prevY = new Map<number, number>();
  totalIn = 0;
  totalOut = 0;

  constructor(public lineY: number) {}

  setLine(y: number) {
    this.lineY = y;
  }

  update(tracks: TrackedObject[]): LineCounterResult {
    const result: LineCounterResult = { entered: [], exited: [] };
    const seen = new Set<number>();

    for (const t of tracks) {
      seen.add(t.id);
      const y = t.centroid[1];
      const prev = this.prevY.get(t.id);
      if (prev !== undefined) {
        if (prev < this.lineY && y >= this.lineY) {
          this.totalIn += 1;
          result.entered.push({ trackId: t.id, employeeId: t.employeeId ?? null });
        } else if (prev >= this.lineY && y < this.lineY) {
          this.totalOut += 1;
          result.exited.push({ trackId: t.id, employeeId: t.employeeId ?? null });
        }
      }
      this.prevY.set(t.id, y);
    }
    // Garbage collect lost tracks
    for (const id of Array.from(this.prevY.keys())) {
      if (!seen.has(id)) this.prevY.delete(id);
    }
    return result;
  }

  reset() {
    this.prevY.clear();
    this.totalIn = 0;
    this.totalOut = 0;
  }
}
