import { useEffect, useRef, useState } from "react";

/**
 * Lightweight FPS meter. Updates the returned value at most 2x per second.
 * Call `tick()` from your render or detection loop.
 */
export function useFps(updateMs = 500) {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastUpdateRef = useRef(performance.now());

  const tick = () => {
    framesRef.current += 1;
    const now = performance.now();
    const elapsed = now - lastUpdateRef.current;
    if (elapsed >= updateMs) {
      setFps(Math.round((framesRef.current * 1000) / elapsed));
      framesRef.current = 0;
      lastUpdateRef.current = now;
    }
  };

  return { fps, tick };
}

/** Tracks render FPS via requestAnimationFrame independently. */
export function useRenderFps() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}
