import { useEffect, useRef } from "react";
import type { Detection } from "@/hooks/usePersonDetector";

interface DetectionOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  detections: Detection[];
}

export function DetectionOverlay({ videoRef, detections }: DetectionOverlayProps) {
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

    // Read primary color from CSS variable
    const root = getComputedStyle(document.documentElement);
    const primary = `hsl(${root.getPropertyValue("--primary").trim()})`;
    const primaryGlow = `hsl(${root.getPropertyValue("--primary-glow").trim()})`;

    detections.forEach((d) => {
      const [x, y, w, h] = d.bbox;

      // Box
      ctx.lineWidth = Math.max(2, vw / 400);
      ctx.strokeStyle = primary;
      ctx.shadowColor = primaryGlow;
      ctx.shadowBlur = 12;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;

      // Corner accents
      const cornerLen = Math.min(w, h) * 0.18;
      ctx.lineWidth = Math.max(3, vw / 300);
      ctx.strokeStyle = primaryGlow;
      const corners: [number, number, number, number][] = [
        [x, y, x + cornerLen, y],
        [x, y, x, y + cornerLen],
        [x + w, y, x + w - cornerLen, y],
        [x + w, y, x + w, y + cornerLen],
        [x, y + h, x + cornerLen, y + h],
        [x, y + h, x, y + h - cornerLen],
        [x + w, y + h, x + w - cornerLen, y + h],
        [x + w, y + h, x + w, y + h - cornerLen],
      ];
      corners.forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Label
      const fontSize = Math.max(12, vw / 60);
      ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
      const text = `${d.label}  ${(d.score * 100).toFixed(0)}%`;
      const padding = fontSize * 0.4;
      const metrics = ctx.measureText(text);
      const textW = metrics.width + padding * 2;
      const textH = fontSize + padding * 1.2;

      ctx.fillStyle = primary;
      ctx.fillRect(x, Math.max(0, y - textH), textW, textH);
      ctx.fillStyle = "hsl(222 47% 8%)";
      ctx.fillText(text, x + padding, Math.max(fontSize, y - padding));
    });
  }, [detections, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
