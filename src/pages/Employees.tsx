import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Plus, Power, PowerOff, Trash2, Upload, UserPlus, Video, X } from "lucide-react";
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
import {
  analyzeFrame,
  evaluateQuality,
  getFaceMesh,
  POSE_LABEL,
  type FaceMeshSample,
  type PoseTarget,
} from "@/lib/faceMesh";
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

const POSE_SEQUENCE: PoseTarget[] = ["center", "left", "right"];
const HOLD_MS = 900; // must keep quality OK this long before auto-capture
const POST_CAPTURE_PAUSE_MS = 1500;

function RegisterDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const analyzingRef = useRef(false);
  const captureLockRef = useRef(false);
  const holdStartRef = useRef<number | null>(null);
  const lastCaptureAtRef = useRef(0);
  const poseIndexRef = useRef(0);
  const lastSampleRef = useRef<FaceMeshSample | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [faceImage, setFaceImage] = useState<string | null>(null);
  const [poseShots, setPoseShots] = useState<Record<PoseTarget, string | null>>({
    center: null,
    left: null,
    right: null,
  });
  const [poseIndex, setPoseIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [processingSamples, setProcessingSamples] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [modelsReady, setModelsReady] = useState(false);
  const [hint, setHint] = useState("Camera Engine Loading…");
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

  const queueDescriptor = useCallback((faceCrop: HTMLCanvasElement, pose: PoseTarget) => {
    setProcessingSamples((c) => c + 1);
    warmFaceRecognitionModel()
      .then(() => computeFaceDescriptor(faceCrop))
      .then((descriptor) => {
        if (!mountedRef.current || !descriptor) return;
        setDescriptors((d) => [...d, Array.from(descriptor)]);
        toast.success(`${pose.toUpperCase()} sample ready`);
      })
      .catch((e) => {
        console.error("descriptor error", e);
        if (mountedRef.current) toast.warning("Saved photo — recognition may be reduced");
      })
      .finally(() => {
        if (mountedRef.current) setProcessingSamples((c) => Math.max(0, c - 1));
      });
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

    // Bbox
    ctx.strokeStyle = sample.brightness < 55 ? accent : success;
    ctx.lineWidth = Math.max(3, canvas.width / 220);
    ctx.strokeRect(sample.bbox.x, sample.bbox.y, sample.bbox.width, sample.bbox.height);

    // Landmarks (sub-sampled)
    ctx.fillStyle = primary;
    const lm = sample.landmarks;
    const step = 4;
    for (let i = 0; i < lm.length; i += step) {
      const p = lm[i];
      ctx.fillRect(p.x * canvas.width - 1, p.y * canvas.height - 1, 2, 2);
    }
    // Highlight key features
    const keyIdx = [33, 133, 263, 362, 1, 13, 14, 78, 308, 152, 10];
    ctx.fillStyle = accent;
    for (const i of keyIdx) {
      const p = lm[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(2, canvas.width / 320), 0, Math.PI * 2);
      ctx.fill();
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
    holdStartRef.current = null;
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
    setErrorMsg("");
    setStatus("loading");
    setHint("Camera Engine Loading…");

    if (
      typeof window !== "undefined" &&
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      setStatus("error");
      setErrorMsg("Camera requires HTTPS. Open this page over https:// or on localhost.");
      return;
    }

    if (streamRef.current) stopCamera();

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
        // Flip to ready as soon as metadata is available — don't wait for play()
        const onReady = () => {
          if (!mountedRef.current) return;
          if (settings.width && settings.height) {
            setResolution(`${settings.width}×${settings.height}`);
          } else if (v.videoWidth) {
            setResolution(`${v.videoWidth}×${v.videoHeight}`);
          }
          setStatus("ready");
          setHint("Look at the camera");
        };
        if (v.readyState >= 1) onReady();
        else v.addEventListener("loadedmetadata", onReady, { once: true });
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
    }
  }, [stopCamera]);

  // Init: warm everything up + auto-start
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
        if (mountedRef.current) toast.error("Face detection engine failed to start");
      });
    if (mode === "camera") startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // ---------------------- capture ----------------------

  const performCapture = useCallback(
    async (sample: FaceMeshSample, pose: PoseTarget) => {
      const v = videoRef.current;
      if (!v) return;
      if (captureLockRef.current) return;
      captureLockRef.current = true;
      setCapturing(true);
      try {
        const crop = cropFaceCanvas(v, sample);
        if (!crop) throw new Error("Crop failed");
        const dataUrl = crop.toDataURL("image/jpeg", 0.9);
        setPoseShots((s) => ({ ...s, [pose]: dataUrl }));
        if (pose === "center") setFaceImage(dataUrl);
        queueDescriptor(crop, pose);
        toast.success(`${pose.toUpperCase()} captured`);

        // Advance to next pose
        const nextIndex = poseIndexRef.current + 1;
        poseIndexRef.current = nextIndex;
        setPoseIndex(nextIndex);
        if (nextIndex >= POSE_SEQUENCE.length) {
          setHint("All angles captured — review and save");
        } else {
          setHint(POSE_LABEL[POSE_SEQUENCE[nextIndex]]);
        }
      } catch (e) {
        console.error(e);
        toast.error("Capture failed");
      } finally {
        lastCaptureAtRef.current = Date.now();
        holdStartRef.current = null;
        setCapturing(false);
        captureLockRef.current = false;
      }
    },
    [cropFaceCanvas, queueDescriptor],
  );

  const manualCapture = useCallback(async () => {
    if (!lastSampleRef.current) {
      toast.error("No face detected yet");
      return;
    }
    const idx = poseIndexRef.current;
    const pose = POSE_SEQUENCE[Math.min(idx, POSE_SEQUENCE.length - 1)];
    await performCapture(lastSampleRef.current, pose);
  }, [performCapture]);

  // ---------------------- detection loop ----------------------

  useEffect(() => {
    if (status !== "ready" || !modelsReady) return;
    let cancelled = false;
    let lastTick = 0;
    // Small warm-up delay before starting heavy detection — keeps the UI snappy
    const armAt = performance.now() + 1500;

    const tick = async (ts: number) => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(tick);
      if (ts < armAt) {
        setHint("Warming up detection…");
        return;
      }
      // ~10fps mesh analysis is plenty for guidance
      if (ts - lastTick < 100) return;
      lastTick = ts;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.paused || v.videoWidth === 0) return;
      if (analyzingRef.current || captureLockRef.current) return;
      analyzingRef.current = true;
      try {
        const sample = await analyzeFrame(v);
        lastSampleRef.current = sample;
        drawOverlay(sample);

        // Auto-tune CSS filter from brightness
        const f = autoTuneFilter(sample?.brightness ?? 0);
        setFilter((prev) => (prev === f ? prev : f));

        const idx = poseIndexRef.current;
        if (idx >= POSE_SEQUENCE.length) {
          setHint("All angles captured — review and save");
          return;
        }
        const pose = POSE_SEQUENCE[idx];
        const evalRes = evaluateQuality(sample, pose);
        if (!evalRes.ok) {
          holdStartRef.current = null;
          setHint(evalRes.hint);
          return;
        }
        const now = Date.now();
        if (now - lastCaptureAtRef.current < POST_CAPTURE_PAUSE_MS) {
          setHint("Get ready for next pose…");
          return;
        }
        if (!holdStartRef.current) holdStartRef.current = now;
        const held = now - holdStartRef.current;
        if (held < HOLD_MS) {
          setHint(`Hold still… ${Math.max(1, Math.ceil((HOLD_MS - held) / 300))}`);
          return;
        }
        await performCapture(sample!, pose);
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
  }, [status, modelsReady, drawOverlay, performCapture]);

  // ---------------------- save / reset ----------------------

  const resetCaptures = () => {
    setDescriptors([]);
    setFaceImage(null);
    setPoseShots({ center: null, left: null, right: null });
    poseIndexRef.current = 0;
    setPoseIndex(0);
    holdStartRef.current = null;
    setHint(mode === "camera" ? "Look at the camera" : "Upload a clear face photo");
  };

  // React to mode changes — stop or start camera accordingly
  useEffect(() => {
    if (mode === "camera") {
      if (!streamRef.current) startCamera();
    } else {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
      // Draw to canvas for analysis
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

      // Quality / face checks via MediaPipe
      await getFaceMesh();
      const sample = await analyzeFrame(canvas);
      if (!sample) {
        toast.error("No face detected — try another photo");
        return;
      }
      if (sample.brightness < 55) {
        toast.error("Image too dark — try a brighter photo");
        return;
      }
      if (sample.sharpness < 30) {
        toast.error("Image too blurry — upload a sharper photo");
        return;
      }
      if (Math.abs(sample.centerOffset.x) > 0.45 || Math.abs(sample.centerOffset.y) > 0.45) {
        toast.error("Face not centered — crop closer to the face");
        return;
      }

      // Verify single face via face-api detector
      await loadFaceModels();
      const detections = await detectFaces(canvas);
      if (detections.length === 0) {
        toast.error("No face detected");
        return;
      }
      if (detections.length > 1) {
        toast.error("Multiple faces detected — upload a single-person photo");
        return;
      }

      // Crop face for storage + descriptor
      const crop = document.createElement("canvas");
      crop.width = 360;
      crop.height = 360;
      const cctx = crop.getContext("2d")!;
      const box = sample.bbox;
      const size = Math.min(Math.max(box.width, box.height) * 1.7, Math.min(cw, ch));
      const sx = Math.max(0, Math.min(cw - size, box.x + box.width / 2 - size / 2));
      const sy = Math.max(0, Math.min(ch - size, box.y + box.height / 2 - size / 2));
      cctx.drawImage(canvas, sx, sy, size, size, 0, 0, 360, 360);
      const cropUrl = crop.toDataURL("image/jpeg", 0.92);

      const descriptor = detections[0].descriptor;
      setDescriptors([Array.from(descriptor)]);
      setFaceImage(cropUrl);
      setPoseShots({ center: cropUrl, left: null, right: null });
      poseIndexRef.current = POSE_SEQUENCE.length;
      setPoseIndex(POSE_SEQUENCE.length);
      toast.success("Face extracted — ready to save");
    } catch (e) {
      console.error(e);
      toast.error("Failed to process image");
    } finally {
      setUploadProcessing(false);
    }
  };

  const save = async () => {
    try {
      nameSchema.parse(name);
      emailSchema.parse(email);
    } catch (err: unknown) {
      return toast.error(err instanceof z.ZodError ? err.errors[0]?.message : "Invalid input");
    }
    if (!faceImage) return toast.error("Capture at least the CENTER pose before saving");

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

  const completedPoses = POSE_SEQUENCE.filter((p) => poseShots[p]).length;
  const allDone = completedPoses === POSE_SEQUENCE.length;

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Register employee</DialogTitle>
        <DialogDescription>
          Guided multi-angle capture: face the camera, then turn left, then right.
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
              <Badge variant="secondary" className="font-mono text-xs">
                {modelsReady ? hint : "Loading face engine…"}
              </Badge>
              <Badge className="font-mono text-xs">
                {allDone ? "Ready to save" : `Step ${Math.min(poseIndex + 1, POSE_SEQUENCE.length)}/${POSE_SEQUENCE.length}: ${POSE_SEQUENCE[Math.min(poseIndex, POSE_SEQUENCE.length - 1)].toUpperCase()}`}
              </Badge>
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
          <Badge className="absolute right-3 top-3 font-mono text-xs">
            {processingSamples > 0
              ? `${descriptors.length}/${POSE_SEQUENCE.length} · processing`
              : `${descriptors.length}/${POSE_SEQUENCE.length} samples`}
          </Badge>
        </div>

        {/* Pose progress thumbnails */}
        <div className="grid grid-cols-3 gap-3">
          {POSE_SEQUENCE.map((pose, i) => {
            const shot = poseShots[pose];
            const active = i === poseIndex && !allDone;
            return (
              <div
                key={pose}
                className={`relative overflow-hidden rounded-md border bg-muted/40 ${
                  active ? "border-primary ring-2 ring-primary/40" : "border-border/60"
                }`}
              >
                <div className="aspect-square w-full">
                  {shot ? (
                    <img src={shot} alt={pose} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                      {POSE_LABEL[pose].replace("Slowly turn your head ", "").replace("Look straight at the camera", "FRONT")}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] uppercase">
                  <span className="font-semibold">{pose}</span>
                  {shot ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : active ? (
                    <span className="font-mono text-primary">now</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

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
            onClick={manualCapture}
            disabled={status !== "ready" || capturing || allDone}
            variant="secondary"
            className="gap-2"
          >
            {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Capture now
          </Button>
          {(descriptors.length > 0 || faceImage || completedPoses > 0) && (
            <Button variant="ghost" onClick={resetCaptures} className="gap-1">
              <X className="h-4 w-4" /> Reset captures
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !faceImage}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

