import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getCameraMode } from "./cameraMode";
import { CharacterAudio } from "./characterAudio";
import { applyCharacterTextures } from "./characterMaterials";
import { findWalkClip, makeInPlace, rootMotionSpeed } from "./characterAnimation";
import ModelOutlines from "./ModelOutlines";
import { useToonGLTF } from "./toon";
import { useKeys } from "./useKeys";
import { useVehicleAudio } from "./useVehicleAudio";
import {
  castRay,
  moveWithCollisions,
  resetVehicleCamera,
  updateVehicleCamera,
  type CameraRig,
  type CollisionShape,
} from "./vehicleShared";
import charUrl from "../assets/Char.glb?url";

// Mini-figure scale, to match the mini vehicles (car is ~0.08 tall).
const CHAR_HEIGHT = 0.2;
const RADIUS = CHAR_HEIGHT * 0.18;
const STEP_HEIGHT = CHAR_HEIGHT * 0.25; // ledges it walks up without jumping

// Skating tuning (world units / seconds). Push speed comes from the clip:
// the character kick-pushes a skateboard (attached to the left foot).
const HARD_PUSH_MULTIPLIER = 2;
const TURN_SPEED = 2.6;
const PUSH_ACCEL = 3;
const COAST_DRAG = 0.35; // rolling on after you stop pushing
const BRAKE = 4;
const MAX_LEAN = 0.18; // body lean when carving
const GRAVITY = 4;
const JUMP_HEIGHT = CHAR_HEIGHT * 0.7;

const START_POSITION = new THREE.Vector3(2.3, 0, 3);
const START_YAW = Math.PI; // facing the back of the room

// The model walks toward world -X; turn it to face +Z like the vehicles.
const MODEL_FACING = Math.PI / 2;

const H = CHAR_HEIGHT;
const CAMERAS: CameraRig = {
  chase: {
    offset: new THREE.Vector3(0, H * 1.3, -H * 2.2),
    lookAhead: new THREE.Vector3(0, H * 0.75, H * 1.5),
    pivotHeight: H * 0.8,
    follow: 10,
    baseFov: 65,
    fovKick: 4,
    boostFovKick: 8,
  },
  far: {
    offset: new THREE.Vector3(0, H * 2.8, -H * 5),
    lookAhead: new THREE.Vector3(0, H * 0.4, H * 2.5),
    pivotHeight: H * 0.8,
    follow: 6,
    baseFov: 60,
    fovKick: 3,
    boostFovKick: 6,
  },
  // First person: eye height, just in front of the face (model is hidden).
  hood: {
    offset: new THREE.Vector3(0, H * 0.93, H * 0.12),
    lookAhead: new THREE.Vector3(0, H * 0.88, 1),
    pivotHeight: H * 0.8,
    follow: 40,
    baseFov: 75,
    fovKick: 5,
    boostFovKick: 10,
  },
  top: {
    offset: new THREE.Vector3(0, 1.3, -0.35),
    lookAhead: new THREE.Vector3(0, 0, 0.15),
    pivotHeight: H * 0.5,
    follow: 10,
    baseFov: 55,
    fovKick: 3,
    boostFovKick: 6,
  },
};

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

type CharacterSetup = {
  walk: THREE.AnimationClip; // in place
  scale: number;
  offset: THREE.Vector3; // centres the hips over the origin, feet on y=0
  stand: THREE.AnimationClip; // single walk frame with the feet closest together
  walkSpeed: number; // world units/s that matches the walk animation
};

// A clip that holds the pose at `time` (the nearest keyframe of each track).
function freezeFrame(clip: THREE.AnimationClip, time: number) {
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    let key = 0;
    while (key < track.times.length - 1 && track.times[key + 1] <= time) key++;
    const values = track.values.slice(key * size, key * size + size);
    const TrackType = track.constructor as new (
      name: string,
      times: number[],
      values: number[],
    ) => THREE.KeyframeTrack;
    return new TrackType(track.name, [0], Array.from(values));
  });
  return new THREE.AnimationClip(`${clip.name} (stand)`, 0, tracks);
}

// Measuring the rig is expensive, so do it once per loaded model.
const setups = new WeakMap<THREE.Object3D, CharacterSetup>();

function prepareCharacter(scene: THREE.Object3D, animations: THREE.AnimationClip[]) {
  const cached = setups.get(scene);
  if (cached) return cached;

  const source = findWalkClip(animations);
  const walk = makeInPlace(source);

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const scale = CHAR_HEIGHT / (box.max.y - box.min.y);
  const hips = scene.getObjectByName("mixamorigHips");
  const hipsPosition = hips?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const armatureScale =
    scene.getObjectByName("Armature")?.getWorldScale(new THREE.Vector3()).x ?? 1;

  // Find a standing-ish frame to blend to when idle.
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(walk).play();
  const leftFoot = scene.getObjectByName("mixamorigLeftFoot");
  const rightFoot = scene.getObjectByName("mixamorigRightFoot");
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  let standTime = 0;
  let closest = Infinity;
  for (let t = 0; t < walk.duration; t += 1 / 30) {
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    if (!leftFoot || !rightFoot) break;
    const gap = leftFoot.getWorldPosition(left).distanceTo(rightFoot.getWorldPosition(right));
    if (gap < closest) {
      closest = gap;
      standTime = t;
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const setup: CharacterSetup = {
    walk,
    scale,
    offset: new THREE.Vector3(
      -hipsPosition.x * scale,
      -box.min.y * scale,
      -hipsPosition.z * scale,
    ),
    stand: freezeFrame(walk, standTime),
    walkSpeed: rootMotionSpeed(source) * armatureScale * scale,
  };
  setups.set(scene, setup);
  return setup;
}

type CharacterProps = {
  // Geometry the character collides with and the camera can't see through.
  collider: THREE.Object3D;
};

function Character({ collider }: CharacterProps) {
  const { scene, animations } = useToonGLTF(charUrl, applyCharacterTextures);
  const setup = useMemo(() => prepareCharacter(scene, animations), [scene, animations]);
  const keys = useKeys();
  const audio = useVehicleAudio(() => new CharacterAudio());

  // Two actions of the same walk: one playing, one frozen in a standing
  // pose. Their weights blend with speed so stopping looks natural.
  const rig = useMemo(() => {
    const mixer = new THREE.AnimationMixer(scene);
    const walking = mixer.clipAction(setup.walk);
    const standing = mixer.clipAction(setup.stand);
    return {
      mixer,
      walking,
      standing,
      spine: scene.getObjectByName("mixamorigSpine2"),
      feet: [
        scene.getObjectByName("mixamorigLeftFoot"),
        scene.getObjectByName("mixamorigRightFoot"),
      ],
    };
  }, [scene, setup]);

  // Start in the effect (not the memo) so a remount restarts the actions.
  useEffect(() => {
    resetVehicleCamera();
    rig.walking.play();
    rig.standing.play();
    return () => {
      rig.mixer.stopAllAction();
    };
  }, [rig]);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);

  const motion = useRef({
    yaw: START_YAW,
    speed: 0,
    verticalSpeed: 0,
    grounded: true,
    jumpHeld: false,
    pushBlend: 0,
    forward: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    probe: new THREE.Vector3(),
    foot: new THREE.Vector3(),
    footLow: [Infinity, Infinity],
    footPlanted: [true, true],
  });

  const shape = useRef<CollisionShape>({
    extent: () => RADIUS,
    rayHeights: [STEP_HEIGHT + 0.005, CHAR_HEIGHT * 0.5, CHAR_HEIGHT * 0.9],
    raySides: [-1, 0, 1],
  });

  useFrame((state, rawDelta) => {
    if (!root.current || !body.current) return;
    const dt = Math.min(rawDelta, 0.05);
    const pressed = (...codes: string[]) =>
      codes.some((code) => keys.current.has(code));

    const pushing = pressed("KeyW", "ArrowUp");
    const braking = pressed("KeyS", "ArrowDown");
    const turn =
      (pressed("KeyA", "ArrowLeft") ? 1 : 0) - (pressed("KeyD", "ArrowRight") ? 1 : 0);
    const hardPush = pressed("ShiftLeft", "ShiftRight") && pushing;
    const jump = pressed("Space");

    const m = motion.current;
    const walkSpeed = setup.walkSpeed;
    m.yaw += turn * TURN_SPEED * dt;
    m.forward.set(Math.sin(m.yaw), 0, Math.cos(m.yaw));

    // Push to speed up, let go to coast, S to brake. No pushing mid-air.
    const topSpeed = walkSpeed * (hardPush ? HARD_PUSH_MULTIPLIER : 1);
    if (m.grounded && braking) {
      m.speed = THREE.MathUtils.damp(m.speed, 0, BRAKE, dt);
    } else if (m.grounded && pushing && m.speed < topSpeed) {
      m.speed = THREE.MathUtils.damp(m.speed, topSpeed, PUSH_ACCEL, dt);
    } else {
      m.speed = THREE.MathUtils.damp(m.speed, 0, COAST_DRAG, dt);
    }

    // Horizontal movement with collisions.
    const p = root.current.position;
    m.velocity.copy(m.forward).multiplyScalar(m.speed);
    moveWithCollisions(collider, p, m.velocity, dt, shape.current, 0);
    m.speed = Math.max(m.velocity.dot(m.forward), 0);

    // Vertical: step up small ledges, jump, fall, land.
    m.probe.set(p.x, p.y + CHAR_HEIGHT * 0.5, p.z);
    const below = castRay(collider, m.probe, DOWN, 10);
    const ground = below ? m.probe.y - below.distance : 0;
    const above = castRay(collider, m.probe, UP, 10);
    const ceiling = above ? m.probe.y + above.distance : Infinity;

    if (jump && !m.jumpHeld && m.grounded) {
      m.verticalSpeed = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
      m.grounded = false;
      audio.current?.jump();
    }
    m.jumpHeld = jump;

    if (m.grounded) {
      if (p.y - ground > STEP_HEIGHT) {
        m.grounded = false; // walked off an edge
        m.verticalSpeed = 0;
      } else {
        p.y = ground;
      }
    }
    if (!m.grounded) {
      m.verticalSpeed -= GRAVITY * dt;
      p.y += m.verticalSpeed * dt;
      if (p.y + CHAR_HEIGHT > ceiling && m.verticalSpeed > 0) {
        p.y = ceiling - CHAR_HEIGHT;
        m.verticalSpeed = 0;
      }
      if (p.y <= ground && m.verticalSpeed <= 0) {
        if (m.verticalSpeed < -0.4) audio.current?.land(-m.verticalSpeed);
        p.y = ground;
        m.verticalSpeed = 0;
        m.grounded = true;
      }
    }
    root.current.rotation.y = m.yaw;

    // Animation: kick-push while W is held, otherwise ride the board in the
    // standing pose. Push tempo follows speed.
    m.pushBlend = THREE.MathUtils.damp(m.pushBlend, pushing && m.grounded ? 1 : 0, 6, dt);
    const gait = m.pushBlend;
    rig.walking.setEffectiveWeight(gait);
    rig.standing.setEffectiveWeight(1 - gait);
    rig.walking.setEffectiveTimeScale(
      THREE.MathUtils.clamp(m.speed / walkSpeed, 0.7, 1.6) * (hardPush ? 1.25 : 1),
    );
    rig.mixer.update(dt);

    // Lean into carves, more at speed.
    const speedFactor = Math.min(m.speed / (walkSpeed * HARD_PUSH_MULTIPLIER), 1);
    body.current.rotation.z = THREE.MathUtils.damp(
      body.current.rotation.z,
      -turn * MAX_LEAN * (0.3 + 0.7 * speedFactor),
      6,
      dt,
    );

    // Gentle breathing when standing still.
    if (rig.spine) {
      // The mixer rewrites the bone each frame, so this offset never accumulates.
      rig.spine.rotateX(Math.sin(state.clock.elapsedTime * 2.2) * 0.025 * (1 - gait));
    }

    // Kick-push scrapes: the back foot touching down near its lowest point.
    // (The front foot stays on the board, so it never "lands".)
    root.current.updateMatrixWorld(true);
    rig.feet.forEach((foot, i) => {
      if (!foot) return;
      const height = foot.getWorldPosition(m.foot).y - p.y;
      m.footLow[i] = Math.min(m.footLow[i] + dt * 0.02, height);
      const planted = height < m.footLow[i] + CHAR_HEIGHT * 0.02;
      if (planted && !m.footPlanted[i] && m.grounded && gait > 0.3) {
        audio.current?.push(hardPush);
      }
      m.footPlanted[i] = planted;
    });

    // Hide the body in first person so it doesn't fill the view.
    body.current.visible = getCameraMode() !== "hood";
    audio.current?.update(speedFactor, m.grounded);

    updateVehicleCamera(
      state.camera,
      collider,
      p,
      m.yaw,
      speedFactor,
      hardPush,
      dt,
      state.clock.elapsedTime,
      CAMERAS,
    );
  });

  return (
    <group ref={root} position={START_POSITION} rotation-y={START_YAW}>
      <group ref={body}>
        <group rotation-y={MODEL_FACING}>
          <group position={setup.offset}>
            <primitive object={scene} scale={setup.scale} />
            <ModelOutlines object={scene} />
          </group>
        </group>
      </group>
    </group>
  );
}

useGLTF.preload(charUrl);

export default Character;
