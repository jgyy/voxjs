import { vec3 } from "gl-matrix";
import { Camera } from "../gfx/camera";
import { Biome } from "../world/biomes";
import { MobKind } from "../world/entities";
import { MUSIC_PROFILES, semitoneToRatio } from "./music-profiles";

const GLIDE_SECONDS = 3;
const NOISE_BUFFER_SECONDS = 0.5;

interface ListenerLike {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  forwardX?: AudioParam;
  forwardY?: AudioParam;
  forwardZ?: AudioParam;
  upX?: AudioParam;
  upY?: AudioParam;
  upZ?: AudioParam;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void;
}

/**
 * Procedurally synthesized audio (no external asset files, consistent with
 * the no-premade-assets approach already used for block textures): a
 * generative per-biome ambient pad + plucked-note sequencer for V.4's music
 * requirement, plus spatialized one-shot SFX for actions. Distance falloff
 * and stereo positioning both come from the Web Audio PannerNode's built-in
 * distance/panning model, which covers both the mandatory "volume adjusts
 * with distance" requirement and the bonus "stereo sound implementation".
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private padFilter!: BiquadFilterNode;
  private padGain!: GainNode;
  private padOscillators: OscillatorNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;

  private currentBiome: Biome | null = null;
  private plinkTimer = 0;
  private unlocked = false;

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return; // Web Audio unsupported — game still runs, just silently.
    this.ctx = new AudioCtx();
    this.buildGraph(this.ctx);
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 1800;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master);

    const detunes = [0, 0.06, -0.05];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 220 * (1 + detunes[i]!);
      osc.connect(this.padFilter);
      osc.start();
      this.padOscillators.push(osc);
    }

    this.noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS), ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  setBiome(biome: Biome): void {
    if (!this.ctx || biome === this.currentBiome) return;
    this.currentBiome = biome;
    const profile = MUSIC_PROFILES[biome];
    const now = this.ctx.currentTime;

    const chordSemitones = [profile.scale[0] ?? 0, profile.scale[2] ?? profile.scale[0] ?? 0, profile.scale[4] ?? profile.scale[1] ?? 0];
    this.padOscillators.forEach((osc, i) => {
      osc.type = profile.wave;
      const targetHz = profile.rootHz * semitoneToRatio(chordSemitones[i]!);
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(targetHz, now + GLIDE_SECONDS);
    });

    this.padFilter.frequency.cancelScheduledValues(now);
    this.padFilter.frequency.setValueAtTime(this.padFilter.frequency.value, now);
    this.padFilter.frequency.linearRampToValueAtTime(profile.cutoffHz, now + GLIDE_SECONDS);

    this.padGain.gain.cancelScheduledValues(now);
    this.padGain.gain.setValueAtTime(this.padGain.gain.value, now);
    this.padGain.gain.linearRampToValueAtTime(profile.padGain, now + GLIDE_SECONDS);
  }

  update(camera: Camera, dt: number): void {
    if (!this.ctx) return;
    this.updateListener(camera);

    if (this.currentBiome === null) return;
    this.plinkTimer -= dt;
    if (this.plinkTimer <= 0) {
      const profile = MUSIC_PROFILES[this.currentBiome];
      this.plinkTimer = profile.tempoSeconds * (0.7 + Math.random() * 0.6);
      this.playPlink(profile.rootHz, profile.scale, profile.wave);
    }
  }

  private updateListener(camera: Camera): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener as unknown as ListenerLike;
    const x = camera.position[0]!;
    const y = camera.position[1]!;
    const z = camera.position[2]!;
    const forward = camera.forwardVector(vec3.create());
    const now = this.ctx.currentTime;

    if (listener.positionX && listener.forwardX && listener.upX) {
      listener.positionX.setTargetAtTime(x, now, 0.05);
      listener.positionY!.setTargetAtTime(y, now, 0.05);
      listener.positionZ!.setTargetAtTime(z, now, 0.05);
      listener.forwardX.setTargetAtTime(forward[0], now, 0.05);
      listener.forwardY!.setTargetAtTime(forward[1], now, 0.05);
      listener.forwardZ!.setTargetAtTime(forward[2], now, 0.05);
      listener.upX.setTargetAtTime(0, now, 0.05);
      listener.upY!.setTargetAtTime(1, now, 0.05);
      listener.upZ!.setTargetAtTime(0, now, 0.05);
    } else if (listener.setPosition && listener.setOrientation) {
      listener.setPosition(x, y, z);
      listener.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
    }
  }

  private playPlink(rootHz: number, scale: number[], wave: OscillatorType): void {
    if (!this.ctx) return;
    const degree = scale[Math.floor(Math.random() * scale.length)]!;
    const octave = Math.random() < 0.3 ? 12 : 0;
    const freq = rootHz * semitoneToRatio(degree + octave) * 2; // an octave above the pad, for a "melody" register

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = wave === "sawtooth" ? "triangle" : wave;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  private makeNoiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loopStart = Math.random() * (NOISE_BUFFER_SECONDS - 0.15);
    src.loop = false;
    return src;
  }

  /** Builds a one-shot spatialized SFX chain: source -> filter -> envelope -> panner -> master. */
  private playSpatialNoise(
    position: vec3,
    opts: { filterHz: number; filterType: BiquadFilterType; duration: number; peakGain: number; playbackRate?: number },
  ): void {
    if (!this.ctx) return;
    const src = this.makeNoiseSource();
    if (!src) return;
    src.playbackRate.value = opts.playbackRate ?? 1;

    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = opts.filterHz;

    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(opts.peakGain, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);

    const panner = this.createPanner(position);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    src.start(now, Math.random() * 0.05);
    src.stop(now + opts.duration + 0.05);
  }

  private createPanner(position: vec3): PannerNode {
    const panner = this.ctx!.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "inverse";
    panner.refDistance = 2;
    panner.maxDistance = 48;
    panner.rolloffFactor = 1.4;
    const p = panner as unknown as ListenerLike;
    if (p.positionX) {
      p.positionX.setValueAtTime(position[0], this.ctx!.currentTime);
      p.positionY!.setValueAtTime(position[1], this.ctx!.currentTime);
      p.positionZ!.setValueAtTime(position[2], this.ctx!.currentTime);
    } else if ("setPosition" in panner) {
      (panner as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(
        position[0],
        position[1],
        position[2],
      );
    }
    return panner;
  }

  playFootstep(position: vec3): void {
    this.playSpatialNoise(position, { filterHz: 700, filterType: "bandpass", duration: 0.14, peakGain: 0.18, playbackRate: 0.9 + Math.random() * 0.3 });
  }

  playSwim(position: vec3): void {
    this.playSpatialNoise(position, { filterHz: 1400, filterType: "bandpass", duration: 0.28, peakGain: 0.15, playbackRate: 0.8 + Math.random() * 0.3 });
  }

  playBreak(position: vec3): void {
    this.playSpatialNoise(position, { filterHz: 1100, filterType: "bandpass", duration: 0.18, peakGain: 0.3, playbackRate: 0.8 + Math.random() * 0.5 });
  }

  playPlace(position: vec3): void {
    this.playSpatialNoise(position, { filterHz: 500, filterType: "lowpass", duration: 0.12, peakGain: 0.28 });
  }

  playAttackSwing(position: vec3): void {
    this.playSpatialNoise(position, { filterHz: 2200, filterType: "highpass", duration: 0.09, peakGain: 0.2 });
  }

  playHurt(position: vec3): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.25);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    const panner = this.createPanner(position);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  playMobStep(position: vec3, kind: MobKind): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = kind === MobKind.Creeper ? 90 : 70;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    const panner = this.createPanner(position);
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }
}
