// Simple centroid-based multi-object tracker.
// Assigns stable integer IDs to detections across frames.

import type { Detection } from "@/hooks/usePersonDetector";

export interface TrackedObject {
  id: number;
  bbox: [number, number, number, number]; // x,y,w,h
  centroid: [number, number];
  score: number;
  missing: number;
  // recognition
  employeeId?: string | null;
  employeeName?: string | null;
  recognized?: boolean; // true=known, false=unknown, undefined=not yet evaluated
}

export class CentroidTracker {
  private nextId = 1;
  private tracks = new Map<number, TrackedObject>();
  private maxMissing: number;
  private maxDistance: number;

  constructor(maxMissing = 15, maxDistance = 120) {
    this.maxMissing = maxMissing;
    this.maxDistance = maxDistance;
  }

  update(detections: Detection[]): TrackedObject[] {
    const inputs = detections.map((d) => {
      const [x, y, w, h] = d.bbox;
      return {
        bbox: d.bbox,
        score: d.score,
        centroid: [x + w / 2, y + h / 2] as [number, number],
      };
    });

    const trackIds = Array.from(this.tracks.keys());

    if (trackIds.length === 0) {
      // Register all as new
      for (const inp of inputs) this.register(inp);
    } else if (inputs.length === 0) {
      // No detections — increment missing
      for (const id of trackIds) {
        const t = this.tracks.get(id)!;
        t.missing += 1;
        if (t.missing > this.maxMissing) this.tracks.delete(id);
      }
    } else {
      // Greedy nearest-neighbor matching
      const used = new Set<number>();
      const matched = new Set<number>();

      // Build distance pairs
      const pairs: { tId: number; iIdx: number; dist: number }[] = [];
      for (const tId of trackIds) {
        const t = this.tracks.get(tId)!;
        inputs.forEach((inp, idx) => {
          const dx = t.centroid[0] - inp.centroid[0];
          const dy = t.centroid[1] - inp.centroid[1];
          pairs.push({ tId, iIdx: idx, dist: Math.hypot(dx, dy) });
        });
      }
      pairs.sort((a, b) => a.dist - b.dist);

      for (const p of pairs) {
        if (p.dist > this.maxDistance) break;
        if (used.has(p.iIdx) || matched.has(p.tId)) continue;
        used.add(p.iIdx);
        matched.add(p.tId);
        const t = this.tracks.get(p.tId)!;
        const inp = inputs[p.iIdx];
        t.bbox = inp.bbox;
        t.centroid = inp.centroid;
        t.score = inp.score;
        t.missing = 0;
      }

      // Unmatched tracks
      for (const tId of trackIds) {
        if (!matched.has(tId)) {
          const t = this.tracks.get(tId)!;
          t.missing += 1;
          if (t.missing > this.maxMissing) this.tracks.delete(tId);
        }
      }

      // Unmatched detections -> register
      inputs.forEach((inp, idx) => {
        if (!used.has(idx)) this.register(inp);
      });
    }

    return Array.from(this.tracks.values());
  }

  private register(inp: { bbox: [number, number, number, number]; centroid: [number, number]; score: number }) {
    const id = this.nextId++;
    this.tracks.set(id, {
      id,
      bbox: inp.bbox,
      centroid: inp.centroid,
      score: inp.score,
      missing: 0,
    });
  }

  // Allow external recognition results to be attached
  setRecognition(id: number, employeeId: string | null, employeeName: string | null) {
    const t = this.tracks.get(id);
    if (!t) return;
    t.employeeId = employeeId;
    t.employeeName = employeeName;
    t.recognized = !!employeeId;
  }

  getTrack(id: number) {
    return this.tracks.get(id);
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
  }
}
