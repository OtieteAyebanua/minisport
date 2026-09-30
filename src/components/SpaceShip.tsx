import { useEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import ModelOutlines from "./ModelOutlines";
import { ShipAudio } from "./shipAudio";
import { telemetry } from "./telemetry";
import { useToonGLTF } from "./toon";
import { useKeys } from "./useKeys";
import { useVehicleAudio } from "./useVehicleAudio";
import {
  BOUNDS,
  castRay,
  moveWithCollisions,
  resetVehicleCamera,
  updateVehicleCamera,
  type CameraRig,
  type CollisionShape,
} from "./vehicleShared";
import spaceShipUrl from "../assets/space_ship.glb?url";

const SHIP_SCALE = 0.2 / 3;

// Speeds are scaled down with the ship so it doesn't feel too twitchy.
const SPEED_SCALE = 0.6;

// Ship size in world units (model is ~1.49 x 0.56 x 1.8 before scaling).
const HALF_WIDTH = 0.745 * SHIP_SCALE;
const HALF_LENGTH = 0.9 * SHIP_SCALE;
const HEIGHT = 0.56 * SHIP_SCALE;
const HOVER_GAP = 0.03; // how high it floats above floors and furniture

// Flight tuning (world units / seconds).
const MAX_SPEED = 3 * SPEED_SCALE;
const BOOST_MULTIPLIER = 1.8;
const ACCEL_RATE = 2.5;
const COAST_RATE = 0.6;
const BRAKE_RATE = 5;
const TURN_SPEED = 2.2;
const LIFT_SPEED = 1.5 * SPEED_SCALE;
const MAX_BANK = 0.6;
const MAX_PITCH = 0.35;
const WALL_BOUNCE = 0.2;

// Speedometer reads this at MAX_SPEED (boost pushes past it).
const TOP_SPEED_KMH = 160;

const START_POSITION = new THREE.Vector3(2.3, 0.25, 3);
const START_YAW = Math.PI; // nose toward the back of the room

const CAMERAS: CameraRig = {
  chase: {
    offset: new THREE.Vector3(0, 0.08, -0.22),
    lookAhead: new THREE.Vector3(0, 0.015, 0.15),
    pivotHeight: HEIGHT / 2,
    follow: 14,
    baseFov: 70,
    fovKick: 10,
    boostFovKick: 18,
  },
  far: {
    offset: new THREE.Vector3(0, 0.3, -0.65),
    lookAhead: new THREE.Vector3(0, 0, 0.45),
    pivotHeight: HEIGHT / 2,
    follow: 8,
    baseFov: 60,
    fovKick: 8,
    boostFovKick: 14,
  },
  // Cockpit: sitting on the canopy, looking straight ahead.
  hood: {
    offset: new THREE.Vector3(0, HEIGHT * 1.05, 0),
    lookAhead: new THREE.Vector3(0, HEIGHT * 0.9, 1),
    pivotHeight: HEIGHT / 2,
    follow: 40,
    baseFov: 80,
    fovKick: 14,
    boostFovKick: 24,
  },
  top: {
    offset: new THREE.Vector3(0, 1.1, -0.3),
    lookAhead: new THREE.Vector3(0, 0, 0.12),
    pivotHeight: HEIGHT / 2,
    follow: 10,
    baseFov: 55,
    fovKick: 5,
    boostFovKick: 10,
  },
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

type SpaceShipProps = {
  // Geometry the ship collides with and the camera can't see through.
  collider: THREE.Object3D;
};

function SpaceShip({ collider }: SpaceShipProps) {
  const { scene } = useToonGLTF(spaceShipUrl);
  const keys = useKeys();
  const audio = useVehicleAudio(() => new ShipAudio());

  useEffect(resetVehicleCamera, []);

  const ship = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const engineLight = useRef<THREE.PointLight>(null);

  const flight = useRef({
    yaw: START_YAW,
    speed: 0,
    climb: 0,
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    probe: new THREE.Vector3(),
  });

  // Collision box follows the ship's heading; rays skim its belly and top.
  const shape = useRef<CollisionShape>({
    extent: (dir) =>
      Math.abs(dir.dot(flight.current.forward)) * HALF_LENGTH +
      Math.abs(dir.dot(flight.current.right)) * HALF_WIDTH,
    rayHeights: [HEIGHT * 0.2, HEIGHT * 0.8],
    raySides: [-0.85, 0, 0.85],
  });

  useFrame((state, rawDelta) => {
    if (!ship.current || !body.current) return;
    const dt = Math.min(rawDelta, 0.05);
    const pressed = (...codes: string[]) =>
      codes.some((code) => keys.current.has(code));

    const thrust = pressed("KeyW", "ArrowUp") ? 1 : 0;
    const braking = pressed("KeyS", "ArrowDown");
    const turn =
      (pressed("KeyA", "ArrowLeft") ? 1 : 0) -
      (pressed("KeyD", "ArrowRight") ? 1 : 0);
    const lift =
      (pressed("Space") ? 1 : 0) -
      (pressed("ShiftLeft", "ShiftRight") ? 1 : 0);
    const boost = pressed("KeyE") ? BOOST_MULTIPLIER : 1;

    const f = flight.current;
    f.yaw += turn * TURN_SPEED * dt;
    f.forward.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    f.right.set(-f.forward.z, 0, f.forward.x);

    // No reverse thrusters: W accelerates, releasing it coasts, S brakes.
    const speedResponse = braking ? BRAKE_RATE : thrust ? ACCEL_RATE : COAST_RATE;
    f.speed = THREE.MathUtils.damp(
      f.speed,
      braking ? 0 : thrust * MAX_SPEED * boost,
      speedResponse,
      dt,
    );
    f.climb = THREE.MathUtils.damp(f.climb, lift * LIFT_SPEED, 4, dt);

    // Horizontal: fly along the nose, bouncing off anything at ship height
    // (lower furniture passes underneath).
    const p = ship.current.position;
    f.velocity.copy(f.forward).multiplyScalar(f.speed);
    const impact = moveWithCollisions(
      collider,
      p,
      f.velocity,
      dt,
      shape.current,
      WALL_BOUNCE,
    );
    if (impact > 0.4 * SPEED_SCALE) audio.current?.bump(impact / SPEED_SCALE);
    f.speed = Math.max(f.velocity.dot(f.forward), 0);

    // Vertical: hover above whatever is below, stop under whatever is above.
    f.probe.set(p.x, p.y + HEIGHT / 2, p.z);
    const below = castRay(collider, f.probe, DOWN, 10);
    const above = castRay(collider, f.probe, UP, 10);
    const floor = (below ? f.probe.y - below.distance : BOUNDS.min.y) + HOVER_GAP;
    const ceiling = (above ? f.probe.y + above.distance : BOUNDS.max.y) - HEIGHT - 0.02;
    p.y += f.climb * dt;
    if (p.y < floor) {
      // Rise smoothly onto furniture instead of snapping.
      p.y = THREE.MathUtils.damp(p.y, floor, 12, dt);
      if (f.climb < 0) f.climb = 0;
    }
    if (p.y > ceiling) {
      p.y = ceiling;
      if (f.climb > 0) f.climb = 0;
    }
    ship.current.rotation.y = f.yaw;

    // Bank into turns, pitch with climb, and hover-bob when idle.
    const speedFactor = Math.min(f.speed / MAX_SPEED, 1);
    const t = state.clock.elapsedTime;
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      -turn * MAX_BANK * (0.4 + 0.6 * speedFactor),
      5,
      dt,
    );
    body.current.rotation.x = THREE.MathUtils.damp(
      body.current.rotation.x,
      -(f.climb / LIFT_SPEED) * MAX_PITCH + speedFactor * 0.08,
      5,
      dt,
    );
    body.current.position.y = Math.sin(t * 3) * 0.007 * (1 - speedFactor);

    if (engineLight.current) {
      engineLight.current.intensity =
        0.3 + speedFactor * 2.5 + Math.sin(t * 40) * 0.1;
    }

    const boosting = boost > 1 && thrust > 0;
    audio.current?.update({
      speed: speedFactor,
      thrust: thrust > 0,
      climb: f.climb / LIFT_SPEED,
      boost: boosting,
    });

    telemetry.speedKmh = (f.speed / MAX_SPEED) * TOP_SPEED_KMH;
    telemetry.rpm = audio.current?.isStarted
      ? (0.15 + speedFactor * 0.6 + (thrust ? 0.1 : 0) + (boosting ? 0.15 : 0)) * 8000
      : 0;
    telemetry.gearLabel = f.speed > 0.05 ? "FLY" : "HOV";
    telemetry.boost = boosting;

    updateVehicleCamera(
      state.camera,
      collider,
      p,
      f.yaw,
      speedFactor,
      boost > 1,
      dt,
      state.clock.elapsedTime,
      CAMERAS,
    );
  });

  return (
    <group ref={ship} position={START_POSITION} rotation-y={START_YAW}>
      <group ref={body}>
        <primitive object={scene} scale={SHIP_SCALE} />
        <ModelOutlines object={scene} />
        <pointLight
          ref={engineLight}
          position={[0, 0.02, -0.075]}
          color="#4fc3ff"
          distance={0.5}
          intensity={0.3}
        />
      </group>
    </group>
  );
}

useGLTF.preload(spaceShipUrl);

export default SpaceShip;
