import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Cel shading for the whole game: every loaded model's materials are swapped
// for MeshToonMaterial with a hard-stepped gradient, keeping colour maps,
// transparency and glow but dropping PBR detail (metalness, normal maps).

// Brightness of each light band as a fraction of direct light:
// shadow side, mid-tone, lit side.
export const TOON_BANDS = [0.15, 0.55, 1];

// Sky seen through the windows (the house model has nothing outside).
export const TOON_SKY = "#bfe0ff";

// Shared toon lighting: a hemisphere fill (sky colour from above, cooler
// shade from below) plus one key light that defines the cel bands.
export const TOON_LIGHT = {
  sky: "#fffdf8",
  ground: "#b8b2cc",
  fill: 1.15,
  key: 1.8,
  keyColor: "#fff7ea",
};

// Outline colour/thickness (CSS pixels) for the playable characters.
export const OUTLINE_COLOR = "#17131f";
export const OUTLINE_PX = 2.5;

let gradientMap: THREE.DataTexture | null = null;

export function getToonGradient() {
  if (!gradientMap) {
    const data = new Uint8Array(TOON_BANDS.map((band) => Math.round(band * 255)));
    gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    // Nearest filtering keeps the bands hard-edged.
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

// Standard/physical/basic materials all expose these optionally.
type SourceMaterial = THREE.Material & {
  color?: THREE.Color;
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
};

// Materials shared between meshes stay shared after conversion.
const converted = new WeakMap<THREE.Material, THREE.Material>();

function toToon(source: THREE.Material): THREE.Material {
  if ((source as THREE.MeshToonMaterial).isMeshToonMaterial) return source;
  const cached = converted.get(source);
  if (cached) return cached;

  const s = source as SourceMaterial;
  const toon = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color?.clone() ?? new THREE.Color("white"),
    map: s.map ?? null,
    alphaMap: s.alphaMap ?? null,
    emissive: s.emissive?.clone() ?? new THREE.Color("black"),
    emissiveMap: s.emissiveMap ?? null,
    emissiveIntensity: s.emissiveIntensity ?? 1,
    gradientMap: getToonGradient(),
    transparent: s.transparent,
    opacity: s.opacity,
    alphaTest: s.alphaTest,
    side: s.side,
    depthWrite: s.depthWrite,
    vertexColors: s.vertexColors,
  });
  toon.userData = { ...s.userData };
  converted.set(source, toon);
  return toon;
}

// Converts every mesh under `root` to toon materials (once per model).
export function toonify(root: THREE.Object3D) {
  if (root.userData.toon) return;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(toToon)
      : toToon(mesh.material);
  });
  root.userData.toon = true;
}

// useGLTF, plus an optional one-time fix-up and the toon conversion.
export function useToonGLTF(url: string, prepare?: (scene: THREE.Object3D) => void) {
  const gltf = useGLTF(url);
  useMemo(() => {
    prepare?.(gltf.scene);
    toonify(gltf.scene);
  }, [gltf.scene, prepare]);
  return gltf;
}

// Marks outline objects so clones and traversals can skip them.
export const OUTLINE_FLAG = "isOutline";

// Removes outline objects (e.g. from a clone taken while outlines were attached).
export function stripOutlines(root: THREE.Object3D) {
  const outlines: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.userData[OUTLINE_FLAG]) outlines.push(object);
  });
  outlines.forEach((object) => object.removeFromParent());
}
