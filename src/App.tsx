import "./App.css";
import { Fragment, Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  CAMERA_MODE_LABELS,
  cycleCameraMode,
  useCameraMode,
} from "./components/cameraMode";
import HomeLevel from "./components/HomeLevel";
import Speedometer from "./components/Speedometer";
import VehicleSelect from "./components/VehicleSelect";
import { VEHICLES, type VehicleId } from "./components/vehicles";

function App() {
  const [vehicle, setVehicle] = useState<VehicleId | null>(null);
  const info = VEHICLES.find((v) => v.id === vehicle);
  const cameraMode = useCameraMode();

  // V (or Escape) returns to the vehicle select screen; C cycles cameras.
  useEffect(() => {
    if (!vehicle) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyV" || e.code === "Escape") setVehicle(null);
      if (e.code === "KeyC" && !e.repeat) cycleCameraMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vehicle]);

  return (
    <div id="canvas-container">
      {/* flat = no tone mapping, for punchy cartoon colours */}
      <Canvas flat>
        <Suspense fallback={null}>
          <HomeLevel vehicle={vehicle} />
        </Suspense>
      </Canvas>

      {info ? (
        <>
          {info.speedometer && <Speedometer />}
          {/* Re-keyed so the badge pops each time the mode changes. */}
          <div className="camera-badge" key={cameraMode}>
            <span className="camera-badge-key">C</span>
            <span className="camera-badge-label">Camera</span>
            <b>
              {cameraMode === "hood" ? info.hoodLabel : CAMERA_MODE_LABELS[cameraMode]}
            </b>
          </div>
          <div className="controls-hint">
            {info.controls.map(([keys, action]) => (
              <Fragment key={keys}>
                <b>{keys}</b> {action} ·{" "}
              </Fragment>
            ))}
            <b>C</b> camera · <b>M</b> mute · <b>V</b> change vehicle
          </div>
        </>
      ) : (
        <VehicleSelect onSelect={setVehicle} />
      )}
    </div>
  );
}

export default App;
