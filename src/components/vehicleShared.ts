// Shared vehicle helpers: room bounds, raycast collisions against the house
// and the switchable vehicle cameras (chase, far, hood, top-down, TV).

import * as THREE from "three";
import { getCameraMode, type CameraMode } from "./cameraMode";

// Keep vehicles (and the camera) inside the house interior.
export const BOUNDS = {
  min: new THREE.Vector3(-3, 0, -4.2),
  max: new THREE.Vector3(7.6, 4.5, 5.7),
};

const SKIN = 0.02;
const UP = THREE.Object3D.DEFAULT_UP;

const raycaster = Object.assign(new THREE.Raycaster(), { firstHitOnly: true });
const side = new THREE.Vector3();
const origin = new THREE.Vector3();
const normal = new THREE.Vector3();
const dir = new THREE.Vector3();
const before = new THREE.Vector3();
const cameraTarget = new THREE.Vector3();
const look = new THREE.Vector3();

export function castRay(
  collider: THREE.Object3D,
  from: THREE.Vector3,
  direction: THREE.Vector3,
  far: number,
) {
  raycaster.set(from, direction);
  raycaster.far = far;
  return raycaster.intersectObject(collider, true)[0];
}

type Hit = { distance: number; normal: THREE.Vector3 };

export type CollisionShape = {
  // How far the body extends from its centre in a horizontal direction.
  extent: (direction: THREE.Vector3) => number;
  // Ray heights above the vehicle origin, and side offsets (-1..1 of width).
  rayHeights: number[];
  raySides: number[];
};

// Sweep a fan of horizontal rays across the body's leading face and return
// the closest surface it would hit.
function sweep(
  collider: THREE.Object3D,
  position: THREE.Vector3,
  direction: THREE.Vector3,
  far: number,
  shape: CollisionShape,
): Hit | null {
  side.set(-direction.z, 0, direction.x);
  const sideReach = shape.extent(side);
  let closest: Hit | null = null;
  for (const height of shape.rayHeights) {
    for (const offset of shape.raySides) {
      origin.copy(position).addScaledVector(side, offset * sideReach);
      origin.y += height;
      const hit = castRay(collider, origin, direction, far);
      if (!hit?.face || (closest && hit.distance >= closest.distance)) continue;
      normal
        .copy(hit.face.normal)
        .transformDirection(hit.object.matrixWorld)
        .setY(0);
      if (normal.lengthSq() < 1e-6) continue;
      normal.normalize();
      if (normal.dot(direction) > 0) normal.negate();
      closest = { distance: hit.distance, normal: normal.clone() };
    }
  }
  return closest;
}

// Move horizontally by `velocity * dt`, stopping at and bouncing off
// furniture, walls and the room bounds. Mutates `position` and `velocity`.
// Returns the impact speed (0 if nothing was hit hard).
export function moveWithCollisions(
  collider: THREE.Object3D,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  dt: number,
  shape: CollisionShape,
  bounce: number,
) {
  let impact = 0;
  dir.set(velocity.x, 0, velocity.z);
  const step = dir.length() * dt;
  if (step > 1e-5) {
    dir.normalize();
    const reach = shape.extent(dir) + SKIN;
    const hit = sweep(collider, position, dir, reach + step, shape);
    if (hit) {
      position.addScaledVector(dir, Math.max(hit.distance - reach, 0));
      const into = velocity.dot(hit.normal);
      if (into < 0) {
        impact = -into;
        velocity.addScaledVector(hit.normal, -(1 + bounce) * into);
      }
    } else {
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;
    }
  }
  before.copy(position);
  position.clamp(BOUNDS.min, BOUNDS.max);
  if (position.x !== before.x) {
    impact = Math.max(impact, Math.abs(velocity.x));
    velocity.x *= -bounce;
  }
  if (position.z !== before.z) {
    impact = Math.max(impact, Math.abs(velocity.z));
    velocity.z *= -bounce;
  }
  return impact;
}

export type FollowCameraOptions = {
  offset: THREE.Vector3; // in the vehicle's yaw frame (behind = -Z)
  lookAhead: THREE.Vector3;
  pivotHeight: number; // point on the vehicle the camera keeps in view
  follow: number; // damping rate (higher = tighter)
  baseFov: number;
  fovKick: number; // extra FOV at top speed
  boostFovKick: number;
};

// Per-vehicle framing for each follow-style camera mode. The TV mode is
// shared: fixed cameras in the room corners.
export type CameraRig = Record<Exclude<CameraMode, "tv">, FollowCameraOptions>;

const cameraLook = new THREE.Vector3();
let lastMode: CameraMode | null = null;

function setFov(camera: THREE.Camera, fov: number, rate: number, dt: number) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  camera.fov = rate === Infinity ? fov : THREE.MathUtils.damp(camera.fov, fov, rate, dt);
  camera.updateProjectionMatrix();
}

function dampPosition(camera: THREE.Camera, to: THREE.Vector3, rate: number, dt: number) {
  if (rate === Infinity) {
    camera.position.copy(to);
    return;
  }
  camera.position.x = THREE.MathUtils.damp(camera.position.x, to.x, rate, dt);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, to.y, rate, dt);
  camera.position.z = THREE.MathUtils.damp(camera.position.z, to.z, rate, dt);
}

// Follow camera: sits at an offset in the vehicle's frame, lags a little,
// widens its FOV with speed and pulls in front of anything blocking the view.
function followCamera(
  camera: THREE.Camera,
  collider: THREE.Object3D,
  target: THREE.Vector3,
  yaw: number,
  speedFactor: number,
  boosting: boolean,
  dt: number,
  options: FollowCameraOptions,
  snap: boolean,
) {
  const kick = boosting ? options.boostFovKick : options.fovKick;
  setFov(camera, options.baseFov + speedFactor * kick, snap ? Infinity : 3, dt);

  cameraTarget.copy(options.offset).applyAxisAngle(UP, yaw).add(target);
  cameraTarget.clamp(BOUNDS.min, BOUNDS.max);

  origin.copy(target);
  origin.y += options.pivotHeight;
  dir.subVectors(cameraTarget, origin);
  const distance = dir.length();
  dir.normalize();
  const blocker = distance > 1e-4 && castRay(collider, origin, dir, distance);
  if (blocker) {
    cameraTarget
      .copy(origin)
      .addScaledVector(dir, Math.max(blocker.distance - 0.05, 0.02));
  }

  const rate = snap ? Infinity : blocker ? Math.max(options.follow, 15) : options.follow;
  dampPosition(camera, cameraTarget, rate, dt);
  look.copy(options.lookAhead).applyAxisAngle(UP, yaw).add(target);
  camera.lookAt(look);
}

// TV mode: broadcast cameras high in the room's corners. Uses the nearest
// one that can see the vehicle and zooms to keep it framed.
const TV_CAMERAS = [
  new THREE.Vector3(-2.5, 2.9, -3.7),
  new THREE.Vector3(7.1, 2.9, -3.7),
  new THREE.Vector3(-2.5, 2.9, 5.2),
  new THREE.Vector3(7.1, 2.9, 5.2),
  new THREE.Vector3(2.3, 3.6, 0.7),
];
const TV_FRAME_WIDTH = 0.7; // world units kept in frame around the vehicle
const tv = { index: -1, nextCheck: 0 };

function canSee(collider: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  dir.subVectors(to, from);
  const distance = dir.length();
  dir.normalize();
  return !castRay(collider, from, dir, distance - 0.05);
}

function tvCamera(
  camera: THREE.Camera,
  collider: THREE.Object3D,
  target: THREE.Vector3,
  pivotHeight: number,
  dt: number,
  now: number,
  snap: boolean,
) {
  origin.copy(target);
  origin.y += pivotHeight;

  // Re-check line of sight a few times a second, cutting to a new camera
  // when the current one loses the vehicle.
  if (snap || now >= tv.nextCheck) {
    tv.nextCheck = now + 0.25;
    const current = TV_CAMERAS[tv.index];
    if (snap || !current || !canSee(collider, current, origin)) {
      let best = -1;
      let bestDistance = Infinity;
      TV_CAMERAS.forEach((position, index) => {
        const distance = position.distanceTo(origin);
        if (distance < bestDistance && canSee(collider, position, origin)) {
          best = index;
          bestDistance = distance;
        }
      });
      if (best !== -1 && best !== tv.index) {
        tv.index = best;
        snap = true; // hard cut, like a TV director
      }
    }
  }

  const position = TV_CAMERAS[tv.index] ?? TV_CAMERAS[TV_CAMERAS.length - 1];
  camera.position.copy(position);
  const distance = position.distanceTo(origin);
  const fov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2 * Math.atan(TV_FRAME_WIDTH / 2 / distance)),
    6,
    60,
  );
  setFov(camera, fov, snap ? Infinity : 4, dt);
  if (snap) cameraLook.copy(origin);
  else cameraLook.lerp(origin, 1 - Math.exp(-10 * dt));
  camera.lookAt(cameraLook);
}

// Drives the active camera mode for a vehicle. Switching modes cuts
// instantly instead of swooping through walls.
export function updateVehicleCamera(
  camera: THREE.Camera,
  collider: THREE.Object3D,
  target: THREE.Vector3,
  yaw: number,
  speedFactor: number,
  boosting: boolean,
  dt: number,
  now: number,
  rig: CameraRig,
) {
  const mode = getCameraMode();
  const snap = mode !== lastMode;
  lastMode = mode;
  if (mode === "tv") {
    tvCamera(camera, collider, target, rig.chase.pivotHeight, dt, now, snap);
  } else {
    followCamera(camera, collider, target, yaw, speedFactor, boosting, dt, rig[mode], snap);
  }
}

// Call when a vehicle spawns so the camera cuts to it instead of gliding.
export function resetVehicleCamera() {
  lastMode = null;
  tv.index = -1;
}
