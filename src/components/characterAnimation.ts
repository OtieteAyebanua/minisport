import * as THREE from "three";

// The character's walk ("mixamo.com") has root motion: the hips travel along
// their local Y axis. These helpers make it walk in place so gameplay code
// controls movement.

export const WALK_CLIP_NAME = "mixamo.com";

function isHipsPosition(track: THREE.KeyframeTrack) {
  return /Hips\.position$/.test(track.name);
}

export function findWalkClip(animations: THREE.AnimationClip[]) {
  return animations.find((clip) => clip.name === WALK_CLIP_NAME) ?? animations[0];
}

// Copy of the clip with the hips' forward travel (local Y) pinned to its
// first value; the vertical bob and sway are kept.
export function makeInPlace(clip: THREE.AnimationClip) {
  const tracks = clip.tracks.map((track) => {
    if (!isHipsPosition(track)) return track.clone();
    const values = track.values.slice();
    for (let i = 1; i < values.length; i += 3) values[i] = values[1];
    return new THREE.VectorKeyframeTrack(track.name, track.times.slice(), values);
  });
  return new THREE.AnimationClip(`${clip.name} (in place)`, clip.duration, tracks);
}

// Distance the original clip's hips travel per second, in the clip's units.
export function rootMotionSpeed(clip: THREE.AnimationClip) {
  const track = clip.tracks.find(isHipsPosition);
  if (!track || clip.duration === 0) return 0;
  const last = track.values.length - 3;
  return Math.abs(track.values[last + 1] - track.values[1]) / clip.duration;
}
