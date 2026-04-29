// face-api.js loader + match utility.
// Models are loaded from the public CDN justadudewhohacks/face-api.js-models.

import * as faceapi from "face-api.js";

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master";

let loadPromise: Promise<void> | null = null;

export async function loadFaceModels() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return loadPromise;
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

export async function detectSingleFace(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement) {
  return faceapi
    .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
}

export { faceapi };
