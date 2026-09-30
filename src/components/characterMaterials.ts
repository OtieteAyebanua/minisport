import * as THREE from "three";

// Char.glb ships its outfit textures (Main_BaseColor/Normal/Metallic-
// Roughness) on the small "trouser" material only; the main body part uses
// a plain grey "Material.001". Both share the same UV atlas, so give the
// grey part the outfit material too.
const OUTFIT_MATERIAL = "trouser";
const UNTEXTURED_MATERIAL = "Material.001";

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

export function applyCharacterTextures(scene: THREE.Object3D) {
  if (scene.userData.texturesApplied) return;

  let outfit: THREE.MeshStandardMaterial | undefined;
  scene.traverse((object) => {
    if (isMesh(object) && !Array.isArray(object.material)) {
      if (object.material.name === OUTFIT_MATERIAL) {
        outfit = object.material as THREE.MeshStandardMaterial;
      }
    }
  });
  if (!outfit) return;

  // Alpha-blended clothing sorts badly on a body; a cut-out looks the same
  // without see-through glitches.
  outfit.transparent = false;
  outfit.alphaTest = 0.5;
  outfit.depthWrite = true;
  outfit.needsUpdate = true;

  scene.traverse((object) => {
    if (
      isMesh(object) &&
      !Array.isArray(object.material) &&
      object.material.name === UNTEXTURED_MATERIAL
    ) {
      object.material = outfit!;
    }
  });

  scene.userData.texturesApplied = true;
}
