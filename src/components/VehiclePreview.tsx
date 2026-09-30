import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { makeInPlace } from "./characterAnimation";
import ModelOutlines from "./ModelOutlines";
import { stripOutlines, TOON_LIGHT, useToonGLTF } from "./toon";

type TurntableModelProps = {
  url: string;
  spinning: boolean;
  animation?: string;
  prepare?: (scene: THREE.Object3D) => void;
  onReady: (ready: boolean) => void;
};

function TurntableModel({ url, spinning, animation, prepare, onReady }: TurntableModelProps) {
  const { scene, animations } = useToonGLTF(url, prepare);
  // The level uses the same cached scene, so show a copy here. SkeletonUtils
  // clones rigged models properly (a plain clone would share the skeleton).
  // Drop any outlines the level had attached to the original, and the
  // position/scale the level applied to its root.
  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    stripOutlines(copy);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.set(1, 1, 1);
    return copy;
  }, [scene]);
  const turntable = useRef<THREE.Group>(null);

  // Fit the model into a ~2 unit box, resting on the ground.
  const fit = useMemo(() => {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    const scale = Math.min(2 / Math.max(size.x, size.z), 1.5 / size.y);
    const center = box.getCenter(new THREE.Vector3());
    return {
      scale,
      offset: [-center.x * scale, -box.min.y * scale - 0.45, -center.z * scale] as const,
    };
  }, [model]);

  // Optionally play a clip (walking in place) on the card.
  const clip = useMemo(() => {
    const source = animations.find((a) => a.name === animation);
    return source ? makeInPlace(source) : null;
  }, [animations, animation]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  useEffect(() => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.play();
    return () => {
      action.stop();
    };
  }, [clip, mixer]);

  useEffect(() => onReady(true), [onReady]);

  useFrame((_, delta) => {
    mixer.update(delta);
    if (!turntable.current) return;
    turntable.current.rotation.y += delta * (spinning ? 1.6 : 0.5);
  });

  return (
    <group ref={turntable} rotation-y={-0.6}>
      <primitive object={model} scale={fit.scale} position={fit.offset} />
      <ModelOutlines object={model} thickness={2} />
    </group>
  );
}

type VehiclePreviewProps = {
  url: string;
  accent: string;
  spinning: boolean;
  animation?: string;
  prepare?: (scene: THREE.Object3D) => void;
};

// Small rotating 3D preview of a vehicle model for the selection cards.
function VehiclePreview({ url, accent, spinning, animation, prepare }: VehiclePreviewProps) {
  const [ready, setReady] = useState(false);
  return (
    <>
      {!ready && <span className="vehicle-card-loading">Loading…</span>}
      <Canvas flat camera={{ position: [0, 1.1, 3.2], fov: 38 }} dpr={[1, 2]}>
        <hemisphereLight args={[TOON_LIGHT.sky, TOON_LIGHT.ground, TOON_LIGHT.fill]} />
        <directionalLight position={[3, 4, 2]} intensity={TOON_LIGHT.key} color={TOON_LIGHT.keyColor} />
        <pointLight position={[-2, 0.5, -1.5]} intensity={8} color={accent} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.46}>
          <circleGeometry args={[1.3, 48]} />
          <meshStandardMaterial color={accent} transparent opacity={0.18} />
        </mesh>
        <Suspense fallback={null}>
          <TurntableModel
            url={url}
            spinning={spinning}
            animation={animation}
            prepare={prepare}
            onReady={setReady}
          />
        </Suspense>
      </Canvas>
    </>
  );
}

export default VehiclePreview;
