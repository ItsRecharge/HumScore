import { Midi } from "@tonejs/midi";
import { secPerTick, type Score } from "../score/types";

export function toMidiBytes(score: Score): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(score.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const spt = secPerTick(score.bpm);

  for (const part of score.parts) {
    const track = midi.addTrack();
    track.name = part.name;
    for (const n of part.notes) {
      track.addNote({
        midi: n.midi,
        time: n.startTick * spt,
        duration: n.durationTicks * spt,
        velocity: 0.8,
      });
    }
  }

  if (score.chordsEnabled && score.chords.length > 0) {
    const track = midi.addTrack();
    track.name = "Chords";
    for (const c of score.chords) {
      const root = 48 + c.rootPc;
      const third = root + (c.quality === "major" ? 4 : 3);
      const fifth = root + (c.quality === "diminished" ? 6 : 7);
      for (const pitch of [root, third, fifth]) {
        track.addNote({
          midi: pitch,
          time: c.startTick * spt,
          duration: c.durationTicks * spt,
          velocity: 0.6,
        });
      }
    }
  }

  return midi.toArray();
}
