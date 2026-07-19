import { Biome } from "../world/biomes";

export interface MusicProfile {
  rootHz: number;
  scale: number[]; // semitone offsets from root
  wave: OscillatorType;
  tempoSeconds: number;
  cutoffHz: number;
  padGain: number;
}

// Each biome gets a distinct root/scale/timbre/tempo/filter — V.4: "Each
// biome should have its own unique ambient music". Transitions are smooth
// because AudioEngine glides these parameters with AudioParam ramps instead
// of hard-cutting between tracks (see audio/engine.ts).
export const MUSIC_PROFILES: Record<Biome, MusicProfile> = {
  [Biome.Plains]: { rootHz: 220, scale: [0, 2, 4, 7, 9], wave: "sine", tempoSeconds: 3.2, cutoffHz: 2200, padGain: 0.05 },
  [Biome.Forest]: { rootHz: 196, scale: [0, 3, 5, 7, 10], wave: "triangle", tempoSeconds: 2.6, cutoffHz: 1600, padGain: 0.05 },
  [Biome.SequoiaForest]: { rootHz: 174, scale: [0, 2, 3, 7, 9], wave: "triangle", tempoSeconds: 3.6, cutoffHz: 1200, padGain: 0.055 },
  [Biome.Desert]: { rootHz: 233, scale: [0, 4, 7, 8], wave: "sine", tempoSeconds: 4.2, cutoffHz: 2600, padGain: 0.04 },
  [Biome.Canyon]: { rootHz: 146, scale: [0, 3, 5, 6, 10], wave: "sawtooth", tempoSeconds: 3.0, cutoffHz: 900, padGain: 0.045 },
  [Biome.Swamp]: { rootHz: 130, scale: [0, 3, 6, 7, 10], wave: "triangle", tempoSeconds: 4.5, cutoffHz: 700, padGain: 0.06 },
  [Biome.Savanna]: { rootHz: 261, scale: [0, 2, 4, 7, 9], wave: "sine", tempoSeconds: 2.2, cutoffHz: 2400, padGain: 0.045 },
  [Biome.SnowyPlains]: { rootHz: 293, scale: [0, 2, 3, 7, 9], wave: "sine", tempoSeconds: 4.0, cutoffHz: 1800, padGain: 0.04 },
  [Biome.Mountain]: { rootHz: 174, scale: [0, 2, 4, 7, 11], wave: "triangle", tempoSeconds: 3.4, cutoffHz: 2000, padGain: 0.05 },
  [Biome.Island]: { rootHz: 220, scale: [0, 4, 7, 9, 11], wave: "sine", tempoSeconds: 2.8, cutoffHz: 2200, padGain: 0.045 },
};

export function semitoneToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}
