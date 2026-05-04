// Camera helpers: pick the highest-quality user-facing camera, request 1080p
// with optional advanced constraints, and compute a CSS filter that gently
// boosts brightness/contrast in low light.

export type CameraOpenResult = {
  stream: MediaStream;
  deviceId?: string;
  settings: MediaTrackSettings;
};

const VIDEO_CONSTRAINT_TIERS: MediaTrackConstraints[] = [
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } },
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  { width: { ideal: 640 }, height: { ideal: 480 } },
];

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}

const pickBestDeviceId = async (): Promise<string | undefined> => {
  const cams = await listVideoInputs();
  if (!cams.length) return undefined;
  // Prefer front / user-facing camera; fall back to the first.
  const front = cams.find((c) => /front|user|face/i.test(c.label));
  return (front ?? cams[0]).deviceId || undefined;
};

export async function openBestCamera(): Promise<CameraOpenResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API not supported");
  }
  // Prime device labels (some browsers hide labels until permission granted)
  let deviceId: string | undefined;
  try {
    deviceId = await pickBestDeviceId();
  } catch {
    deviceId = undefined;
  }

  let lastErr: unknown;
  for (const tier of VIDEO_CONSTRAINT_TIERS) {
    try {
      const video: MediaTrackConstraints = {
        ...tier,
        facingMode: deviceId ? undefined : { ideal: "user" },
        deviceId: deviceId ? { exact: deviceId } : undefined,
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const track = stream.getVideoTracks()[0];
      // Try advanced constraints — silently ignored if unsupported.
      try {
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          exposureMode?: string[];
          whiteBalanceMode?: string[];
          focusMode?: string[];
        };
        const advanced: MediaTrackConstraintSet[] = [];
        if (caps.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" } as MediaTrackConstraintSet);
        if (caps.whiteBalanceMode?.includes("continuous")) advanced.push({ whiteBalanceMode: "continuous" } as MediaTrackConstraintSet);
        if (caps.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet);
        if (advanced.length) await track.applyConstraints({ advanced });
      } catch {
        /* ignore */
      }
      const settings = track.getSettings();
      return { stream, deviceId: settings.deviceId, settings };
    } catch (err) {
      lastErr = err;
      // Try next tier
    }
  }
  throw lastErr ?? new Error("Failed to open camera");
}

// Compute a CSS filter string based on current frame brightness (0..255).
export function autoTuneFilter(brightness: number): string {
  // No face yet / unknown
  if (!brightness || brightness <= 0) return "none";
  if (brightness < 55) {
    // Low light — boost brightness + a little contrast and saturation
    const boost = Math.min(1.6, 1 + (55 - brightness) / 70);
    return `brightness(${boost.toFixed(2)}) contrast(1.18) saturate(1.05)`;
  }
  if (brightness > 210) {
    // Over-bright — pull down a touch
    return "brightness(0.92) contrast(1.05)";
  }
  return "contrast(1.04)";
}
