import * as Tone from "tone";
import { midiToFreq, secPerTick, type PartRole, type Score } from "../score/types";

const ROLE_OSCILLATOR = {
  melody: "triangle",
  bass: "square",
  counter: "sawtooth",
} as const satisfies Record<PartRole, string>;

interface NoteEvent {
  time: number;
  freq: number;
  durSec: number;
}

interface ChordEvent {
  time: number;
  freqs: number[];
  durSec: number;
}

export class Player {
  private synths: Tone.Synth[] = [];
  private chordSynth: Tone.PolySynth | null = null;
  private parts: Tone.Part[] = [];
  private endSec = 0;
  private playing = false;

  load(score: Score): void {
    this.disposeNodes();
    const transport = Tone.getTransport();
    transport.cancel();
    transport.bpm.value = score.bpm;
    const spt = secPerTick(score.bpm);
    this.endSec = score.totalTicks * spt;

    for (const part of score.parts) {
      const synth = new Tone.Synth({
        oscillator: { type: ROLE_OSCILLATOR[part.role] },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.15 },
      }).toDestination();
      this.synths.push(synth);
      const events: NoteEvent[] = part.notes.map((n) => ({
        time: n.startTick * spt,
        freq: midiToFreq(n.midi),
        durSec: n.durationTicks * spt * 0.95,
      }));
      const tonePart = new Tone.Part<NoteEvent>((time, ev) => {
        synth.triggerAttackRelease(ev.freq, ev.durSec, time);
      }, events).start(0);
      this.parts.push(tonePart);
    }

    if (score.chordsEnabled && score.chords.length > 0) {
      const poly = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.5, release: 0.3 },
      }).toDestination();
      poly.volume.value = -10;
      this.chordSynth = poly;
      const events: ChordEvent[] = score.chords.map((c) => {
        const root = 48 + c.rootPc; // voiced around C3–C4
        const third = root + (c.quality === "major" ? 4 : 3);
        const fifth = root + (c.quality === "diminished" ? 6 : 7);
        return {
          time: c.startTick * spt,
          freqs: [root, third, fifth].map(midiToFreq),
          durSec: c.durationTicks * spt * 0.95,
        };
      });
      const chordPart = new Tone.Part<ChordEvent>((time, ev) => {
        poly.triggerAttackRelease(ev.freqs, ev.durSec, time);
      }, events).start(0);
      this.parts.push(chordPart);
    }
  }

  async play(onEnded?: () => void): Promise<void> {
    await Tone.start(); // must originate from a user gesture
    const transport = Tone.getTransport();
    transport.scheduleOnce(() => {
      this.stop();
      onEnded?.();
    }, this.endSec + 0.5);
    transport.start("+0.05");
    this.playing = true;
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private disposeNodes(): void {
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    this.synths.forEach((s) => s.dispose());
    this.synths = [];
    this.chordSynth?.dispose();
    this.chordSynth = null;
  }

  dispose(): void {
    this.stop();
    Tone.getTransport().cancel();
    this.disposeNodes();
  }
}
