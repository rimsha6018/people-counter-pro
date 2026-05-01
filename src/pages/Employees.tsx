import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Plus, Power, PowerOff, Trash2, UserPlus, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { detectFaceBox, detectSingleFace, loadFaceDetectionModel, loadFaceModels } from "@/lib/faceRecognition";

interface Employee {
  id: string;
  name: string;
  email: string | null;
  face_image?: string | null;
  face_descriptors: number[][];
  created_at: string;
}

const nameSchema = z.string().trim().min(1).max(100);
const emailSchema = z.string().trim().email().max(255).optional().or(z.literal(""));

export default function EmployeesPage() {
  const { isAdmin } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = "Employees · SentinelCount";
    loadFaceModels();
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEmployees(
      (data ?? []).map((e: any) => ({
        ...e,
        face_descriptors: Array.isArray(e.face_descriptors) ? e.face_descriptors : [],
      })),
    );
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this employee?")) return;
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="container space-y-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
          <p className="text-sm text-muted-foreground">
            Register faces so SentinelCount can recognize them on camera
          </p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <UserPlus className="h-4 w-4" /> Register employee
              </Button>
            </DialogTrigger>
            <RegisterDialog
              onClose={() => setOpen(false)}
              onCreated={() => {
                setOpen(false);
                load();
              }}
            />
          </Dialog>
        )}
      </div>

      {!isAdmin && (
        <Card className="border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
          Read-only view. Only administrators can register or delete employees.
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : employees.length === 0 ? (
        <Card className="border-border/60 bg-card p-12 text-center text-muted-foreground">
          <Camera className="mx-auto mb-3 h-8 w-8 opacity-50" />
          No employees registered yet
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => (
            <Card key={e.id} className="border-border/60 bg-card p-5 shadow-card-soft">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full gradient-primary text-lg font-bold text-primary-foreground">
                    {e.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{e.name}</p>
                    {e.email && <p className="text-xs text-muted-foreground">{e.email}</p>}
                  </div>
                </div>
                {isAdmin && (
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(e.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Badge variant={e.face_descriptors.length > 0 ? "default" : "outline"}>
                  {e.face_descriptors.length} face sample{e.face_descriptors.length === 1 ? "" : "s"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleDateString()}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

type CameraStatus = "idle" | "loading" | "ready" | "error" | "denied";

function RegisterDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const detectionLoopRef = useRef<number | null>(null);
  const captureLockRef = useRef(false);
  const lastAutoCaptureRef = useRef(0);
  const countdownStartedRef = useRef<number | null>(null);
  const descriptorsCountRef = useRef(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [faceImage, setFaceImage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [modelsReady, setModelsReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [faceHint, setFaceHint] = useState("Center your face");

  const captureFaceImage = (source: HTMLVideoElement | HTMLCanvasElement, detection?: any) => {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    const box = detection?.detection?.box;
    if (box && vw > 0 && vh > 0) {
      const size = Math.min(Math.max(box.width, box.height) * 1.8, Math.min(vw, vh));
      const sx = Math.max(0, Math.min(vw - size, box.x + box.width / 2 - size / 2));
      const sy = Math.max(0, Math.min(vh - size, box.y + box.height / 2 - size / 2));
      ctx.drawImage(source, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    } else {
      const size = Math.min(vw, vh);
      ctx.drawImage(source, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL("image/jpeg", 0.82);
  };

  const makeDetectionSnapshot = (video: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    const maxWidth = 360;
    const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, 1));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string) =>
    Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(label)), ms)),
    ]);

  const drawFaceBox = useCallback((box?: { x: number; y: number; width: number; height: number }) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !video || !ctx || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const styles = getComputedStyle(document.documentElement);
    ctx.strokeStyle = `hsl(${styles.getPropertyValue("--primary")})`;
    ctx.lineWidth = Math.max(4, canvas.width / 180);
    ctx.setLineDash([18, 10]);
    const guideSize = Math.min(canvas.width, canvas.height) * 0.55;
    ctx.strokeRect((canvas.width - guideSize) / 2, (canvas.height - guideSize) / 2, guideSize, guideSize);
    ctx.setLineDash([]);
    if (!box) return;
    ctx.strokeStyle = `hsl(${styles.getPropertyValue("--accent")})`;
    ctx.lineWidth = Math.max(5, canvas.width / 160);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
  }, []);

  const isFaceCentered = (video: HTMLVideoElement, detection: any) => {
    const box = detection?.detection?.box;
    if (!box || video.videoWidth === 0 || video.videoHeight === 0) return false;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const withinX = Math.abs(centerX - video.videoWidth / 2) < video.videoWidth * 0.2;
    const withinY = Math.abs(centerY - video.videoHeight / 2) < video.videoHeight * 0.22;
    const bigEnough = box.width > video.videoWidth * 0.16 && box.height > video.videoHeight * 0.22;
    return withinX && withinY && bigEnough;
  };

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const stopCamera = useCallback(() => {
    if (detectionLoopRef.current) {
      window.clearInterval(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    countdownStartedRef.current = null;
    if (mountedRef.current) setCountdown(null);
    clearOverlay();
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) setStatus("idle");
  }, [clearOverlay]);

  useEffect(() => {
    descriptorsCountRef.current = descriptors.length;
  }, [descriptors.length]);

  const waitForVideo = (video: HTMLVideoElement) =>
    new Promise<void>((resolve) => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
      const done = () => resolve();
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("canplay", done, { once: true });
      window.setTimeout(done, 1200);
    });

  const startCamera = useCallback(async () => {
    // Must run synchronously from a user gesture (or at mount) — no awaits before getUserMedia.
    setErrorMsg("");
    setStatus("loading");

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMsg("Camera API not supported in this browser.");
      toast.error("Camera not supported");
      return;
    }
    // HTTPS / localhost guard
    if (
      typeof window !== "undefined" &&
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setStatus("error");
      setErrorMsg("Camera requires HTTPS. Open this page over https:// or on localhost.");
      toast.error("HTTPS required for camera");
      return;
    }

    if (streamRef.current) stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        await v.play();
        await waitForVideo(v);
      }
      setStatus("ready");
    } catch (err: any) {
      const name = err?.name ?? "";
      let msg = "Could not start camera.";
      if (name === "NotAllowedError" || name === "SecurityError") {
        msg = "Permission denied. Allow camera access in your browser settings and try again.";
        setStatus("denied");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        msg = "No camera found on this device.";
        setStatus("error");
      } else if (name === "NotReadableError" || name === "AbortError") {
        msg = "Camera is in use by another application. Close it and try again.";
        setStatus("error");
      } else {
        setStatus("error");
      }
      setErrorMsg(msg);
      toast.error(msg);
    }
  }, [stopCamera]);

  // Auto-start on mount + cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    // Pre-warm face models in parallel so first capture isn't slow
    loadFaceModels().catch(() => {});
    startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const capture = useCallback(async (source: "manual" | "auto" = "manual", existingResult?: any) => {
    const v = videoRef.current;
    if (!v || status !== "ready") return;
    if (captureLockRef.current) return;
    if (v.readyState < 2 || v.paused || v.videoWidth === 0) {
      toast.error("Camera not ready yet");
      return;
    }
    captureLockRef.current = true;
    setCapturing(true);
    try {
      // ensure models are loaded before detecting
      await loadFaceModels();
      setModelsReady(true);
      const result = existingResult ?? (await detectSingleFace(v));
      if (!result) {
        if (source === "manual") toast.error("No face detected. Look straight at the camera.");
      } else {
        const image = captureFaceImage(v, result);
        if (image) setFaceImage(image);
        setDescriptors((d) => [...d, Array.from(result.descriptor)]);
        toast.success(source === "auto" ? "Face auto-captured" : `Captured sample ${descriptorsCountRef.current + 1}`);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("fetch") || msg.includes("403") || msg.includes("network")) {
        toast.error("Failed to load face model. Check your internet connection.");
      } else {
        toast.error("Face capture failed");
      }
      console.error("Face capture error:", e);
    } finally {
      setCapturing(false);
      captureLockRef.current = false;
      countdownStartedRef.current = null;
      setCountdown(null);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;

    loadFaceModels()
      .then(() => {
        if (cancelled || status !== "ready") return;
        setModelsReady(true);
        setFaceHint("Center your face");
        drawFaceBox();
        detectionLoopRef.current = window.setInterval(async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2 || v.paused || v.videoWidth === 0 || captureLockRef.current) return;
          try {
            const result = await detectSingleFace(v);
            const box = result?.detection?.box;
            drawFaceBox(box);
            if (!result) {
              countdownStartedRef.current = null;
              setCountdown(null);
              setFaceHint("No face detected");
              return;
            }
            if (!isFaceCentered(v, result)) {
              countdownStartedRef.current = null;
              setCountdown(null);
              setFaceHint("Move closer and center your face");
              return;
            }
            setFaceHint("Hold still");
            const now = Date.now();
            if (!countdownStartedRef.current) countdownStartedRef.current = now;
            const elapsed = now - countdownStartedRef.current;
            setCountdown(Math.max(1, Math.ceil((3000 - elapsed) / 1000)));
            if (elapsed >= 3000 && now - lastAutoCaptureRef.current > 5000) {
              lastAutoCaptureRef.current = now;
              await capture("auto", result);
            }
          } catch (error) {
            console.error("Face detection loop error:", error);
          }
        }, 300);
      })
      .catch((error) => {
        console.error("Face model load error:", error);
        setFaceHint("Face model failed to load");
        toast.error("Face detection engine could not start");
      });

    return () => {
      cancelled = true;
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
    };
  }, [capture, drawFaceBox, status]);

  const save = async () => {
    try {
      nameSchema.parse(name);
      emailSchema.parse(email);
    } catch (err: any) {
      return toast.error(err.errors?.[0]?.message ?? "Invalid input");
    }
    if (descriptors.length < 1) return toast.error("Capture at least 1 face sample");
    if (!faceImage) return toast.error("Capture a face photo before saving");

    setSaving(true);
    const { error } = await supabase.from("employees").insert({
      name: name.trim(),
      email: email.trim() || null,
      face_descriptors: descriptors,
      face_image: faceImage,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Employee registered");
    stopCamera();
    onCreated();
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const statusLabel =
    status === "loading"
      ? "Starting camera..."
      : status === "ready"
        ? "Camera ready"
        : status === "denied"
          ? "Permission denied"
          : status === "error"
            ? "Camera error"
            : "Camera stopped";

  const statusTone =
    status === "ready"
      ? "bg-primary text-primary-foreground"
      : status === "denied" || status === "error"
        ? "bg-destructive text-destructive-foreground"
        : "bg-muted text-muted-foreground";

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Register employee</DialogTitle>
        <DialogDescription>
          Capture 3+ photos with slightly different angles for best recognition.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="emp-name">Name</Label>
            <Input id="emp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="emp-email">Email (optional)</Label>
            <Input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
          {status === "ready" && (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
              <Badge variant="secondary" className="font-mono">
                {modelsReady ? faceHint : "Starting face detection..."}
              </Badge>
              {countdown !== null && <Badge className="text-lg font-bold">{countdown}</Badge>}
            </div>
          )}
          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-sm text-muted-foreground">
              {status === "loading" ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Starting camera...</span>
                </>
              ) : status === "denied" ? (
                <>
                  <PowerOff className="h-6 w-6 text-destructive" />
                  <span>{errorMsg || "Permission denied"}</span>
                </>
              ) : status === "error" ? (
                <>
                  <PowerOff className="h-6 w-6 text-destructive" />
                  <span>{errorMsg || "Camera error"}</span>
                </>
              ) : (
                <>
                  <Video className="h-6 w-6" />
                  <span>Camera stopped</span>
                </>
              )}
            </div>
          )}
          <Badge className={`absolute left-3 top-3 font-mono ${statusTone}`}>{statusLabel}</Badge>
          <Badge className="absolute right-3 top-3 font-mono">
            {descriptors.length} sample{descriptors.length === 1 ? "" : "s"}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {status === "ready" ? (
            <Button onClick={stopCamera} variant="outline" className="gap-2">
              <PowerOff className="h-4 w-4" /> Stop camera
            </Button>
          ) : (
            <Button
              onClick={startCamera}
              disabled={status === "loading"}
              variant="outline"
              className="gap-2"
            >
              {status === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              Start camera
            </Button>
          )}
          <Button
            onClick={() => capture("manual")}
            disabled={status !== "ready" || capturing}
            variant="secondary"
            className="gap-2"
          >
            {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Capture sample
          </Button>
          {descriptors.length > 0 && (
            <Button variant="ghost" onClick={() => { setDescriptors([]); setFaceImage(null); }} className="gap-1">
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || descriptors.length === 0 || !faceImage}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
