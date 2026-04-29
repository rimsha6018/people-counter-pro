import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  CameraOff,
  Loader2,
  Play,
  Square,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { usePersonDetector, type DetectionFrame } from "@/hooks/usePersonDetector";
import { DetectionOverlay } from "@/components/DetectionOverlay";
import { CountChart } from "@/components/CountChart";
import { CentroidTracker, type TrackedObject } from "@/lib/tracker";
import { LineCounter } from "@/lib/lineCounter";
import {
  buildMatcher,
  detectFaces,
  faceapi,
  loadFaceModels,
  type StoredEmployee,
} from "@/lib/faceRecognition";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Source = "webcam" | "video";
const MAX_TREND_POINTS = 60;

export default function Dashboard() {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastAlertRef = useRef<number>(0);
  const lastDbLogRef = useRef<number>(0);
  const lastFaceRunRef = useRef<number>(0);
  const trackerRef = useRef(new CentroidTracker(15, 140));
  const lineCounterRef = useRef(new LineCounter(0));
  const employeesRef = useRef<StoredEmployee[]>([]);
  const matcherRef = useRef<faceapi.FaceMatcher | null>(null);
  const facesReadyRef = useRef(false);

  const [source, setSource] = useState<Source>("webcam");
  const [active, setActive] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ t: number; count: number }[]>([]);
  const [tracks, setTracks] = useState<TrackedObject[]>([]);
  const [peakCount, setPeakCount] = useState(0);
  const [inCount, setInCount] = useState(0);
  const [outCount, setOutCount] = useState(0);
  const [linePos, setLinePos] = useState(50); // percentage
  const [maxOccupancy, setMaxOccupancy] = useState(10);
  const [facesLoading, setFacesLoading] = useState(true);

  // Load face models + employees
  useEffect(() => {
    (async () => {
      try {
        await loadFaceModels();
        facesReadyRef.current = true;
      } catch (e) {
        console.error("Face models failed", e);
      } finally {
        setFacesLoading(false);
      }
    })();
  }, []);

  const loadEmployees = useCallback(async () => {
    const { data, error } = await supabase.from("employees").select("id, name, face_descriptors");
    if (error) {
      console.error(error);
      return;
    }
    employeesRef.current = (data ?? []).map((e: any) => ({
      id: e.id,
      name: e.name,
      descriptors: Array.isArray(e.face_descriptors) ? e.face_descriptors : [],
    }));
    matcherRef.current = buildMatcher(employeesRef.current);
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const videoLineY = useCallback(() => {
    const v = videoRef.current;
    if (!v?.videoHeight) return 0;
    return (v.videoHeight * linePos) / 100;
  }, [linePos]);

  const handleFrame = useCallback(
    async (frame: DetectionFrame) => {
      // Update tracker
      const updated = trackerRef.current.update(frame.detections);

      // Update line crossings
      lineCounterRef.current.setLine(videoLineY());
      const crossings = lineCounterRef.current.update(updated);
      if (crossings.entered.length || crossings.exited.length) {
        setInCount(lineCounterRef.current.totalIn);
        setOutCount(lineCounterRef.current.totalOut);

        // Persist events
        if (user) {
          const rows = [
            ...crossings.entered.map((c) => ({
              user_id: user.id,
              direction: "in",
              employee_id: c.employeeId ?? null,
              track_id: c.trackId,
            })),
            ...crossings.exited.map((c) => ({
              user_id: user.id,
              direction: "out",
              employee_id: c.employeeId ?? null,
              track_id: c.trackId,
            })),
          ];
          if (rows.length) supabase.from("entry_exit_events").insert(rows).then();
        }
      }

      // Trend + stats
      setTrend((prev) => {
        const next = [...prev, { t: frame.timestamp, count: frame.count }];
        return next.length > MAX_TREND_POINTS ? next.slice(-MAX_TREND_POINTS) : next;
      });
      setPeakCount((p) => Math.max(p, frame.count));
      setTracks(updated);

      // Face recognition (throttled to ~1s)
      const v = videoRef.current;
      if (
        v &&
        facesReadyRef.current &&
        matcherRef.current &&
        performance.now() - lastFaceRunRef.current > 1000
      ) {
        lastFaceRunRef.current = performance.now();
        try {
          const results = await detectFaces(v);
          for (const r of results) {
            const box = r.detection.box; // x,y,w,h
            const fcx = box.x + box.width / 2;
            const fcy = box.y + box.height / 2;
            // Find track containing this face center
            const containing = updated.find(
              (t) =>
                fcx >= t.bbox[0] &&
                fcx <= t.bbox[0] + t.bbox[2] &&
                fcy >= t.bbox[1] &&
                fcy <= t.bbox[1] + t.bbox[3],
            );
            if (!containing) continue;
            const match = matcherRef.current.findBestMatch(r.descriptor);
            if (match.label === "unknown") {
              trackerRef.current.setRecognition(containing.id, null, null);
            } else {
              const emp = employeesRef.current.find((e) => e.id === match.label);
              trackerRef.current.setRecognition(
                containing.id,
                match.label,
                emp?.name ?? "Employee",
              );
            }
          }
          setTracks(Array.from(trackerRef.current["tracks"].values()));
        } catch (err) {
          // ignore single-frame face errors
        }
      }

      // DB logging once per ~5s
      if (user && Date.now() - lastDbLogRef.current > 5000) {
        lastDbLogRef.current = Date.now();
        const recognized = updated
          .filter((t) => t.employeeId)
          .map((t) => t.employeeId as string);
        supabase
          .from("detection_logs")
          .insert({
            user_id: user.id,
            count: frame.count,
            source,
            recognized_employee_ids: recognized,
          })
          .then();
      }

      // Alerts
      if (frame.count > maxOccupancy && Date.now() - lastAlertRef.current > 10000) {
        lastAlertRef.current = Date.now();
        toast.warning(`Occupancy exceeded (${frame.count}/${maxOccupancy})`);
        if (user) {
          supabase
            .from("alerts")
            .insert({
              user_id: user.id,
              type: "occupancy_exceeded",
              message: `${frame.count} people detected (limit ${maxOccupancy})`,
              severity: "warning",
            })
            .then();
        }
      }
      const unknownCount = updated.filter((t) => t.recognized === false).length;
      if (unknownCount > 0 && Date.now() - lastAlertRef.current > 8000) {
        lastAlertRef.current = Date.now();
        toast.error(`${unknownCount} unknown person${unknownCount > 1 ? "s" : ""} detected`);
        if (user) {
          supabase
            .from("alerts")
            .insert({
              user_id: user.id,
              type: "unknown_person",
              message: `${unknownCount} unrecognized person(s) on camera`,
              severity: "critical",
            })
            .then();
        }
      }
    },
    [source, user, maxOccupancy, videoLineY],
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
      toast.success("Camera activated");
    } catch (e) {
      toast.error("Camera access denied");
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
      } catch {
        toast.error("Failed to play video");
      }
    },
    [stopStream],
  );

  const handleStop = useCallback(() => {
    setActive(false);
    stopStream();
  }, [stopStream]);

  const handleResetMetrics = useCallback(() => {
    setTrend([]);
    setPeakCount(0);
    trackerRef.current.reset();
    lineCounterRef.current.reset();
    setInCount(0);
    setOutCount(0);
    setTracks([]);
    toast.success("Metrics reset");
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const avgCount = useMemo(() => {
    if (!trend.length) return 0;
    return Math.round((trend.reduce((s, p) => s + p.count, 0) / trend.length) * 10) / 10;
  }, [trend]);

  const recognizedNames = useMemo(
    () => Array.from(new Set(tracks.filter((t) => t.employeeName).map((t) => t.employeeName!))),
    [tracks],
  );
  const unknownTracks = tracks.filter((t) => t.recognized === false).length;

  const status =
    !modelReady || facesLoading
      ? { label: "Loading models", tone: "warning" as const }
      : active && videoReady
        ? { label: "Active", tone: "success" as const }
        : { label: "Inactive", tone: "muted" as const };

  return (
    <div className="container space-y-6 py-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Detection · Tracking · Face Recognition · Entry/Exit
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={status.tone} label={status.label} pulsing={status.tone === "success"} />
          <Badge variant="outline" className="hidden gap-1 font-mono text-xs sm:inline-flex">
            <Zap className="h-3 w-3" /> COCO-SSD + face-api
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={<Users className="h-5 w-5" />} label="Live" value={currentFrame.count} highlight />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Peak" value={peakCount} />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Average" value={avgCount} />
        <StatCard icon={<ArrowDownToLine className="h-5 w-5" />} label="Entered" value={inCount} tone="success" />
        <StatCard icon={<ArrowUpFromLine className="h-5 w-5" />} label="Exited" value={outCount} tone="danger" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Video */}
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
              <DetectionOverlay
                videoRef={videoRef}
                tracks={tracks}
                lineY={videoLineY()}
                inCount={inCount}
                outCount={outCount}
              />
            )}
            {active && videoReady && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/70 shadow-[0_0_12px_2px_hsl(var(--primary-glow))] animate-scan" />
            )}
            {!videoReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                {modelLoading || facesLoading ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm">Loading AI models…</p>
                  </>
                ) : (
                  <>
                    <CameraOff className="h-10 w-10" />
                    <p className="text-sm">Start the camera or upload a video</p>
                  </>
                )}
              </div>
            )}
            {videoReady && (
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-primary/40 bg-background/70 px-3 py-1.5 backdrop-blur">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Detected</span>
                <span className="font-mono text-base font-bold text-primary">{currentFrame.count}</span>
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
                <Square className="h-4 w-4" /> Stop
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
            <Button variant="ghost" onClick={handleResetMetrics}>Reset</Button>
            <Button variant="ghost" onClick={loadEmployees}>Refresh employees</Button>
          </div>
        </Card>

        {/* Side panel */}
        <div className="space-y-6">
          <Card className="border-border/60 bg-card p-5 shadow-card-soft">
            <h2 className="mb-3 text-sm font-semibold">Settings</h2>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Virtual line position ({linePos}%)</Label>
                <Slider
                  value={[linePos]}
                  onValueChange={(v) => setLinePos(v[0])}
                  min={10}
                  max={90}
                  step={1}
                  className="mt-2"
                />
              </div>
              <div>
                <Label className="text-xs">Max occupancy alert</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxOccupancy}
                  onChange={(e) => setMaxOccupancy(Math.max(1, parseInt(e.target.value || "1")))}
                  className="mt-2"
                />
              </div>
            </div>
          </Card>

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
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No data yet
              </div>
            )}
          </Card>

          <Card className="border-border/60 bg-card p-5 shadow-card-soft">
            <h2 className="mb-3 text-sm font-semibold">On Camera</h2>
            {tracks.length === 0 ? (
              <p className="text-xs text-muted-foreground">No one detected</p>
            ) : (
              <div className="space-y-2">
                {recognizedNames.map((n) => (
                  <div key={n} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                    <span className="font-medium">{n}</span>
                    <Badge variant="default" className="text-[10px]">Recognized</Badge>
                  </div>
                ))}
                {unknownTracks > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-destructive/15 px-3 py-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      {unknownTracks} Unknown
                    </span>
                    <Badge variant="destructive" className="text-[10px]">Alert</Badge>
                  </div>
                )}
                {tracks.length > recognizedNames.length + unknownTracks && (
                  <p className="text-xs text-muted-foreground">
                    {tracks.length - recognizedNames.length - unknownTracks} unidentified (no face seen yet)
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  highlight?: boolean;
  tone?: "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : highlight
          ? "gradient-primary text-primary-foreground"
          : "bg-secondary text-primary";
  return (
    <Card className={`relative overflow-hidden border-border/60 bg-card p-4 shadow-card-soft ${highlight ? "ring-1 ring-primary/40" : ""}`}>
      {highlight && <div className="absolute inset-0 gradient-primary opacity-[0.06]" aria-hidden />}
      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`mt-1 font-mono text-2xl font-bold ${highlight ? "text-gradient" : ""}`}>{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
      </div>
    </Card>
  );
}

function StatusPill({ tone, label, pulsing }: { tone: "success" | "warning" | "muted"; label: string; pulsing?: boolean }) {
  const colors =
    tone === "success"
      ? "bg-success/15 text-success border-success/30"
      : tone === "warning"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-muted text-muted-foreground border-border";
  const dot = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-muted-foreground";
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${colors}`}>
      <span className={`h-2 w-2 rounded-full ${dot} ${pulsing ? "animate-pulse-ring" : ""}`} />
      {label}
    </div>
  );
}
