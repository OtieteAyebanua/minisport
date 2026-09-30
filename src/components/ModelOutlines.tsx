import { Fragment, useMemo } from "react";
import { Outlines } from "@react-three/drei";
import { createPortal, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { OUTLINE_COLOR, OUTLINE_FLAG, OUTLINE_PX } from "./toon";

type ModelOutlinesProps = {
  object: THREE.Object3D;
  thickness?: number; // CSS pixels
  color?: string;
};

function collectMeshes(object: THREE.Object3D, meshes: THREE.Mesh[]) {
  if (object.userData[OUTLINE_FLAG]) return; // don't outline outlines
  if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  object.children.forEach((child) => collectMeshes(child, meshes));
}

// Cartoon ink lines around every mesh in a loaded model (works on skinned,
// animated meshes too). Each outline is portalled into its mesh so it follows
// the mesh's transform, skeleton and visibility.
function ModelOutlines({ object, thickness = OUTLINE_PX, color = OUTLINE_COLOR }: ModelOutlinesProps) {
  const dpr = useThree((state) => state.viewport.dpr);
  const meshes = useMemo(() => {
    const list: THREE.Mesh[] = [];
    collectMeshes(object, list);
    return list;
  }, [object]);

  return (
    <>
      {meshes.map((mesh) => (
        <Fragment key={mesh.uuid}>
          {createPortal(
            // In this drei version `screenspace={false}` measures thickness
            // in drawing-buffer pixels, so scale by the pixel ratio.
            <Outlines
              thickness={thickness * dpr}
              color={color}
              screenspace={false}
              userData={{ [OUTLINE_FLAG]: true }}
            />,
            mesh,
          )}
        </Fragment>
      ))}
    </>
  );
}

export default ModelOutlines;
