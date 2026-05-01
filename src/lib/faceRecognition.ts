// face-api.js loader + match utility.
// Models are loaded from the public CDN justadudewhohacks/face-api.js-models.

import * as faceapi from "face-api.js";

// Models compatible with face-api.js (justadudewhohacks). The @vladmandic/face-api
// model JSONs use a different op format and cause "forwardFunc is not a function"
// errors when loaded with face-api.js. Use the matching model repo via jsdelivr.
const MODEL_URL =
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

let detectionLoadPromise: Promise<void> | null = null;
let recognitionLoadPromise: Promise<void> | null = null;
let recognitionWarmupPromise: Promise<void> | null = null;
let loadPromise: Promise<void> | null = null;

export async function loadFaceDetectionModel() {
  if (detectionLoadPromise) return detectionLoadPromise;
  detectionLoadPromise = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL).catch((error) => {
    detectionLoadPromise = null;
    throw error;
  });
  return detectionLoadPromise;
}

export async function loadFaceModels() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await loadFaceDetectionModel();
    await Promise.all([
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      loadFaceRecognitionModel(),
    ]);
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

export async function loadFaceRecognitionModel() {
  if (recognitionLoadPromise) return recognitionLoadPromise;
  recognitionLoadPromise = faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL).catch((error) => {
    recognitionLoadPromise = null;
    throw error;
  });
  return recognitionLoadPromise;
}

export async function warmFaceRecognitionModel() {
  if (recognitionWarmupPromise) return recognitionWarmupPromise;
  recognitionWarmupPromise = (async () => {
    await loadFaceRecognitionModel();
    const canvas = document.createElement("canvas");
    canvas.width = 150;
    canvas.height = 150;
    await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(canvas);
  })().catch((error) => {
    recognitionWarmupPromise = null;
    throw error;
  });
  return recognitionWarmupPromise;
}

export type StoredEmployee = {
  id: string;
  name: string;
  descriptors: number[][]; // each is 128-dim
};

const RECOG_THRESHOLD = 0.55; // lower = stricter

export function buildMatcher(employees: StoredEmployee[]) {
  const labeled = employees
    .filter((e) => e.descriptors.length > 0)
    .map(
      (e) =>
        new faceapi.LabeledFaceDescriptors(
          e.id,
          e.descriptors.map((d) => new Float32Array(d)),
        ),
    );
  if (labeled.length === 0) return null;
  return new faceapi.FaceMatcher(labeled, RECOG_THRESHOLD);
}

export async function detectFaces(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement) {
  return faceapi
    .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
}

export async function detectFaceBox(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement) {
  return faceapi.detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 }));
}

export async function detectSingleFace(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement) {
  return faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
}

export async function computeFaceDescriptor(input: HTMLCanvasElement | HTMLImageElement) {
  const descriptor = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(input);
  return Array.isArray(descriptor) ? descriptor[0] : descriptor;
}

export { faceapi };
