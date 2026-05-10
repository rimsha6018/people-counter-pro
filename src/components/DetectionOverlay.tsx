import { useEffect, useRef } from "react";
import type { TrackedObject } from "@/lib/tracker";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  tracks: TrackedObject[];
  lineY?: number;
  inCount?: number;
  outCount?: number;
  showBoxes?: boolean;
  showLabels?: boolean;
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function DetectionOverlay({
  videoRef,
  tracks,
  lineY,
  inCount,
  outCount,
  showBoxes = true,
  showLabels = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth || video.clientWidth;
    const vh = video.videoHeight || video.clientHeight;
    if (!vw || !vh) return;

    canvas.width = vw;
    canvas.height = vh;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const root = getComputedStyle(document.documentElement);
    const primary = `hsl(${root.getPropertyValue("--primary").trim()})`;
    const primaryGlow = `hsl(${root.getPropertyValue("--primary-glow").trim()})`;
    const danger = `hsl(${root.getPropertyValue("--destructive").trim()})`;
    const success = `hsl(${root.getPropertyValue("--success").trim()})`;

    if (typeof lineY === "number") {
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = `hsl(${root.getPropertyValue("--accent").trim()})`;
      ctx.lineWidth = Math.max(2, vw / 500);
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(vw, lineY);
      ctx.stroke();
      ctx.restore();

      const fontSize = Math.max(14, vw / 55);
      ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = success;
      ctx.fillText(`IN ${inCount ?? 0}`, 16, lineY - 10);
      ctx.fillStyle = danger;
      ctx.fillText(`OUT ${outCount ?? 0}`, 16, lineY + fontSize + 6);
    }

    if (!showBoxes && !showLabels) return;

    const now = Date.now();
    tracks.forEach((t) => {
      const [x, y, w, h] = t.bbox;
      const isUnknown = t.recognized === false;
      const color = isUnknown ? danger : primary;
      const glow = isUnknown ? danger : primaryGlow;

      if (showBoxes) {
        ctx.lineWidth = Math.max(2, vw / 400);
        ctx.strokeStyle = color;
        ctx.shadowColor = glow;
        ctx.shadowBlur = 12;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;

        const cornerLen = Math.min(w, h) * 0.18;
        ctx.lineWidth = Math.max(3, vw / 300);
        ctx.strokeStyle = glow;
        const cs: [number, number, number, number][] = [
          [x, y, x + cornerLen, y],
          [x, y, x, y + cornerLen],
          [x + w, y, x + w - cornerLen, y],
          [x + w, y, x + w, y + cornerLen],
          [x, y + h, x + cornerLen, y + h],
          [x, y + h, x, y + h - cornerLen],
          [x + w, y + h, x + w - cornerLen, y + h],
          [x + w, y + h, x + w, y + h - cornerLen],
        ];
        cs.forEach(([x1, y1, x2, y2]) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });
      }

      if (!showLabels) return;

      const fontSize = Math.max(12, vw / 60);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      const baseLabel = t.employeeName
        ? `${t.employeeName}`
        : isUnknown
          ? `Unknown`
          : `Employee #${t.id}`;
      const subLabel = `#${t.id} · ${(t.score * 100).toFixed(0)}% · ${fmtDuration(now - t.firstSeenAt)}`;

      const padding = fontSize * 0.4;
      const m1 = ctx.measureText(baseLabel);
      const m2Font = `400 ${Math.round(fontSize * 0.7)}px Inter, system-ui, sans-serif`;
      ctx.font = m2Font;
      const m2 = ctx.measureText(subLabel);
      const textW = Math.max(m1.width, m2.width) + padding * 2;
      const lineH = fontSize + Math.round(fontSize * 0.7) + padding * 1.6;

      // Pill background
      ctx.fillStyle = color;
      const radius = Math.min(8, fontSize * 0.5);
      const ly = Math.max(0, y - lineH);
      roundRect(ctx, x, ly, textW, lineH, radius);
      ctx.fill();

      ctx.fillStyle = isUnknown ? "white" : "hsl(222 47% 8%)";
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillText(baseLabel, x + padding, ly + fontSize + padding * 0.2);
      ctx.font = m2Font;
      ctx.fillText(subLabel, x + padding, ly + fontSize + padding * 0.2 + Math.round(fontSize * 0.8));
    });
  }, [tracks, videoRef, lineY, inCount, outCount, showBoxes, showLabels]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
