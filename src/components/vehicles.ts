import carUrl from "../assets/car.glb?url";
import charUrl from "../assets/Char.glb?url";
import type { Object3D } from "three";
import { applyCharacterTextures } from "./characterMaterials";
import spaceShipUrl from "../assets/space_ship.glb?url";

export type VehicleId = "car" | "ship" | "char";

export type VehicleInfo = {
  id: VehicleId;
  name: string;
  tagline: string;
  modelUrl: string;
  previewAnimation?: string; // clip to play (in place) on the card
  prepareModel?: (scene: Object3D) => void; // material fixes etc.
  accent: string;
  speedometer: boolean;
  hoodLabel: string; // name of the "hood" camera mode for this vehicle
  stats: { label: string; value: number }[]; // value 0..1
  perks: string[];
  controls: [keys: string, action: string][];
};

export const VEHICLES: VehicleInfo[] = [
  {
    id: "car",
    name: "Street Racer",
    tagline: "Five gears, a handbrake and a lot of attitude.",
    modelUrl: carUrl,
    accent: "#ff5a36",
    speedometer: true,
    hoodLabel: "Hood",
    stats: [
      { label: "Speed", value: 0.8 },
      { label: "Handling", value: 0.6 },
      { label: "Drift", value: 0.95 },
    ],
    perks: ["Handbrake drifts", "Turbo boost", "Reverse gear"],
    controls: [
      ["W", "gas"],
      ["S", "brake/reverse"],
      ["A/D", "steer"],
      ["Space", "handbrake"],
      ["E", "boost"],
    ],
  },
  {
    id: "ship",
    name: "Hover Ship",
    tagline: "Skim over the sofa. Land on the table. Touch the ceiling.",
    modelUrl: spaceShipUrl,
    accent: "#36d6ff",
    speedometer: true,
    hoodLabel: "Cockpit",
    stats: [
      { label: "Speed", value: 0.7 },
      { label: "Handling", value: 0.85 },
      { label: "Altitude", value: 1 },
    ],
    perks: ["Flies over furniture", "Afterburner", "Banks into turns"],
    controls: [
      ["W", "thrust"],
      ["S", "brake"],
      ["A/D", "turn"],
      ["Space/Shift", "up/down"],
      ["E", "boost"],
    ],
  },
  {
    id: "char",
    name: "Skater",
    tagline: "Kick-push through the house, coast the corners, ollie the rug.",
    modelUrl: charUrl,
    previewAnimation: "mixamo.com",
    prepareModel: applyCharacterTextures,
    accent: "#a07bff",
    speedometer: false,
    hoodLabel: "First person",
    stats: [
      { label: "Speed", value: 0.45 },
      { label: "Agility", value: 0.9 },
      { label: "Air", value: 0.6 },
    ],
    perks: ["Kick-push & coast", "Ollies", "First-person view"],
    controls: [
      ["W", "push"],
      ["S", "brake"],
      ["A/D", "carve"],
      ["Shift", "push harder"],
      ["Space", "ollie"],
    ],
  },
];
