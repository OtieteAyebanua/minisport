import { Bvh, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import houseUrl from "../assets/house.glb?url";
import Car from "./Car";
import Character from "./Character";
import SpaceShip from "./SpaceShip";
import { TOON_LIGHT, TOON_SKY, useToonGLTF } from "./toon";
import { castRay } from "./vehicleShared";
import type { VehicleId } from "./vehicles";

const ROOM_CENTER = new THREE.Vector3(2.3, 1.2, 0.7);
const attractTarget = new THREE.Vector3();
const attractDir = new THREE.Vector3();

// Slow cinematic orbit around the room while the player is choosing.
function AttractCamera({ collider }: { collider: THREE.Object3D }) {
  useFrame((state, delta) => {
    const camera = state.camera;
    const t = state.clock.elapsedTime * 0.12;
    attractTarget.set(
      ROOM_CENTER.x + Math.sin(t) * 3,
      ROOM_CENTER.y + 0.9 + Math.sin(t * 0.7) * 0.3,
      ROOM_CENTER.z + Math.cos(t) * 3,
    );
    // Stay inside the room: stop short of any wall between centre and camera.
    attractDir.subVectors(attractTarget, ROOM_CENTER);
    const distance = attractDir.length();
    attractDir.normalize();
    const wall = castRay(collider, ROOM_CENTER, attractDir, distance);
    if (wall) {
      attractTarget.copy(ROOM_CENTER).addScaledVector(attractDir, wall.distance - 0.2);
    }
    camera.position.lerp(attractTarget, 1 - Math.exp(-3 * Math.min(delta, 0.05)));
    camera.lookAt(ROOM_CENTER);
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== 70) {
      camera.fov = 70;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

type HomeLevelProps = {
  vehicle: VehicleId | null;
};

function HomeLevel({ vehicle }: HomeLevelProps) {
  const { scene } = useToonGLTF(houseUrl);

  return (
    <>
      {/* The active vehicle (or the attract orbit) drives this camera. */}
      <PerspectiveCamera makeDefault position={[2.3, 0.7, 4]} fov={70} near={0.01} />
      {/* Toon lighting: one strong key light defines the cel bands; the
          hemisphere light fills shadows (warm from above, cool from below). */}
      <color attach="background" args={[TOON_SKY]} />
      <hemisphereLight args={[TOON_LIGHT.sky, TOON_LIGHT.ground, TOON_LIGHT.fill]} />
      <directionalLight position={[4, 10, 6]} intensity={TOON_LIGHT.key} color={TOON_LIGHT.keyColor} />
      {/* Bvh speeds up collision raycasts against the house. */}
      <Bvh firstHitOnly>
        <primitive object={scene} />
      </Bvh>
      {vehicle === "car" && <Car collider={scene} />}
      {vehicle === "ship" && <SpaceShip collider={scene} />}
      {vehicle === "char" && <Character collider={scene} />}
      {vehicle === null && <AttractCamera collider={scene} />}
    </>
  );
}

useGLTF.preload(houseUrl);

export default HomeLevel;
