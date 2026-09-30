// Live vehicle readings, written by the active vehicle every frame and read
// by HUD widgets. Kept outside React state so the HUD can update without
// re-rendering.
export const telemetry = {
  speedKmh: 0,
  rpm: 0,
  gearLabel: "N", // e.g. "N", "R", "1".."5" for the car, "HOV"/"FLY" for the ship
  boost: false,
};

export const MAX_DISPLAY_KMH = 300;
export const MAX_DISPLAY_RPM = 8000;
export const REDLINE_DISPLAY_RPM = 6800;
