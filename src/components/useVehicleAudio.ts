import { useEffect, useRef } from "react";
import type { SynthAudio } from "./audioBase";

// Creates a vehicle's sound engine for the component's lifetime. Sound starts
// on the first key press/click (browser autoplay rules); M toggles mute.
export function useVehicleAudio<T extends SynthAudio>(create: () => T) {
  const audio = useRef<T | null>(null);
  const createRef = useRef(create);

  useEffect(() => {
    const sound = createRef.current();
    audio.current = sound;
    const start = () => sound.start();
    const mute = (e: KeyboardEvent) => {
      if (e.code === "KeyM") sound.toggleMute();
    };
    window.addEventListener("keydown", start);
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", mute);
    return () => {
      window.removeEventListener("keydown", start);
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", mute);
      sound.dispose();
      audio.current = null;
    };
  }, []);

  return audio;
}
