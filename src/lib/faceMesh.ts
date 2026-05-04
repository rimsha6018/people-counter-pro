// MediaPipe FaceMesh wrapper for live guidance: landmarks, pose estimation,
// quality (sharpness/brightness) and bounding box. Used during registration
// to gate captures and draw landmarks. The 128-d recognition descriptor is
// still produced by face-api.js downstream.

import { FaceMesh, type Results, type NormalizedLandmarkList } from "@mediapipe/face_mesh";

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";

let meshInstance: FaceMesh | null = null;
let meshReady: Promise<FaceMesh> | null = null;

export type FaceMeshSample = {
  landmarks: NormalizedLandmarkList;
  bbox: { x: number; y: number; width: number; height: number }; // pixel coords
  centerOffset: { x: number; y: number }; // -1..1, 0 = center
  sizeRatio: number; // bbox shorter side / frame shorter side
  yaw: number; // degrees, +right / -left
  pitch: number; // degrees, +down / -up
  brightness: number; // 0..255
  sharpness: number; // Laplacian variance proxy
  confidence: number; // 0..1
};

export async function getFaceMesh(): Promise<FaceMesh> {
  if (meshInstance) return meshInstance;
  if (meshReady) return meshReady;
  meshReady = (async () => {
    const mesh = new FaceMesh({
      locateFile: (file) => `${MEDIAPIPE_CDN}/${file}`,
    });
    mesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    await mesh.initialize();
    meshInstance = mesh;
    return mesh;
  })().catch((err) => {
    meshReady = null;
    throw err;
  });
  return meshReady;
}

const computeImageStats = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { brightness: 0, sharpness: 0 };
  // Down-sample to keep it cheap
  const target = 96;
  const scale = Math.min(1, target / Math.max(canvas.width, 1));
  const w = Math.max(8, Math.round(canvas.width * scale));
  const h = Math.max(8, Math.round(canvas.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!tctx) return { brightness: 0, sharpness: 0 };
  tctx.drawImage(canvas, 0, 0, w, h);
  const { data } = tctx.getImageData(0, 0, w, h);
  // Luminance map
  const lum = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = v;
    sum += v;
  }
  const brightness = sum / (w * h);
  // Variance of Laplacian (3x3) — sharpness proxy
  let s2 = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = -lum[i - w] - lum[i - 1] + 4 * lum[i] - lum[i + 1] - lum[i + w];
      s2 += v * v;
      count++;
    }
  }
  const sharpness = count ? s2 / count : 0;
  return { brightness, sharpness };
};

const estimatePose = (lm: NormalizedLandmarkList) => {
  // Mediapipe landmark indices
  const noseTip = lm[1];
  const leftEye = lm[33]; // outer corner left
  const rightEye = lm[263]; // outer corner right
  const chin = lm[152];
  const forehead = lm[10];
  if (!noseTip || !leftEye || !rightEye || !chin || !forehead) {
    return { yaw: 0, pitch: 0 };
  }
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeWidth = Math.max(0.001, rightEye.x - leftEye.x);
  // yaw: nose horizontal offset relative to eye midpoint, normalized by eye distance
  const yawRatio = (noseTip.x - eyeMidX) / eyeWidth;
  const yaw = Math.max(-60, Math.min(60, yawRatio * 90));
  // pitch: nose vertical position between forehead and chin
  const faceHeight = Math.max(0.001, chin.y - forehead.y);
  const noseRatio = (noseTip.y - forehead.y) / faceHeight; // ~0.5 when frontal
  const pitch = Math.max(-45, Math.min(45, (noseRatio - 0.5) * 110));
  return { yaw, pitch };
};

export async function analyzeFrame(
  source: HTMLVideoElement | HTMLCanvasElement,
): Promise<FaceMeshSample | null> {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!width || !height) return null;

  const mesh = await getFaceMesh();
  let result: Results | null = null;
  const handler = (r: Results) => {
    result = r;
  };
  mesh.onResults(handler);
  await mesh.send({ image: source as unknown as HTMLVideoElement });
  // Detach to avoid stacking listeners
  mesh.onResults(() => {});
  if (!result || !result.multiFaceLandmarks || result.multiFaceLandmarks.length === 0) return null;
  const landmarks = result.multiFaceLandmarks[0];

  // BBox from landmarks
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bbox = {
    x: minX * width,
    y: minY * height,
    width: (maxX - minX) * width,
    height: (maxY - minY) * height,
  };
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const centerOffset = {
    x: (cx - width / 2) / (width / 2),
    y: (cy - height / 2) / (height / 2),
  };
  const sizeRatio = Math.min(bbox.width, bbox.height) / Math.min(width, height);
  const { yaw, pitch } = estimatePose(landmarks);

  // Quality stats from a small canvas snapshot
  const stat = document.createElement("canvas");
  const sw = Math.min(192, width);
  const sh = Math.round((sw / width) * height);
  stat.width = sw;
  stat.height = sh;
  stat.getContext("2d")?.drawImage(source as CanvasImageSource, 0, 0, sw, sh);
  const { brightness, sharpness } = computeImageStats(stat);

  return {
    landmarks,
    bbox,
    centerOffset,
    sizeRatio,
    yaw,
    pitch,
    brightness,
    sharpness,
    confidence: 1,
  };
}

// Pose targets: center / left / right
export type PoseTarget = "center" | "left" | "right";

export const POSE_LABEL: Record<PoseTarget, string> = {
  center: "Look straight at the camera",
  left: "Slowly turn your head LEFT",
  right: "Slowly turn your head RIGHT",
};

export const matchesPose = (sample: FaceMeshSample, target: PoseTarget) => {
  const { yaw, pitch } = sample;
  if (Math.abs(pitch) > 18) return false;
  if (target === "center") return Math.abs(yaw) < 10;
  if (target === "left") return yaw < -15 && yaw > -45;
  if (target === "right") return yaw > 15 && yaw < 45;
  return false;
};

// Quality gate for "essentials + sharpness + pose"
export type QualityIssue =
  | "no_face"
  | "off_center"
  | "too_far"
  | "too_close"
  | "low_light"
  | "too_bright"
  | "blurry"
  | "bad_pose";

export const evaluateQuality = (
  sample: FaceMeshSample | null,
  pose: PoseTarget,
): { ok: boolean; issue?: QualityIssue; hint: string } => {
  if (!sample) return { ok: false, issue: "no_face", hint: "No face detected — face the camera" };
  const { centerOffset, sizeRatio, brightness, sharpness } = sample;
  if (Math.abs(centerOffset.x) > 0.25 || Math.abs(centerOffset.y) > 0.28) {
    return { ok: false, issue: "off_center", hint: "Align your face in the frame" };
  }
  if (sizeRatio < 0.22) return { ok: false, issue: "too_far", hint: "Move closer to the camera" };
  if (sizeRatio > 0.85) return { ok: false, issue: "too_close", hint: "Move slightly back" };
  if (brightness < 55) return { ok: false, issue: "low_light", hint: "Improve lighting conditions" };
  if (brightness > 225) return { ok: false, issue: "too_bright", hint: "Reduce direct light / glare" };
  if (sharpness < 35) return { ok: false, issue: "blurry", hint: "Hold still — image is blurry" };
  if (!matchesPose(sample, pose)) {
    return { ok: false, issue: "bad_pose", hint: POSE_LABEL[pose] };
  }
  return { ok: true, hint: "Hold still..." };
};
