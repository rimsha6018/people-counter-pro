import { useCallback, useEffect, useRef, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

export interface Detection {
  bbox: [number, number, number, number]; // x, y, w, h
  score: number;
  label: string; // "Employee N"
}

export interface DetectionFrame {
  count: number;
  detections: Detection[];
  timestamp: number;
}

interface UsePersonDetectorOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  onFrame?: (frame: DetectionFrame) => void;
  scoreThreshold?: number;
  intervalMs?: number;
}

export function usePersonDetector({
  videoRef,
  enabled,
  onFrame,
  scoreThreshold = 0.55,
  intervalMs = 200,
}: UsePersonDetectorOptions) {
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<DetectionFrame>({
    count: 0,
    detections: [],
    timestamp: Date.now(),
  });
  const rafRef = useRef<number | null>(null);
  const lastRunRef = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Load model once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await tf.ready();
        try {
          await tf.setBackend("webgl");
        } catch {
          await tf.setBackend("cpu");
        }
        const m = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        if (!cancelled) {
          setModel(m);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to load detector model:", e);
        if (!cancelled) {
          setError("Failed to load detection model");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const detectLoop = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !model) {
      rafRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const now = performance.now();
    const ready =
      video.readyState >= 2 && video.videoWidth > 0 && !video.paused && !video.ended;

    if (ready && now - lastRunRef.current >= intervalMs) {
      lastRunRef.current = now;
      try {
        const predictions = await model.detect(video, 20);
        const persons = predictions
          .filter((p) => p.class === "person" && p.score >= scoreThreshold)
          .map((p, i) => ({
            bbox: p.bbox as [number, number, number, number],
            score: p.score,
            label: `Employee ${i + 1}`,
          }));
        const frame: DetectionFrame = {
          count: persons.length,
          detections: persons,
          timestamp: Date.now(),
        };
        setCurrentFrame(frame);
        onFrameRef.current?.(frame);
      } catch (err) {
        console.error("Detection error:", err);
      }
    }

    rafRef.current = requestAnimationFrame(detectLoop);
  }, [model, videoRef, scoreThreshold, intervalMs]);

  useEffect(() => {
    if (!enabled || !model) return;
    rafRef.current = requestAnimationFrame(detectLoop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [enabled, model, detectLoop]);

  return { loading, error, currentFrame, modelReady: !!model };
}
