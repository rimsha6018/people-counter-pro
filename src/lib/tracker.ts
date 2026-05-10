// Hybrid IoU + centroid tracker with bbox smoothing, persistent IDs,
// and recognition memory. Designed for stable real-time labels.

import type { Detection } from "@/hooks/usePersonDetector";

export interface TrackedObject {
  id: number;
  bbox: [number, number, number, number]; // smoothed x,y,w,h
  rawBbox: [number, number, number, number];
  centroid: [number, number];
  score: number;
  missing: number;
  hits: number;
  firstSeenAt: number; // ms epoch
  lastSeenAt: number;
  // recognition
  employeeId?: string | null;
  employeeName?: string | null;
  recognized?: boolean;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpBox(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

export class CentroidTracker {
  private nextId = 1;
  private tracks = new Map<number, TrackedObject>();
  private maxMissing: number;
  private maxDistance: number;
  private iouThreshold = 0.2;
  private smoothing = 0.55; // 0=no smoothing, 1=ignore new

  constructor(maxMissing = 20, maxDistance = 150) {
    this.maxMissing = maxMissing;
    this.maxDistance = maxDistance;
  }

  update(detections: Detection[]): TrackedObject[] {
    const now = Date.now();
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
      for (const inp of inputs) this.register(inp, now);
    } else if (inputs.length === 0) {
      for (const id of trackIds) {
        const t = this.tracks.get(id)!;
        t.missing += 1;
        if (t.missing > this.maxMissing) this.tracks.delete(id);
      }
    } else {
      // Build candidate pairs scored by IoU (preferred) and centroid distance
      const pairs: { tId: number; iIdx: number; iouScore: number; dist: number }[] = [];
      for (const tId of trackIds) {
        const t = this.tracks.get(tId)!;
        inputs.forEach((inp, idx) => {
          const dx = t.centroid[0] - inp.centroid[0];
          const dy = t.centroid[1] - inp.centroid[1];
          pairs.push({
            tId,
            iIdx: idx,
            iouScore: iou(t.rawBbox, inp.bbox),
            dist: Math.hypot(dx, dy),
          });
        });
      }
      // Prefer high IoU, fall back to distance
      pairs.sort((a, b) => {
        if (b.iouScore !== a.iouScore) return b.iouScore - a.iouScore;
        return a.dist - b.dist;
      });

      const usedI = new Set<number>();
      const matched = new Set<number>();
      for (const p of pairs) {
        if (usedI.has(p.iIdx) || matched.has(p.tId)) continue;
        if (p.iouScore < this.iouThreshold && p.dist > this.maxDistance) continue;
        usedI.add(p.iIdx);
        matched.add(p.tId);
        const t = this.tracks.get(p.tId)!;
        const inp = inputs[p.iIdx];
        t.rawBbox = inp.bbox;
        t.bbox = lerpBox(t.bbox, inp.bbox, 1 - this.smoothing);
        t.centroid = [
          t.bbox[0] + t.bbox[2] / 2,
          t.bbox[1] + t.bbox[3] / 2,
        ];
        t.score = inp.score;
        t.missing = 0;
        t.hits += 1;
        t.lastSeenAt = now;
      }

      for (const tId of trackIds) {
        if (!matched.has(tId)) {
          const t = this.tracks.get(tId)!;
          t.missing += 1;
          if (t.missing > this.maxMissing) this.tracks.delete(tId);
        }
      }

      inputs.forEach((inp, idx) => {
        if (!usedI.has(idx)) this.register(inp, now);
      });
    }

    return Array.from(this.tracks.values());
  }

  private register(
    inp: { bbox: [number, number, number, number]; centroid: [number, number]; score: number },
    now: number,
  ) {
    const id = this.nextId++;
    this.tracks.set(id, {
      id,
      bbox: inp.bbox,
      rawBbox: inp.bbox,
      centroid: inp.centroid,
      score: inp.score,
      missing: 0,
      hits: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  setRecognition(id: number, employeeId: string | null, employeeName: string | null) {
    const t = this.tracks.get(id);
    if (!t) return;
    // Sticky recognition: don't downgrade a known track to unknown.
    if (employeeId) {
      t.employeeId = employeeId;
      t.employeeName = employeeName;
      t.recognized = true;
    } else if (!t.employeeId) {
      t.recognized = false;
    }
  }

  getTrack(id: number) {
    return this.tracks.get(id);
  }

  reset() {
    this.tracks.clear();
    this.nextId = 1;
  }
}
