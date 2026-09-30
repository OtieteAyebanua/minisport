import { useEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CarAudio } from "./carAudio";
import ModelOutlines from "./ModelOutlines";
import { telemetry } from "./telemetry";
import { useToonGLTF } from "./toon";
import { useKeys } from "./useKeys";
import { useVehicleAudio } from "./useVehicleAudio";
import {
  moveWithCollisions,
  resetVehicleCamera,
  updateVehicleCamera,
  type CameraRig,
  type CollisionShape,
} from "./vehicleShared";
import carUrl from "../assets/car.glb?url";

const CAR_SCALE = 0.25 / 3;

// Speeds are scaled down with the car so it doesn't feel too twitchy.
const SPEED_SCALE = 0.6;

// Car half-size in world units (model is ~1.11 x 1.01 x 1.9 before scaling).
const HALF_WIDTH = 0.556 * CAR_SCALE;
const HALF_LENGTH = 0.95 * CAR_SCALE;

// Driving tuning (world units / seconds).
const MAX_SPEED = 3.5 * SPEED_SCALE;
const MAX_REVERSE_SPEED = 1.2 * SPEED_SCALE;
const BOOST_MULTIPLIER = 1.6;
const ACCEL = 3 * SPEED_SCALE;
const BRAKE = 7 * SPEED_SCALE;
const REVERSE_ACCEL = 2 * SPEED_SCALE;
const ROLLING_DRAG = 0.8;
const STEER_RATE = 2.4;
const GRIP = 10; // how quickly sideways slide is cancelled
const HANDBRAKE_GRIP = 1.2; // low grip = drift
const WALL_BOUNCE = 0.3;

// Speedometer reads this at MAX_SPEED (boost pushes past it).
const TOP_SPEED_KMH = 180;

const FLOOR_Y = 0;
const START_POSITION = new THREE.Vector3(2.3, FLOOR_Y, 3);
const START_YAW = Math.PI; // nose toward the back of the room

const PIVOT_HEIGHT = 0.05;
const CAMERAS: CameraRig = {
  chase: {
    offset: new THREE.Vector3(0, 0.13, -0.3),
    lookAhead: new THREE.Vector3(0, 0.035, 0.25),
    pivotHeight: PIVOT_HEIGHT,
    follow: 14,
    baseFov: 70,
    fovKick: 8,
    boostFovKick: 16,
  },
  far: {
    offset: new THREE.Vector3(0, 0.35, -0.75),
    lookAhead: new THREE.Vector3(0, 0, 0.5),
    pivotHeight: PIVOT_HEIGHT,
    follow: 8,
    baseFov: 60,
    fovKick: 6,
    boostFovKick: 12,
  },
  // Just above the roof, looking down the bonnet.
  hood: {
    offset: new THREE.Vector3(0, 0.1, -0.01),
    lookAhead: new THREE.Vector3(0, 0.07, 1),
    pivotHeight: PIVOT_HEIGHT,
    follow: 40,
    baseFov: 78,
    fovKick: 12,
    boostFovKick: 22,
  },
  top: {
    offset: new THREE.Vector3(0, 1.3, -0.35),
    lookAhead: new THREE.Vector3(0, 0, 0.15),
    pivotHeight: PIVOT_HEIGHT,
    follow: 10,
    baseFov: 55,
    fovKick: 5,
    boostFovKick: 10,
  },
};

type CarProps = {
  // Geometry the car collides with and the camera can't see through.
  collider: THREE.Object3D;
};

function Car({ collider }: CarProps) {
  const { scene } = useToonGLTF(carUrl);
  const keys = useKeys();
  const audio = useVehicleAudio(() => new CarAudio());

  useEffect(resetVehicleCamera, []);

  const car = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const brakeLight = useRef<THREE.PointLight>(null);

  const drive = useRef({
    yaw: START_YAW,
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
  });

  // Collision box follows the car's current heading.
  const shape = useRef<CollisionShape>({
    extent: (dir) =>
      Math.abs(dir.dot(drive.current.forward)) * HALF_LENGTH +
      Math.abs(dir.dot(drive.current.right)) * HALF_WIDTH,
    rayHeights: [0.02, 0.057],
    raySides: [-0.85, 0, 0.85],
  });

  useFrame((state, rawDelta) => {
    if (!car.current || !body.current) return;
    const dt = Math.min(rawDelta, 0.05);
    const pressed = (...codes: string[]) =>
      codes.some((code) => keys.current.has(code));

    const gas = pressed("KeyW", "ArrowUp");
    const back = pressed("KeyS", "ArrowDown");
    const steer =
      (pressed("KeyA", "ArrowLeft") ? 1 : 0) -
      (pressed("KeyD", "ArrowRight") ? 1 : 0);
    const handbrake = pressed("Space");
    const boost = pressed("KeyE") ? BOOST_MULTIPLIER : 1;

    const d = drive.current;

    // Steering only works while rolling, and flips when reversing.
    d.forward.set(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    const steerAmount = THREE.MathUtils.clamp(
      d.velocity.dot(d.forward) / (1.5 * SPEED_SCALE),
      -1,
      1,
    );
    d.yaw += steer * STEER_RATE * steerAmount * (handbrake ? 1.5 : 1) * dt;

    // Split velocity into the car's forward and sideways components.
    d.forward.set(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    d.right.set(-d.forward.z, 0, d.forward.x);
    let forwardSpeed = d.velocity.dot(d.forward);
    let sideSpeed = d.velocity.dot(d.right);

    if (gas) {
      forwardSpeed += ACCEL * boost * dt;
    } else if (back) {
      // Brake first, then reverse once (almost) stopped.
      forwardSpeed =
        forwardSpeed > 0.05
          ? Math.max(forwardSpeed - BRAKE * dt, 0)
          : forwardSpeed - REVERSE_ACCEL * dt;
    } else {
      forwardSpeed = THREE.MathUtils.damp(forwardSpeed, 0, ROLLING_DRAG, dt);
    }
    if (handbrake) forwardSpeed = THREE.MathUtils.damp(forwardSpeed, 0, 1, dt);
    forwardSpeed = THREE.MathUtils.clamp(
      forwardSpeed,
      -MAX_REVERSE_SPEED,
      MAX_SPEED * boost,
    );
    sideSpeed = THREE.MathUtils.damp(
      sideSpeed,
      0,
      handbrake ? HANDBRAKE_GRIP : GRIP,
      dt,
    );

    d.velocity
      .copy(d.forward)
      .multiplyScalar(forwardSpeed)
      .addScaledVector(d.right, sideSpeed);

    // Move, stopping at (and bouncing off) furniture and walls.
    const p = car.current.position;
    const impact = moveWithCollisions(
      collider,
      p,
      d.velocity,
      dt,
      shape.current,
      WALL_BOUNCE,
    );
    if (impact > 0.4 * SPEED_SCALE) audio.current?.bump(impact / SPEED_SCALE);
    car.current.rotation.y = d.yaw;

    // Body lean: roll out of turns, squat on the gas, dive on the brakes.
    const speedFactor = Math.min(Math.abs(forwardSpeed) / MAX_SPEED, 1);
    const braking = back && forwardSpeed > 0.05;
    const reversing = forwardSpeed < -0.05;
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      steer * steerAmount * speedFactor * 0.08 + (sideSpeed / SPEED_SCALE) * 0.03,
      6,
      dt,
    );
    body.current.rotation.x = THREE.MathUtils.damp(
      body.current.rotation.x,
      (gas ? -0.04 : 0) + (braking ? 0.06 : 0),
      6,
      dt,
    );

    audio.current?.update({
      speed: speedFactor,
      throttle: gas || (back && forwardSpeed <= 0.05),
      boost: boost > 1 && gas,
      reverse: reversing,
      skid: Math.abs(sideSpeed) / (1.2 * SPEED_SCALE) + (braking ? speedFactor : 0),
    });

    const engine = audio.current?.engine;
    telemetry.speedKmh = (Math.abs(forwardSpeed) / MAX_SPEED) * TOP_SPEED_KMH;
    telemetry.rpm = engine?.rpm ?? 0;
    telemetry.gearLabel = reversing
      ? "R"
      : Math.abs(forwardSpeed) > 0.05
        ? String((engine?.gear ?? 0) + 1)
        : "N";
    telemetry.boost = boost > 1 && gas;

    if (brakeLight.current) {
      brakeLight.current.intensity = braking || handbrake ? 1.5 : 0.15;
    }

    updateVehicleCamera(
      state.camera,
      collider,
      p,
      d.yaw,
      speedFactor,
      boost > 1,
      dt,
      state.clock.elapsedTime,
      CAMERAS,
    );
  });

  return (
    <group ref={car} position={START_POSITION} rotation-y={START_YAW}>
      <group ref={body}>
        <primitive object={scene} scale={CAR_SCALE} />
        <ModelOutlines object={scene} />
        <pointLight
          ref={brakeLight}
          position={[0, 0.04, -0.09]}
          color="#ff2a2a"
          distance={0.3}
          intensity={0.15}
        />
      </group>
    </group>
  );
}

useGLTF.preload(carUrl);

export default Car;
