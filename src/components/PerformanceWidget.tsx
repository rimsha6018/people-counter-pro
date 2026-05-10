import { useEffect, useState } from "react";
import { Activity, Cpu, Gauge, Layers, X } from "lucide-react";
import * as tf from "@tensorflow/tfjs";
import { Button } from "@/components/ui/button";

interface Props {
  detectFps: number;
  inferenceMs: number;
  trackedCount: number;
}

function tone(fps: number) {
  if (fps >= 20) return "text-success";
  if (fps >= 10) return "text-warning";
  return "text-destructive";
}

export function PerformanceWidget({ detectFps, inferenceMs, trackedCount }: Props) {
  const [open, setOpen] = useState(true);
  const [renderFps, setRenderFps] = useState(0);
  const [backend, setBackend] = useState<string>("—");

  useEffect(() => {
    setBackend(tf.getBackend() || "loading");
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        setRenderFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="fixed bottom-4 right-4 z-40 gap-1.5 backdrop-blur"
        onClick={() => setOpen(true)}
      >
        <Activity className="h-3.5 w-3.5" /> Perf
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-60 rounded-xl border border-border/60 bg-background/85 p-3 font-mono text-[11px] shadow-xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-foreground">
          <Gauge className="h-3.5 w-3.5 text-primary" /> PERFORMANCE
        </span>
        <button
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Row label="Render FPS" value={`${renderFps}`} cls={tone(renderFps)} />
      <Row label="Detect FPS" value={`${detectFps}`} cls={tone(detectFps)} />
      <Row label="Inference" value={`${inferenceMs.toFixed(0)} ms`} />
      <Row label="Tracked" value={`${trackedCount}`} icon={<Layers className="h-3 w-3" />} />
      <Row label="TF Backend" value={backend.toUpperCase()} icon={<Cpu className="h-3 w-3" />} />
    </div>
  );
}

function Row({
  label,
  value,
  cls,
  icon,
}: {
  label: string;
  value: string;
  cls?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-muted-foreground">
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className={cls ?? "text-foreground"}>{value}</span>
    </div>
  );
}
