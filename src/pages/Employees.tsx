import { useEffect, useRef, useState } from "react";
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
import { detectSingleFace, loadFaceModels } from "@/lib/faceRecognition";

interface Employee {
  id: string;
  name: string;
  email: string | null;
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
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [descriptors, setDescriptors] = useState<number[][]>([]);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const stopCamera = () => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) setStatus("idle");
  };

  const startCamera = async () => {
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

    // Stop any prior stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

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
        try {
          await v.play();
        } catch {
          /* autoplay can be blocked; user can press Start again */
        }
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
  };

  // Auto-start on mount + cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    // Pre-warm face models in parallel so first capture isn't slow
    loadFaceModels().catch(() => {});
    startCamera();
    return () => {
      mountedRef.current = false;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = async () => {
    const v = videoRef.current;
    if (!v || status !== "ready") return;
    if (v.readyState < 2 || v.paused) {
      toast.error("Camera not ready yet");
      return;
    }
    setCapturing(true);
    try {
      // ensure models are loaded before detecting
      await loadFaceModels();
      const result = await detectSingleFace(v);
      if (!result) {
        toast.error("No face detected. Look straight at the camera.");
      } else {
        setDescriptors((d) => [...d, Array.from(result.descriptor)]);
        toast.success(`Captured sample ${descriptors.length + 1}`);
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
    }
  };

  const save = async () => {
    try {
      nameSchema.parse(name);
      emailSchema.parse(email);
    } catch (err: any) {
      return toast.error(err.errors?.[0]?.message ?? "Invalid input");
    }
    if (descriptors.length < 1) return toast.error("Capture at least 1 face sample");

    setSaving(true);
    const { error } = await supabase.from("employees").insert({
      name: name.trim(),
      email: email.trim() || null,
      face_descriptors: descriptors,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
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
      ? "Loading camera…"
      : status === "ready"
        ? "Camera started"
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
          {status !== "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-4 text-center text-sm text-muted-foreground">
              {status === "loading" ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span>Loading camera…</span>
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
            onClick={capture}
            disabled={status !== "ready" || capturing}
            variant="secondary"
            className="gap-2"
          >
            {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Capture sample
          </Button>
          {descriptors.length > 0 && (
            <Button variant="ghost" onClick={() => setDescriptors([])} className="gap-1">
              <X className="h-4 w-4" /> Clear
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || descriptors.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
