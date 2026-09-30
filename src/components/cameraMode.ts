import { useSyncExternalStore } from "react";

// Camera modes the player cycles through with C. Read every frame by the
// vehicles and rendered by the HUD badge.
export const CAMERA_MODES = ["chase", "far", "hood", "top", "tv"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  chase: "Chase",
  far: "Far chase",
  hood: "Hood",
  top: "Top-down",
  tv: "TV",
};

const STORAGE_KEY = "minisport.cameraMode";

function loadMode(): CameraMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (CAMERA_MODES as readonly string[]).includes(saved)) {
      return saved as CameraMode;
    }
  } catch {
    // Storage unavailable (private mode etc.): fall back to the default.
  }
  return "chase";
}

let current: CameraMode = loadMode();
const listeners = new Set<() => void>();

export function getCameraMode() {
  return current;
}

export function cycleCameraMode() {
  current = CAMERA_MODES[(CAMERA_MODES.indexOf(current) + 1) % CAMERA_MODES.length];
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {
    // Not critical: the mode just won't be remembered.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCameraMode() {
  return useSyncExternalStore(subscribe, getCameraMode);
}
