import { useEffect, useRef } from "react";
import type { TrackedObject } from "@/lib/tracker";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  tracks: TrackedObject[];
  lineY?: number; // in video pixel coords
  inCount?: number;
  outCount?: number;
}

export function DetectionOverlay({ videoRef, tracks, lineY, inCount, outCount }: Props) {
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

    // Virtual line
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
      const inText = `IN ${inCount ?? 0}`;
      const outText = `OUT ${outCount ?? 0}`;
      ctx.fillStyle = success;
      ctx.fillText(inText, 16, lineY - 10);
      ctx.fillStyle = danger;
      ctx.fillText(outText, 16, lineY + fontSize + 6);
    }

    tracks.forEach((t) => {
      const [x, y, w, h] = t.bbox;
      const isUnknown = t.recognized === false;
      const color = isUnknown ? danger : primary;
      const glow = isUnknown ? danger : primaryGlow;

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

      const fontSize = Math.max(12, vw / 60);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      const label = t.employeeName
        ? `#${t.id} ${t.employeeName}`
        : isUnknown
          ? `#${t.id} Unknown`
          : `#${t.id} Person`;
      const padding = fontSize * 0.4;
      const metrics = ctx.measureText(label);
      const textW = metrics.width + padding * 2;
      const textH = fontSize + padding * 1.2;

      ctx.fillStyle = color;
      ctx.fillRect(x, Math.max(0, y - textH), textW, textH);
      ctx.fillStyle = isUnknown ? "white" : "hsl(222 47% 8%)";
      ctx.fillText(label, x + padding, Math.max(fontSize, y - padding));
    });
  }, [tracks, videoRef, lineY, inCount, outCount]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
