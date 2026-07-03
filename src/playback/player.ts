import { midiToFreq, secPerTick, type PartRole, type Score } from "../score/types";

/** Tone.js is heavy — load it on first playback, not at startup. */
type ToneModule = typeof import("tone");
let tonePromise: Promise<ToneModule> | null = null;
function getTone(): Promise<ToneModule> {
  tonePromise ??= import("tone");
  return tonePromise;
}

const ROLE_OSCILLATOR = {
  melody: "triangle",
  bass: "square",
  counter: "sawtooth",
} as const satisfies Record<PartRole, string>;

interface NoteEvent {
  time: number;
  freq: number;
  durSec: number;
  velocity: number;
}

interface ChordEvent {
  time: number;
  freqs: number[];
  durSec: number;
}

/** Which parts are audible under the mute/solo rules. */
export function audiblePartIds(score: Score): Set<string> {
  const soloed = score.parts.filter((p) => p.solo).map((p) => p.id);
  if (soloed.length > 0) return new Set(soloed);
  return new Set(score.parts.filter((p) => !p.muted).map((p) => p.id));
}

function chordEvents(score: Score, spt: number, offsetSec: number): ChordEvent[] {
  return score.chords.map((c) => {
    const root = 48 + c.rootPc; // voiced around C3–C4
    const third = root + (c.quality === "major" ? 4 : 3);
    const fifth = root + (c.quality === "diminished" ? 6 : 7);
    return {
      time: offsetSec + c.startTick * spt,
      freqs: [root, third, fifth].map(midiToFreq),
      durSec: c.durationTicks * spt * 0.95,
    };
  });
}

interface ToneHandles {
  disposables: { dispose(): void }[];
}

/**
 * Schedule a score's parts (and chords) onto the Transport starting at
 * `offsetSec`, returning the nodes for later disposal.
 */
function scheduleScore(
  Tone: ToneModule,
  score: Score,
  opts: { offsetSec?: number; includeChords?: boolean; volumeDb?: number },
): ToneHandles {
  const offsetSec = opts.offsetSec ?? 0;
  const volumeDb = opts.volumeDb ?? 0;
  const spt = secPerTick(score.bpm);
  const disposables: { dispose(): void }[] = [];
  const audible = audiblePartIds(score);

  // A touch of shared room so the raw oscillators don't sound clinical.
  const reverb = new Tone.Reverb({ decay: 1.6, wet: 0.18 }).toDestination();
  disposables.push(reverb);

  for (const part of score.parts) {
    if (!audible.has(part.id)) continue;
    const synth = new Tone.Synth({
      oscillator: { type: ROLE_OSCILLATOR[part.role] },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.15 },
    }).connect(reverb);
    synth.volume.value = volumeDb;
    disposables.push(synth);
    const events: NoteEvent[] = part.notes.map((n) => ({
      time: offsetSec + n.startTick * spt,
      freq: midiToFreq(n.midi),
      durSec: n.durationTicks * spt * 0.95,
      velocity: n.velocity ?? 0.8,
    }));
    disposables.push(
      new Tone.Part<NoteEvent>((time, ev) => {
        synth.triggerAttackRelease(ev.freq, ev.durSec, time, ev.velocity);
      }, events).start(0),
    );
  }

  if ((opts.includeChords ?? true) && score.chordsEnabled && score.chords.length > 0) {
    const poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
    }).connect(reverb);
    poly.volume.value = volumeDb - 10;
    disposables.push(poly);
    disposables.push(
      new Tone.Part<ChordEvent>((time, ev) => {
        poly.triggerAttackRelease(ev.freqs, ev.durSec, time);
      }, chordEvents(score, spt, offsetSec)).start(0),
    );
  }

  return { disposables };
}

type PlayerListener = (playing: boolean) => void;

class Player {
  private handles: ToneHandles | null = null;
  private listeners = new Set<PlayerListener>();
  private playing = false;
  private startedAtCtxSec = 0;
  private tone: ToneModule | null = null;
  private scoreBpm = 100;

  onStateChange(fn: PlayerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.listeners.forEach((fn) => fn(playing));
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Playback position in ticks, or null when stopped. */
  get positionTick(): number | null {
    if (!this.playing || !this.tone) return null;
    const elapsed = this.tone.getContext().now() - this.startedAtCtxSec;
    return elapsed / secPerTick(this.scoreBpm);
  }

  async play(score: Score): Promise<void> {
    const Tone = await getTone();
    this.tone = Tone;
    await Tone.start(); // must originate from a user gesture
    this.stop();
    this.scoreBpm = score.bpm;
    const transport = Tone.getTransport();
    transport.bpm.value = score.bpm;
    this.handles = scheduleScore(Tone, score, {});
    const endSec = score.totalTicks * secPerTick(score.bpm);
    transport.scheduleOnce(() => this.stop(), endSec + 0.4);
    this.startedAtCtxSec = Tone.getContext().now() + 0.08;
    transport.start("+0.08");
    this.setPlaying(true);
  }

  stop(): void {
    if (!this.tone) return;
    const transport = this.tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.position = 0;
    this.handles?.disposables.forEach((d) => d.dispose());
    this.handles = null;
    this.setPlaying(false);
  }
}

/** App-wide playback singleton. */
export const player = new Player();

/** Short pitch blip for auditioning a note in the editor. */
export async function auditionNote(midi: number): Promise<void> {
  const Tone = await getTone();
  await Tone.start();
  const synth = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.2 },
  }).toDestination();
  synth.volume.value = -6;
  synth.triggerAttackRelease(midiToFreq(midi), 0.3);
  setTimeout(() => synth.dispose(), 800);
}

export interface Backing {
  stop(): void;
}

/**
 * Backing track while recording a new part: a click count-in, then the
 * existing parts (quieter) with the click continuing to mark the beat.
 * Returns once the count-in has finished — i.e. when capture should begin.
 */
export async function startBacking(
  score: Score,
  opts: {
    countInBeats: number;
    maxSec: number;
    onCountBeat?: (beatsLeft: number) => void;
  },
): Promise<Backing> {
  const Tone = await getTone();
  await Tone.start();
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;
  transport.bpm.value = score.bpm;

  const beatSec = 60 / score.bpm;
  const countInSec = opts.countInBeats * beatSec;
  const disposables: { dispose(): void }[] = [];

  const click = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
  }).toDestination();
  click.volume.value = -8;
  disposables.push(click);

  const totalBeats = Math.ceil((countInSec + opts.maxSec) / beatSec);
  for (let b = 0; b < totalBeats; b++) {
    const isCountIn = b < opts.countInBeats;
    const beatsPerMeasure = score.timeSig.beats;
    const accented = (b - opts.countInBeats) % beatsPerMeasure === 0;
    transport.scheduleOnce((time) => {
      click.triggerAttackRelease(isCountIn ? "G4" : accented ? "E4" : "C4", 0.05, time);
      if (isCountIn && opts.onCountBeat) {
        opts.onCountBeat(opts.countInBeats - b);
      }
    }, b * beatSec);
  }

  const scheduled = scheduleScore(Tone, score, { offsetSec: countInSec, volumeDb: -6 });
  disposables.push(...scheduled.disposables);

  transport.start("+0.05");

  // Resolve when the count-in completes.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, (countInSec + 0.05) * 1000);
  });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      transport.stop();
      transport.cancel();
      transport.position = 0;
      disposables.forEach((d) => d.dispose());
    },
  };
}
