import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Plus, Power, PowerOff, Trash2, Upload, UserPlus, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  computeFaceDescriptor,
  detectFaces,
  loadFaceModels,
  warmFaceRecognitionModel,
} from "@/lib/faceRecognition";
import { analyzeFrame, getFaceMesh, type FaceMeshSample } from "@/lib/faceMesh";
import { autoTuneFilter, openBestCamera } from "@/lib/cameraEnhance";

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
      ((data ?? []) as Employee[]).map((e) => ({
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
  const rafRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const analyzingRef = useRef(false);
  const lastSampleRef = useRef<FaceMeshSample | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [faceImage, setFaceImage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [modelsReady, setModelsReady] = useState(false);
  const [hint, setHint] = useState("Look at the camera");
  const [filter, setFilter] = useState<string>("none");
  const [resolution, setResolution] = useState<string>("");
  const [mode, setMode] = useState<"camera" | "upload">("camera");
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------- helpers ----------------------

  const cropFaceCanvas = useCallback((video: HTMLVideoElement, sample: FaceMeshSample) => {
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const box = sample.bbox;
    const size = Math.min(Math.max(box.width, box.height) * 1.7, Math.min(vw, vh));
    const sx = Math.max(0, Math.min(vw - size, box.x + box.width / 2 - size / 2));
    const sy = Math.max(0, Math.min(vh - size, box.y + box.height / 2 - size / 2));
    ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const cropFromVideoCenter = useCallback((video: HTMLVideoElement) => {
    // Fallback crop when no face sample is available — center square
    const canvas = document.createElement("canvas");
    canvas.width = 360;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const size = Math.min(vw, vh);
    const sx = (vw - size) / 2;
    const sy = (vh - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 360, 360);
    return canvas;
  }, []);

  const drawOverlay = useCallback((sample: FaceMeshSample | null) => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !video || !ctx || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const styles = getComputedStyle(document.documentElement);
    const primary = `hsl(${styles.getPropertyValue("--primary")})`;
    const accent = `hsl(${styles.getPropertyValue("--accent")})`;
    const success = `hsl(${styles.getPropertyValue("--success")})`;

    // Center guide oval
    ctx.save();
    ctx.strokeStyle = primary;
    ctx.lineWidth = Math.max(3, canvas.width / 240);
    ctx.setLineDash([14, 10]);
    const gw = Math.min(canvas.width, canvas.height) * 0.55;
    const gh = gw * 1.25;
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, gw / 2, gh / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (!sample) return;

    ctx.strokeStyle = sample.brightness < 55 ? accent : success;
    ctx.lineWidth = Math.max(3, canvas.width / 220);
    ctx.strokeRect(sample.bbox.x, sample.bbox.y, sample.bbox.width, sample.bbox.height);

    ctx.fillStyle = primary;
    const lm = sample.landmarks;
    const step = 4;
    for (let i = 0; i < lm.length; i += step) {
      const p = lm[i];
      ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 2, 2);
    }
  }, []);

  const clearOverlay = useCallback(() => {
    const c = overlayRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
  }, []);

  // ---------------------- camera lifecycle ----------------------

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
    if (mountedRef.current) {
      setStatus("idle");
      setFilter("none");
    }
  }, [clearOverlay]);

  const startCamera = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setErrorMsg("");
    setStatus("loading");
    setHint("Starting camera…");

    if (
      typeof window !== "undefined" &&
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setStatus("error");
      setErrorMsg("Camera requires HTTPS. Open this page over https:// or on localhost.");
      startingRef.current = false;
      return;
    }

    try {
      const { stream, settings } = await openBestCamera();
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
        v.autoplay = true;
        const onReady = () => {
          if (!mountedRef.current) return;
          if (settings.width && settings.height) {
            setResolution(`${settings.width}×${settings.height}`);
          } else if (v.videoWidth) {
            setResolution(`${v.videoWidth}×${v.videoHeight}`);
          }
          setStatus("ready");
          setHint("Look at the camera, then click Capture");
        };
        if (v.readyState >= 1) onReady();
        else {
          v.addEventListener("loadedmetadata", onReady, { once: true });
          v.addEventListener("canplay", onReady, { once: true });
        }
        v.play().catch(() => {});
      }
    } catch (err: unknown) {
      const errName = err instanceof DOMException ? err.name : "";
      let msg = "Could not start camera.";
      if (errName === "NotAllowedError" || errName === "SecurityError") {
        msg = "Permission denied. Allow camera access and try again.";
        setStatus("denied");
      } else if (errName === "NotFoundError" || errName === "OverconstrainedError") {
        msg = "No compatible camera found.";
        setStatus("error");
      } else if (errName === "NotReadableError" || errName === "AbortError") {
        msg = "Camera is in use by another application.";
        setStatus("error");
      } else {
        setStatus("error");
      }
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      startingRef.current = false;
    }
  }, []);

  // Init: warm models + auto-start camera (only in camera mode)
  useEffect(() => {
    mountedRef.current = true;
    loadFaceModels().catch(() => {});
    warmFaceRecognitionModel().catch(() => {});
    getFaceMesh()
      .then(() => {
        if (mountedRef.current) setModelsReady(true);
      })
      .catch((e) => {
        console.error("FaceMesh init failed", e);
      });
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to mode changes
  useEffect(() => {
    if (mode === "camera") {
      startCamera();
    } else {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---------------------- guidance loop (light) ----------------------

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    let lastTick = 0;
    const armAt = performance.now() + 800;

    const tick = async (ts: number) => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
      if (ts < armAt) return;
      if (!modelsReady) return;
      if (ts - lastTick < 120) return;
      lastTick = ts;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.paused || v.videoWidth === 0) return;
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      try {
        const sample = await analyzeFrame(v);
        lastSampleRef.current = sample;
        drawOverlay(sample);
        const f = autoTuneFilter(sample?.brightness ?? 0);
        setFilter((prev) => (prev === f ? prev : f));
        if (!sample) {
          setHint("No face detected — face the camera");
        } else if (sample.brightness < 55) {
          setHint("Improve lighting");
        } else if (Math.abs(sample.centerOffset.x) > 0.2 || Math.abs(sample.centerOffset.y) > 0.2) {
          setHint("Align your face in frame");
        } else {
          setHint("Looking good — click Capture");
        }
      } catch (err) {
        console.error("analyze error", err);
      } finally {
        analyzingRef.current = false;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [status, modelsReady, drawOverlay]);

  // ---------------------- capture ----------------------

  const handleCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return toast.error("Camera not ready");
    setCapturing(true);
    try {
      const sample = lastSampleRef.current;
      const crop = sample ? cropFaceCanvas(v, sample) : cropFromVideoCenter(v);
      if (!crop) throw new Error("Capture failed");
      const dataUrl = crop.toDataURL("image/jpeg", 0.92);
      setFaceImage(dataUrl);

      // Compute descriptor (best-effort)
      try {
        await warmFaceRecognitionModel();
        const desc = await computeFaceDescriptor(crop);
        if (desc) {
          setDescriptors([Array.from(desc)]);
          toast.success("Face captured");
        } else {
          setDescriptors([]);
          toast.warning("Saved photo — recognition may be reduced");
        }
      } catch (e) {
        console.error(e);
        setDescriptors([]);
        toast.warning("Saved photo — recognition may be reduced");
      }
    } catch (e) {
      console.error(e);
      toast.error("Capture failed");
    } finally {
      setCapturing(false);
    }
  }, [cropFaceCanvas, cropFromVideoCenter]);

  const resetCapture = () => {
    setDescriptors([]);
    setFaceImage(null);
    setHint(mode === "camera" ? "Look at the camera, then click Capture" : "Upload a clear face photo");
  };

  // ---------------------- upload ----------------------

  const handleUpload = async (file: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png)$/i.test(file.type)) {
      return toast.error("Please upload a JPG or PNG image");
    }
    if (file.size > 8 * 1024 * 1024) {
      return toast.error("Image too large (max 8MB)");
    }
    setUploadProcessing(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Could not read image"));
        i.src = dataUrl;
      });
      const max = 720;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale);
      const ch = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available");
      ctx.drawImage(img, 0, 0, cw, ch);

      await loadFaceModels();
      const detections = await detectFaces(canvas);
      if (detections.length === 0) {
        toast.error("No face detected — try another photo");
        return;
      }
      if (detections.length > 1) {
        toast.error("Multiple faces detected — upload a single-person photo");
        return;
      }

      const det = detections[0];
      const box = det.detection?.box ?? { x: 0, y: 0, width: cw, height: ch };
      const crop = document.createElement("canvas");
      crop.width = 360;
      crop.height = 360;
      const cctx = crop.getContext("2d")!;
      const size = Math.min(Math.max(box.width, box.height) * 1.7, Math.min(cw, ch));
      const sx = Math.max(0, Math.min(cw - size, box.x + box.width / 2 - size / 2));
      const sy = Math.max(0, Math.min(ch - size, box.y + box.height / 2 - size / 2));
      cctx.drawImage(canvas, sx, sy, size, size, 0, 0, 360, 360);
      const cropUrl = crop.toDataURL("image/jpeg", 0.92);

      setDescriptors([Array.from(det.descriptor)]);
      setFaceImage(cropUrl);
      toast.success("Face extracted — ready to save");
    } catch (e) {
      console.error(e);
      toast.error("Failed to process image");
    } finally {
      setUploadProcessing(false);
    }
  };

  // ---------------------- save ----------------------

  const save = async () => {
    try {
      nameSchema.parse(name);
      emailSchema.parse(email);
    } catch (err: unknown) {
      return toast.error(err instanceof z.ZodError ? err.errors[0]?.message : "Invalid input");
    }
    if (!faceImage) return toast.error("Capture or upload a face photo first");

    setSaving(true);
    const { error } = await supabase.from("employees").insert({
      name: name.trim(),
      email: email.trim() || null,
      face_descriptors: descriptors,
      face_image: faceImage,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    } as never);
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

  // ---------------------- ui ----------------------

  const statusLabel =
    status === "loading"
      ? "Starting camera…"
      : status === "ready"
        ? `Camera · ${resolution || "live"}`
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
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Register employee</DialogTitle>
        <DialogDescription>
          Capture a front-facing photo or upload one. One clear face is all we need.
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

        <Tabs value={mode} onValueChange={(v) => setMode(v as "camera" | "upload")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="camera" className="gap-2"><Camera className="h-4 w-4" />Camera</TabsTrigger>
            <TabsTrigger value="upload" className="gap-2"><Upload className="h-4 w-4" />Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="camera" className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover transition-[filter] duration-300"
                style={{ filter, transform: "scaleX(-1)" }}
                muted
                playsInline
                autoPlay
              />
              <canvas
                ref={overlayRef}
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              {status === "ready" && (
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">{hint}</Badge>
                  {faceImage && <Badge className="font-mono text-xs">Captured</Badge>}
                </div>
              )}
              {status !== "ready" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-sm text-muted-foreground">
                  {status === "loading" ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span>Starting camera…</span>
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
              <Badge className={`absolute left-3 top-3 font-mono text-xs ${statusTone}`}>{statusLabel}</Badge>
            </div>

            {faceImage && (
              <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-2">
                <img src={faceImage} alt="Captured face" className="h-16 w-16 rounded object-cover" />
                <div className="text-sm">
                  <p className="font-medium">Captured photo</p>
                  <p className="text-xs text-muted-foreground">
                    {descriptors.length > 0 ? "Recognition data extracted" : "No descriptor — re-capture for better accuracy"}
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {status === "ready" ? (
                <Button onClick={stopCamera} variant="outline" className="gap-2">
                  <PowerOff className="h-4 w-4" /> Stop camera
                </Button>
              ) : (
                <Button onClick={startCamera} disabled={status === "loading"} variant="outline" className="gap-2">
                  {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                  Start camera
                </Button>
              )}
              <Button
                onClick={handleCapture}
                disabled={status !== "ready" || capturing}
                className="gap-2"
              >
                {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {faceImage ? "Re-capture" : "Capture"}
              </Button>
              {faceImage && (
                <Button variant="ghost" onClick={resetCapture} className="gap-1">
                  <X className="h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="upload" className="space-y-4">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-dashed border-border/60 bg-muted/30">
              {faceImage ? (
                <img src={faceImage} alt="Uploaded face" className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
                  <Upload className="h-8 w-8 opacity-60" />
                  <span>Upload a clear, well-lit photo (JPG / PNG, single face)</span>
                </div>
              )}
              {uploadProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm text-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Analyzing image…
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProcessing}
              >
                <Upload className="h-4 w-4" /> {faceImage ? "Re-upload image" : "Choose image"}
              </Button>
              {faceImage && (
                <Button variant="ghost" onClick={resetCapture} className="gap-1">
                  <X className="h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !faceImage || !name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
