import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Camera, CameraOff, Download, FileVideo, Loader2, Play, Square, Upload, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { usePersonDetector, type DetectionFrame } from "@/hooks/usePersonDetector";
import { DetectionOverlay } from "@/components/DetectionOverlay";
import { CountChart } from "@/components/CountChart";
import { exportLogsToCsv, type LogEntry } from "@/lib/exportLogs";

type Source = "webcam" | "video";

const MAX_TREND_POINTS = 60;
const MAX_LOG_ENTRIES = 200;

const Dashboard = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastLoggedCountRef = useRef<number | null>(null);
  const lastAlertRef = useRef<number>(0);

  const [source, setSource] = useState<Source>("webcam");
  const [active, setActive] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ t: number; count: number }[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [peakCount, setPeakCount] = useState(0);
  const [totalDetections, setTotalDetections] = useState(0);

  const handleFrame = useCallback(
    (frame: DetectionFrame) => {
      // Update trend (rolling window)
      setTrend((prev) => {
        const next = [...prev, { t: frame.timestamp, count: frame.count }];
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next;
      });

      setPeakCount((p) => Math.max(p, frame.count));
      setTotalDetections((c) => c + frame.count);

      // Log only when count changes
      if (lastLoggedCountRef.current !== frame.count) {
        lastLoggedCountRef.current = frame.count;
        setLogs((prev) => {
          const entry: LogEntry = {
            id: `${frame.timestamp}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: frame.timestamp,
            count: frame.count,
            source,
          };
          const next = [entry, ...prev];
          return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
        });
      }

      // Alert if no employees detected for sustained period
      if (frame.count === 0 && Date.now() - lastAlertRef.current > 15000) {
        lastAlertRef.current = Date.now();
        toast.warning("No employees detected", {
          description: "The monitored area appears empty.",
        });
      }
    },
    [source]
  );

  const { loading: modelLoading, currentFrame, modelReady } = usePersonDetector({
    videoRef,
    enabled: active && videoReady,
    onFrame: handleFrame,
    intervalMs: 250,
  });

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
      if (v.src) {
        URL.revokeObjectURL(v.src);
        v.removeAttribute("src");
        v.load();
      }
    }
    setVideoReady(false);
  }, []);

  const startWebcam = useCallback(async () => {
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();
      setVideoReady(true);
      setActive(true);
      setSource("webcam");
      toast.success("Camera activated", { description: "Live detection started." });
    } catch (e) {
      console.error(e);
      toast.error("Camera access denied", {
        description: "Please grant camera permission and try again.",
      });
    }
  }, [stopStream]);

  const startVideoFile = useCallback(
    async (file: File) => {
      try {
        stopStream();
        const url = URL.createObjectURL(file);
        const v = videoRef.current;
        if (!v) return;
        v.src = url;
        v.loop = true;
        await v.play();
        setVideoFileName(file.name);
        setVideoReady(true);
        setActive(true);
        setSource("video");
        toast.success("Video loaded", { description: file.name });
      } catch (e) {
        console.error(e);
        toast.error("Failed to play video");
      }
    },
    [stopStream]
  );

  const handleStop = useCallback(() => {
    setActive(false);
    stopStream();
    toast.info("Detection stopped");
  }, [stopStream]);

  const handleReset = useCallback(() => {
    setTrend([]);
    setLogs([]);
    setPeakCount(0);
    setTotalDetections(0);
    lastLoggedCountRef.current = null;
    toast.success("Session metrics cleared");
  }, []);

  useEffect(() => {
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avgCount = useMemo(() => {
    if (!trend.length) return 0;
    return Math.round((trend.reduce((s, p) => s + p.count, 0) / trend.length) * 10) / 10;
  }, [trend]);

  const status = !modelReady
    ? { label: "Loading model", tone: "warning" as const }
    : active && videoReady
      ? { label: "Active", tone: "success" as const }
      : { label: "Inactive", tone: "muted" as const };

  return (
    <div className="min-h-screen bg-background">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 glow-bg" aria-hidden />

      {/* Header */}
      <header className="relative border-b border-border bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/40">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-glow">
              <Users className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">SentinelCount</h1>
              <p className="text-xs text-muted-foreground">AI Employee Detection & Counting</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusPill tone={status.tone} label={status.label} pulsing={status.tone === "success"} />
            <Badge variant="outline" className="hidden gap-1 font-mono text-xs sm:inline-flex">
              <Zap className="h-3 w-3" /> COCO-SSD · on-device
            </Badge>
          </div>
        </div>
      </header>

      <main className="container relative space-y-6 py-6">
        {/* Stats row */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Live Count"
            value={currentFrame.count}
            highlight
          />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Peak" value={peakCount} />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Average" value={avgCount} />
          <StatCard icon={<Activity className="h-5 w-5" />} label="Total Detections" value={totalDetections} />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Video panel */}
          <Card className="relative overflow-hidden border-border/60 bg-card shadow-card-soft lg:col-span-2">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Live Feed</h2>
                {videoFileName && source === "video" && (
                  <Badge variant="secondary" className="ml-1 max-w-[180px] truncate text-xs">
                    {videoFileName}
                  </Badge>
                )}
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {source === "webcam" ? "WEBCAM" : "VIDEO FILE"}
              </span>
            </div>

            <div className="relative aspect-video w-full bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-contain"
                playsInline
                muted
                autoPlay
              />
              {videoReady && (
                <DetectionOverlay videoRef={videoRef} detections={currentFrame.detections} />
              )}

              {/* Scan line */}
              {active && videoReady && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/70 shadow-[0_0_12px_2px_hsl(var(--primary-glow))] animate-scan" />
              )}

              {/* Idle state */}
              {!videoReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                  {modelLoading ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm">Loading detection model…</p>
                    </>
                  ) : (
                    <>
                      <CameraOff className="h-10 w-10" />
                      <p className="text-sm">Start the camera or upload a video to begin</p>
                    </>
                  )}
                </div>
              )}

              {/* Live count overlay */}
              {videoReady && (
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-primary/40 bg-background/70 px-3 py-1.5 backdrop-blur">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                  <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Detected
                  </span>
                  <span className="font-mono text-base font-bold text-primary">
                    {currentFrame.count}
                  </span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-3">
              {!active ? (
                <Button onClick={startWebcam} disabled={!modelReady} className="gap-2">
                  <Play className="h-4 w-4" /> Start Camera
                </Button>
              ) : (
                <Button onClick={handleStop} variant="destructive" className="gap-2">
                  <Square className="h-4 w-4" /> Stop Detection
                </Button>
              )}

              <Button
                variant="secondary"
                disabled={!modelReady}
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" /> Upload Video
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) startVideoFile(f);
                  e.target.value = "";
                }}
              />

              <Separator orientation="vertical" className="mx-1 h-6" />

              <Button variant="ghost" onClick={handleReset} className="gap-2">
                Reset Metrics
              </Button>

              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <FileVideo className="h-3.5 w-3.5" />
                <span>Runs entirely on your device</span>
              </div>
            </div>
          </Card>

          {/* Side panel: chart + logs */}
          <div className="space-y-6">
            <Card className="border-border/60 bg-card p-5 shadow-card-soft">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Count Trend</h2>
                <Badge variant="outline" className="font-mono text-[10px]">
                  last {trend.length}
                </Badge>
              </div>
              {trend.length > 1 ? (
                <CountChart data={trend} />
              ) : (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  No data yet
                </div>
              )}
            </Card>

            <Card className="border-border/60 bg-card shadow-card-soft">
              <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
                <h2 className="text-sm font-semibold">Detection Log</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!logs.length}
                  onClick={() => exportLogsToCsv(logs)}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>
              <ScrollArea className="h-72">
                {logs.length === 0 ? (
                  <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                    Log entries will appear here
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {logs.map((l) => (
                      <li key={l.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                        <div className="flex items-center gap-2">
                          {l.count === 0 ? (
                            <AlertTriangle className="h-4 w-4 text-warning" />
                          ) : (
                            <Users className="h-4 w-4 text-primary" />
                          )}
                          <span className="font-mono">
                            {l.count} {l.count === 1 ? "person" : "people"}
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {l.source}
                          </Badge>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(l.timestamp).toLocaleTimeString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </Card>
          </div>
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          On-device person detection · TensorFlow.js · COCO-SSD · No video leaves your browser
        </footer>
      </main>
    </div>
  );
};

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Card
      className={
        "relative overflow-hidden border-border/60 bg-card p-5 shadow-card-soft " +
        (highlight ? "ring-1 ring-primary/40" : "")
      }
    >
      {highlight && <div className="absolute inset-0 gradient-primary opacity-[0.06]" aria-hidden />}
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={"mt-1 font-mono text-3xl font-bold " + (highlight ? "text-gradient" : "")}>
            {value}
          </p>
        </div>
        <div
          className={
            "flex h-10 w-10 items-center justify-center rounded-lg " +
            (highlight ? "gradient-primary text-primary-foreground" : "bg-secondary text-primary")
          }
        >
          {icon}
        </div>
      </div>
    </Card>
  );
}

function StatusPill({
  tone,
  label,
  pulsing,
}: {
  tone: "success" | "warning" | "muted";
  label: string;
  pulsing?: boolean;
}) {
  const colors =
    tone === "success"
      ? "bg-success/15 text-success border-success/30"
      : tone === "warning"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-muted text-muted-foreground border-border";
  const dot =
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-muted-foreground";
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${colors}`}>
      <span className={`h-2 w-2 rounded-full ${dot} ${pulsing ? "animate-pulse-ring" : ""}`} />
      {label}
    </div>
  );
}

export default Dashboard;
